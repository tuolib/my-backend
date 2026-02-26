#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "$0")/../.." && pwd)
cd "${ROOT_DIR}"

if ! command -v docker >/dev/null 2>&1; then
  echo "docker is required."
  exit 1
fi

if [[ "$(docker info --format '{{.Swarm.LocalNodeState}}' 2>/dev/null || true)" != "active" ]]; then
  echo "This node is not in an active swarm. Run scripts/swarm/init-manager.sh first."
  exit 1
fi

if ! docker node ls >/dev/null 2>&1; then
  echo "This command must run on a swarm manager."
  exit 1
fi

ENV_FILE=${ENV_FILE:-swarm/.env.swarm}
if [[ -f "${ENV_FILE}" ]]; then
  echo "Loading env from ${ENV_FILE}"
  # shellcheck disable=SC1090
  set -a && source "${ENV_FILE}" && set +a
else
  echo "No ${ENV_FILE} found, using defaults from swarm/.env.example"
  # shellcheck disable=SC1091
  set -a && source swarm/.env.example && set +a
fi

STACK_NAME=${STACK_NAME:-ho}
IMAGE_REPOSITORY=${IMAGE_REPOSITORY:-ghcr.io/your-org/ho-api}
IMAGE_TAG=${IMAGE_TAG:-latest}
API_REPLICAS=${API_REPLICAS:-}
API_REPLICAS_SINGLE=${API_REPLICAS_SINGLE:-2}
API_REPLICAS_MULTI=${API_REPLICAS_MULTI:-10}
RUN_MIGRATION=${RUN_MIGRATION:-true}
DEPLOY_MODE=${DEPLOY_MODE:-auto}

if [[ "${DEPLOY_MODE}" != "auto" && "${DEPLOY_MODE}" != "single" && "${DEPLOY_MODE}" != "multi" ]]; then
  echo "DEPLOY_MODE must be one of: auto|single|multi"
  exit 1
fi

NODE_COUNT=$(docker node ls -q | wc -l | tr -d ' ')
if [[ -z "${NODE_COUNT}" ]]; then
  echo "Failed to detect swarm node count."
  exit 1
fi

ACTIVE_API_NODE_COUNT=$(docker node ls \
  --filter "node.label=tier=api" \
  --filter "node-status=ready" \
  --format '{{.ID}}' | wc -l | tr -d ' ')
ACTIVE_DB_NODE_COUNT=$(docker node ls \
  --filter "node.label=tier=db" \
  --filter "node-status=ready" \
  --format '{{.ID}}' | wc -l | tr -d ' ')
READY_DB_SLOTS=$(docker node ls \
  --filter "node.label=tier=db" \
  --filter "node-status=ready" \
  --format '{{.Hostname}} {{.ID}}' \
  | while read -r _host node_id; do
      docker node inspect "${node_id}" --format '{{ index .Spec.Labels "db_slot" }}' 2>/dev/null || true
    done \
  | grep -E '^[0-9]+$' \
  | sort -n \
  | uniq \
  | paste -sd',' -)

MISSING_DB_SLOTS=""
for slot in 1 2 3 4 5 6 7 8 9 10; do
  if [[ ",${READY_DB_SLOTS}," != *",${slot},"* ]]; then
    if [[ -z "${MISSING_DB_SLOTS}" ]]; then
      MISSING_DB_SLOTS="${slot}"
    else
      MISSING_DB_SLOTS="${MISSING_DB_SLOTS},${slot}"
    fi
  fi
done

STACK_FILE=swarm/stack.yml
SELECTED_MODE=multi

if [[ "${DEPLOY_MODE}" == "single" ]]; then
  STACK_FILE=swarm/stack-single.yml
  SELECTED_MODE=single
elif [[ "${DEPLOY_MODE}" == "auto" ]]; then
  # Auto mode should choose stack by schedulable capacity, not raw swarm size.
  if [[ "${ACTIVE_API_NODE_COUNT}" -le 1 || -n "${MISSING_DB_SLOTS}" ]]; then
    STACK_FILE=swarm/stack-single.yml
    SELECTED_MODE=single
  fi
fi

if [[ ! -f "${STACK_FILE}" ]]; then
  echo "Stack file not found: ${STACK_FILE}"
  exit 1
fi

if [[ -z "${API_REPLICAS}" ]]; then
  if [[ "${SELECTED_MODE}" == "single" ]]; then
    API_REPLICAS="${API_REPLICAS_SINGLE}"
  else
    API_REPLICAS="${API_REPLICAS_MULTI}"
  fi
fi

if [[ "${SELECTED_MODE}" == "multi" ]]; then
  if [[ "${ACTIVE_API_NODE_COUNT}" -eq 0 ]]; then
    echo "No ready swarm nodes with label tier=api; multi stack cannot schedule api service."
    echo "Tip: label at least one ready node with: docker node update --label-add tier=api <node>"
    exit 1
  fi
  if [[ -n "${MISSING_DB_SLOTS}" ]]; then
    echo "Multi stack requires db_slot=1..10, but missing ready slots: ${MISSING_DB_SLOTS}"
    echo "Tip: either add db nodes/labels, or set DEPLOY_MODE=single for current cluster size."
    exit 1
  fi
  if [[ "${API_REPLICAS}" -gt "${ACTIVE_API_NODE_COUNT}" ]]; then
    echo "Capping API replicas from ${API_REPLICAS} to ${ACTIVE_API_NODE_COUNT} because max_replicas_per_node=1 in swarm/stack.yml"
    API_REPLICAS="${ACTIVE_API_NODE_COUNT}"
  fi
fi
export API_REPLICAS

