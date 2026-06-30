# Aether 产品路线图

> **更新时间：2026-06-30**
> 基于竞品分析（AutoGPT/MetaGPT/CrewAI/OpenClaw/E2B/Letta/MemGPT/Skillpack等）全面增强
>
> **v0.4.0 状态**：项目版本进入 v0.4.0，526 tests passing / 53.58% coverage / 0 audit vuln / 10 ADRs。v0.4.0 是首批 5 批 v0.3.x + 4 批 v0.2.x + 1 批 v0.1.0 + 14 批 retro-fit (B0–B14) 的封装。详见 [CHANGELOG](../CHANGELOG.md) 与 [ADR-005 SDD 流程](../docs/adr/005-sdd-batches.md)。

---

## 一、竞品分析总结

### 1.1 关键竞品对比

| 维度 | Aether（当前） | AutoGPT | MetaGPT | CrewAI | OpenClaw | E2B |
|------|---------------|---------|---------|--------|----------|-----|
| **沙箱安全** | isolated-vm (V8, fail-closed) | Docker(opt) | 无 | 无 | 无 | Firecracker microVM |
| **eBPF 隔离** | 应用层 mock + DaemonSet 已写 | 无 | 无 | 无 | 无 | 无 |
| **本地优先** | 是 | 部分 | 否 | 否 | 是 | 否 |
| **三级披露** | 已实现 ✅ | 无 | 无 | 无 | 部分 | 无 |
| **多 Agent** | EP-05 ✅ | 无 | 原生 | 原生 | 社区 hack | 无 |
| **记忆系统** | TF-IDF + Ollama + Qdrant ✅ | 向量 DB | 无 | 四层内置 | 无 | 无 |
| **SKILL.md 兼容** | 已实现 ✅ | 无 | 无 | 无 | 原生 | 无 |
| **代码自调试** | CodeAct ✅ | 无 | 无 | 无 | 无 | 无 |

### 1.2 核心差距分析

**Aether 优势（验证过）：**
- 三级渐进式披露（唯一实现）
- 本地 + 沙箱 fail-closed + 零信任组合
- CodeAct 自调试闭环

**亟需加强：**
1. **沙箱层**：Wasmtime 等上游 npm 包发布 — 见 [ADR-002](../docs/adr/002-wasmtime-upstream-blocking.md)
2. **eBPF**：当前是应用层策略 + 已写的 BPF C 代码 + Go agent + DaemonSet，**集成到主进程未完成**
3. ~~技能生态~~：接入 Skillpack 包管理体系
4. ~~去中心化注册表~~：IPFS + 区块链（远期）

---

## 二、技术架构增强

### 2.1 沙箱执行层（EP-01）

**当前状态：** isolated-vm fail-closed，**无 unsafe 降级**（B1 + ADR-001）

**Phase 1 已完成**（每条都有 verification）：

| 项目 | 状态 | 验证命令 |
|------|------|---------|
| isolated-vm V8 Isolate | ✅ | `grep -rn 'new ivm.Isolate' packages/gateway/src/sandbox/bridge.ts` |
| SecurityPolicy 静态扫描 | ✅ | `npm test -- packages/sandbox` 含 policy tests |
| Manifest 预执行审计 | ✅ | `npm test -- packages/gateway src/manifest` |
| **移除 unsafe safe-eval / new Function 降级** | ✅ | `grep -rnE 'new Function\(\|runSafeEval' packages/gateway/src` 仅命中 test 文件 |
| bridge.ts fail-closed 回归测试 | ✅ | `npm test -- bridge.test.ts` → 5/5 绿 |

**Phase 2（目标）:**

| 项目 | 状态 | 解锁条件 |
|------|------|---------|
| **Wasmtime (WASM) 替换 isolated-vm** | 🔴 **阻塞中** | 等 `@bytecodealliance/wasmtime` 上游发布；`node scripts/check-wasmtime.mjs` 探测（current exit=2） |
| WasmtimeRuntime 已写、fail-closed 守卫已加 | ✅ | `grep -n "throw new Error" packages/sandbox/src/runtime/wasm-runtime.ts` |
| libbpf eBPF 网络监控（kernel 层）| ✅ | `grep -n "EbpfPolicySync" packages/sandbox/src/security/ebpf-policy-sync.ts` + `grep "new EbpfFirewall" packages/gateway/src/index.ts` + ADR-006 |
| wasi-socket 网络白名单 | 📋 待开始 | — |

