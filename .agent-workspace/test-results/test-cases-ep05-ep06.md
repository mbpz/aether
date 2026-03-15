# EP-05 Agent Loop 测试用例

## TC-001: 基本任务执行（无工具匹配）
- 输入：`POST /api/agent-loop/run { "task": "Hello, what can you do?" }`
- 预期：`ok=true`，`steps` 不为空，`answer` 包含 "Aether Agent" 字样，`sessionId` 为 UUID
- 优先级：P0

## TC-002: exec_code 工具调用（关键词 calculate）
- 输入：`POST /api/agent-loop/run { "task": "calculate: return 1+1" }`
- 预期：`ok=true`，`steps[0].action.tool == "exec_code"`，`steps` 至少 2 步（action + final），`answer` 包含 "exec_code"
- 优先级：P0

## TC-003: exec_code 工具调用（关键词 执行代码）
- 输入：`POST /api/agent-loop/run { "task": "执行代码：return 42" }`
- 预期：`ok=true`，`steps[0].action.tool == "exec_code"`，observation 包含结果
- 优先级：P0

## TC-004: remember 工具调用
- 输入：`POST /api/agent-loop/run { "task": "记住：今天是测试日" }`
- 预期：`ok=true`，`steps[0].action.tool == "remember"`，observation 包含 "记忆写入"
- 优先级：P1

## TC-005: recall 工具调用
- 输入：`POST /api/agent-loop/run { "task": "回忆：测试" }`
- 预期：`ok=true`，`steps[0].action.tool == "recall"`，`answer` 包含 "recall" 或 "检索"
- 优先级：P1

## TC-006: get_status 工具调用
- 输入：`POST /api/agent-loop/run { "task": "查询系统status" }`
- 预期：`ok=true`，`steps[0].action.tool == "get_status"`，observation 包含 `aether-gateway`
- 优先级：P1

## TC-007: 自定义 sessionId
- 输入：`POST /api/agent-loop/run { "task": "Hello", "sessionId": "test-session-001" }`
- 预期：`ok=true`，返回的 `sessionId == "test-session-001"`
- 优先级：P1

## TC-008: 缺少 task 字段（400 校验）
- 输入：`POST /api/agent-loop/run { "sessionId": "x" }`（无 task）
- 预期：HTTP 400，`error == "Bad Request"`，提示 task 必填
- 优先级：P0

## TC-009: task 为空字符串（400 校验）
- 输入：`POST /api/agent-loop/run { "task": "   " }`（全空格）
- 预期：HTTP 400，`error == "Bad Request"`
- 优先级：P0

## TC-010: 列出 sessions（GET /sessions）
- 前提：先执行至少一个 run
- 输入：`GET /api/agent-loop/sessions`
- 预期：HTTP 200，`sessions` 为数组，包含之前运行的记录，每条有 `sessionId`, `task`, `ok`, `stepCount`
- 优先级：P0

## TC-011: 获取指定 session 详情
- 前提：先运行并记录 sessionId
- 输入：`GET /api/agent-loop/sessions/{sessionId}`
- 预期：HTTP 200，包含 `sessionId`, `task`, `ok`, `stepCount`, `durationMs`
- 优先级：P1

## TC-012: 获取不存在的 session（404）
- 输入：`GET /api/agent-loop/sessions/nonexistent-id-xyz`
- 预期：HTTP 404，`error == "Session not found"`
- 优先级：P1

## TC-013: 代码执行包含内联代码块
- 输入：`POST /api/agent-loop/run { "task": "执行代码: \`return 2 * 21\`" }`
- 预期：`ok=true`，步骤中执行了 `return 2 * 21`，结果包含 42
- 优先级：P2

## TC-014: 响应时间合理（< 3s）
- 输入：`POST /api/agent-loop/run { "task": "get the gateway status" }`
- 预期：`durationMs < 3000`，`ok=true`
- 优先级：P1

---

# EP-06 多 Agent 协作测试用例

## TC-020: Agent 注册（基本）
- 输入：`POST /api/multi-agent/register { "name": "TestAgent", "role": "worker", "capabilities": ["test"] }`
- 预期：HTTP 201，`ok=true`，`agent.id` 非空，`agent.name == "TestAgent"`，`agent.role == "worker"`，`agent.status == "idle"`
- 优先级：P0

## TC-021: Agent 注册 - 缺少必填字段（400）
- 输入：`POST /api/multi-agent/register { "name": "TestAgent" }`（无 role）
- 预期：HTTP 400，`error == "Bad Request"`，提示 name 和 role 必填
- 优先级：P0

## TC-022: Agent 注册 - 指定 id（幂等更新）
- 输入：`POST /api/multi-agent/register { "id": "agent-fixed-001", "name": "FixedAgent", "role": "qa" }`
- 预期：HTTP 201，`agent.id == "agent-fixed-001"`
- 再次注册：第二次也返回 201，`agent.registeredAt` 保持第一次的时间
- 优先级：P1

