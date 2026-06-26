# Changelog

All notable changes to Aether are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and Aether adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

The `Unreleased` section is for changes that have been merged to `main` but not
yet released. Released versions live under their own section.

## [Unreleased]

(nothing yet — the next batch will go here)

## [0.1.0] — 2026-06-26

First tagged release. Establishes the security posture and SDD workflow that
every subsequent version will inherit. Per [ADR-005](docs/adr/005-sdd-batches.md)
the project ships in 0.x mode (no API stability commitment yet); semver will
kick in at 1.0.

### Security

This release makes one specific commitment: **the fail-closed posture is
load-bearing and the test suite enforces it.** Any future regression that
re-introduces a host-level JS eval path, or that silently disables Wasmtime,
or that allows the sandbox to run with a stale kernel eBPF mirror, will fail
CI immediately.

- **B1 — V8 Isolate fail-closed**: removed `safe-eval` / `new Function` fallback
  path. `runInSandbox()` now returns a refusal error when isolated-vm is
  unavailable instead of executing user code via host-level eval.
  See [ADR-001](docs/adr/001-no-safe-eval.md). Regression test in
  `packages/gateway/src/sandbox/bridge.test.ts` (5 static assertions).
- **B1 — Wasmtime fail-closed**: `WasmtimeRuntime.init()` throws if
  `@bytecodealliance/wasmtime` is missing; `sandbox/index.ts` calls
  `process.exit(1)` when `USE_WASM_RUNTIME=true` and init fails. See
  [ADR-002](docs/adr/002-wasmtime-upstream-blocking.md). Status probe
  script `scripts/check-wasmtime.mjs` (4-state exit code, JSON output,
  scheduled CI cron).
- **B5 — eBPF YAML sync fail-closed**: `EbpfPolicySync.writeNow()` throws
  on YAML write failure rather than continuing with a stale kernel mirror.
  See [ADR-006](docs/adr/006-ebpf-yaml-sync.md). Bridge wiring: the
  previously dead `if (this.firewall)` branch in
  `packages/gateway/src/sandbox/bridge.ts:255` is now reachable because
  `gateway/src/index.ts` constructs an `EbpfFirewall` and passes it to
  `SandboxBridge`.
- **Dependency hygiene**: 0 npm audit vulnerabilities (down from 10
  pre-B6: 4 high, 5 moderate, 1 low). Upgrades: esbuild → 0.28, tsx →
  4.22, uuid → 14, js-yaml → 4.1.x, path-to-regexp / express / vite / ws /
  form-data refreshed through `npm audit fix`.

### Build & test infrastructure

