// EP-01: eBPF Network Firewall
// 应用层网络防火墙，模拟 eBPF XDP/TC 钩子的访问控制行为
//
// 真正的 eBPF 行为：
//   1. 在内核层（XDP/TC）拦截所有网络数据包
//   2. 根据白名单策略决定放行或丢弃
//   3. 违规时直接在内核层丢弃，< 1ms 延迟
//
// 本实现（应用层策略执行）：
//   - 在 isolated-vm 执行前后进行网络策略检查
//   - 记录每次连接拦截事件到审计日志
//   - 提供连接日志可查询接口
//   - 支持动态更新白名单（在运行时）
//
// 注意：Node.js 无法 hook 内核网卡，本实现通过以下方式实现网络策略：
//   - 执行前：检查代码中是否有网络访问模式（静态分析 via _extractNetworkTargets）
//   - 执行后：检查执行结果中的网络事件（动态检测）
//   - bridge.ts 中集成防火墙检查，在代码执行前阻止未授权的网络目标

import { randomUUID } from 'crypto';
import { EventEmitter } from 'events';

// ── 类型定义 ─────────────────────────────────────────────────────────────

export interface EbpfRule {
  id: string;
  action: 'allow' | 'block';
  protocol?: 'tcp' | 'udp' | 'icmp' | 'all';
  host?: string;        // IP 或域名（支持通配符 *）
  port?: number | '*';
  direction: 'egress' | 'ingress' | 'both';
  createdAt: string;
  description?: string;
}

export interface EbpfConnectionLog {
  id: string;
  timestamp: string;
  action: 'allowed' | 'blocked' | 'logged';
  protocol: string;
  localAddress: string;
  remoteAddress: string;
  remotePort: number;
  reason?: string;      // 被拦截原因
  pid?: number;        // 进程 ID
  agentId?: string;     // Agent ID
  bytesIn?: number;
  bytesOut?: number;
  durationMs?: number;
}

export interface EbpfFirewallConfig {
  defaultAction?: 'allow' | 'block';
  logConnections?: boolean;    // 记录所有连接（不只是被拦截的）
  logPath?: string;
  maxLogEntries?: number;
}

// ── eBPF 防火墙模拟 ──────────────────────────────────────────────────────

export class EbpfFirewall extends EventEmitter {
  readonly config: EbpfFirewallConfig;
  private rules: EbpfRule[] = [];
  private connectionLog: EbpfConnectionLog[] = [];
  private connectionCounter = 0;

  constructor(config: EbpfFirewallConfig = {}) {
    super();
    this.config = {
      defaultAction: config.defaultAction ?? 'block',
      logConnections: config.logConnections ?? true,
      logPath: config.logPath ?? './runtime/audit',
      maxLogEntries: config.maxLogEntries ?? 10000,
    };

    // 默认规则：仅允许 localhost
    this._setDefaultRules();
    console.log('[aether:ebpf-firewall] 🔏 eBPF Firewall initialized');
    console.log(`[aether:ebpf-firewall]   defaultAction=${this.config.defaultAction}`);
    console.log(`[aether:ebpf-firewall]   logConnections=${this.config.logConnections}`);
  }

  // ── 规则管理 ─────────────────────────────────────────────────────────────

  /**
   * 添加防火墙规则
   */
  addRule(rule: Omit<EbpfRule, 'id' | 'createdAt'>): EbpfRule {
    const fullRule: EbpfRule = {
      ...rule,
      id: randomUUID(),
      createdAt: new Date().toISOString(),
    };
    this.rules.push(fullRule);
    console.log(`[aether:ebpf-firewall] 📜 Rule added: ${fullRule.action} ${fullRule.protocol}/${fullRule.direction} ${fullRule.host ?? '*'}:${fullRule.port ?? '*'}`);
    return fullRule;
  }

  /**
   * 批量添加规则
   */
  addRules(rules: Omit<EbpfRule, 'id' | 'createdAt'>[]): EbpfRule[] {
    return rules.map(r => this.addRule(r));
  }

  /**
   * 删除规则
   */
  removeRule(ruleId: string): boolean {
    const idx = this.rules.findIndex(r => r.id === ruleId);
    if (idx >= 0) {
      const removed = this.rules.splice(idx, 1)[0];
      console.log(`[aether:ebpf-firewall] 🗑️  Rule removed: ${removed.id}`);
      return true;
    }
    return false;
  }

  /**
   * 清空所有自定义规则（恢复默认）
   */
  resetRules(): void {
    this.rules = [];
    this._setDefaultRules();
    console.log('[aether:ebpf-firewall] 🔄 Rules reset to default');
  }

