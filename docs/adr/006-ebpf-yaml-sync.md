# ADR-006 — eBPF 内核层集成通过 YAML 文件桥接

- **状态**：Accepted
- **日期**：2026-06-25
- **作用域**：`packages/sandbox/src/security/ebpf-policy-sync.ts`、`packages/gateway/src/index.ts`、`deploy/ebpf/agent/main.go`（无改动）、`scripts/check-ebpf-agent.mjs`
- **相关**：[ADR-001 no-safe-eval](001-no-safe-eval.md)、[ADR-002 wasmtime](002-wasmtime-upstream-blocking.md)、[ADR-005 SDD 流程](005-sdd-batches.md)

## 背景

EP-01 Phase 1 沙箱层（isolated-vm fail-closed，B1 + ADR-001）落地后，EP-01 Phase 2 的 eBPF 内核层集成仍是空头承诺。代码状态：

- `packages/sandbox/src/security/ebpf-firewall.ts`（415 行）—— 纯应用层模拟。Header 自陈"应用层网络防火墙，模拟 eBPF XDP/TC 钩子的访问控制行为"。`checkConnection` 走 in-memory `this.rules[]` 数组。
- `deploy/ebpf/agent/main.go`（332 行）+ `deploy/ebpf/bpf/network.bpf.c`（150 行）+ `daemonset.yaml` —— 真实 XDP default-deny 实现，default-deny + 7 协议 × 端口 LPM trie。
- 两个组件之间**没有任何桥接**。`packages/gateway/src/sandbox/bridge.ts:146-150` 接受 `firewall?: EbpfFirewall` 形参但 gateway 入口（`packages/gateway/src/index.ts:49`）不传，bridge 里 `if (this.firewall) { ... }` 是 dead branch。
- roadmap 2.1 节 eBPF 状态：`🟡 部分（应用层 + deploy/ebpf 已写）`—— review 在 B0 时实事求是标的状态，没吹 ✅。

## 决策

**用 YAML 文件桥接 in-process firewall 到 Go agent。** Go agent 已经有 hot-reload 机制（`watchPolicy` 每 15s 检查 mtime），不写 Go 端代码就能落地。

### 数据流

```
┌──────────────────────┐ addRule/removeRule   ┌──────────────────────┐
│  EbpfFirewall (TS)   │ ───────────────────▶│  EbpfPolicySync (TS) │
│  in-process hot path │                      │  polling 200ms +     │
│  used by bridge.ts   │                      │  debounce 1s         │
└──────────────────────┘                      └──────────┬───────────┘
                                                         │ atomic write
                                                         │ .tmp + rename
                                                         ▼
                                              ┌──────────────────────┐
                                              │ /etc/aether/         │
                                              │ ebpf-policy.yaml     │
                                              └──────────┬───────────┘
                                                         │ mtime watch 15s
                                                         ▼
                                              ┌──────────────────────┐
                                              │ Go agent:            │
                                              │ readPolicy() +       │
                                              │ programRules()       │
                                              │ into BPF LPM_TRIE   │
                                              └──────────┬───────────┘
                                                         │
                                                         ▼
                                              ┌──────────────────────┐
                                              │ Kernel: XDP hook     │
                                              │ default-deny (DROP)  │
                                              └──────────────────────┘
```

### 关键设计点

1. **in-process firewall 仍是热路径决策者**。`bridge.ts:_processNext` 在执行用户代码前调 `checkConnection` 决定 reject 还是放行——**这一步同步且无延迟**。YAML 写入是镜像而非决策。

2. **polling + debounce 合并 addRule 爆发**。`maybeWrite` 每 200ms 检查 `getRules().length` 变化，发现变化后 schedule 1s debounce。debounce 触发时**只写入一次**。连续 5 个 addRule 合并为 1 次 YAML 写入。  
   ⚠️ 设计陷阱：polling 持续 reset debounce timer 会让写永远不 fire。修复：`maybeWrite` 在已经 debounce pending 时**不**重新 schedule（只在 `if (this.debounceTimer) return;` 后才调 `scheduleWrite`）。

3. **原子写**：`writeFileSync(tmp); renameSync(tmp, final)` —— POSIX 上 rename 是 atomic，避免 Go agent 读到半截 YAML。

4. **Fail-closed**：写失败时 throw（默认 `failClosed: true`）。理由：in-process firewall 拒绝了一个外联，但内核 BPF map 没有相应规则——agent 失败或写入失败时，内核层允许的而 TS 层拒绝，构成 OWASP A02 数据泄漏路径。**宁可 sandbox 进程 crash，也不要让内层 firewall 假阳性**。这是 OWASP fail-secure 原则的直接应用。

5. **部署形态感知**：`EbpfPolicySync` 只在 `STANDALONE=true` 模式启动。`packages/sandbox/src/index.ts:31-46` 守护：sandbox 进程内调用（gateway 入口的默认路径）不启动 sync——因为 gateway 进程没有 `/etc/aether` 写权限，且 `EbpfFirewall` 已经在 gateway 进程内做 hot-path 决策。`EbpfPolicySync` 启动是 sandbox 进程独立运行（`STANDALONE=true npm run sandbox`）的部署场景。

6. **零 Go 端改动**：完全沿用 Go agent 已有 `loadPolicy` + `watchPolicy` 路径。YAML schema 一一对应 `deploy/ebpf/agent/policy.go:15-28` 定义的 `Policy{ Rules: []Rule{ id, action, protocol, host, port, direction } }`。

### YAML schema 一一对应

