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
    # 优先检测全局 IPv6 地址（排除 link-local fe80::）
    ADVERTISE_ADDR=$(ip -6 addr show scope global | grep -oP '(?<=inet6\s)[0-9a-f:]+' | head -n1 || true)
    # 如果检测到 IPv6，用方括号包裹
    if [[ -n "${ADVERTISE_ADDR}" ]]; then
      ADVERTISE_ADDR="[${ADVERTISE_ADDR}]"
    else
      # 回退到 IPv4
      ADVERTISE_ADDR=$(hostname -I | awk '{print $1}')
    fi
  fi
  if [[ -z "${ADVERTISE_ADDR}" ]]; then
    echo "Cannot detect advertise address. Please set ADVERTISE_ADDR (IPv6 example: [2001:db8::1])."
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
