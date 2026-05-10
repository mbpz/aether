// Sandbox Runtime - 隔离执行引擎
// 使用 isolated-vm 提供 V8 隔离沙箱（类 WASM 隔离语义）

import { randomUUID } from 'crypto';
import { SecurityPolicy, PolicyViolation } from '../security/policy.js';

export interface ExecutionRequest {
  id?: string;
  code: string;
  language?: 'javascript' | 'typescript';
  timeout?: number;          // 覆盖默认超时
  env?: Record<string, string>; // 注入的环境变量（来自 Vault）
  input?: unknown;           // 输入数据
}

export interface ExecutionResult {
  id: string;
  ok: boolean;
  output?: unknown;
  stdout?: string;
  stderr?: string;
  error?: string;
  violations?: PolicyViolation[];
  durationMs: number;
  memoryUsedMb?: number;
  exitedAt: string;
}

export class SandboxRuntime {
  private policy: SecurityPolicy;
  private execCount = 0;
  private ivm?: typeof import('isolated-vm');

  constructor(policy: SecurityPolicy) {
    this.policy = policy;
  }

  async init() {
    // 加载 isolated-vm（V8 隔离沙箱）
    this.ivm = await import('isolated-vm');
    console.log('[aether:sandbox] Using isolated-vm (V8 isolate) runtime');
  }

  async execute(request: ExecutionRequest): Promise<ExecutionResult> {
    const id = request.id ?? randomUUID();
    const startTime = Date.now();
    this.execCount++;

    // 1. 静态代码扫描
    const violations = this.policy.scanCode(request.code);
    if (violations.length > 0) {
      return {
        id,
        ok: false,
        error: `Security policy violation: ${violations[0].detail}`,
        violations,
        durationMs: Date.now() - startTime,
        exitedAt: new Date().toISOString(),
      };
    }

    const timeout = request.timeout ?? this.policy.config.maxExecTimeMs;

    // 2. 使用 isolated-vm 执行
    return this.executeInIsolate(id, request, timeout, startTime);
  }

  private async executeInIsolate(
    id: string,
    request: ExecutionRequest,
    timeout: number,
    startTime: number
  ): Promise<ExecutionResult> {
    const ivm = this.ivm!;
    const stdout: string[] = [];
    const stderr: string[] = [];

    try {
      // 创建独立的 V8 隔离区
      const isolate = new ivm.Isolate({
        memoryLimit: this.policy.config.maxMemoryMb,
      });

      const context = await isolate.createContext();
      const jail = context.global;

      // 注入安全的 console
      await jail.set('console', new ivm.ExternalCopy({
        log: new ivm.Reference((...args: unknown[]) => {
          stdout.push(args.map(String).join(' '));
        }),
        error: new ivm.Reference((...args: unknown[]) => {
          stderr.push(args.map(String).join(' '));
        }),
      }).copyInto());

      // 注入输入数据（如果有）
      if (request.input !== undefined) {
        await jail.set('input', new ivm.ExternalCopy(request.input).copyInto());
      }

      // 注入环境变量（仅白名单键）
      if (request.env) {
        const safeEnv: Record<string, string> = {};
        for (const [k, v] of Object.entries(request.env)) {
          if (/^[A-Z][A-Z0-9_]*$/.test(k)) safeEnv[k] = v;
        }
        await jail.set('env', new ivm.ExternalCopy(safeEnv).copyInto());
      }

      // 执行代码
      const script = await isolate.compileScript(request.code);
      const output = await script.run(context, { timeout });

      const durationMs = Date.now() - startTime;
      const memStats = isolate.getHeapStatisticsSync();

      isolate.dispose();

      return {
        id,
        ok: true,
        output: output !== undefined ? new ivm.ExternalCopy(output).copy() : undefined,
        stdout: stdout.join('\n'),
        stderr: stderr.join('\n'),
        durationMs,
        memoryUsedMb: Math.round(memStats.used_heap_size / 1024 / 1024),
        exitedAt: new Date().toISOString(),
      };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      const isTimeout = error.includes('Script execution timed out');
      return {
        id,
        ok: false,
        error: isTimeout ? `Execution timed out after ${timeout}ms` : error,
        stdout: stdout.join('\n'),
        stderr: stderr.join('\n'),
        durationMs: Date.now() - startTime,
        exitedAt: new Date().toISOString(),
      };
    }
  }

  stats() {
    return {
      execCount: this.execCount,
      runtime: 'isolated-vm',
      policy: this.policy.summary(),
    };
  }
}
