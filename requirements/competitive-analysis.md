# Aether 竞品分析报告

> 更新时间：2026-05-10
> 分析范围：AI Agent框架、多Agent系统、沙箱执行、记忆管理、技能生态

---

## 一、竞品总览

### 1.1 主要竞品一览

| 项目 | Stars | 语言 | 定位 | 本地优先 | 沙箱安全 | 多Agent |
|------|-------|------|------|---------|---------|---------|
| **AutoGPT** | 184k | Python | 自主Agent平台 | 部分 | Docker(opt) | 无 |
| **MetaGPT** | 67k | Python | 多Agent软件公司 | 否 | 无 | 原生 |
| **Microsoft AutoGen** | 57k | Python | 编程框架 | 否 | Docker | 原生 |
| **CrewAI** | 51k | Python | 角色Agent编排 | 否 | 无 | 原生 |
| **OpenClaw** | 370k | TypeScript | 本地Agent runtime | 是 | 无 | 社区hack |
| **Open Interpreter** | 63k | Python | 自然语言→代码 | 是 | 无 | 无 |
| **Claude Code** | 122k | Shell | 终端编码Agent | 是 | 有 | 无 |
| **E2B** | 12k | Python | 云端安全沙箱 | 否 | Firecracker | 无 |
| **Letta** | 22k | Python | 有记忆的Agent | 是 | 无 | 有 |
| **n8n** | 187k | TypeScript | 工作流自动化 | 是 | Docker | 有 |
| **AgentGPT** | 36k | TypeScript | 浏览器Agent | 否 | 无 | 有 |
| **Agno (Phidata)** | 40k | Python | Agent平台 | 否 | 无 | 有 |
| **SwarmClaw** | 473 | TypeScript | 本地多Agent | 是 | 无 | 原生 |
| **NVIDIA OpenShell** | 5k | Rust | 安全运行时 | 是 | Rust安全 | 无 |
| **MS Agent Governance** | 1k | Python | 零信任治理 | 否 | 沙箱+零信任 | 有 |

---

## 二、按维度对比

### 2.1 安全/沙箱维度

| 等级 | 技术 | 项目 |
|------|------|------|
| **内核级** | WASM + eBPF | Aether（目标） |
| **微VM级** | Firecracker microVM | E2B（云端） |
| **容器级** | Docker/gVisor | AutoGen, n8n, Langflow |
| **进程级** | 无隔离 | AutoGPT, CrewAI, MetaGPT, OpenClaw, Open Interpreter |
| **无** | 纯API调用 | AutoGPT云端, AgentGPT |

**Aether定位：** 内核级（Phase 2 WASM+eBPF），与Microsoft Agent Governance Toolkit并列最强

**核心差距：**
- Open Interpreter: `--safe_mode`仅是批准提示，非隔离
- OpenClaw: Gateway权限在LLM层，非内核层
- E2B: 沙箱强但云端运行，数据离开基础设施

### 2.2 隐私/本地维度

| 等级 | 项目 | 数据流向 |
|------|------|---------|
| **完全本地离线** | AnythingLLM, Open Interpreter, NVIDIA OpenShell, Somi, Aether | 永不离开 |
| **本地+LLM云端** | OpenClaw, SwarmClaw, LibreChat, n8n AI kit | Prompt去云端 |
| **自托管+云LLM** | AgentGPT, Langflow, Flowise, SuperAGI | 数据在本地 |
| **云端依赖** | AutoGPT, MetaGPT, CrewAI, AutoGen, E2B | 数据离开 |

**Aether优势：** 全部本地存储+本地模型（Ollama）+零云依赖

### 2.3 多Agent维度

| 能力 | 项目 |
|------|------|
| **原生角色协作** | MetaGPT（软件公司角色）, CrewAI（hierarchical/sequential） |
| **共享记忆** | Letta, Agno, CrewAI |
| **消息总线** | SwarmClaw, Aether（当前MessageBus MVP） |
| **无** | AutoGPT, Open Interpreter, OpenClaw |
| **安全子沙箱** | **Aether独有能力**（各Agent独立WASM实例） |

