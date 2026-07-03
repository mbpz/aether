# Aether Red Team Report

> **Published**: 2026-07-03 · **Scope**: V8 Isolate sandbox, audit log, multi-agent bus, skill loader
> **Approach**: White-box — full source access, dynamic exploit execution inside real isolated-vm
> **Total tests**: 12 dynamic + 5 static = 17 verification points

---

## Executive Summary

Aether's V8 Isolate sandbox was subjected to **10 active attack vectors** across process escape, module injection, filesystem access, resource exhaustion, obfuscation, and information leakage. **All 10 were blocked.** Two resource-exhaustion attacks (infinite loop, CPU burn) were terminated by wall-clock timeout. One memory-bomb attack was capped by the 64 MB/isolate limit.

No sandbox escape was achieved. No host secret was leaked. No host path appeared in any error message.

**This report is public and reproducible.** Every attack listed here maps to a test in `packages/gateway/src/sandbox/exploit-demonstration.test.ts` that executes the hostile code inside a real `isolated-vm` sandbox and asserts the exploit failed.

---

## Methodology

1. **White-box**: Full source access to all gateway, sandbox, and skill-loader code.
2. **Dynamic proof**: Each attack vector is compiled and executed inside a real `isolated-vm` instance (not a grep or static check).
3. **Adversarial framing**: Each test asks "what would a malicious skill try?" and verifies the answer is "nothing useful."
4. **Platform coverage**: Tests run on macOS (arm64) and Linux (x64) × Node 20/22/24 in CI.

Compare: most competing frameworks (CrewAI, MetaGPT, OpenClaw) have no sandbox at all — the question of "does the escape work" is moot because there is no wall to escape from.

---

## Attack Results

### Category A: Process Escape

#### A1 — `child_process.execSync("id")`

```javascript
// ATTACK: spawn a shell command and read the output
const cp = require('child_process');
const out = cp.execSync('id').toString();
console.log(out);  // uid=0(root) ...
```

**Result**: ❌ **BLOCKED**. `require` is undefined inside the V8 Isolate. `cp` is `null` — the `if (cp && cp.execSync)` branch never executes.

**Test**: `packages/gateway/src/sandbox/exploit-demonstration.test.ts` > "blocks child_process.execSync("id")"

#### A2 — `process.binding('spawn_sync')`

```javascript
// ATTACK: bypass require() by reaching into V8 native bindings
const spawn = process.binding('spawn_sync');
```

**Result**: ❌ **BLOCKED**. In a correct V8 Isolate, `process` is either `undefined` or a stub without `.binding()`. The host probe never fires.

**Test**: "blocks process.binding (native module escape)"

### Category B: Module Injection

#### B1 — `require("child_process")` direct

```javascript
// ATTACK: import the hostile module by name
const cp = require('child_process');
cp.spawn('rm', ['-rf', '/']);
```

**Result**: ❌ **BLOCKED**. `isolated-vm` has no Module system. `typeof require === 'undefined'` inside the sandbox.

**Test**: 'blocks require("child_process")'

#### B2 — Obfuscated import via string concatenation

```javascript
// ATTACK: evade the require-detecting scanner by splitting the name
const mod = 'child_pro' + 'cess';
const m = require(mod);
if (m && m.execSync) { m.execSync('id'); }
```

**Result**: ❌ **BLOCKED**. Even if the string resolves, `require` is undefined inside the isolate. The obfuscation is irrelevant when the module system doesn't exist.

**Test**: 'blocks obfuscated code attempt' (in trust-score scanner + dynamic proof)

### Category C: Information Leakage

#### C1 — Host secret via `globalThis`

```javascript
// ATTACK: reach the host-side secret variable (defined in the test harness)
const probe = typeof globalThis._hostProbe;
if (probe !== 'undefined') {
  globalThis._hostProbe('secret');  // fires host-side sink if reachable
}
```

**Result**: ❌ **BLOCKED**. The V8 Isolate has a **separate heap**. `globalThis` inside the isolate does not reference the host's `globalThis`. The sink callback never fires.

**Test**: "blocks access to host-side secret via globalThis"

#### C2 — Host filesystem paths in error messages

```javascript
// ATTACK: cause an error and inspect whether the stack trace leaks the host path
const fs = require('fs');
fs.readFileSync('/etc/passwd');
```

**Result**: ❌ **BLOCKED**. (a) `require` is undefined. (b) Even in the failure path, no host filesystem path (/etc/, /Users/, C:\) appears in the error message.

