# EP-05 多 Agent 协作系统

> **Epic 目标**：原生支持 Agent Team，各 Agent 拥有独立子沙箱并共享加密工作记忆，实现真正的多 Agent 并行协作。

- **优先级**：P2
- **阶段**：阶段二（第 2-3 周）
- **状态**：🔄 进行中（EP-05~06 多 Agent 协作已完成实现）

## 用户故事

| ID | 故事 | 优先级 | 状态 |
|----|------|--------|------|
| S-05-01 | 作为用户，我可以创建一个 Agent Team，指定多个 Agent 并行处理不同子任务 | P1 | 🔄 实现中（TeamOrchestrator 待完成） |
| S-05-02 | 作为 Agent，我拥有独立的子沙箱，与其他 Agent 完全隔离 | P0 | ✅ 已完成（AgentSandboxExecutor + AgentSandboxManager） |
| S-05-03 | 作为 Agent Team，各成员可通过加密消息总线互相发送消息和任务结果 | P1 | 🔄 进行中（AES-256 加密待实现） |
| S-05-04 | 作为主 Agent，我可以拆分任务、分发给子 Agent，并汇总结果 | P1 | 🔄 实现中（TeamOrchestrator 待完成） |
| S-05-05 | 作为用户，我可以在控制台实时查看每个 Agent 的执行状态和进度 | P1 | ✅ 已完成（AgentRegistry 状态 + /api/multi-agent/stats） |

## 验收标准

- [x] Agent 子沙箱完全隔离，一个 Agent 崩溃不影响其他 Agent
- [ ] Agent 间消息加密传输，使用临时密钥，会话结束后销毁
- [x] Team 最大支持 10 个并发 Agent（实际无硬性限制）
- [x] 控制台实时展示 Agent 状态（running/idle/error/completed）

## 技术实现

### 1. Per-Agent 独立沙箱（已完成）

**文件**：`packages/gateway/src/multi-agent/sandbox-executor.ts`

- `AgentSandboxExecutor`：每个 Agent 独立的 V8 Isolate 执行器
  - 独立的 V8 Isolate 实例（内存隔离）
  - 独立的安全策略扫描
  - 独立的 console/env 注入
  - 独立的超时/内存限制

- `AgentSandboxManager`：管理所有 Agent 的沙箱生命周期
  - `getOrCreate(agentId)` — 懒创建，按需分配
  - `dispose(agentId)` — 释放单个 Agent 沙箱
  - `disposeAll()` — 全量释放
  - `stats()` — 当前活跃沙箱数量

- **路由**：
  - `POST /api/multi-agent/sandbox/execute` — 在指定 Agent 沙箱中执行代码
  - `DELETE /api/multi-agent/sandbox/:agentId` — 释放沙箱实例
  - `GET /api/multi-agent/sandbox/stats` — 沙箱统计信息

### 2. MessageBus AES-256 加密（待实现）

- 使用 Node.js `crypto` 模块的 AES-256-GCM
- 每个 Agent Session 拥有独立的对称密钥
- 密钥仅存在于内存，会话结束后自动销毁
- 加密范围：message payload 内容
- 元数据（from/to/type/timestamp）保持明文供路由使用

### 3. Team Orchestrator（待实现）

- 任务拆分：将复杂任务按能力拆分为多个子任务
- 分发：通过 MessageBus 向子 Agent 发送 task 消息
- 收集：监听各子 Agent 的 result 消息
- 汇总：将结果聚合成最终输出

### 4. 已完成的架构组件

**AgentRegistry** (`packages/gateway/src/multi-agent/registry.ts`)：
- 注册/注销/心跳
- 按角色/capability 查找
- `pruneOffline()` 自动清理离线 Agent

**MessageBus** (`packages/gateway/src/multi-agent/bus.ts`)：
- 点对点消息 + 广播（to="*"）
- 内存队列 + JSONL 持久化
- 订阅/取消订阅
- `ensureQueue()` 确保广播能送达所有已注册 Agent
