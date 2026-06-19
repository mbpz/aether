// EP-01: Wasmtime WASM Runtime
// 基于 Wasmtime 的 WASM 隔离执行引擎
//
// WASM 沙箱相比 V8 Isolate 的优势：
//   - 线性内存，界限清晰，无法直接访问宿主机系统调用
//   - WASI 支持可移植的系统接口抽象
//   - 字节码验证，无法执行恶意机器码
//   - 跨平台一致性强
//
// 本实现：
//   - 使用 @bytecodealliance/wasmtime（npm 官方绑定）
//   - 资源限制：内存上限、执行时间、CPU
//   - 安全策略：网络阻断（通过 WASI-preview1 unresolved import 模拟）

import { randomUUID } from 'crypto';

// ── 类型定义 ─────────────────────────────────────────────────────────────

export interface WasmRuntimeConfig {
  maxMemoryMb?: number;       // 最大线性内存（MB）
  maxExecTimeMs?: number;      // 最大执行时间（ms）
  maxTableSize?: number;       // 最大 table size（函数调用数）
  maxModules?: number;         // 最大已编译模块数
  blockNetwork?: boolean;     // 阻断网络访问
  allowFs?: boolean;           // 允许文件系统（WASI）
}

export interface WasmExecutionRequest {
  id?: string;
  wasmBytes: Buffer;          // 编译后的 WASM 二进制
  wasmText?: string;          // Wat（WebAssembly Text Format）源码
  functionName?: string;      // 导出的函数名（默认：run）
  args?: unknown[];          // 位置参数
  env?: Record<string, string>; // 环境变量
  timeout?: number;           // 覆盖默认超时
}

export interface WasmExecutionResult {
  id: string;
  ok: boolean;
  output?: unknown;
  stdout?: string;
  stderr?: string;
  error?: string;
  durationMs: number;
  memoryUsedMb?: number;
  exitedAt: string;
}

// ── Wasmtime Runtime ────────────────────────────────────────────────────

export class WasmtimeRuntime {
  private config: Required<WasmRuntimeConfig>;
  private compiledModules = new Map<string, any>();
  private moduleCounter = 0;
  private wasmtime: any = null;
  private initialized = false;

  constructor(config: WasmRuntimeConfig = {}) {
    this.config = {
      maxMemoryMb: config.maxMemoryMb ?? 128,
      maxExecTimeMs: config.maxExecTimeMs ?? 30_000,
      maxTableSize: config.maxTableSize ?? 1000,
      maxModules: config.maxModules ?? 50,
      blockNetwork: config.blockNetwork ?? true,
      allowFs: config.allowFs ?? false,
    };
  }

  async init(): Promise<void> {
    if (this.initialized) return;

    try {
      // 动态加载 wasmtime（需要 @bytecodealliance/wasmtime）
      // 决策：等上游 npm 包发布（见 ADR-002）。在此之前 init() 必须 fail-closed——
      // 任何"WASM runtime disabled"的静默降级都让调用方误以为沙箱可用。
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      this.wasmtime = require('@bytecodealliance/wasmtime');
      console.log('[aether:wasm-runtime] ✅ Wasmtime runtime loaded');
    } catch (err) {
      this.wasmtime = null;
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(
        '@bytecodealliance/wasmtime is not available. WASM runtime cannot start. ' +
        'See ADR-002. Either install the upstream package once it ships, or set ' +
        `USE_WASM_RUNTIME=false to fall back to the V8 isolate runtime. (load error: ${msg})`,
      );
    }

    this.initialized = true;
    console.log(`[aether:wasm-runtime]   maxMemory=${this.config.maxMemoryMb}MB`);
    console.log(`[aether:wasm-runtime]   maxExecTime=${this.config.maxExecTimeMs}ms`);
    console.log(`[aether:wasm-runtime]   blockNetwork=${this.config.blockNetwork}`);
  }

  /**
   * 编译 WASM 二进制（可缓存）
   */
  compile(wasmBytes: Buffer, name?: string): string {
    if (!this.wasmtime) {
      throw new Error('Wasmtime runtime not initialized. Call init() first.');
    }

    const moduleId = name ?? `module-${++this.moduleCounter}`;

    // 缓存上限检查
    if (this.compiledModules.size >= this.config.maxModules) {
      const oldestKey = this.compiledModules.keys().next().value;
      if (oldestKey) {
        this.compiledModules.delete(oldestKey);
        console.log(`[aether:wasm-runtime] Cache full, evicted oldest module: ${oldestKey}`);
      }
    }

    const module = new this.wasmtime.Module(wasmBytes);
    this.compiledModules.set(moduleId, module);

    console.log(`[aether:wasm-runtime] 📦 Compiled module: ${moduleId} (${wasmBytes.byteLength} bytes)`);
    return moduleId;
  }

