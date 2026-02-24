#!/usr/bin/env bash
set -euo pipefail

# Export a base64 kubeconfig for GitHub Actions secret KUBE_CONFIG_DATA.
# Usage:
#   API_SERVER=https://<server-ip>:6443 sudo bash scripts/k3s/export-kubeconfig-base64.sh

if [[ "${EUID}" -ne 0 ]]; then
  echo "Please run as root (or with sudo)."
  exit 1
fi

API_SERVER=${API_SERVER:-}
KUBECONFIG_PATH=${KUBECONFIG_PATH:-/etc/rancher/k3s/k3s.yaml}

if [[ -z "${API_SERVER}" ]]; then
  echo "API_SERVER is required, example:"
  echo "API_SERVER=https://1.2.3.4:6443 sudo bash scripts/k3s/export-kubeconfig-base64.sh"
  exit 1
fi

if [[ ! -f "${KUBECONFIG_PATH}" ]]; then
  echo "kubeconfig not found: ${KUBECONFIG_PATH}"
  exit 1
fi

tmp_file=$(mktemp)
trap 'rm -f "${tmp_file}"' EXIT

sed "s#https://127.0.0.1:6443#${API_SERVER}#g" "${KUBECONFIG_PATH}" > "${tmp_file}"
base64 < "${tmp_file}" | tr -d '\n'
echo ""
