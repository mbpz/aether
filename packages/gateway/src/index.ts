// Aether Gateway - 零信任控制平面入口
// EP-02: Zero-Trust Control Plane
// EP-05: Agent Loop
// EP-06: 多 Agent 协作

import 'dotenv/config';
import { createGatewayServer } from './server.js';
import { AuditLogger } from './audit/logger.js';
import { ManifestEngine } from './manifest/engine.js';
import { VaultInjector } from './vault/injector.js';
import { TaskQueue } from './sandbox/task-queue.js';
import { SandboxBridge } from './sandbox/bridge.js';
import { MemoryManager } from './memory/manager.js';
import { AgentRunner } from './agent-loop/runner.js';
import { AgentRegistry } from './multi-agent/registry.js';
import { MessageBus } from './multi-agent/bus.js';
import { LLMManager } from './llm/manager.js';

const PORT = parseInt(process.env.GATEWAY_PORT ?? '18790', 10);
const LOCAL_TOKEN = process.env.LOCAL_API_TOKEN ?? '';
const LOCAL_TOKEN_REQUIRED = process.env.LOCAL_TOKEN_AUTH_REQUIRED === 'true';
const READONLY_MODE = process.env.READONLY_MODE !== 'false'; // 默认只读

export const config = {
  port: PORT,
  localToken: LOCAL_TOKEN,
  localTokenRequired: LOCAL_TOKEN_REQUIRED,
  readonlyMode: READONLY_MODE,
};

async function main() {
  const audit = new AuditLogger();
  const manifest = new ManifestEngine();
  const vault = new VaultInjector();
  const taskQueue = new TaskQueue();
  const sandbox = new SandboxBridge(taskQueue, audit);
  const memory = new MemoryManager({
    storeDir: process.env.MEMORY_DIR ?? './memory-store',
    workingWindowSize: parseInt(process.env.MEMORY_WINDOW ?? '50', 10),
  });

  // EP-05: Agent Loop
  const agentRunner = new AgentRunner({ memory, sandbox });

  // EP-06: 多 Agent 协作
  const messageBus = new MessageBus();
  const agentRegistry = new AgentRegistry(messageBus); // 注入 bus，fix ISSUE-002

  // EP-07: LLM Provider
  const llmManager = new LLMManager();
  const llmFromEnv = llmManager.initFromEnv();
  if (llmFromEnv) {
    console.log('[aether:gateway] 🤖 LLM Provider loaded from environment variables');
  } else {
    console.log('[aether:gateway] ℹ️  LLM not configured (set LLM_BASE_URL + LLM_MODEL + LLM_API_KEY to enable)');
  }

  console.log('[aether:gateway] 🔒 Initializing Sandbox Bridge...');

  const server = createGatewayServer({
    audit, manifest, vault, config, taskQueue, sandbox, memory,
    agentRunner, agentRegistry, messageBus, llmManager,
  });

  server.listen(PORT, '127.0.0.1', () => {
    console.log(`[aether:gateway] 🛡️  Zero-Trust Gateway listening at http://127.0.0.1:${PORT}`);
    console.log(`[aether:gateway] readonly=${READONLY_MODE} | tokenAuth=${LOCAL_TOKEN_REQUIRED}`);
    console.log(`[aether:gateway] 🔒 Sandbox Bridge ready (policy: network=blocked, fs=blocked)`);
    console.log(`[aether:gateway] 🤖 Agent Loop ready (EP-05)`);
    console.log(`[aether:gateway] 🌐 Multi-Agent ready (EP-06)`);
    console.log(`[aether:gateway] 🧠 LLM Planner ready (EP-07) — configured=${llmManager.isConfigured}`);
    audit.log({
      action: 'gateway_start',
      source: 'system',
      ok: true,
      detail: `Gateway started on port ${PORT} with Sandbox Bridge`,
    });
  });

  process.on('SIGINT', () => {
    console.log('\n[aether:gateway] Shutting down...');
    audit.log({ action: 'gateway_stop', source: 'system', ok: true, detail: 'SIGINT received' });
    server.close(() => process.exit(0));
  });
}

main().catch((err) => {
  console.error('[aether:gateway] Fatal error:', err);
  process.exit(1);
});
