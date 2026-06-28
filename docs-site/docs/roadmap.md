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

| Metric | v0.1.0 | v0.3.2 | Target v0.4.0 |
|--------|--------|--------|--------------|
| Coverage (stmts) | 19.68% | 50.37% | 70%+ |
| Tests | 192 | 462 | 600+ |
| Audit vulns | 0 | 0 | 0 |
| ADRs | 6 | 9 | 12+ |

## Released

- **B0–B5**: Build, fail-closed sandbox, eBPF kernel layer wiring.
- **B6–B7**: Open-source governance (LICENSE, SECURITY, CoC,
  CHANGELOG), CI matrix, npm publish pipeline with provenance.
- **B8.1–B8.5**: Test retro-fit across 25+ files. Found 4 real bugs
  (qdrant-store fallback, skill-parser section regex, ## Dependencies
  parsing, compliance `controlsNotApplicable` field).
- **B11–B12**: 1-click demo deploy + operator runbook for the
  Hetzner CX11 cluster.
- **B13**: Terminal recordings (vhs tapes) + architecture diagram.

## Next (v0.4.x)

- **B14**: Coverage 50% → 70%.
- **B15**: Real K8s e2e (self-hosted runner + KVM + kind).
- **B16**: Public skill registry MVP.

## Future (v0.5.x+)

- **Wasmtime runtime** — activates as soon as
  `@bytecodealliance/wasmtime` ships on npm. See
  [ADR-002](architecture/adr/002-wasmtime-upstream-blocking.md).
- **Multi-tenant OAuth** — per-agent scoped tokens via OAuth/OIDC.
- **External security audit** — prerequisite for v1.0 tag.

For the full per-task table with verification commands, see
[`requirements/roadmap.md`](https://github.com/aether/aether/blob/main/requirements/roadmap.md).