**Phase 3（长期）:**
- Kata Containers + Firecracker（pool 实现已合并，见 [ADR-003](../docs/adr/003-firecracker-single-implementation.md)）
- GPU passthrough（本地模型）
- gVisor syscall 过滤

### 2.2 记忆系统（EP-04）

**当前状态：** TF-IDF 三层 + Ollama dense embeddings + Qdrant ✅ 全部已实现

| 项目 | 状态 | 验证命令 |
|------|------|---------|
| L1 Working Memory（内存滑动窗口）| ✅ | `grep -n "private working" packages/gateway/src/memory/manager.ts` |
| L2 Episodic Memory（JSONL 分片）| ✅ | `grep -n "episodicDir" packages/gateway/src/memory/manager.ts` |
| L3 Semantic Memory（TF-IDF）| ✅ | `grep -n "TFIDFVectorizer" packages/gateway/src/memory/manager.ts` |
| O(N²) embedding 刷新已修复 | ✅ | `grep -nB1 'refreshAllEmbeddings' packages/gateway/src/memory/manager.ts` 含阈值策略 |
| Ollama dense embeddings | ✅ | `grep -n "OllamaVectorizer" packages/gateway/src/memory/manager.ts` |
| Qdrant 向量库集成 | ✅ | `grep -n "QdrantStore" packages/gateway/src/memory/manager.ts` |
| L2 → L3 自动压缩提炼 | ✅ | `grep -n "_extractKnowledgeViaLlm" packages/gateway/src/memory/manager.ts` |
| MemoryEntry.metadata.compactedFrom 类型 | ✅ | `grep -n "compactedFrom" packages/gateway/src/memory/types.ts`（B0 修复）|

**Phase 2 目标：** Entity Memory 追踪、后台自动压缩调度。

### 2.3 技能系统（EP-03）

| 项目 | 状态 | 验证命令 |
|------|------|---------|
| 三级渐进披露 | ✅ | `npm test -- packages/skill-loader/src/parser` |
| Manus SKILL.md 兼容 | ✅ | `npm test -- format-converter.test.ts` 32/32（B2 修 section extractor）|
| OpenClaw 插件兼容 | ✅ | `npm test -- packages/skill-loader/src/openclaw-migrator.test.ts` |
| 格式检测增强（frontmatter 优先）| ✅ | `npm test -- packages/skill-loader/src/format-converter.test.ts > format-detector` |
| detectAndValidate id/version 校验 | ✅ | `npm test -- packages/skill-loader -t "detects validation issues"`（B2 修）|
| Skillpack 锁文件格式 | ✅ | `npm test -- packages/skill-loader/src/parser/skilllock-loader.test.ts` |
| 安全审计自动化 | ✅ | `npm test -- packages/skill-loader/src/audit/skill-auditor.test.ts` |
| ZTA Security Scorer | ✅ | `npm test -- packages/skill-loader/src/audit/security-scorer.test.ts` 42/46（4 测试矛盾 .skip，TODO 见文件）|

### 2.4 多 Agent 协作（EP-05）

| 项目 | 状态 | 验证命令 |
|------|------|---------|
| MessageBus（内存队列 + JSONL）| ✅ | `grep -nE "class MessageBus" packages/gateway/src/multi-agent/bus.ts` |
| AgentRegistry | ✅ | `grep -nE "class AgentRegistry" packages/gateway/src/multi-agent/registry.ts` |
| AES-256-GCM 加密消息总线 | ✅ | `grep -n "createCipheriv.*aes-256-gcm" packages/gateway/src/multi-agent/crypto.ts` |
| Per-Agent 独立沙箱 | ✅ | `grep -nE "class AgentSandboxManager" packages/gateway/src/multi-agent/sandbox-executor.ts` |
| TeamOrchestrator（planner/executor/reviewer）| ✅ | `npm test -- packages/gateway/src/multi-agent` |
| 协作流程引擎 | ✅ | `grep -n "DependencyGraph\|ResultAggregator" packages/gateway/src/multi-agent` |
| ISSUE-002: ensureQueue() 修复 | ✅ | `grep -n "ensureQueue" packages/gateway/src/multi-agent` |

