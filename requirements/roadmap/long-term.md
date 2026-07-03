# Aether 长期路线图 (Long-Term Roadmap)

> **更新时间：2026-07-02**
> 本文件记录尚未进入开发阶段的研究级项目。这些项目有明确的技术调研价值，但**不构成当前 MVP 或近期交付的承诺**。
>
> **治理规则：**
> - ❌ **永不在 README 标题或首屏中引用这些项目。**
> - ❌ **不以 ✅ 标记这些项目** — 只有经过 CI 验证的代码才能标记完成。
> - ✅ **可以引用作为"信任轨迹"的远期愿景** — 但必须明确标注 Status: research。
> - ✅ 当 research 项目进入实现阶段时，移入主路线图 `roadmap.md`。
>
> 参见 Council Verdict (2026-07-02)：Phase 3 — Trust Trajectory Extension。

---

## 沙箱执行层 (EP-01) — 远期

### Status: research — WASM 运行时

| 项目 | 状态 | 阻塞因素 |
|------|------|---------|
| **Wasmtime (WASM) 替换 isolated-vm** | 🔴 blocked | `@bytecodealliance/wasmtime` 未发布 npm 包。运行 `node scripts/check-wasmtime.mjs` 探测（当前 exit=2）。详见 [ADR-002](../../docs/adr/002-wasmtime-upstream-blocking.md) |
| wasi-socket 网络白名单 | 📋 待开始 | 依赖 Wasmtime 上游 |
| WasmtimeRuntime 代码已写、fail-closed 守卫已加 | ⚠️ 存在但不可用 | `grep -n "throw new Error" packages/sandbox/src/runtime/wasm-runtime.ts` |

### Status: research — eBPF 内核层

| 项目 | 状态 | 备注 |
|------|------|------|
| eBPF 内核网络监控集成 | 🟡 代码已写，未集成 | `deploy/ebpf/` 下 BPF C + Go agent + K8s DaemonSet 已写，但未接入主进程。详见 [ADR-006](../../docs/adr/006-ebpf-yaml-sync.md) |
| libbpf eBPF (primary) | 调研中 | 见 §1.2 竞品分析 |

### Status: research — 高安全容器

| 项目 | 状态 | 备注 |
|------|------|------|
| Kata Containers + Firecracker | ⚠️ 单一实现已合并，未集成 | [ADR-003](../../docs/adr/003-firecracker-single-implementation.md). Pool 实现已合并到 runtime/firecracker.ts |
| GPU passthrough（本地模型） | 📋 远期 | — |
| gVisor syscall 过滤 | 📋 远期 | — |

---

## 技能生态 — 远期

### Status: research — 去中心化

| 项目 | 状态 | 备注 |
|------|------|------|
| IPFS + 区块链去中心化注册表 | 📋 远期 | 从主路线图移除（2026-07-02）。作为"信任轨迹"的远期愿景保留。 |
| NFT 身份 + ZK 审计 | 📋 远期 | 同上 |
| 技能包签名 + ZTA 评分增强 | 🔄 部分 | ZTA scorer 已可用，4 个矛盾 case .skip（B2），待 B15 修复 |

---

## 记忆系统 (EP-04) — 远期

| 项目 | 状态 |
|------|------|
| Entity Memory 追踪 | 📋 Phase 3 |
| 后台自动压缩调度 | 📋 Phase 3 |

---

## 商业闭环 — 远期

| 项目 | 状态 | 备注 |
|------|------|------|
| 技能市场上线 | ⚠️ API 已实现，无前端 | 从 README 移除 — 没有可用的市场前端 |
| 开发者赏金计划 | ⚠️ 流程代码已写，无运营 | 同上 |

---

## 进入实现的条件

每个 research 项目进入主路线图 `roadmap.md` 的条件：

1. **Wasmtime**: `@bytecodealliance/wasmtime` npm 包发布且 `check-wasmtime.mjs` 退出码为 0。
2. **eBPF 内核集成**: 完成主进程集成 + 通过 `audit-daemonset` smoke test。
3. **Kata + Firecracker**: 完成运行时抽象 + 集成测试覆盖 tier 切换。
4. **IPFS/区块链**: 完成需求评审 + 有明确的审计场景。

---

## 已放弃（存档参考）

| 项目 | 原因 |
|------|------|
| ~~`safe-eval` 降级路径~~ | ADR-001 删除，永不回归 |
| ~~两份 Firecracker 实现~~ | ADR-003 合并为单一 runtime/firecracker.ts |
| ~~内联跨包代码复制~~ | ADR-004 强制走 package.json exports 契约 |
