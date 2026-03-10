#!/bin/bash
# init-server.sh — 单机服务器一键初始化
#
# 在目标服务器上运行，完成：
#   1. 安装 Docker + Docker Compose
#   2. 配置防火墙
#   3. 创建 swap（小内存服务器防 OOM）
#   4. 创建部署目录 + 自签 SSL 证书
#   5. 配置 Docker 垃圾清理 cron
#
# 用法: bash init-server.sh [DOMAIN]
# 示例: bash init-server.sh api.example.com

set -euo pipefail

DOMAIN="${1:-localhost}"
DEPLOY_DIR="/opt/ecom"

echo "═══════════════════════════════════════════════════════════════"
echo "  Single Server Initialization"
echo "  Domain: ${DOMAIN}"
echo "  Deploy dir: ${DEPLOY_DIR}"
echo "═══════════════════════════════════════════════════════════════"

# ── Step 1: 安装 Docker ──

echo ""
echo "── [1/4] Installing Docker ──"

if ! command -v docker &>/dev/null; then
    curl -fsSL https://get.docker.com | sh
    systemctl enable --now docker
    echo "Docker installed"
else
    echo "Docker already installed: $(docker --version)"
fi

# 确保 docker compose 可用
if ! docker compose version &>/dev/null; then
    echo "ERROR: docker compose plugin not found"
    echo "Install: apt-get install docker-compose-plugin"
    exit 1
fi

# ── Step 2: 防火墙 ──

echo ""
echo "── [2/5] Configuring firewall ──"

if command -v ufw &>/dev/null; then
    ufw allow 22/tcp
    ufw allow 80/tcp
    ufw allow 443/tcp
    ufw --force enable
    echo "UFW configured"
else
    echo "UFW not found, skipping firewall setup"
fi

# ── Step 3: Swap（1G 内存服务器防 OOM） ──

echo ""
echo "── [3/5] Configuring swap ──"

if swapon --show | grep -q '/swapfile'; then
    echo "Swap already exists: $(swapon --show --noheadings)"
else
    TOTAL_MEM_MB=$(awk '/MemTotal/ {printf "%d", $2/1024}' /proc/meminfo)
    if [ "${TOTAL_MEM_MB}" -le 2048 ]; then
        echo "Memory: ${TOTAL_MEM_MB}MB — creating 1G swap..."
        fallocate -l 1G /swapfile
        chmod 600 /swapfile
        mkswap /swapfile >/dev/null
        swapon /swapfile
        grep -q '/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
        echo "1G swap enabled"
    else
        echo "Memory: ${TOTAL_MEM_MB}MB — swap not needed"
    fi
fi

# ── Step 4: 部署目录 + 自签 SSL ──

echo ""
echo "── [4/5] Creating deploy directory ──"

mkdir -p "${DEPLOY_DIR}/ssl"

# 生成自签 SSL 证书（让 Nginx 首次启动能监听 443）
if [ ! -f "${DEPLOY_DIR}/ssl/fullchain.pem" ]; then
    echo "Generating self-signed SSL certificate..."
    openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
        -keyout "${DEPLOY_DIR}/ssl/privkey.pem" \
        -out "${DEPLOY_DIR}/ssl/fullchain.pem" \
        -subj "/CN=${DOMAIN}" 2>/dev/null
    echo "Self-signed certificate created"
else
    echo "SSL certificate already exists, skipping"
fi

echo "Deploy directory ready: ${DEPLOY_DIR}"

# ── Step 4: Docker 垃圾清理 cron ──

echo ""
echo "── [5/5] Setting up cleanup cron ──"

CLEANUP_CRON='0 3 * * * docker system prune -af --filter "until=72h" >/dev/null 2>&1'
(crontab -l 2>/dev/null | grep -v "docker system prune"; echo "${CLEANUP_CRON}") | crontab -
echo "Docker cleanup cron configured (daily 3AM)"

# ── 完成 ──

echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "  Initialization complete!"
echo "═══════════════════════════════════════════════════════════════"
echo ""
echo "Next steps:"
echo "  1. Configure GitHub Secrets:"
echo "     - SINGLE_SSH_KEY          (SSH private key)"
echo "     - SINGLE_POSTGRES_PASSWORD"
echo "     - SINGLE_JWT_ACCESS_SECRET"
echo "     - SINGLE_JWT_REFRESH_SECRET"
echo "     - SINGLE_INTERNAL_SECRET"
echo "     - GHCR_PAT               (GitHub Container Registry token)"
echo ""
echo "  2. Configure GitHub Variables:"
echo "     - SINGLE_HOST             (server IP)"
echo "     - SINGLE_USER             (default: root)"
echo "     - SINGLE_DOMAIN           (e.g. api.example.com)"
echo "     - SINGLE_EMAIL            (for Let's Encrypt)"
echo ""
echo "  3. Point DNS A record to this server's IP"
echo ""
echo "  4. Push code or manually trigger deploy (platform: single-server)"
