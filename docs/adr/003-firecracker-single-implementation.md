# ADR-003 — Firecracker 单实现：pool 概念合并进 runtime

- **状态**：Accepted
- **日期**：2026-06-20
- **作用域**：`packages/sandbox/src/runtime/firecracker.ts`
- **相关**：[ADR-002 wasmtime](002-wasmtime-upstream-blocking.md)、roadmap.md `EP-06 Kata+Firecracker`

## 背景

Firecracker 微虚拟机支持（T-017）曾有**两份并存的实现**：

| 文件 | API | 是否被集成 |
|------|-----|-----------|
| `runtime/firecracker-runtime.ts` (407 行) | 单 VM：`startVM(vmId, skillId, code, config)` / `stopVM` / `executeInVM` / jailer | ✅ 被 `microvm-runtime.ts` + `index.ts` 引用 |
| `isolation/firecracker-pool.ts` (204 行) | 暖池：`prewarm` / `acquire` / `release` / mutex | ❌ 仅自身测试引用 |

问题：

- 两份都 spawn firecracker 进程、都写 VM config JSON、都管理 socket 生命周期——**职责重叠**。
- `firecracker-pool.ts` 还带 4 个 hyphen-key 语法错（B0 已修），说明它从未被真正编译运行过。
- 后续任何对 Firecracker 行为的修改都得改两处，必然漂移。

## 决策

**合并为单一文件 `runtime/firecracker.ts`，保留两套能力。**

用户拍板"保留 pool 实现"。但 pool 的暖池 API 与 microvm-runtime 依赖的单 VM API 互补、不冲突，因此合并而非二选一：

1. 新 `FirecrackerRuntime` 类同时暴露：
   - **单 VM API**（microvm-runtime 集成所需）：`startVM` / `stopVM` / `executeInVM` / `getVMStatus` / `listVMs` / `cleanup`
   - **暖池 API**（来自 pool）：`startPoolVM` / `prewarm` / `acquire` / `release` / `destroyPoolVM` / `poolStats` / `destroyPool`
2. 共享底层：`processes` Map（PID 跟踪）、`_waitForSocket`、`_buildBootConfig`、`_generateMac`、jailer 路径。
3. 删除 `runtime/firecracker-runtime.ts` 和 `isolation/firecracker-pool.ts`。
4. `microvm-runtime.ts` / `index.ts` 改 import 到新路径，API 签名不变（零调用点改动）。
5. 非 Linux 平台（CI / macOS）所有路径降级 mock：不写文件、不 spawn，仅登记内存状态。

## 后果

- ✅ Firecracker 行为单点定义，不再漂移。
- ✅ 暖池能力（pool 用户的选择）保留并首次接入可测试路径。
- ✅ `isolation/` 目录回归单一职责：只剩 tier-selector。
- ✅ 新增 `firecracker.test.ts` 12 个用例覆盖两套 API（mock 模式，CI 可跑）。
- ⚠️ 暖池目前未被 microvm-runtime 自动使用——接入"acquire 暖 VM 而非冷启动"是后续优化（roadmap EP-06 Phase 3）。

## 验证

```bash
ls packages/sandbox/src/runtime/firecracker*          # 只有 firecracker.ts + .test.ts
ls packages/sandbox/src/isolation/                    # 无 firecracker-pool.ts
npm test -- packages/sandbox/src/runtime/firecracker.test.ts   # 12/12 绿
npm run build                                          # exit 0
```

## 不再做

- ~~保留两份"一个给池、一个给单 VM"~~ —— 重叠维护成本 > 概念清晰度收益。
- ~~把暖池做成独立 `PoolManager` 组合 runtime~~ —— 当前规模下内联方法更简单；若池逻辑膨胀再抽出。
