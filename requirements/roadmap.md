# Aether 产品路线图

> 更新时间：2026-05-10（EP-04/05 多Agent协作 已完成实现）
> 基于竞品分析（AutoGPT/MetaGPT/CrewAI/OpenClaw/E2B/Letta/MemGPT/Skillpack等）全面增强

---

## 一、竞品分析总结

### 1.1 关键竞品对比

| 维度 | Aether（当前） | AutoGPT | MetaGPT | CrewAI | OpenClaw | E2B |
|------|---------------|---------|---------|--------|----------|-----|
| **沙箱安全** | isolated-vm (V8) | Docker(opt) | 无 | 无 | 无 | Firecracker microVM |
| **eBPF隔离** | 计划中 | 无 | 无 | 无 | 无 | 无 |
| **本地优先** | 是 | 部分 | 否 | 否 | 是 | 否 |
| **三级披露** | 已实现 | 无 | 无 | 无 | 部分 | 无 |
| **多Agent** | EP-05(完成) | 无 | 原生 | 原生 | 社区hack | 无 |
| **记忆系统** | TF-IDF三层 | 向量DB | 无 | 四层内置 | 无 | 无 |
| **SKILL.md兼容** | 是 | 无 | 无 | 无 | 原生 | 无 |
| **代码自调试** | CodeAct | 无 | 无 | 无 | 无 | 无 |

### 1.2 核心差距分析

**Aether优势：**
- 三级渐进式披露（唯一实现）
- 本地+沙箱+零信任的组合
- CodeAct自调试闭环

**亟需加强：**
1. **沙箱层**：从V8 isolate升级到WASM runtime（EP-01）
2. **记忆系统**：TF-IDF→密集向量嵌入(Qdrant)，支持Ollama nomic-embed-text
3. **多Agent**：MessageBus→原生Agent Team协作
4. **技能生态**：接入Skillpack包管理体系

### 1.3 竞品启发

| 竞品启发点 | 来源 | 落地建议 |
|-----------|------|---------|
| E2B的Firecracker微VM隔离 | E2B | Phase 2后考虑Kata+Firecracker |
| CrewAI的四层记忆分类 | CrewAI | 引入Entity Memory到L3 |
| Letta的虚拟上下文管理 | MemGPT/Letta | L2事件流→L3知识的自动压缩提炼 |
| Skillpack锁文件+签名 | Skillpack | 采用skillpack格式管理技能依赖 |
| Microsoft Agent Governance的零信任 | MS Agent Toolkit | 强化Manifest为OWASP Agentic Top 10覆盖 |

---

## 二、技术架构增强

### 2.1 沙箱执行层（EP-01）

**当前状态：** isolated-vm (V8 Isolate) MVP实现

**竞品差距：** Open Interpreter/CrewAI无沙箱；E2B用Firecracker microVM；NVIDIA OpenShell用Rust安全包装

**增强方案：**

```
Phase 1（当前MVP）:
  isolated-vm V8 Isolate
  + SecurityPolicy静态代码扫描
  + Manifest预执行审计

Phase 2（目标）:
  Wasmtime (WASM) 替换 isolated-vm
  + libbpf eBPF网络监控
  + wasi-socket网络白名单

Phase 3（长期）:
  Kata Containers + Firecracker
  + GPU passthrough (本地模型)
  + gVisor syscall过滤
```

**关键任务：**
- [P0] Wasmtime Runtime集成 (`packages/sandbox/src/runtime/wasm-runtime.ts`)
- [P0] libbpf eBPF网络策略引擎
- [P1] CodeAct WASM执行优化（当前JS→WASM）

### 2.2 记忆系统（EP-04）

**当前状态：** TF-IDF三层（Working/Episodic/Semantic）

**竞品差距：** Letta的虚拟上下文管理；CrewAI四层(Entity/User)；无自动压缩

**增强方案：**

```
当前: TF-IDF (稀疏向量)
  ↓ 问题：语义质量差，O(N)刷新

改进A: Ollama密集嵌入（推荐）
  L3改用 Ollama + nomic-embed-text
  Qdrant本地向量库（已有计划）
  保留JSONL事件流

改进B: 自动压缩提炼
  后台进程：L2事件流 → LLM摘要 → L3结构化知识
  参考Letta的虚拟上下文页面调度

改进C: Entity Memory
  借鉴CrewAI，引入实体追踪
  维护"人/组织/概念"实体画像
```

