---
slug: /modules/sandbox
title: Sandbox
sidebar_label: Sandbox
---

# Sandbox Module

`@aether/sandbox` provides the V8 Isolate execution runtime. Every
piece of user-submitted code runs through this layer. The sandbox
**fails closed** — see [ADR-001](../architecture/adr/001-no-safe-eval.md).

## What's in the box

| Class | What it does |
|-------|---------------|
| `SandboxRuntime` | Wraps `isolated-vm`. Loads a fresh V8 isolate per `execute()` call. |
| `SecurityPolicy` | Static code analysis. Rejects `require('http')`, `eval()`, `new Function()`, `child_process`, `process.env`, etc. before the code reaches V8. |
| `CodeActEngine` | ReAct loop. Plans → acts → observes → re-plans, with a default `MAX_STEPS=10` to prevent infinite loops. |
| `WasmtimeRuntime` | Stub — activates when `@bytecodealliance/wasmtime` is published on npm. See [ADR-002](../architecture/adr/002-wasmtime-upstream-blocking.md). |
| `EbpfFirewall` | In-process firewall. Default-deny. Used by the gateway's hot path to decide whether to reject a submission. |
| `EbpfPolicySync` | Mirrors `EbpfFirewall` rule changes to the YAML file the Go agent consumes. See [ADR-006](../architecture/adr/006-ebpf-yaml-sync.md). |

## Configuration

| Env var | Default | Meaning |
|---------|---------|---------|
| `USE_WASM_RUNTIME` | `false` | Switch from V8 Isolate to Wasmtime. **Fail-closed**: missing upstream npm package causes `process.exit(1)`. |
| `SANDBOX_PORT` | `18791` | Standalone sandbox runtime port (rarely used) |
| `MAX_EXEC_TIME_MS` | `30000` | Per-code execution timeout |
| `MAX_MEMORY_MB` | `128` | Per-isolate memory limit |
| `EBPF_POLICY_PATH` | `/etc/aether/ebpf-policy.yaml` | Where `EbpfPolicySync` writes rule changes |
| `EBPF_SYNC_DEBOUNCE_MS` | `1000` | Debounce window for rule-change → YAML write |

## Fail-closed contract

The sandbox is the only piece of user-submitted-code execution in
the project. It has three fail-closed guarantees, each verified by
unit tests:

1. **`isolated-vm` missing → execution refused, not degraded**
   (ADR-001). See
   [`bridge.test.ts`](https://github.com/aether/aether/blob/main/packages/gateway/src/sandbox/bridge.test.ts)
   — the 5 static regression tests on this contract.
2. **No `new Function` / `eval` / `vm.runInThisContext` fallback**
   (also ADR-001). The grep "no `new Function` call survives in
   source" is part of CI.
3. **`EbpfPolicySync` write failure → process crashes** (ADR-006).
   Better to crash than run with a stale kernel mirror.

## Tests

```
packages/sandbox/src/
├── codeact/engine.test.ts              8 tests
├── runtime/sandbox.test.ts             6 tests
├── security/
│   ├── ebpf-firewall.test.ts          6 tests
│   ├── ebpf-policy-sync.test.ts     11 tests
│   └── policy.test.ts                 14 tests
```
