#!/usr/bin/env bash
set -euo pipefail

CLUSTER_NAME=${CLUSTER_NAME:-ho-local}
NAMESPACE=${NAMESPACE:-ho}
RELEASE=${RELEASE:-ho}
IMAGE_REPO=${IMAGE_REPO:-ho-api}
IMAGE_TAG=${IMAGE_TAG:-local}

kind create cluster --name "${CLUSTER_NAME}" --config "$(dirname "$0")/kind-config.yaml" || true

docker build -t "${IMAGE_REPO}:${IMAGE_TAG}" .
kind load docker-image "${IMAGE_REPO}:${IMAGE_TAG}" --name "${CLUSTER_NAME}"

kubectl create namespace "${NAMESPACE}" --dry-run=client -o yaml | kubectl apply -f -

helm upgrade --install "${RELEASE}" ./charts/ho-stack \
  -n "${NAMESPACE}" \
  -f ./charts/ho-stack/values-local.yaml \
  --set image.repository="${IMAGE_REPO}" \
  --set api.blue.image.tag="${IMAGE_TAG}" \
  --set api.green.image.tag="${IMAGE_TAG}"

kubectl -n "${NAMESPACE}" rollout status deployment/"${RELEASE}"-ho-stack-api-blue --timeout=180s
kubectl -n "${NAMESPACE}" rollout status deployment/"${RELEASE}"-ho-stack-caddy --timeout=180s

echo "Cluster ready: http://api.localtest.me"
