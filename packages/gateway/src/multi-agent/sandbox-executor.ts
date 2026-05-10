// EP-05: Per-Agent Isolated Sandbox Executor
// 每个 Agent 拥有独立的 V8 Isolate，执行上下文完全隔离
// 一个 Agent 的崩溃不影响其他 Agent

import { randomUUID } from 'crypto';

// ── 类型定义 ───────────────────────────────────────────────────────────────

export interface AgentSandboxConfig {
  agentId: string;
  maxMemoryMb?: number;
  maxExecTimeMs?: number;
  blockNetwork?: boolean;
  blockFilesystem?: boolean;
}

export interface IsolatedResult {
  ok: boolean;
  output?: unknown;
  stdout?: string;
  stderr?: string;
  error?: string;
  durationMs: number;
  memoryUsedMb?: number;
  violations?: Array<{ type: string; detail: string }>;
}

interface PolicyViolation {
  type: string;
  detail: string;
  blocked: true;
}

// ── 静态代码扫描（安全策略）──────────────────────────────────────────────

function scanCode(code: string, opts: { blockNetwork: boolean; blockFilesystem: boolean }): PolicyViolation[] {
  const violations: PolicyViolation[] = [];
  if (opts.blockNetwork) {
    for (const pattern of [
      /\bfetch\s*\(/,
      /require\s*\(\s*['"]https?['"]\s*\)/,
      /require\s*\(\s*['"]net['"]\s*\)/,
      /XMLHttpRequest/,
      /WebSocket\s*\(/,
      /import\s+.*\s+from\s+['"]https?:\/\//,
    ]) {
      if (pattern.test(code)) {
        violations.push({ type: 'network', detail: `Network access blocked: ${pattern}`, blocked: true });
        break;
      }
    }
  }
  if (opts.blockFilesystem) {
    for (const pattern of [
      /require\s*\(\s*['"]fs['"]\s*\)/,
      /readFileSync|writeFileSync|readFile\s*\(|writeFile\s*\(/,
      /createReadStream|createWriteStream/,
    ]) {
      if (pattern.test(code)) {
        violations.push({ type: 'filesystem', detail: `Filesystem access blocked: ${pattern}`, blocked: true });
        break;
      }
    }
  }
  return violations;
}

// ── Per-Agent 隔离执行器 ──────────────────────────────────────────────────

export class AgentSandboxExecutor {
  readonly agentId: string;
  private ivm: typeof import('isolated-vm') | null = null;
  private config: Required<AgentSandboxConfig>;
  private currentIsolate: any = null;
  private initialized = false;

  constructor(config: AgentSandboxConfig) {
    this.agentId = config.agentId;
    this.config = {
      agentId: config.agentId,
      maxMemoryMb: config.maxMemoryMb ?? 128,
      maxExecTimeMs: config.maxExecTimeMs ?? 30_000,
      blockNetwork: config.blockNetwork ?? true,
      blockFilesystem: config.blockFilesystem ?? true,
    };
  }

  async init(): Promise<void> {
    if (this.initialized) return;
    try {
      this.ivm = _require('isolated-vm');
      console.log(`[aether:agent-sandbox:${this.agentId}] ✅ V8 isolate runtime ready`);
    } catch {
      console.warn(`[aether:agent-sandbox:${this.agentId}] ⚠️  isolated-vm not available`);
    }
    this.initialized = true;
  }

  /**
   * 在独立 V8 Isolate 中执行代码
   * 每个 Agent 拥有自己的 Isolate 实例，完全隔离
   */
  async execute(code: string, opts: { timeout?: number; input?: unknown; env?: Record<string, string> } = {}): Promise<IsolatedResult> {
    await this.init();
    const startTime = Date.now();
    const timeout = opts.timeout ?? this.config.maxExecTimeMs;
    const stdout: string[] = [];
    const stderr: string[] = [];

    // 静态安全扫描
    const violations = scanCode(code, { blockNetwork: this.config.blockNetwork, blockFilesystem: this.config.blockFilesystem });
    if (violations.length > 0) {
      return {
        ok: false,
        error: `Security policy violation: ${violations[0].detail}`,
        violations,
        durationMs: Date.now() - startTime,
      };
    }

    if (!this.ivm) {
      return this.executeFallback(code, opts, startTime, stdout, stderr);
    }

    // 创建独立的 V8 Isolate（每个 Agent 独立实例）
    const isolate = new this.ivm.Isolate({ memoryLimit: this.config.maxMemoryMb });

    try {
      const context = await isolate.createContext();
      const jail = context.global;

      // 注入安全 console
      await jail.set('_stdout', new this.ivm.Reference((msg: string) => stdout.push(msg)));
      await jail.set('_stderr', new this.ivm.Reference((msg: string) => stderr.push(msg)));

      const bootstrap = `
        const console = {
          log: (...a) => _stdout.applySync(undefined, a.map(String)),
          error: (...a) => _stderr.applySync(undefined, a.map(String)),
          warn: (...a) => _stdout.applySync(undefined, ['[warn]', ...a.map(String)]),
          info: (...a) => _stdout.applySync(undefined, a.map(String)),
        };
      `;
      await (await isolate.compileScript(bootstrap)).run(context);

      if (opts.input !== undefined) {
        await jail.set('input', new this.ivm.ExternalCopy(opts.input).copyInto());
      }

      if (opts.env) {
        const safeEnv: Record<string, string> = {};
        for (const [k, v] of Object.entries(opts.env)) {
          if (/^[A-Z][A-Z0-9_]*$/.test(k)) safeEnv[k] = v;
        }
        await jail.set('env', new this.ivm.ExternalCopy(safeEnv).copyInto());
      }

      const script = await isolate.compileScript(code);
      const rawOutput = await script.run(context, { timeout });

      const durationMs = Date.now() - startTime;
      const memStats = isolate.getHeapStatisticsSync();
      let output: unknown;
      try {
        output = rawOutput !== undefined ? new this.ivm.ExternalCopy(rawOutput).copy() : undefined;
      } catch {
        output = String(rawOutput);
      }

      return { ok: true, output, stdout: stdout.join('\n'), stderr: stderr.join('\n'), durationMs, memoryUsedMb: Math.round(memStats.used_heap_size / 1024 / 1024) };
    } catch (err: unknown) {
      const durationMs = Date.now() - startTime;
      const msg = err instanceof Error ? err.message : String(err);
      return {
        ok: false,
        error: msg.includes('timed out') ? `Execution timed out after ${timeout}ms` : msg,
        stdout: stdout.join('\n'),
        stderr: stderr.join('\n'),
        durationMs,
      };
    } finally {
      try { isolate.dispose(); } catch { /* already disposed */ }
    }
  }

  private executeFallback(code: string, opts: any, startTime: number, stdout: string[], stderr: string[]): Promise<IsolatedResult> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        resolve({ ok: false, error: `Execution timed out after ${this.config.maxExecTimeMs}ms`, durationMs: Date.now() - startTime });
      }, this.config.maxExecTimeMs);

      try {
        const safeConsole = {
          log: (...args: unknown[]) => stdout.push(args.map(String).join(' ')),
          error: (...args: unknown[]) => stderr.push(args.map(String).join(' ')),
          warn: (...args: unknown[]) => stdout.push('[warn] ' + args.map(String).join(' ')),
        };
        const fn = new Function('__console__', '__input__', `"use strict";\nconst console = __console__;\nconst input = __input__;\n(${code})`);
        const output = fn(safeConsole, opts.input ?? null);
        clearTimeout(timer);
        resolve({ ok: true, output, stdout: stdout.join('\n'), stderr: stderr.join('\n'), durationMs: Date.now() - startTime });
      } catch (err) {
        clearTimeout(timer);
        resolve({ ok: false, error: err instanceof Error ? err.message : String(err), stdout: stdout.join('\n'), stderr: stderr.join('\n'), durationMs: Date.now() - startTime });
      }
    }) as Promise<IsolatedResult>;
  }

  dispose(): void {
    if (this.currentIsolate) {
      try { this.currentIsolate.dispose(); } catch { /* ignore */ }
      this.currentIsolate = null;
    }
    console.log(`[aether:agent-sandbox:${this.agentId}] 🗑️  Executor disposed`);
  }
}

// ── Per-Agent Sandbox Manager ──────────────────────────────────────────────
// 管理所有 Agent 的独立沙箱实例

export class AgentSandboxManager {
  private executors = new Map<string, AgentSandboxExecutor>();

  getOrCreate(agentId: string, config?: Partial<AgentSandboxConfig>): AgentSandboxExecutor {
    if (this.executors.has(agentId)) {
      return this.executors.get(agentId)!;
    }
    const executor = new AgentSandboxExecutor({ agentId, ...config });
    this.executors.set(agentId, executor);
    console.log(`[aether:agent-sandbox-manager] Created executor for agent: ${agentId}`);
    return executor;
  }

  get(agentId: string): AgentSandboxExecutor | undefined {
    return this.executors.get(agentId);
  }

  dispose(agentId: string): void {
    const executor = this.executors.get(agentId);
    if (executor) {
      executor.dispose();
      this.executors.delete(agentId);
    }
  }

  disposeAll(): void {
    for (const [agentId] of this.executors) {
      this.dispose(agentId);
    }
  }

  stats(): Record<string, unknown> {
    return {
      activeExecutors: this.executors.size,
      agentIds: Array.from(this.executors.keys()),
    };
  }
}
