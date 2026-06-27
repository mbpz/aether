# Aether — 主权级通用自主执行系统 (SAS)

> **Sovereign Autonomous System**: AI agents that never leak data, never call home, and execute with cryptographic verifiability.

[![CI](https://img.shields.io/badge/phase-MVP-green)](https://github.com/aether)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D20-339933)](https://nodejs.org)
[![Tests](https://img.shields.io/badge/tests-462%20passed-brightgreen)](https://github.com/aether/aether)
[![Coverage](https://img.shields.io/badge/coverage-50.37%25-yellowgreen)](.)
[![v0.3.0](https://img.shields.io/badge/release-v0.3.0-blue)](https://github.com/aether/aether/releases/tag/v0.3.0)

[English](#english-quickstart) · [中文](#核心定位)

> **🚀 Live demo**: [aether-demo.example.com](https://aether-demo.example.com/) — full Aether stack on a €5/mo Hetzner VPS, 5 demo skills ready to invoke via curl. See the [Try Aether in 5 minutes](#try-aether-in-5-minutes--public-demo) section for how to deploy your own.

---

## English Quickstart

Aether is a privacy-first AI agent execution platform. Unlike cloud agents (Manus, AutoGPT) that send data to external servers, Aether executes all code and stores all memory **locally** — your data never leaves your machine.

**Three pillars:**
1. **Zero-trust sandbox** — V8 Isolate + eBPF XDP, no code escapes without Manifest authorization
2. **Progressive disclosure** — Three-tier SKILL.md loading minimizes token consumption
3. **Auditable execution** — SOC2-compliant audit log with HMAC-SHA256 hash chaining

### Prerequisites

- Node.js ≥ 20 (`node --version`)
- macOS or Linux (Windows works for development, but eBPF kernel isolation requires Linux at runtime)

### 5-line Quickstart

```bash
git clone https://github.com/aether/aether && cd aether
npm install
npm run build && npm test               # 187 passed, 4 known-skipped (see CHANGELOG)
npm run gateway &                       # starts Zero-Trust Gateway on :18790
curl -X POST http://127.0.0.1:18790/api/agent/execute \
  -H 'Content-Type: application/json' \
  -d '{"code":"console.log(42)","manifestName":"default"}'
```

You should see `{"ok":true,"output":42,...}` returned from the gateway. The full eBPF kernel layer activates when you run the sandbox against a Linux host with the `deploy/ebpf/` DaemonSet deployed — see [requirements/roadmap.md §2.1](requirements/roadmap.md).

### Optional: with a local LLM

### Try Aether in 5 minutes — public demo

The maintainer maintains a live demo at **https://aether-demo.example.com/**
(assuming `aether-demo.example.com` is the configured hostname — update
this section when deploying to a new domain). To deploy your own:

If you maintain a single-node k3s cluster (Hetzner CX11, Netcup VPS200, or
similar — ~5€/month), you can deploy the same demo we run:

```bash
# 1. From this repo's GitHub Actions → "Deploy Demo" → workflow_dispatch.
#    Requires three secrets (set once in your GitHub repo settings):
#      DEMO_KUBECONFIG    base64-encoded kubeconfig
#      DEMO_HOSTNAME      e.g. aether-demo.example.com
#      DEMO_LLM_API_KEY   optional; leave empty for MockPlanner

# 2. After the workflow finishes, get the auto-generated token:
TOKEN=$(kubectl -n aether-demo get secret aether-demo-gateway-auth \
  -o jsonpath='{.data.LOCAL_API_TOKEN}' | base64 -d)

# 3. Try the 5 preinstalled demo skills:
curl -X POST "https://aether-demo.example.com/api/agent/execute" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"manifestName":"hello-world","code":"return {ok:true,output:42};"}'
```

For the full operator runbook (VPS provisioning, DNS, secrets, day-2 ops),
see [deploy/k3s/README.md](deploy/k3s/README.md). For the design
rationale of "self-hosted k3s on VPS vs fly.io / render / cloud-K8s",
see [ADR-008](docs/adr/008-self-hosted-k3s-demo.md).

The 5 demo skills (in `examples/skills/`):

| Skill | Demonstrates |
|-------|-------------|
| `hello-world` | Baseline sandbox execution |
| `csv-summary` | Input parsing in a sandboxed function |
| `dns-lookup` | eBPF firewall allowlist pattern |
| `memory-recall` | L1/L2/L3 progressive memory model |
| `git-status` | Pure parser; gateway runs `git`, skill is sandboxed |

The deploy workflow:
- builds the demo skill registry as a ConfigMap from `examples/skills/`
- applies `deploy/helm/aether/values-demo.yaml` (single-replica, ingress + TLS)
- runs a smoke test against the public ingress
- prints the demo URL + a token-resolution snippet

For local-only testing (no cluster, no LLM, no network), see the
[5-line Quickstart](#5-line-quickstart) above.

### Next steps

- [CONTRIBUTING.md](CONTRIBUTING.md) — code layout, SDD workflow (Batches 0–5), commit message format
- [docs/adr/](docs/adr/) — 6 Architecture Decision Records covering the security posture
- [requirements/roadmap.md](requirements/roadmap.md) — every `✅` has a machine-checkable verification command
- [SECURITY.md](SECURITY.md) — vulnerability disclosure (30-day SLA)
- [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) — Contributor Covenant v2.1

---

## 核心定位

Aether is a privacy-first AI agent execution platform. Unlike cloud agents (Manus, AutoGPT) that send data to external servers, Aether executes all code and stores all memory **locally** — your data never leaves your machine.

**Three pillars:**
1. **Zero-trust sandbox** — WASM + eBPF isolation, no code escapes without Manifest authorization
2. **Progressive disclosure** — Three-tier SKILL.md loading minimizes token consumption
3. **Auditable execution** — SOC2-compliant audit log with HMAC-SHA256 hash chaining

## 核心优势（已完成）

| 能力 | Aether | 竞品 |
|------|--------|------|
| 沙箱安全 | WASM/eBPF 双重隔离 | Docker/firecracker |
| 隐私 | 100% 本地，数据不离开设备 | 云端黑盒 |
| 三级披露 | 唯一完整实现 | 无 |
| 多Agent | 独立子沙箱 + AES-256-GCM 加密总线 | 社区hack |
| 记忆系统 | L1/L2/L3 三层 + Ollama+Qdrant | TF-IDF |
| 技能兼容 | SKILL.md + OpenClaw + Manus 全兼容 | 仅单一格式 |
| 自调试 | CodeAct 闭环 | 无 |
| SOC2审计 | HMAC-SHA256 hash chaining | 无 |

## 快速开始

```bash
# 启动 Gateway（本地优先，零信任）
npm run gateway

# 或带 LLM（使用本地 Ollama）
LLM_BASE_URL=http://localhost:11434 LLM_MODEL=deepseek-r1 npm run gateway

# Agent 执行示例
curl -X POST http://localhost:18790/api/agent/execute \
  -H "Content-Type: application/json" \
  -d '{"code": "console.log(42)", "manifestName": "default"}'
```

## 项目结构

```
packages/
├── gateway/          # 零信任控制平面 (EP-02)
│   └── src/
│       ├── audit/         # SOC2 审计日志 (HMAC-SHA256)
│       ├── sandbox/       # SandboxBridge (eBPF 集成)
│       ├── memory/        # L1/L2/L3 分层记忆
│       ├── multi-agent/   # MessageBus + TeamOrchestrator
│       ├── agent-loop/    # AgentRunner (Mock→LLM 可选)
│       └── llm/           # LLMPlanner (ReAct 循环)
├── sandbox/          # WASM 隔离执行层 (EP-01)
│   └── src/
│       ├── security/      # EbpfFirewall + SecurityPolicy
│       └── codeact/       # CodeAct 自调试引擎
└── skill-loader/     # 技能加载器 (EP-03)
    └── src/
        ├── audit/         # SkillSecurityAuditor
        └── parser/        # SKILL.md + Skillpack 解析器

deploy/helm/aether/   # K8s Helm Chart (EP-06)
requirements/          # 需求文档 + 路线图
```

## 已完成功能

### EP-01 安全沙箱 ✅
- `isolated-vm` V8 Isolate（安全加固）
- Manifest 预执行审计
- 移除 `safe-eval` 降级
- eBPF 防火墙集成（App 层策略执行）

### EP-02 零信任控制平面 ✅
- Gateway HTTP/WebSocket 服务
- Manifest 解析器
- Vault 凭证注入器（受 Manifest 管控）
- SOC2 审计日志（HMAC-SHA256 hash chaining）

### EP-03 技能系统 ✅
- SKILL.md 全格式兼容（Manus/OpenClaw/Aether）
- 三级渐进式披露（Level 1/2/3）
- Skillpack 锁文件格式兼容
- 安全审计自动化（skill-auditor.ts）

### EP-04 分层记忆 ✅
- L1 Working / L2 Episodic / L3 Semantic
- O(N²) → 阈值策略优化
- Ollama 密集嵌入（nomic-embed-text）
- Qdrant 本地向量库
- L2→L3 自动压缩提炼

### EP-05 多Agent协作 ✅
- MessageBus（内存队列 + JSONL 持久化）
- AgentRegistry
- AES-256-GCM 加密消息总线
- Per-Agent 独立沙箱
- TeamOrchestrator（planner/executor/reviewer）
- Sequential / Parallel / Hierarchical 模式

### EP-06 企业级部署 ✅
- Helm Chart（K8s 3副本 + anti-affinity）
- SOC2 审计日志
- ConfigMap / Secret / Ingress / PVC

## 正在进行

| 任务 | 优先级 | 状态 |
|------|--------|------|
| Wasmtime Runtime | P0 | 调研完成，官方 npm 包不可用 |
| Kata + Firecracker | P1 | Phase 3 |
| 技能市场 | P1 | Phase 3 |

## 配置示例

```bash
# .env (Gateway)
GATEWAY_PORT=18790
LOCAL_TOKEN_AUTH_REQUIRED=false
READONLY_MODE=true
MEMORY_DIR=./memory-store

# LLM (可选，不配置则使用 MockPlanner)
LLM_BASE_URL=http://localhost:11434
LLM_MODEL=deepseek-r1

# Audit
AUDIT_LOG_DIR=./runtime/audit
AUDIT_SIGNING_KEY=your-secret-key
```

## 架构图

```
┌─────────────────────────────────────────────────┐
│                   Aether Gateway                │
│  ┌─────────┐  ┌──────────┐  ┌──────────────┐   │
│  │Manifest │  │   Vault  │  │ AuditLogger  │   │
│  │ Engine  │  │(injection)│  │(HMAC-SHA256)│   │
│  └────┬────┘  └────┬─────┘  └──────┬───────┘   │
│       │            │               │           │
│  ┌────▼────────────▼───────────────▼────┐     │
│  │         SandboxBridge + eBPF         │     │
│  │  ┌─────────────────────────────────┐ │     │
│  │  │     isolated-vm (V8 Isolate)    │ │     │
│  │  │  CodeAct Engine │ SecurityPolicy│ │     │
│  │  └─────────────────────────────────┘ │     │
│  └───────────────────────────────────────┘     │
│                                                 │
│  ┌──────────┐  ┌──────────┐  ┌──────────────┐  │
│  │Memory L1 │  │Memory L2 │  │  Memory L3   │  │
│  │(working) │  │(episodic)│  │ (semantic)   │  │
│  └──────────┘  └──────────┘  └──────────────┘  │
└─────────────────────────────────────────────────┘
```

## 安全模型（OWASP Agentic Top 10）

| 威胁 | Aether 防护 |
|------|------------|
| 01 Prompt Injection | Manifest 预审计 + 静态扫描 |
| 02 Data Leakage | eBPF 网络拦截 |
| 03 Sandbox Escape | WASM 线性内存 |
| 04 Agent Hijacking | Vault 零信任注入 |
| 05 Overtrusting | 三级披露 + 显式权限 |
| 06 Unbounded Execution | MAX_STEPS + timeout |
| 07 Memory Poisoning | 重要性评分 + 遗忘机制 |
| 08 Credential Exposure | Vault 注入 + 环境变量 |
| 09 Intent Misalignment | 审计日志 + Manifest |
| 10 Model Poisoning | 技能签名 + 安全评分 |

## 下一步

1. **Wasmtime Runtime** — 等待官方 npm 包发布或使用 wasmtime-py
2. **Kata Containers** — Phase 3 企业级安全模式
3. **技能市场** — Phase 3 开发者生态

---

**为什么选 Aether？** 如果你担心云端 AI Agent 的隐私问题（数据被用于训练、凭证泄露、不受控的执行），Aether 是目前唯一能在本地提供完整多Agent协作 + 可验证审计日志 + 技能生态兼容的开源方案。