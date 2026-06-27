# Aether Demo Skills

Five reference skills demonstrating the Aether sandbox + manifest +
memory model. These are the default skills loaded by the demo cluster
(see `deploy/helm/aether/values-demo.yaml`).

## Skills

| Skill | Purpose | Demonstrates |
|-------|---------|--------------|
| [hello-world](hello-world/SKILL.md) | Deterministic greeting + timestamp | Baseline sandbox execution |
| [csv-summary](csv-summary/SKILL.md) | Parse CSV, infer column types | L3 input handling + pure-JS execution |
| [dns-lookup](dns-lookup/SKILL.md) | Validate + decompose a domain name | eBPF firewall allowlist pattern (no actual DNS) |
| [memory-recall](memory-recall/SKILL.md) | Write + recall a fact | L1/L2/L3 progressive memory model |
| [git-status](git-status/SKILL.md) | Parse `git status --porcelain` | Pure parser, gateway runs `git`, skill is sandboxed |

## How to load these on a self-hosted cluster

```bash
# Each skill is a directory with SKILL.md.
# The gateway scans MANIFEST_DIR + SKILL_REGISTRY_DIR at startup.
helm upgrade --install aether ./deploy/helm/aether \
  -f ./deploy/helm/aether/values-demo.yaml \
  --set extraVolumeMounts[0].mountPath=/app/examples/skills \
  --set extraVolumeMounts[0].name=demo-skills \
  --set extraVolumes[0].name=demo-skills \
  --set extraVolumes[0].configMap.name=aether-demo-skills

# Or: just COPY them into the image at build time (recommended).
```

## How to verify they registered

```bash
kubectl -n aether-demo exec deploy/aether-gateway -- \
  curl -s http://127.0.0.1:18790/api/skills | jq '.skills[].level1.name'
```

Expected output (alphabetical):

```
"csv-summary"
"dns-lookup"
"git-status"
"hello-world"
"memory-recall"
```

## How to invoke

```bash
TOKEN="$(kubectl -n aether-demo get secret aether-token -o jsonpath='{.data.token}' | base64 -d)"
curl -X POST "https://aether-demo.example.com/api/agent/execute" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "manifestName": "hello-world",
    "code": "(see SKILL.md ## Code section)"
  }'
```

## Adding your own demo skill

1. Create `examples/skills/<your-skill-name>/SKILL.md` with the same
   frontmatter shape as `hello-world`.
2. The Skill code in the `## Code` block runs in the V8 isolate sandbox:
   no network, no fs, no child_process, no `new Function`, 5s timeout.
3. Submit a PR — the `examples/` directory is the public, demo-only
   set; production skills should go through the [review workflow](
   ../packages/skill-loader/src/review-workflow.ts).
