# Aether — Multi-Provider Local-First Agent Framework

> **AI agents that run anywhere, lock nowhere.** Execute locally on any LLM — Claude, Gemini, Bedrock, Ollama, DeepSeek — with a V8-Isolate sandbox and three-tier skill disclosure.

[![CI](https://img.shields.io/badge/phase-MVP-green)](https://github.com/aether/aether)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D20-339933)](https://nodejs.org)
[![Tests](https://img.shields.io/badge/tests-548%20passed-brightgreen)](#)
[![Coverage](https://img.shields.io/badge/see-CI-yellowgreen)](#)

[English](#english-quickstart) · [中文](#核心定位)

---

> **Trust as trajectory.** Local V8 sandbox Day 0. Route to any provider Day 1. [Audit the trust boundary](docs/compositions.md) as it grades Day 2 — `aether-audit verify` proves the chain hasn't been tampered with.

---

> **案例研究 (Case Study)**: [维护者如何在生产环境中使用 Aether 进行自身开发](docs/case-study-dogfood.md) · 575 tests · 12 exploit vectors · 0 escapes · SOC2 CC1-9 全覆盖

---

## English Quickstart

Aether is a privacy-first AI agent execution platform. Unlike cloud agents (Manus, AutoGPT) that send data to external servers, Aether executes all code and stores all memory **locally**.

**Three pillars:**
1. **Zero-trust sandbox** — V8 Isolate with fail-closed policy, no native bindings escape without Manifest authorization
2. **Multi-provider dispatch** — one config switches between Anthropic, Gemini, Bedrock, Ollama, OpenRouter, DeepSeek, or any OpenAI-compatible endpoint
3. **Progressive disclosure** — three-tier SKILL.md loading cuts token consumption by ≥60% (benchmarked, reproducible)

### Try it locally (30 seconds)

```bash
git clone https://github.com/aether/aether && cd aether
npm install
npm run build && npm test               # ~548 tests, all green
npm run gateway &                       # starts Zero-Trust Gateway on :18790
curl -X POST http://127.0.0.1:18790/api/agent/execute \
  -H 'Content-Type: application/json' \
  -d '{"code":"console.log(42)","manifestName":"default"}'
```

You should see `{"ok":true,"output":42,...}` returned. No cloud, no API key, no data leaving your machine.

### With a local or remote LLM

```bash
# Local (Ollama)
LLM_BASE_URL=http://localhost:11434 LLM_MODEL=deepseek-r1 npm run gateway

# Remote (Anthropic)
LLM_BASE_URL=https://api.anthropic.com LLM_API_KEY=sk-ant-... LLM_MODEL=claude-sonnet-4-7 npm run gateway

# Remote (Gemini)
LLM_BASE_URL=https://generativelanguage.googleapis.com LLM_API_KEY=... LLM_MODEL=gemini-2.5-pro npm run gateway
```

### Next steps

- [examples/token-benchmark/](examples/token-benchmark/) — reproduce the ≥60% token reduction claim
- [CONTRIBUTING.md](CONTRIBUTING.md) — code layout, SDD workflow, commit message format
- [docs/adr/](docs/adr/) — Architecture Decision Records covering the security posture
- [requirements/roadmap.md](requirements/roadmap.md) — full roadmap with machine-checkable verification commands
- [SECURITY.md](SECURITY.md) — vulnerability disclosure (30-day SLA)
- [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) — Contributor Covenant v2.1

---

## 核心定位

Aether 是一个隐私优先的 AI Agent 执行平台。与云端 Agent（Manus、AutoGPT）不同，Aether 在本地执行所有代码和存储所有记忆——你的数据永不离开设备。

**三大支柱：**
1. **零信任沙箱** — V8 Isolate + 故障关闭策略，无 Manifest 授权不得逃逸
2. **多 LLM 调度** — 一个配置在 Anthropic、Gemini、Bedrock、Ollama、DeepSeek 间切换
3. **三级渐进披露** — 减少 ≥60% Token 消耗（可复现基准测试）

## 核心优势

| 能力 | Aether | 竞品 |
|------|--------|------|
| 沙箱安全 | V8 Isolate 故障关闭（[长期路线图](requirements/roadmap/long-term.md)） | Docker/Firecracker/无 |
| 隐私 | 100% 本地，数据不离开设备 | 云端黑盒 |
| 三级披露 | 唯一完整实现（[可复现](examples/token-benchmark/)） | 无 |
| 多 LLM | Anthropic + Gemini + Bedrock + Ollama + DeepSeek | 通常锁定单一 |
| 技能兼容 | SKILL.md + OpenClaw + Manus 全兼容 | 仅单一格式 |

## 快速开始

```bash
npm install
npm run build && npm test               # 526 tests
npm run gateway                          # 启动 Gateway 在 :18790

# 带本地 LLM（Ollama）
LLM_BASE_URL=http://localhost:11434 LLM_MODEL=deepseek-r1 npm run gateway

# 执行示例
curl -X POST http://localhost:18790/api/agent/execute \
  -H "Content-Type: application/json" \
  -d '{"code": "console.log(42)", "manifestName": "default"}'
```

### 可复现基准测试

```bash
# 验证 "≥60% token 减少" 声明
node examples/token-benchmark/run-benchmark.mjs
```

## 安全模型

Aether 的安全设计覆盖 [OWASP Agentic Top 10](https://owasp.org/www-project-agentic-ai-threats/)。详见 [SECURITY.md](SECURITY.md)。

| 威胁 | Aether 防护 |
|------|------------|
| 01 Prompt Injection | Manifest 预审计 + 静态扫描 |
| 02 Data Leakage | V8 Isolate 沙箱隔离 |
| 03 Sandbox Escape | V8 线性内存 + 故障关闭 |
| 04 Agent Hijacking | Manifest 凭证管控 |
| 05 Overtrusting | 三级披露 + 显式权限 |
| 06 Unbounded Execution | MAX_STEPS + timeout |

> **动态漏洞证明：** `packages/gateway/src/sandbox/exploit-demonstration.test.ts` 包含实际执行的 exploit 测试（`child_process.execSync("id")` 被沙箱阻断）。运行 `npx vitest run` 验证。

## 为什么选 Aether？

如果你担心云端 AI Agent 的隐私问题（数据被用于训练、凭证泄露、不受控的执行），Aether 是目前唯一能在本地提供**多 LLM 调度 + 可验证沙箱 + 技能生态兼容**的开源方案。

详细对比见 [requirements/competitive-analysis.md](requirements/competitive-analysis.md)。

---

**项目结构、路线图、架构图见 [requirements/](requirements/) 和 [docs/](docs/)。**
