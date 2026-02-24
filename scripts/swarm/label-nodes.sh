#!/usr/bin/env bash
set -euo pipefail

# Usage:
# API_NODES="api-01,api-02,...,api-10" \
# DB_NODES="db-01,db-02,...,db-10" \
# bash scripts/swarm/label-nodes.sh

if ! command -v docker >/dev/null 2>&1; then
  echo "docker is required."
  exit 1
fi

if [[ "$(docker info --format '{{.Swarm.LocalNodeState}}' 2>/dev/null || true)" != "active" ]]; then
  echo "This node is not in an active swarm. Run scripts/swarm/init-manager.sh first."
  exit 1
fi

API_NODES=${API_NODES:-}
DB_NODES=${DB_NODES:-}

if [[ -z "${API_NODES}" || -z "${DB_NODES}" ]]; then
  echo "API_NODES and DB_NODES are required."
  echo "Example:"
  echo 'API_NODES="api-01,api-02,...,api-10" DB_NODES="db-01,db-02,...,db-10" bash scripts/swarm/label-nodes.sh'
  exit 1
fi

IFS=',' read -r -a API_ARRAY <<< "${API_NODES}"
IFS=',' read -r -a DB_ARRAY <<< "${DB_NODES}"

if [[ "${#API_ARRAY[@]}" -ne 10 ]]; then
  echo "API_NODES must contain exactly 10 nodes. Got: ${#API_ARRAY[@]}"
  exit 1
fi

if [[ "${#DB_ARRAY[@]}" -ne 10 ]]; then
  echo "DB_NODES must contain exactly 10 nodes. Got: ${#DB_ARRAY[@]}"
  exit 1
fi

for i in "${!API_ARRAY[@]}"; do
  node="${API_ARRAY[$i]}"
  slot=$((i + 1))
  echo "Labeling API node ${node} (api_slot=${slot})"
  docker node update --label-add tier=api --label-add api_slot="${slot}" "${node}"
done

for i in "${!DB_ARRAY[@]}"; do
  node="${DB_ARRAY[$i]}"
  slot=$((i + 1))
  echo "Labeling DB node ${node} (db_slot=${slot})"
  docker node update --label-add tier=db --label-add db_slot="${slot}" "${node}"
done

echo ""
echo "Done. Node labels:"
docker node inspect $(docker node ls -q) --format '{{.Description.Hostname}} => {{.Spec.Labels}}'
