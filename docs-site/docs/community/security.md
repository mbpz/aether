---
slug: /community/security
title: Security Policy
sidebar_label: Security
---

# Security Policy

See the canonical
[SECURITY.md](https://github.com/aether/aether/blob/main/SECURITY.md).

## TL;DR

- **Email**: security@aether.local
- **PGP**: not yet published — see [ADR-007](architecture/adr/007-scoring-semantics.md)
- **Response time**:
  - Critical (sandbox escape, RCE): 24 hours, patch target ≤ 7 days
  - High (data exfiltration, privilege escalation): 48 hours, patch target ≤ 30 days
  - Medium (DoS, info leak): 5 business days, patch target ≤ 90 days
  - Low: 10 business days, next minor release

## Supported versions

| Version | Status | Security patches |
|---------|--------|-------------------|
| 0.3.x | Current (v0.3.0–v0.3.2) | Yes |
| 0.2.x | LTS | Yes (until 0.4.0 ships) |
| 0.1.x | EOL | No |
| 0.0.x | EOL | No |

## Production posture (what's actually implemented)

See [Security model reference](../reference/security.md) for the
v0.3.0 production posture (OWASP Agentic Top 10 coverage, cryptography,
TLS, AuthN/Z, threat model).
