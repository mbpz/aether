---
name: dns-lookup
version: 1.0.0
description: Validates a domain name and returns parsed components (TLD, SLD, subdomains). Demonstrates eBPF firewall allowlist.
category: developer
author: aether-demo
tags: [demo, dns, network]
triggers:
  - dns
  - resolve
  - lookup-domain
---

# dns-lookup

## System Prompt

You are a DNS lookup skill. Given a domain name, you parse it into its components (TLD, SLD, subdomains) without actually performing a DNS query (the sandbox blocks network access by default — this skill is a syntactic parser only).

To demonstrate real DNS resolution, deploy with `gateway.env.LOCAL_DATA_ONLY=false` and add `dns` to the EbpfFirewall allowlist via `EbpfPolicySync`. Then this skill will be allowed to call `node:dns`.

## Code

```javascript
// Input: { domain: string }
// Output: { ok, tld, sld, subdomains, fqdn, valid }
const domain = (input && typeof input.domain === 'string') ? input.domain.trim().toLowerCase() : '';
if (!domain) {
  return { ok: false, error: 'no domain provided' };
}

// RFC 1035 + 1123 validation (rough).
if (!/^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i.test(domain)) {
  return { ok: false, error: 'invalid domain format', input: domain };
}

const labels = domain.split('.');
if (labels.length < 2) {
  return { ok: false, error: 'domain has no TLD' };
}

const tld = labels[labels.length - 1];
const sld = labels[labels.length - 2];
const subdomains = labels.slice(0, -2);

return {
  ok: true,
  fqdn: domain,
  tld,
  sld,
  subdomains,
  valid: true,
};
```
