#!/usr/bin/env bash
set -euo pipefail

if ! command -v docker >/dev/null 2>&1; then
  echo "docker is required."
  exit 1
fi

if [[ "$(docker info --format '{{.Swarm.LocalNodeState}}' 2>/dev/null || true)" == "active" ]]; then
  echo "Swarm is already initialized on this node."
else
  ADVERTISE_ADDR=${ADVERTISE_ADDR:-}
  if [[ -z "${ADVERTISE_ADDR}" ]]; then
    # 优先 IPv4
    ADVERTISE_ADDR=$(hostname -I | awk '{print $1}' || true)
    # 回退到全局 IPv6（排除 link-local fe80::）
    if [[ -z "${ADVERTISE_ADDR}" ]]; then
      IPV6=$(ip -6 addr show scope global | grep -oP '(?<=inet6\s)[0-9a-f:]+' | head -n1 || true)
      [[ -n "${IPV6}" ]] && ADVERTISE_ADDR="[${IPV6}]"
    fi
  fi
  if [[ -z "${ADVERTISE_ADDR}" ]]; then
    echo "Cannot detect advertise address. Please set ADVERTISE_ADDR."
    exit 1
  fi
  echo "Initializing swarm manager at ${ADVERTISE_ADDR}..."
  docker swarm init --advertise-addr "${ADVERTISE_ADDR}"
fi

echo ""
echo "Manager join token:"
docker swarm join-token manager
echo ""
echo "Worker join token:"
docker swarm join-token worker
echo ""
echo "Nodes:"
docker node ls
