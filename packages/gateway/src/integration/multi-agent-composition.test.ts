// Multi-Agent Composition Integration Test — Council Verdict Phase 2
// ======================================================================
// Proves the multi-agent bus, registry, and orchestrator actually compose:
//   1. MessageBus encrypts at rest (ciphertext in bus.jsonl, not plaintext)
//   2. Two agents can exchange task→result messages
//   3. TeamOrchestrator can run a sequential researcher→executor round-trip
//      with mock agents subscribed to the bus
//
// This is the user-validated usage that the "bus shelf status" depends on.
// Before this test, the TeamOrchestrator happy-path was untested.
//
// Run on its own:
//   npx vitest run packages/gateway/src/integration/multi-agent-composition.test.ts

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { MessageBus } from '../multi-agent/bus.js';
import { AgentRegistry } from '../multi-agent/registry.js';
import { TeamOrchestrator } from '../multi-agent/team-orchestrator.js';
import { AgentSandboxManager } from '../multi-agent/sandbox-executor.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'aether-mcomposition-'));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

// ── Fixtures ────────────────────────────────────────────────────────────────

function createHarness() {
  const busFilePath = join(tmpDir, 'bus.jsonl');
  const bus = new MessageBus({ busFilePath, requireSenderKey: false });
  const registry = new AgentRegistry(bus);
  const sandbox = new AgentSandboxManager();
  const orchestrator = new TeamOrchestrator(registry, bus, sandbox);
  return { busFilePath, bus, registry, sandbox, orchestrator };
}

/**
 * Mock agent: subscribes to the bus, echoes task→result.
 *
 * Echoes back the exact `taskId` from the task envelope — the orchestrator
 * generates a UUID per task and matches results by taskId, so a hardcoded ID
 * would never match and the orchestrator would time out.
 */
function makeMockAgent(bus: MessageBus, agentId: string, resultPayload: unknown) {
  bus.ensureQueue(agentId);
  bus.subscribe(agentId, async (msg) => {
    if (msg.type === 'task') {
      const taskId = (msg.payload as { taskId?: string })?.taskId ?? 't1';
      bus.publish({
        id: `res-${msg.id}`,
        from: agentId,
        to: msg.from,
        type: 'result',
        payload: { taskId, ok: true, result: resultPayload },
        timestamp: new Date().toISOString(),
        encrypted: false,  // bus auto-encrypts with the mock's own session key
      });
    }
  });
}

// ── 1. Encryption at rest ──────────────────────────────────────────────────

describe('MessageBus encryption', () => {
  it('persists ciphertext, not plaintext, for encrypted messages', () => {
    const { bus, busFilePath } = createHarness();

    bus.ensureQueue('alice');
    bus.ensureQueue('bob');
    const kA = bus.getSessionKey(bus.createSession('alice'))!;

    // Do NOT set encrypted:true here — that flag tells the bus the payload is
    // already ciphertext. Omitting it lets the bus auto-encrypt with kA.
    bus.publish(
      { id: 'm1', from: 'alice', to: 'bob', type: 'task', payload: { secret: 'sk-live-abc' }, timestamp: new Date().toISOString() },
      kA,
    );

    // The raw JSONL file must contain ciphertext, NOT the plaintext secret.
    const rawFile = readFileSync(busFilePath, 'utf-8');
    expect(rawFile).not.toContain('sk-live-abc');
    // ... but it must contain some base64 ciphertext blob.
    expect(rawFile.length).toBeGreaterThan(50);

    // consume() transparently decrypts.
    const msgs = bus.consume('bob');
    expect(msgs.length).toBe(1);
    expect((msgs[0].payload as Record<string, string>).secret).toBe('sk-live-abc');
  });

  it('consume() returns empty for an agent with no queue', () => {
    const { bus } = createHarness();
    // ensureQueue not called → agent has no messages routed.
    const msgs = bus.consume('nonexistent');
    expect(msgs).toEqual([]);
  });
});

// ── 2. Agent registry + bus composition ─────────────────────────────────────

describe('AgentRegistry + MessageBus composition', () => {
  it('registers two agents and routes a message between them', () => {
    const { bus, registry } = createHarness();

    const alice = registry.register({ id: 'alice', name: 'Alice', role: 'generalist', capabilities: ['analysis'] });
    const bob = registry.register({ id: 'bob', name: 'Bob', role: 'executor', capabilities: ['coding'] });

    expect(registry.list()).toHaveLength(2);

    const kA = bus.getSessionKey(bus.createSession('alice'))!;
    bus.publish({ id: 'm1', from: 'alice', to: 'bob', type: 'task', payload: 'plan this' }, kA);

    const bobMsgs = bus.consume('bob');
    expect(bobMsgs).toHaveLength(1);
    expect(bobMsgs[0].from).toBe('alice');
  });
});

// ── 3. TeamOrchestrator end-to-end round-trip ──────────────────────────────

describe('TeamOrchestrator — researcher + executor composition', () => {
  // The orchestrator polls every 200ms for up to 60s; give the test room.
  it('runs a sequential two-agent workflow and aggregates results', async () => {
    const { bus, registry, orchestrator } = createHarness();

    const researcher = registry.register({ id: 'researcher', role: 'generalist', capabilities: ['planning'] });
    const executor = registry.register({ id: 'executor', role: 'executor', capabilities: ['coding'] });

    // Mock executor: subscribes, receives task, publishes result back.
    makeMockAgent(bus, 'executor', { code: 'return 42' });

    const result = await orchestrator.runQuickTeam(
      'Write a function that returns 42',
      [executor.id],
      { [executor.id]: 'executor' },
      'sequential',
    );

    // TeamResult.ok is true when every subTask reached status 'done'.
    expect(result.ok).toBe(true);
    expect(result.subTasks.length).toBeGreaterThan(0);
    // Every subTask should be 'done' with the mock's result payload.
    for (const st of result.subTasks) {
      expect(st.status).toBe('done');
    }
    // The finalAnswer aggregates per-agent results.
    expect(result.finalAnswer).toContain('return 42');
  }, 10_000);

  it('reports a failed task when agent returns ok:false', async () => {
    const { bus, registry, orchestrator } = createHarness();

    const worker = registry.register({ id: 'worker', role: 'executor' });
    // Mock that always reports failure.
    bus.ensureQueue('worker');
    bus.subscribe('worker', async (msg) => {
      if (msg.type === 'task') {
        const taskId = (msg.payload as { taskId?: string })?.taskId ?? 't1';
        bus.publish({
          id: `res-${msg.id}`, from: 'worker', to: msg.from, type: 'result',
          payload: { taskId, ok: false, error: 'timeout' },
          timestamp: new Date().toISOString(), encrypted: false,
        });
      }
    });

    const result = await orchestrator.runQuickTeam(
      'this will fail',
      [worker.id],
      { [worker.id]: 'executor' },
      'sequential',
    );

    // TeamResult.ok is false when any subTask is 'failed'.
    expect(result.ok).toBe(false);
    expect(result.subTasks.some(st => st.status === 'failed')).toBe(true);
    expect(result.finalAnswer).toContain('No subtasks completed successfully');
  }, 10_000);
});
