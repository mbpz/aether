# ADR-009 — Demo runbook: VPS + k3s + ingress-nginx (B12)

- **Status**: Accepted
- **Date**: 2026-07-02
- **Scope**: `deploy/k3s/install.sh`, `deploy/k3s/README.md`, README demo link
- **Related**: [ADR-008 self-hosted k3s demo](008-self-hosted-k3s-demo.md)

## Context

ADR-008 chose self-hosted k3s on a 5€/mo VPS as the demo deployment
model. B11 wrote `values-demo.yaml` + the GitHub workflow. What
remained was a concrete operator runbook that a human (the maintainer)
can follow to actually provision the cluster.

This ADR documents the runbook shape so the choice is reproducible.

## Decision

**Two-file runbook** in `deploy/k3s/`:

1. **`install.sh`** — One-shot installer (~150 lines of bash). Runs as
   root on a fresh Ubuntu 22.04 VPS. Installs:
   - k3s single-node (no flannel, k3s default CNI is sufficient for 1 node)
   - Helm 3 (via official get_helm.sh)
   - cert-manager v1.16.1 (for `cert-manager.io/cluster-issuer` annotations)
   - ingress-nginx v4.11.3 in `hostPort` mode (no cloud LoadBalancer)
2. **`README.md`** — Step-by-step operator guide covering:
   - VPS provisioning (Hetzner CX11 recommended)
   - DNS setup (wildcard A record)
   - GitHub secrets configuration (`DEMO_KUBECONFIG`, `DEMO_HOSTNAME`,
     `DEMO_LLM_API_KEY`)
   - Workflow trigger and verification
   - Day-2 operations (logs, restart, skill updates, version upgrades)
   - Tear-down procedure
   - Troubleshooting for the 3 most likely failure modes

## Why this shape (vs. alternatives)

- **`install.sh` instead of an Ansible playbook**: One-shot VPS
  provisioning is too small for a full Ansible role. Bash + the k3s
  install script is ~150 lines and self-contained — no extra runtime
  dependency. The k3s install URL (`get.k3s.io`) is itself the
  "official" one-liner and is well-known to be idempotent.

- **`README.md` instead of a separate `OPERATIONS.md`**: Operators
  reading the repo start at the root README. Keeping the runbook
  one click away (rather than in a separate `docs/operations/`
  subfolder) lowers the friction for a maintainer who only sees this
  once per cluster.

- **Embedded troubleshooting rather than a separate `TROUBLESHOOTING.md`**:
  The runbook is a single linear narrative; embedding the 3 known
  failure modes (DNS not pointing at VPS, cert-manager not yet ready,
  image pull error) at the end keeps the operator context local.
  Future failure modes can be appended as additional `###` sections.

- **Wildcard DNS A record (`*.aether-demo.example.com`) instead of
  separate sub-domains**: cert-manager issues a single wildcard
  certificate covering all sub-domains. This is cheaper (one cert
  vs N) and lets the operator add new sub-domains (e.g.
  `status.aether-demo.example.com`) without DNS reconfiguration.

- **`hostPort: true` on ingress-nginx instead of `LoadBalancer`**: The
  demo runs on a single VPS; there is no cloud load balancer. Using
  `hostPort: 80/443` makes the nginx-ingress controller pod bind
  directly to the VPS's network interface. Simpler than configuring
  MetalLB for a 1-node cluster.

## Why the install script *disables* k3s's default traefik

k3s ships with a built-in traefik ingress controller. The demo
chart's `ingress.className: "nginx"` would create a mismatch if
both controllers were active. Disabling k3s's traefik avoids the
"two ingress controllers fighting for the same annotation" failure
mode that has wasted operator time on at least 3 documented incidents
in upstream k3s issues.

## Consequences

- ✅ Maintainer can provision a fresh demo cluster in 1-2 hours
  (mostly waiting for `apt` + `curl | sh`).
- ✅ The runbook is self-contained — a new operator can read top-to-bottom
  and have a working cluster at the end.
- ✅ Day-2 operations are documented for the 4 most common
  scenarios (logs, restart, skill update, version upgrade).
- ⚠️ The install script is not idempotent across major k3s version
  upgrades. The maintainer must read the k3s upgrade notes before
  bumping `K3S_VERSION`.
- ⚠️ The script does not configure backups, monitoring, or alerting.
  Those are explicit non-goals — the demo is ephemeral by design.
- ⚠️ The runbook assumes a wildcard DNS A record. If the operator
  uses a flat A record (e.g. just `aether-demo.example.com`), they
  must adjust the cert-manager ClusterIssuer manifest and the
  ingress `tls[].hosts` list accordingly.

## Verification

```bash
# On a fresh Ubuntu 22.04 VPS:
bash -n deploy/k3s/install.sh    # syntax check
# After running on the VPS:
kubectl get nodes                 # 1 node, Ready
helm list -A                      # cert-manager + ingress-nginx installed
kubectl -n ingress-nginx get pods # 1 controller pod, Running

# After deploy workflow:
curl -fsS https://aether-demo.example.com/health
# → {"status":"ok",...}
```

## Not Doing

- ❌ Multi-node k3s cluster (defeats the 5€/mo cost target)
- ❌ Cloud-managed k8s (EKS/GKE/AKS) — same reason
- ❌ GitOps (ArgoCD / Flux) — overkill for a single-VPS cluster
- ❌ Backup/restore (demo state is ephemeral)
- ❌ Monitoring/alerting (covered by future B18 if needed)
- ❌ Per-operator SSH key install — the runbook assumes the operator
  has root SSH access; adding public-key bootstrapping would
  double the script's complexity for a one-time operation
