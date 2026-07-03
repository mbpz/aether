# Security Policy

Aether is a **Zero-Trust** AI agent execution platform. Security is the project's foundation, not a feature. This document describes how to report vulnerabilities, our response timeline, and the security model.

## Reporting a Vulnerability

**Please do not file public GitHub issues for security-sensitive bugs.**

Email: **security@aether.local**
GPG: not yet published (see ADR-007 unblock signal)

If you do not receive an acknowledgment within 48 hours, please follow up — your report may have been caught in a spam filter.

When reporting, please include:

1. **Description** — what the vulnerability is, including the attack scenario
2. **Reproduction steps** — minimal code or commands to reproduce
3. **Impact assessment** — your view of the blast radius (sandbox escape? data leak? auth bypass?)
4. **Affected versions** — which release(s) you reproduced against
5. **Disclosure timeline** — when and how you'd like the fix to be disclosed

We will keep your identity confidential unless you request otherwise.

## Response Timeline

Aether follows a 90-day coordinated disclosure window with the following targets:

| Severity | Initial response | Status update | Patch target |
|----------|------------------|---------------|--------------|
| **Critical** (sandbox escape, RCE in agent code path) | 24 hours | every 48 hours | ≤ 7 days |
| **High** (data exfiltration, privilege escalation) | 48 hours | weekly | ≤ 30 days |
| **Medium** (DoS, info leak) | 5 business days | biweekly | ≤ 90 days |
| **Low** (configuration hygiene, minor info leak) | 10 business days | monthly | next minor release |

Critical sandbox-escape and key-management issues are **always** out of band from the public roadmap; we will ship an emergency release even between minor versions.

## Supported Versions

Aether follows semver:
- `0.1.x` — current 0.x line, in active development. Receives security patches.
- `0.0.x` — pre-release, no security support.
- `1.x.x` — first stable line. Receives security patches for 12 months after the next major release.

The current version is **0.1.0**. We will not introduce breaking API changes inside a 0.x line for anything that affects the security surface; ADR-007 (when written) will detail the policy.

## Security Posture (current state)

This is **not** a marketing claim — these are the **actually-implemented** controls as of v0.1.0:

### Fail-closed posture
- **V8 Isolate** (isolated-vm 4.x/6.x) for code execution. If the native binding fails to load, `runInSandbox()` **refuses** rather than falling back to `new Function(code)` or `vm.runInThisContext` — verified by `packages/gateway/src/sandbox/bridge.test.ts`. See [ADR-001](docs/adr/001-no-safe-eval.md).
- **Wasmtime** runtime fails closed: missing upstream `@bytecodealliance/wasmtime` package throws rather than silently disabling. Verified by `packages/sandbox/src/runtime/wasm-runtime.ts:78-86`. See [ADR-002](docs/adr/002-wasmtime-upstream-blocking.md).
- **eBPF policy sync** fails closed: if the YAML write to the Go agent's `EBPF_POLICY_PATH` fails, the sandbox process **crashes** rather than running with a stale kernel mirror. See [ADR-006](docs/adr/006-ebpf-yaml-sync.md).

### Cryptography
- HMAC-SHA256 audit log with hash chain (prevents post-hoc tampering). Key configurable via `AUDIT_SIGNING_KEY`.
- AES-256-GCM for cross-agent messages (multi-agent MessageBus). Nonce per message.
- TLS termination is **not** built into Aether itself — recommended to front with a reverse proxy (nginx, Caddy, envoy).

### AuthN/AuthZ
- `LOCAL_TOKEN_AUTH_REQUIRED=true` enables static-token auth on the gateway HTTP API.
- Per-Agent sandbox isolation — each agent in the multi-agent system has its own process boundary.

### What's NOT covered in v0.1.0 (transparency)
- Wasmtime runtime is **not** active by default — `USE_WASM_RUNTIME` env var is the only switch. Default is V8 Isolate. See ADR-002.
- eBPF XDP kernel layer is **only** active when the sandbox runs against a Linux host with the `deploy/ebpf/` DaemonSet deployed. On macOS / Windows dev, the kernel layer is stubbed; the in-process EbpfFirewall still rejects (see ADR-006).
- SOC2 compliance is **partially implemented**: the audit log + access controls exist, but the **certified** SOC2 report is not yet produced. The `packages/gateway/src/compliance/` module is a generator, not an auditor.

### RFC documents

- [Threat Model](docs/threat-model.md) — architecture-level threat model with OWASP Agentic Top 10 mapping, SOC2 control coverage, and verification commands.
- [Red Team Report](docs/red-team-report.md) — public red-team report: 10 active attack vectors, all blocked with reproducible test code.
- [Multi-Agent Compositions](docs/compositions.md) — researcher + executor composition guide.

### Sandbox attack surface (verified by `exploit-demonstration.test.ts`)

Aether's V8 Isolate sandbox is verified against 6 attack categories:

| # | Attack vector | Test | Status |
|---|--------------|------|--------|
| 1 | Secret leakage via globalThis | blocks host-side secret | ✅ BLOCKED |
| 2 | process.binding (native escape) | blocks process.binding | ✅ BLOCKED |
| 3 | require('child_process') | blocks module resolution | ✅ BLOCKED |
| 4 | child_process.execSync | blocks require/import paths | ✅ BLOCKED |
| 5 | Infinite loop (DoS) | times out at 5s | ✅ BLOCKED |
| 6 | Memory bomb (OOM) | capped at 64 MB/isolate | ✅ BLOCKED |
| 7 | Host path leakage in errors | no host paths in error messages | ✅ BLOCKED |
| 8 | Obfuscated code (string concat) | blocks dynamic module access | ✅ BLOCKED |
| 9 | CPU-burning loop | times out at 5s | ✅ BLOCKED |
| 10 | bridge.ts source audit | no new Function / safe-eval | ✅ PASS |

**Platforms verified**: macOS (arm64) × Node 20/22/24 + Linux (x64) × Node 20/22/24.
Windows runs the same suite in CI. Side-channel attacks (Spectre-class) are out of scope.

## Threat Model

Documented in [requirements/roadmap.md §6](requirements/roadmap.md) — OWASP Agentic Top 10 coverage.

Specifically: we defend against **prompt injection + tool misuse** leading to data exfiltration, **sandbox escape**, **agent hijacking via Vault credential theft**, and **unbounded execution loops**. We do **not** defend against:

- A compromised Node.js runtime (assumed trustworthy)
- A compromised Linux kernel (BPF programs can be unloaded by root)
- Side-channel attacks on shared hardware (Spectre, Rowhammer)
- A compromised user account with valid `LOCAL_API_TOKEN`

## Security Audit Cadence

- **Per PR**: CI runs `npm audit` (currently clean: 0 vulnerabilities) and `bridge.test.ts` (5 static regression tests on the fail-closed contract).
- **Per PR (sandbox matrix)**: A dedicated `sandbox-verify` CI job runs `exploit-demonstration.test.ts` (12 dynamic tests across 6 attack vectors) on `ubuntu-latest` × `macos-latest` × Node `20/22/24`. See `sandbox-verify` job in `.github/workflows/ci.yml`.
- **Quarterly**: Manual review of all eBPF C, Go agent, and SecurityPolicy changes; re-read of all ADRs.
- **Pre-release**: External audit is not yet performed. v1.0 will not be tagged without one.

## Past Security Advisories

None. Aether has not yet had a public release. The 0.1.0 tag will be the first.

## Coordinated Disclosure Hall of Fame

We are grateful to researchers who report vulnerabilities responsibly. With your permission, we will credit you in `CHANGELOG.md` after the fix ships.
