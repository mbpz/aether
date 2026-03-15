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
│   └── ...
├── tasks/                 # 开发任务（可执行）
│   └── ...
└── roadmap.md             # 产品路线图
```

## Epic 总览

| ID | Epic | 优先级 | 阶段 | 状态 |
|----|------|--------|------|------|
| EP-01 | 安全沙箱执行层（WASM + eBPF） | P0 | 阶段一 | 📋 待开始 |
| EP-02 | 零信任控制平面（Gateway） | P0 | 阶段一 | 📋 待开始 |
| EP-03 | 渐进式技能系统（SKILL.md） | P1 | 阶段一 | 📋 待开始 |
| EP-04 | 分层记忆系统（RAG + 事件流） | P1 | 阶段二 | 📋 待开始 |
| EP-05 | 多 Agent 协作系统 | P2 | 阶段二 | 📋 待开始 |
| EP-06 | 企业级私有部署（K8s） | P2 | 阶段三/四 | 📋 待开始 |

## 四阶段里程碑

| 阶段 | 时间 | 目标 |
|------|------|------|
| 阶段一：环境硬化 | 第 1-2 周 | WASM 沙箱 + Gateway + 兼容层（Manus/OpenClaw 接口）|
| 阶段二：智能增强 | 第 2-3 周 | 本地模型集成 + 分层记忆 + 多 Agent |
| 阶段三：生态爆发 | 第 1 个月 | 开发者生态 + 技能市场 + 社区迁移 |
| 阶段四：商业闭环 | 持续 | 企业私有部署 + AgentBox 硬件 + SOC2 审计 |