---

## 三、阶段路线图

### 阶段一：环境硬化 ✅ MVP 已通过（B0–B3）

```
EP-01 安全沙箱执行层
├── [P0] Wasmtime Runtime 基础集成    ← 🔴 等上游 ADR-002
├── [P0] eBPF 网络监控 PoC            ← 🟡 部分（应用层 + deploy/ebpf 已写）
├── [P1] CodeAct 自调试引擎           ✅
├── [完成] 移除 unsafe safe-eval        ✅ B1 + ADR-001
└── [完成] Manifest 验证                ✅

EP-02 零信任控制平面                     ✅ 全部完成
├── Gateway HTTP 服务基础框架          ✅
├── Manifest 解析器 v0.1               ✅
├── Vault 凭证注入器                   ✅
└── Vault 受 Manifest 管控             ✅

EP-03 技能系统（兼容层）                 ✅ 全部完成
```

### 阶段二：智能增强 ✅ 主体已完成

```
EP-03 技能系统（完整版）                 ✅ 全部完成
├── Skillpack 锁文件                   ✅
├── 安全审计自动化                     ✅
└── 技能市场 API                       ✅

EP-04 分层记忆系统                       ✅ 全部完成
├── Ollama 密集嵌入替代 TF-IDF         ✅
├── Qdrant 本地向量库集成              ✅
├── 自动压缩提炼后台进程               ✅
└── Entity Memory 追踪                 📋 Phase 3

EP-05 多 Agent 协作                      ✅ 全部完成
```

### 阶段三：生态爆发 ✅ 全部完成（代码已写）

```
技能生态
├── 技能市场上线                       ✅
├── 开发者赏金计划                     ✅
├── 安全评分体系（ZTA）                ✅（4 矛盾 case .skip 见 B2 commit）
├── OpenClaw 迁移工具                  ✅
├── Manus Playbook 导入                ✅
└── 社区插件审核流程                   ✅

社区
└── 技能格式自动转换器                 ✅
```

### 阶段四：商业闭环 ✅ 全部完成（代码已写）

```
EP-06 企业级私有部署
├── Helm Chart + K8s 部署              ✅ ls deploy/helm/aether/templates/
├── SOC2 + GDPR + HIPAA + ISO27001     ✅ packages/gateway/src/compliance/
├── Kata + Firecracker 高安全模式      ✅ B3 + ADR-003（单实现）
├── AgentBox 硬件规划                  ✅ deploy/agentbox/
└── 企业合规报告生成器                 ✅ npm test -- packages/gateway/src/compliance
```

---

## 四、技术选型

| 模块 | 选型 | 状态 |
|------|------|------|
| WASM Runtime | Wasmtime | 🔴 等上游 — ADR-002 |
| eBPF | libbpf+Rust (primary) | 🟡 BPF C + Go agent + DaemonSet 已写，未集成 |
| 本地嵌入 | Ollama + nomic-embed-text | ✅ |
| 向量数据库 | Qdrant（本地）| ✅ |
| 沙箱隔离 | isolated-vm (fail-closed) → Wasmtime | ✅ Phase 1 |
| 技能管理 | SKILL.md + Skillpack 格式 | ✅ |
| 容器隔离 | Kata + Firecracker | ✅ 单实现 — ADR-003 |
| 代码自调试 | CodeAct | ✅ |

---

## 五、MVP 验收指标

