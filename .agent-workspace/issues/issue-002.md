# ISSUE-002

- TC：TC-030
- 严重度：P2
- 描述：广播消息（`to="*"`）只投递给 MessageBus 中已存在 queue 的 Agent。新注册的 Agent 若从未通过总线发送或接收过消息，其 queue 不会被自动创建，因此无法收到广播。这一行为在 API 文档或接口注释中未说明，可能导致使用方误解广播语义。
- 复现步骤：
  ```bash
  # 1. 注册新 Agent
  curl -s -X POST "http://127.0.0.1:19009/api/multi-agent/register" \
    -H "Content-Type: application/json" \
    --data-raw '{"name":"NewAgent","role":"listener"}'
  # 记录返回的 agentId=NEW_ID
  
  # 2. 广播消息（此时 NewAgent 的队列不存在）
  curl -s -X POST "http://127.0.0.1:19009/api/multi-agent/message" \
    -H "Content-Type: application/json" \
    --data-raw '{"from":"sender","to":"*","type":"heartbeat","payload":{}}'
  
  # 3. 新 Agent 拉取 → 空
  curl -s "http://127.0.0.1:19009/api/multi-agent/messages/NEW_ID"
  ```
- 实际结果：`{"messages":[],"total":0}` — 新 Agent 收不到广播
- 预期结果：广播消息应投递给所有已注册的 Agent（registry 中存在的 Agent）；或者 API 文档明确说明广播仅投递给已初始化 bus 队列的 Agent
- 受影响文件：`packages/gateway/src/multi-agent/bus.ts` → `publish()` 方法中广播逻辑；或 `packages/gateway/src/multi-agent/registry.ts` → `register()` 方法（可在注册时同时初始化 bus 队列）
- 建议修复（任选其一）：
  1. 在 `AgentRegistry.register()` 时通知 MessageBus 初始化该 Agent 的 queue
  2. 在 `MessageBus.publish()` 广播时，接受 AgentRegistry 引用并遍历所有注册 Agent
  3. 在接口文档中明确注明此限制
- 状态：fixed — `AgentRegistry` 构造函数接受可选 `MessageBus` 参数；`register()` 时调用 `bus.ensureQueue(id)` 预初始化队列；`index.ts` 已传入 `messageBus` 引用；`MessageBus` 新增 `ensureQueue()` 公开方法
