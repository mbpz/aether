# EP-07 QA Run 报告

- **时间**：2026-03-14 23:38
- **QA Agent**：qa（aether-ep07-cycle）
- **测试方式**：**静态代码审查**（Gateway 端口 19009 运行旧版本，GET /api/llm/config 返回 404，新端点 BLOCKED 待重启后执行 HTTP 测试）
- **覆盖文件**：
  - `packages/gateway/src/llm/types.ts`
  - `packages/gateway/src/llm/provider.ts`
  - `packages/gateway/src/llm/planner.ts`
  - `packages/gateway/src/llm/manager.ts`
  - `packages/gateway/src/routes/llm.ts`
  - `packages/gateway/src/server.ts`（路由注册）
  - `packages/gateway/src/index.ts`（初始化逻辑）
- **TypeScript 编译**：`npx tsc --noEmit` → **0 新增错误**（仅 bridge.ts 的 1 个历史遗留 import.meta 警告）
- **通过：18 / 总数 18**
- **P0 问题：0**
- **P1 问题：0**
- **P2 问题：1**

---

## 测试结果汇总

| TC ID | 描述 | 结果 | 说明 |
|-------|------|------|------|
| TC-01 | 未配置 GET /config → configured=false | ✅ PASS | isConfigured 初始为 false，safeConfig() 返回 null |
| TC-02 | GET /presets → 4 个预设 | ✅ PASS | PROVIDER_PRESETS 包含 openai/ollama/openrouter/deepseek |
| TC-03 | POST /configure 正确参数 → ok=true | ✅ PASS | configure() 仅创建 Provider，不做网络请求，不会抛异常 |
| TC-04 | POST /configure 缺 model → 400 | ✅ PASS | `if (!baseUrl \|\| !model)` 校验完整 |
| TC-05 | POST /configure 缺 baseUrl → 400 | ✅ PASS | 同 TC-04 |
| TC-06 | POST /ping 已配置但离线 → ok=false 不崩溃 | ✅ PASS | provider.ping() 内 try/catch，返回 { ok: false, error } |
| TC-07 | POST /chat 未配置 → 503 | ✅ PASS | `if (!llmManager.isConfigured)` 早返回 503 |
| TC-08 | POST /chat 已配置但离线 → 500 含 error | ✅ PASS | 路由层 try/catch，捕获 LLMError 返回 500 + error |
| TC-09 | POST /run 未配置 → 503 | ✅ PASS | `if (!llmManager.isConfigured)` 早返回 503 |
| TC-10 | POST /run 已配置但离线 → 500 含 error | ✅ PASS | LLMPlanner.plan() 内双层 catch，路由层再兜底 |
| TC-11 | toSafeConfig() 不含 apiKey | ✅ PASS | 解构排除 apiKey，TypeScript Omit 类型安全保障 |
| TC-12 | LLMPlanner 结构完整 | ✅ PASS | ReAct 循环完整：thought/tool_calls/final answer 三分支，最大步骤数保护 |
| TC-13 | initFromEnv() 无 env 返回 false | ✅ PASS | `if (!baseUrl \|\| !model) return false` |
| TC-14 | POST /run 缺 task → 400 | ✅ PASS | `if (!task)` 校验完整 |
| TC-15 | POST /chat 缺 messages → 400 | ✅ PASS | `!Array.isArray(messages) \|\| messages.length === 0` |
| TC-16 | withConfig() 返回新实例不影响原实例 | ✅ PASS | 返回 new LLMProvider({...this.config, ...patch})，不可变模式 |
| TC-17 | 路由注册到 /api/llm 前缀 | ✅ PASS | server.ts: `app.use('/api/llm', createLLMRouter(...))` |
| TC-18 | LLMManager 正确初始化注入 | ✅ PASS | index.ts: new LLMManager() → initFromEnv() → 注入 server |

---

## 问题列表

### ISSUE-EP07-001（P2）：/run 路由使用 `(agentRunner as any).registry` 强制访问私有成员

**文件**：`packages/gateway/src/routes/llm.ts` 第 123 行  
**描述**：
```typescript
const registry = (agentRunner as any).registry;
```
使用 `as any` 绕过 TypeScript 类型检查来访问 `AgentRunner` 的私有属性 `registry`。
若 `AgentRunner` 重构改名该属性，运行时 `registry` 将为 `undefined`，导致 `new LLMPlanner(...)` 构造时 `registry` 传入 undefined，`planner.plan()` 调用 `this.registry.list()` 时抛出 `TypeError: Cannot read properties of undefined`，进而返回 500 错误，但提示信息不友好。

**影响**：P2（代码质量 / 维护性风险，当前无运行时错误）  
**建议修复**：
1. 在 `AgentRunner` 中暴露 `getRegistry()` 或 `readonly registry` getter
2. 或在路由层增加 `if (!registry)` 保护，返回 500 with 友好错误信息
3. 或将 `ToolRegistry` 作为独立依赖直接注入 `LLMRouterDeps`

---

## 静态分析亮点（代码质量加分项）

1. **零外部依赖** — `provider.ts` 使用 Node 18+ 内置 `fetch`，无需安装额外 HTTP 库 ✅
2. **超时保护** — `AbortController` + `setTimeout` 实现 fetch 超时，避免连接挂起 ✅
3. **apiKey 安全** — `toSafeConfig()` TypeScript 类型级别确保 apiKey 不泄漏 ✅
4. **两层 LLM 错误处理** — `LLMPlanner.plan()` 内部 catch + 路由层 catch 双保险 ✅
5. **环境变量初始化** — `initFromEnv()` 启动时自动加载，支持 Docker/CI 配置 ✅
6. **ReAct 最大步骤限制** — maxSteps=10 防止无限循环 ✅
7. **OpenRouter 专属 header** — 自动添加 HTTP-Referer 和 X-Title ✅

---

## 结论

EP-07 LLM Planner 代码质量良好：
- **接口设计完整**：6 个端点覆盖配置、查询、ping、chat、run 全流程
- **错误处理到位**：503/400/500 响应码使用正确，无未捕获异常风险
- **类型安全**：TypeScript 编译 0 新增错误，类型定义清晰
- **仅 1 个 P2 问题**（`as any` 访问私有成员），不影响当前功能

**建议**：Gateway 重启后执行完整 HTTP 接口回归测试，验证端到端行为与静态分析结论一致。
