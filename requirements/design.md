# Aether 架构设计文档

> 版本：v0.2
> 更新：2026-05-10
> 基于竞品分析增强

---

## 一、设计原则

1. **主权优先（Data Sovereignty）** - 所有数据本地存储，本地模型优先，永不强制云端依赖
2. **零信任沙箱（Zero-Trust Sandbox）** - 代码执行默认隔离，网络/文件系统按需白名单
3. **渐进式披露（Progressive Disclosure）** - Token效率优先，三级按需加载
4. **可验证安全（Verifiable Security）** - eBPF内核级审计，SOC2兼容日志
5. **模块化架构（Modular）** - 各层可独立演进，松耦合

---

## 二、系统架构

### 2.1 整体架构图

```
┌─────────────────────────────────────────────────────────────────┐
│                         Aether Gateway                          │
│                      Zero-Trust Control Plane                   │
├─────────────────────────────────────────────────────────────────┤
│                                                                   │
│  ┌──────────┐   ┌──────────┐   ┌──────────┐   ┌──────────┐    │
│  │ Manifest │   │  Vault   │   │  Audit   │   │   LLM    │    │
│  │ Engine   │   │ Injector │   │  Logger  │   │ Manager  │    │
│  └────┬─────┘   └────┬─────┘   └────┬─────┘   └────┬─────┘    │
│       │              │              │              │            │
│       └──────────────┴──────────────┴──────────────┘            │
│                          │                                      │
│                    ┌─────┴─────┐                                 │
│                    │ Tool Reg  │                                 │
│                    └─────┬─────┘                                 │
│                          │                                      │
│  ┌───────────────────────┼────────────────────────────────┐    │
│  │                  Agent Loop                              │    │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐    │    │
│  │  │  Planner    │→│   Runner     │→│   Tools     │    │    │
│  │  └─────────────┘  └──────┬──────┘  └─────────────┘    │    │
│  │                          │                            │    │
│  │                    ┌─────┴─────┐                      │    │
│  │                    │  Memory   │                      │    │
│  │                    │ Manager   │                      │    │
│  │                    └─────┬─────┘                      │    │
│  └──────────────────────────┼────────────────────────────┘    │
│                              │                                  │
│       ┌──────────────────────┼──────────────────────┐        │
│       │                      │                      │        │
│  ┌────┴────┐          ┌──────┴──────┐          ┌────┴────┐   │
│  │Skill    │          │  Sandbox    │          │Message  │   │
│  │Registry │          │   Bridge    │          │  Bus    │   │
│  └────┬────┘          └──────┬──────┘          └────┬────┘   │
│       │                      │                      │         │
└───────┼──────────────────────┼──────────────────────┼─────────┘
        │                      │                      │
        ▼                      ▼                      ▼
┌───────────────┐    ┌─────────────────┐    ┌─────────────────┐
│ Skill Loader  │    │ Sandbox Runtime │    │ Multi-Agent    │
│ (三级披露)     │    │   (isolated-vm) │    │  (MessageBus)  │
└───────────────┘    └────────┬────────┘    └─────────────────┘
                               │
                               ▼
                    ┌─────────────────────┐
                    │  Security Policy    │
                    │ (静态扫描+Manifest)   │
                    └──────────┬──────────┘
                               │
                               ▼
                    ┌─────────────────────┐
                    │   eBPF Firewall     │
                    │  (Phase 2目标)      │
                    └─────────────────────┘
```

### 2.2 请求流程

```
1. 用户请求 → Gateway (localhost:18790)
                     ↓
2. Manifest Engine 验证 (YAML权限清单)
                     ↓
3. Vault Injector 注入密钥(环境变量)
                     ↓
4. LLM Manager 调用 (Ollama/Claude)
                     ↓
5. Agent Loop 执行 (ReAct循环)
                     ↓
6. Tool Registry 查找工具
                     ↓
7. Sandbox Bridge → 沙箱执行
                     ↓
8. Security Policy 静态扫描
                     ↓
9a. 违规 → 返回错误+审计日志
                     ↓
9b. 合规 → isolated-vm 执行
                     ↓
10. CodeAct 自调试闭环(如需要)
                     ↓
11. 结果 → 记忆系统(L1/L2/L3)
                     ↓
12. 响应 → 用户
```

