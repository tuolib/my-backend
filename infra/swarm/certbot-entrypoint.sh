#!/bin/sh
# certbot-entrypoint.sh — SSL 证书自动申请与续签
# 与 nginx 共享 certbot_certs 和 certbot_webroot 卷
#
# 流程：
#   1. 首次部署：生成临时自签名证书 → nginx 可启动
#   2. 等待 nginx 就绪
#   3. 通过 HTTP-01 验证申请 Let's Encrypt 真实证书
#   4. 每 12 小时检查续签

set -e

DOMAIN="${CERTBOT_DOMAIN:-api.find345.site}"
EMAIL="${CERTBOT_EMAIL:-admin@find345.site}"
CERT_DIR="/etc/letsencrypt/live/${DOMAIN}"

echo "=== Certbot: domain=${DOMAIN}, email=${EMAIL} ==="

# ── 1. 首次启动：生成临时自签名证书（让 nginx 能启动 443） ──
if [ ! -f "${CERT_DIR}/fullchain.pem" ]; then
  echo "=== Generating temporary self-signed certificate ==="
  mkdir -p "${CERT_DIR}"
  openssl req -x509 -nodes -days 7 -newkey rsa:2048 \
    -keyout "${CERT_DIR}/privkey.pem" \
    -out "${CERT_DIR}/fullchain.pem" \
    -subj "/CN=${DOMAIN}"
  echo "=== Temporary certificate ready ==="
fi

# ── 2. 等待 nginx 就绪（需要 nginx 处理 ACME HTTP-01 验证请求） ──
echo "=== Waiting for nginx to be ready ==="
sleep 15

# ── 3. 申请真实证书（如果还没有） ──
# 检查是否已经有 Let's Encrypt 签发的证书（非自签名）
if [ ! -f "/etc/letsencrypt/renewal/${DOMAIN}.conf" ]; then
  echo "=== Requesting Let's Encrypt certificate ==="
  certbot certonly --webroot \
    -w /var/www/certbot \
    -d "${DOMAIN}" \
    --email "${EMAIL}" \
    --agree-tos \
    --no-eff-email \
    --non-interactive \
    --force-renewal \
    || echo "=== Certificate request failed, will retry on next cycle ==="
fi

# ── 4. 循环续签（每 12 小时检查一次，到期前 30 天自动续签） ──
echo "=== Starting renewal loop ==="
while true; do
  echo "=== Checking certificate renewal: $(date) ==="
  certbot renew --quiet
  sleep 43200
done
