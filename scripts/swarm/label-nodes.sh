#!/usr/bin/env bash
# label-nodes.sh — 为 Swarm 节点打 tier / slot 标签
#
# 用法（灵活节点数）：
#   API_NODES="node-1,node-2,node-3" DB_NODES="node-4,node-5" bash scripts/swarm/label-nodes.sh
#
# 单节点（同时兼任 api 和 db）：
#   SINGLE_NODE=true bash scripts/swarm/label-nodes.sh
#
# 清除节点标签（用于重新规划）：
#   CLEAN=true bash scripts/swarm/label-nodes.sh
set -euo pipefail

# ─── 前置检查 ─────────────────────────────────────────────────────────────────
command -v docker >/dev/null || { echo "docker is required."; exit 1; }

if [[ "$(docker info --format '{{.Swarm.LocalNodeState}}' 2>/dev/null || true)" != "active" ]]; then
  echo "This node is not in an active Swarm. Run scripts/swarm/init-manager.sh first."
  exit 1
fi

docker node ls >/dev/null 2>&1 || { echo "Must run on a Swarm manager."; exit 1; }

# ─── 单节点快捷模式 ───────────────────────────────────────────────────────────
SINGLE_NODE="${SINGLE_NODE:-false}"
if [[ "${SINGLE_NODE}" == "true" ]]; then
  SELF=$(docker node inspect self --format '{{.Description.Hostname}}')
  echo "Single-node mode: labeling ${SELF} as both api (slot=1) and db (slot=1)"
  docker node update \
    --label-add tier=api \
    --label-add api_slot=1 \
    --label-add tier=db \
    --label-add db_slot=1 \
    "${SELF}"
  echo "Done."
  docker node inspect "${SELF}" --format '{{.Description.Hostname}} => {{.Spec.Labels}}'
  exit 0
fi

# ─── 清除模式 ─────────────────────────────────────────────────────────────────
CLEAN="${CLEAN:-false}"
if [[ "${CLEAN}" == "true" ]]; then
  echo "Removing tier/slot labels from all nodes..."
  while IFS= read -r node; do
    # 忽略 remove 失败（标签可能不存在）
    docker node update \
      --label-rm tier \
      --label-rm api_slot \
      --label-rm db_slot \
      "${node}" 2>/dev/null || true
    echo "  Cleared: ${node}"
  done < <(docker node ls -q)
  echo "Done."
  exit 0
fi

# ─── 多节点批量打标签 ─────────────────────────────────────────────────────────
API_NODES="${API_NODES:-}"
DB_NODES="${DB_NODES:-}"

if [[ -z "${API_NODES}" || -z "${DB_NODES}" ]]; then
  echo "Error: API_NODES and DB_NODES are required."
  echo ""
  echo "Usage:"
  echo '  API_NODES="node-1,node-2" DB_NODES="node-3,node-4" bash scripts/swarm/label-nodes.sh'
  echo ""
  echo "Single-node shortcut:"
  echo '  SINGLE_NODE=true bash scripts/swarm/label-nodes.sh'
  echo ""
  echo "Clear all labels:"
  echo '  CLEAN=true bash scripts/swarm/label-nodes.sh'
  exit 1
fi

IFS=',' read -r -a API_ARRAY <<< "${API_NODES}"
IFS=',' read -r -a DB_ARRAY  <<< "${DB_NODES}"

# 节点数警告（无硬性限制）
if [[ "${#API_ARRAY[@]}" -lt 1 ]]; then
  echo "Error: API_NODES must have at least 1 node."
  exit 1
fi
if [[ "${#DB_ARRAY[@]}" -lt 1 ]]; then
  echo "Error: DB_NODES must have at least 1 node."
  exit 1
fi

if [[ "${#DB_ARRAY[@]}" -lt 2 ]]; then
  echo "Warning: Only 1 DB node — no read replica will be scheduled."
fi

echo "Labeling ${#API_ARRAY[@]} API node(s) and ${#DB_ARRAY[@]} DB node(s)..."

for i in "${!API_ARRAY[@]}"; do
  node="${API_ARRAY[$i]}"
  slot=$((i + 1))
  echo "  API node ${node}  →  tier=api  api_slot=${slot}"
  docker node update --label-add tier=api --label-add api_slot="${slot}" "${node}"
done

for i in "${!DB_ARRAY[@]}"; do
  node="${DB_ARRAY[$i]}"
  slot=$((i + 1))
  echo "  DB  node ${node}  →  tier=db   db_slot=${slot}"
  docker node update --label-add tier=db --label-add db_slot="${slot}" "${node}"
done

echo ""
echo "Done. Node labels:"
docker node inspect $(docker node ls -q) \
  --format '{{.Description.Hostname}}  =>  {{.Spec.Labels}}' 2>/dev/null || true
