# ADR-008 — Self-hosted k3s on VPS as the demo deployment target

- **Status**: Accepted
- **Date**: 2026-06-30
- **Scope**: `deploy/helm/aether/values-demo.yaml`, `.github/workflows/deploy-demo.yml`, `examples/skills/`
- **Related**: [ADR-006 eBPF kernel integration](006-ebpf-yaml-sync.md), [SECURITY.md](../../SECURITY.md)

## Context

v0.2.2 closes the test retro-fit cycle at 50.37% coverage. The next gap is "user-facing": new contributors can read the README and understand the design, but to actually *try* Aether they must:

1. `git clone` + `npm install` (~hundreds of MB)
2. Configure an LLM (Ollama, OpenAI, etc.)
3. Generate a `LOCAL_API_TOKEN` and wire it through
4. Run `npm run gateway` locally
5. Have no skill examples available — the registry starts empty

This is a ~30-minute onboarding gap before a user sees Aether do anything interesting. Lowering this is the highest-value remaining improvement.

The maintainer reviewed four hosting options:

| Option | Cost | Setup effort | What it demonstrates |
|--------|------|-------------|-------------------|
| fly.io | $5/mo (256MB) | medium | single-container abstraction; **hides K8s** |
| render.com | $7/mo | low | single-container, "PR preview" model; hides K8s |
| railway.app | $5/mo (credit) | low | single-container; hides K8s |
| **VPS + k3s** | €5/mo (Hetzner CX11) | medium (one-time) | full K8s — DaemonSet, ConfigMap, Service, Ingress |

## Decision

**Use a self-hosted k3s single-node cluster on a 5€/mo VPS** (Hetzner CX11 or equivalent) as the demo deployment target.

The deploy workflow:
1. Triggers on `workflow_dispatch` only (never on push/PR)
2. Takes 3 secrets: `DEMO_KUBECONFIG` (base64), `DEMO_HOSTNAME`, `DEMO_LLM_API_KEY` (optional)
3. Builds a ConfigMap from `examples/skills/` (5 SKILL.md files)
4. Runs `helm upgrade --install` with `values-demo.yaml` (single-replica, cert-manager TLS)
5. Smoke-tests `/health` over the public ingress
6. Prints the demo URL + token-resolution snippet to the workflow summary

Five demo skills are bundled in `examples/skills/`:
- `hello-world` — baseline execution
- `csv-summary` — input parsing
- `dns-lookup` — eBPF firewall allowlist pattern (no actual DNS)
- `memory-recall` — L1/L2/L3 progressive memory
- `git-status` — pure parser; gateway runs `git`

## Why this over the cloud-PaaS options

1. **K8s-native demonstration**: Aether's architecture is K8s-native (gateway Deployment, sandbox DaemonSet, eBPF agent DaemonSet, ConfigMap-driven manifests). A fly.io / render single-container deploy obscures this. The demo's job is to *show* the architecture, not flatten it.
2. **Cost**: €5/mo is the cheapest "always-on demo" option. fly.io & render free tiers spin down after idle, breaking the "try it in 5 minutes" guarantee.
3. **Forward compatibility with B9**: The same cluster will be reused for the "real K8s e2e" batch (B9). Setting it up once for B11 means B9 only needs to add a test runner that points at the existing cluster.
4. **Real ingress + TLS**: cert-manager + nginx-ingress demonstrate the production deployment story, not a vendor-locked router.

## Why not the cloud-K8s options (EKS / GKE / AKS)

A full managed K8s cluster runs ≥ $70/mo, way more than the demo budget. The single-node k3s VPS provides ~95% of the K8s feature set at ~7% of the cost. The cells the demo *cannot* exercise (real multi-node anti-affinity, cross-node networking) are explicitly out of scope for a "try it in 5 minutes" demo.

## Consequences

- ✅ A new user can `kubectl -n aether-demo get pods` + `curl https://aether-demo.example.com/api/agent/execute` in 5 minutes after the maintainer presses "Deploy Demo".
- ✅ The maintainer pays €5/mo to keep the demo up. This is *operator* cost, not contributor cost.
- ✅ Demo skills (`examples/skills/`) become the canonical "what does Aether do?" reference.
- ⚠️ Demo state is intentionally ephemeral — each deploy re-creates the cluster's namespace, no user data persists. This is a feature for a public demo (no abuse vector), but means the demo cannot be used to evaluate persistence across restarts.
- ⚠️ The maintainer must keep the kubeconfig secret rotated (recommended: 6-monthly per SECURITY.md cadence).
- ⚠️ There is **no automated abuse defense**. The demo accepts requests from anyone with the auto-generated token. A v0.4 follow-up batch should add rate-limiting + IP allowlist via the ingress.

## Verification

```bash
# Local: chart renders with demo values.
helm template demo-aether ./deploy/helm/aether \
  -f ./deploy/helm/aether/values-demo.yaml \
  --set ingress.hosts[0].host=demo.example.com

# CI: workflow file is valid YAML.
yq -e '.on.workflow_dispatch' .github/workflows/deploy-demo.yml

# Live cluster (after deploy):
curl -fsS "https://$DEMO_HOSTNAME/health" | jq .  # → {"status":"ok"}
kubectl -n aether-demo get configmap aether-demo-skills -o jsonpath='{.data}' | jq 'keys | length'  # → 5
```

## Not Doing

- ❌ Multi-region / CDN
- ❌ Automated cluster autoscaling
- ❌ User identity / OAuth login (the demo accepts a single static token)
- ❌ Public skill submission (a future B15 batch)
- ❌ DNS / TLS certificate provisioning (the maintainer configures cert-manager + DNS once; the workflow assumes both exist)
