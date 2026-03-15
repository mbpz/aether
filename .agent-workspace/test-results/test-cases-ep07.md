# EP-07 测试用例 — LLM Planner

**模块**：LLM Provider / LLM Planner / LLM Manager / REST 路由  
**编写时间**：2026-03-14 23:35  
**测试方式**：静态代码审查（Gateway 端口 19009 运行旧版本，/api/llm/* 返回 404，待重启后可做 HTTP 测试）

---

## TC-01 未配置时 GET /api/llm/config 返回 configured=false

**类型**：HTTP 接口 / 静态代码审查  
**优先级**：P0  
**被测代码**：`routes/llm.ts` → `GET /config`，`LLMManager.isConfigured`

**预期行为**：
- 状态码 200
- 响应体 `{ configured: false, config: null }`

**代码路径分析**：
```
router.get('/config', (_req, res) => {
  const config = llmManager.safeConfig();   // null if _provider === null
  res.json({ configured: llmManager.isConfigured, config });
});
```
- `LLMManager._provider` 初始为 `null`，`isConfigured` 返回 `false`
- `safeConfig()` 返回 `this._provider?.toSafeConfig() ?? null` → `null`
- **✅ 逻辑正确**，无缺陷

---

## TC-02 GET /api/llm/presets 返回 4 个预设

**类型**：HTTP 接口 / 静态代码审查  
**优先级**：P0  
**被测代码**：`routes/llm.ts` → `GET /presets`，`types.ts` → `PROVIDER_PRESETS`

**预期行为**：
- 状态码 200
- 响应体 `{ presets: [ {id, config}, ... ] }` 共 4 项（openai, ollama, openrouter, deepseek）

**代码路径分析**：
```
PROVIDER_PRESETS = { openai: {...}, ollama: {...}, openrouter: {...}, deepseek: {...} }
// 共 4 个 key
router.get('/presets', (_req, res) => {
  res.json({ presets: llmManager.presets() });
});
// presets() = Object.entries(PROVIDER_PRESETS).map(...)
```
- 4 个预设 key 数量正确
- **✅ 逻辑正确**

---

## TC-03 POST /api/llm/configure 正确参数返回 ok=true

**类型**：HTTP 接口 / 静态代码审查  
**优先级**：P0  
**被测代码**：`routes/llm.ts` → `POST /configure`，`LLMManager.configure()`

**测试请求**：
```json
{ "type": "ollama", "baseUrl": "http://localhost:11434/v1", "model": "llama3.2" }
```

**预期行为**：
- 状态码 200
- 响应体 `{ ok: true, config: { type, baseUrl, model, hasApiKey, ... } }`

**代码路径分析**：
```
if (!baseUrl || !model) → 400  // 此处传了，不触发
try {
  llmManager.configure({ type, baseUrl, apiKey, model, ... });
  res.json({ ok: true, config: llmManager.safeConfig() });
}
```
- `configure()` 创建 `LLMProvider`，不做网络请求，不会抛出异常
- **✅ 逻辑正确**

---

## TC-04 POST /api/llm/configure 缺少 model 返回 400

**类型**：HTTP 接口 / 静态代码审查  
**优先级**：P0  
**被测代码**：`routes/llm.ts` → `POST /configure`

**测试请求**：
```json
{ "baseUrl": "http://localhost:11434/v1" }
```

**预期行为**：
- 状态码 400
- 响应体 `{ error: "baseUrl and model are required" }`

**代码路径分析**：
```
const { type, baseUrl, apiKey, model, ... } = req.body ?? {};
if (!baseUrl || !model) {
  res.status(400).json({ error: 'baseUrl and model are required' });
  return;
}
```
- **✅ 验证逻辑完整**，缺少 baseUrl 也会触发 400

---

## TC-05 POST /api/llm/configure 缺少 baseUrl 返回 400

**类型**：HTTP 接口 / 静态代码审查  
**优先级**：P1  
**被测代码**：`routes/llm.ts` → `POST /configure`

**测试请求**：
```json
{ "model": "llama3.2" }
```

**预期行为**：
- 状态码 400
- 响应体含 `error` 字段

**代码路径分析**：同 TC-04，`!baseUrl` 为 true → 返回 400  
- **✅ 已覆盖**

---

## TC-06 POST /api/llm/ping（已配置但 Ollama 未运行）返回 ok=false 且不崩溃

**类型**：HTTP 接口 / 静态代码审查  
**优先级**：P0  
**被测代码**：`routes/llm.ts` → `POST /ping`，`LLMProvider.ping()`，`LLMManager.ping()`

**预期行为**：
- 状态码 200（不是 5xx！）
- 响应体 `{ ok: false, model: "...", latencyMs: N, error: "..." }`

**代码路径分析**：
```
// manager.ping()
async ping() {
  if (!this._provider) return { ok: false, model: '', latencyMs: 0, error: 'No provider configured' };
  return this._provider.ping();
}

// provider.ping()
async ping() {
  try {
    const resp = await this.chat([...]);
    return { ok: true, ... };
  } catch (err) {
    return { ok: false, model: ..., latencyMs: ..., error: err.message };
  }
}

// routes/llm.ts
router.post('/ping', async (_req, res) => {
  const result = await llmManager.ping();
  res.json(result);   // 无论 ok=true/false 都是 200
});
```
- `ping()` 内部 try/catch 完整，网络失败返回 `ok: false`，不抛出异常
- 路由层没有额外 try/catch，但 `llmManager.ping()` 已自保
- **✅ 不崩溃，错误被捕获**
- ⚠️ **未配置时** ping 返回 `{ ok: false, model: '', latencyMs: 0, error: 'No provider configured' }` — 合理但不如返回 503

---

## TC-07 POST /api/llm/chat 未配置返回 503

**类型**：HTTP 接口 / 静态代码审查  
**优先级**：P0  
**被测代码**：`routes/llm.ts` → `POST /chat`

**预期行为**：
- 状态码 503
- 响应体 `{ error: "LLM provider not configured..." }`

**代码路径分析**：
```
router.post('/chat', async (req, res) => {
  if (!llmManager.isConfigured) {
    res.status(503).json({ error: 'LLM provider not configured. Call POST /api/llm/configure first.' });
    return;
  }
  ...
});
```
- **✅ 正确**，早期返回，不继续执行

---

## TC-08 POST /api/llm/chat（已配置但 LLM 离线）返回 500 含 error，不崩溃

**类型**：HTTP 接口 / 静态代码审查  
**优先级**：P0  
**被测代码**：`routes/llm.ts` → `POST /chat`，`LLMProvider.chat()`

**预期行为**：
- 状态码 500
- 响应体 `{ ok: false, error: "...", durationMs: N }`（不是未捕获异常）

**代码路径分析**：
```
try {
  const resp = await llmManager.provider!.chat(messages, {...});
  res.json({ ok: true, message: ..., model: ..., usage: ..., durationMs: ... });
} catch (err) {
  res.status(500).json({
    ok: false,
    error: err instanceof Error ? err.message : String(err),
    durationMs: Date.now() - t0,
  });
}
```
- `LLMProvider.chat()` 在网络失败时抛出 `LLMError`（NETWORK_ERROR / TIMEOUT）
- 路由层 catch 正确拦截，返回 500 + error 信息
- **✅ 不崩溃**，错误信息清晰

---

## TC-09 POST /api/llm/run 未配置返回 503

**类型**：HTTP 接口 / 静态代码审查  
**优先级**：P0  
**被测代码**：`routes/llm.ts` → `POST /run`

**预期行为**：
- 状态码 503
- 响应体 `{ error: "LLM provider not configured..." }`

**代码路径分析**：
```
router.post('/run', async (req, res) => {
  if (!llmManager.isConfigured) {
    res.status(503).json({ error: 'LLM provider not configured...' });
    return;
  }
  ...
});
```
- **✅ 正确**

---

## TC-10 POST /api/llm/run（已配置但 LLM 离线）返回 500 含 error，不崩溃

**类型**：HTTP 接口 / 静态代码审查  
**优先级**：P0  
**被测代码**：`routes/llm.ts` → `POST /run`，`LLMPlanner.plan()`

**预期行为**：
- 状态码 500（或 200 with `ok: false`）
- 响应体含 `error` 字段，不是未捕获异常

**代码路径分析**：
```
try {
  const registry = (agentRunner as any).registry;
  const planner = new LLMPlanner(llmManager.provider!, registry);
  const plannerResult = await planner.plan(String(task));
  res.json({ ok: plannerResult.ok, ... });
} catch (err) {
  res.status(500).json({ ok: false, error: ..., durationMs: ... });
}
```
- `LLMPlanner.plan()` 内部在 LLM 调用失败时 catch → 返回 `{ ok: false, error: ... }`，**不抛出**
- 路由层 catch 是第二道防线
- **✅ 不崩溃**，两层保护

⚠️ **潜在问题**：`(agentRunner as any).registry` 使用 `any` 类型强制访问私有成员。如果 `AgentRunner` 更名或重构该属性，运行时报错。属于 P2 代码质量问题。

---

## TC-11 LLMProvider.toSafeConfig() 不含 apiKey 字段

**类型**：静态代码审查  
**优先级**：P0  
**被测代码**：`provider.ts` → `toSafeConfig()`

**预期行为**：
- 返回对象不含 `apiKey` 属性
- 含 `hasApiKey: boolean` 字段

**代码路径分析**：
```typescript
toSafeConfig(): Omit<LLMProviderConfig, 'apiKey'> & { hasApiKey: boolean } {
  const { apiKey, ...rest } = this.config;
  return { ...rest, hasApiKey: !!apiKey };
}
```
- 使用解构 + spread，`apiKey` 被排除
- TypeScript 类型签名 `Omit<LLMProviderConfig, 'apiKey'>` 确保类型安全
- **✅ 正确，apiKey 不泄漏**

---

## TC-12 LLMPlanner 文件存在且结构正确

**类型**：静态代码审查  
**优先级**：P0  
**被测代码**：`planner.ts`

**检查项**：
1. 文件存在 ✅
2. 导出 `LLMPlanner` 类 ✅
3. 构造函数接受 `(llm: LLMProvider, registry: ToolRegistry, maxSteps?)` ✅
4. `plan(task: string): Promise<PlannerResult>` 方法存在 ✅
5. ReAct 循环结构完整（thought/tool_calls/final answer 三分支） ✅
6. 最大步骤数保护（`for (let i = 0; i < this.maxSteps; i++)`) ✅
7. 工具调用错误处理（tool 不存在 / execute 抛出异常） ✅

**分析结论**：结构完整，ReAct 循环健壮。

---

## TC-13 LLMManager.initFromEnv() 无环境变量时返回 false

**类型**：静态代码审查  
**优先级**：P0  
**被测代码**：`manager.ts` → `initFromEnv()`

**预期行为**：
- 当 `LLM_BASE_URL` 或 `LLM_MODEL` 未设置时返回 `false`，不创建 provider

**代码路径分析**：
```typescript
initFromEnv(): boolean {
  const baseUrl = process.env.LLM_BASE_URL;
  const model = process.env.LLM_MODEL;
  if (!baseUrl || !model) return false;
  this.configure({ ... });
  return true;
}
```
- 逻辑清晰，两个必填环境变量缺一返回 `false`
- `index.ts` 启动时调用，结果用于日志输出，不影响服务启动
- **✅ 正确**

---

## TC-14 POST /api/llm/run 缺少 task 字段返回 400

**类型**：HTTP 接口 / 静态代码审查  
**优先级**：P1  
**被测代码**：`routes/llm.ts` → `POST /run`

**代码路径分析**：
```
const { task, sessionId } = req.body ?? {};
if (!task) {
  res.status(400).json({ error: 'task is required' });
  return;
}
```
- **✅ 正确**，验证完整

---

## TC-15 POST /api/llm/chat 缺少 messages 字段返回 400

**类型**：HTTP 接口 / 静态代码审查  
**优先级**：P1  
**被测代码**：`routes/llm.ts` → `POST /chat`

**代码路径分析**：
```
if (!Array.isArray(messages) || messages.length === 0) {
  res.status(400).json({ error: 'messages array is required' });
  return;
}
```
- **✅ 正确**，同时校验数组类型和非空

---

## TC-16 LLMProvider.withConfig() 返回新实例不影响原实例

**类型**：静态代码审查  
**优先级**：P2  
**被测代码**：`provider.ts` → `withConfig()`

**代码路径分析**：
```typescript
withConfig(patch: Partial<LLMProviderConfig>): LLMProvider {
  return new LLMProvider({ ...this.config, ...patch });
}
```
- 返回新实例，原实例 config 不变
- **✅ 不可变模式，正确**

---

## TC-17 LLMManager 路由注册到 /api/llm 前缀

**类型**：静态代码审查  
**优先级**：P0  
**被测代码**：`server.ts`

**代码路径分析**：
```typescript
app.use('/api/llm', createLLMRouter({ llmManager: deps.llmManager, agentRunner: deps.agentRunner }));
```
- **✅ 路由注册正确**，前缀 `/api/llm`

---

## TC-18 LLMManager 在 index.ts 正确初始化并注入

**类型**：静态代码审查  
**优先级**：P0  
**被测代码**：`index.ts`

**代码路径分析**：
```typescript
const llmManager = new LLMManager();
const llmFromEnv = llmManager.initFromEnv();
// ...
const server = createGatewayServer({ ..., llmManager });
```
- **✅ 正确初始化**，依赖注入完整

---

## 汇总

| TC ID | 描述 | 优先级 | 测试类型 |
|-------|------|--------|----------|
| TC-01 | 未配置 GET /config → configured=false | P0 | 代码审查 |
| TC-02 | GET /presets → 4 个预设 | P0 | 代码审查 |
| TC-03 | POST /configure 正确参数 → ok=true | P0 | 代码审查 |
| TC-04 | POST /configure 缺 model → 400 | P0 | 代码审查 |
| TC-05 | POST /configure 缺 baseUrl → 400 | P1 | 代码审查 |
| TC-06 | POST /ping 已配置但离线 → ok=false 不崩溃 | P0 | 代码审查 |
| TC-07 | POST /chat 未配置 → 503 | P0 | 代码审查 |
| TC-08 | POST /chat 已配置但离线 → 500 含 error | P0 | 代码审查 |
| TC-09 | POST /run 未配置 → 503 | P0 | 代码审查 |
| TC-10 | POST /run 已配置但离线 → 500 含 error | P0 | 代码审查 |
| TC-11 | toSafeConfig() 不含 apiKey | P0 | 代码审查 |
| TC-12 | LLMPlanner 结构完整 | P0 | 代码审查 |
| TC-13 | initFromEnv() 无 env 返回 false | P0 | 代码审查 |
| TC-14 | POST /run 缺 task → 400 | P1 | 代码审查 |
| TC-15 | POST /chat 缺 messages → 400 | P1 | 代码审查 |
| TC-16 | withConfig() 返回新实例 | P2 | 代码审查 |
| TC-17 | 路由注册到 /api/llm 前缀 | P0 | 代码审查 |
| TC-18 | LLMManager 正确初始化注入 | P0 | 代码审查 |
