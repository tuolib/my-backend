#!/usr/bin/env bash
set -euo pipefail

NAMESPACE=${NAMESPACE:-ho}
RELEASE=${RELEASE:-ho}
CHART_PATH=${CHART_PATH:-./charts/ho-stack}
VALUES_FILE=${VALUES_FILE:-./charts/ho-stack/values-prod.yaml}
IMAGE_REPOSITORY=${IMAGE_REPOSITORY:?IMAGE_REPOSITORY is required}
IMAGE_TAG=${IMAGE_TAG:?IMAGE_TAG is required}
API_ACTIVE_REPLICAS=${API_ACTIVE_REPLICAS:-4}
API_STANDBY_REPLICAS=${API_STANDBY_REPLICAS:-1}
RUN_MIGRATION=${RUN_MIGRATION:-true}
LB_INGRESS_WAIT_SECONDS=${LB_INGRESS_WAIT_SECONDS:-300}
AUTO_INSTALL_KUBECTL=${AUTO_INSTALL_KUBECTL:-true}
KUBECTL_VERSION=${KUBECTL_VERSION:-}
KUBECTL_INSTALL_METHOD=${KUBECTL_INSTALL_METHOD:-auto}

SERVICE_NAME=${SERVICE_NAME:-${RELEASE}-ho-stack-api-active}
BLUE_DEPLOYMENT=${BLUE_DEPLOYMENT:-${RELEASE}-ho-stack-api-blue}
GREEN_DEPLOYMENT=${GREEN_DEPLOYMENT:-${RELEASE}-ho-stack-api-green}
SECRET_NAME=${SECRET_NAME:-${RELEASE}-ho-stack-secrets}
API_LABEL_SELECTOR=${API_LABEL_SELECTOR:-app.kubernetes.io/instance=${RELEASE},component=api}
CADDY_DEPLOYMENT=${CADDY_DEPLOYMENT:-${RELEASE}-ho-stack-caddy}
CADDY_SERVICE=${CADDY_SERVICE:-${RELEASE}-ho-stack-caddy}
declare -a KUBECTL_CMD=("kubectl")

run_privileged() {
  if [[ "${EUID}" -eq 0 ]]; then
    "$@"
  elif command -v sudo >/dev/null 2>&1; then
    sudo "$@"
  else
    return 1
  fi
}

install_kubectl_via_pkg() {
  if command -v apt-get >/dev/null 2>&1; then
    run_privileged apt-get update
    run_privileged env DEBIAN_FRONTEND=noninteractive apt-get install -y kubectl \
      || run_privileged env DEBIAN_FRONTEND=noninteractive apt-get install -y kubernetes-client
    return 0
  fi
  if command -v dnf >/dev/null 2>&1; then
    run_privileged dnf install -y kubectl
    return 0
  fi
  if command -v yum >/dev/null 2>&1; then
    run_privileged yum install -y kubectl
    return 0
  fi
  if command -v apk >/dev/null 2>&1; then
    run_privileged apk add --no-cache kubectl
    return 0
  fi
  return 1
}

install_kubectl_binary() {
  local os arch version tmp_file
  os=$(uname -s | tr '[:upper:]' '[:lower:]')
  arch=$(uname -m)
  case "${arch}" in
    x86_64 | amd64) arch="amd64" ;;
    aarch64 | arm64) arch="arm64" ;;
    armv7l) arch="arm" ;;
    *)
      echo "Unsupported architecture for kubectl auto-install: ${arch}"
      return 1
      ;;
  esac

  version="${KUBECTL_VERSION}"
  if [[ -z "${version}" ]]; then
    version=$(curl -fsSL https://dl.k8s.io/release/stable.txt)
  fi

  tmp_file=$(mktemp)
  curl -fsSL -o "${tmp_file}" "https://dl.k8s.io/release/${version}/bin/${os}/${arch}/kubectl"
  run_privileged install -m 0755 "${tmp_file}" /usr/local/bin/kubectl
  rm -f "${tmp_file}"
}

