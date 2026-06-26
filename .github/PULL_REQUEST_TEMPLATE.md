## Summary

<!-- One or two sentences on what this PR does. -->

## Batch / ADR

<!-- If this PR implements part of a planned SDD batch, link it. Otherwise write "N/A". -->

Batch: (B0 止血 | B1 安全回归 | B2 测试+CI | B3 架构债 | B4 校准 | B5 eBPF | B6+ 开源治理)
ADR: [docs/adr/NNN-name.md](docs/adr/NNN-name.md) (or N/A)

## Type of change

- [ ] Bug fix (non-breaking change that fixes an issue)
- [ ] New feature (non-breaking change that adds functionality)
- [ ] Breaking change (fix or feature that would cause existing functionality to change)
- [ ] Refactor (no functional change, just code cleanup)
- [ ] Documentation update

## SDD checklist (per [CONTRIBUTING.md](CONTRIBUTING.md) / [ADR-005](docs/adr/005-sdd-batches.md))

- [ ] **Spec** — PR description explains what / what not / acceptance criteria
- [ ] **Tests** — failing test written first, now green (TDD red → green)
- [ ] **Implementation** — minimal change to make tests green; no unrelated refactors in same PR
- [ ] **Verification** — local run of `npm run build` (exit 0) and `npm test` (exit 0) included in PR description
- [ ] **Doc** — if behavior changed, ADRs and/or roadmap verification commands updated

## Pre-merge hard requirements (per [CONTRIBUTING.md](CONTRIBUTING.md))

- [ ] `npm run build` exit 0
- [ ] `npm test` exit 0
- [ ] No `../../../` cross-package relative paths (`grep -rn "\.\./\.\./\.\." packages/*/src/`)
- [ ] No new `new Function(` / `safe-eval` / `runSafeEval` (CI guard)
- [ ] If touched `EbpfFirewall` or `EbpfPolicySync`, ran the eBPF integration smoke (`npm run check:ebpf`)

## Test plan

<!-- How did you verify this works? Include commands you ran, output snippets, and any manual smoke test. -->

```bash
# commands you ran locally
npm run build
npm test
# optional
node scripts/check-ebpf-agent.mjs --json
```

## Risks and rollback

<!-- What could this break? If something goes wrong post-merge, what's the rollback plan? -->

- Risk: <!-- e.g. existing audit-log format may shift if I changed AuditEntry shape -->
- Rollback: <!-- e.g. revert merge commit; data format is forward-compatible because... -->

## Checklist

- [ ] My code follows the project's style (per `firecracker.test.ts` / `bridge.test.ts` conventions)
- [ ] I have performed a self-review of my own code
- [ ] I have commented my code, particularly in hard-to-understand areas
- [ ] My changes generate no new warnings
- [ ] Any dependent changes have been merged and published

## Related issues / ADRs

<!-- Link any GitHub issues, ADRs, or design docs that this PR resolves. -->

Fixes #<!-- issue number, if any -->
Related: [ADR-NNN](docs/adr/NNN-name.md)