**Aether差异化：** 子沙箱隔离=其他框架无此能力

### 2.4 记忆系统维度

| 项目 | 架构 | 向量库 |
|------|------|--------|
| **MemGPT/Letta** | 虚拟上下文管理（三层） | 外置（Qdrant等） |
| **CrewAI** | 四层（short/long/entity/user） | SQLite/外置 |
| **LangChain** | 可插拔（多种后端） | 任意 |
| **Aether EP-04** | 三层（Working/Episodic/Semantic） | TF-IDF→Qdrant（计划） |
| **AutoGPT** | 向量DB（Chroma/Pinecone） | 外置 |

**Aether优势：** 纯本地+三层分层+重要性遗忘
**Aether差距：** TF-IDF语义质量差，无自动压缩提炼

---

## 三、关键竞品详细分析

### 3.1 OpenClaw（最大本地竞品）

**核心数据：**
- Stars: 370,290
- 语言: TypeScript
- 定位: 个人AI助手，本地优先

**架构：**
```
Gateway (端口18789)
  ├── SKILL.md 渐进式加载
  ├── MCP工具集成
  └── Plugin系统
```

**优势：**
- 最大社区生态（5400+技能）
- 跨平台、任意模型后端
- SKILL.md格式被广泛采用

**致命弱点：**
- 无代码执行沙箱
- Gateway权限=LLM prompt层，易被prompt injection绕过
- 无eBPF/WASM内核隔离
- 中心化技能注册表（供应链风险）
- 单Agent架构

**Aether超越点：**
- V8 isolate → WASM+eBPF（内核级隔离）
- 中心化注册表 → 去中心化（IPFS+区块链）
- 无沙箱 → 独立子沙箱

### 3.2 E2B（最强沙箱竞品）

**核心数据：**
- Stars: 12,126
- 语言: Python
- 定位: 云端安全代码执行环境

**架构：**
```
Firecracker microVM（每个沙箱独立VM）
  ├── 文件系统隔离
  ├── 网络控制
  └── SDK（Python/JS）
```

**优势：**
- 微VM级隔离（比容器强）
- 成熟SDK
- 预建沙箱模板

**致命弱点：**
- **云端执行**：数据离开基础设施
- 不可自托管
- 按运行时长计费
- 无本地模型支持

**Aether超越点：**
- 本地执行+本地模型
- 相同隔离强度（WASM+eBPF）
- 零云依赖

### 3.3 MetaGPT（最强多Agent竞品）

**核心数据：**
- Stars: 67,835
- 语言: Python
- 定位: 多Agent软件公司

**架构：**
```
角色Agent:
  CEO → ProductManager → Architect → Engineer → Tester
      ↓ SOPs结构化通信
  输出: PRD/设计文档/代码
```

**优势：**
- 67k stars，多Agent第一
- 角色SOP协作产生连贯软件工件
- 学术背景（PKU/DeepWisdom）

**致命弱点：**
- **全云端**：所有推理走API
- 无沙箱
- 无本地支持
- 仅限软件开发场景

**Aether超越点：**
- 本地优先+隐私
- WASM沙箱
- 通用任务不止软件

### 3.4 CrewAI（最流行多Agent框架）

**核心数据：**
- Stars: 51,037
- 语言: Python
- 定位: 角色编排的多Agent框架

**架构：**
```
Agent (Role + Goal + Backstory)
  └── Tools (SerpDev, CodeInterp, etc.)
Crew (Sequential | Hierarchical)
  └── Process Mode
```

**优势：**
- 入门最简单（10行代码启动）
- Sequential/Hierarchical流程
- 四层记忆（short/long/entity/user）

**致命弱点：**
- 云端API
- **无沙箱**：工具在host Python进程执行
- 无安全模型

**Aether超越点：**
- 本地+沙箱
- 三级披露Token效率
- 独立子沙箱隔离

### 3.5 Letta（最强记忆系统竞品）

**核心数据：**
- Stars: 22,584
- 语言: Python
- 定位: 有记忆的Agent平台

**架构：**
```
MemGPT风格虚拟上下文:
  Core Memory (固定窗口)
  Archival Memory (向量存储)
  Recall Memory (摘要召回)
```