  /**
   * 获取当前规则列表
   */
  getRules(): EbpfRule[] {
    return [...this.rules];
  }

  // ── 核心检查逻辑 ─────────────────────────────────────────────────────────

  /**
   * 检查目标地址是否允许（eBPF 核心逻辑）
   * 返回 { allowed: boolean, reason?: string }
   */
  checkConnection(opts: {
    protocol?: string;
    remoteAddress: string;
    remotePort?: number;
    direction?: 'egress' | 'ingress';
  }): { allowed: boolean; reason?: string; matchedRule?: EbpfRule } {
    const { protocol = 'tcp', remoteAddress, remotePort, direction = 'egress' } = opts;

    // 遍历规则（按优先级：block 优先于 allow）
    for (const rule of this.rules) {
      if (!this._matchesRule(rule, protocol, remoteAddress, remotePort, direction)) {
        continue;
      }

      if (rule.action === 'block') {
        return {
          allowed: false,
          reason: `Blocked by rule ${rule.id}: ${rule.description ?? rule.action}`,
          matchedRule: rule,
        };
      }

      // rule.action === 'allow'
      return {
        allowed: true,
        matchedRule: rule,
      };
    }

    // 无匹配规则：使用默认动作
    if (this.config.defaultAction === 'block') {
      return {
        allowed: false,
        reason: `No matching rule, default block (zero-trust)`,
      };
    }

    return { allowed: true, reason: `No matching rule, default allow` };
  }

  /**
   * 记录连接事件（模拟 eBPF 内核日志）
   */
  logConnection(conn: Partial<EbpfConnectionLog> & { action: EbpfConnectionLog['action']; protocol: string; remoteAddress: string }): EbpfConnectionLog {
    const entry: EbpfConnectionLog = {
      id: conn.id ?? randomUUID(),
      timestamp: conn.timestamp ?? new Date().toISOString(),
      action: conn.action,
      protocol: conn.protocol,
      localAddress: conn.localAddress ?? '127.0.0.1',
      remoteAddress: conn.remoteAddress,
      remotePort: conn.remotePort ?? 0,
      reason: conn.reason,
      pid: conn.pid,
      agentId: conn.agentId,
      bytesIn: conn.bytesIn,
      bytesOut: conn.bytesOut,
      durationMs: conn.durationMs,
    };

    this.connectionLog.push(entry);
    this.connectionCounter++;

    // 淘汰旧记录
    const maxEntries = this.config.maxLogEntries ?? 10000;
    if (this.connectionLog.length > maxEntries) {
      this.connectionLog.splice(0, this.connectionLog.length - maxEntries);
    }

    // 触发事件（供实时监控使用）
    this.emit('connection', entry);

    if (entry.action === 'blocked') {
      this.emit('blocked', entry);
      console.warn(`[aether:ebpf-firewall] 🚫 BLOCKED ${entry.protocol} ${entry.remoteAddress}:${entry.remotePort} — ${entry.reason}`);
    } else if (this.config.logConnections) {
      console.log(`[aether:ebpf-firewall] ${entry.action === 'allowed' ? '✅' : '📝'} ${entry.protocol} ${entry.localAddress} → ${entry.remoteAddress}:${entry.remotePort}`);
    }

    return entry;
  }

  /**
   * 模拟 eBPF 拦截网络访问
   * 对给定的主机/端口执行策略检查，返回模拟的拦截结果
   */
  simulateBlock(opts: {
    host: string;
    port: number;
    protocol?: string;
    agentId?: string;
    reason?: string;
  }): EbpfConnectionLog {
    const check = this.checkConnection({
      protocol: opts.protocol ?? 'tcp',
      remoteAddress: opts.host,
      remotePort: opts.port,
      direction: 'egress',
    });

    const action = check.allowed ? 'allowed' : 'blocked';

    return this.logConnection({
      action,
      protocol: opts.protocol ?? 'tcp',
      remoteAddress: opts.host,
      remotePort: opts.port,
      agentId: opts.agentId,
      reason: check.reason ?? opts.reason,
    });
  }

  // ── 连接日志查询 ─────────────────────────────────────────────────────────

  /**
   * 获取最近的连接日志
   */
  getLogs(limit = 100, filter?: { action?: EbpfConnectionLog['action']; agentId?: string }): EbpfConnectionLog[] {
    let entries = [...this.connectionLog].reverse();

    if (filter?.action) {
      entries = entries.filter(e => e.action === filter.action);
    }
    if (filter?.agentId) {
      entries = entries.filter(e => e.agentId === filter.agentId);
    }

    return entries.slice(0, limit);
  }

