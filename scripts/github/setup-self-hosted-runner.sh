#!/usr/bin/env bash
set -euo pipefail

# One-shot setup for GitHub self-hosted runner on a Swarm manager machine.
#
# Required:
#   GITHUB_REPOSITORY=owner/repo
# Optional:
#   RUNNER_TOKEN=<registration-token>
#   GH_TOKEN=<github-token with repo admin permission>  # used to fetch RUNNER_TOKEN automatically
#   RUNNER_NAME=<custom-runner-name>
#   RUNNER_LABELS=self-hosted,linux,swarm-manager
#   RUNNER_DIR=/opt/actions-runner
#   RUNNER_VERSION=2.327.1

GITHUB_REPOSITORY=${GITHUB_REPOSITORY:-}
RUNNER_TOKEN=${RUNNER_TOKEN:-}
GH_TOKEN=${GH_TOKEN:-}
RUNNER_NAME=${RUNNER_NAME:-"$(hostname)-swarm-manager"}
RUNNER_LABELS=${RUNNER_LABELS:-"self-hosted,linux,swarm-manager"}
RUNNER_DIR=${RUNNER_DIR:-/opt/actions-runner}
RUNNER_VERSION=${RUNNER_VERSION:-2.327.1}

if [[ -z "${GITHUB_REPOSITORY}" ]]; then
  echo "GITHUB_REPOSITORY is required (example: owner/repo)."
  exit 1
fi

if [[ "$(uname -s)" != "Linux" ]]; then
  echo "This script currently supports Linux only."
  exit 1
fi

ARCH=$(uname -m)
case "${ARCH}" in
  x86_64 | amd64) RUNNER_ARCH="x64" ;;
  aarch64 | arm64) RUNNER_ARCH="arm64" ;;
  *)
    echo "Unsupported architecture: ${ARCH}"
    exit 1
    ;;
esac

ensure_cmd() {
  local c="$1"
  if ! command -v "${c}" >/dev/null 2>&1; then
    echo "Missing command: ${c}"
    exit 1
  fi
}

ensure_cmd curl
ensure_cmd tar

need_sudo=false
if [[ "${EUID}" -ne 0 ]]; then
  need_sudo=true
  ensure_cmd sudo
fi

run_as_root() {
  if [[ "${need_sudo}" == "true" ]]; then
    sudo "$@"
  else
    "$@"
  fi
}

fetch_runner_token() {
  if [[ -n "${RUNNER_TOKEN}" ]]; then
    return 0
  fi

  if [[ -z "${GH_TOKEN}" ]]; then
    echo "RUNNER_TOKEN is empty and GH_TOKEN is not provided."
    echo "Provide RUNNER_TOKEN or GH_TOKEN to continue."
    exit 1
  fi

  echo "Fetching runner registration token from GitHub API..."
  RUNNER_TOKEN=$(curl -fsSL -X POST \
    -H "Accept: application/vnd.github+json" \
    -H "Authorization: Bearer ${GH_TOKEN}" \
    "https://api.github.com/repos/${GITHUB_REPOSITORY}/actions/runners/registration-token" \
    | sed -n 's/.*"token":"\([^"]*\)".*/\1/p')

  if [[ -z "${RUNNER_TOKEN}" ]]; then
    echo "Failed to fetch RUNNER_TOKEN from GitHub API."
    exit 1
  fi
}

setup_runner_files() {
  run_as_root mkdir -p "${RUNNER_DIR}"
  run_as_root chown -R "$(id -u)":"$(id -g)" "${RUNNER_DIR}"
  cd "${RUNNER_DIR}"

  local pkg="actions-runner-linux-${RUNNER_ARCH}-${RUNNER_VERSION}.tar.gz"
  local url="https://github.com/actions/runner/releases/download/v${RUNNER_VERSION}/${pkg}"

  if [[ ! -f "${pkg}" ]]; then
    echo "Downloading actions runner ${RUNNER_VERSION} (${RUNNER_ARCH})..."
    curl -fsSL -o "${pkg}" "${url}"
  fi

  if [[ ! -x ./config.sh ]]; then
    echo "Extracting runner package..."
    tar xzf "${pkg}"
  fi
}

configure_runner() {
  cd "${RUNNER_DIR}"

  if [[ -f .runner ]]; then
    echo "Existing runner config detected, removing old config..."
    ./config.sh remove --token "${RUNNER_TOKEN}" || true
    rm -f .runner .credentials .credentials_rsaparams
  fi

  echo "Configuring runner..."
  ./config.sh \
    --url "https://github.com/${GITHUB_REPOSITORY}" \
    --token "${RUNNER_TOKEN}" \
    --name "${RUNNER_NAME}" \
    --labels "${RUNNER_LABELS}" \
    --work "_work" \
    --unattended \
    --replace
}

install_service() {
  cd "${RUNNER_DIR}"

  echo "Installing and starting runner service..."
  if [[ "${need_sudo}" == "true" ]]; then
    sudo ./svc.sh install "$(whoami)"
    sudo ./svc.sh start
    sudo ./svc.sh status || true
  else
    ./svc.sh install
    ./svc.sh start
    ./svc.sh status || true
  fi
}

fetch_runner_token
setup_runner_files
configure_runner
install_service

echo ""
echo "Runner setup complete."
echo "Repository: ${GITHUB_REPOSITORY}"
echo "Runner name: ${RUNNER_NAME}"
echo "Runner labels: ${RUNNER_LABELS}"
echo "Now re-run GitHub Actions deploy workflow."