---

## 三、核心模块设计

### 3.1 Sandbox Runtime（沙箱执行层）

**当前实现（Phase 1 MVP）：**
```typescript
// packages/sandbox/src/runtime/sandbox.ts
SandboxRuntime
  ├── init() → 加载 isolated-vm
  ├── execute() → 执行代码
  │   ├── SecurityPolicy.scanCode()  // 静态扫描
  │   ├── isolated-vm Isolate         // V8隔离
  │   └── safe-eval fallback           // 降级
  └── stats()
```

**安全策略（已实现）：**
```typescript
// packages/sandbox/src/security/policy.ts
SecurityPolicy
  ├── checkModule()    // 模块白名单
  ├── scanCode()       // 正则静态扫描
  │   ├── 网络访问模式 (http, fetch, WebSocket)
  │   ├── 文件系统访问 (fs, readFileSync)
  │   └── 进程操作 (child_process, exec)
  └── summary()
```

**目标实现（Phase 2）：**
```
                    WASM Runtime (Wasmtime)
                           │
              ┌────────────┼────────────┐
              ▼            ▼            ▼
         wasi-socket   wasi-fs    wasi-process
              │            │            │
              └────────────┼────────────┘
                           ▼
                    eBPF Hook (内核层)
                           │
                    ┌──────┴──────┐
                    ▼             ▼
               合规日志        违规拦截
```

### 3.2 Memory Manager（记忆系统）

**当前三层架构：**
```typescript
// packages/gateway/src/memory/manager.ts
MemoryManager
  ├── L1: Working Memory    // 内存滑动窗口(50条)
  │   └── 重要性评分遗忘
  ├── L2: Episodic Memory   // JSONL文件持久化
  │   └── Session分片
  └── L3: Semantic Memory    // TF-IDF向量
      └── cosine相似度检索
```

**Phase 2 增强：**
```
L1: Working Memory (不变)
         ↓
L2: Episodic (JSONL事件流)
         ↓ 后台压缩提炼
L3: Semantic (Qdrant + Ollama嵌入)
         ↓
    LLM自动摘要 → 结构化知识
```

**向量检索流程（Phase 2）：**
```
用户查询
    ↓
Ollama nomic-embed-text 编码
    ↓
Qdrant 余弦相似度检索 (top-K)
    ↓
结果注入 LLM上下文
```

### 3.3 Skill Registry（技能系统）

**三级披露机制：**
```typescript
// Level 1: 元数据 (永远加载, <100 tokens)
// GET /api/skill/list → 返回所有Level1
{
  "name": "企业财务对账",
  "category": "finance",
  "trustScore": 95,
  "tags": ["erp", "crm", "对账"]
}

// Level 2: 指令 (按需加载, ~500 tokens)
// GET /api/skill/:id → 返回Level1+Level2
{
  "systemPrompt": "你是一个专业的财务对账助手...",
  "inputSchema": {...}
}

// Level 3: 资源 (执行时加载)
// 仅内部使用，不暴露给LLM
{
  "code": "async function reconcile() {...}",
  "permissions": { "network": false }
}
```

**兼容性格式检测：**
```typescript
SkillParser.detectSource()
  ├── 'manus'     // ## System Prompt / ## Instructions
  ├── 'openclaw'  // openclaw platform标记
  └── 'aether'    // aether platform标记
```

### 3.4 Manifest Engine（零信任控制）

