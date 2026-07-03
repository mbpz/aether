# 垂直行业试点 — Outreach 执行方案

> **Issue**: [#4](https://github.com/mbpz/aether/issues/4) · **Owner**: 维护者
> **目标**: 4 周内找到 1 个命名垂直试点，公开背书
> **发布时间**: 2026-07-03

---

## 1. 策略

**核心 wedge**: "5400 个不受信任的技能"是 OpenClaw 的负担，Aether 是可验证的替代方案。

**目标画像**（按优先级）:

| 优先级 | 画像 | 为什么合适 | 在哪找 |
|--------|------|-----------|--------|
| P0 | 量化研究员 / 独立交易员 | 数据不出本地是刚需；LLM+数据分析是日常；社区影响力大 | Twitter/X "quant" "algotrading"、QuantConnect 论坛 |
| P1 | 健康科技数据工程师 | HIPAA 合规要求可审计；对"数据不离开"有强需求 | HealthTech Discord、r/HealthIT |
| P2 | 法律科技创业者 | 客户数据保密；需要可审计的 AI 执行 | LegalTech 会议、r/LawTechnology |
| P3 | 有影响力的独立开发者 | 最容易出案例；教程/博客传播力强 | YouTube "LLM coding"、Indie Hackers |

**推荐路径**: P3 最快出结果（不需要 NDA、不需要合规审查），P0 最有说服力。**建议并行：联系 5 个 P3 + 15 个 P0。**

---

## 2. 目标名单模板

从以下渠道搜集 20 个目标。更新此文件时把找到的目标填入表格。

### 2.1 搜索渠道

**Twitter/X** (在浏览器搜索框输入):
- `"local LLM"` / `"llm agent"` / `"data privacy"` / `"quant"` + `"python"`
- `"OpenClaw"` / `"Claude Code alternative"` / `"local-first AI"`
- 找最近 30 天内发过相关内容的人
- 关注者 500-5000 的小 V（回复率远高于大 V）
- 使用 TweetDeck 或 Hootsuite 跟踪关键词

**GitHub**:
- 搜索 `topics:machine-learning topics:privacy`
- 看最近活跃的 repo 的主人
- 特别关注已经用 Ollama / local LLM 的项目

**论坛/Discord**:
- QuantConnect 论坛 (quantconnect.com/forum)
- r/LocalLLaMA, r/MachineLearning, r/algotrading
- Latent Space Discord、HuggingFace Discord

### 2.2 目标跟踪表

> **使用说明**: 找到目标后填入下表。状态: `identified` → `contacted` → `replied` → `onboarded` → `public`

| # | 名字 | 平台 | 画像 | 关注者 | 联系方式 | 状态 | 备注 |
|---|------|------|------|--------|---------|------|------|
| # | 名字 | 平台 | 画像 | 关注者 | 联系方式 | 状态 | 来源 |
|---|------|------|------|--------|---------|------|------|
| 1 | **screenpipe** | GitHub | YC S26 本地 AI + 隐私（集成 OpenClaw/Hermes）| 19.6k★ | GH Discussions | ✅ identified | gh search |
| 2 | **albert-ying** | GitHub | agentic-cortex — 基于 OpenClaw/Claude Code 的个人 AI OS | — | github.com/albert-ying | ✅ identified | gh search |
| 3 | **alirezarezvani** | Twitter | HealthTech CTO, Agentic Coding, 医疗 AI | 2157 | @RezaRezvaniBln | ✅ identified | gh search API |
| 4 | **thedotmack** (Alex Newman) | Twitter | Claude Memory, LLM 工具, 121 repos | 1782 | @Claude_Memory | ✅ identified | gh search API |
| 5 | **mksglu** (Mert Köseoğlu) | Twitter | AI 工具开发者 | 513 | @mksglu | ✅ identified | gh search API |
| 6 | **JesseRWeigel** | Twitter | 138 repos, 软件工程师 | 431 | @JesseRWeigel | ✅ identified | gh search API |
| 7 | **different-ai** (Benjamin Shafii) | Twitter | Fun with LLMs, 43 repos | 457 | @benjaminshafii | ✅ identified | gh search API |
| 8 | **hvardhan878** | GitHub | ghostwork — Screenpipe GUI + macOS 自动化 Agent | 152★ | github.com/hvardhan878 | ✅ identified | gh search |
| 9 | **selfdriven-foundation** | Twitter | selfdriven Foundation, Agent 基础设施 | — | @selfdrivenF | ✅ identified | gh search API |
| 10 | **affaan-m** | Twitter | AI Agent OSS meta-harness, 量化预测市场 | 8127 | @affaanmustafa | ✅ identified | gh search API |
| 11-20 | _(待填入 — 用 §2.1 搜索关键词继续扩充)_ | | | | | ⬜ | |

---

## 3. 消息模板

### 3.1 Twitter DM（推荐 — 最高回复率）

**版本 A — 冷启动（无共同关注）**:

```
Hi [名字],

看到你在做 [具体方向，如"量化+LLM"] 的工作。

我在做一个开源项目叫 Aether — 本地优先的 AI Agent 框架：
- V8 沙箱隔离（子进程逃逸被阻断，动态测试证明）
- HMAC-SHA256 审计链（可验证 Agent 执行没有被篡改）
- 任意 LLM 切换（Claude/Gemini/Ollama/DeepSeek）
- 575 个测试，Apache-2.0

想找 5 个 beta tester，免费用 + 技术咨询，换一个 case study 授权。

有兴趣聊 15 分钟？
```

**版本 A1 — Screenpipe 定制**（明确提到集成 OpenClaw/Hermes，天然适配目标）:

```
Hi screenpipe team，

看到你们在做 YC S26 的本地 AI 层 — 很认同"数据不离开设备"的理念。

我在做 Aether — 本地 AI Agent 框架，有一个 screenpipe 刚好需要的东西：
可验证的执行。我们做了 V8 沙箱 + HMAC-SHA256 审计链 + 12 个动态 exploit
测试（全阻断），可以证明 Agent 做了什么/没做什么。

你们文档提到集成 OpenClaw/Hermes。Aether 可以作为底层执行层，
给这些 Agent 提供可验证的"信任根"。

可以聊 15 分钟看集成是否互利？

github.com/mbpz/aether
red-team-report.md 见 /docs
```

**版本 B — 有共同关注/互动过**:

```
Hi [名字]，

之前你发的关于 [具体推文/项目] 很有意思 — 特别是 [具体观点]。

我在做的 Aether 刚好解决了一个相关问题：如何让 AI Agent 在本地执行时可以验证它做了什么。

细节: https://github.com/mbpz/aether
红队报告: https://github.com/mbpz/aether/blob/main/docs/red-team-report.md

如果你在处理敏感数据（金融/健康/法律），我可以给你做一个定制的安全评估。

有 15 分钟聊聊？
```

**版本 C — 最短（高关注者，忙碌的人）**:

```
[名字]，

开源了 Aether (github.com/mbpz/aether) — 本地 AI Agent 框架，有可验证的沙箱（12 个动态 exploit 测试全阻断）。

找 beta testers。你是有影响力的 [量化/开发者]，想给你免费做安全评估 + 技术咨询。

有兴趣？
```

### 3.2 GitHub Issue / Discussion

在相关的 GitHub repo 的 Discussion 区发帖（不要发 Issue，会被认为是 spam）:

```
## Aether: 本地优先的可验证 AI Agent 框架 — 找 beta testers

我在维护 Aether (github.com/mbpz/aether) — 一个开源的本地 AI Agent 框架，特点：

- **V8 沙箱 + 故障关闭**: 恶意代码跑在隔离区，子进程逃逸被阻断（动态证明: red-team-report.md）
- **HMAC-SHA256 审计链**: Agent 的每个操作都有可验证的审计日志
- **任意 LLM 切换**: 一个配置切换 Claude/Gemini/Ollama/DeepSeek
- **575 个测试，Apache-2.0**

**找 5 个 beta testers**。免费用 + 技术咨询 + 定制安全评估，换一个公开的 case study。

适合: 处理敏感数据的开发者（金融健康法律）、需要可审计 AI 执行的团队。

DM 或者直接 reply — 我可以给你 15 分钟 Zoom。
```

### 3.3 邮件（如果有公开邮箱）

```
Subject: Aether — 本地 AI Agent 框架 + 免费安全评估

Hi [名字],

我在 GitHub 上维护 Aether (github.com/mbpz/aether) — 开源的本地优先 AI Agent 框架。

核心差异: 我们的 V8 沙箱通过了 12 个动态 exploit 测试（全阻断），加上 HMAC-SHA256 审计链 + SOC2 导出。红队报告: github.com/mbpz/aether/blob/main/docs/red-team-report.md

看到你在 [公司/项目] 做 [具体方向]，觉得 Aether 的"可验证执行"可能对你有价值。

给 5 个 beta testers 提供免费:
- 技术咨询（如何把 Aether 接入你的工作流）
- 定制安全评估（你的场景下沙箱够不够）
- 15 分钟 Zoom onboarding

换一个公开的 case study 授权。

有兴趣？

[你的名字]
Aether 维护者
```

### 3.3 高价值目标定制消息（可直接发送）

**目标 #1 — screenpipe** (用上面的 版本 A1):

```
Hi screenpipe team，

看到你们在做 YC S26 的本地 AI 层 — 很认同"数据不离开设备"的理念。

我在做 Aether — 本地 AI Agent 框架，有一个 screenpipe 刚好需要的东西：
可验证的执行。我们做了 V8 沙箱 + HMAC-SHA256 审计链 + 12 个动态 exploit
测试（全阻断），可以证明 Agent 做了什么/没做什么。

你们文档提到集成 OpenClaw/Hermes。Aether 可以作为底层执行层，
给这些 Agent 提供可验证的"信任根"。

可以聊 15 分钟看集成是否互利？

github.com/mbpz/aether
red-team-report.md 见 /docs
```

**目标 #2 — albert-ying** (agentic-cortex, 明确用 OpenClaw/Claude Code):

```
Hi Albert，

看到你的 agentic-cortex 项目 — "个人 AI OS 基于 OpenClaw/Claude Code"，
这个方向很对。

我在做 Aether — 给这些 Agent 提供一个可验证的执行层：
- V8 沙箱隔离（子进程/模块注入全阻断，动态测试证明）
- HMAC-SHA256 审计链（每个 Agent 操作都可验证没被篡改）
- 红队报告: github.com/mbpz/aether/blob/main/docs/red-team-report.md

如果你在考虑如何让 agentic-cortex 的执行层更安全/可审计，
我们可以聊聊 Aether 作为底层替代方案。15 分钟？
```

**目标 #3 — alirezarezvani** (HealthTech + Agentic Coding):

```
Hi Alireza，

看到你在 HealthTech 做 Agentic Coding — 医疗场景对"可审计的 AI 执行"
有硬性要求（HIPAA audit log 等）。

Aether 可以作为合规底层：
- 每个 Agent 操作都有 HMAC-SHA256 审计链
- `aether-audit export --format=soc2` 直接输出 SOC2 CC1-9 控制映射
- V8 沙箱阻止数据出域

如果你有医疗数据处理场景需要"可证明的 AI 执行"，可以聊聊。15 分钟？
github.com/mbpz/aether
```

---

## 4. 4 周执行时间线

### 第 1 周（07-03 → 07-10）: 基础加固 + 名单准备

- [x] 修复审计链跨文件 hash (#1)
- [x] Agent 生命周期事件自动记录 (#2)
- [x] 沙箱全平台验证 (#3)
- [x] RFC 威胁模型 + 红队报告 (#7, #8)
- [ ] **搜集 20 个目标**（填入 §2.2 的表格）
- [ ] 发送 first-wave DMs（目标: 10 个）

### 第 2 周（07-10 → 07-17）: 第一轮外联

- [ ] 发送 remaining 10 个 DMs
- [ ] 在 2 个论坛发帖（QuantConnect, r/LocalLLaMA）
- [ ] 追踪回复，筛选 3-5 个有意向的
- [ ] 1-on-1 onboarding Zoom（每个 15-30 分钟）
- [ ] 选定 1 个 "named reference"

### 第 3 周（07-17 → 07-24）: 案例研究

- [ ] 帮助 named reference 搭建 + 跑通工作流
- [ ] 收集使用数据（任务数、token 消耗、审计日志大小）
- [ ] 起草 case study 草稿（与参考对象合作）

### 第 4 周（07-24 → 08-03）: 发布

- [ ] Case study 公开（博客/README/案例对象自己的渠道）
- [ ] Show HN — "Aether 在 [行业] 生产环境的使用"
- [ ] 更新 roadmap.md 标记试点完成

---

## 5. 指标追踪

| 指标 | 第 1 周目标 | 第 2 周目标 | 第 4 周目标 |
|------|-----------|-----------|-----------|
| 搜集目标数 | 20 | — | — |
| 已发送 DM | 10 | 20 | 20 |
| 回复数 | — | 5-8 | — |
| 有意向 | — | 3-5 | — |
| Onboarded | — | 1-2 | 1 |
| 公开 case | — | — | 1 |

---

## 6. 非量化成功信号

- 有人主动在 Twitter 提及 Aether
- 有人在自己的项目里用 Aether
- Someone opens an issue saying "I switched from OpenClaw because of the sandbox"
- HN 帖子进入前 10
- 有人写了第三方教程/博客

---

## 7. Fallback 计划

**如果 2 周后零回复**:
- 调整消息模板（缩短、更具体、更有吸引力）
- 扩大目标人群（从 quant 扩展到 generic "local LLM" 开发者）
- 在 HN/Reddit 发 "Show HN" 帖子获取初始关注

**如果只有 P3 独立开发者愿意合作（无 P0 量化/健康）**:
- 接受 P3 — 独立开发者的公开案例也很有价值
- 继续启动 P1（如有时间）

**如果 4 周内无法获得任何公开背书**:
- 转为 dogfooding 叙事（"我们每天用它跑自己的工作流"）
- 在 README 加入"由维护者在生产环境中使用"
- 调整竞争定位（"新生项目，寻找早期采用者"）

---

*维护者备注: 此文件每周 review 一次。回复数和状态填入 §2.2 表格。*
