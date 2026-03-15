# EP-07 LLM Planner — PM 验收报告

**验收时间**: 2026-03-14 23:34 CST  
**验收方式**: 代码级审查（QA Agent 尚在运行中，PM 直接进行代码级验收）  
**验收结论**: ✅ **ACCEPTED**

---

## 一、验收清单

### 1. LLM 路由完整性（6 个端点）

检查文件：`packages/gateway/src/routes/llm.ts`

| 端点 | 方法 | 实现状态 | 说明 |
|------|------|----------|------|
| `/api/llm/presets` | GET | ✅ 已实现 | 返回 4 个预设（openai/ollama/openrouter/deepseek） |
| `/api/llm/config` | GET | ✅ 已实现 | 返回 safeConfig，不含 apiKey |
| `/api/llm/configure` | POST | ✅ 已实现 | 参数校验完整，400 处理 |
| `/api/llm/ping` | POST | ✅ 已实现 | 测试 LLM 连通性 |
| `/api/llm/chat` | POST | ✅ 已实现 | 未配置时返回 503 |
| `/api/llm/run` | POST | ✅ 已实现 | 未配置时返回 503，使用 LLM Planner |

**结论**: ✅ 6/6 端点全部实现，均已在 `server.ts` 中以 `/api/llm` 前缀挂载（第 101 行）。

---

### 2. 错误处理：未配置时 chat/run 返回 503

```typescript
// routes/llm.ts — POST /chat (第 71-74 行)
if (!llmManager.isConfigured) {
  res.status(503).json({ error: 'LLM provider not configured. Call POST /api/llm/configure first.' });
  return;
}

// routes/llm.ts — POST /run (第 108-111 行)
if (!llmManager.isConfigured) {
  res.status(503).json({ error: 'LLM provider not configured. Call POST /api/llm/configure first.' });
  return;
}
```

**结论**: ✅ `chat` 和 `run` 端点在未配置时均正确返回 503，不会崩溃。

---

### 3. 安全性：GET /api/llm/config 不暴露 apiKey

```typescript
// llm/provider.ts — toSafeConfig() (第 161-164 行)
toSafeConfig(): Omit<LLMProviderConfig, 'apiKey'> & { hasApiKey: boolean } {
  const { apiKey, ...rest } = this.config;
  return { ...rest, hasApiKey: !!apiKey };
}

// llm/manager.ts — safeConfig() (第 69-71 行)
safeConfig(): (Omit<LLMProviderConfig, 'apiKey'> & { hasApiKey: boolean }) | null {
  return this._provider?.toSafeConfig() ?? null;
}
```

`GET /config` 返回的 `config` 对象中，`apiKey` 字段被解构移除，仅保留 `hasApiKey: boolean`（布尔值）。

**结论**: ✅ apiKey 不会通过 config 端点泄露，安全性达标。

---

### 4. 向后兼容：MockPlanner（/api/agent-loop/run）依然可用

检查文件：`packages/gateway/src/routes/agent-loop.ts`

`POST /api/agent-loop/run` 路由完整保留，且在 `server.ts` 第 99 行独立挂载：
```typescript
app.use('/api/agent-loop', createAgentLoopRouter({ agentRunner: deps.agentRunner }));
```

LLM Planner 是**新增路由**（`/api/llm/run`），并未替换原有的 MockPlanner 路由。

**结论**: ✅ 向后兼容性完全保留。

---

### 5. UI 面板：index.html 包含必要的 LLM 元素

检查文件：`packages/ui/index.html`

| 元素 ID | 类型 | 存在 | 用途 |
|---------|------|------|------|
| `llm-preset` | `<select>` | ✅ | Provider 预设选择（4 个选项：ollama/openai/openrouter/deepseek） |
| `llm-base-url` | `<input type="text">` | ✅ | Base URL 输入框 |
| `llm-model` | `<input type="text">` | ✅ | 模型名称输入框 |
| `llm-run-btn` | `<button>` | ✅ | 触发 ReAct Agent 运行 |
| `llm-api-key` | `<input type="text">` | ✅ | API Key 输入（可选） |
| `llm-output` | `<div>` | ✅ | ReAct 步骤可视化输出区 |
| `llm-status-badge` | `<span>` | ✅ | 配置状态徽章 |

UI 面板（第 313-397 行）完整实现，包括：
- Provider 配置区（preset/base-url/model/api-key + Apply/Test 按钮）
- ReAct 任务输入区（textarea + Run Agent / Direct Chat 按钮）
- ReAct 步骤可视化（`renderStep` 函数，区分 thought/action/observation/answer）
- 初始化时调用 `checkLLMConfig()` 从后端读取当前配置状态

**结论**: ✅ UI 面板完整，所有必要元素齐备。

---

### 6. 零依赖：package.json 中没有新增 dependencies

检查文件：`packages/gateway/package.json`

**当前 dependencies（与 EP-06 验收时完全一致）**:
```json
{
  "dotenv": "^16.4.5",
  "express": "^4.18.2",
  "isolated-vm": "^6.1.2",
  "js-yaml": "^4.1.0",
  "uuid": "^9.0.0",
  "ws": "^8.16.0"
}
```

LLM HTTP Client 使用 Node 18+ 内置 `fetch`（provider.ts 第 93 行：`res = await fetch(url, {...})`），超时使用 `AbortController`，均为原生 API，无任何新增依赖。

**结论**: ✅ 零新增依赖，完全符合要求。

---

## 二、额外加分项

### ReAct 循环实现质量

`llm/planner.ts` 实现了完整的 ReAct（Reason+Act）循环：
- **系统提示**: 明确 Thought → Action → Observation → Final Answer 规则
- **工具调用**: 支持 OpenAI function calling 格式，自动格式转换
- **错误恢复**: LLM 调用失败不崩溃，返回 `ok: false` 和错误信息
- **最大步骤限制**: 默认 10 步，防止无限循环
- **消息历史**: 正确维护多轮对话上下文

### 多 Provider 支持

`llm/types.ts` 中 `PROVIDER_PRESETS` 覆盖了 OpenAI / Ollama / OpenRouter / DeepSeek，真正做到一套代码支持多种 OpenAI-compatible API。

### OpenRouter 特殊 Header

`provider.ts` 中正确处理了 OpenRouter 的特殊要求（`HTTP-Referer` + `X-Title` headers）。

---

## 三、验收总结

| 验收标准 | 状态 | 备注 |
|----------|------|------|
| LLM 路由完整性（6 端点） | ✅ PASS | presets/config/configure/ping/chat/run 均已实现 |
| 错误处理（503 不崩溃） | ✅ PASS | chat/run 均有 isConfigured 守卫 |
| 安全性（不暴露 apiKey） | ✅ PASS | toSafeConfig() 隐去 apiKey，仅返回 hasApiKey 布尔值 |
| 向后兼容（MockPlanner 可用） | ✅ PASS | /api/agent-loop/run 完整保留 |
| UI 面板（必要元素齐备） | ✅ PASS | 5 个面板，LLM 面板在第 ⑤ 位 |
| 零依赖（原生 fetch） | ✅ PASS | package.json dependencies 无新增项 |

**最终结论：EP-07 LLM Planner 验收通过 ✅**

代码质量高，实现规范，安全设计合理，向后兼容良好。可正式进入 accepted 状态。

---

*PM Agent 审查人: pm*  
*Cycle: 2 | EP: 07*
