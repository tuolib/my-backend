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

STACK_FILE=swarm/stack.yml
SELECTED_MODE=multi

if [[ "${DEPLOY_MODE}" == "single" ]]; then
  STACK_FILE=swarm/stack-single.yml
  SELECTED_MODE=single
elif [[ "${DEPLOY_MODE}" == "auto" ]]; then
  if [[ "${NODE_COUNT}" -le 1 ]]; then
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
export API_REPLICAS

echo "Deploying stack ${STACK_NAME} with image ${IMAGE_REPOSITORY}:${IMAGE_TAG}"
echo "Swarm nodes: ${NODE_COUNT}, deploy mode: ${SELECTED_MODE}, stack file: ${STACK_FILE}, api replicas: ${API_REPLICAS}"
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

echo ""
echo "Stack services:"
docker stack services "${STACK_NAME}"
echo ""
echo "Published ports:"
docker service inspect "${STACK_NAME}_caddy" --format '{{json .Endpoint.Ports}}'
