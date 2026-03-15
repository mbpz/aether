// SandboxBridge - Gateway → Sandbox 桥接层
// 在 Gateway 进程内直接调用 Sandbox 执行引擎（进程内调用，零网络开销）

import { TaskQueue, SandboxTask } from './task-queue.js';
import { AuditLogger } from '../audit/logger.js';

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

// ── isolated-vm 加载（使用 createRequire 兼容原生 C++ 模块）──────────────
import { createRequire } from 'module';
const _require = createRequire(import.meta.url);
let _ivm: typeof import('isolated-vm') | null = null;
try {
  _ivm = _require('isolated-vm');
  console.log('[aether:sandbox-bridge] ✅ isolated-vm loaded (V8 Isolate mode)');
} catch {
  console.warn('[aether:sandbox-bridge] ⚠️  isolated-vm not available, using safe-eval fallback');
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

  // ── 模式2：safe-eval 降级模式 ────────────────────────────────────────────
  return runSafeEval(code, opts, startTime, stdout, stderr);
}

function runSafeEval(
  code: string,
  opts: { timeout: number; input?: unknown },
  startTime: number,
  stdout: string[],
  stderr: string[]
): Promise<ExecResult> {
  return new Promise(resolve => {
    const timer = setTimeout(() => {
      resolve({ ok: false, error: `Execution timed out after ${opts.timeout}ms`, durationMs: Date.now() - startTime });
    }, opts.timeout);

    try {
      const safeConsole = {
        log: (...args: unknown[]) => stdout.push(args.map(String).join(' ')),
        error: (...args: unknown[]) => stderr.push(args.map(String).join(' ')),
        warn: (...args: unknown[]) => stdout.push('[warn] ' + args.map(String).join(' ')),
        info: (...args: unknown[]) => stdout.push(args.map(String).join(' ')),
      };

      const wrappedCode = `
        "use strict";
        const console = __console__;
        const input = __input__;
        (function() { ${code} })();
      `;

      // eslint-disable-next-line no-new-func
      const fn = new Function('__console__', '__input__', wrappedCode);
      const output = fn(safeConsole, opts.input ?? null);

      clearTimeout(timer);
      resolve({ ok: true, output, stdout: stdout.join('\n'), stderr: stderr.join('\n'), durationMs: Date.now() - startTime });
    } catch (err) {
      clearTimeout(timer);
      resolve({ ok: false, error: err instanceof Error ? err.message : String(err), stdout: stdout.join('\n'), stderr: stderr.join('\n'), durationMs: Date.now() - startTime });
    }
  });
}

// ── SandboxBridge 主类 ─────────────────────────────────────────────────────

export class SandboxBridge {
  private policy: SecurityPolicy;
  private queue: TaskQueue;
  private audit: AuditLogger;
  private running = false;
  private workerBusy = false;

  constructor(queue: TaskQueue, audit: AuditLogger) {
    this.queue = queue;
    this.audit = audit;
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
      source: task.source,
      ok: true,
      detail: `Task ${taskId} running (op=${task.operation})`,
      metadata: { taskId, operation: task.operation },
    });

    try {
      // 1. 静态扫描
      if (task.code) {
        const violations = this.policy.scanCode(task.code);
        if (violations.length > 0) {
          this.queue.markDone(taskId, {
            ok: false,
            error: `Security policy violation: ${violations[0].detail}`,
            violations,
            durationMs: 0,
          });
          this.audit.log({
            action: 'sandbox_policy_violation',
            source: task.source,
            ok: false,
            detail: violations[0].detail,
            metadata: { taskId, violations },
          });
          this.workerBusy = false;
          return;
        }
      }

      // 2. 执行
      if (task.operation === 'exec' && task.code) {
        const result = await runInSandbox(task.code, {
          timeout: 30_000,
          input: task.input,
        });

        this.queue.markDone(taskId, result);
        this.audit.log({
          action: 'sandbox_exec_done',
          source: task.source,
          ok: result.ok,
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
        source: task.source,
        ok: false,
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
}
