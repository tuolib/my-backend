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

SERVICE_NAME=${SERVICE_NAME:-${RELEASE}-ho-stack-api-active}
BLUE_DEPLOYMENT=${BLUE_DEPLOYMENT:-${RELEASE}-ho-stack-api-blue}
GREEN_DEPLOYMENT=${GREEN_DEPLOYMENT:-${RELEASE}-ho-stack-api-green}
SECRET_NAME=${SECRET_NAME:-${RELEASE}-ho-stack-secrets}

run_migration_job() {
  if [[ "${RUN_MIGRATION}" != "true" ]]; then
    echo "Skipping migration (RUN_MIGRATION=false)"
    return
  fi

  SAFE_TAG=$(echo "${IMAGE_TAG}" | tr -c 'a-zA-Z0-9' '-' | cut -c1-30)
  JOB_NAME="${RELEASE}-migrate-${SAFE_TAG}"
  kubectl -n "${NAMESPACE}" delete job "${JOB_NAME}" --ignore-not-found=true

  cat <<YAML | kubectl -n "${NAMESPACE}" apply -f -
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

  kubectl -n "${NAMESPACE}" wait --for=condition=complete --timeout=300s job/"${JOB_NAME}" || {
    kubectl -n "${NAMESPACE}" logs job/"${JOB_NAME}" --tail=200 || true
    echo "Migration failed"
    exit 1
  }
}

kubectl create namespace "${NAMESPACE}" --dry-run=client -o yaml | kubectl apply -f -

if ! helm -n "${NAMESPACE}" status "${RELEASE}" >/dev/null 2>&1; then
  echo "Initial install"
  helm upgrade --install "${RELEASE}" "${CHART_PATH}" \
    -n "${NAMESPACE}" \
    -f "${VALUES_FILE}" \
    --set image.repository="${IMAGE_REPOSITORY}" \
    --set api.blue.image.tag="${IMAGE_TAG}" \
    --set api.green.image.tag="${IMAGE_TAG}" \
    --set api.activeColor=blue

  kubectl -n "${NAMESPACE}" rollout status deployment/"${BLUE_DEPLOYMENT}" --timeout=300s
  run_migration_job
  kubectl -n "${NAMESPACE}" rollout status deployment/"${RELEASE}"-ho-stack-caddy --timeout=300s
  echo "Initial install complete"
  exit 0
fi

helm upgrade --install "${RELEASE}" "${CHART_PATH}" \
  -n "${NAMESPACE}" \
  -f "${VALUES_FILE}" \
  --reuse-values \
  --set image.repository="${IMAGE_REPOSITORY}"

ACTIVE_COLOR=$(kubectl -n "${NAMESPACE}" get svc "${SERVICE_NAME}" -o jsonpath='{.spec.selector.color}' 2>/dev/null || true)
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

kubectl -n "${NAMESPACE}" set image deployment/"${NEXT_DEPLOYMENT}" api="${IMAGE_REPOSITORY}:${IMAGE_TAG}"
kubectl -n "${NAMESPACE}" scale deployment "${NEXT_DEPLOYMENT}" --replicas="${API_ACTIVE_REPLICAS}"
kubectl -n "${NAMESPACE}" rollout status deployment/"${NEXT_DEPLOYMENT}" --timeout=300s

run_migration_job

kubectl -n "${NAMESPACE}" patch svc "${SERVICE_NAME}" --type='json' -p="[{\"op\":\"replace\",\"path\":\"/spec/selector/color\",\"value\":\"${NEXT_COLOR}\"}]"
kubectl -n "${NAMESPACE}" scale deployment "${OLD_DEPLOYMENT}" --replicas="${API_STANDBY_REPLICAS}"

echo "Blue/green switch complete. Active color: ${NEXT_COLOR}"
