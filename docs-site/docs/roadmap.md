---
slug: /roadmap
title: Roadmap
sidebar_label: Roadmap
---

# Roadmap

This page mirrors [`requirements/roadmap.md`](https://github.com/aether/aether/blob/main/requirements/roadmap.md)
in a docusaurus-friendly format. The canonical roadmap is the file in
the `requirements/` directory — it has machine-checkable verification
commands for every `✅` claim.

## Headline metrics

| Metric | v0.1.0 | v0.3.x | **v0.4.0 (current)** |
|--------|--------|--------|--------------|
| Coverage (stmts) | 19.68% | 50.37% | **53.58%** |
| Tests | 192 | 462 | **526** |
| Audit vulns | 0 | 0 | **0** |
| ADRs | 6 | 9 | **10** |

## Released (v0.4.0)

- **B0–B5** (v0.1.0): Build, fail-closed sandbox, eBPF kernel
  layer wiring.
- **B6–B7** (v0.2.0): Open-source governance (LICENSE, SECURITY,
  CoC, CHANGELOG), CI matrix, npm publish pipeline with provenance.
- **B8.1–B8.5** (v0.2.1–v0.2.2): Test retro-fit across 25+ files.
  Found 4 real bugs (qdrant-store fallback, skill-parser section
  regex, ## Dependencies parsing, compliance
  `controlsNotApplicable` field). Coverage 19.68% → 50.37%.
- **B11** (v0.3.0): 1-click demo deploy via 5 SKILL.md + values-demo.yaml
  + deploy-demo.yml.
- **B12** (v0.3.1): `deploy/k3s/install.sh` + operator runbook
  for the Hetzner CX11 demo cluster. ADR-009.
- **B13** (v0.3.2): vhs tapes + Mermaid architecture diagram.
- **B10** (v0.3.3): Docusaurus 3 site published to GitHub Pages.
  12 pages + auto-generated ADR sidebar.
- **B16** (v0.3.4): Multi-LLM provider dispatch — Anthropic /
  Gemini / Bedrock native, in-tree AWS SigV4 signing. ADR-010.
- **B14** (v0.3.5–v0.3.8): Coverage retro-fit continuation.
  17+ new tests across 4 files (marketplace, format-detector,
  kata-manager, team-orchestrator, manus-importer, openclaw-migrator).
  Coverage 50.37% → 53.58%.

## Next (v0.5.x)

- **B15**: Real K8s e2e (self-hosted runner + KVM + kind).
- **B17**: Wasmtime runtime — activates as soon as
  `@bytecodealliance/wasmtime` ships on npm. See
  [ADR-002](architecture/adr/002-wasmtime-upstream-blocking.md).
- **Coverage push to 60%+** — focus on remaining Express routes
  (need supertest harness) and the Wasmtime runtime stub.

## Future (v1.0)

- **Multi-tenant OAuth** — per-agent scoped tokens via OAuth/OIDC.
- **External security audit** — prerequisite for the v1.0 tag.
  See [SECURITY.md](../../community/security.md) "Pre-release"
  section.

For the full per-task table with verification commands, see
[`requirements/roadmap.md`](https://github.com/aether/aether/blob/main/requirements/roadmap.md).