**权限清单YAML：**
```yaml
# packages/gateway/manifests/sandbox-exec.yaml
name: sandbox-exec
version: "1.0"
operations:
  exec: true       # 允许代码执行
  network: false    # 禁止网络
  filesystem: false # 禁止文件系统
network:
  blockExternal: true
  allowedHosts: [127.0.0.1, localhost]
filesystem:
  readPaths: []
  writePaths: []
```

**验证流程：**
```
请求 { operation: 'network', target: 'example.com' }
    ↓
ManifestEngine.validate()
    ↓
检查 operations.network === true?
    ↓
检查 network.blockExternal === true?
    ↓
检查 target in allowedHosts?
    ↓
拒绝: "network target not in allowedHosts"
```

### 3.5 Agent Loop（Agent执行循环）

**ReAct模式：**
```typescript
// packages/gateway/src/agent-loop/runner.ts
AgentRunner
  ├── ToolRegistry (内置工具)
  │   ├── exec_code    // 沙箱执行
  │   ├── remember     // 写入记忆
  │   ├── recall       // 语义检索
  │   └── get_status   // 系统状态
  │
  └── MockPlanner (ReAct循环)
      ├── thought     // 推理
      ├── action      // 工具调用
      ├── observation // 结果观察
      └── is_final    // 是否完成
```

**CodeAct自调试：**
```typescript
// packages/sandbox/src/codeact/engine.ts
CodeActEngine
  ├── createSession()
  ├── executeStep()  // thought + code → result
  │   ├── SandboxRuntime.execute()
  │   └── nextAction: continue|retry|done|error
  └── completeSession()
```

### 3.6 Multi-Agent（多Agent协作）

**MessageBus架构：**
```typescript
// packages/gateway/src/multi-agent/bus.ts
MessageBus
  ├── queues     // Map<agentId, Message[]>
  ├── subscribers // Map<agentId, Handler>
  ├── publish()   // 发送消息
  ├── consume()   // 拉取消息
  └── persist: bus.jsonl
```

**Phase 2 增强：**
```
Agent Team
  ├── Planner Agent    // 任务分解
  ├── Executor Agent   // 执行子任务
  │   ├── 独立WASM沙箱
  │   └── 独立记忆
  └── Reviewer Agent   // 结果验证
         │
         ▼
    MessageBus (加密)
         │
         ▼
   AES-256临时密钥
   会话结束销毁
```

---

## 四、技术选型

### 4.1 已确认

| 模块 | 选型 | 理由 |
|------|------|------|
| 沙箱(Runtime) | Wasmtime | Bytecode Alliance标准，Rust实现 |
| 当前沙箱 | isolated-vm | V8 Isolate，MVP够用 |
| eBPF | libbpf + Rust | 内核级，cilium/ebpf-go备选 |
| 本地模型 | Ollama + DeepSeek-R1 | 本地推理，Qwen备选 |
| 向量数据库 | Qdrant | 本地模式，混合搜索 |
| 嵌入模型 | nomic-embed-text | Ollama内置，高质量 |
| 技能格式 | SKILL.md | 社区标准，三级披露 |
| 部署 | Helm Chart | K8s企业部署 |

### 4.2 竞品启发新增

| 模块 | 新选型 | 理由 |
|------|--------|------|
| 技能包管理 | Skillpack格式 | 锁文件+签名，semver |
| 微VM隔离(Phase3) | Kata+Firecracker | GPU passthrough支持 |
| 记忆自动压缩 | 后台LLM摘要 | Letta风格虚拟上下文 |
| 实体记忆 | Entity Memory | CrewAI四层分类 |

---

## 五、安全模型

### 5.1 三层安全防御

```
Layer 1: Manifest预审计
  └── 请求到达即验证，不符合则拒绝

Layer 2: SecurityPolicy静态扫描
  └── 代码执行前正则扫描，检测危险模式

Layer 3: 运行时隔离
  └── V8 Isolate / WASM 内存隔离
```

### 5.2 eBPF网络控制（Phase 2）

