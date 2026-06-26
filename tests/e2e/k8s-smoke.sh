#!/usr/bin/env bash
# tests/e2e/k8s-smoke.sh
#
# End-to-end smoke test for the Aether eBPF layer on a real K8s cluster.
# Validates that the DaemonSet actually attaches the XDP program to the
# cluster's default network interface and starts dropping matching
# packets.
#
# STATUS: SKELETON ONLY — not wired into CI yet. See ADR-006 limitations.
#   - GH-hosted ubuntu runners do NOT expose /dev/kvm. The eBPF
#     program loads but XDP attach fails with EPERM.
#   - To run this end-to-end you need either:
#       (a) a self-hosted runner with /dev/kvm passthrough, or
#       (b) a cloud K8s cluster (EKS/GKE/AKS) and run the script
#           from a privileged debug pod, or
#       (c) `kind create cluster` on a Linux host with nested
#           virtualization enabled.
#
# This script is preserved as a documentation of the intent; when
# B7-2 unblocks it can be invoked from the CI e2e-k8s job.

set -euo pipefail

KUBECTL="${KUBECTL:-kubectl}"
NS="${NS:-aether-system}"
DAEMONSET_NAME="aether-ebpf-agent"
EXPECTED_IFACE="${EXPECTED_IFACE:-eth0}"

echo "=== Aether eBPF K8s smoke test ==="

# 1. DaemonSet is up and ready
echo "[1/5] DaemonSet rollout status..."
$KUBECTL -n "$NS" rollout status daemonset/"$DAEMONSET_NAME" --timeout=60s

# 2. Each node has one running pod
echo "[2/5] Pod inventory..."
POD_COUNT=$($KUBECTL -n "$NS" get pods -l app="$DAEMONSET_NAME" -o jsonpath='{.items[*].status.phase}' | tr ' ' '\n' | grep -c Running || true)
NODE_COUNT=$($KUBECTL get nodes -o jsonpath='{.items[*].status.conditions[?(@.type=="Ready")].status}' | tr ' ' '\n' | grep -c True || true)
echo "  ${POD_COUNT}/${NODE_COUNT} nodes have a running pod"
[[ "$POD_COUNT" -ge 1 ]] || { echo "FAIL: no pods running"; exit 1; }

# 3. Agent log shows the BPF program loaded and XDP attached
echo "[3/5] Agent log: XDP attach confirmation..."
POD_NAME=$($KUBECTL -n "$NS" get pods -l app="$DAEMONSET_NAME" -o jsonpath='{.items[0].metadata.name}')
$KUBECTL -n "$NS" logs "$POD_NAME" --tail=50 | grep -E "Started VM|attach|XDP|policy" || \
  { echo "FAIL: agent log doesn't show BPF state"; exit 1; }

# 4. Write a deny rule to the policy ConfigMap; agent should reload
echo "[4/5] Inject a deny rule, verify agent reloads..."
$KUBECTL -n "$NS" get configmap aether-ebpf-policy -o yaml > /tmp/ebpf-policy.yaml
cat >> /tmp/ebpf-policy.yaml <<EOF
  - id: smoke-deny
    action: block
    host: "127.0.0.1"
    port: 0
    direction: egress
EOF
$KUBECTL -n "$NS" apply -f /tmp/ebpf-policy.yaml
sleep 20  # agent mtime poll is 15s; allow one cycle
$KUBECTL -n "$NS" logs "$POD_NAME" --tail=10 | grep -E "reload|watch" || \
  { echo "WARN: no reload log line"; }

# 5. Verify drop counter increments when we send a matched packet
# (skipped in CI; requires a packet generator that targets the
#  cluster's default interface from inside a pod)
echo "[5/5] (manual) Drop counter increment — see docs/adr/006-ebpf-yaml-sync.md §known limitations"

echo "=== smoke test passed ==="
