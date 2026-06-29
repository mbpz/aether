# Changelog

All notable changes to Aether are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and Aether adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

The `Unreleased` section is for changes that have been merged to `main` but not
yet released. Released versions live under their own section.

## [Unreleased]

(nothing yet — the next batch will go here)

## [0.4.0] — 2026-06-29

The "publishable + try-it" release. v0.4.0 marks the point at which Aether
is mature enough for a new contributor to onboard without writing
code first: 1-click demo deploy, public docs site, multi-LLM support,
test coverage past 50%. Per [ADR-005](docs/adr/005-sdd-batches.md) we
ship in 0.x mode (no API stability commitment yet); semver kicks in at
1.0. The major-bump from v0.3.x is a project-versioning convention,
not a semver signal — public API hasn't changed since v0.1.0.

### What's new since v0.1.0

This release spans 18 batches (B0–B14) and 7 v0.3.x point releases
that retrofited tests, governance, and the demo workflow. Highlights:

- **Coverage: 19.68% → 53.58% statements.** 526 tests passing across
  47 test files. Zero skipped tests, zero `npm audit` vulnerabilities.
  The remaining 46% is concentrated in Express HTTP routes (require
  supertest infrastructure to exercise) and the Wasmtime runtime
  (blocked on upstream).
- **10 Architecture Decision Records** documented:
  - [ADR-001](docs/adr/001-no-safe-eval.md) — sandbox fail-closed
  - [ADR-002](docs/adr/002-wasmtime-upstream-blocking.md) — wait for Wasmtime npm
  - [ADR-003](docs/adr/003-firecracker-single-implementation.md) — single implementation
  - [ADR-004](docs/adr/004-package-exports-contract.md) — cross-package contract
  - [ADR-005](docs/adr/005-sdd-batches.md) — SDD workflow
  - [ADR-006](docs/adr/006-ebpf-yaml-sync.md) — eBPF YAML bridge
  - [ADR-007](docs/adr/007-scoring-semantics.md) — min vs avg vs sum resolution
  - [ADR-008](docs/adr/008-self-hosted-k3s-demo.md) — self-hosted k3s on VPS
  - [ADR-009](docs/adr/009-demo-runbook.md) — operator runbook
  - [ADR-010](docs/adr/010-multi-llm-provider.md) — multi-LLM provider dispatch
