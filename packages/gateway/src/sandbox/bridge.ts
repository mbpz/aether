// SandboxBridge - Gateway → Sandbox 桥接层
// 在 Gateway 进程内直接调用 Sandbox 执行引擎（进程内调用，零网络开销）

import { TaskQueue, SandboxTask } from './task-queue.js';
import { AuditLogger } from '../audit/logger.js';
import { ManifestEngine, ManifestValidationResult } from '../manifest/engine.js';
import { EbpfFirewall } from '@aether/sandbox';

// ── 内联 Sandbox 核心逻辑（避免跨包 ESM 路径问题）──────────────────────────

interface PolicyConfig {
  blockNetwork: boolean;
  blockFilesystem: boolean;
  blockProcessSpawn: boolean;
  maxExecTimeMs: number;
  maxMemoryMb: number;
}

interface PolicyViolation {
  type: string;
  detail: string;
  blocked: true;
}

class SecurityPolicy {
  constructor(readonly config: PolicyConfig) {}

  scanCode(code: string): PolicyViolation[] {
    const violations: PolicyViolation[] = [];

    if (this.config.blockNetwork) {
      const networkPatterns = [
        /require\s*\(\s*['"]https?['"]\s*\)/,
        /require\s*\(\s*['"]net['"]\s*\)/,
        /\bfetch\s*\(/,
        /XMLHttpRequest/,
        /WebSocket\s*\(/,
        /import\s+.*\s+from\s+['"]https?:\/\//,
      ];
      for (const pattern of networkPatterns) {
        if (pattern.test(code)) {
          violations.push({ type: 'network', detail: `Network access blocked: ${pattern}`, blocked: true });
          break;
        }
      }
    }

    if (this.config.blockFilesystem) {
      const fsPatterns = [
        /require\s*\(\s*['"]fs['"]\s*\)/,
        /readFileSync|writeFileSync|readFile\s*\(|writeFile\s*\(/,
        /createReadStream|createWriteStream/,
      ];
      for (const pattern of fsPatterns) {
        if (pattern.test(code)) {
          violations.push({ type: 'filesystem', detail: `Filesystem access blocked: ${pattern}`, blocked: true });
          break;
        }
      }
    }

    if (this.config.blockProcessSpawn) {
      const processPatterns = [
        /child_process/,
        /\bspawn\s*\(/,
        /\bexecSync\s*\(/,
        /process\.exit/,
        /process\.env/,
      ];
      for (const pattern of processPatterns) {
        if (pattern.test(code)) {
          violations.push({ type: 'process', detail: `Process operation blocked: ${pattern}`, blocked: true });
          break;
        }
      }
    }

    return violations;
  }

  summary() {
    return this.config;
  }
}

interface ExecResult {
  ok: boolean;
  output?: unknown;
  stdout?: string;
  stderr?: string;
  error?: string;
  durationMs: number;
  memoryUsedMb?: number;
  violations?: PolicyViolation[];
}

// ── isolated-vm 加载（使用 require 兼容原生 C++ 模块）───────────────────────
// 加载失败 → fail-closed：runInSandbox() 直接拒绝执行，绝不降级到 new Function。
let _ivm: typeof import('isolated-vm') | null = null;
let _ivmLoadError: string | null = null;

// Export SecurityPolicy for testing purposes
export { SecurityPolicy };
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  _ivm = require('isolated-vm');
  console.log('[aether:sandbox-bridge] ✅ isolated-vm loaded (V8 Isolate mode)');
} catch (err) {
  _ivmLoadError = err instanceof Error ? err.message : String(err);
  console.warn(
    '[aether:sandbox-bridge] ⚠️  isolated-vm not available — sandbox will REFUSE ' +
    'to execute code (no fallback). Install the native binding to enable execution. ' +
    `Reason: ${_ivmLoadError}`,
  );
}

/** Test hook：清掉缓存的 ivm 引用以模拟"未加载"状态。仅用于单测。 */
export function __unsafeResetIvmForTesting(): void {
  _ivm = null;
  _ivmLoadError = 'forced unload (test)';
}

async function runInSandbox(
  code: string,
  opts: { timeout: number; input?: unknown; env?: Record<string, string> }
): Promise<ExecResult> {
  const startTime = Date.now();
  const stdout: string[] = [];
  const stderr: string[] = [];

  // ── 模式1：isolated-vm V8 隔离沙箱 ──────────────────────────────────────
  if (_ivm) {
    try {
      const ivm = _ivm;
      const isolate = new ivm.Isolate({ memoryLimit: 128 });
      const context = await isolate.createContext();
      const jail = context.global;

      // 注入安全 console（通过 Reference 跨隔离区传递）
      await jail.set('_stdout', new ivm.Reference((msg: string) => stdout.push(msg)));
      await jail.set('_stderr', new ivm.Reference((msg: string) => stderr.push(msg)));

      const bootstrap = `
        const console = {
          log: (...a) => _stdout.applySync(undefined, a.map(String)),
          error: (...a) => _stderr.applySync(undefined, a.map(String)),
          warn: (...a) => _stdout.applySync(undefined, ['[warn]', ...a.map(String)]),
          info: (...a) => _stdout.applySync(undefined, a.map(String)),
        };
      `;
      await isolate.compileScript(bootstrap).then(s => s.run(context));

      if (opts.input !== undefined) {
        await jail.set('input', new ivm.ExternalCopy(opts.input).copyInto());
      }

      if (opts.env) {
        const safeEnv: Record<string, string> = {};
        for (const [k, v] of Object.entries(opts.env)) {
          if (/^[A-Z][A-Z0-9_]*$/.test(k)) safeEnv[k] = v;
        }
        await jail.set('env', new ivm.ExternalCopy(safeEnv).copyInto());
      }

      const script = await isolate.compileScript(code);
      const rawOutput = await script.run(context, { timeout: opts.timeout });

      const durationMs = Date.now() - startTime;
      const memStats = isolate.getHeapStatisticsSync();
      const memoryUsedMb = Math.round(memStats.used_heap_size / 1024 / 1024);
      isolate.dispose();

      let output: unknown;
      try {
        output = rawOutput !== undefined ? new ivm.ExternalCopy(rawOutput).copy() : undefined;
      } catch {
        output = String(rawOutput);
      }

      return { ok: true, output, stdout: stdout.join('\n'), stderr: stderr.join('\n'), durationMs, memoryUsedMb };
    } catch (ivmErr: unknown) {
      const durationMs = Date.now() - startTime;
      const msg = ivmErr instanceof Error ? ivmErr.message : String(ivmErr);
      const isTimeout = msg.includes('timed out') || msg.includes('Script execution timed out');
      return {
        ok: false,
        error: isTimeout ? `Execution timed out after ${opts.timeout}ms` : msg,
        stdout: stdout.join('\n'),
        stderr: stderr.join('\n'),
        durationMs,
      };
    }
  }

  // ── 模式2：fallback 被禁用 ─────────────────────────────────────────────
  // isolated-vm 加载失败时拒绝执行任意代码，避免使用 `new Function` 之类的
  // 主机级 JS 求值路径绕过沙箱。调用方应安装 isolated-vm 原生绑定。
  return {
    ok: false,
    error:
      'isolated-vm runtime is not available; refusing to execute code in an ' +
      'unsafe fallback. Install the optional isolated-vm native binding ' +
      `before running agent code.${_ivmLoadError ? ` (load error: ${_ivmLoadError})` : ''}`,
    durationMs: Date.now() - startTime,
  };
}


// ── SandboxBridge 主类 ─────────────────────────────────────────────────────

export class SandboxBridge {
  private policy: SecurityPolicy;
  private queue: TaskQueue;
  private audit: AuditLogger;
  private manifest: ManifestEngine | null;
  private firewall: EbpfFirewall | null;
  private running = false;
  private workerBusy = false;

  constructor(queue: TaskQueue, audit: AuditLogger, manifest?: ManifestEngine, firewall?: EbpfFirewall) {
    this.queue = queue;
    this.audit = audit;
    this.manifest = manifest ?? null;
    this.firewall = firewall ?? null;
    this.policy = new SecurityPolicy({
      blockNetwork: true,
      blockFilesystem: true,
      blockProcessSpawn: true,
      maxExecTimeMs: 30_000,
      maxMemoryMb: 128,
    });

    // 监听新任务自动处理
    this.queue.on('enqueue', (task: SandboxTask) => {
      if (!this.workerBusy) this._processNext(task.id);
    });
  }

  /**
   * 提交代码到沙箱执行（异步，立即返回 taskId）
   */
  submit(opts: {
    id: string;
    code: string;
    operation: string;
    input?: unknown;
    env?: Record<string, string>;
    injectedSecrets: string[];
    manifestName?: string;
    source: string;
  }): SandboxTask {
    return this.queue.enqueue({
      id: opts.id,
      operation: opts.operation,
      code: opts.code,
      input: opts.input,
      injectedSecrets: opts.injectedSecrets,
      manifestName: opts.manifestName,
      source: opts.source,
    });
  }

  /**
   * 同步执行（等待结果，最长 30s）
   */
  async executeSync(opts: {
    id: string;
    code: string;
    operation: string;
    input?: unknown;
    env?: Record<string, string>;
    injectedSecrets: string[];
    manifestName?: string;
    source: string;
    timeout?: number;
  }): Promise<SandboxTask> {
    const task = this.submit(opts);

    // 等待完成
    return new Promise<SandboxTask>((resolve) => {
      const check = () => {
        const t = this.queue.get(opts.id);
        if (t && ['done', 'failed', 'rejected'].includes(t.status)) {
          resolve(t);
        } else {
          setTimeout(check, 50);
        }
      };
      setTimeout(check, 50);

      // 最长等待 35s
      setTimeout(() => {
        const t = this.queue.get(opts.id);
        if (t) {
          if (!['done', 'failed', 'rejected'].includes(t.status)) {
            this.queue.markDone(opts.id, { ok: false, error: 'Gateway timeout waiting for sandbox result' });
          }
          resolve(this.queue.get(opts.id)!);
        }
      }, 35_000);
    });
  }

  private async _processNext(taskId: string) {
    this.workerBusy = true;
    const task = this.queue.get(taskId);
    if (!task || task.status !== 'queued') {
      this.workerBusy = false;
      return;
    }

    this.queue.markRunning(taskId);

    this.audit.log({
      action: 'sandbox_exec_start',
      category: 'agent_execution',
      actor: { type: 'agent', id: task.source },
      outcome: 'success',
      detail: `Task ${taskId} running (op=${task.operation})`,
      metadata: { taskId, operation: task.operation },
    });

    try {
      // 1. 静态扫描 + eBPF 防火墙检查
      if (task.code) {
        const violations = this.policy.scanCode(task.code);

        // eBPF 防火墙检查：提取并验证所有网络目标
        if (this.firewall && violations.some(v => v.type === 'network')) {
          const networkTargets = this._extractNetworkTargets(task.code);
          for (const target of networkTargets) {
            const check = this.firewall.checkConnection({
              protocol: target.protocol,
              remoteAddress: target.host,
              remotePort: target.port,
              direction: 'egress',
            });

            // 记录到防火墙日志
            this.firewall.logConnection({
              action: check.allowed ? 'allowed' : 'blocked',
              protocol: target.protocol,
              remoteAddress: target.host,
              remotePort: target.port,
              agentId: task.source,
              reason: check.reason,
            });

            // 如果防火墙阻止，直接拒绝执行
            if (!check.allowed) {
              this.queue.markDone(taskId, {
                ok: false,
                error: `eBPF firewall blocked: ${check.reason}`,
                violations,
                durationMs: 0,
              });
              this.audit.log({
                action: 'sandbox_ebpf_blocked',
                category: 'security',
                actor: { type: 'agent', id: task.source },
                outcome: 'failure',
                detail: `Task ${taskId} eBPF blocked ${target.protocol} ${target.host}:${target.port} — ${check.reason}`,
                metadata: { taskId, target, matchedRule: check.matchedRule?.id },
              });
              this.workerBusy = false;
              return;
            }

            // 允许的也记录到审计日志
            this.audit.log({
              action: 'sandbox_ebpf_allowed',
              category: 'security',
              actor: { type: 'agent', id: task.source },
              outcome: 'success',
              detail: `Task ${taskId} eBPF allowed ${target.protocol} ${target.host}:${target.port}`,
              metadata: { taskId, target },
            });
          }
        }

        if (violations.length > 0) {
          this.queue.markDone(taskId, {
            ok: false,
            error: `Security policy violation: ${violations[0].detail}`,
            violations,
            durationMs: 0,
          });
          this.audit.log({
            action: 'sandbox_policy_violation',
            category: 'security',
            actor: { type: 'agent', id: task.source },
            outcome: 'failure',
            detail: violations[0].detail,
            metadata: { taskId, violations },
          });
          this.workerBusy = false;
          return;
        }
      }

      // 2. Manifest 验证（安全门：确保操作被 Manifest 授权，才能使用注入的凭证）
      if (this.manifest && task.manifestName) {
        const validation = this.manifest.validate({
          operation: task.operation,
          manifestName: task.manifestName,
        });
        if (!validation.allowed) {
          this.queue.markDone(taskId, {
            ok: false,
            error: `Manifest rejected operation: ${validation.reason}`,
            durationMs: 0,
          });
          this.audit.log({
            action: 'sandbox_manifest_rejected',
            category: 'authorization',
            actor: { type: 'agent', id: task.source },
            outcome: 'failure',
            detail: `Task ${taskId} manifest validation failed: ${validation.reason}`,
            metadata: { taskId, operation: task.operation, manifestName: task.manifestName },
          });
          this.workerBusy = false;
          return;
        }
      }

      // 3. 执行
      if (task.operation === 'exec' && task.code) {
        const result = await runInSandbox(task.code, {
          timeout: 30_000,
          input: task.input,
        });

        this.queue.markDone(taskId, result);
        this.audit.log({
          action: 'sandbox_exec_done',
          category: 'agent_execution',
          actor: { type: 'agent', id: task.source },
          outcome: result.ok ? 'success' : 'failure',
          detail: `Task ${taskId} ${result.ok ? 'succeeded' : 'failed'} in ${result.durationMs}ms`,
          metadata: { taskId, durationMs: result.durationMs, memoryUsedMb: result.memoryUsedMb },
        });
      } else if (task.operation === 'read') {
        // read 操作：安全返回成功（实际读取由 Manifest 控制）
        this.queue.markDone(taskId, {
          ok: true,
          output: { message: `Read operation for target acknowledged`, operation: task.operation },
          durationMs: 1,
        });
      } else {
        this.queue.markDone(taskId, {
          ok: false,
          error: `Unsupported operation: ${task.operation}`,
          durationMs: 0,
        });
      }
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      this.queue.markDone(taskId, { ok: false, error, durationMs: 0 });
      this.audit.log({
        action: 'sandbox_exec_error',
        category: 'agent_execution',
        actor: { type: 'agent', id: task.source },
        outcome: 'failure',
        detail: `Task ${taskId} error: ${error}`,
      });
    }

    this.workerBusy = false;

    // 处理队列中下一个等待的任务
    const next = Array.from(this.queue.list(10)).find(t => t.status === 'queued');
    if (next) this._processNext(next.id);
  }

  policyStats() {
    return this.policy.summary();
  }

  /**
   * 从代码中提取网络访问目标（供 eBPF 防火墙检查使用）
   */
  private _extractNetworkTargets(code: string): Array<{ protocol: string; host: string; port?: number }> {
    const targets: Array<{ protocol: string; host: string; port?: number }> = [];

    // 提取 require('http') / require('https')
    const httpRequire = /require\s*\(\s*['"](https?)['"]\s*\)/g;
    let match;
    while ((match = httpRequire.exec(code)) !== null) {
      targets.push({ protocol: 'tcp', host: '*', port: match[1] === 'https' ? 443 : 80 });
    }

    // 提取 fetch() URL
    const fetchRe = /\bfetch\s*\(\s*['"]([^'"]+)['"]/g;
    while ((match = fetchRe.exec(code)) !== null) {
      try {
        const url = new URL(match[1]);
        targets.push({
          protocol: url.protocol === 'https:' ? 'tcp' : 'tcp',
          host: url.hostname,
          port: url.port ? parseInt(url.port) : (url.protocol === 'https:' ? 443 : 80),
        });
      } catch {
        targets.push({ protocol: 'tcp', host: match[1] });
      }
    }

    // 提取 import from 'https://...'
    const importRe = /import\s+.*\s+from\s+['"](https?:\/\/[^'"]+)['"]/g;
    while ((match = importRe.exec(code)) !== null) {
      try {
        const url = new URL(match[1]);
        targets.push({
          protocol: 'tcp',
          host: url.hostname,
          port: url.port ? parseInt(url.port) : (url.protocol === 'https:' ? 443 : 80),
        });
      } catch {
        // ignore
      }
    }

    // 提取 WebSocket URL
    const wsRe = /new\s+WebSocket\s*\(\s*['"]([^'"]+)['"]/g;
    while ((match = wsRe.exec(code)) !== null) {
      try {
        const url = new URL(match[1]);
        targets.push({ protocol: 'tcp', host: url.hostname, port: url.port ? parseInt(url.port) : (url.protocol === 'wss:' ? 443 : 80) });
      } catch {
        targets.push({ protocol: 'tcp', host: match[1] });
      }
    }

    return targets;
  }
}
