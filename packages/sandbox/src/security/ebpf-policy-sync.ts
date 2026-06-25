// EbpfPolicySync — 把 in-process EbpfFirewall 的规则集合镜像到 Go agent 消费的 YAML 文件
// ADR-006 详细说明。决策：写文件而非 HTTP push（沿用 Go agent 现有 hot-reload 路径，零 Go 改动）。
//
// 收敛语义：
//   - polling 200ms 查 firewall.getRules() 长度变化
//   - 长度变化触发 debounce（默认 1s）后原子写 .tmp + rename
//   - in-process 立即生效；Go agent 在 15s 内 pick up（取决于其 own watch tick）
//
// Fail-closed：写失败时（默认）抛错。不允许 sandbox 进程继续运行但内核策略过期。

import { existsSync, mkdirSync, renameSync, writeFileSync } from 'fs';
import { dirname } from 'path';
import { randomUUID } from 'crypto';
import * as yaml from 'js-yaml';
import type { EbpfFirewall, EbpfRule } from './ebpf-firewall.js';

export interface EbpfPolicySyncOptions {
  /** 目标 YAML 路径（agent 的 EBPF_POLICY_PATH）。默认 /etc/aether/ebpf-policy.yaml */
  policyPath: string;
  /** 防抖窗口（连续 addRule 合并成一次写）。默认 1000ms */
  debounceMs?: number;
  /** polling 间隔。默认 200ms */
  pollIntervalMs?: number;
  /** 启动时立即写一次。默认 true */
  writeOnStart?: boolean;
  /** 写失败时 throw（fail-closed）还是仅 console.warn。默认 true */
  failClosed?: boolean;
}

/** Go agent 期望的 YAML schema（与 deploy/ebpf/agent/policy.go 一一对应） */
export interface PolicyRuleYAML {
  id: string;
  action: 'allow' | 'block';
  /** 协议空字符串 = 任意 */
  protocol: 'tcp' | 'udp' | 'icmp' | '';
  host: string;
  /** 0 = 任意端口；正整数 = 具体端口 */
  port: number;
  direction: 'egress' | 'ingress' | 'both';
}

export interface PolicyYAML {
  rules: PolicyRuleYAML[];
}

export class EbpfPolicySync {
  private debounceTimer: NodeJS.Timeout | null = null;
  private pollTimer: NodeJS.Timeout | null = null;
  private lastWrittenRulesLen = -1;
  private running = false;
  private readonly debounceMs: number;
  private readonly pollIntervalMs: number;
  private readonly writeOnStart: boolean;
  private readonly failClosed: boolean;
  private writeCount = 0;

  constructor(
    private readonly firewall: EbpfFirewall,
    private readonly options: EbpfPolicySyncOptions,
  ) {
    this.debounceMs = options.debounceMs ?? 1000;
    this.pollIntervalMs = options.pollIntervalMs ?? 200;
    this.writeOnStart = options.writeOnStart ?? true;
    this.failClosed = options.failClosed ?? true;
  }

  /** 启动 polling + 第一次写 */
  start(): void {
    if (this.running) return;
    this.running = true;
    // 把"当前 length"作为基准记录下来，让 first poll tick 不会因为
    // lastWrittenRulesLen = -1 误触发"初始写"。这样 writeOnStart=false
    // 真的表示"完全不写第一遍"。
    this.lastWrittenRulesLen = this.firewall.getRules().length;
    if (this.writeOnStart) this.writeNow();
    this.pollTimer = setInterval(() => this.maybeWrite(), this.pollIntervalMs);
    console.log(
      `[aether:ebpf-policy-sync] 📡 Started: policyPath=${this.options.policyPath} ` +
      `debounceMs=${this.debounceMs} pollIntervalMs=${this.pollIntervalMs} ` +
      `baselineRules=${this.lastWrittenRulesLen}`,
    );
  }

  /** 停掉 polling。已 debounce 待写的 timer 也清掉。 */
  stop(): void {
    this.running = false;
    if (this.pollTimer) { clearInterval(this.pollTimer); this.pollTimer = null; }
    if (this.debounceTimer) { clearTimeout(this.debounceTimer); this.debounceTimer = null; }
    console.log(`[aether:ebpf-policy-sync] 🛑 Stopped (writes=${this.writeCount})`);
  }

  /** 立即写一次（不等 debounce）。用于测试或 bootstrap 同步。 */
  writeNow(): void {
    if (!this.running && !this.writeOnStart) return;
    const rules = this.firewall.getRules();
    // 首次调用 (writeCount=0) 永远写；之后 length 未变才跳过
    if (this.writeCount > 0 && rules.length === this.lastWrittenRulesLen) {
      return;
    }
    const policy = serializeToPolicyYAML(rules);
    const text = yaml.dump(policy, { lineWidth: 120, noRefs: true });
    try {
      const dir = dirname(this.options.policyPath);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      const tmp = `${this.options.policyPath}.${randomUUID()}.tmp`;
      writeFileSync(tmp, text, { mode: 0o644 });
      renameSync(tmp, this.options.policyPath);
      this.lastWrittenRulesLen = rules.length;
      this.writeCount++;
      console.log(
        `[aether:ebpf-policy-sync] ✍️  Wrote ${rules.length} rules to ${this.options.policyPath}`,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (this.failClosed) {
        console.error(
          `[aether:ebpf-policy-sync] ❌ Failed to write policy to ${this.options.policyPath}: ${msg}. ` +
          `fail-closed: in-process firewall still effective; kernel mirror is stale.`,
        );
        throw err;
      } else {
        console.warn(`[aether:ebpf-policy-sync] ⚠️  Policy write failed: ${msg}`);
      }
    }
  }

  private maybeWrite(): void {
    if (!this.running) return;
    const currentLen = this.firewall.getRules().length;
    if (currentLen === this.lastWrittenRulesLen) return;
    // 关键：如果 debounce 已经在 pending 状态，不要重新 schedule。
    // 否则后续 poll tick 会无限 reset 同一个 timer，write 永远不 fire。
    if (this.debounceTimer) return;
    this.scheduleWrite();
  }

  private scheduleWrite(): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      this.writeNow();
    }, this.debounceMs);
  }

  /** 测试用：累计写入次数 */
  getWriteCount(): number { return this.writeCount; }
  /** 测试用：当前 firewall 规则数量是否已 mirror 到磁盘 */
  isInSync(): boolean { return this.firewall.getRules().length === this.lastWrittenRulesLen; }
}

/** 纯函数：把 EbpfFirewall 规则映射到 Go agent 期望的 YAML schema */
export function serializeToPolicyYAML(rules: EbpfRule[]): PolicyYAML {
  return {
    rules: rules.map(r => ({
      id: r.id,
      action: r.action,
      // protocol: 'all' / undefined / '' 一律归一为空串，agent 视为 any
      protocol: !r.protocol || r.protocol === 'all' ? '' : r.protocol,
      host: r.host ?? '*',
      // port: '*' / undefined / 0 归一为 0，agent 视为 any
      port: typeof r.port === 'number' ? r.port : 0,
      direction: r.direction,
    })),
  };
}