```c
// eBPF程序伪代码
BPF_PROG(tcp_connect, struct sock *sk)
{
  if (sk->family != AF_INET) return 0;

  // 检查白名单
  u32 daddr = sk->daddr;
  if (!is_in_whitelist(daddr)) {
    // 拒绝连接
    return 0; // BLOCK
  }

  // 记录审计日志
  log_connect(sk, BLOCKED);
  return 0; // ALLOW but log
}
```

### 5.3 OWASP Agentic Top 10 覆盖

| ID | 威胁 | Aether机制 | 层 |
|----|------|-----------|---|
| 01 | Prompt Injection | Manifest+静态扫描 | L1+L2 |
| 02 | Data Leakage | eBPF网络拦截 | L3 |
| 03 | Sandbox Escape | WASM线性内存 | L3 |
| 04 | Agent Hijacking | Vault零信任注入 | L1 |
| 05 | Overtrusting | 三级披露+显式权限 | L1 |
| 06 | Unbounded Execution | MAX_STEPS+timeout | CodeAct |
| 07 | Memory Poisoning | 重要性评分遗忘 | L1 |
| 08 | Credential Exposure | Vault+环境变量 | L1 |
| 09 | Intent Misalignment | 审计日志+Manifest | L1+L2 |
| 10 | Model Poisoning | 技能签名+安全评分 | SkillReg |

---

## 六、目录结构

```
aether/
├── packages/
│   ├── gateway/              # 零信任控制平面
│   │   ├── src/
│   │   │   ├── server.ts          # HTTP/WS服务器
│   │   │   ├── index.ts           # 入口
│   │   │   ├── agent-loop/        # Agent循环
│   │   │   │   ├── runner.ts      # 运行器
│   │   │   │   ├── planner.ts     # ReAct规划
│   │   │   │   └── tools.ts       # 内置工具
│   │   │   ├── memory/            # 记忆管理
│   │   │   │   ├── manager.ts     # 三层记忆
│   │   │   │   ├── vectorizer.ts  # TF-IDF
│   │   │   │   └── types.ts
│   │   │   ├── manifest/          # 权限清单
│   │   │   │   └── engine.ts
│   │   │   ├── vault/             # 密钥注入
│   │   │   │   └── injector.ts
│   │   │   ├── sandbox/           # 沙箱桥接
│   │   │   │   ├── bridge.ts
│   │   │   │   └── task-queue.ts
│   │   │   ├── multi-agent/       # 多Agent
│   │   │   │   ├── bus.ts         # 消息总线
│   │   │   │   └── registry.ts    # Agent注册
│   │   │   ├── llm/               # LLM管理
│   │   │   │   ├── manager.ts
│   │   │   │   ├── provider.ts
│   │   │   │   └── types.ts
│   │   │   ├── audit/             # 审计
│   │   │   │   └── logger.ts
│   │   │   └── routes/            # API路由
│   │   │       ├── agent.ts
│   │   │       ├── skill.ts
│   │   │       ├── memory.ts
│   │   │       └── ...
│   │   ├── manifests/             # 权限清单
│   │   │   ├── default.yaml
│   │   │   └── sandbox-exec.yaml
│   │   └── package.json
│   │
│   ├── sandbox/              # 沙箱执行层
│   │   ├── src/
│   │   │   ├── runtime/
│   │   │   │   ├── sandbox.ts     # 核心沙箱
│   │   │   │   └── wasm-runtime.ts # Phase2
│   │   │   ├── security/
│   │   │   │   └── policy.ts      # 安全策略
│   │   │   ├── codeact/
│   │   │   │   └── engine.ts      # 自调试
│   │   │   └── ebpf/
│   │   │       └── firewall.ts    # Phase2
│   │   └── package.json
│   │
│   ├── skill-loader/          # 技能加载器
│   │   ├── src/
│   │   │   ├── parser/
│   │   │   │   └── skill-parser.ts # SKILL.md解析
│   │   │   └── registry/
│   │   │       └── registry.ts    # 三级披露
│   │   └── package.json
│   │
│   └── ui/                    # 前端(待开发)
│
├── requirements/
│   ├── README.md              # 需求总览
│   ├── roadmap.md             # 产品路线图
│   ├── competitive-analysis.md # 竞品分析
│   ├── design.md              # 本文件
│   └── epics/                 # 史诗需求
│       ├── EP-01-sandbox.md
│       ├── EP-02-gateway.md
│       ├── EP-03-skill-system.md
│       ├── EP-04-memory.md
│       ├── EP-05-multiagent.md
│       └── EP-06-deployment.md
│
└── package.json               # 工作区根配置
```

