#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "$0")/../.." && pwd)
cd "${ROOT_DIR}"

DEPLOY_NAMESPACE=${DEPLOY_NAMESPACE:-ho}
DEPLOY_RELEASE=${DEPLOY_RELEASE:-ho}
DEPLOY_VALUES_FILE=${DEPLOY_VALUES_FILE:-./charts/ho-stack/values-prod.yaml}
DEPLOY_ACTIVE_REPLICAS=${DEPLOY_ACTIVE_REPLICAS:-4}
DEPLOY_STANDBY_REPLICAS=${DEPLOY_STANDBY_REPLICAS:-1}
DEPLOY_RUN_MIGRATION=${DEPLOY_RUN_MIGRATION:-true}
DEPLOY_REQUIRE_CLUSTER=${DEPLOY_REQUIRE_CLUSTER:-false}
DEPLOY_PUBLIC_HEALTHCHECK_URL=${DEPLOY_PUBLIC_HEALTHCHECK_URL:-}

IMAGE_REPOSITORY=${IMAGE_REPOSITORY:?IMAGE_REPOSITORY is required}
IMAGE_TAG=${IMAGE_TAG:?IMAGE_TAG is required}

if ! command -v helm >/dev/null 2>&1; then
  echo "helm is required."
  exit 1
fi

if command -v kubectl >/dev/null 2>&1; then
  declare -a KUBECTL_CMD=("kubectl")
elif command -v k3s >/dev/null 2>&1; then
  declare -a KUBECTL_CMD=("k3s" "kubectl")
else
  echo "kubectl (or k3s kubectl) is required."
  exit 1
fi

kctl() {
  "${KUBECTL_CMD[@]}" "$@"
}

if kctl --request-timeout=10s cluster-info >/dev/null 2>&1; then
  echo "Kubernetes cluster is reachable"
else
  if [[ "${DEPLOY_REQUIRE_CLUSTER}" == "true" ]]; then
    echo "No reachable Kubernetes cluster in this runner context."
    exit 1
  fi
  echo "No reachable Kubernetes cluster in this runner context; deployment will be skipped."
  exit 0
fi

export NAMESPACE="${DEPLOY_NAMESPACE}"
export RELEASE="${DEPLOY_RELEASE}"
export VALUES_FILE="${DEPLOY_VALUES_FILE}"
export API_ACTIVE_REPLICAS="${DEPLOY_ACTIVE_REPLICAS}"
export API_STANDBY_REPLICAS="${DEPLOY_STANDBY_REPLICAS}"
export RUN_MIGRATION="${DEPLOY_RUN_MIGRATION}"

bash scripts/deploy/bluegreen-k8s.sh

CADDY_SVC="${DEPLOY_RELEASE}-ho-stack-caddy"
kctl -n "${DEPLOY_NAMESPACE}" rollout status deployment/"${CADDY_SVC}" --timeout=180s

kctl -n "${DEPLOY_NAMESPACE}" port-forward svc/"${CADDY_SVC}" 18080:80 >/tmp/port-forward.log 2>&1 &
PF_PID=$!
trap 'kill ${PF_PID} >/dev/null 2>&1 || true' EXIT
sleep 3

for i in $(seq 1 20); do
  if curl -fsS --max-time 3 http://127.0.0.1:18080/ >/tmp/smoke-cluster.out; then
    echo "Cluster smoke test passed"
    break
  fi
  if [[ "${i}" -eq 20 ]]; then
    echo "Cluster smoke test failed"
    cat /tmp/port-forward.log || true
    exit 1
  fi
  sleep 3
done

if [[ -z "${DEPLOY_PUBLIC_HEALTHCHECK_URL}" ]]; then
  echo "DEPLOY_PUBLIC_HEALTHCHECK_URL is empty, skip public smoke test"
  exit 0
fi

for i in $(seq 1 30); do
  if curl -fsS --max-time 5 "${DEPLOY_PUBLIC_HEALTHCHECK_URL}" >/tmp/smoke-public.out; then
    echo "Public smoke test passed: ${DEPLOY_PUBLIC_HEALTHCHECK_URL}"
    exit 0
  fi
  sleep 5
done

echo "Public smoke test failed: ${DEPLOY_PUBLIC_HEALTHCHECK_URL}"
exit 1
