# Phase 3 Architecture Design

**Date:** 2026-05-11
**Status:** Approved

## 1. Overview

Phase 3 implements three advanced infrastructure subsystems:
1. **Kata + Firecracker + gVisor** — Three-tier secure isolation
2. **Real eBPF XDP+TC** — Kernel-level network monitoring
3. **Remote WASM Runtime** — Hybrid pre-warm/on-demand sandbox

## 2. Kata + Firecracker + gVisor Three-Tier Isolation

### 2.1 Architecture

```
┌─────────────────────────────────────────────────────┐
│  Aether Gateway                                     │
│  ┌─────────────────────────────────────────────┐   │
│  │  Trust Gate                                 │   │
│  │  trustScore → isolation tier selector      │   │
│  └─────────────────────────────────────────────┘   │
│         │                    │                    │   │
│   trust≥70              trust≥50             trust<50
│         │                    │                    │
│  ┌──────────┐       ┌──────────┐       ┌──────────┐
│  │  gVisor   │       │   Kata   │       │Firecracker│
│  │  (Sandbox)│       │  (Pod)   │       │ (MicroVM) │
│  └──────────┘       └──────────┘       └──────────┘
│  syscalls via       VM boundary        full HW virt
│  user-space kernel   via QEMU           via Firecracker
```

### 2.2 Isolation Tiers

| Tier | Runtime | Isolation | Latency | Trust Threshold |
|------|---------|-----------|---------|----------------|
| 1 (Low) | Firecracker MicroVM | HW virtualized, minimal attack surface | ~1ms cold-start (pooled) | trustScore < 50 |
| 2 (Mid) | Kata Containers | VM boundary, shared host kernel | ~10ms | 50 ≤ trustScore < 70 |
| 3 (High) | gVisor | User-space kernel, syscall interception | ~100μs | trustScore ≥ 70 |

### 2.3 Components

**KataRuntimeManager**
- Manages Kata Container lifecycle via CRI
- Supports Firecracker as Kata's VMM (Kata-Firecracker integration)
- Configures per-container resource limits, network policies
- Pod spec: `runtimeClassName: kata` in K8s

**FirecrackerManager**
- Direct Firecracker microVM lifecycle (bypasses Kata if needed)
- Pre-started VM pool (N warm VMs ready)
- VM config: vCPUs, memory, network interfaces
- Jailer mode for security boundary

**gVisorSentry**
- Gvisor runsc binary as K8s runtime
- Syscall filtering via user-space kernel
- Network namespace isolation

**TrustTierSelector**
```typescript
interface TierConfig {
  maxMemoryMb: number;
  maxCpu: number;
  blockNetwork: boolean;
  readonlyRootfs: boolean;
}

function selectTier(trustScore: number): 'firecracker' | 'kata' | 'gvisor' {
  if (trustScore < 50) return 'firecracker';
  if (trustScore < 70) return 'kata';
  return 'gvisor';
}
```

### 2.4 Integration

- K8s `runtimeClass` with `RuntimeClass` CRD
- `KataRuntimeManager` creates pods with `runtimeClassName: kata`
- Gateway receives execution request → reads skill trustScore → routes to appropriate tier
- Metrics: startup time, memory overhead, syscall count per tier

## 3. Real eBPF XDP+TC Network Monitoring

### 3.1 Architecture

```
┌─────────────────────────────────────────────────────────┐
│  eBPF Control Plane (Go userspace)                    │
│  ┌──────────────┐  ┌─────────────┐  ┌──────────────┐  │
│  │ Policy Engine│  │  Map Sync   │  │  Log Agg.   │  │
│  └──────┬───────┘  └──────┬──────┘  └──────┬───────┘  │
│         │                   │                │          │
│         └───────────────────┼────────────────┘          │
│                             │                         │
│                    ┌─────────▼─────────┐               │
│                    │   eBPF Maps      │               │
│                    │ (per-CPU arrays) │               │
│                    └─────────┬─────────┘               │
└───────────────────────────────┼─────────────────────────┘
                                │
         ┌──────────────────────┐│
         │      Linux Kernel  ││
         │  ┌────────┐   ┌────▼──┐  ┌─────────────┐
         │  │  XDP   │   │ TC     │  │  gVisor     │
         │  │(driver)│   │(queue) │  │  (network ns)│
         │  └────────┘   └────────┘  └─────────────┘
         │      ↓            ↓
         │  Packet Filter  Egress Shaping
         └─────────────────────────────────────────────
```

### 3.2 eBPF Programs

**XDP Program (XDP driver hook)**
- Attaches at network driver receive interrupt
- First chance to inspect/modify packet
- Actions: `XDP_PASS`, `XDP_DROP`, `XDP_REDIRECT`
- Per-packet: source IP, dest IP, L4 ports, protocol