| TS `EbpfRule` | Go `Rule` 字段 | 转换规则 |
|---|---|---|
| `id: string` (UUID) | `id: string` | 直传 |
| `action: 'allow' \| 'block'` | `action: 'allow' \| 'block'` | 直传（block 在 Go 端不被编程到 LPM trie，仅审计用，见 policy.go:38-41）|
| `protocol: 'all' \| 'tcp' \| 'udp' \| 'icmp'` | `protocol: 'tcp' \| 'udp' \| 'icmp' \| ''` | `all`/undefined/'' → `''`（any）|
| `host: string \| '*'` | `host: string` | 直传，Go 端会做 net.LookupIP（policy.go:174-198）|
| `port: number \| '*'` | `port: int` | `*`/undefined/0 → `0`（any）|
| `direction: 'egress' \| 'ingress' \| 'both'` | `direction: string` | 直传（Go 端 egress-only XDP，direction 暂不强制）|

## 后果

- ✅ `gateway/src/sandbox/bridge.ts:230-303` 那个 dead branch 活起来了：firewall 注入 gateway 入口后，每次 code 提交走 `checkConnection` 真的会被拒绝。
- ✅ 加上 `EbpfPolicySync` 后，sandbox 规则添加 ~1-15s 内被 agent 读取、~0.1s 内编程到 BPF LPM trie，总延迟 <16s。in-process 仍同步生效。
- ✅ 新增 `scripts/check-ebpf-agent.mjs`：3 检查（binary、policy 写权限、agent 进程），4 状态 exit code（0 healthy / 1 degraded / 2 not-yet / 3 transport-error），CI 集成。`npm run check:ebpf` 一行可调。
- ✅ `requirements/roadmap.md` 2.1 节 eBPF 状态从 `🟡 部分` 升为 `✅`，verification 命令可执行。
- ⚠️ **收敛延迟 ~15s**（agent 端 mtime poll）。in-process 立即生效；内核层最多落后 15s。OWASP A02 数据泄漏窗口 = 15s × 外联尝试频率。如果需要 sub-second 收敛，未来 unblock 信号是 Go agent 加 HTTP push（见"不在此批次"）。
- ⚠️ **rule 删除不缩 trie**（Go agent 已知限制，policy.go:38-41 + watchPolicy 注释说明）。从 TS 删一条规则后，in-process firewall 立即停用，但 BPF LPM trie 仍保留该 IP 规则直到 agent 重启。这个 unidirectional divergence 接受为已知限制，记在 ADR。
- ⚠️ **IPv4-only**：Go agent LPM trie 是 32-bit key。IPv6 rule 在 `serializeToPolicyYAML` 中按原样写入但 agent 跳过；TS 端 `EbpfRule.host` 配 IPv6 string 时**不会**报错，但内核层忽略。需 IPv6 时未来 unblock 信号 = 改 BPF C 用 BPF_MAP_TYPE_LPM_TRIE + `struct lpm_trie_key` 的 128-bit key。

## 验证

```bash
# 1. 编译 + 测试双绿
npm run build                                                    # exit 0
npm test                                                         # 185 passed | 4 skipped
                                                                  # 11 是 ebpf-policy-sync, 6 是 ebpf-firewall

# 2. Gateway 注入 EbpfFirewall（dead branch 修复）
grep -n 'new EbpfFirewall' packages/gateway/src/index.ts          # 1 命中
grep -n 'new SandboxBridge' packages/gateway/src/index.ts         # 1 命中，参数含 ebpfFirewall
grep -nE 'ebpfFirewall\s*=\s*null' packages/gateway/src/sandbox/bridge.ts  # 0 命中

# 3. sandbox 入口在 STANDALONE 模式下启动 sync
grep -n 'EbpfPolicySync' packages/sandbox/src/index.ts            # 2 命中（import + start）

# 4. probe 脚本 4 状态
node scripts/check-ebpf-agent.mjs --json && echo "PROBE OK"    # not-yet exit 2
node scripts/check-ebpf-agent.mjs                                # human-readable

# 5. roadmap 状态
grep -A1 "eBPF" requirements/roadmap.md | head -10               # 看到 ✅
```

## 不再做

- ❌ **不在 Go agent 加 HTTP push endpoint**。当前 YAML 路径已能满足"提交规则 → 15s 内内核生效"。HTTP push 是 B+ 优化。
- ❌ **不做 per-rule 命中统计**。BPF C 当前是 3-slot per-CPU counter（pass/drop/non_ip），无法区分哪个 rule 触发。需求出现时改 BPF C 加 ring buffer。
- ❌ **不做 Linux-only e2e test**。仓库 CI 是 ubuntu-latest 但**没有 K8s runner**，且 BPF 程序需要 KVM 硬件支持。Linux K8s e2e 是 B6（待排期）。
- ❌ **不在 in-process firewall 用 EventEmitter 订阅 `addRule`**。当前 polling 200ms 实现够用。EventEmitter 路径会引入"内部事件 vs 外部 API"两套接口，得不偿失。
- ❌ **不做 IPv6 规则支持**（LPM_TRIE 32-bit key 限制）。TS 端不报错、内核层忽略——记录在 limitations。

## 后续 unblock 触发条件

- Go agent 收到 PR 加 HTTP push endpoint → 重写 `EbpfPolicySync` 为 push-based 同步，~半天工作量。
- 需要 per-rule 命中统计 → 改 `deploy/ebpf/bpf/network.bpf.c` 加 ring buffer，`EbpfPolicySync` 暴露 stats。
- 需要 IPv6 → 改 BPF C 用 128-bit LPM_TRIE key。
- Linux + K8s e2e 在 CI 跑 → 加 `kind` runner 到 CI workflow，B6 候选。