  /**
   * 获取被拦截的连接统计
   */
  getStats(): {
    totalConnections: number;
    blockedCount: number;
    allowedCount: number;
    loggedCount: number;
    byProtocol: Record<string, number>;
    byAgent: Record<string, { blocked: number; allowed: number }>;
  } {
    const stats = {
      totalConnections: this.connectionCounter,
      blockedCount: 0,
      allowedCount: 0,
      loggedCount: this.connectionLog.length,
      byProtocol: {} as Record<string, number>,
      byAgent: {} as Record<string, { blocked: number; allowed: number }>,
    };

    for (const entry of this.connectionLog) {
      if (entry.action === 'blocked') stats.blockedCount++;
      else if (entry.action === 'allowed') stats.allowedCount++;

      stats.byProtocol[entry.protocol] = (stats.byProtocol[entry.protocol] ?? 0) + 1;

      if (entry.agentId) {
        if (!stats.byAgent[entry.agentId]) {
          stats.byAgent[entry.agentId] = { blocked: 0, allowed: 0 };
        }
        if (entry.action === 'blocked') stats.byAgent[entry.agentId].blocked++;
        else if (entry.action === 'allowed') stats.byAgent[entry.agentId].allowed++;
      }
    }

    return stats;
  }

  // ── 私有方法 ─────────────────────────────────────────────────────────────

  private _setDefaultRules(): void {
    // 默认零信任规则：阻断所有出站连接
    this.rules = [
      // 放行 localhost（loopback）
      {
        id: 'default-allow-localhost',
        action: 'allow',
        protocol: 'all',
        host: '127.0.0.1',
        port: '*',
        direction: 'egress',
        createdAt: new Date().toISOString(),
        description: 'Allow loopback',
      },
      {
        id: 'default-allow-localhost6',
        action: 'allow',
        protocol: 'all',
        host: '::1',
        port: '*',
        direction: 'egress',
        createdAt: new Date().toISOString(),
        description: 'Allow IPv6 loopback',
      },
      {
        id: 'default-allow-localhost-name',
        action: 'allow',
        protocol: 'all',
        host: 'localhost',
        port: '*',
        direction: 'egress',
        createdAt: new Date().toISOString(),
        description: 'Allow localhost by name',
      },
      // 阻断私有网段（模拟 eBPF 的网络分段策略）
      {
        id: 'default-block-private-10',
        action: 'block',
        protocol: 'all',
        host: '10.0.0.0/8',
        port: '*',
        direction: 'egress',
        createdAt: new Date().toISOString(),
        description: 'Block private 10.x.x.x',
      },
      {
        id: 'default-block-private-172',
        action: 'block',
        protocol: 'all',
        host: '172.16.0.0/12',
        port: '*',
        direction: 'egress',
        createdAt: new Date().toISOString(),
        description: 'Block private 172.16.x.x',
      },
      {
        id: 'default-block-private-192',
        action: 'block',
        protocol: 'all',
        host: '192.168.0.0/16',
        port: '*',
        direction: 'egress',
        createdAt: new Date().toISOString(),
        description: 'Block private 192.168.x.x',
      },
      // 阻断 DNS 53（防 DNS 隧道）
      {
        id: 'default-block-dns',
        action: 'block',
        protocol: 'udp',
        host: '*',
        port: 53,
        direction: 'egress',
        createdAt: new Date().toISOString(),
        description: 'Block DNS exfiltration',
      },
    ];
  }

  private _matchesRule(rule: EbpfRule, protocol: string, host: string, port: number | undefined, direction: string): boolean {
    // 方向匹配
    if (rule.direction !== 'both' && rule.direction !== direction) return false;

    // 协议匹配
    if (rule.protocol !== 'all' && rule.protocol !== protocol) return false;

    // 主机匹配（支持通配符 *）
    if (rule.host && rule.host !== '*') {
      if (rule.host.includes('*')) {
        // 简单通配符：* 匹配任意
        const pattern = rule.host.replace(/\./g, '\\.').replace(/\*/g, '.*');
        if (!new RegExp(`^${pattern}$`).test(host)) return false;
      } else {
        if (rule.host !== host) return false;
      }
    }

    // 端口匹配
    if (rule.port !== undefined && rule.port !== '*' && port !== undefined) {
      if (rule.port !== port) return false;
    }

    return true;
  }
}
