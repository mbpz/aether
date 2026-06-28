---
slug: /architecture/intro
title: Architecture Overview
sidebar_label: Overview
---

# Architecture Overview

Aether is a Zero-Trust runtime for AI agents. The architecture has
three primary layers, each documented in its own ADR:

## System diagram

The full Mermaid source is in
[`docs/assets/architecture.mmd`](https://github.com/aether/aether/blob/main/docs/assets/architecture.mmd).
An ASCII fallback is in the [README](https://github.com/aether/aether#架构图).

## Modules

| Module | What it does | Where to look |
|--------|-------------|---------------|
| **Gateway** | HTTP/WebSocket control plane, Manifest validation, Vault credential injection, SOC2 audit log, eBPF firewall integration | [`packages/gateway/`](https://github.com/aether/aether/tree/main/packages/gateway) |
| **Sandbox** | V8 Isolate (isolated-vm) execution, Wasmtime-ready, fail-closed posture per ADR-001/002 | [`packages/sandbox/`](https://github.com/aether/aether/tree/main/packages/sandbox) |
| **Skill loader** | SKILL.md / OpenClaw / Manus / Skillpack parsers, three-tier progressive disclosure, ZTA security scoring | [`packages/skill-loader/`](https://github.com/aether/aether/tree/main/packages/skill-loader) |
| **eBPF agent** | Default-deny XDP firewall with AES-256-GCM encrypted cross-agent messages | [`deploy/ebpf/`](https://github.com/aether/aether/tree/main/deploy/ebpf) |

## Three-tier memory

| Tier | Where | When |
|------|-------|------|
| **L1 (working)** | In-process Map | Hot path; evicted by LRU + importance |
| **L2 (episodic)** | JSONL files on disk | Session log; queryable by time range |
| **L3 (semantic)** | TF-IDF (default) or Ollama+Qdrant (optional) | Cross-session semantic search |

The L2→L3 compaction loop runs in the background. See
[`packages/gateway/src/memory/manager.ts`](https://github.com/aether/aether/blob/main/packages/gateway/src/memory/manager.ts)
for the implementation.

## eBPF kernel layer

The default in-process firewall (`EbpfFirewall`) decides whether to
accept a connection. Every rule add/remove is mirrored to a YAML file
that the Go agent (`deploy/ebpf/agent/`) hot-reloads and programs
into a BPF LPM trie (XDP mode) on the host NIC. Within ~15 seconds,
the kernel matches the same policy as the userland code — no
"smoke-and-mirrors" where the kernel allows traffic the userland
denies (or vice versa). See [ADR-006](../adr/006-ebpf-yaml-sync.md).

## Architecture Decision Records

| # | Title |
|---|-------|
| [001](../adr/001-no-safe-eval.md) | 移除 sandbox 的 `safe-eval` / `new Function` 降级 |
| [002](../adr/002-wasmtime-upstream-blocking.md) | Wasmtime npm 上游阻塞 EP-01 Phase 2 |
| [003](../adr/003-firecracker-single-implementation.md) | Firecracker 单实现：pool 概念合并进 runtime |
| [004](../adr/004-package-exports-contract.md) | package.json `exports` 作为跨包通信契约 |
| [005](../adr/005-sdd-batches.md) | SDD 分批修复流程作为工程标准 |
| [006](../adr/006-ebpf-yaml-sync.md) | eBPF 内核层集成通过 YAML 文件桥接 |
| [007](../adr/007-scoring-semantics.md) | SecurityScorer 评分语义：avg vs min 的统一 |
| [008](../adr/008-self-hosted-k3s-demo.md) | Self-hosted k3s on VPS as the demo deployment target |
| [009](../adr/009-demo-runbook.md) | Demo runbook: VPS + k3s + ingress-nginx (B12) |