**优势：**
- OS风格的虚拟上下文管理
- 自动内存分页
- LLM决定记忆管理

**致命弱点：**
- 云端依赖（Letta Cloud）
- 无沙箱
- 复杂（MemGPT概念）

**Aether超越点：**
- 本地+纯文件存储
- 事件流（L2）=完整审计追踪
- 更简单的架构

### 3.6 Microsoft Agent Governance Toolkit（最强安全竞品）

**核心数据：**
- Stars: 1,459
- 语言: Python
- 定位: 零信任+沙箱+治理

**架构：**
```
OWASP Agentic Top 10覆盖:
  - 零信任身份
  - 执行沙箱
  - 策略执行
  - 审计日志
```

**优势：**
- 唯一OWASP认证框架
- 微软企业背书
- 零信任架构

**致命弱点：**
- Azure生态依赖
- 新（1.5k stars）
- 非本地Agent平台

**Aether超越点：**
- 完全本地化
- 更完整的技能生态
- SKILL.md兼容性

---

## 四、技能生态系统分析

### 4.1 SKILL.md格式现状

**格式收敛：** 9+ Agent平台采用相同格式
- Claude Code, Codex CLI, Cursor, Windsurf, Manus, OpenClaw, Goose, Hermes

**格式结构：**
```yaml
---
name: skill-name
version: 1.0.0
permissions:
  - network: [...]
  - file_system: [...]
---

# Level 1: Metadata
# Level 2: Instructions
# Level 3: Resources
```

### 4.2 技能分发模式

| 模式 | 项目 | 特点 |
|------|------|------|
| Git仓库市场 | OpenClaw社区（5400+） | `npx skills add <org/repo>` |
| 包管理器 | Skillpack | 锁文件+签名+semver |
| 去中心化 | 计划中（Aether） | IPFS+区块链 |

**Aether机会：**
- Skillpack是唯一带锁文件的包管理器
- 无项目实现去中心化技能注册
- NFT身份+ZK审计是空白

### 4.3 三级披露实现对比

| 项目 | 实现 | 详情 |
|------|------|------|
| **Aether** | ✅ 完整三级 | Level1 < 100tokens, Level2 ~500tokens, Level3按需 |
| **OpenClaw** | ⚠️ 部分 | 简化三级，无显式分离 |
| **Manus（参考）** | ⚠️ 原始 | 全量加载（非三级） |
| **其他** | ❌ 无 | 全量加载，无披露优化 |

**Aether是唯一实现完整三级渐进式披露的框架**

---

## 五、技术架构对比

### 5.1 代码执行技术栈

| 项目 | 执行方式 | 隔离层数 | 资源限制 |
|------|---------|---------|---------|
| **E2B** | Firecracker microVM | VM级 | 有 |
| **Aether** | isolated-vm → WASM | 进程→WASM | 有 |
| **gVisor** | 用户态内核 | 系统调用拦截 | 有 |
| **Kata** | 轻量VM | VM级 | 有 |
| **Docker** | 容器 | cgroups/namespaces | 有 |
| **None** | 直接执行 | 无 | 无 |

**Aether路径：** V8 Isolate (Phase1) → WASM (Phase2) → Kata+Firecracker (Phase3)

### 5.2 网络控制技术栈

| 项目 | 技术 | 层级 |
|------|------|------|
| **Aether（目标）** | eBPF | 内核 |
| **Cilium/Tetragon** | eBPF | 内核 |
| **Falco** | eBPF/probe | 内核 |
| **iptables** | netfilter | 内核 |
| **容器网络** | iptables/nftables | 用户态→内核 |
| **无** | 无 | - |

**Aether eBPF设计：**
```
Agent代码 → WASM沙箱
            ↓ 系统调用
         eBPF Hook (内核层)
            ↓ 违规
         丢弃 + 审计日志
```

### 5.3 记忆系统架构对比

