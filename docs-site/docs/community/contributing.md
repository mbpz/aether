---
slug: /community/contributing
title: Contributing
sidebar_label: Contributing
---

# Contributing

See the canonical
[CONTRIBUTING.md](https://github.com/aether/aether/blob/main/CONTRIBUTING.md)
in the repository root.

## TL;DR

Aether follows the **Spec → Tests → Implementation → Verification → Doc**
cycle (see
[ADR-005](architecture/adr/005-sdd-batches.md)).
Every PR must include a `Verification:` block in the commit message
with machine-executable commands (`npm run build`, `npm test`,
`grep ...`).

Before submitting a PR:

1. [Read the SDD checklist](https://github.com/aether/aether/blob/main/CONTRIBUTING.md#hard-requirements)
2. Run `npm run build` (must exit 0)
3. Run `npm test` (must exit 0)
4. Run `npm audit` (must be 0 vulnerabilities)
5. Search existing issues / ADRs for prior art

For the demo workflow (separate from core PRs), see
[deploy/k3s/README.md](https://github.com/aether/aether/blob/main/deploy/k3s/README.md).