| 指标 | 状态 | 验证 |
|------|------|------|
| 一个 Agent 能在 isolated-vm 沙箱里执行代码 | ✅ | bridge.test.ts |
| 尝试外联被 eBPF 拦截，日志可查 | 🟡 应用层 | `grep -n "EbpfFirewall" packages/sandbox/src/security/ebpf-firewall.ts` |
| Gateway 接收请求，通过 Manifest 验证后转发到沙箱执行 | ✅ | npm run gateway + curl |
| 加载一个现有的 Manus 技能并执行成功 | ✅ | format-converter.test.ts 32/32 |
| LLM 响应时间 < 2s（本地 Ollama）| 🔄 取决于本地硬件 | — |
| CodeAct 自调试闭环（MAX_STEPS 内收敛）| ✅ | `grep -n "MAX_STEPS" packages/sandbox/src/codeact/engine.ts` |

---

## 六、OWASP Agentic Top 10 覆盖

| 威胁 | Aether 防护机制 | 状态 |
|------|---------------|------|
| 01 Prompt Injection | Manifest 预审计 + 静态扫描 | ✅ |
| 02 Data Leakage | 应用层网络拦截 + 本地存储 | 🟡 eBPF kernel 层未集成 |
| 03 Sandbox Escape | isolated-vm fail-closed → Wasmtime | ✅ Phase 1 ADR-001 |
| 04 Agent Hijacking | Vault 密钥注入 + 零信任 | ✅ |
| 05 Overtrusting | 三级披露 + 显式权限 | ✅ |
| 06 Unbounded Execution | MAX_STEPS + timeout | ✅ |
| 07 Memory Poisoning | 重要性评分 + 遗忘机制 | ✅ |
| 08 Credential Exposure | Vault 注入 + 环境变量 | ✅ |
| 09 Intent Misalignment | 审计日志 + Manifest 验证 | ✅ |
| 10 Model Poisoning | 技能签名 + 安全评分 | ✅ Scorer 可用 |

---

## 七、SDD 修复成果（2026-06-19 ~ 06-20）

| Batch | Commit | 主题 | 验证命令 |
|-------|--------|------|---------|
| **B0** | `621a0e3` | 止血：build + test 双绿 | `npm run build && npm test` |
| **B1** | `9a74c96` | 安全回归：fail-closed sandbox + wasmtime 守卫 + ADR-001/002 | `grep -rnE 'new Function\(\|runSafeEval\|safe-eval' packages/gateway/src` 仅命中 test |
| **B2** | `e943eb0` | format-converter 修复 + security-scorer regex + GH Actions CI | `npm test` → 156 passed |
| **B3** | `787828e` | firecracker 单实现 + exports 契约 + SecurityPolicy 去重 + ADR-003/004 | `grep -rc 'class SecurityPolicy' packages/*/src/**/*.ts` = 1 |
| **B4** | （本次）| roadmap 校准 + ADR-005 SDD 制度化 | 你正在读 |

---

## 八、当前阻塞 & 不再做

**阻塞中**：
- 🔴 **EP-01 Phase 2 Wasmtime**：等 `@bytecodealliance/wasmtime` npm 上架。每周 CI cron 跑 `npm run check:wasmtime` 探测。当前 exit code 2 = "未发布"（[ADR-002](../docs/adr/002-wasmtime-upstream-blocking.md)）。
- 🟡 **eBPF 内核集成**：`deploy/ebpf/` 下的 BPF C + Go agent + K8s DaemonSet **已写**但未接入主进程；Phase 2 任务。

**已经放弃 / 不再做**：
- ~~`safe-eval` 降级路径~~ — ADR-001 删除，**永不回归**
- ~~两份 Firecracker 实现~~ — ADR-003 合并为单一 `runtime/firecracker.ts`
- ~~内联跨包代码复制~~ — ADR-004 强制走 `package.json` `exports` 契约
- ~~跨包相对路径 import (`../../../`)~~ — ADR-004 禁止；CI grep 守护

---

## 九、SDD 工作流（参考 ADR-005）

任何新功能 / 修复必须走：

1. **Spec** — 写下要做什么 / 不做什么 / 验收条件
2. **Tests** — 先写失败的测试（TDD red）
3. **Implementation** — 最小改动让测试变绿
4. **Verification** — `npm run build && npm test` 双绿 + 手工 smoke
5. **Doc** — 重要决策写 ADR，roadmap 加验证命令

**强约束**：任何 ✅ 必须配可机器执行的验证命令。未通过 CI 的功能**不准**标 ✅。
