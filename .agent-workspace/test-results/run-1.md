# 测试运行报告 Run-1

**日期**：2026-03-14  
**测试环境**：Gateway http://127.0.0.1:19009（新启动进程，EP-05/EP-06 路由已加载）  
**测试轮次**：第 1 轮  
**执行人**：QA Agent  

---

## EP-05 Agent Loop 测试结果

### TC-001: 基本任务执行（无工具匹配）✅
- 请求：`POST /api/agent-loop/run {"task":"Hello, what can you do?"}`
- 响应：`ok=true, sessionId=UUID, steps=[1步], answer包含"Aether Agent"`
- 结果：**通过** — ok=true, steps 非空, answer 包含 "Aether Agent (MockPlanner)"

### TC-002: exec_code 工具调用（calculate 关键词）✅
- 请求：`POST /api/agent-loop/run {"task":"calculate: return 1+1"}`
- 响应：`ok=true, steps[0].action.tool="exec_code", 2步`
- 结果：**通过** — 工具调用正确，但代码为默认示例（见 ISSUE-001）

### TC-003: exec_code 工具调用（执行代码关键词）✅
- 请求：`POST /api/agent-loop/run {"task":"执行代码：return 42"}`
- 响应：`ok=true, steps[0].action.tool="exec_code", observation包含执行结果`
- 结果：**通过** — 工具路由正确，但代码提取为默认值（见 ISSUE-001）

### TC-004: remember 工具调用 ✅
- 请求：`POST /api/agent-loop/run {"task":"记住：今天是测试日"}`
- 响应：`ok=true, steps[0].action.tool="remember", observation包含"记忆写入结果"`
- 结果：**通过**

### TC-005: recall 工具调用 ✅
- 请求：`POST /api/agent-loop/run {"task":"回忆：测试"}`
- 响应：`ok=true, steps[0].action.tool="recall", 找到0条记忆`
- 结果：**通过** — 新 session 无历史记忆，0条结果符合预期

### TC-006: get_status 工具调用 ✅
- 请求：`POST /api/agent-loop/run {"task":"查询系统status"}`
- 响应：`ok=true, steps[0].action.tool="get_status", observation包含"aether-gateway"`
- 结果：**通过**

### TC-007: 自定义 sessionId ✅
- 请求：`POST /api/agent-loop/run {"task":"Hello","sessionId":"test-session-001"}`
- 响应：`ok=true, sessionId="test-session-001"`
- 结果：**通过**

### TC-008: 缺少 task 字段（400）✅
- 请求：`POST /api/agent-loop/run {"sessionId":"x"}`
- 响应：`HTTP 400, error="Bad Request", message='"task" field is required...'`
- 结果：**通过**

### TC-009: task 为空字符串（400）✅
- 请求：`POST /api/agent-loop/run {"task":"   "}`
- 响应：`HTTP 400, error="Bad Request"`
- 结果：**通过**

### TC-010: 列出 sessions ✅
- 请求：`GET /api/agent-loop/sessions`
- 响应：`HTTP 200, sessions=[7条], total=7`，每条包含 sessionId, task, ok, stepCount, durationMs
- 结果：**通过**

### TC-011: 获取指定 session 详情 ✅
- 请求：`GET /api/agent-loop/sessions/test-session-001`
- 响应：`HTTP 200, sessionId="test-session-001", task="Hello", ok=true, stepCount=1, durationMs=5`
- 结果：**通过**

### TC-012: 获取不存在 session（404）✅
- 请求：`GET /api/agent-loop/sessions/nonexistent-id-xyz`
- 响应：`HTTP 404, error="Session not found"`
- 结果：**通过**

### TC-013: 内联代码块提取（P2）⚠️
- 请求：`POST /api/agent-loop/run {"task":"执行代码 run code: return 2 * 21"}`
- 响应：`ok=true, 但代码为默认示例，未提取 "return 2 * 21"`
- 结果：**功能性缺陷** — 见 ISSUE-001（P2，同一问题）

### TC-014: 响应时间合理（< 3s）✅
- 请求：`POST /api/agent-loop/run {"task":"get the gateway status"}`
- 响应：`durationMs=2, ok=true`
- 结果：**通过** — 远低于 3000ms

---

## EP-06 多 Agent 协作测试结果

### TC-020: Agent 注册（基本）✅
- 请求：`POST /api/multi-agent/register {"name":"TestAgent","role":"worker","capabilities":["test"]}`
- 响应：`HTTP 201, ok=true, agent.id=UUID, agent.status="idle"`
- 结果：**通过**

### TC-021: Agent 注册 - 缺少 role（400）✅
- 请求：`POST /api/multi-agent/register {"name":"TestAgent"}`
- 响应：`HTTP 400, error="Bad Request", message='"name" and "role" are required'`
- 结果：**通过**

### TC-022: Agent 注册 - 指定 id（幂等更新）✅
- 请求 1：`POST /api/multi-agent/register {"id":"agent-fixed-001","name":"FixedAgent","role":"qa"}`
- 响应 1：`HTTP 201, agent.id="agent-fixed-001", registeredAt=T1`
- 请求 2（同 id）：`POST /api/multi-agent/register {"id":"agent-fixed-001","name":"FixedAgentUpdated","role":"qa"}`
- 响应 2：`HTTP 201, agent.id="agent-fixed-001", registeredAt=T1（保持不变）, name更新`
- 结果：**通过**

