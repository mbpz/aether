# Composing Multiple Agents

> Real code. Pre-competent. Subject to archival in 2026-08 if zero external usage.

This guide shows how to compose two agents that communicate over the encrypted
message bus. The code below is wired into the production Express server
(`routes/multi-agent.ts`) and runs today.

## TL;DR

```typescript
import { MessageBus, TeamOrchestrator, AgentRegistry } from '@aether/gateway';
import { AgentSandboxManager } from '@aether/gateway/sandbox';

// 1. Wire the three primitives together.
const bus = new MessageBus({ requireSenderKey: false });
const agents = new AgentRegistry(bus);
const sandbox = new AgentSandboxManager();
const team = new TeamOrchestrator(agents, bus, sandbox);

// 2. Register two agents.
const researcher = agents.register({ id: 'r1', name: 'Researcher', capabilities: ['analysis', 'planning'] });
const executor  = agents.register({ id: 'x1', name: 'Executor',  capabilities: ['coding', 'execution'] });

// 3. Run a sequential workflow: researcher plans, executor runs the plan.
const result = await team.runQuickTeam(
  'Analyze the CSV at data/sales.csv and produce a revenue summary',
  [researcher.id, executor.id],
  { [researcher.id]: 'generalist', [executor.id]: 'executor' },
  'sequential',
);

console.log(result.summary);           // "2 tasks completed in …"
console.log(result.perAgentResults);   // { r1: …, x1: … }
```

That's ~15 lines. The rest of this document explains what happens under the
hood and how to override the default execution model.

## What happens during the round-trip

```
Orchestrator                         MessageBus (encrypted at rest)
    │                                      │
    ├── publish(task, to=r1) ─────────────>│  ← AES-256-GCM, ciphertext in bus.jsonl
    │                                      │
    │   [Researcher agent consumes,        │
    │    produces a plan, publishes back]  │
    │                                      │
    │<── consume('orchestrator') ──────────┤  ← auto-decrypted
    │                                      │
    ├── publish(task, to=x1) ─────────────>│
    │                                      │
    │<── consume('orchestrator') ──────────┤
    │                                      │
    └── result.aggregate()                
```

1. **Orchestrator dispatches** a `task` message to each agent over the bus.
2. **Each agent consumes** its pending messages (`consume(agentId)`), executes
   the task in its per-agent sandbox (V8 Isolate), and publishes a `result`
   message back.
3. **Orchestrator polls** `consume('orchestrator')` for `result` messages (60 s
   timeout, 200 ms tick).
4. **On completion**, it aggregates per-task results into a `TeamResult`.

## Encryption model

Messages at rest on the bus file are AES-256-GCM ciphertext. The bus decrypts
transparently on `consume()` using the sender's `SessionKey`.

**Caveat:** all `SessionKey`s live in one shared `EphemeralKeyManager` instance
held by the bus. The bus can read every message. This is **at-rest protection
against an external reader of `bus.jsonl`**, not end-to-end privacy between
agents. For a threat model where agents must not read each other's traffic, you
need per-pair key agreement (not yet implemented).

## Overriding execution defaults

By default `runQuickTeam` uses the built-in sandbox executor with
fail-closed V8 Isolate. To plug in your own executor:

```typescript
// 1. Subscribe your agent to the bus
bus.subscribe('my-agent', async (msg) => {
  switch (msg.type) {
    case 'task': {
      // … your logic here, e.g. call an LLM, run a query, whatever …
      const myResult = await doMyWork(msg.payload);
      bus.publish({
        id: `res-${msg.id}`,
        from: 'my-agent',
        to: msg.from,           // reply to whoever sent it
        type: 'result',
        payload: { taskId: msg.payload.taskId, ok: true, result: myResult },
        timestamp: new Date().toISOString(),
        encrypted: true,
      });
      break;
    }
  }
});

// 2. Ensure the agent has a queue (otherwise publish rejects the address)
bus.ensureQueue('my-agent');
```

The subscriber pattern is how you compose arbitrary agent behaviours — LLM
calls, database queries, API orchestration — while the bus handles routing,
persistence, and encryption.

## Modes

| Mode | Use case |
|------|---------|
| `sequential` | Researcher→executor dependency chain (default for two-agent tasks) |
| `parallel` | Independent subtasks that can run concurrently |
| `hierarchical` | DAG-scheduled work (uses `DependencyGraph` internally) |

## Testing your composition

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { MessageBus, AgentRegistry, TeamOrchestrator } from '@aether/gateway';
import { AgentSandboxManager } from '@aether/gateway/sandbox';

let tmp: string;
beforeEach(() => { tmp = mkdtempSync(join(tmpdir(), 'aether-test-')); });
afterEach(() => { rmSync(tmp, { recursive: true, force: true }); });

it('two agents compose over the bus', async () => {
  const bus = new MessageBus({ busFilePath: join(tmp, 'bus.jsonl'), requireSenderKey: false });
  const agents = new AgentRegistry(bus);
  const sandbox = new AgentSandboxManager();
  const team = new TeamOrchestrator(agents, bus, sandbox);

  const r = agents.register({ id: 'r', role: 'generalist' });
  const x = agents.register({ id: 'x', role: 'executor' });

  // Subscribe a mock executor that echoes back a result.
  bus.subscribe('x', async (msg) => {
    if (msg.type === 'task') {
      bus.publish({
        id: `res-${msg.id}`, from: 'x', to: msg.from, type: 'result',
        payload: { taskId: 't1', ok: true, result: 'done' },
        timestamp: new Date().toISOString(), encrypted: true,
      });
    }
  });
  bus.ensureQueue('x');

  const result = await team.runQuickTeam('echo', [x.id], { [x.id]: 'executor' }, 'sequential');
  expect(result.perAgentResults['x']).toBeDefined();
});
```

Full test source: `packages/gateway/src/integration/multi-agent-composition.test.ts`.

## Shelf status

This code is real and production-wired. It is currently **pre-competent**: no
external usage has been verified. If no external user composes two agents using
this pattern in the next 6 weeks (by 2026-08-15), the multi-agent files will move
to `packages/gateway/src/multi-agent/archive/` to reduce maintenance surface.

The sandbox (`@aether/sandbox`), skill loader (`@aether/skill-loader`), and
provider dispatch (`@aether/gateway/llm`) that the orchestrator composes are
**not** going anywhere — they're core.
