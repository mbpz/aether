# EP-05 多 Agent 协作系统

> **Epic 目标**：原生支持 Agent Team，各 Agent 拥有独立子沙箱并共享加密工作记忆，实现真正的多 Agent 并行协作。

- **优先级**：P2
- **阶段**：阶段二（第 2-3 周）
- **状态**：✅ 基本完成（EP-05 实现完毕）

## 用户故事

| ID | 故事 | 优先级 | 状态 |
|----|------|--------|------|
| S-05-01 | 作为用户，我可以创建一个 Agent Team，指定多个 Agent 并行处理不同子任务 | P1 | ✅ 已完成（TeamOrchestrator） |
| S-05-02 | 作为 Agent，我拥有独立的子沙箱，与其他 Agent 完全隔离 | P0 | ✅ 已完成（AgentSandboxExecutor） |
| S-05-03 | 作为 Agent Team，各成员可通过加密消息总线互相发送消息和任务结果 | P1 | ✅ 已完成（AES-256-GCM） |
| S-05-04 | 作为主 Agent，我可以拆分任务、分发给子 Agent，并汇总结果 | P1 | ✅ 已完成（TeamOrchestrator） |
| S-05-05 | 作为用户，我可以在控制台实时查看每个 Agent 的执行状态和进度 | P1 | ✅ 已完成（AgentRegistry + stats） |

## 验收标准

- [x] Agent 子沙箱完全隔离，一个 Agent 崩溃不影响其他 Agent
- [x] Agent 间消息加密传输，使用临时密钥，会话结束后销毁
- [x] Team 最大支持 10 个并发 Agent
- [x] 控制台实时展示 Agent 状态（running/idle/error/completed）

## 技术实现

### 1. Per-Agent 独立沙箱

**文件**：`packages/gateway/src/multi-agent/sandbox-executor.ts`

- `AgentSandboxExecutor`：每个 Agent 独立的 V8 Isolate 执行器
  - 独立的 V8 Isolate 实例（内存隔离）
  - 独立的安全策略静态扫描（network/fs/process）
  - 独立的 console/env 注入
  - 独立的超时/内存限制

- `AgentSandboxManager`：管理所有 Agent 的沙箱生命周期
  - `getOrCreate(agentId)` — 懒创建，按需分配
  - `dispose(agentId)` — 释放单个 Agent 沙箱
  - `disposeAll()` — 全量释放
  - `stats()` — 当前活跃沙箱数量

**路由**：
- `POST /api/multi-agent/sandbox/execute` — 在指定 Agent 沙箱中执行代码
- `DELETE /api/multi-agent/sandbox/:agentId` — 释放沙箱实例

### 2. AES-256-GCM 消息加密

**文件**：`packages/gateway/src/multi-agent/crypto.ts`

- `EphemeralKeyManager`：会话密钥生命周期管理
  - 每个 Agent 注册时自动生成独立 AES-256 对称密钥
  - 5 分钟 TTL 自动过期销毁
  - 支持主动销毁（会话结束）
  - `revokeAgentKeys(agentId)` — 销毁指定 Agent 所有密钥

- 加密算法：AES-256-GCM（抗篡改 + 完整性验证）
- 密钥派生：Node.js `crypto.randomBytes` 生成 256-bit 原始密钥
- 加密对象：message payload（from/to/type/timestamp 明文用于路由）

### 3. MessageBus 集成加密

**文件**：`packages/gateway/src/multi-agent/bus.ts`

- `createSession(agentId)` — 注册 Agent 时创建密钥
- `publish(msg, senderKey)` — 发送方使用密钥加密 payload
- `consume(agentId)` — 接收方自动尝试解密
- `endSession(agentId)` — 销毁 Agent 所有密钥（注销时调用）

### 4. Team Orchestrator

**文件**：`packages/gateway/src/multi-agent/team-orchestrator.ts`

- `createTeam(name, members)` — 创建持久团队
- `runTeamTask(teamId, task, mode)` — 执行团队任务（sequential/parallel）
- `runQuickTeam(task, agentIds, roleMap)` — 临时团队，快建快用快散
- `disbandTeam(teamId)` — 解散团队，销毁成员密钥 + 沙箱

**路由**：
- `POST /api/multi-agent/team/run` — 快速团队执行
- `POST /api/multi-agent/team/create` — 创建持久团队
- `POST /api/multi-agent/team/:teamId/run` — 团队任务执行
- `DELETE /api/multi-agent/team/:teamId` — 解散团队

### 5. 注册流程增强

**路由**：`POST /api/multi-agent/register`

注册时自动完成三件事：
1. 向 `AgentRegistry` 注册 Agent
2. 调用 `bus.createSession(agentId)` 创建加密密钥
3. 调用 `sandboxManager.getOrCreate(agentId)` 分配独立沙箱

**注销流程增强**：`DELETE /api/multi-agent/agents/:agentId`

注销时自动完成：
1. 调用 `bus.endSession(agentId)` 销毁加密密钥
2. 调用 `sandboxManager.dispose(agentId)` 释放沙箱
3. 从 `AgentRegistry` 注销 Agent

## 文件变更清单

| 文件 | 变更 |
|------|------|
| `src/multi-agent/sandbox-executor.ts` | 新增（Per-agent 独立沙箱） |
| `src/multi-agent/crypto.ts` | 新增（AES-256-GCM 加密层） |
| `src/multi-agent/bus.ts` | 重写（集成加密） |
| `src/multi-agent/team-orchestrator.ts` | 新增（Team 编排器） |
| `src/multi-agent/registry.ts` | 无变更（仅注释更新） |
| `src/routes/multi-agent.ts` | 扩展（新增 team + sandbox 路由） |
| `src/server.ts` | 扩展（注入 TeamOrchestrator） |
| `src/index.ts` | 扩展（初始化链路） |
