---
slug: /modules/ebpf
title: eBPF Agent
sidebar_label: eBPF Agent
---

# eBPF Agent Module

The `deploy/ebpf/` directory contains the kernel-layer enforcement:
a Go userspace agent + a BPF C program + a Kubernetes DaemonSet.

## What's in the box

| File | What it does |
|------|---------------|
| `deploy/ebpf/bpf/network.bpf.c` | XDP program. Default-deny, LPM trie for IP allowlist, AES-256-GCM for tag-encoded protocol/port matching. |
| `deploy/ebpf/agent/main.go` | Go agent. Loads the BPF object via `cilium/ebpf` lib, hot-reloads the YAML policy every 15s, and decrypts any tag-encoded entries. |
| `deploy/ebpf/agent/policy.go` | YAML schema + rule expansion (hostnames → IPs via `net.LookupIP`). |
| `deploy/ebpf/daemonset.yaml` | K8s manifest. Runs one privileged pod per node, mounts the BPF object + policy ConfigMap. |

## Data flow

```
in-process EbpfFirewall (TypeScript)
  → addRule / removeRule events
  → EbpfPolicySync writes to YAML (atomic .tmp + rename, debounced 1s)
  → Go agent reads mtime every 15s
  → parses YAML, expands hostnames
  → programs BPF LPM_TRIE map via bpf() syscall
  → kernel XDP program (network.bpf.o) drops on match
  → BPF stats counter (per-CPU array) reports pass/drop/non_ip
```

Within ~15 seconds, the kernel matches the same policy as the
userland code. No "smoke-and-mirrors" where the kernel allows
traffic the userland denies (or vice versa). See
[ADR-006](../architecture/adr/006-ebpf-yaml-sync.md) for the design.

## Limitations (current, 2026-06)

- **IPv4 only**. The LPM_TRIE is a 32-bit key. IPv6 rules are
  written to YAML but silently dropped by the agent.
- **CI unverified**. The eBPF XDP attach requires `/dev/kvm`,
  which GH-hosted runners don't expose. The TypeScript ↔ YAML bridge
  is tested; the YAML ↔ BPF bridge is tested manually. B9 plans a
  self-hosted runner with KVM.
- **No per-rule hit counters**. The BPF program only tracks
  pass / drop / non_ip totals. Per-rule attribution would require
  a ring buffer + userspace consumer.

## See also

- [`EbpfFirewall` (TypeScript, in-process)](./sandbox.md#whats-in-the-box)
- [`EbpfPolicySync` (TypeScript, YAML writer)](./sandbox.md#whats-in-the-box)
- [ADR-006: eBPF kernel integration via YAML bridge](../architecture/adr/006-ebpf-yaml-sync.md)
