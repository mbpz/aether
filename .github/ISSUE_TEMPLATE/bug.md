---
name: Bug report
about: Report a defect in Aether's behavior, build, or test suite
title: "[bug] "
labels: ["bug", "needs-triage"]
---

## Description

<!-- A clear and concise description of what the bug is. -->

## Reproduction

<!-- Minimal steps to reproduce. If the bug is in code execution, please share a `manifestName` and a code snippet. -->

```bash
# Commands / API calls / code:
npm run build
npm test
```

```ts
// code that triggers the bug
```

## Expected behavior

<!-- What you expected to happen. -->

## Actual behavior

<!-- What actually happened. Include the full error message and stack trace. -->

```
paste error here
```

## Environment

- Aether version: `npm run --silent -p aether eval 'require("./package.json").version'`  (or git rev)
- Node.js: `node --version`
- OS: macOS / Linux (distro + arch) / Windows
- `USE_WASM_RUNTIME`: true / false
- eBPF kernel layer: deployed / not deployed

## Security relevance

If the bug is security-sensitive (sandbox escape, RCE, data leak, etc.), **do not** file a public issue. Email **security@aether.local** instead — see [SECURITY.md](SECURITY.md) for our 90-day coordinated disclosure policy.

- [ ] This is NOT a security bug
- [ ] This MAY be a security bug (please email security@aether.local instead of filing publicly)

## Severity

- [ ] Blocker (cannot use Aether at all)
- [ ] High (a major feature is broken; workaround exists)
- [ ] Medium (a minor feature is broken; easy workaround)
- [ ] Low (cosmetic / docs / edge case)

## Logs

```text
paste relevant log output
```

## Related

- ADR: <!-- link if known -->
- Issue/PR: <!-- link if known -->
