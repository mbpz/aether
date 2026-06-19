# ADR-001 — 移除 sandbox 的 `safe-eval` / `new Function` 降级

- **状态**：Accepted
- **日期**：2026-06-19
- **作用域**：`packages/gateway/src/sandbox/bridge.ts`
- **相关**：[ADR-002 wasmtime 上游阻塞](002-wasmtime-upstream-blocking.md)、roadmap.md `EP-01`

## 背景

`SandboxBridge` 早期实现了**两段式**沙箱：

1. **首选**：`isolated-vm` V8 Isolate（真正的隔离）。
2. **降级**：`new Function('__console__', '__input__', wrappedCode)` —— 在 isolated-vm
   原生绑定加载失败时启用，**继承宿主机的全部 JS 上下文**。

降级路径以 `runSafeEval` 函数封装，文案上叫 "safe-eval fallback"。
代码注释暗示这只是开发期 helper，但实际上：

- 任何环境下 `isolated-vm` 编译失败（旧 Node、新平台、缺 toolchain）都会无声切到降级；
- 用户和审计日志都只看到 "warning"，不知道下一次 `submit()` 实际会进 host eval；
- 这条路径正中 OWASP Agentic A01（Prompt Injection）+ A03（Sandbox Escape）。

`requirements/roadmap.md` 标 ✅ "已完成 — 移除 unsafe safe-eval 降级"，但代码到
2026/06/18 review 时降级仍在 `bridge.ts:182-224`。

## 决策

**fail-closed**：`isolated-vm` 加载失败时，`runInSandbox()` **直接返回拒绝执行的错误**，
绝不调用任何主机级 JS 求值（`new Function`、`eval`、`vm.runInThisContext` 等）。

具体落实：

1. **删除** `runSafeEval` 函数及其调用点。
2. **保留** `_ivmLoadError` 字段记录加载失败原因，写进返回的 `error` 字段，便于运维排查。
3. **静态回归测**：`bridge.test.ts` grep 源文件，断言：
   - 不存在 `new Function(`
   - 不存在 `runSafeEval` 标识符
   - 不存在 `from 'safe-eval'` import
   - 拒绝消息文案锚点稳定
4. **测试 hook**：导出 `__unsafeResetIvmForTesting()`，名字带 `__unsafe` 强提示仅测试用。

## 后果

- ✅ 主机级 JS 求值的攻击面归零。
- ✅ Roadmap 的 ✅ 状态对得上代码事实。
- ⚠️ `isolated-vm` 装不上的环境（罕见，但 ARM/旧平台时会发生）现在**完全无法跑沙箱**——
  这是预期：宁可拒服务，不要假沙箱。
- 🔁 **替代路径**：长期靠 Wasmtime（见 ADR-002）取代 isolated-vm 作为首选；isolated-vm
  本身保留为 V8 路径。**没有"第三种降级"**。

## 验证

```bash
grep -rnE "new\s+Function\(|runSafeEval|safe-eval" packages/gateway/src    # 0 匹配
npm test -- packages/gateway/src/sandbox/bridge.test.ts                     # 5/5 绿
```

## 不再做

- ~~"开发体验"参数 `ALLOW_UNSAFE_FALLBACK=1`~~ —— 任何 escape hatch 都会被某次复制粘贴漏掉。
- ~~"在 dev 模式自动允许降级"~~ —— dev 和 prod 必须共用相同执行约束。
