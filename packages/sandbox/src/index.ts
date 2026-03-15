// Aether Sandbox - WASM 隔离执行层入口
// EP-01: Secure Sandbox Execution Layer

import 'dotenv/config';
import { SandboxRuntime } from './runtime/sandbox.js';
import { SecurityPolicy } from './security/policy.js';
import { CodeActEngine } from './codeact/engine.js';

const SANDBOX_PORT = parseInt(process.env.SANDBOX_PORT ?? '18791', 10);
const MAX_EXEC_TIME_MS = parseInt(process.env.MAX_EXEC_TIME_MS ?? '30000', 10);
const MAX_MEMORY_MB = parseInt(process.env.MAX_MEMORY_MB ?? '128', 10);

async function main() {
  console.log('[aether:sandbox] 🔒 Initializing secure sandbox runtime...');

  const policy = new SecurityPolicy({
    blockNetwork: true,
    blockFilesystem: true,
    blockProcessSpawn: true,
    maxExecTimeMs: MAX_EXEC_TIME_MS,
    maxMemoryMb: MAX_MEMORY_MB,
  });

  const runtime = new SandboxRuntime(policy);
  const codeact = new CodeActEngine(runtime, policy);

  await runtime.init();

  console.log(`[aether:sandbox] ✅ Sandbox ready`);
  console.log(`[aether:sandbox]    policy: network=blocked, fs=blocked, maxMem=${MAX_MEMORY_MB}MB, maxTime=${MAX_EXEC_TIME_MS}ms`);

  // 导出供 Gateway 调用
  return { runtime, codeact, policy };
}

export { main };
export type { SandboxRuntime, CodeActEngine };

// 独立运行时：监听来自 Gateway 的任务（通过 IPC 或本地 HTTP）
if (process.env.STANDALONE === 'true') {
  main().then(() => {
    console.log('[aether:sandbox] Running in standalone mode');
  });
}
