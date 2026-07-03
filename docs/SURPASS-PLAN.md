# Aether 竞品超越方案 (Surpass Plan)

> **创建时间**: 2026-07-03
> **来源**: Council of High Intelligence — 策略三巨头 (Sun Tzu + Machiavelli + Aurelius)
> **状态**: 执行中
> **目标**: 4 周内 (2026-08-03) 建立可验证的竞争叙事，超越 OpenClaw / Manus / Hermes
> **跟踪 Issue**: [#9](https://github.com/mbpz/aether/issues/9) · **项目看板**: [Projects](https://github.com/mbpz/aether/projects)
>
> | Issue | 标签 | 状态 |
> |-------|------|------|
> | [#1](https://github.com/mbpz/aether/issues/1) P0 审计链修复 | `P0-critical` `audit` `security` | Open |
> | [#2](https://github.com/mbpz/aether/issues/2) P0 事件自动记录 | `P0-critical` `audit` `security` | Open |
> | [#3](https://github.com/mbpz/aether/issues/3) P0 沙箱全平台验证 | `P0-critical` `sandbox` `security` | Open |
> | [#4](https://github.com/mbpz/aether/issues/4) P0 垂直试点 | `P0-critical` `community` `competitive` | Open |
> | [#5](https://github.com/mbpz/aether/issues/5) P1 信任评分 | `P1-high` `competitive` `security` | Open |
> | [#6](https://github.com/mbpz/aether/issues/6) P1 SOC2 导出 | `P1-high` `audit` `docs` | Open |
> | [#7](https://github.com/mbpz/aether/issues/7) P1 RFC 威胁模型 | `P1-high` `docs` `RFC` `security` | Open |
> | [#8](https://github.com/mbpz/aether/issues/8) P1 红队报告 | `P1-high` `security` `docs` `competitive` | Open |

---

## 一、理事会裁决结论（摘要）

### 核心判断
- **护城河是组合，而非单一功能**: 本地优先 + V8 Isolate 故障关闭 + HMAC-SHA256 审计链 + 加密消息总线
- **定位语**: "跑在你硬件上，日志存在你硬盘上，让你看到它做了什么。"
- **关键行动**: 一次命名垂直行业试点（金融/医疗/法律）比任何新功能都重要
- **投票**: `垂直优先` 2.5 权重通过门槛（孙子 1.5× + 马基雅维利 1.0×）

### 已知最大的未知 & 缓解
| 风险 | 缓解 |
|------|------|
| 找不到外部参考 | 独立开发者合作路径 + dogfooding |
| 沙箱成熟度未验证 | 全平台测试矩阵 |
| 审计链跨文件缺陷 | 第 1 周修复 |
| 企业 outreach 回复率低 | 多触点策略（Twitter + 论坛 + HN） |

---

## 二、竞品对比分析

### 2.1 能力矩阵

| 维度 | Aether | OpenClaw (370k★) | Manus | Hermes | CrewAI (51★) | MetaGPT (67★) | Claude Code (122★) |
|------|--------|-------------------|-------|--------|--------------|---------------|-------------------|
| **沙箱隔离** | ✅ V8 Isolate fail-closed | ❌ 无 | ❌ 云端黑盒 | ❌ 无 | ❌ 无 | ❌ 无 | ⚠️ 有但闭源 |
| **审计日志** | ✅ HMAC-SHA256 链 | ❌ 无 | ❌ 仅内部 | ❌ 无 | ❌ 无 | ❌ 无 | ⚠️ 有限 |
| **多 LLM 支持** | ✅ 任意切换 | ⚠️ 偏 Claude | ⚠️ 仅自家 | ⚠️ 模型无关 | ⚠️ 单一 | ⚠️ 单一 | ❌ 仅 Claude |
| **本地优先** | ✅ 数据不离开 | ⚠️ 偏云端 | ❌ 纯云端 | ✅ 本地 | ❌ 云端 | ❌ 云端 | ✅ 本地 |
| **多 Agent** | ✅ 加密总线 | ❌ 单 Agent | ✅ 内置 | ❌ 无 | ✅ 角色编排 | ✅ SOP 角色 | ❌ 单 Agent |
| **技能生态** | ⚠️ 兼容加载 | ✅ 5400+ | ❌ 封闭 | ⚠️ 有限 | ⚠️ 有限 | ❌ 无 | ⚠️ 有限 |
| **社区规模** | ❌ 新项目 | ✅ 370k ★ | ✅ 高曝光 | ⚠️ 小众 | ✅ 51k ★ | ✅ 67k ★ | ✅ 122k ★ |
| **用例验证** | ❌ 待验证 | ✅ 广泛 | ✅ 产品化 | ⚠️ 有限 | ✅ 广泛 | ✅ 学术 | ✅ 企业 |

### 2.2 竞品脆弱性分析

| 竞品 | 核心脆弱性 | Aether 如何利用 |
|------|-----------|----------------|
| **OpenClaw** | 无沙箱、技能不受信任、数据流向不透明 | "5400 个不受信任的技能" 是资产负担；我们的沙箱+审计是不可复制的 |
| **Manus** | 纯云端、无隐私、黑盒执行 | 本地优先是可验证的差异；金融/医疗合规是天然卡点 |
| **Hermes** | 单一功能（结构化输出）、无生态 | 我们提供完整框架，结构化输出是子集 |
| **CrewAI/MetaGPT** | 纯云端、无沙箱、浅层框架 | 安全+审计+本地是工程级差异 |
| **Claude Code** | 锁定 Anthropic、闭源 | 多 Provider + 开源是可验证的替代 |

### 2.3 Aether 的独有声明（Nobody else can claim this）

> "Run autonomous AI agents entirely on your hardware, in an isolated V8 sandbox with fail-closed semantics, with a tamper-evident audit trail you can verify externally — using any LLM you choose."

---

## 三、按优先级排序的改进方向

### P0 — 差距弥合（不做就无法声称超越）

| # | 改进 | Issue | 当前状态 | 目标状态 | 验收标准 |
|---|------|-------|---------|---------|---------|
| P0-1 | 审计链跨文件 hash 续接 | [#1](https://github.com/mbpz/aether/issues/1) | ❌ 每个文件从 GENESIS 开始 | ✅ 跨文件连续验证 | 写入 3 天日志，全链 verify 通过 |
| P0-2 | Agent 生命周期事件自动记录 | [#2](https://github.com/mbpz/aether/issues/2) | ❌ 仅手动 log() | ✅ 沙箱执行、LLM 调用、权限决策自动记录 | 不调用 log() 也能生成完整审计 |
| P0-3 | 沙箱全平台验证 | [#3](https://github.com/mbpz/aether/issues/3) | ⚠️ macOS 仅 Node 20 | ✅ Node 20/22/24 × macOS/Linux/Windows 验证矩阵 | CI 全绿 |
| P0-4 | 内部 dogfooding 案例 | [#4](https://github.com/mbpz/aether/issues/4) | ⚠️ 待验证 | ✅ 维护者自身生产使用 + 公开 case study | case-study-dogfood.md 上线 + README 引用 |

### P1 — 竞争优势放大（做了就显著拉开差距）

| # | 改进 | Issue | 价值 | 验收标准 |
|---|------|-------|------|---------|
| P1-1 | 技能验证注册中心 (`aether trust-score`) | [#5](https://github.com/mbpz/aether/issues/5) | 重构技能竞争: 质量 > 数量 | CLI 可扫描技能并输出信任分数 |
| P1-2 | SOC2 导出格式 (`aether-audit export --format=soc2`) | [#6](https://github.com/mbpz/aether/issues/6) | 企业采购通行证 | 包含 CC1-CC9 控制映射的导出 |
| P1-3 | 公开红队报告 | [#8](https://github.com/mbpz/aether/issues/8) | 可信度最高的论据 | 至少 5 个攻击向量和防御证明 |
| P1-4 | RFC 风格威胁模型文档 | [#7](https://github.com/mbpz/aether/issues/7) | 技术叙事 + SEO | 公开 docs/threat-model.md |

### P2 — 锦上添花（有时间再做）

| # | 改进 | 价值 |
|---|------|------|
| P2-1 | Web 可视化仪表盘 | 非 CLI 用户信任感 |
| P2-2 | 移动推送/审批 | 差异化但非刚需 |
| P2-3 | 一键云/本地混合模式 | 对抗 Manus 的便捷性 |

---

## 四、4 周执行路线图

### 第 1 周: 基础加固 (2026-07-03 → 07-10)

**目标**: 修复审计链缺陷 + 完成沙箱验证矩阵

```
Day 1-2: 审计链跨文件 hash 续接修复
├── 修改 verifyLogIntegrity() — 跨文件续接 previousHash
├── _loadLastHash() — 新增 tail-hash 跨文件持久化
└── 测试: 写入跨 3 个 .jsonl 文件，验证全链连续性

Day 3-4: 沙箱全平台验证
├── 在 CI / 本地新增平台节点:
│   ├── macOS (arm64) × Node 20, 22, 24
│   ├── Linux (x64) × Node 20, 22, 24  (Docker)
│   └── Windows (x64) × Node 20, 22, 24 ( GitHub Actions 已有)
├── 新增攻击向量测试:
│   ├── 资源耗尽 (无限循环/memory bomb)
│   ├── 信息泄漏 (stack trace 中是否含 host 路径)
│   └── 混淆逃逸 (base64 / eval 变体)
└── 输出: 测试矩阵报告 + 已知限制文档

Day 5: 自动记录 Agent 生命周期事件
├── SandboxBridge.execute() — 自动 log(agent_execution)
├── ManifestEngine.validate() — 自动 log(authorization)
└── LLMProvider.chat() — 自动 log(data_access, token_count)

验收:
⬜ verifyLogIntegrity() 跨文件测试通过
⬜ 全平台沙箱测试矩阵 CI 全绿
⬜ Agent 执行无需手动 log() 即产生审计记录
⬜ 已知限制文档 surfaced in SECURITY.md
```

### 第 2 周: 功能完善 (2026-07-10 → 07-17)

**目标**: 审计导出对齐 SOC2 + RFC 初稿

```
Day 1-2: aether-audit export 增强
├── 新增 --format=soc2 导出
├── 输出 JSONL + manifest.json (head hash, key fingerprint, control mapping)
└── docs 新增 SOC2_CONTROL_MAPPING.md

Day 3-4: 技能验证扫描器 (P1-1)
├── 新增 SkillTrustScanner — 扫描 SKILL.md:
│   ├── 网络出域 (fetch / http.request / WebSocket)
│   ├── 文件读写范围 (fs 调用路径)
│   └── 权限匹配 (declared vs actual)
├── 信任评分算法 (0-100)
└── CLI: aether-audit trust-score ./skills/my-skill.md

Day 5: RFC 初稿 (P1-4)
├── docs/threat-model.md — 威胁模型 + 架构 + 攻击面
├── docs/audit-architecture.md — HMAC-SHA256 链 + 已知限制
└── 目标: 2000 字，可独立发布

验收:
⬜ aether-audit export --format=soc2 可运行
⬜ trust-score 对 3 个种子技能输出合理分数
⬜ threat-model.md v0.1 完成
```

### 第 3 周: 社区 & 验证 (2026-07-17 → 07-24)

**目标**: 找到外部参考 + 公开发声

```
Day 1: 外部参考 outreach (金融/量化)
├── 准备目标名单 (20 人):
│   ├── Twitter/X: 搜索 "quant trading LLM" / "local LLM finance"
│   ├── QuantConnect 论坛活跃用户
│   └── HealthTech / LegalTech 独立开发者
├── 发送 outreach 消息 (DM / email)
└── 同时在 r/LocalLLaMA, Hacker News 准备 "Show HN"

Day 2-3: 筛选回复 + 1-on-1 onboarding
├── 对回复者进行 15-30 分钟 Zoom/call
├── 帮助安装 + 了解使用场景
└── 确定 1 个 "named reference"

Day 4-5: 内容创作
├── "Aether in Production" 博客文章 (你的使用场景 + 截图)
├── 案例研究模板 (与外部参考合作填写)
└── RFC v0.1 → v0.2 (根据 outreach 反馈修订)

验收:
⬜ 20 个 outreach 已发送
⬜ ≥ 1 个确认参考 (口头或书面)
⬜ 博客 + RFC v0.2 完成
```

### 第 4 周: 发布 (2026-07-24 → 08-03)

**目标**: 公开发声 + 可验证叙事上线

```
Day 1-2: 最终修订
├── RFC v1.0 (threat-model.md + audit-architecture.md + soc2-mapping.md)
├── aether-audit 输出格式 freeze
└── 红队报告: 至少 5 个攻击向量 + 防御证明

Day 3-4: 发布
├── "Show HN: Aether — local-first agent with verified execution"
├── Twitter/X 发布线程 (功能 + 竞品对比 + 已知限制)
└── 案例研究上线 (你自己的 + 外部参考的，如果有)

Day 5: 复盘 + 后续规划
├── 哪些工作，哪些不工作
├── 调整路线图
└── 更新 roadmap.md / SURPASS-PLAN.md 状态

验收:
⬜ RFC v1.0 公开
⬜ Show HN 上线
⬜ 案例研究至少 1 个
⬜ 红队报告公开
```

---

## 五、生产级交付标准

### 5.1 可验证性

| 声明 | 验证方式 |
|------|---------|
| "V8 沙箱阻止子进程逃逸" | `exploit-demonstration.test.ts` 动态测试 |
| "HMAC-SHA256 审计链不可篡改" | `aether-audit verify` + 公开验证脚本 |
| "本地优先 — 数据不离开" | 网络抓包 + Manifest blockExternal 默认 true |
| "任意 LLM 切换" | provider.test.ts 涵盖 6+ providers |
| "≥60% token 减少" | `examples/token-benchmark/run-benchmark.mjs` 可复现 |

### 5.2 诚实标注（不声称做不到的）

| 不这么说 | 这么说 |
|---------|--------|
| "军事级安全" | "在 Node 20/22 macOS/Linux 上经过动态 exploit 测试" |
| "不可篡改" | "单文件内链续验证；跨文件链续为路线图中"（修复后删除此标注） |
| "SOC2 合规" | "审计链覆盖 SOC2 CC1-CC9 中的 [X] 项，详见 soc2-mapping.md" |
| "100% 防逃逸" | "防御已知进程逃逸/模块注入/文件系统逃逸向量；侧信道不在范围内" |
| "548 个测试证明一切" | 不声称测试数量；改为 "每个核心声明有对应的动态/静态测试" |

### 5.3 红线（永远不做）

- ❌ 不追逐 OpenClaw 的星标数作为成功指标
- ❌ 不在没有 CI 验证的情况下声称功能存在
- ❌ 不把 "隐私优先" / "主权" 作为主要卖点
- ❌ 不在 README 中列出 "研究阶段" 的功能作为已交付
- ❌ 不假装已有外部背书

---

## 六、Kill Criteria / 无效判定

以下任一条件成立则此方案失效，需要重新评估：

1. ⬜ 2026-08-03 前未交付命名垂直试点
2. ⬜ 审计链跨文件修复未通过测试
3. ⬜ 沙箱在任一核心平台 (Node 22 macOS/Linux) 验证失败
4. ⬜ 文案回退到 "隐私优先" / "主权" / "548 个测试"
5. ⬜ 4 周后仍然零外部用户反馈

---

## 七、文件结构索引

```
docs/
├── SURPASS-PLAN.md          ← 本文件（竞品超越方案）
├── threat-model.md          ← [待创建] 威胁模型 RFC
├── audit-architecture.md    ← [待创建] 审计架构 RFC
├── soc2-mapping.md          ← [待创建] SOC2 控制映射
└── compositions.md           ← [已有] 多 Agent 组合指南

requirements/
├── roadmap.md               ← [已有] 主路线图
└── roadmap/
    └── long-term.md         ← [已有] 研究级路线图

examples/
└── token-benchmark/         ← [已有] Token 减少基准测试

packages/gateway/
├── bin/aether-audit.mjs     ← [已有] 审计 CLI
└── src/audit/
    ├── logger.ts            ← [待修复] 跨文件 hash 续接
    └── logger.test.ts       ← [已有]
```

---

*本文件由 Council of High Intelligence 裁决生成，需每周 review 一次。*
