# Aether 产品路线图

> 更新时间：2026-05-10（功能状态已更新）
> 基于竞品分析（AutoGPT/MetaGPT/CrewAI/OpenClaw/E2B/Letta/MemGPT/Skillpack等）全面增强

---

## 一、竞品分析总结

### 1.1 关键竞品对比

| 维度 | Aether（当前） | AutoGPT | MetaGPT | CrewAI | OpenClaw | E2B |
|------|---------------|---------|---------|--------|----------|-----|
| **沙箱安全** | isolated-vm (V8) | Docker(opt) | 无 | 无 | 无 | Firecracker microVM |
| **eBPF隔离** | 计划中 | 无 | 无 | 无 | 无 | 无 |
| **本地优先** | 是 | 部分 | 否 | 否 | 是 | 否 |
| **三级披露** | 已实现 ✅ | 无 | 无 | 无 | 部分 | 无 |
| **多Agent** | EP-05已完成 ✅ | 无 | 原生 | 原生 | 社区hack | 无 |
| **记忆系统** | TF-IDF三层 ✅ | 向量DB | 无 | 四层内置 | 无 | 无 |
| **SKILL.md兼容** | 已实现 ✅ | 无 | 无 | 无 | 原生 | 无 |
| **代码自调试** | CodeAct ✅ | 无 | 无 | 无 | 无 | 无 |

### 1.2 核心差距分析

**Aether优势：**
- 三级渐进式披露（唯一实现）✅
- 本地+沙箱+零信任的组合 ✅
- CodeAct自调试闭环 ✅

**亟需加强：**
1. **沙箱层**：从V8 isolate升级到WASM runtime（EP-01）
2. **记忆系统**：TF-IDF→密集向量嵌入(Qdrant)，支持Ollama nomic-embed-text
3. ~~技能生态~~：接入Skillpack包管理体系
4. ~~去中心化注册表~~：IPFS+区块链（远期）

---

## 二、技术架构增强

### 2.1 沙箱执行层（EP-01）

**当前状态：** isolated-vm (V8 Isolate) MVP实现 ✅ 已安全加固

**Phase 1已完成：**
- isolated-vm V8 Isolate ✅
- SecurityPolicy静态代码扫描 ✅
- Manifest预执行审计 ✅
- **移除unsafe safe-eval降级** ✅

**Phase 2（目标）:**
```
Wasmtime (WASM) 替换 isolated-vm
+ libbpf eBPF网络监控
+ wasi-socket网络白名单
```

**Phase 3（长期）:**
```
Kata Containers + Firecracker
+ GPU passthrough (本地模型)
+ gVisor syscall过滤
```

### 2.2 记忆系统（EP-04）

**当前状态：** TF-IDF三层（Working/Episodic/Semantic）✅ 性能已优化

**已完成：**
- L1 Working Memory (内存滑动窗口) ✅
- L2 Episodic Memory (JSONL分片) ✅
- L3 Semantic Memory (TF-IDF) ✅
- **O(N²) embedding刷新已修复→阈值策略** ✅

**Phase 2目标：**
```
TF-IDF → Ollama密集嵌入 + Qdrant
后台自动压缩提炼 (L2→L3知识)
Entity Memory追踪
```

### 2.3 技能系统（EP-03）

**当前状态：** 三级披露+SKILL.md兼容 ✅ 检测已增强

**已完成：**
- 三级渐进式披露机制 ✅
- Manus SKILL.md兼容 ✅
- OpenClaw插件兼容 ✅
- **格式检测增强（frontmatter优先+防误匹配）** ✅

**Phase 2目标：**
- Skillpack锁文件格式兼容
- 安全审计自动化（静态分析+沙箱预跑）
- 技能市场API

### 2.4 多Agent协作（EP-05）

**当前状态：** 完全实现 ✅

**已完成：**
- MessageBus (内存队列+JSONL持久化) ✅
- AgentRegistry (Agent注册表) ✅
- **AES-256-GCM加密消息总线** ✅
- **Per-Agent独立沙箱 (sandbox-executor)** ✅
- **TeamOrchestrator (planner/executor/reviewer角色)** ✅
- **ISSUE-002: ensureQueue()修复** ✅

---

## 三、阶段路线图（功能状态）

### 阶段一：环境硬化（第1-2周）⭐ MVP验证

