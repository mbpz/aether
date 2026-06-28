---
slug: /reference/cli
title: CLI Reference
sidebar_label: CLI
---

# CLI Reference

Aether ships three top-level npm scripts at the repo root. Each
spawns a long-running process; in production you would run them as
systemd units or k8s Deployments.

| Command | Default port | What it does |
|---------|--------------|--------------|
| `npm run gateway` | `18790` | HTTP/WS control plane (see [Gateway module](../modules/gateway.md)) |
| `npm run sandbox` | `18791` | Standalone sandbox runtime. Rarely used — only when the gateway runs on a different host than the executor. |
| `npm run ui` | n/a | (placeholder — UI work deferred to B10 docs site / a future v0.4 batch) |

## Optional flags via env vars

All three processes read environment variables. See
[Gateway module](modules/gateway.md) for the full list. The most
common ones:

| Env var | Effect |
|---------|--------|
| `GATEWAY_PORT` | Override the default 18790 port |
| `LOCAL_API_TOKEN` | Set the bearer token explicitly (otherwise auto-generated on first start) |
| `READONLY_MODE=false` | Allow write endpoints (e.g. `/api/agent/execute`). Default is `true` for safety. |
| `USE_WASM_RUNTIME=true` | Switch the sandbox from V8 Isolate to Wasmtime. **Fail-closed** (ADR-002) — the process exits if the upstream npm package is missing. |
| `EBPF_POLICY_PATH` | Override the YAML path the `EbpfPolicySync` writes to. |
| `LLM_BASE_URL` | Point at an OpenAI-compatible LLM. If empty, the gateway uses MockPlanner. |
| `AUDIT_SIGNING_KEY` | HMAC-SHA256 key for the audit log. Required. Minimum 32 characters. |

## Sanity checks

```bash
# Is the gateway reachable?
curl -fsS http://127.0.0.1:18790/health | jq .

# What version is the gateway running?
curl -fsS http://127.0.0.1:18790/api/status | jq .version   # v0.3.0

# How many audit log entries were written today?
jq -s 'length' ./runtime/audit/$(date -u +%Y-%m-%d).jsonl

# Is the sandbox in fail-closed mode? (Bridge refuses to run if isolated-vm missing)
node -e "console.log(require('./packages/gateway/dist/sandbox/bridge.js').__unsafeResetIvmForTesting ? 'has-reset-hook' : 'prod-build')"
```

## Logs

The gateway writes to stdout. In production, a log forwarder
(loki, fluentbit) is recommended. Each line is JSON with
`timestamp`, `level`, `component`, `message`, and arbitrary
context fields. See `packages/gateway/src/audit/logger.ts` for the
shape of audit entries.