---

## 七、API 设计

### 7.1 核心 API

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/agent/run` | POST | 运行Agent任务 |
| `/api/agent/sessions` | GET | 列出Sessions |
| `/api/skill/list` | GET | 列出技能(Level1) |
| `/api/skill/:name` | GET | 获取技能详情(Level2) |
| `/api/memory/remember` | POST | 写入记忆 |
| `/api/memory/recall` | POST | 检索记忆 |
| `/api/memory/stats` | GET | 记忆统计 |
| `/api/manifest/validate` | POST | 验证操作权限 |
| `/api/multi-agent/team` | POST | 创建Agent Team |
| `/api/multi-agent/message` | POST | 发送消息 |
| `/api/status` | GET | 系统状态 |

### 7.2 WebSocket API

| 事件 | 方向 | 说明 |
|------|------|------|
| `agent:start` | Client→Server | 启动Agent任务 |
| `agent:step` | Server→Client | Agent步骤更新 |
| `agent:complete` | Server→Client | 任务完成 |
| `agent:error` | Server→Client | 执行错误 |
| `multi-agent:message` | Bidirectional | Agent间消息 |

---

## 八、部署架构

### 8.1 开发/测试环境

```
localhost
  ├── Gateway (18790)
  ├── Ollama (11434)
  └── Qdrant (6333)  # Phase 2
```

### 8.2 生产环境 (K8s)

```yaml
# Helm Chart结构
aether/
  ├── Chart.yaml
  ├── values.yaml
  └── templates/
      ├── gateway-deployment.yaml
      ├── sandbox-daemonset.yaml  # eBPF需要特权
      ├── gateway-service.yaml
      └── configmap.yaml
```

### 8.3 AgentBox (硬件)

```
┌─────────────────────────────────┐
│         AgentBox 硬件            │
│  ┌───────────────────────────┐  │
│  │      Aether Gateway       │  │
│  │       (K8s Cluster)       │  │
│  ├───┬───┬───┬───┬───┬───┬──┤  │
│  GPU│   │   │   │   │   │   │  │
│  Passthrough                     │
│  ┌───────────────────────────┐  │
│  │    Ollama + DeepSeek     │  │
│  │     (本地模型推理)         │  │
│  └───────────────────────────┘  │
│  ┌───────────────────────────┐  │
│  │   Kata+Firecracker VM     │  │
│  │    (高安全沙箱模式)         │  │
│  └───────────────────────────┘  │
└─────────────────────────────────┘
```

---

## 九、演进计划

### Phase 1: MVP验证 (当前)
- [x] Gateway HTTP服务
- [x] isolated-vm沙箱
- [x] Manifest权限验证
- [x] SKILL.md兼容
- [ ] 三级披露完整实现
- [ ] CodeAct自调试优化

### Phase 2: 智能增强
- [ ] Wasmtime Runtime
- [ ] eBPF网络防火墙
- [ ] Ollama密集嵌入
- [ ] Qdrant向量库
- [ ] Agent Team角色
- [ ] 加密消息总线

### Phase 3: 生态建设
- [ ] Skillpack集成
- [ ] 安全评分体系
- [ ] 自动压缩提炼
- [ ] 技能市场API

### Phase 4: 企业级
- [ ] Helm Chart
- [ ] Kata+Firecracker
- [ ] SOC2审计
- [ ] AgentBox硬件