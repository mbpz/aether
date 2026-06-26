---
name: Feature request
about: Suggest a new capability for Aether
title: "[feature] "
labels: ["enhancement", "needs-triage"]
---

## Problem

<!-- What user-facing problem are you solving? Aether is a privacy-first agent runtime — frame in terms of: "agent X can't do Y because Z". -->

## Proposed solution

<!-- A clear and concise description of what you want to happen. -->

## Alternatives considered

<!-- What other approaches did you think about, and why is this one better? -->

## Touch points

<!-- Which parts of the codebase would this affect? Mark all that apply. -->

- [ ] Sandbox (`packages/sandbox/`) — execution layer
- [ ] Gateway (`packages/gateway/`) — HTTP/WS control plane
- [ ] Skill loader (`packages/skill-loader/`) — SKILL.md / OpenClaw / Manus / Skillpack
- [ ] Memory (`packages/gateway/src/memory/`) — L1/L2/L3
- [ ] Multi-agent (`packages/gateway/src/multi-agent/`) — MessageBus / TeamOrchestrator
- [ ] eBPF agent (`deploy/ebpf/`) — XDP kernel layer
- [ ] Helm chart (`deploy/helm/aether/`) — K8s deployment
- [ ] Compliance (`packages/gateway/src/compliance/`) — SOC2/GDPR/HIPAA/ISO27001
- [ ] Documentation / roadmap / ADR

## Out of scope

<!-- What is explicitly NOT part of this request? E.g. "I don't need HTTP push to the eBPF agent — file-based YAML sync is fine". -->

## Size estimate

- [ ] Small (< 1 day, ~ 100 LOC, no ADR needed)
- [ ] Medium (1-3 days, ~ 500 LOC, may need a new ADR)
- [ ] Large (> 3 days, requires new package or breaking change; needs an ADR + roadmap update)

## Linked ADRs / docs

<!-- If this feature has a design document or matches an existing ADR, link it. -->

- ADR: <!-- e.g. docs/adr/006-ebpf-yaml-sync.md -->
- Roadmap: [requirements/roadmap.md](requirements/roadmap.md)
- Design doc: <!-- link if any -->

## Will you submit a PR?

- [ ] Yes — I can implement this and submit a PR
- [ ] No — I'm requesting it but won't have time to implement soon
- [ ] Maybe — depends on maintainer feedback