## TC-023: 列出所有 Agent
- 前提：注册至少一个 Agent
- 输入：`GET /api/multi-agent/agents`
- 预期：HTTP 200，`agents` 数组包含已注册的 Agent，`total >= 1`
- 优先级：P0

## TC-024: 按 role 过滤 Agent
- 前提：注册两个 role 不同的 Agent
- 输入：`GET /api/multi-agent/agents?role=worker`
- 预期：HTTP 200，只返回 `role == "worker"` 的 Agent
- 优先级：P1

## TC-025: Agent 心跳更新
- 前提：注册一个 Agent，记录 agentId
- 输入：`POST /api/multi-agent/agents/{agentId}/heartbeat { "status": "busy" }`
- 预期：HTTP 200，`ok=true`，`lastSeen` 为最新时间戳
- 验证：`GET /api/multi-agent/agents` 中该 Agent 的 `status == "busy"`
- 优先级：P1

## TC-026: 不存在的 Agent 心跳（404）
- 输入：`POST /api/multi-agent/agents/nonexistent-agent/heartbeat {}`
- 预期：HTTP 404，`error == "Agent not found"`
- 优先级：P1

## TC-027: 发送点对点消息
- 前提：注册两个 Agent，记录它们的 id（agentA, agentB）
- 输入：`POST /api/multi-agent/message { "from": "{agentA}", "to": "{agentB}", "type": "task", "payload": { "task": "test" } }`
- 预期：HTTP 201，`ok=true`，`message.id` 非空，`message.from == agentA`，`message.to == agentB`，`message.type == "task"`
- 优先级：P0

## TC-028: 拉取消息（consume）
- 前提：TC-027 先执行成功
- 输入：`GET /api/multi-agent/messages/{agentBId}`
- 预期：HTTP 200，`messages` 数组包含 TC-027 发送的消息，`total >= 1`
- 验证：再次拉取，消息已被消费（`total == 0`）
- 优先级：P0

## TC-029: Peek 消息（不消费）
- 前提：先发送一条消息
- 输入：`GET /api/multi-agent/messages/{agentId}?peek=true`
- 预期：HTTP 200，消息存在；再次 peek，消息仍存在（未被消费）
- 优先级：P1

## TC-030: 广播消息（to = "*"）
- 前提：注册两个 Agent（agentX, agentY），确保 bus 中有其 queue
- 输入：`POST /api/multi-agent/message { "from": "{agentX}", "to": "*", "type": "heartbeat", "payload": {} }`
- 预期：HTTP 201，`ok=true`；`GET /messages/{agentY}` 可收到广播消息
- 优先级：P1

## TC-031: 消息类型校验（无效类型 400）
- 输入：`POST /api/multi-agent/message { "from": "a", "to": "b", "type": "invalid_type", "payload": {} }`
- 预期：HTTP 400，`error == "Bad Request"`，提示 type 必须是 task/result/issue/heartbeat
- 优先级：P0

## TC-032: 消息缺少必填字段（400）
- 输入：`POST /api/multi-agent/message { "from": "a", "payload": {} }`（无 to, type）
- 预期：HTTP 400，`error == "Bad Request"`
- 优先级：P0

## TC-033: 消息历史（JSONL 持久化）
- 前提：发送至少一条消息
- 输入：`GET /api/multi-agent/history`
- 预期：HTTP 200，`messages` 非空，每条消息有 `id`, `from`, `to`, `type`, `timestamp`
- 优先级：P1

## TC-034: 消息总线统计
- 输入：`GET /api/multi-agent/stats`
- 预期：HTTP 200，包含 `bus.totalQueues`, `bus.pendingMessages`, `bus.subscribers`, `registry.total`
- 优先级：P1

## TC-035: 注销 Agent
- 前提：注册一个 Agent，记录 agentId
- 输入：`DELETE /api/multi-agent/agents/{agentId}`
- 预期：HTTP 200，`ok=true`；`GET /api/multi-agent/agents` 中该 Agent 不再存在
- 优先级：P1

## TC-036: 注销不存在的 Agent（404）
- 输入：`DELETE /api/multi-agent/agents/nonexistent-xyz`
- 预期：HTTP 404，`error == "Agent not found"`
- 优先级：P1

## TC-037: 消息总线与 Agent Loop 集成（复合场景）
- 步骤 1：注册一个协调 Agent（coordinator）
- 步骤 2：运行 Agent Loop（`POST /api/agent-loop/run { "task": "查询系统 status" }`）
- 步骤 3：发送 result 消息 `{ from: "agent-loop", to: coordinator.id, type: "result", payload: { answer: ... } }`
- 步骤 4：coordinator 拉取消息
- 预期：全流程无错误，消息内容完整
- 优先级：P2