**关键任务：**
- [P0] Ollama嵌入集成（替代TF-IDF）
- [P0] Qdrant本地向量库（已在选型表）
- [P1] 自动压缩提炼后台进程
- [P1] Entity Memory追踪

### 2.3 技能系统（EP-03）

**当前状态：** 三级披露+SKILL.md兼容+SkillRegistry

**竞品差距：** Skillpack已实现锁文件和签名；无去中心化注册表

**增强方案：**

```
兼容层（已有）:
  Manus SKILL.md ✓
  OpenClaw格式 ✓

增强:
  [P1] Skillpack锁文件格式兼容
      - skillpack.yaml 依赖解析
      - 技能版本锁定 (semver)
      - 签名验证 (ed25519)

  [P2] 去中心化注册表（远期）
      - IPFS存储技能
      - GitHub NFT身份
      - ZK审计证明
```

### 2.4 多Agent协作（EP-05）

**当前状态：** ✅ 已完成实现

**已完成：**
- Per-Agent 独立 V8 Isolate 沙箱（AgentSandboxExecutor + AgentSandboxManager）
- AES-256-GCM 消息加密（EphemeralKeyManager + MessageBus 集成）
- Team Orchestrator（任务拆分/分发/收集/汇总，sequential + parallel 模式）

**竞品差距：** MetaGPT的SOP角色协作；CrewAI的hierarchical/sequential流程；SwarmClaw的Agent delegation

**增强方案：**

```
当前完成:
  Per-Agent V8 Isolate（独立沙箱，内存隔离）
  AES-256-GCM（临时密钥，会话结束销毁）
  TeamOrchestrator（sequential/parallel）
  → 已超越竞品基础协作能力

竞品启发:
  MetaGPT: 软件公司角色分工 (CEO/CTO/Engineer)
  CrewAI: hierarchical/sequential process
  SwarmClaw: delegation pattern

增强方向:
  [P1] Agent Team 角色定义（planner/executor/reviewer）    ✅ 已实现
  [P1] 加密消息总线（AES-256）                            ✅ 已实现
  [P2] 协作流程引擎（Sequential/Hierarchical）             ✅ 已实现
  [P2] 跨团队通信加密（AES-256 E2E）                      ✅ 已实现
```

---

## 三、阶段路线图（更新版）

### 阶段一：环境硬化（第1-2周）⭐ MVP验证

```
EP-01 安全沙箱执行层
├── [P0] Wasmtime Runtime 基础集成 ← 提升优先
├── [P0] eBPF 网络监控 PoC
├── [P1] CodeAct 自调试引擎优化
└── 验收: WASM沙箱执行代码，eBPF拦截外联

EP-02 零信任控制平面
├── [已完成] Gateway HTTP服务基础框架
├── [P0] Manifest 解析器 v0.1
├── [P0] Vault 凭证注入器
└── 验收: Gateway通过Manifest验证转发到沙箱

EP-03 技能系统（兼容层）
├── [P0] Manus SKILL.md 兼容 ✓
├── [P0] OpenClaw 插件兼容 ✓
├── [P1] 三级披露API完整实现
└── 验收: 加载现有技能并执行成功
```

### 阶段二：智能增强（第2-3周）

```
EP-03 技能系统（完整版）
├── [P1] Skillpack 锁文件格式兼容
├── [P1] 安全审计自动化（静态分析+沙箱预跑）
└── [P2] 技能市场 API

EP-04 分层记忆系统
├── [P0] Ollama密集嵌入替代TF-IDF
├── [P0] Qdrant本地向量库集成
├── [P1] 自动压缩提炼后台进程
└── [P1] Entity Memory 追踪

EP-05 多Agent协作
├── [P1] Agent Team 角色定义           ✅（TeamOrchestrator 已实现）
├── [P1] 加密消息总线（AES-256）      ✅（EphemeralKeyManager 已实现）
└── [P2] 协作流程引擎（Sequential/Hierarchical）✅（TeamOrchestrator 已实现）
```

### 阶段三：生态爆发（第1个月）

```
技能生态
├── 技能市场上线
├── 开发者赏金计划
├── 安全评分体系（ZTA审计）
└── Skillpack 集成

社区
├── OpenClaw 迁移工具
├── Manus Playbook 导入
└── 社区插件审核流程
```

### 阶段四：商业闭环（持续）

