#!/usr/bin/env bash
set -euo pipefail

STACK_NAME=${STACK_NAME:-ho}

if ! command -v docker >/dev/null 2>&1; then
  echo "docker is required."
  exit 1
fi

echo "Removing stack ${STACK_NAME}..."
docker stack rm "${STACK_NAME}"

echo "Waiting for stack resources to be removed..."
for i in $(seq 1 60); do
  if [[ -z "$(docker stack ls --format '{{.Name}}' | grep -E "^${STACK_NAME}$" || true)" ]]; then
    echo "Stack ${STACK_NAME} removed."
    exit 0
  fi
  sleep 2
done

echo "Timed out waiting stack removal."
exit 1
