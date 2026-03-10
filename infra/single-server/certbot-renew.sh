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
NGINX_SSL_DIR="/etc/letsencrypt/nginx-ssl"

mkdir -p "${NGINX_SSL_DIR}"

# ── 拷贝证书到 Nginx 读取路径 ──
copy_certs() {
    if [ -f "${CERT_DIR}/fullchain.pem" ] && [ -f "${CERT_DIR}/privkey.pem" ]; then
        cp -fL "${CERT_DIR}/fullchain.pem" "${NGINX_SSL_DIR}/fullchain.pem"
        cp -fL "${CERT_DIR}/privkey.pem" "${NGINX_SSL_DIR}/privkey.pem"
        echo "Certificates copied to ${NGINX_SSL_DIR}"
    fi
}

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
