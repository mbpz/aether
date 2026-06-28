---
slug: /modules/gateway
title: Gateway
sidebar_label: Gateway
---

# Gateway Module

`@aether/gateway` is the HTTP/WebSocket control plane. It validates
manifests, injects vault credentials, runs the agent loop, manages
multi-agent collaboration, and writes hash-chained audit logs.

## Entry point

`packages/gateway/src/index.ts` constructs:

- An `AuditLogger` (with HMAC-SHA256 chain)
- A `ManifestEngine` (skill registry + manifest validation)
- A `VaultInjector` (transient credential injection)
- A `TaskQueue` (per-task lifecycle)
- A `SandboxBridge` (fail-closed, ADR-001)
- A `MemoryManager` (three-tier, ADR + memory page)
- A `TeamOrchestrator` (planner/executor/reviewer)
- An HTTP/WS server via `createGatewayServer()`

## HTTP API

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/health` | Liveness — returns `{ status: 'ok', system, timestamp }` |
| `GET` | `/api/status` | Gateway status (memory, agent registry, audit counts) |
| `GET` | `/api/skills` | List all registered skills (Level 1 metadata) |
| `GET` | `/api/skills/:id` | Progressive disclosure: Level 1 (default), `?level=2` includes instructions, `?level=3` includes code |
| `POST` | `/api/agent/execute` | Submit code for execution in the sandbox. Body: `{ manifestName, code, input? }` |
| `POST` | `/api/agent/team` | Multi-agent team task: `{ teamId, task, mode: 'sequential'\|'parallel'\|'hierarchical' }` |
| `GET` | `/api/audit/recent` | Recent audit log entries (read role required) |
| `GET` | `/api/audit/range?start=...&end=...` | Time-range audit query |

## Configuration

| Env var | Default | Meaning |
|---------|---------|---------|
| `GATEWAY_PORT` | `18790` | HTTP/WS port |
| `LOCAL_API_TOKEN` | (empty) | Bearer token; auto-generated if empty and `LOCAL_TOKEN_AUTH_REQUIRED=true` |
| `LOCAL_TOKEN_AUTH_REQUIRED` | `true` | When `true`, `/api/*` requires a valid token |
| `READONLY_MODE` | `true` | When `true`, write endpoints (e.g. `/api/agent/execute`) reject with 403 |
| `MEMORY_DIR` | `./memory-store` | Where L2 JSONL files + L3 index live |
| `MEMORY_WINDOW` | `50` | L1 working memory cap (entries) |
| `LLM_BASE_URL` | (empty) | OpenAI-compatible LLM endpoint |
| `LLM_MODEL` | (empty) | Model name (e.g. `gpt-4o`, `deepseek-r1`) |
| `LLM_API_KEY` | (empty) | LLM auth key |
| `AUDIT_LOG_DIR` | `./runtime/audit` | Where audit JSONL files live |
| `AUDIT_SIGNING_KEY` | (required) | HMAC-SHA256 key for the audit hash chain. Minimum 32 chars |
| `AUDIT_READ_TOKEN` | (empty) | Required to access `/api/audit/*` endpoints |

## See also

- [Sandbox module](sandbox.md) — the runtime that backs every `/api/agent/execute`
- [Skill loader module](skill-loader.md) — how skills are parsed
- [eBPF module](ebpf.md) — the kernel-layer enforcement
- [Security policy](../community/security.md) — disclosure process
