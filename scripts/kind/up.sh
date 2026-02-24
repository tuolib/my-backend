#!/usr/bin/env bash
set -euo pipefail

CLUSTER_NAME=${CLUSTER_NAME:-ho-local}
NAMESPACE=${NAMESPACE:-ho}
RELEASE=${RELEASE:-ho}
IMAGE_REPO=${IMAGE_REPO:-ho-api}
IMAGE_TAG=${IMAGE_TAG:-local}

# 如果集群已存在则跳过创建（||true），不影响后续步骤
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

# ────────────────────────────────────────────────────────────────────────────
# 按依赖顺序等待各服务就绪。
#
# 根本原因：API 的 /readyz 探针必须同时连通 PgBouncer（→ PostgreSQL）和 Redis，
# 若直接等待 API，而 PostgreSQL 尚未完成 init 脚本 + 主从同步，探针会一直失败，
# 导致 rollout 超时。正确做法是先等底层服务，再等上层服务。
# ────────────────────────────────────────────────────────────────────────────

echo "⏳ [1/6] Waiting for PostgreSQL primary (init scripts + WAL setup ~90s)..."
kubectl -n "${NAMESPACE}" rollout status statefulset/"${RELEASE}"-ho-stack-postgres-primary --timeout=300s

echo "⏳ [2/6] Waiting for PostgreSQL replica (streaming replication sync)..."
kubectl -n "${NAMESPACE}" rollout status statefulset/"${RELEASE}"-ho-stack-postgres-replica --timeout=180s

echo "⏳ [3/6] Waiting for Redis..."
kubectl -n "${NAMESPACE}" rollout status statefulset/"${RELEASE}"-ho-stack-redis --timeout=120s

echo "⏳ [4/6] Waiting for PgBouncer (depends on PostgreSQL)..."
kubectl -n "${NAMESPACE}" rollout status deployment/"${RELEASE}"-ho-stack-pgbouncer-rw --timeout=120s
kubectl -n "${NAMESPACE}" rollout status deployment/"${RELEASE}"-ho-stack-pgbouncer-ro --timeout=120s

echo "⏳ [5/6] Waiting for API (all dependencies ready, /readyz should pass quickly)..."
kubectl -n "${NAMESPACE}" rollout status deployment/"${RELEASE}"-ho-stack-api-blue --timeout=180s

echo "⏳ [6/6] Waiting for Caddy..."
kubectl -n "${NAMESPACE}" rollout status deployment/"${RELEASE}"-ho-stack-caddy --timeout=60s

echo ""
echo "✅ Cluster ready!"
echo "   API:     http://localhost:3000/api/v1"
echo "   Health:  http://localhost:3000/healthz"
echo "   Ready:   http://localhost:3000/readyz"
echo ""
echo "   Tip: 端口 3000 → kind NodePort 30080 → Caddy → API"
echo "   如需重建集群（端口配置变更），请先运行: bun run k8s:kind:down"