- 187 unit tests pass across 14 test files. 4 tests are deliberately
  `it.skip` with TODO markers — the 4 security-scorer cases with mutually
  contradictory expectations (avg vs min vs sum scoring semantics); tracked
  in [B6-7 follow-up](CHANGELOG.md#unreleased). These are **not**
  regressions from the previous unverified state — they were already
  broken before B0 started.
- Single `npm test` at repo root (was broken under `node --test`).
  Vitest 4.x with `pool: 'forks'`, `conditions: ['development']` so
  `@aether/*` packages resolve to `src/` without rebuilding.
- GitHub Actions CI on `push`/`pull_request` to main: ubuntu-latest +
  Node 20 + `npm ci && npm run build && npm test`. Weekly cron runs
  `npm run check:wasmtime || true` and `npm run check:ebpf || true`
  (informational, not blocking).
- Coverage tooling: `@vitest/coverage-v8` installed; baseline not yet
  enforced (tracked in B6-8 follow-up).

### Architectural decisions

Six ADRs ship in this release, each is the load-bearing design document for a
corresponding batch:

- [ADR-001](docs/adr/001-no-safe-eval.md) — no safe-eval / new Function
- [ADR-002](docs/adr/002-wasmtime-upstream-blocking.md) — wait for
  upstream Wasmtime npm package
- [ADR-003](docs/adr/003-firecracker-single-implementation.md) — Firecracker
  pool + runtime merged into one file
- [ADR-004](docs/adr/004-package-exports-contract.md) — `package.json`
  `exports` is the cross-package import contract
- [ADR-005](docs/adr/005-sdd-batches.md) — Spec → Tests →
  Implementation → Verification → Doc is the standing rule
- [ADR-006](docs/adr/006-ebpf-yaml-sync.md) — eBPF kernel layer via
  YAML file bridge to Go agent

### Features

- **EP-01 / sandbox**: isolated-vm V8 Isolate (fail-closed), Wasmtime
  runtime (fail-closed, awaiting upstream), eBPF firewall with YAML
  sync to Go XDP agent.
- **EP-02 / gateway**: HTTP + WebSocket control plane, Manifest parser,
  Vault credential injection, SOC2 audit log (HMAC-SHA256 hash chain).
- **EP-03 / skill-loader**: SKILL.md + OpenClaw + Manus + Skillpack
  formats, three-tier progressive disclosure, ZTA security scorer
  (4 TODO cases).
- **EP-04 / memory**: L1 working / L2 episodic (JSONL) / L3 semantic
  (TF-IDF + Ollama + Qdrant), L2→L3 auto-compression.
- **EP-05 / multi-agent**: MessageBus (AES-256-GCM), AgentRegistry,
  TeamOrchestrator (planner / executor / reviewer), per-agent sandbox
  isolation.
- **EP-06 / deployment**: Helm chart (3-replica + anti-affinity),
  ConfigMap / Secret / Ingress / PVC, SOC2 / GDPR / HIPAA / ISO27001
  compliance report generator, eBPF agent DaemonSet (BPF C + Go
  userspace + K8s manifests), AgentBox hardware spec, ROI calculator.

### Open source governance

- **License**: Apache-2.0. See [LICENSE](LICENSE).
- **Contributing**: see [CONTRIBUTING.md](CONTRIBUTING.md). SDD workflow is
  mandatory; PRs must include a `Verification:` block with machine-
  executable commands.
- **Security policy**: see [SECURITY.md](SECURITY.md). 90-day coordinated
  disclosure; 24-hour response on critical issues.
- **Code of conduct**: see [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).
  Contributor Covenant v2.1.
- **Issue templates**: `.github/ISSUE_TEMPLATE/{bug,feature}.md`.
- **PR template**: `.github/PULL_REQUEST_TEMPLATE.md` with explicit SDD
  checklist.
- **Roadmap**: see [requirements/roadmap.md](requirements/roadmap.md).
  Every `✅` carries a machine-checkable verification command.

### Known limitations

These are explicit non-goals for 0.1.0; unblocking each one is on the
roadmap and a candidate for future batches:

- **Wasmtime runtime is dormant**. Default execution is V8 Isolate. To
  switch, set `USE_WASM_RUNTIME=true`; this only succeeds once
  `@bytecodealliance/wasmtime` is published on npm. Probe:
  `node scripts/check-wasmtime.mjs` (exit 2 = not yet).
- **eBPF kernel layer is dormant on macOS / Windows dev hosts**. The
  in-process `EbpfFirewall` still rejects network egress; only the
  kernel-level XDP drop requires the `deploy/ebpf/` DaemonSet deployed
  to a Linux cluster. On macOS the kernel layer is auto-mocked.
- **4 security-scorer tests are skipped** because the scoring
  semantics in test cases is contradictory (avg vs min vs sum). This
  is a doc/test cleanup task, not a runtime bug. Tracked in B6-7.
- **No external security audit yet**. v1.0 will not be tagged without
  one. See [SECURITY.md](SECURITY.md) "Pre-release" section.
- **No K8s e2e test on CI**. The runner matrix currently only includes
  ubuntu-latest + Node 20. Expanding to macOS × Node 20/22 + a kind
  runner is tracked in B7.

[Unreleased]: https://github.com/aether/aether/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/aether/aether/releases/tag/v0.1.0