- **1-click demo deploy** ([B11](https://github.com/aether/aether/tree/main/examples/skills/))
  with 5 demo skills (hello-world, csv-summary, dns-lookup,
  memory-recall, git-status), a `values-demo.yaml` chart, and a
  `deploy-demo.yml` GitHub workflow.
- **Operator runbook** ([B12](https://github.com/aether/aether/blob/main/deploy/k3s/README.md))
  for the Hetzner CX11 demo cluster — `install.sh` one-shot installer
  + 7-step runbook covering VPS provisioning, DNS, secrets, day-2
  operations, and 3 likely failure modes.
- **Docusaurus documentation site** ([B10](https://github.com/aether/aether/tree/main/docs-site/))
  published to GitHub Pages: 12 pages including per-module reference,
  architecture overview, OWASP Agentic Top 10 coverage, and a
  roadmap.
- **Multi-LLM provider dispatch** ([B16](docs/adr/010-multi-llm-provider.md))
  — 7 supported providers: OpenAI, Ollama, OpenRouter, custom
  (OpenAI-compat), Anthropic (x-api-key + Messages API), Google
  Gemini (API key in query string), and AWS Bedrock (in-tree SigV4
  signing, no AWS SDK dep).
- **Terminal recordings** ([B13](https://github.com/aether/aether/tree/main/docs/assets/tapes/))
  for 3 demo skills — vhs tape files for reproducible GIF generation.
- **Open-source governance** (B6, [CONTRIBUTING.md](CONTRIBUTING.md)):
  Apache-2.0 license, 90-day coordinated disclosure, Contributor
  Covenant v2.1, SDD-checklist PR template.
- **CI matrix** (B7): ubuntu + macos × Node 20 + 22. Weekly cron
  probes upstream Wasmtime (ADR-002) + eBPF agent health.
- **npm publish pipeline with provenance** (B7): OIDC-based, no
  NPM_TOKEN secret needed.

### Bug fixes found by retro-fit

Each B8 retro-fit round found at least one latent bug:

- **B8.1**: `qdrant-store.ts` fallback mode silently drops upserts
  (documented as KNOWN ISSUE in source).
- **B8.3**: `skill-parser.ts` `extractSections` regex truncated at any
  blank line → Level 2 was always undefined.
- **B8.3**: `skill-parser.ts` didn't read `## Dependencies` section
  into `level3.dependencies`.
- **B8.4**: `compliance/report-generator.ts` `controlsNotApplicable`
  was computed but never returned; `ComplianceSummary` interface
  didn't even declare the field.

### Known limitations

- **Coverage at 53.58%, not 70%**: B14 hit diminishing returns.
  Remaining 0%-coverage files are Express HTTP routes that need
  supertest infrastructure to exercise. Tracked as a v0.4.x
  follow-up batch.
- **Wasmtime runtime dormant** until
  `@bytecodealliance/wasmtime` ships on npm. Weekly cron probe in
  `scripts/check-wasmtime.mjs` (ADR-002).
- **eBPF kernel layer** runs only against a Linux host with the
  `deploy/ebpf/` DaemonSet deployed. macOS / Windows dev hosts
  auto-mock.
- **No external security audit yet** — v1.0 will not be tagged
  without one (per SECURITY.md "Pre-release" section).
- **K8s e2e on CI** needs a self-hosted runner with /dev/kvm.
  Tracked as B15.

[Unreleased]: https://github.com/aether/aether/compare/v0.4.0...HEAD
[0.4.0]: https://github.com/aether/aether/releases/tag/v0.4.0
[0.3.0]: https://github.com/aether/aether/compare/v0.2.2...v0.3.0
[0.2.2]: https://github.com/aether/aether/compare/v0.2.1...v0.2.2
[0.2.1]: https://github.com/aether/aether/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/aether/aether/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/aether/aether/releases/tag/v0.1.0

## [0.3.x] — 2026-06-30 (B11, B12, B13, B10, B16, B14.6-7)

Eight point releases in the v0.3 series shipped the user-facing
surface beyond code: 1-click demo deploy (B11), operator runbook
(B12), terminal recordings + arch diagram (B13), docusaurus
documentation site (B10), multi-LLM provider dispatch (B16), and
two B14 coverage follow-ups.

- **B11 (v0.3.0)** — 1-click demo deploy via
  `examples/skills/{5 SKILL.md}` + `values-demo.yaml` + the
  `deploy-demo.yml` GitHub workflow. Public demo at
  https://aether-demo.example.com/.
- **B12 (v0.3.1)** — `deploy/k3s/install.sh` one-shot VPS
  installer + `deploy/k3s/README.md` operator runbook. ADR-009
  documents the choice of self-hosted k3s on a €5/mo Hetzner VPS
  over fly.io / render / cloud-K8s.
- **B13 (v0.3.2)** — `docs/assets/architecture.mmd` (Mermaid
  source) + 3 vhs tape files (`docs/assets/tapes/01-hello-world.tape`
  + 2 more for csv-summary / memory-recall) + README arch diagram
  replacement.
- **B10 (v0.3.3)** — `docs-site/` docusaurus 3 site with 12
  pages (intro, quickstart, roadmap, 3 architecture pages incl.
  ADR symlinks, 4 module pages, 4 reference pages, 4 community
  pages). `.github/workflows/docs.yml` deploys to GitHub Pages.
  `sidebars.js` auto-generates the ADR list from `docs/adr/README.md`.
- **B16 (v0.3.4)** — Multi-LLM provider dispatch: `anthropic` /
  `gemini` / `bedrock` native alongside the existing
  OpenAI-compatible path. In-tree AWS SigV4 signing for Bedrock
  (~50 lines, no AWS SDK dep). 5 new dispatch tests. ADR-010
  documents the in-tree SigV4 choice.
- **B14.6-7 (v0.3.5, v0.3.8)** — `manus-importer.extra.test.ts` +
  `openclaw-migrator.extra.test.ts`. 17 new tests.
- **B14 (v0.3.5–v0.3.7)** — coverage 50.37% → 53.56% over four
  v0.3.x point releases. `marketplace.test.ts`,
  `format-detector.test.ts`, `bounty.test.ts`,
  `kata-manager.test.ts`, `team-orchestrator.test.ts`,
  `report-generator.test.ts` extra cases.

## [0.2.x] — 2026-06-27 (B6, B7, B8.1-5)

Three v0.2 point releases: B6+B7 governance+CI, then B8.1 → B8.5
retro-fit 25+ files to lift coverage from 19.68% to 50.37%.

- **v0.2.0 (B6+B7)** — Apache-2.0 LICENSE, SECURITY.md (90-day
  coordinated disclosure), CODE_OF_CONDUCT.md (Contributor
  Covenant v2.1), CHANGELOG.md (Keep a Changelog 1.1), Issue +
  PR templates, GH Actions CI matrix (ubuntu + macos × node 20+22),
  npm publish pipeline with provenance, `.npmrc` (provenance,
  engine-strict, save-exact).
- **v0.2.1 (B8.4)** — `agent-loop/runner.test.ts` (10 tests) +
  `compliance/report-generator.test.ts` (8 tests + 1 compliance
  fix). Coverage 42.17% → 46.46%.
- **v0.2.2 (B8.5)** — `llm/planner.test.ts` (6 tests) +
  `bounty.test.ts` (8 tests) + `review-workflow.test.ts` (13 tests).
  Coverage 46.46% → 50.37% — first release past the 50% threshold.

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
