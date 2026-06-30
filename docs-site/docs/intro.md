---
slug: /
title: Aether Documentation
sidebar_label: Intro
---

# Aether

**Privacy-first AI agent runtime.** A sovereign execution platform that
keeps your data, your code, and your agent's reasoning on your machine.

## What is Aether?

Aether is a Zero-Trust runtime for AI agents. Unlike cloud-based agent
frameworks (Manus, AutoGPT, MetaGPT) that send your data to remote
servers, Aether:

- **Executes all code locally** in a V8 Isolate sandbox (with Wasmtime
  when the upstream npm package ships).
- **Stores all memory locally** in a three-tier model (working →
  episodic → semantic).
- **Authenticates every skill** through a manifest-based permission
  system.
- **Records every action** in a hash-chained audit log (HMAC-SHA256).

## Three pillars

1. **Zero-trust sandbox** — V8 Isolate + eBPF XDP. No code escapes
   without Manifest authorization.
2. **Progressive skill disclosure** — Three-tier SKILL.md loading
   minimizes token consumption.
3. **Auditable execution** — SOC2-compliant audit log with
   HMAC-SHA256 hash chaining.

## Try it

- [Quickstart](quickstart.md) — clone, install, run, hello-world in
  5 minutes.
- [Architecture overview](architecture/intro.md) — what's in the box.
- [Try the live demo](https://aether-demo.example.com/) — the
  maintainer runs a public instance.

## Project status

- **Current release**: v0.4.0 (June 2026)
- **License**: Apache-2.0
- **Tests**: 526 passing, 0 skipped
- **Coverage**: 53.58% statements
- **Audit**: 0 npm vulnerabilities
- **ADRs**: 9 (see the [ADRs](architecture/intro.md#architecture-decision-records) page)

## Where to next

- **For new users**: [Quickstart](quickstart.md)
- **For operators**: [Demo cluster runbook](https://github.com/aether/aether/blob/main/deploy/k3s/README.md)
- **For contributors**: [Contributing](community/contributing.md)
- **For security researchers**: [Security policy](community/security.md)