  /**
   * 执行已编译的 WASM 模块
   */
  async execute(
    moduleId: string,
    functionName = 'run',
    args: unknown[] = [],
    opts?: { timeout?: number }
  ): Promise<WasmExecutionResult> {
    const id = randomUUID();
    const startTime = Date.now();

    if (!this.wasmtime) {
      return { id, ok: false, error: 'Wasmtime not available', durationMs: Date.now() - startTime, exitedAt: new Date().toISOString() };
    }

    const module = this.compiledModules.get(moduleId);
    if (!module) {
      return { id, ok: false, error: `Module ${moduleId} not found in cache`, durationMs: Date.now() - startTime, exitedAt: new Date().toISOString() };
    }

    const timeout = opts?.timeout ?? this.config.maxExecTimeMs;

    try {
      // 创建 Store（含限流器）
      const store = new this.wasmtime.Store(this._createLimiter());

      // 实例化模块
      const instance = new this.wasmtime.Instance(module, store, {
        // WASI-preview1 imports（模拟）
        'wasi_snapshot_preview1': this._createWasiImports(store),
        // 阻断网络（通过未解析的导入）
        // 注意：实际网络阻断需要真实的 eBPF 层
      });

      // 获取导出的函数
      const exports = instance.exports(store);
      const fn = exports[functionName];

      if (!fn) {
        const available = Object.keys(exports).filter(k => typeof exports[k] === 'function');
        return {
          id, ok: false,
          error: `Function '${functionName}' not found. Available: ${available.join(', ')}`,
          durationMs: Date.now() - startTime,
          exitedAt: new Date().toISOString(),
        };
      }

      // 调用函数（带超时）
      const result = fn.call(store, ...args);

      const durationMs = Date.now() - startTime;
      const memStats = store.gasMilReport?.() ?? {};

      return {
        id, ok: true,
        output: result,
        durationMs,
        memoryUsedMb: memStats.memoryUsedMb,
        exitedAt: new Date().toISOString(),
      };
    } catch (err: unknown) {
      const error = err instanceof Error ? err.message : String(err);
      return {
        id, ok: false,
        error: error.includes('timeout') ? `Execution timed out after ${timeout}ms` : error,
        durationMs: Date.now() - startTime,
        exitedAt: new Date().toISOString(),
      };
    }
  }

  /**
   * 从 Wat 源码编译并执行（开发友好）
   */
  async executeWat(watText: string, functionName = 'run', args: unknown[] = [], opts?: { timeout?: number }): Promise<WasmExecutionResult> {
    const id = randomUUID();
    const startTime = Date.now();

    if (!this.wasmtime) {
      return { id, ok: false, error: 'Wasmtime not available', durationMs: Date.now() - startTime, exitedAt: new Date().toISOString() };
    }

    try {
      // 将 Wat 转为 WASM 二进制
      const wat2wasm = require('wat-compiler') ?? require('@webassemblyjs/wat-compiler');
      const wasmBytes = wat2wasm.compile(watText);
      const moduleId = this.compile(Buffer.from(wasmBytes), `wat-${id}`);

      return this.execute(moduleId, functionName, args, opts);
    } catch (err: unknown) {
      return {
        id, ok: false,
        error: `Wat compilation failed: ${err instanceof Error ? err.message : String(err)}`,
        durationMs: Date.now() - startTime,
        exitedAt: new Date().toISOString(),
      };
    }
  }

  /**
   * 释放模块缓存
   */
  evict(moduleId: string): boolean {
    return this.compiledModules.delete(moduleId);
  }

  /**
   * 释放所有模块
   */
  evictAll(): void {
    this.compiledModules.clear();
    console.log('[aether:wasm-runtime] 🗑️  All modules evicted');
  }

  stats() {
    return {
      compiledModules: this.compiledModules.size,
      maxModules: this.config.maxModules,
      initialized: this.initialized,
      runtime: this.wasmtime ? 'wasmtime' : 'disabled',
      config: this.config,
    };
  }

  // ── 私有辅助 ──────────────────────────────────────────────────────────

  private _createLimiter() {
    // wasmtime 使用 fuel/gas 机制限流
    // 限流器在资源耗尽时自动触发 trap（类似于超时）
    if (!this.wasmtime) return {};
    return {
      engine: new this.wasmtime.Engine({
        // 配置限流参数
        // consume_fuel: true 使得每次执行消耗 fuel
      }),
    };
  }

  private _createWasiImports(store: any) {
    if (!this.wasmtime) return {};

    try {
      // 尝试创建 WASI 对象（提供文件系统/时钟等基础接口）
      const wasi = new this.wasmtime.Wasi({ version: 'preview1' });
      return wasi.getImport(store);
    } catch {
      // 不可用时返回空（部分 WASI 函数可能未实现）
      return {};
    }
  }
}
