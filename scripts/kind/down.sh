#!/usr/bin/env bash
set -euo pipefail

CLUSTER_NAME=${CLUSTER_NAME:-ho-local}
kind delete cluster --name "${CLUSTER_NAME}"