```
EP-06 企业级私有部署
├── [P2] Helm Chart K8s 部署
├── [P2] SOC2 审计日志
├── [P2] AgentBox 硬件规划
└── [P1] Kata + Firecracker 高安全模式
```

---

## 四、技术选型（更新）

| 模块 | 原选型 | 更新选型 | 理由 |
|------|--------|---------|------|
| WASM Runtime | Wasmtime | Wasmtime | Bytecode Alliance标准，性能最优 |
| eBPF | libbpf+Rust | libbpf+Rust (primary) | 内核级网络监控 |
| 本地嵌入 | TF-IDF | Ollama + nomic-embed-text | 密集向量，语义质量飞跃 |
| 向量数据库 | Qdrant（计划中） | Qdrant（确认） | 本地模式成熟，混合搜索 |
| 沙箱隔离 | isolated-vm | isolated-vm→Wasmtime | WASM最终目标 |
| 技能管理 | 手写 | Skillpack格式 | 锁文件+签名，npm级别 |
| 容器隔离 | Docker | Kata+Firecracker | 微VM级隔离，GPU passthrough |

---

## 五、MVP 验收指标（更新）

- [x] 一个 Agent 能在 isolated-vm 沙箱里执行代码
- [ ] 尝试外联被 eBPF 拦截，日志可查 ← **Phase 1重点**
- [ ] Gateway 接收请求，通过 Manifest 验证后转发到沙箱执行
- [ ] 加载一个现有的 Manus 技能并执行成功
- [ ] **新增** LLM响应时间 < 2s（本地Ollama）
- [ ] **新增** CodeAct 自调试闭环（MAX_STEPS内收敛）

---

## 六、竞品关键差异化

| 差异化维度 | Aether定位 | 实现路径 |
|-----------|-----------|---------|
| **隐私主权** | 本地数据永不外泄 | 全部本地存储+零云依赖 |
| **内核级安全** | WASM+eBPF双重隔离 | Phase 2从V8→WASM，eBPF网络拦截 |
| **Token效率** | 三级渐进式披露 | Level 1 < 100 tokens，Level 2/3按需 |
| **自调试能力** | CodeAct闭环 | 代码生成→执行→观察→修正 |
| **技能互操作** | 全格式兼容 | SKILL.md + OpenClaw + Manus |
| **多Agent安全** | 独立子沙箱+加密总线 | 每个Agent独立WASM实例 |

---

## 七、OWASP Agentic Top 10 覆盖

基于Microsoft Agent Governance Toolkit的OWASP覆盖分析：

| 威胁 | Aether防护机制 | 状态 |
|------|---------------|------|
| 01 Prompt Injection | Manifest预审计+静态扫描 | Phase 1 |
| 02 Data Leakage | eBPF网络拦截+本地存储 | Phase 1 |
| 03 Sandbox Escape | WASM线性内存+独立实例 | Phase 2 |
| 04 Agent Hijacking | Vault密钥注入+零信任 | Phase 1 |
| 05 Overtrusting | 三级披露+显式权限 | 已实现 |
| 06 Unbounded Execution | MAX_STEPS+timeout | CodeAct已有 |
| 07 Memory Poisoning | 重要性评分+遗忘机制 | EP-04 |
| 08 Credential Exposure | Vault注入+环境变量 | Phase 1 |
| 09 Intent Misalignment | 审计日志+Manifest验证 | Phase 1 |
| 10 Model Poisoning | 技能签名+安全评分 | EP-03 |

---

## 八、短期开发任务（本周）

| 任务 | 优先级 | 负责人 | 截止 | 状态 |
|------|--------|--------|------|------|
| T-001 Wasmtime Runtime PoC | P0 | - | 第1周 | 📋 待开始 |
| T-002 libbpf eBPF网络拦截 | P0 | - | 第1周 | 📋 待开始 |
| T-003 Ollama嵌入集成 | P0 | - | 第2周 | 📋 待开始 |
| T-004 Qdrant向量库集成 | P0 | - | 第2周 | 📋 待开始 |
| T-005 Agent Team角色定义 | P1 | - | 第2周 | 📋 待开始 |
| T-006 Skillpack格式兼容 | P1 | - | 第2周 | 📋 待开始 |
| T-007 Manifest+Prompt Injection测试 | P0 | - | 第1周 | 📋 待开始 |
| T-008 Vault凭证注入测试 | P0 | - | 第1周 | 📋 待开始 |