echo "Deploying stack ${STACK_NAME} with image ${IMAGE_REPOSITORY}:${IMAGE_TAG}"
echo "Swarm nodes: ${NODE_COUNT}, ready api nodes: ${ACTIVE_API_NODE_COUNT}, ready db nodes: ${ACTIVE_DB_NODE_COUNT}"
echo "Ready db slots: ${READY_DB_SLOTS:-none}"
echo "Deploy mode: ${SELECTED_MODE}, stack file: ${STACK_FILE}, api replicas: ${API_REPLICAS}"

# Docker Swarm configs are immutable — content changes require new names.
# Hash each config file so changed content gets a new config name automatically.
config_hash() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | cut -c1-12
  else
    shasum -a 256 "$1" | cut -c1-12
  fi
}

export CADDYFILE_HASH=$(config_hash "swarm/caddy/Caddyfile")
export POSTGRES_PRIMARY_INIT_HASH=$(config_hash "sim/postgres/primary-init.sh")
export POSTGRES_REPLICA_SETUP_HASH=$(config_hash "sim/postgres/replica-setup.sh")
if [[ "${SELECTED_MODE}" == "single" ]]; then
  export HAPROXY_RO_SINGLE_CFG_HASH=$(config_hash "swarm/haproxy/haproxy-ro-single.cfg")
else
  export HAPROXY_RO_CFG_HASH=$(config_hash "swarm/haproxy/haproxy-ro.cfg")
fi
echo "Config hashes: caddy=${CADDYFILE_HASH} pg-init=${POSTGRES_PRIMARY_INIT_HASH} pg-replica=${POSTGRES_REPLICA_SETUP_HASH}"

docker stack deploy -c "${STACK_FILE}" --with-registry-auth "${STACK_NAME}"

wait_service() {
  local service="$1"
  local timeout="${2:-600}"
  local elapsed=0

  while [[ ${elapsed} -lt ${timeout} ]]; do
    local replicas
    replicas=$(docker service ls --filter "name=${service}" --format '{{.Replicas}}' | head -n1 || true)
    if [[ -n "${replicas}" ]]; then
      local ready desired
      ready="${replicas%%/*}"
      desired="${replicas##*/}"
      if [[ "${ready}" == "${desired}" ]]; then
        echo "Service ${service} is ready (${replicas})"
        return 0
      fi
      echo "Waiting ${service}: ${replicas}"
      if [[ "${ready}" == "0" && "${desired}" != "0" ]]; then
        local scheduling_issue
        scheduling_issue=$(docker service ps "${service}" --no-trunc --format '{{.CurrentState}} | {{.Error}}' 2>/dev/null \
          | grep -Eim1 'no suitable node|insufficient|not available|rejected|pending' || true)
        if [[ -n "${scheduling_issue}" ]]; then
          echo "Scheduling issue detected for ${service}: ${scheduling_issue}"
        fi
      fi
    else
      echo "Waiting ${service}: service not found yet"
    fi
    sleep 5
    elapsed=$((elapsed + 5))
  done

  echo "Timeout waiting for ${service}"
  docker service ps "${service}" || true
  exit 1
}

wait_service "${STACK_NAME}_postgres-primary" 600
wait_service "${STACK_NAME}_pgbouncer-rw" 300
wait_service "${STACK_NAME}_pgbouncer-ro" 300
wait_service "${STACK_NAME}_redis" 300
wait_service "${STACK_NAME}_api" 900
wait_service "${STACK_NAME}_caddy" 300

if [[ "${RUN_MIGRATION}" == "true" ]]; then
  echo "Running migrations..."
  docker run --rm \
    --network "${STACK_NAME}_backend" \
    -e DATABASE_WRITE_URL="postgres://${POSTGRES_USER:-user}:${POSTGRES_PASSWORD:-password}@pgbouncer-rw:5432/${POSTGRES_DB:-mydb}" \
    -e DATABASE_READ_URL="postgres://${POSTGRES_USER:-user}:${POSTGRES_PASSWORD:-password}@pgbouncer-ro:5432/${POSTGRES_DB:-mydb}" \
    -e REDIS_URL="redis://redis:6379" \
    -e JWT_SECRET="${JWT_SECRET:-change-me-in-prod}" \
    -e DB_POOL_MAX="${DB_POOL_MAX:-5}" \
    -e DB_STRICT_READ_READINESS="${DB_STRICT_READ_READINESS:-false}" \
    "${IMAGE_REPOSITORY}:${IMAGE_TAG}" \
    bun run migrate
fi

# Clean up orphaned versioned configs from previous deployments
cleanup_old_configs() {
  local prefix="$1" current_name="$2"
  docker config ls --format '{{.Name}}' 2>/dev/null | while read -r name; do
    if [[ "${name}" == ${prefix}-* && "${name}" != "${current_name}" ]]; then
      echo "Removing old config: ${name}"
      docker config rm "${name}" 2>/dev/null || true
    fi
  done
}

cleanup_old_configs "caddyfile" "caddyfile-${CADDYFILE_HASH}"
cleanup_old_configs "postgres_primary_init" "postgres_primary_init-${POSTGRES_PRIMARY_INIT_HASH}"
cleanup_old_configs "postgres_replica_setup" "postgres_replica_setup-${POSTGRES_REPLICA_SETUP_HASH}"
if [[ "${SELECTED_MODE}" == "single" ]]; then
  cleanup_old_configs "haproxy_ro_single_cfg" "haproxy_ro_single_cfg-${HAPROXY_RO_SINGLE_CFG_HASH}"
else
  cleanup_old_configs "haproxy_ro_cfg" "haproxy_ro_cfg-${HAPROXY_RO_CFG_HASH}"
fi

echo ""
echo "Stack services:"
docker stack services "${STACK_NAME}"
echo ""
echo "Published ports:"
docker service inspect "${STACK_NAME}_caddy" --format '{{json .Endpoint.Ports}}'