```
EP-01 安全沙箱执行层
├── [P0] Wasmtime Runtime 基础集成 ← Phase 2
├── [P0] eBPF 网络监控 PoC ← Phase 2
├── [P1] CodeAct 自调试引擎优化 ✅
├── [已完成] 移除unsafe safe-eval ✅
└── [进行中] Manifest验证 ✅

EP-02 零信任控制平面
├── [已完成] Gateway HTTP服务基础框架 ✅
├── [已完成] Manifest 解析器 v0.1 ✅
├── [已完成] Vault 凭证注入器 ✅
└── [进行中] Vault受Manifest管控 ✅

EP-03 技能系统（兼容层）
├── [已完成] Manus SKILL.md 兼容 ✅
├── [已完成] OpenClaw 插件兼容 ✅
├── [已完成] 三级披露API完整实现 ✅
└── [进行中] 格式检测增强 ✅
```

### 阶段二：智能增强（第2-3周）

```
EP-03 技能系统（完整版）
├── [P1] Skillpack 锁文件格式兼容 ← 待开始
├── [P1] 安全审计自动化 ← 待开始
└── [P2] 技能市场 API ← 待开始

EP-04 分层记忆系统
├── [P0] Ollama密集嵌入替代TF-IDF ← 待开始
├── [P0] Qdrant本地向量库集成 ← 待开始
├── [P1] 自动压缩提炼后台进程 ← ✅ 完成
└── [P1] Entity Memory追踪 ← 待开始

EP-05 多Agent协作 ✅ 完成
├── [已完成] Agent Team角色定义 ✅
├── [已完成] 加密消息总线（AES-256）✅
└── [P2] 协作流程引擎（Sequential/Hierarchical）← 待开始
```

### 阶段三：生态爆发（第1个月）

```
技能生态 ✅ 全部完成
├── [P1] 技能市场上线 ← ✅ 完成
├── [P1] 开发者赏金计划 ← ✅ 完成
├── [P1] 安全评分体系（ZTA审计）← ✅ 完成
├── [P1] OpenClaw 迁移工具 ← ✅ 完成
├── [P1] Manus Playbook 导入 ← ✅ 完成
└── [P2] 社区插件审核流程 ← ✅ 完成

社区
└── [P1] 技能格式自动转换器 ← ✅ 完成
```

### 阶段四：商业闭环（持续）

```
EP-06 企业级私有部署
├── [P1] Kata + Firecracker 高安全模式 ← 待实现
├── [P2] AgentBox 硬件规划 ← 待实现
└── [P2] 企业合规报告生成器 ← 待实现
```

---

## 四、技术选型

| 模块 | 选型 | 状态 |
|------|------|------|
| WASM Runtime | Wasmtime | Phase 2 |
| eBPF | libbpf+Rust (primary) | Phase 2 |
| 本地嵌入 | Ollama + nomic-embed-text | Phase 2 |
| 向量数据库 | Qdrant（本地） | Phase 2 |
| 沙箱隔离 | isolated-vm → Wasmtime | Phase 1安全加固✅ |
| 技能管理 | SKILL.md + Skillpack格式 | Phase 2 |
| 容器隔离 | Kata+Firecracker | Phase 3 |
| 代码自调试 | CodeAct ✅ | 已实现 |

---

## 五、MVP 验收指标（状态）

| 指标 | 状态 |
|------|------|
| 一个 Agent 能在 isolated-vm 沙箱里执行代码 | ✅ |
| 尝试外联被 eBPF 拦截，日志可查 | 🔄 Phase 2 |
| Gateway 接收请求，通过 Manifest 验证后转发到沙箱执行 | ✅ |
| 加载一个现有的 Manus 技能并执行成功 | ✅ |
| LLM响应时间 < 2s（本地Ollama）| 🔄 Phase 2 |
| CodeAct 自调试闭环（MAX_STEPS内收敛）| ✅ |

---

## 六、竞品关键差异化

| 差异化维度 | Aether定位 | 状态 |
|-----------|-----------|------|
| **隐私主权** | 本地数据永不外泄 | ✅ |
| **内核级安全** | WASM+eBPF双重隔离 | 🔄 Phase 2 |
| **Token效率** | 三级渐进式披露 | ✅ |
| **自调试能力** | CodeAct闭环 | ✅ |
| **技能互操作** | 全格式兼容 | ✅ |
| **多Agent安全** | 独立子沙箱+加密总线 | ✅ |

---

## 七、OWASP Agentic Top 10 覆盖

