// Aether Sandbox - WASM 隔离执行层入口
// EP-01: Secure Sandbox Execution Layer
// EP-06: MicroVM 高安全模式 (T-017)

import 'dotenv/config';
import { SandboxRuntime } from './runtime/sandbox.js';
import { WasmtimeRuntime } from './runtime/wasm-runtime.js';
import { MicroVMRuntime, MicroVMConfig, MicroVMResult, MicroVMExecutionResult } from './runtime/microvm-runtime.js';
import { FirecrackerRuntime } from './runtime/firecracker.js';
import { KataRuntime } from './runtime/kata-runtime.js';
import { SecurityPolicy } from './security/policy.js';
import { EbpfFirewall } from './security/ebpf-firewall.js';
import { CodeActEngine } from './codeact/engine.js';

const SANDBOX_PORT = parseInt(process.env.SANDBOX_PORT ?? '18791', 10);
const MAX_EXEC_TIME_MS = parseInt(process.env.MAX_EXEC_TIME_MS ?? '30000', 10);
const MAX_MEMORY_MB = parseInt(process.env.MAX_MEMORY_MB ?? '128', 10);
const USE_WASM_RUNTIME = process.env.USE_WASM_RUNTIME === 'true';

async function main() {
  console.log('[aether:sandbox] 🔒 Initializing secure sandbox runtime...');

  const policy = new SecurityPolicy({
    blockNetwork: true,
    blockFilesystem: true,
    blockProcessSpawn: true,
    maxExecTimeMs: MAX_EXEC_TIME_MS,
    maxMemoryMb: MAX_MEMORY_MB,
  });

  // EP-01: eBPF 防火墙（模拟内核级网络拦截）
  const ebpf = new EbpfFirewall({
    defaultAction: 'block',
    logConnections: true,
  });

  // 选择执行引擎
  let runtime: SandboxRuntime | WasmtimeRuntime;
  if (USE_WASM_RUNTIME) {
    const wasmRuntime = new WasmtimeRuntime({
      maxMemoryMb: MAX_MEMORY_MB,
      maxExecTimeMs: MAX_EXEC_TIME_MS,
      blockNetwork: true,
    });
    // wasmRuntime.init() 现在会在 wasmtime 缺失时 throw（见 ADR-002）。
    // 这里不 catch——让进程以非零退出码失败，避免把"装不上 wasmtime"当成"沙箱可用"。
    try {
      await wasmRuntime.init();
    } catch (err) {
      console.error(
        '[aether:sandbox] ❌ USE_WASM_RUNTIME=true but Wasmtime initialization failed. ' +
        'Refusing to start. Set USE_WASM_RUNTIME=false to use the V8 isolate runtime instead.\n' +
        `Reason: ${err instanceof Error ? err.message : String(err)}`,
      );
      process.exit(1);
    }
    runtime = wasmRuntime as unknown as SandboxRuntime;
    console.log(`[aether:sandbox] ⚙️  Using WASM runtime (Wasmtime)`);
  } else {
    runtime = new SandboxRuntime(policy);
    await (runtime as SandboxRuntime).init();
    console.log(`[aether:sandbox] ⚙️  Using V8 isolate runtime (isolated-vm)`);
  }

  const codeact = new CodeActEngine(runtime as any, policy);

  console.log(`[aether:sandbox] ✅ Sandbox ready`);
  console.log(`[aether:sandbox]    policy: network=blocked, fs=blocked, maxMem=${MAX_MEMORY_MB}MB, maxTime=${MAX_EXEC_TIME_MS}ms`);
  console.log(`[aether:sandbox]    ebpf: default block=${ebpf.config.defaultAction}, logConnections=${ebpf.config.logConnections}`);

  return { runtime, codeact, policy, ebpf };
}

export { main, EbpfFirewall };
export type {
  SandboxRuntime,
  CodeActEngine,
  WasmtimeRuntime,
  // MicroVM runtime (T-017: Kata + Firecracker 高安全模式)
  MicroVMRuntime,
  MicroVMConfig,
  MicroVMResult,
  MicroVMExecutionResult,
  FirecrackerRuntime,
  KataRuntime,
};

if (process.env.STANDALONE === 'true') {
  main().then(() => {
    console.log('[aether:sandbox] Running in standalone mode');
  });
}
