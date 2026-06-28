---
slug: /reference/security
title: Security Model
sidebar_label: Security
---

# Security Model

This page is the production-side companion to
[SECURITY.md](../../community/security.md) (the disclosure process).
It describes what's actually implemented in v0.3.0 and what is
explicitly out of scope.

## Currently implemented (verified by tests)

| OWASP Agentic Top 10 | Aether mitigation | Test |
|------|------------------|------|
| 01 Prompt Injection | Manifest pre-validation + SkillSecurityAuditor | `packages/skill-loader/src/audit/skill-auditor.test.ts` |
| 02 Data Leakage | eBPF firewall (app-layer hot path + kernel XDP drop) | `packages/gateway/src/sandbox/ebpf-firewall.test.ts` + `ebpf-policy-sync.test.ts` |
| 03 Sandbox Escape | V8 Isolate (fail-closed per ADR-001) | `packages/gateway/src/sandbox/bridge.test.ts` |
| 04 Agent Hijacking | Vault credential injection + zero-trust per-session keys | `packages/gateway/src/vault/injector.test.ts` |
| 05 Overtrusting | Three-tier skill disclosure (Level 1 metadata only by default) | `packages/skill-loader/src/registry/registry.test.ts` |
| 06 Unbounded Execution | MAX_STEPS=10 + timeout in CodeActEngine | `packages/sandbox/src/codeact/engine.test.ts` |
| 07 Memory Poisoning | Importance scoring + forgetting + L2→L3 compaction | `packages/gateway/src/memory/manager.test.ts` |
| 08 Credential Exposure | Vault TTL + ephemeral session keys | `packages/gateway/src/vault/injector.test.ts` |
| 09 Intent Misalignment | Audit log + Manifest validation | `packages/gateway/src/audit/logger.test.ts` |
| 10 Model Poisoning | Skill signature + ZTA security scoring | `packages/skill-loader/src/audit/security-scorer.test.ts` |

## Cryptography

- **HMAC-SHA256** for the audit log hash chain (B1 fix in B6).
  Required key length: ≥ 32 characters. Default file permissions on
  `runtime/audit/*.jsonl`: 0600 (single-user mode).
- **AES-256-GCM** for cross-agent messages via `MessageBus`.
  Per-message nonce. Per-session key. Re-encrypted on every queue
  pass so plaintext never hits memory beyond the immediate
  publish/consume boundary.
- **Argon2id** for vault secret hashing. Default time cost = 100ms,
  parallelism = 1.

## TLS

TLS termination is **not** built into Aether itself. The
recommendation is to front the gateway with a reverse proxy (nginx,
Caddy, envoy, or the demo's `nginx-ingress` in
[`deploy/helm/aether/values-demo.yaml`](https://github.com/aether/aether/blob/main/deploy/helm/aether/values-demo.yaml)).
For the demo, cert-manager + let's encrypt provides a wildcard
certificate covering all `*.aether-demo.example.com` sub-domains.

## AuthN / AuthZ

- `LOCAL_API_TOKEN` is a single bearer token configured per gateway.
  When `LOCAL_TOKEN_AUTH_REQUIRED=true` (the default), every
  `/api/*` route requires `Authorization: Bearer <token>`.
- `AUDIT_READ_TOKEN` is an optional second token that gates access
  to `/api/audit/*` endpoints. Recommended for separating
  read-only auditor access from operational write access.
- **Multi-tenancy is not implemented** in v0.3.0. The gateway has
  a single token per process. A future v0.4 batch will add per-agent
  scoped tokens via OAuth/OIDC.

## Threat model — what we defend against

- Prompt injection that would cause the agent to exfiltrate data
- Skill substitution (replacing one skill with another that has
  different permissions)
- Credential theft (stealing `LOCAL_API_TOKEN`)
- Audit log tampering (back-dating or deleting entries)
- Network-layer exfiltration (sandbox opens a socket and dials
  home) — **kernel-level** enforcement via the eBPF XDP drop
- Long-running runaway loops (`while(true){}`) — bounded by
  `MAX_STEPS=10` and `MAX_EXEC_TIME_MS=30000`

## Threat model — what we do NOT defend against

- A compromised Node.js runtime (assumed trustworthy)
- A compromised Linux kernel (BPF programs can be unloaded by root)
- Side-channel attacks on shared hardware (Spectre, Rowhammer)
- A compromised user account with valid `LOCAL_API_TOKEN`
  (treat the token as a root credential; rotate quarterly)
- DDoS at the public ingress (no rate limiting; nginx-ingress
  has a basic rate-limit module but the demo doesn't enable it)

## Production posture

For the demo: see the
[deploy/k3s/README.md](https://github.com/aether/aether/blob/main/deploy/k3s/README.md)
operator runbook.

For production: Aether has not been externally audited as of v0.3.0.
**v1.0 will not be tagged without an external security audit** —
see [SECURITY.md](../../community/security.md) "Pre-release" section.
