# Aether Threat Model (RFC)

> **Status**: Active · **Last updated**: 2026-07-03 · **Author**: Council of High Intelligence (strategy triad)
> **Scope**: Gateway runtime, sandbox execution, multi-agent bus, provider dispatch, skill lifecycle.

---

## 1. Security Identity

Aether is **the local-first agent framework with verified execution**.

A developer should be able to answer, after every agent run:

1. **What code ran?** → Sandbox execution log (`sandbox_exec_done`)
2. **What did it touch?** → Manifest authorization decisions (`manifest_allow` / `manifest_reject`)
3. **Can I prove it?** → `aether-audit verify` returns `valid: true` iff the HMAC-SHA256 chain is intact
4. **What LLM was called?** → Provider dispatch log (`llm_call` with token counts)

Every claim in this document is backed by a machine-executable test or command.

---

## 2. Architecture Overview

```
┌──────────────────── Client (curl / SDK) ────────────────────┐
│                                                              │
│  ┌─── Gateway HTTP (:18790) ─────────────────────────────┐  │
│  │  ┌─ Token auth (optional, LOCAL_TOKEN_AUTH_REQUIRED)  │  │
│  │  ┌─ Manifest validation (every request)               │  │
│  │  ┌─ Vault credential injection (per-agent)            │  │
│  │  ┌─ AuditLogger (every LLM call + sandbox exec)       │  │
│  │  └────────────────────────────────────────────────────│  │
│  │                                                       │  │
│  │  ┌─── ManifestEngine ─────────────────────────────┐   │  │
│  │  │  YAML allowlists → validate(operation, target)  │   │  │
│  │  │  Default: block all (exec, network, files)     │   │  │
│  │  └────────────────────────────────────────────────│   │  │
│  │                                                       │  │
│  │  ┌─── LLMProvider (multi-dispatch) ──────────────┐ │  │
│  │  │  Anthropic / Gemini / Bedrock / Ollama / Custom │ │  │
│  │  │  Zero-dep (in-tree SigV4 for Bedrock)          │ │  │
│  │  └────────────────────────────────────────────────│ │  │
│  │                                                       │  │
│  │  ┌─── SandboxBridge (V8 Isolate, fail-closed) ────┐ │  │
│  │  │  static scanCode → violations? reject           │ │  │
│  │  │  EbpfFirewall.checkConnection → block? reject   │ │  │
│  │  │  Manifest rejected? → reject                    │ │  │
│  │  │  runInSandbox → isolated-vm (fail-closed)       │ │  │
│  │  └────────────────────────────────────────────────┘ │  │
│  └───────────────────────────────────────────────────────│  │
│                                                          │  │
│  ┌─── Multi-Agent (MessageBus, AES-256-GCM) ────────────┐│  │
│  │  TeamOrchestrator → dispatch → per-agent sandbox      ││  │
│  │  EphemeralKeyManager (32-byte session keys, 5m TTL)  ││  │
│  └──────────────────────────────────────────────────────┘│  │
└──────────────────────────────────────────────────────────┘│
                                                               │
┌─── Audit trail (runtime/audit/YYYY-MM-DD.jsonl) ──────────┐
│  HMAC-SHA256 hash chain (previousHash → hash)              │
│  ACC-256-GCM encrypted MessageBus (.agent-workspace/bus.jsonl) │
│  Verifiable: aether-audit verify                           │
└────────────────────────────────────────────────────────────┘
```

---

## 3. Attack Surface & Mitigations

### 3.1 OWASP Agentic Top 10

| # | Threat | Aether Control | Status | Test |
|---|--------|---------------|--------|------|
| 01 | Prompt Injection | Manifest pre-scan for suspicious patterns; skill trust-score gate | ✅ | `skill-auditor.test.ts`, `trust-score.test.ts` |
| 02 | Data Leakage | In-process `EbpFir` (egress filter) + local-only memory | ✅ App-layer / ⚠️ eBPF kernel-layer pending | `exploit-demonstration.test.ts` |
| 03 | Sandbox Escape | V8 Isolate with fail-closed; no `new Function` / `safe-eval` | ✅ | `exploit-demonstration.test.ts` (dynamic proof) |
| 04 | Agent Hijacking | Vault credential injection scoped per-agent; manifest-gated | ✅ | `manifest/engine.test.ts` |
| 05 | Overtrusting | 3-tier progressive disclosure; explicit permissions in frontmatter | ✅ | `format-converter.test.ts` |
| 06 | Unbounded Execution | `MAX_STEPS` + wall-clock timeout (5s per exec, 30s per task) | ✅ | `exploit-demonstration.test.ts` (DoS tests) |
| 07 | Memory Poisoning | Importance scoring + decay (L2 episodic → L3 semantic) | ✅ | `memory/manager.test.ts` |
| 08 | Credential Exposure | Vault injection via Manifest; apiKey never logged | ✅ | `vault/injector.test.ts` |
| 09 | Intent Misalignment | Every operation logged + manifest-authorized | ✅ | `lifecycle-audit.test.ts` |
| 10 | Model Poisoning | Skill trust-score scanner; security-scorer penalty system | ✅ | `security-scorer.test.ts` |

