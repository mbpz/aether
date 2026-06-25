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
import { EbpfFirewall } from '@aether/sandbox';
import { MemoryManager } from './memory/manager.js';
import { AgentRunner } from './agent-loop/runner.js';
import { AgentRegistry } from './multi-agent/registry.js';
import { MessageBus } from './multi-agent/bus.js';
import { AgentSandboxManager } from './multi-agent/sandbox-executor.js';
import { TeamOrchestrator } from './multi-agent/team-orchestrator.js';
import { LLMManager } from './llm/manager.js';

const PORT = parseInt(process.env.GATEWAY_PORT ?? '18790', 10);
const LOCAL_TOKEN = process.env.LOCAL_API_TOKEN ?? '';
const LOCAL_TOKEN_REQUIRED = process.env.LOCAL_TOKEN_AUTH_REQUIRED === 'true';
const READONLY_MODE = process.env.READONLY_MODE !== 'false'; // 默认只读

// Fail-closed: if the operator enabled token auth we must have a non-empty
// token. Boot would otherwise serve every request as 401, which is a worse
// failure mode than refusing to start.
if (LOCAL_TOKEN_REQUIRED && LOCAL_TOKEN.length === 0) {
  console.error(
    '[aether:gateway] FATAL: LOCAL_TOKEN_AUTH_REQUIRED=true but LOCAL_API_TOKEN ' +
    'is empty. Refusing to start with auth enabled and no token configured.',
  );
  process.exit(2);
}

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
  // EP-01 / ADR-006: 构造 in-process EbpfFirewall 传给 SandboxBridge。
  // bridge.ts:255 那个 `if (this.firewall) { ... }` 死分支现在活起来了——
  // 提交 code 时 firewall.checkConnection 真的会被调，违规会被真的拒绝。
  const ebpfFirewall = new EbpfFirewall({ defaultAction: 'block', logConnections: true });
  const sandbox = new SandboxBridge(taskQueue, audit, manifest, ebpfFirewall);
  const memory = new MemoryManager({
    storeDir: process.env.MEMORY_DIR ?? './memory-store',
    workingWindowSize: parseInt(process.env.MEMORY_WINDOW ?? '50', 10),
  });

  // EP-05: Agent Loop
  const agentRunner = new AgentRunner({ memory, sandbox });

  // EP-05: Per-agent isolated sandbox manager
  const agentSandboxManager = new AgentSandboxManager();

  // EP-06: 多 Agent 协作
  const messageBus = new MessageBus();
  const agentRegistry = new AgentRegistry(messageBus); // 注入 bus，fix ISSUE-002

  // EP-05: Team Orchestrator（依赖 registry + bus + sandboxManager）
  const teamOrchestrator = new TeamOrchestrator(agentRegistry, messageBus, agentSandboxManager);

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
    agentRunner, agentRegistry, messageBus, agentSandboxManager,
    teamOrchestrator, llmManager,
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
      category: 'system',
      actor: { type: 'system', id: 'system' },
      outcome: 'success',
      detail: `Gateway started on port ${PORT} with Sandbox Bridge`,
    });
  });

  process.on('SIGINT', () => {
    console.log('\n[aether:gateway] Shutting down...');
    audit.log({ action: 'gateway_stop', category: 'system', actor: { type: 'system', id: 'system' }, outcome: 'success', detail: 'SIGINT received' });
    server.close(() => process.exit(0));
  });
}

main().catch((err) => {
  console.error('[aether:gateway] Fatal error:', err);
  process.exit(1);
});
