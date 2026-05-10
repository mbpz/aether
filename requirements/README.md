# Aether 需求管理中心

> **项目定位**：主权级通用自主执行系统（Sovereign Autonomous System，SAS）
> 超越 Manus 的云端自动化能力 + OpenClaw 的本地优先架构，解决隐私黑箱、供应链安全、成本不可控三大痛点。

## 目录结构

```
requirements/
├── README.md              # 本文件：总览 & 导航
├── epics/                 # 史诗级需求（大模块）
│   ├── EP-01-sandbox.md       # 安全沙箱执行层
│   ├── EP-02-gateway.md       # 零信任控制平面
│   ├── EP-03-skill-system.md  # 渐进式技能系统
│   ├── EP-04-memory.md        # 分层记忆系统
│   ├── EP-05-multiagent.md    # 多 Agent 协作
│   └── EP-06-deployment.md    # 企业级部署
├── stories/               # 用户故事（功能点）
├── tasks/                 # 开发任务（可执行）
├── roadmap.md             # 产品路线图（功能状态已更新）
├── design.md              # 架构设计文档
├── competitive-analysis.md # 竞品分析报告
└── COMPETITIVE_ANALYSIS_SUMMARY.md # 竞品分析摘要
```

## 竞品分析

基于对 AutoGPT、MetaGPT、CrewAI、OpenClaw、E2B、Letta、Microsoft Agent Governance Toolkit 等 20+ 项目的深度分析：

| 维度 | Aether定位 | 核心优势 |
|------|-----------|---------|
| **沙箱安全** | 内核级（WASM+eBPF） | 唯一本地+内核级隔离 |
| **隐私** | 完全本地 | 数据永不离开设备 |
| **Token效率** | 三级渐进披露 | 唯一完整实现 |
| **多Agent** | 独立子沙箱+加密总线 | 唯一安全多Agent |
| **技能生态** | 全格式兼容 | SKILL.md+OpenClaw+Manus |

详见 [competitive-analysis.md](competitive-analysis.md)。

## 设计文档

- [design.md](design.md) - 系统架构、模块设计、安全模型
- [roadmap.md](roadmap.md) - 产品路线图（✅功能状态已更新）
- [competitive-analysis.md](competitive-analysis.md) - 深度竞品分析

## Epic 总览

| ID | Epic | 优先级 | 阶段 | MVP状态 |
|----|------|--------|------|---------|
| EP-01 | 安全沙箱执行层（WASM + eBPF） | P0 | 阶段一 | 🔄 进行中 |
| EP-02 | 零信任控制平面（Gateway） | P0 | 阶段一 | 🔄 进行中 |
| EP-03 | 渐进式技能系统（SKILL.md） | P1 | 阶段一 | 🔄 进行中 |
| EP-04 | 分层记忆系统（RAG + 事件流） | P1 | 阶段二 | 🔄 进行中 |
| EP-05 | 多 Agent 协作系统 | P2 | 阶段二 | ✅ **完成** |
| EP-06 | 企业级私有部署（K8s） | P2 | 阶段三/四 | 📋 待开始 |

## 四阶段里程碑

| 阶段 | 时间 | 目标 | 状态 |
|------|------|------|------|
| 阶段一：环境硬化 | 第 1-2 周 | WASM 沙箱 + Gateway + 兼容层 | 🔄 进行中 |
| 阶段二：智能增强 | 第 2-3 周 | 本地模型集成 + 分层记忆 + 多 Agent | 📋 待开始 |
| 阶段三：生态爆发 | 第 1 个月 | 开发者生态 + 技能市场 + 社区迁移 | 📋 待开始 |
| 阶段四：商业闭环 | 持续 | 企业私有部署 + AgentBox 硬件 + SOC2 审计 | 📋 待开始 |

## 已完成功能（Superpowers Review后）

### EP-05 多Agent协作 ✅ 完全实现
- MessageBus (内存队列+JSONL持久化)
- AgentRegistry (Agent注册表)
- AES-256-GCM加密消息总线
- Per-Agent独立沙箱 (sandbox-executor)
- TeamOrchestrator (planner/executor/reviewer角色)
- ISSUE-002: ensureQueue()修复

### 安全修复
- 移除unsafe safe-eval降级（sandbox.ts）
- Vault注入受Manifest管控
- Manus/OpenClaw格式检测增强

### 性能优化
- O(N²) embedding刷新 → 阈值策略(500文档)

## 待完成功能

| 任务 | 优先级 | Epic | 状态 |
|------|--------|------|------|
| Wasmtime Runtime | P0 | EP-01 | Phase 2 |
| eBPF网络拦截 | P0 | EP-01 | Phase 2 |
| Ollama密集嵌入 | P0 | EP-04 | Phase 2 |
| Qdrant向量库 | P0 | EP-04 | Phase 2 |
| Skillpack锁文件 | P1 | EP-03 | Phase 2 |
| 协作流程引擎 | P2 | EP-05 | 待开始 |
| Helm Chart K8s | P2 | EP-06 | Phase 3 |
| Kata+Firecracker | P1 | EP-06 | Phase 3 |

## OWASP Agentic Top 10 覆盖状态

| 威胁 | Aether防护 | 状态 |
|------|-----------|------|
| 01 Prompt Injection | Manifest预审计+静态扫描 | ✅ |
| 02 Data Leakage | eBPF网络拦截 | 🔄 Phase 2 |
| 03 Sandbox Escape | WASM线性内存 | 🔄 Phase 2 |
| 04 Agent Hijacking | Vault零信任注入 | ✅ |
| 05 Overtrusting | 三级披露+显式权限 | ✅ |
| 06 Unbounded Execution | MAX_STEPS+timeout | ✅ |
| 07 Memory Poisoning | 重要性评分遗忘 | ✅ |
| 08 Credential Exposure | Vault+环境变量 | ✅ |
| 09 Intent Misalignment | 审计日志+Manifest | ✅ |
| 10 Model Poisoning | 技能签名+评分 | 🔄 Phase 2 |