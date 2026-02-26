#!/usr/bin/env bash
# setup-docker-ipv6.sh — 配置 Docker 启用 IPv6（每台机器执行一次）
set -euo pipefail

DAEMON_JSON="/etc/docker/daemon.json"

if [[ $EUID -ne 0 ]]; then
  echo "请用 root 运行: sudo bash $0"
  exit 1
fi

# 备份已有配置
if [[ -f "${DAEMON_JSON}" ]]; then
  cp "${DAEMON_JSON}" "${DAEMON_JSON}.bak.$(date +%s)"
fi

# 写入 IPv6 配置（保留已有配置则手动合并）
cat > "${DAEMON_JSON}" <<'EOF'
{
  "ipv6": true,
  "fixed-cidr-v6": "fd00:dead:beef::/48",
  "ip6tables": true,
  "experimental": true
}
EOF

echo "已写入 ${DAEMON_JSON}"
echo "重启 Docker..."
systemctl restart docker

echo "验证 IPv6："
docker network inspect bridge --format '{{.EnableIPv6}}'
echo "Done."
