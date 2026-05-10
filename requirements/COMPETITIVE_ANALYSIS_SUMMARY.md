# Aether 竞品分析增强总结

> 2026-05-10

## 一、分析范围

基于对以下 4 个维度的 20+ 项目的深度研究：

1. **AI Agent 框架**：AutoGPT、OpenClaw、Open Interpreter、AnythingLLM、NVIDIA OpenShell、LibreChat、SwarmClaw、Holon、MaxClaw、Somi
2. **多 Agent 框架**：MetaGPT、Microsoft AutoGen、CrewAI、ChatDev、CAMEL、Agno(Phidata)
3. **代码执行沙箱**：E2B、gVisor、Kata Containers、Firecracker、CodeInterpreter 系列
4. **记忆系统**：Letta/MemGPT、CrewAI Memory、LangChain Memory、以及 Qdrant/Chroma/LanceDB 等向量库

## 二、核心发现

### 2.1 市场规模与格局

| 类别 | 头部项目 | Stars 范围 | 技术路线 |
|------|---------|-----------|---------|
| 自主 Agent | AutoGPT | 184k | 云端优先 |
| 多Agent框架 | MetaGPT/CrewAI | 51k-67k | 云端API |
| 本地Agent | OpenClaw | 370k | 本地+无沙箱 |
| 工作流 | n8n/Langflow | 147k-187k | 容器级 |
| 安全沙箱 | E2B | 12k | 微VM（云端） |

### 2.2 关键差距

Aether 是**唯一**结合以下能力的项目：
- 本地优先（数据不离开设备）
- 内核级代码隔离（WASM+eBPF）
- 三级渐进式披露
- 独立 Agent 子沙箱

### 2.3 竞品启发

| 启发点 | 竞品 | Aether 行动计划 |
|--------|------|----------------|
| 密集向量嵌入 | Letta/CrewAI | Phase 2 迁移到 Ollama nomic-embed-text |
| Qdrant 本地向量 | 已在选型表 | Phase 2 确认实现 |
| Agent Team 角色 | MetaGPT/CrewAI | EP-05 增强角色定义 |
| Skillpack 锁文件 | Skillpack | EP-03 兼容 skillpack 格式 |
| OWASP Top10 覆盖 | MS Agent Governance | 全面对标 Manifest 设计 |
| Firecracker 微VM | E2B | Phase 3 考虑 Kata+Firecracker |

## 三、Aether 竞争优势

### 3.1 技术护城河

1. **三级渐进式披露** - Token 消耗降低 ≥60%，其他项目无此实现
2. **WASM + eBPF 双层隔离** - 内核级安全，无竞品做到本地+内核级
3. **CodeAct 自调试** - 代码生成→执行→观察→修正闭环
4. **去中心化技能信任** - IPFS+GitHub NFT，远期规划

### 3.2 市场定位

```
其他本地项目: OpenClaw (无沙箱), Open Interpreter (无沙箱), AnythingLLM (非执行平台)
其他安全项目: E2B (云端), MS Agent Gov (Azure锁定)
其他多Agent: MetaGPT/CrewAI (云端, 无沙箱)

Aether = 本地优先 + 内核级隔离 + 多Agent + 技能生态
```

## 四、需要加强的短板

| 短板 | 当前状态 | 目标状态 |
|------|---------|---------|
| 沙箱层 | V8 Isolate (MVP) | Wasmtime + eBPF |
| 记忆系统 | TF-IDF (稀疏) | Ollama 密集嵌入 + Qdrant |
| 多Agent | MessageBus MVP | Agent Team + 角色 + 加密总线 |
| 技能生态 | 三级披露 | Skillpack 锁文件 + 签名 |

## 五、已更新文档

1. **requirements/competitive-analysis.md** - 20+ 项目深度分析
2. **requirements/roadmap.md** - 基于竞品增强的路线图
3. **requirements/design.md** - 架构设计文档（新增）
4. **requirements/README.md** - 更新导航

## 六、竞品索引

完整竞品列表和链接见 `competitive-analysis.md` 第七节。

### 关键竞品 GitHub 链接

- AutoGPT: https://github.com/Significant-Gravitas/AutoGPT (184k)
- OpenClaw: https://github.com/openclaw/openclaw (370k)
- MetaGPT: https://github.com/FoundationAgents/MetaGPT (67k)
- CrewAI: https://github.com/crewAIInc/crewAI (51k)
- E2B: https://github.com/e2b-dev/E2B (12k)
- Letta: https://github.com/letta-ai/letta (22k)
- MS Agent Governance: https://github.com/microsoft/agent-governance-toolkit (1.5k)
- Skillpack: https://github.com/JSLEEKR/skillpack
- n8n: https://github.com/n8n-io/n8n (187k)
- Agno: https://github.com/agno-agi/agno (40k)