```
Aether当前:              Aether目标:
L1 Working (内存)        L1 Working (内存)
    ↓                      ↓
L2 Episodic (JSONL)     L2 Episodic (JSONL)
    ↓                      ↓ 自动压缩
L3 Semantic (TF-IDF)    L3 Semantic (Qdrant+Ollama)
                           ↓
                        LLM摘要提炼
```

```
Letta:
Core Memory ←→ LLM上下文 ←→ Archival Memory (Qdrant)
                      ↑
                 Recall Memory (摘要)
```

```
CrewAI:
Short-term + Long-term + Entity Memory + User Memory
    ↓                    ↓           ↓
  SQLite            向量检索     实体图谱
```

---

## 六、竞品启发总结

### 6.1 必须立刻采用的

| 启发 | 来源 | 行动 |
|------|------|------|
| **密集向量嵌入** | Letta/CrewAI/LangChain | Phase2迁移到Ollama+nomic-embed-text |
| **Qdrant本地向量库** | 已在选型表 | Phase2确认实现 |
| **Agent Team角色定义** | MetaGPT/CrewAI | EP-05增强 |
| **Skillpack锁文件** | Skillpack | EP-03增强 |
| **OWASP Top10覆盖** | MS Agent Governance | 全面对标 |

### 6.2 需要警惕的坑

| 竞品踩过的坑 | 教训 |
|-------------|------|
| AutoGPT膨胀 | 保持模块化，避免功能蔓延 |
| E2B云端锁定 | 坚持本地优先，永不云端绑定 |
| LangChain复杂度 | 保持简单，避免过度抽象 |
| OpenClaw无沙箱 | 架构上强制沙箱层 |

### 6.3 真正的空白机会

| 空白 | 为什么没人做 | Aether如何填补 |
|------|-------------|----------------|
| **本地+内核级隔离** | 技术门槛高 | WASM+eBPF |
| **去中心化技能信任** | 需区块链基础设施 | IPFS+GitHub NFT |
| **多Agent独立沙箱** | 架构复杂 | 每个Agent独立WASM实例 |
| **三级披露+包管理** | 格式未统一 | Skillpack+SKILL.md |

---

## 七、竞品索引

### 自主Agent平台
- AutoGPT: https://github.com/Significant-Gravitas/AutoGPT (184k)
- BabyAGI: https://github.com/yoheinakajima/babyagi (22k)
- AgentGPT: https://github.com/reworkd/AgentGPT (36k)
- SuperAGI: https://github.com/TransformerOptimus/SuperAGI (17k)

### 多Agent框架
- MetaGPT: https://github.com/FoundationAgents/MetaGPT (67k)
- Microsoft AutoGen: https://github.com/microsoft/autogen (57k)
- CrewAI: https://github.com/crewAIInc/crewAI (51k)
- ChatDev: https://github.com/OpenBMB/ChatDev (33k)
- CAMEL: https://github.com/camel-ai/camel (16k)

### 本地优先Agent
- OpenClaw: https://github.com/openclaw/openclaw (370k stars)
- Open Interpreter: https://github.com/OpenInterpreter/open-interpreter (63k)
- NVIDIA OpenShell: https://github.com/NVIDIA/OpenShell (5k)
- AnythingLLM: https://github.com/Mintplex-Labs/anything-llm (59k)
- SwarmClaw: https://github.com/swarmclawai/swarmclaw (473)

### 记忆/Agent平台
- Letta: https://github.com/letta-ai/letta (22k)
- Agno: https://github.com/agno-agi/agno (40k)

### 代码执行沙箱
- E2B: https://github.com/e2b-dev/E2B (12k)
- gVisor: https://github.com/google/gvisor
- Kata Containers: https://github.com/kata-containers/kata-containers
- Firecracker: https://github.com/firecracker-microvm/firecracker

### 技能/工作流
- Skillpack: https://github.com/JSLEEKR/skillpack
- n8n: https://github.com/n8n-io/n8n (187k)
- Langflow: https://github.com/langflow-ai/langflow (147k)

### 安全框架
- Microsoft Agent Governance: https://github.com/microsoft/agent-governance-toolkit (1.5k)
- Falco: https://github.com/falcosecurity/falco
- Cilium/Tetragon: https://github.com/cilium/cilium