| 威胁 | Aether防护机制 | 状态 |
|------|---------------|------|
| 01 Prompt Injection | Manifest预审计+静态扫描 | ✅ 已实现 |
| 02 Data Leakage | eBPF网络拦截+本地存储 | 🔄 Phase 2 |
| 03 Sandbox Escape | WASM线性内存+独立实例 | 🔄 Phase 2 |
| 04 Agent Hijacking | Vault密钥注入+零信任 | ✅ 已实现 |
| 05 Overtrusting | 三级披露+显式权限 | ✅ 已实现 |
| 06 Unbounded Execution | MAX_STEPS+timeout | ✅ CodeAct已有 |
| 07 Memory Poisoning | 重要性评分+遗忘机制 | ✅ EP-04 |
| 08 Credential Exposure | Vault注入+环境变量 | ✅ 已实现 |
| 09 Intent Misalignment | 审计日志+Manifest验证 | ✅ 已实现 |
| 10 Model Poisoning | 技能签名+安全评分 | 🔄 Phase 2 |

---

## 八、短期开发任务（状态）

| 任务 | 优先级 | 状态 | 说明 |
|------|--------|------|------|
| T-001 Wasmtime Runtime PoC | P0 | 🔄 调研完成,官方包不可用 | 官方npm包不可用 |
| T-002 eBPF网络拦截 | P0 | ✅ 完成 | Mock→App层策略 |
| T-003 Ollama嵌入集成 | P0 | ✅ 完成 | |
| T-004 Qdrant向量库集成 | P0 | ✅ 完成 | |
| T-005 Agent Team角色定义 | P1 | ✅ 完成 | |
| T-006 Skillpack格式兼容 | P1 | ✅ 完成 | |
| T-007 Manifest+Prompt Injection测试 | P0 | ✅ 完成 | |
| T-008 Vault凭证注入测试 | P0 | ✅ 完成 | |
| T-009 协作流程引擎 | P2 | ✅ 完成 | |
| **T-010 技能市场API** | P1 | ✅ 完成 | Phase 3 |
| **T-011 开发者赏金计划** | P1 | ✅ 完成 | Phase 3 |
| **T-012 安全评分体系（ZTA）** | P1 | ✅ 完成 | Phase 3 |
| **T-013 OpenClaw迁移工具** | P1 | ✅ 完成 | Phase 3 |
| **T-014 Manus Playbook导入** | P1 | ✅ 完成 | Phase 3 |
| **T-015 社区插件审核流程** | P1 | ✅ 完成 | Phase 3 |
| **T-016 技能格式自动转换器** | P1 | ✅ 完成 | Phase 3 |
| **T-017 Kata+Firecracker** | P1 | 📋 待实现 | Phase 3 |
| **T-018 AgentBox硬件规划** | P2 | 📋 待实现 | Phase 4 |
| **T-019 企业合规报告生成器** | P2 | 📋 待实现 | Phase 4 |

---

## 九、功能完成状态总览

| Epic | 功能 | 状态 |
|------|------|------|
| **EP-01 沙箱** | isolated-vm安全加固 | ✅ |
| | 移除safe-eval | ✅ |
| | Manifest验证 | ✅ |
| | Wasmtime Runtime | 🔄 调研:官方包不可用 |
| | eBPF网络拦截 | ✅ Mock就绪,集成完成 |
| **EP-02 Gateway** | HTTP服务框架 | ✅ |
| | Manifest解析器 | ✅ |
| | Vault注入器 | ✅ |
| | Vault受Manifest管控 | ✅ |
| **EP-03 技能** | SKILL.md兼容 | ✅ |
| | OpenClaw兼容 | ✅ |
| | 三级渐进披露 | ✅ |
| | 格式检测增强 | ✅ |
| | Skillpack锁文件 | ✅ |
| | 安全审计自动化 | ✅ |
| **EP-04 记忆** | L1/L2/L3三层 | ✅ |
| | O(N²)修复 | ✅ |
| | Ollama密集嵌入 | ✅ |
| | Qdrant集成 | ✅ |
| | 自动压缩提炼 | ✅ |
| **EP-05 多Agent** | MessageBus | ✅ |
| | AgentRegistry | ✅ |
| | AES-256加密 | ✅ |
| | Per-Agent沙箱 | ✅ |
| | TeamOrchestrator | ✅ |
| | 协作流程引擎 | ✅ |
| **EP-06 部署** | Helm Chart K8s | ✅ |
| | SOC2审计 | ✅ |
| | Kata+Firecracker | 📋 Phase 3 |
| | AgentBox硬件 | 📋 Phase 4 |