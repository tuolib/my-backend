#!/bin/sh
# certbot-renew.sh — Let's Encrypt 证书签发 & 自动续签（webroot 模式）
#
# 流程：
#   1. 申请证书（webroot，Nginx 代理 ACME challenge）
#   2. 拷贝证书到 Nginx 可读路径
#   3. 每 12 小时检查续签

set -e

DOMAIN="${DOMAIN:?DOMAIN env required}"
EMAIL="${EMAIL:?EMAIL env required}"
CERT_DIR="/etc/letsencrypt/live/${DOMAIN}"
NGINX_SSL_DIR="/etc/nginx/ssl"

# ── 安装 Docker CLI（用于 reload nginx） ──
install_docker_cli() {
    if command -v docker >/dev/null 2>&1; then
        return 0
    fi
    echo "Installing Docker CLI..."
    DOCKER_VERSION="24.0.7"
    wget -qO /tmp/docker.tgz \
        "https://download.docker.com/linux/static/stable/x86_64/docker-${DOCKER_VERSION}.tgz"
    tar -xzf /tmp/docker.tgz -C /tmp
    mv /tmp/docker/docker /usr/local/bin/
    rm -rf /tmp/docker*
    echo "Docker CLI installed"
}

# ── 拷贝证书到 Nginx 读取路径 + reload nginx ──
copy_certs() {
    if [ -f "${CERT_DIR}/fullchain.pem" ] && [ -f "${CERT_DIR}/privkey.pem" ]; then
        cp -fL "${CERT_DIR}/fullchain.pem" "${NGINX_SSL_DIR}/fullchain.pem"
        cp -fL "${CERT_DIR}/privkey.pem" "${NGINX_SSL_DIR}/privkey.pem"
        echo "Certificates copied to ${NGINX_SSL_DIR}"

        # 通过 docker.sock 让 nginx reload 加载新证书
        NGINX_CID=$(docker ps -qf "name=nginx" 2>/dev/null | head -1)
        if [ -n "${NGINX_CID}" ]; then
            docker exec "${NGINX_CID}" nginx -s reload 2>/dev/null \
                && echo "Nginx reloaded" \
                || echo "WARN: Nginx reload failed"
        fi
    fi
}

install_docker_cli

# ── 等待 Nginx 就绪（ACME challenge 需要 80 端口） ──
echo "Waiting for Nginx to be ready..."
for i in $(seq 1 90); do
    if wget -qO /dev/null --spider "http://nginx:80/" 2>/dev/null || \
       wget -S --spider "http://nginx:80/" 2>&1 | grep -q "HTTP/"; then
        echo "Nginx ready (${i}s)"
        break
    fi
    sleep 1
done

# ── 申请证书 ──
echo "Requesting certificate for ${DOMAIN}..."
CERT_OBTAINED=false
for ATTEMPT in $(seq 1 6); do
    if certbot certonly --webroot -w /var/www/certbot \
        -d "${DOMAIN}" --email "${EMAIL}" \
        --agree-tos --non-interactive \
        --keep-until-expiring \
        --preferred-challenges http 2>&1; then
        CERT_OBTAINED=true
        break
    fi
    echo "Cert request failed (attempt ${ATTEMPT}/6), retrying in 5 minutes..."
    sleep 300
done

if [ "${CERT_OBTAINED}" = "true" ]; then
    copy_certs
else
    echo "WARN: Certificate request failed"
    echo "  - Check DNS: dig ${DOMAIN} should resolve to this server"
    echo "  - Check port 80 reachable from internet"
fi

# ── 续签循环（每 12 小时） ──
echo "Entering renewal loop (every 12 hours)..."
while true; do
    sleep 43200
    echo "Checking certificate renewal..."
    if certbot renew --webroot -w /var/www/certbot 2>&1; then
        copy_certs
    else
        echo "WARN: Renewal failed, will retry next cycle"
    fi
done