**TC Program (TC egress hook)**
- Attaches at kernel qdisc layer
- Handles outgoing packets
- Can do packet scheduling, rate limiting, further filtering

**CO-RE (Compile Once, Run Everywhere)**
- Uses BTF (BPF Type Format) for portable eBPF
- BTF maps loaded from kernel
- libbpf + Go agent for userspace

### 3.3 Components

**EbpfPolicyEngine (Go)**
- Loads eBPF programs to kernel via bpf()
- Syncs policy rules to eBPF maps
- Subscribes to map update events

**EbpfMapManager**
- `allowed_hosts` map: CIDR ranges → allow/deny
- `connection_log` map:环形缓冲区，per-CPU
- `stats` map: counters by rule ID

**K8s DaemonSet**
- One eBPF agent per node
- Mounts: `/sys/fs/bpf` (bpffs), `/etc/cni/net.d` (CNI hooks)
- Env vars: `EBPF_POLICY_MODE=block|log`, `EUPORTANCE_LOG_PATH`

### 3.4 Policy Format

```yaml
# /etc/aether/ebpf-policy.yaml
rules:
  - id: allow-localhost
    action: allow
    protocol: all
    host: 127.0.0.1/32
  - id: block-private
    action: block
    protocol: all
    host: 10.0.0.0/8
  - id: block-private-172
    action: block
    host: 172.16.0.0/12
  - id: allow-ollama
    action: allow
    protocol: tcp
    host: 10.60.1.100/32
    port: 11434
  - id: block-dns
    action: block
    protocol: udp
    port: 53
```

### 3.5 Fallback (macOS/Darwin)

On non-Linux platforms, the existing `EbpfFirewall` mock continues to operate:
- Same API surface as real eBPF
- Static code analysis + connection log simulation
- Clearly labeled "mock mode" in logs

## 4. Remote WASM Runtime (Hybrid Mode)

### 4.1 Architecture

```
┌──────────────────────────────────────────────────────┐
│  Gateway                                             │
│  ┌──────────────────────────────────────────────┐   │
│  │  SandboxRouter                              │   │
│  │  Reads: trustScore, moduleSize, permissions │   │
│  └──────────┬───────────────────┬──────────────┘   │
│             │                   │                    │
│     trustScore≥70         trustScore<70            │
│             │                   │                    │
│  ┌──────────▼──────┐   ┌──────▼───────────────┐   │
│  │ Pre-warmed Pool │   │   On-Demand Pods     │   │
│  │ (Firecracker +  │   │  (fresh VM per req)  │   │
│  │  Wasmtime)      │   │                      │   │
│  │  <50ms latency  │   │  Stronger isolation  │   │
│  └──────────┬──────┘   └──────┬───────────────┘   │
│             │                   │                    │
│         ┌───▼────┐         ┌───▼────┐              │
│         │PoolMgr  │         │K8s Job │              │
│         │(N warm  │         │Ctrl    │              │
│         │VMs)     │         │        │              │
│         └─────────┘         └─────────┘              │
└──────────────────────────────────────────────────────┘
```

### 4.2 Components

**SandboxRouter**
- Classifies execution requests by trustScore and moduleSize
- Routes to pre-warm pool or on-demand
- Tracks pool health and queue depth

**PreWarmedPoolManager**
- Maintains N warm Firecracker VMs
- Each VM: Wasmtime runtime pre-loaded, ready to execute
- VM lifecycle: pre-start on gateway init, recycle after N executions
- Health check: ping every 30s, replace unhealthy VMs

**OnDemandPodManager**
- Creates fresh K8s Job per execution request
- Job template: Firecracker + Wasmtime + WASM module
- Cleanup: delete pod after execution (TTL 60s)
- Queue: requests buffered if no idle VMs

**RemoteWasmClient (Gateway side)**
```typescript
interface WasmExecutionRequest {
  module: Buffer;          // WASM binary
  function: string;        // exported function name
  args: unknown[];         // function arguments
  timeoutMs: number;
}

interface WasmExecutionResponse {
  result: unknown;
  logs: string[];
  executionTimeMs: number;
}
```

### 4.3 WASM Module Registry
- Modules stored in K8s Secret (small <1MB) or PVC (large)
- Content-addressable: SHA-256 of WASM binary → module ID
- Version tracking: same module, different versions get different IDs

## 5. Integration Points

| Component | Integrates With |
|-----------|----------------|
| `KataRuntimeManager` | K8s CRI, Gateway sandbox API |
| `FirecrackerManager` | Kata, VM pool |
| `EbpfPolicyEngine` | Kernel (bpffs), Gateway audit log |
| `RemoteWasmClient` | Gateway sandbox API, K8s API |

## 6. Out of Scope (Phase 3)

- GPU passthrough for local models
- Multi-cluster federation
- WASM component model (WASI 0.2 preview2 only)
- Production eBPF on non-Linux platforms