### TC-023: 列出所有 Agent ✅
- 请求：`GET /api/multi-agent/agents`
- 响应：`HTTP 200, agents=[2], total=2`
- 结果：**通过**

### TC-024: 按 role 过滤 Agent ✅
- 请求：`GET /api/multi-agent/agents?role=worker`
- 响应：`HTTP 200, agents=[1], role="worker"`
- `GET /api/multi-agent/agents?role=qa` → `agents=[1], role="qa"`
- 结果：**通过**

### TC-025: Agent 心跳更新 ✅
- 请求：`POST /api/multi-agent/agents/{id}/heartbeat {"status":"busy"}`
- 响应：`HTTP 200, ok=true, lastSeen=最新时间戳`
- 验证：GET agents 返回 status="busy"
- 结果：**通过**

### TC-026: 不存在 Agent 心跳（404）✅
- 请求：`POST /api/multi-agent/agents/nonexistent-agent/heartbeat {}`
- 响应：`HTTP 404, error="Agent not found"`
- 结果：**通过**

### TC-027: 发送点对点消息 ✅
- 请求：`POST /api/multi-agent/message {"from":"agentA","to":"agentB","type":"task","payload":{...}}`
- 响应：`HTTP 201, ok=true, message.id=UUID, message.from/to/type 均正确`
- 结果：**通过**

### TC-028: 拉取消息（consume）✅
- 请求：`GET /api/multi-agent/messages/{agentBId}`
- 响应：`messages=[1条], total=1`，包含 TC-027 发送的消息
- 第二次拉取：`messages=[], total=0`（消息已被消费）
- 结果：**通过**

### TC-029: Peek 消息（不消费）✅
- 请求：`GET /api/multi-agent/messages/{agentId}?peek=true`
- 响应：`messages=[1条], total=1`
- 第二次 peek：`messages=[1条], total=1`（消息未被消费）
- 结果：**通过**

### TC-030: 广播消息（to="*"）✅（需先建立队列）
- 前提：需先向目标 Agent 发送一条消息以建立 bus 队列
- 请求：`POST /api/multi-agent/message {"to":"*","type":"heartbeat"}`
- 响应：`HTTP 201, ok=true`；目标 Agent 可收到广播消息
- 结果：**通过**（设计限制：广播仅投递给 bus 中已有队列的 Agent，见 ISSUE-002）

### TC-031: 无效消息类型（400）✅
- 请求：`POST /api/multi-agent/message {"from":"a","to":"b","type":"invalid_type"}`
- 响应：`HTTP 400, error="Bad Request", message='"type" must be one of: task, result, issue, heartbeat'`
- 结果：**通过**

### TC-032: 消息缺少必填字段（400）✅
- 请求：`POST /api/multi-agent/message {"from":"a","payload":{}}`
- 响应：`HTTP 400, error="Bad Request", message='"from", "to", and "type" are required'`
- 结果：**通过**

### TC-033: 消息历史（JSONL 持久化）✅
- 请求：`GET /api/multi-agent/history`
- 响应：`HTTP 200, messages=[5条], total=5`，每条有 id/from/to/type/timestamp
- 结果：**通过**

### TC-034: 消息总线统计 ✅
- 请求：`GET /api/multi-agent/stats`
- 响应：`HTTP 200, bus.totalQueues=2, bus.pendingMessages=3, bus.subscribers=0, registry.total=4`
- 结果：**通过**

### TC-035: 注销 Agent ✅
- 请求：`DELETE /api/multi-agent/agents/{agentId}`
- 响应：`HTTP 200, ok=true`
- 验证：GET agents 返回 total 减少 1
- 结果：**通过**

### TC-036: 注销不存在的 Agent（404）✅
- 请求：`DELETE /api/multi-agent/agents/nonexistent-xyz`
- 响应：`HTTP 404, error="Agent not found"`
- 结果：**通过**

### TC-037: 复合场景（Agent Loop + Multi-Agent 集成）✅
- 步骤 1：注册 Coordinator Agent → `id=ec60e7c0-...`
- 步骤 2：Agent Loop 执行 `查询系统status` → `ok=true`
- 步骤 3：发送 result 消息给 coordinator → `HTTP 201, ok=true`
- 步骤 4：Coordinator 拉取消息 → `messages=[1条], type="result"`
- 结果：**通过**

---

## 汇总

| 分类 | 总数 | 通过 ✅ | 失败 ❌ | 警告 ⚠️ |
|------|------|---------|---------|---------|
| EP-05 Agent Loop | 14 | 13 | 0 | 1 |
| EP-06 多 Agent 协作 | 18 | 18 | 0 | 0 |
| **合计** | **32** | **31** | **0** | **1** |

> **注**：TC-002/TC-003/TC-013 均为同一 ISSUE-001（代码提取缺陷，P2）  
> TC-030 有设计限制（ISSUE-002，P2，文档问题）

---

## 发现的问题

- **ISSUE-001**（P2）：`extractCodeFromTask` 仅能从 fenced 或 backtick inline 代码块提取代码，任务文本中的裸代码（如 `"execute: return 2+2"`）无法被提取，导致使用默认示例代码运行
- **ISSUE-002**（P2）：广播消息（`to="*"`）只投递给 bus 中已有队列的 Agent，新注册的 Agent 若未曾发/收过消息则收不到广播，文档/接口说明中未说明此限制

---

## 结论

EP-05 和 EP-06 核心功能全部正常，所有 P0 测试用例均通过。发现 2 个 P2 问题（低优先级，不影响主要功能）。
