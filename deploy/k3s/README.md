# Aether Demo Cluster — Operator Runbook

This runbook walks the maintainer through provisioning a single-node k3s
cluster on a Hetzner Cloud CX11 (or equivalent 1 vCPU / 2 GB RAM VPS) and
turning it into the live demo cluster for the Aether project.

**Cost**: ~€4.85/mo (Hetzner CX11, monthly) + a domain name (~$10/yr).
**Time**: 1-2 hours total, mostly waiting for `apt` + `curl | sh`.

## 0. Prerequisites

Before starting, gather:

- A registered domain name you control (e.g. `aether-demo.example.com`)
- A GitHub account with admin access to the `aether/aether` repo
- Payment for the VPS + domain

## 1. Provision the VPS

Recommended: Hetzner Cloud CX11 (Ubuntu 22.04 LTS, 2 vCPU, 4 GB RAM).

1. Create the VPS in Hetzner Cloud Console
2. Note the public IPv4 address (e.g. `1.2.3.4`)
3. SSH in: `ssh root@1.2.3.4`
4. Add a non-root user with sudo (optional, the install script runs as root)

## 2. Point DNS at the VPS

Add these records at your registrar:

| Type | Host | Value |
|------|------|-------|
| A | `*` | `<VPS_IP>` |
| A | `@` (apex) | `<VPS_IP>` (optional, makes bare apex work too) |

The wildcard `*.` means the cert-manager can issue a single certificate
covering `aether-demo.example.com` + any future sub-domains
(e.g. `status.aether-demo.example.com`).

DNS propagation usually takes 5-15 minutes. Verify with
`dig +short aether-demo.example.com A` returning the VPS IP.

## 3. Install the cluster

```bash
curl -sfL https://raw.githubusercontent.com/aether/aether/main/deploy/k3s/install.sh | \
  bash -s -- \
    --hostname aether-demo.example.com \
    --email admin@example.com
```

This script installs:
- k3s single-node (no flannel — k3s default CNI is sufficient)
- Helm 3
- cert-manager (for cert-manager.io/cluster-issuer integration)
- ingress-nginx in `hostPort` mode (no cloud LoadBalancer dependency)

Estimated runtime: 5-8 minutes. When it finishes, it prints the
base64-encoded `kubeconfig` for the cluster.

## 4. Configure GitHub secrets

In GitHub: `aether/aether` repo → Settings → Secrets and variables → Actions → New repository secret.

Add the following three secrets:

| Secret name | Value |
|-------------|-------|
| `DEMO_KUBECONFIG` | The base64 string printed at the end of step 3 (the entire output, no newlines) |
| `DEMO_HOSTNAME` | `aether-demo.example.com` (your FQDN) |
| `DEMO_LLM_API_KEY` | (optional) An OpenAI-compatible API key, e.g. `sk-...`. Leave empty to use MockPlanner. |

## 5. Trigger the deploy

In GitHub: `aether/aether` → Actions → "Deploy Demo" → Run workflow.

Defaults:
- `tag`: `v0.3.0` (matches the latest tagged release)
- `hostname_override`: (empty, uses `DEMO_HOSTNAME` secret)

Estimated runtime: 3-5 minutes. The workflow:
1. Creates the `aether-demo` namespace
2. Builds a ConfigMap from `examples/skills/*.md`
3. Runs `helm upgrade --install aether-demo ./deploy/helm/aether` with `values-demo.yaml`
4. Smoke-tests `https://$HOSTNAME/health` for up to 60s
5. Prints the demo URL + a token-resolution snippet in the workflow summary

## 6. Verify

After the workflow finishes, test from your laptop:

```bash
TOKEN=$(kubectl -n aether-demo get secret aether-demo-gateway-auth \
  -o jsonpath='{.data.LOCAL_API_TOKEN}' | base64 -d)

curl -X POST "https://aether-demo.example.com/api/agent/execute" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "manifestName": "hello-world",
    "code": "return { ok: true, output: 42 };"
  }'
```

Expected response: `{"ok":true,"output":42,...}`.

Try the 5 demo skills in turn:

```bash
for skill in hello-world csv-summary dns-lookup memory-recall git-status; do
  echo "=== $skill ==="
  curl -s -X POST "https://aether-demo.example.com/api/agent/execute" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"manifestName\":\"$skill\",\"code\":\"return {ok:true,skill:'$skill'};\"}" | jq .
  echo
done
```

## 7. Day-2 operations

### View live logs

```bash
kubectl -n aether-demo logs -f deploy/aether-demo-gateway
```

### Restart the gateway

```bash
kubectl -n aether-demo rollout restart deploy/aether-demo-gateway
```

### Add a new demo skill

1. Create `examples/skills/<name>/SKILL.md` and commit
2. Re-run "Deploy Demo" workflow (or `kubectl create configmap aether-demo-skills -n aether-demo --from-file=... --dry-run=client -o yaml | kubectl apply -f -` then restart the gateway pod)

### Update to a newer Aether release

1. Cut a new tag, e.g. `git tag v0.3.1 && git push --tags`
2. Update the README's recommended `tag` default in `deploy-demo.yml` if you want a different default
3. Trigger "Deploy Demo" with the new tag

### Tear down the cluster

```bash
/usr/local/bin/k3s-uninstall.sh
# Hetzner console: destroy the CX11
```

## Troubleshooting

### "Ingress not ready after 60s"

```bash
kubectl -n aether-demo describe ingress
kubectl -n aether-demo get events --sort-by='.lastTimestamp' | tail -20
kubectl -n aether-demo logs -l app.kubernetes.io/name=aether-gateway --tail=50
```

Most common cause: the wildcard DNS A record isn't pointing at the VPS.
Verify: `dig +short aether-demo.example.com A` should return the VPS IP.

### "x509: certificate signed by unknown authority"

cert-manager is still issuing the cert. Wait 30-60s after first deploy and retry. To inspect:

```bash
kubectl -n aether-demo get certificates
kubectl -n aether-demo describe certificate aether-demo-tls
```

### "image pull error"

The CI-built image isn't on a public registry yet. The current
`values-demo.yaml` references `ghcr.io/aether/gateway:v0.3.0` — this
expects the release workflow to have published a multi-arch image.
If you're running this before v0.3.0 is published, change the image
to `aether/gateway:dev` after a local `docker build + push`.

## Security note

The demo cluster accepts requests from anyone with the auto-generated
token. There is no rate limiting, no IP allowlist, no audit-log
retention beyond the default 90 days. This is intentional — a
"5-minute demo" should not require an account. The
[Aether SECURITY.md](../../SECURITY.md) describes the supported
production posture; the demo is a *preview*, not a hosted service.

## Cost summary

| Item | Cost | Cycle |
|------|------|-------|
| Hetzner CX11 (1 vCPU, 4 GB, 40 GB SSD) | €4.85/mo | monthly |
| Domain name (e.g. Cloudflare registrar) | ~$10/yr | yearly |
| **Total** | **~$65/yr** | ongoing |

The €4.85/mo is operationally the cheapest "always-on demo" option that
preserves the K8s-native architecture Aether is designed for.