ensure_kubectl() {
  if command -v kubectl >/dev/null 2>&1; then
    KUBECTL_CMD=("kubectl")
    return
  fi

  if command -v k3s >/dev/null 2>&1; then
    KUBECTL_CMD=("k3s" "kubectl")
    echo "kubectl not found, using k3s built-in kubectl"
    return
  fi

  if [[ "${AUTO_INSTALL_KUBECTL}" != "true" ]]; then
    echo "kubectl is required but not installed (AUTO_INSTALL_KUBECTL=false)"
    exit 1
  fi

  echo "kubectl not found, installing..."
  if [[ "${KUBECTL_INSTALL_METHOD}" == "package" || "${KUBECTL_INSTALL_METHOD}" == "auto" ]]; then
    install_kubectl_via_pkg || true
  fi
  if ! command -v kubectl >/dev/null 2>&1; then
    install_kubectl_binary
  fi
  if ! command -v kubectl >/dev/null 2>&1; then
    echo "Failed to install kubectl automatically"
    exit 1
  fi
  KUBECTL_CMD=("kubectl")
}

kctl() {
  "${KUBECTL_CMD[@]}" "$@"
}

run_migration_job() {
  if [[ "${RUN_MIGRATION}" != "true" ]]; then
    echo "Skipping migration (RUN_MIGRATION=false)"
    return
  fi

  SAFE_TAG=$(echo "${IMAGE_TAG}" | tr -c 'a-zA-Z0-9' '-' | cut -c1-30)
  JOB_NAME="${RELEASE}-migrate-${SAFE_TAG}"
  kctl -n "${NAMESPACE}" delete job "${JOB_NAME}" --ignore-not-found=true

  cat <<YAML | kctl -n "${NAMESPACE}" apply -f -
apiVersion: batch/v1
kind: Job
metadata:
  name: ${JOB_NAME}
spec:
  backoffLimit: 1
  ttlSecondsAfterFinished: 600
  template:
    spec:
      restartPolicy: Never
      containers:
        - name: migrate
          image: ${IMAGE_REPOSITORY}:${IMAGE_TAG}
          command: ["bun", "run", "migrate"]
          envFrom:
            - secretRef:
                name: ${SECRET_NAME}
YAML

  kctl -n "${NAMESPACE}" wait --for=condition=complete --timeout=300s job/"${JOB_NAME}" || {
    kctl -n "${NAMESPACE}" logs job/"${JOB_NAME}" --tail=200 || true
    echo "Migration failed"
    exit 1
  }
}

collect_api_diagnostics() {
  echo "===== API diagnostics ====="
  kctl -n "${NAMESPACE}" get deploy "${BLUE_DEPLOYMENT}" "${GREEN_DEPLOYMENT}" -o wide || true
  kctl -n "${NAMESPACE}" get pods -l "${API_LABEL_SELECTOR}" -o wide || true
  kctl -n "${NAMESPACE}" get svc "${SERVICE_NAME}" -o wide || true
  kctl -n "${NAMESPACE}" get endpoints "${SERVICE_NAME}" -o wide || true
  kctl -n "${NAMESPACE}" get deploy "${CADDY_DEPLOYMENT}" -o wide || true
  kctl -n "${NAMESPACE}" get svc "${CADDY_SERVICE}" -o wide || true
}

assert_service_has_endpoints() {
  local svc_name=$1
  local endpoint_ips
  endpoint_ips=$(kctl -n "${NAMESPACE}" get endpoints "${svc_name}" -o jsonpath='{range .subsets[*].addresses[*]}{.ip}{" "}{end}' 2>/dev/null || true)
  if [[ -z "${endpoint_ips}" ]]; then
    echo "No ready endpoints found for service: ${svc_name}"
    collect_api_diagnostics
    exit 1
  fi
  echo "Service ${svc_name} endpoints: ${endpoint_ips}"
}

