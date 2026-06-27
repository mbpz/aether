#!/usr/bin/env bash
# deploy/k3s/install.sh
#
# One-shot installer for the Aether demo cluster.
# Tested on Hetzner Cloud CX11 (Ubuntu 22.04 LTS, 2 vCPU, 4 GB RAM, €4.85/mo).
# Idempotent: re-running is safe; the k3s install script is itself idempotent
# and the helm/argocd install steps are skipped if already present.
#
# Run as root on a fresh VPS:
#   curl -sfL https://raw.githubusercontent.com/aether/aether/v0.3.x/deploy/k3s/install.sh | bash -s -- \
#     --hostname aether-demo.example.com \
#     --email admin@example.com
#
# What this script does:
#   1. Installs k3s (single-node, no flannel — uses k3s default CNI)
#   2. Installs Helm 3 (for the demo chart)
#   3. Installs cert-manager (for ingress TLS)
#   4. Installs nginx-ingress via Helm
#   5. Prints the kubeconfig as base64 (paste into the DEMO_KUBECONFIG
#      GitHub secret)
#
# Estimated runtime: 5-8 minutes.

set -euo pipefail

HOSTNAME="${AETHER_HOSTNAME:-aether-demo.example.com}"
EMAIL="${AETHER_EMAIL:-admin@example.com}"
K3S_VERSION="v1.30.2+k3s2"
HELM_VERSION="v3.16.2"
CERT_MANAGER_VERSION="v1.16.1"
INGRESS_NGINX_VERSION="4.11.3"

log() { echo "[$(date -u +%FT%TZ)] $*"; }
die() { log "FATAL: $*" >&2; exit 1; }
require_root() { [[ $EUID -eq 0 ]] || die "must run as root (sudo $0)"; }

parse_args() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --hostname) HOSTNAME="$2"; shift 2 ;;
      --email) EMAIL="$2"; shift 2 ;;
      --k3s-version) K3S_VERSION="$2"; shift 2 ;;
      --helm-version) HELM_VERSION="$2"; shift 2 ;;
      *) die "unknown arg: $1 (allowed: --hostname, --email, --k3s-version, --helm-version)";;
    esac
  done
}

main() {
  parse_args "$@"
  require_root

  log "Aether demo cluster installer"
  log "  hostname: $HOSTNAME"
  log "  email:    $EMAIL (for cert-manager ACME)"
  log "  k3s:      $K3S_VERSION"

  if ! command -v curl >/dev/null || ! command -v systemctl >/dev/null; then
    die "this script requires curl + systemctl (Ubuntu 22.04+ assumed)"
  fi

  # 1. k3s — disables traefik (we install nginx-ingress ourselves for
  #    consistency with production values.yaml), enables local-path.
  if ! command -v k3s >/dev/null 2>&1; then
    log "installing k3s $K3S_VERSION..."
    curl -sfL https://get.k3s.io | \
      INSTALL_K3S_VERSION="$K3S_VERSION" \
      INSTALL_K3S_EXEC="--disable=traefik --write-kubeconfig-mode=644" \
      sh -
  else
    log "k3s already installed: $(k3s --version 2>&1 | head -1)"
  fi

  # Wait for the API server to be ready.
  log "waiting for k3s API server..."
  for _ in $(seq 1 30); do
    if kubectl get nodes >/dev/null 2>&1; then break; fi
    sleep 2
  done
  kubectl get nodes

  # 2. Helm 3 — installer script
  if ! command -v helm >/dev/null 2>&1; then
    log "installing helm $HELM_VERSION..."
    curl -fsSL https://raw.githubusercontent.com/helm/helm/main/scripts/get-helm-3 | \
      DESIRED_VERSION="$HELM_VERSION" bash -s -- --no-sudo
  else
    log "helm already installed: $(helm version --short)"
  fi

  # 3. cert-manager
  log "installing cert-manager $CERT_MANAGER_VERSION..."
  kubectl apply -f "https://github.com/cert-manager/cert-manager/releases/download/$CERT_MANAGER_VERSION/cert-manager.yaml"
  kubectl -n cert-manager wait --for=condition=Available deploy --all --timeout=300s

  # 4. nginx-ingress — set the daemon hostPort to single-node-friendly
  #    values (no need for multiple replicas on a 1-VPS demo).
  log "installing ingress-nginx $INGRESS_NGINX_VERSION..."
  helm repo add ingress-nginx https://kubernetes.github.io/ingress-nginx >/dev/null
  helm repo update >/dev/null
  kubectl create namespace ingress-nginx --dry-run=client -o yaml | kubectl apply -f -
  helm upgrade --install ingress-nginx ingress-nginx/ingress-nginx \
    --namespace ingress-nginx \
    --version "$INGRESS_NGINX_VERSION" \
    --set controller.service.type=NodePort \
    --set controller.hostPort.enabled=true \
    --set controller.hostPort.ports.http=80 \
    --set controller.hostPort.ports.https=443 \
    --wait

  # 5. Print the kubeconfig + DNS reminder.
  log "k3s cluster is up."
  log "Next steps:"
  log "  1. Add a wildcard A record:  *.$HOSTNAME  -> <this VPS's public IP>"
  log "  2. (Optional) Add an A record: $HOSTNAME  -> <this VPS's public IP>"
  log "  3. Add DEMO_KUBECONFIG secret in GitHub repo settings:"
  log "     (copy from below)"
  echo
  echo "------ DEMO_KUBECONFIG (paste as GitHub secret, base64-encoded) ------"
  cat /etc/rancher/k3s/k3s.yaml | base64 -w0
  echo
  echo "------------------------------------------------------------------------"
  log "  4. Trigger the 'Deploy Demo' workflow with hostname=$HOSTNAME"
  log "  5. After it succeeds, visit https://$HOSTNAME/"
}

main "$@"
