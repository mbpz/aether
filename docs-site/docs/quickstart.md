---
slug: /quickstart
title: Quickstart
sidebar_label: Quickstart
---

# Quickstart

Get a working Aether gateway in 5 minutes, no cloud account, no LLM
required.

## Prerequisites

- Node.js ≥ 20 (`node --version`)
- macOS or Linux (Windows works for development; eBPF kernel
  isolation requires Linux at runtime)

## 5-line Quickstart

```bash
git clone https://github.com/aether/aether && cd aether
npm install
npm run build && npm test               # 462 passed, 0 skipped
npm run gateway &                       # starts Zero-Trust Gateway on :18790
curl -X POST http://127.0.0.1:18790/api/agent/execute \
  -H 'Content-Type: application/json' \
  -d '{"code":"console.log(42)","manifestName":"default"}'
```

You should see `{"ok":true,"output":42,...}` returned from the
gateway. The full eBPF kernel layer activates when you run the
sandbox against a Linux host with the `deploy/ebpf/` DaemonSet
deployed.

## With a local LLM

```bash
LLM_BASE_URL=http://localhost:11434 LLM_MODEL=deepseek-r1 npm run gateway
```

This requires [Ollama](https://ollama.ai) running locally with
`deepseek-r1` pulled. The gateway falls back to MockPlanner when
`LLM_BASE_URL` is empty.

## Optional: try the live public demo

The maintainer runs a live demo at
[aether-demo.example.com](https://aether-demo.example.com/) backed by
a €5/mo Hetzner VPS. To deploy your own, see
[deploy/k3s/README.md](https://github.com/aether/aether/blob/main/deploy/k3s/README.md).

## What's next

- **Architecture**: [Architecture overview](architecture/intro.md)
- **Reference**: [CLI](reference/cli.md), [LLM](reference/llm.md)
- **Community**: [Contributing](community/contributing.md),
  [Security](community/security.md)