### 3.2 Verified Attack Vectors (Dynamic)

These are **runtime proofs**, not grep checks — hostile code executes inside a real `isolated-vm` and is blocked:

| # | Attack | Result | Test Location |
|---|--------|--------|---------------|
| 1 | Secret leakage via `globalThis` | ❌ blocked | `exploit-demonstration.test.ts` |
| 2 | `process.binding('spawn_sync')` | ❌ blocked | `exploit-demonstration.test.ts` |
| 3 | `require('child_process')` | ❌ blocked | `exploit-demonstration.test.ts` |
| 4 | `child_process.execSync("id")` | ❌ blocked | `exploit-demonstration.test.ts` |
| 5 | Infinite loop (DoS) | ⏱ timeout at 5s | `exploit-demonstration.test.ts` |
| 6 | Memory bomb (1 GB alloc) | ❌ OOM capped | `exploit-demonstration.test.ts` |
| 7 | Host path leakage in errors | ❌ no paths leaked | `exploit-demonstration.test.ts` |
| 8 | Obfuscated code (string concat) | ❌ blocked | `exploit-demonstration.test.ts` |
| 9 | CPU-burning loop | ⏱ timeout at 5s | `exploit-demonstration.test.ts` |
| 10 | Source audit (no `new Function`/`safe-eval`) | ✅ PASS | `exploit-demonstration.test.ts` |

**Platforms verified**: macOS (arm64) × Node 20/22/24 + Linux (x64) × Node 20/22/24. Windows runs the same suite in CI.

### 3.3 SOC2 Control Coverage

| SOC2 Control | Aether Evidence | Status |
|--------------|----------------|--------|
| CC1: Control Environment | Apache-2.0, CODE_OF_CONTRIBUTING, open governance | ✅ |
| CC2: Communication | HMAC audit log, MessageBus encryption | ✅ |
| CC3: Risk Assessment | Threat model (this doc), exploit tests | ✅ |
| CC4: Monitoring | Auto-recorded lifecycle events (`lifecycle-audit.test.ts`) | ✅ |
| CC5: Control Activities | Manifest pre-validation, egress filtering, sandbox | ✅ |
| CC6: Logical Access | Token auth, per-agent sandbox, Manifest allowlists | ✅ |
| CC7: System Operations | V8 fail-closed, timeout enforcement | ✅ |
| CC8: Change Management | Git + ADRs + SDD batches | ✅ |
| CC9: Risk Mitigation | `aether-audit export --format=soc2` (full coverage report) | ✅ |

Run: `aether-audit export ./audit-soc2.json --format=soc2` → produces CC1–CC9 coverage with integrity proof.

---

## 4. Known Limitations (Honest)

These are out of scope for v0.1.0 and **will not be hidden**:

| Limitation | Impact | Planned Mitigation |
|------------|--------|-------------------|
| Side-channel attacks (Spectre class) | Shared hardware may leak data across isolates | WASM-based isolation (Phase 2, `roadmap/long-term.md`) |
| eBPF kernel layer not integrated on macOS dev | macOS devs get app-layer firewall only; no kernel enforcement | Planned for Phase 2 (ADR-006) |
| Bedrock SigV4 only covers InvokeModel (not Converse API) | Limited Bedrock API surface | Follow-up batch |
| `isolated-vm` binding requires native compilation | Some CI / platforms may lack prebuilt binaries | Graceful skip (test suite handles this) |
| No formal SOC2 certification yet | Audit log + controls exist; external audit pending | Pre-1.0 milestone |

---

## 5. Verification Commands

```bash
# 1. Verify the audit chain hasn't been tampered with
aether-audit verify

# 2. Export a SOC2-grade artifact with control coverage
aether-audit export ./audit-soc2.json --format=soc2

# 3. Run the full exploit-demonstration suite (dynamic proof)
npx vitest run packages/gateway/src/sandbox/exploit-demonstration.test.ts

# 4. Scan a skill for trust issues
aether-audit trust-score ./skills/my-skill.md

# 5. Verify no unsafe eval patterns in source
grep -rnE 'new\s+Function\(|runSafeEval|safe-eval' packages/gateway/src
# Expected: only hits in test files (bridge.test.ts)

# 6. Full test suite (575 tests)
npm test
```

---

## 6. Kill Criteria

This threat model is invalidated if:

1. `aether-audit verify` returns `valid: false` in production → investigate immediately
2. Any exploit-demonstration test passes on a competitor but fails on Aether → revert the PR
3. Aether begins messaging "privacy-first" / "sovereign" / "548 tests" instead of "verified execution on your hardware"
4. Sandbox audit logging becomes optional or best-effort
5. The project chases OpenClaw's skill registry count as a success metric

---

*This document is a living artifact. It is reviewed quarterly and updated whenever a new attack vector is discovered or a control is added.*