assert_caddy_service_exposed() {
  local svc_type
  svc_type=$(kctl -n "${NAMESPACE}" get svc "${CADDY_SERVICE}" -o jsonpath='{.spec.type}' 2>/dev/null || true)
  if [[ "${svc_type}" != "LoadBalancer" ]]; then
    echo "Caddy service type is ${svc_type:-unknown}, skip LoadBalancer ingress check"
    return
  fi

  local elapsed=0
  local ingress
  while [[ ${elapsed} -lt ${LB_INGRESS_WAIT_SECONDS} ]]; do
    ingress=$(kctl -n "${NAMESPACE}" get svc "${CADDY_SERVICE}" -o jsonpath='{.status.loadBalancer.ingress[0].ip}{.status.loadBalancer.ingress[0].hostname}' 2>/dev/null || true)
    if [[ -n "${ingress}" ]]; then
      echo "Caddy LoadBalancer ingress: ${ingress}"
      return
    fi
    sleep 5
    elapsed=$((elapsed + 5))
  done

  echo "Caddy LoadBalancer ingress not assigned within ${LB_INGRESS_WAIT_SECONDS}s"
  collect_api_diagnostics
  exit 1
}

ensure_kubectl

kctl create namespace "${NAMESPACE}" --dry-run=client -o yaml | kctl apply -f -

if ! helm -n "${NAMESPACE}" status "${RELEASE}" >/dev/null 2>&1; then
  echo "Initial install"
  helm upgrade --install "${RELEASE}" "${CHART_PATH}" \
    -n "${NAMESPACE}" \
    -f "${VALUES_FILE}" \
    --set image.repository="${IMAGE_REPOSITORY}" \
    --set api.blue.image.tag="${IMAGE_TAG}" \
    --set api.green.image.tag="${IMAGE_TAG}" \
    --set api.activeColor=blue

  kctl -n "${NAMESPACE}" rollout status deployment/"${BLUE_DEPLOYMENT}" --timeout=300s
  run_migration_job
  kctl -n "${NAMESPACE}" rollout status deployment/"${CADDY_DEPLOYMENT}" --timeout=300s
  assert_service_has_endpoints "${SERVICE_NAME}"
  assert_caddy_service_exposed
  echo "Initial install complete"
  exit 0
fi

helm upgrade --install "${RELEASE}" "${CHART_PATH}" \
  -n "${NAMESPACE}" \
  -f "${VALUES_FILE}" \
  --reuse-values \
  --set image.repository="${IMAGE_REPOSITORY}"

ACTIVE_COLOR=$(kctl -n "${NAMESPACE}" get svc "${SERVICE_NAME}" -o jsonpath='{.spec.selector.color}' 2>/dev/null || true)
if [[ "${ACTIVE_COLOR}" != "blue" && "${ACTIVE_COLOR}" != "green" ]]; then
  ACTIVE_COLOR=blue
fi

if [[ "${ACTIVE_COLOR}" == "blue" ]]; then
  NEXT_COLOR=green
  OLD_DEPLOYMENT="${BLUE_DEPLOYMENT}"
  NEXT_DEPLOYMENT="${GREEN_DEPLOYMENT}"
else
  NEXT_COLOR=blue
  OLD_DEPLOYMENT="${GREEN_DEPLOYMENT}"
  NEXT_DEPLOYMENT="${BLUE_DEPLOYMENT}"
fi

echo "Active color: ${ACTIVE_COLOR}, deploying: ${NEXT_COLOR}"

kctl -n "${NAMESPACE}" set image deployment/"${NEXT_DEPLOYMENT}" api="${IMAGE_REPOSITORY}:${IMAGE_TAG}"
kctl -n "${NAMESPACE}" scale deployment "${NEXT_DEPLOYMENT}" --replicas="${API_ACTIVE_REPLICAS}"
kctl -n "${NAMESPACE}" rollout status deployment/"${NEXT_DEPLOYMENT}" --timeout=300s

run_migration_job

kctl -n "${NAMESPACE}" patch svc "${SERVICE_NAME}" --type='json' -p="[{\"op\":\"replace\",\"path\":\"/spec/selector/color\",\"value\":\"${NEXT_COLOR}\"}]"
kctl -n "${NAMESPACE}" scale deployment "${OLD_DEPLOYMENT}" --replicas="${API_STANDBY_REPLICAS}"
assert_service_has_endpoints "${SERVICE_NAME}"
kctl -n "${NAMESPACE}" rollout status deployment/"${CADDY_DEPLOYMENT}" --timeout=180s
assert_caddy_service_exposed

echo "Blue/green switch complete. Active color: ${NEXT_COLOR}"
