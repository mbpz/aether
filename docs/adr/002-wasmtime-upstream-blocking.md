# ADR-002 — Wasmtime npm 上游阻塞 EP-01 Phase 2

- **状态**：Accepted（带 unblock 触发条件）
- **日期**：2026-06-19
- **作用域**：`packages/sandbox/src/runtime/wasm-runtime.ts`、`packages/sandbox/src/index.ts`
- **相关**：[ADR-001 no-safe-eval](001-no-safe-eval.md)、roadmap.md `EP-01 Wasmtime Runtime`

## 背景

EP-01 Phase 2 计划把首选沙箱从 `isolated-vm`（V8 Isolate）切到 **Wasmtime**：

- 线性内存边界清晰，无法直接 syscall 宿主机；
- 字节码验证 + WASI capability 模型；
- Cranelift codegen + epoch 抢占式 timeout 优于 V8 cooperative trap；
- 实验过的 fuel metering 比 isolated-vm 的 memoryLimit 更细粒度。

实现路径是用 **官方 npm 包 `@bytecodealliance/wasmtime`** 走 Node N-API 绑定。
代码 `packages/sandbox/src/runtime/wasm-runtime.ts` 已写好（267 行），但：

```bash
$ npm view @bytecodealliance/wasmtime
npm error 404 Not Found - GET https://registry.npmjs.org/@bytecodealliance%2fwasmtime
```

**该包从未上架 npm registry**。Wasmtime 官方仅在维护 Rust crate 与若干 wasm32-build。
2024 年间一度有 RFC 讨论 Node bindings，但 2026/06 仍无产物。

之前的代码用 `try { require(...) } catch { wasmtime = null; }` 静默吞错，导致：

- `init()` 表面成功，`compile()` 时才 throw "Wasmtime runtime not initialized"；
- 看 log 看不出问题（只有一个 warn）；
- 调用方误以为沙箱可用。

## 决策

### 1. 状态认定：Phase 2 阻塞，等上游

Roadmap `EP-01 Phase 2 Wasmtime` 状态从 **🔄 调研中** 改为 **🔴 阻塞中：等待
`@bytecodealliance/wasmtime` 发布**。**不**自己 fork 维护 N-API 绑定（理由见下"备选方案"）。

### 2. 在阻塞期，所有相关代码 fail-closed

- `WasmtimeRuntime.init()` 缺包时 **throw**，不再静默 `this.wasmtime = null`。
- `packages/sandbox/src/index.ts` 在 `USE_WASM_RUNTIME=true` 但 init 失败时
  **`process.exit(1)`**，不降级到 isolated-vm。
- 默认 `USE_WASM_RUNTIME=false`，sandbox 走 isolated-vm 路径（见 ADR-001）。

### 3. 周期性探测上游

- `scripts/check-wasmtime.mjs` 调 `npm view`，退出码：
  | code | 含义 |
  |------|------|
  | 0 | 已发布且可装 |
  | 1 | 已发布但 install 失败（该告警） |
  | 2 | 仍未发布（默认状态，符合预期） |
  | 3 | registry/网络错误 |
- `npm run check:wasmtime` 暴露给开发者；CI 可挂周 cron。

### 4. unblock 触发条件

满足以下任一条立即评审：

- `npm view @bytecodealliance/wasmtime` 返回非空版本；或
- bytecodealliance 官方放出 N-API 替代品（如 `@wasmtime/node`、`wasmtime-js`）；或
- 评估发现内置 `WebAssembly` API + WASI shim 的工程量已显著降低（见"备选方案"）。

unblock 后预期工作量：**1 周**（接 npm 包 + 写 5-10 个互操作测试 + 切默认 runtime）。

## 备选方案（评估并拒绝）

### A. 改用 Node 内置 `WebAssembly`

可立即可用，但缺：

- WASI preview1 完整 import set（要自己 shim filesystem/clock/random）；
- fuel metering（指令计数）；
- epoch interruption（抢占式超时）；
- 跨进程模块缓存。

工程量约 **2-3 周**，且实现质量很难追上 Wasmtime。决策：**不做**，等就等。

### B. 自己维护 N-API 绑定

需要：

- 跟 wasmtime crate 版本（每 2-3 周一发）；
- 维护 N-API 兼容矩阵（Node 20/22/24）；
- darwin/linux/win 三平台 prebuilt；

工程量 **1 人月持续**。决策：**不做**——这是 bytecodealliance 该做的事，不是 Aether 的核心价值。

### C. 用 wasmtime-as-wasm（套娃）

把 wasmtime 自身编成 WASM，跑在 Node 内置 `WebAssembly` 里。

技术上可行（已有先例），但：

- 双层解释带来 5-10× 性能损失；
- 调试链路变长；
- 隔离强度反而下降（外层 isolation 还是 V8）。

决策：**不做**。

## 验证

```bash
# 探测脚本
node scripts/check-wasmtime.mjs                           # exit 2 = 仍未发布
node scripts/check-wasmtime.mjs --json                    # JSON 给 CI 用

# fail-closed 验证
USE_WASM_RUNTIME=true npm run sandbox                     # 进程 exit 1，stderr 给出引导
USE_WASM_RUNTIME=false npm run sandbox                    # 启动 isolated-vm 路径
```

## 后果

- ✅ Roadmap "等上游" 这条公开事实记录在案，不再误标 ✅。
- ✅ 沙箱的安全姿态（不静默降级）成为强不变量。
- ⚠️ 在上游就绪前，EP-01 Phase 2 的对外承诺只能是 "策略已设计、实现已就绪、等运行时
  绑定"。
- ✅ 用户/CI 可一键查上游状态，触发条件清晰。