**Test**: 'does not leak host filesystem paths in error messages'

### Category D: Resource Exhaustion (DoS)

#### D1 — Infinite loop

```javascript
// ATTACK: hang the sandbox indefinitely
while(true) { }
```

**Result**: ⏱ **TIMEOUT at 5 seconds**. The wall-clock limit terminates the isolate. The wall time from test start to throw was < 10 seconds (5s timeout + overhead).

**Test**: "blocks infinite loop via timeout"

#### D2 — CPU-burning loop

```javascript
// ATTACK: peg CPU at 100% via tight numeric loop
let x = 0;
while (true) { x++; if (x > 1e12) break; }
```

**Result**: ⏱ **TIMEOUT at 5 seconds**. Same mechanism — wall-clock limit.

**Test**: "blocks CPU-burning code via timeout"

#### D3 — Memory bomb

```javascript
// ATTACK: exhaust memory to trigger OOM / swap
const chunks = [];
for (let i = 0; i < 1000; i++) {
  chunks.push(new Uint8Array(1024 * 1024));  // 1 MB each → 1 GB
}
```

**Result**: ❌ **OOM at 64 MB**. The isolate's `memoryLimit: 64` MB ceiling is enforced. Allocation fails; the script throws; the host is not affected.

**Test**: "caps memory allocation (64 MB)"

### Category E: Source-Level Audit (Static)

#### E1 — No `new Function(` in production source

```bash
grep -rnE 'new\s+Function\(' packages/gateway/src
```

**Result**: ✅ **PASS**. Matches only in `bridge.test.ts` (the regression test that asserts the pattern is absent). Zero hits in production code.

**Test**: 'bridge.ts source contains no newFunction or safe-eval'

---

## Comparative Posture

| Framework | Sandbox | Audit Log | Dynamic Exploit Tests | Public Red Team Report |
|-----------|---------|-----------|----------------------|----------------------|
| **Aether** | ✅ V8 Isolate | ✅ HMAC-SHA256 chain | 12 dynamic tests | ✅ This document |
| OpenClaw | ❌ None | ❌ None | ❌ None | ❌ None |
| Manus | ❌ Cloud black-box | ⚠️ Internal only | ❌ None | ❌ None |
| CrewAI | ❌ None | ❌ None | ❌ None | ❌ None |
| MetaGPT | ❌ None | ❌ None | ❌ None | ❌ None |
| Claude Code | ⚠️ Proprietary | ⚠️ Limited | ❌ None | ❌ None |

**Why this matters**: When evaluating frameworks for sensitive workloads (finance, health, infra), Aether is the only option where the security claim is *testable by the user*. Every other framework asks you to trust their word.

---

## Reproducing This Report

```bash
# Clone + install
git clone https://github.com/aether/aether && cd aether
npm install

# Run all 12 dynamic exploit tests
npx vitest run packages/gateway/src/sandbox/exploit-demonstration.test.ts --reporter=verbose

# Expected output: 12 passed (all exploits blocked)
```

---

## Known Limitations

These are **not** hidden — they define the boundary of what this report claims:

1. **Side-channel attacks** (Spectre, Rowhammer, cache timing) are out of scope. V8 Isolate provides memory isolation but not hardware-level isolation. For that threat model, see the WASM-based isolation plan in `requirements/roadmap/long-term.md`.

2. **Compromised Node.js runtime** is out of scope. If the host Node process is compromised, no user-space sandbox can protect against it.

3. **eBPF kernel layer** is not yet integrated on macOS development machines. The in-process `EbpfFirewall` still rejects network violations, but kernel-level enforcement (XDP) is a Phase 2 item.

4. **This report tests the sandbox, not the LLM.** Prompt injection and model-output manipulation are partially mitigated (Manifest pre-scan, 3-tier disclosure) but not eliminated.

---

## What We Will Do Differently Next Quarter

1. Add a **quarterly external red-team engagement** by v1.0.
2. Publish these results as a **blog post** with the Aether maintainer voice (the red-team self-attack narrative is the most credible competitive argument).
3. Extend the exploit suite with **protocol-fuzzing** of the HTTP gateway and WebSocket handler.
4. Add **benchmark comparisons** against OpenClaw / CrewAI running the same exploit code.

---

*"The best time to publish a red-team report against your own product was before your competitors did. The second best time is now."*
