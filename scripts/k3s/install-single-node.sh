#!/usr/bin/env bash
set -euo pipefail

# One-node k3s installer for production use.
# Default behavior:
# - install k3s server
# - disable bundled traefik (this project uses Caddy)
# - keep ServiceLB enabled so LoadBalancer Service works on single node

if [[ "${EUID}" -ne 0 ]]; then
  echo "Please run as root (or with sudo)."
  exit 1
fi

K3S_CHANNEL=${K3S_CHANNEL:-stable}
K3S_KUBECONFIG_MODE=${K3S_KUBECONFIG_MODE:-644}
K3S_DISABLE_TRAEFIK=${K3S_DISABLE_TRAEFIK:-true}
K3S_NODE_IP=${K3S_NODE_IP:-}

if ! command -v curl >/dev/null 2>&1; then
  echo "curl is required."
  exit 1
fi

echo "Checking host ports (80/443/6443)..."
ss -ltn | awk 'NR==1 || /:80 |:443 |:6443 / { print }' || true

if command -v k3s >/dev/null 2>&1; then
  echo "k3s is already installed, skipping installation."
else
  INSTALL_EXEC_ARGS=(server "--write-kubeconfig-mode" "${K3S_KUBECONFIG_MODE}")

  if [[ "${K3S_DISABLE_TRAEFIK}" == "true" ]]; then
    INSTALL_EXEC_ARGS+=("--disable" "traefik")
  fi

  if [[ -n "${K3S_NODE_IP}" ]]; then
    INSTALL_EXEC_ARGS+=("--tls-san" "${K3S_NODE_IP}")
  fi

  export INSTALL_K3S_CHANNEL="${K3S_CHANNEL}"
  export INSTALL_K3S_EXEC="${INSTALL_EXEC_ARGS[*]}"

  echo "Installing k3s..."
  curl -sfL https://get.k3s.io | sh -
fi

echo "Ensuring k3s service is running..."
systemctl enable --now k3s

export KUBECONFIG=/etc/rancher/k3s/k3s.yaml

echo "Waiting for node Ready..."
timeout 180 bash -c 'until kubectl get nodes >/dev/null 2>&1; do sleep 2; done'
kubectl wait --for=condition=Ready node --all --timeout=180s

echo "k3s installed successfully."
kubectl get nodes -o wide
kubectl get pods -A

echo ""
echo "Next step:"
echo "API_SERVER=https://<YOUR_SERVER_PUBLIC_IP>:6443 sudo bash scripts/k3s/export-kubeconfig-base64.sh"
