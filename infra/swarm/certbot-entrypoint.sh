#!/bin/sh
# certbot — SSL 自动签发 & 续签
#
# 流程:
#   1. 首次: 生成自签名证书 -> nginx 能立即启动 443
#   2. 等 nginx 就绪 -> HTTP-01 验证申请 Let's Encrypt 真实证书
#   3. 每 12h 检查续签（到期前 30 天自动续签）
#
# 环境变量:
#   CERTBOT_DOMAIN  域名
#   CERTBOT_EMAIL   通知邮箱

set -e

DOMAIN="${CERTBOT_DOMAIN:?CERTBOT_DOMAIN is required}"
EMAIL="${CERTBOT_EMAIL:?CERTBOT_EMAIL is required}"
CERT_DIR="/etc/letsencrypt/live/${DOMAIN}"

log() { echo "[certbot] $(date '+%H:%M:%S') $*"; }

# ── 1. 自签名兜底（让 nginx 先起来） ──
if [ ! -f "${CERT_DIR}/fullchain.pem" ]; then
  log "Generating self-signed certificate for ${DOMAIN}..."
  mkdir -p "${CERT_DIR}"
  openssl req -x509 -nodes -days 7 -newkey rsa:2048 \
    -keyout "${CERT_DIR}/privkey.pem" \
    -out "${CERT_DIR}/fullchain.pem" \
    -subj "/CN=${DOMAIN}" 2>/dev/null
  log "Self-signed certificate ready"
fi

# ── 2. 等 nginx 就绪 ──
log "Waiting for nginx..."
sleep 20

# ── 3. 申请真实证书（带重试） ──
if [ ! -f "/etc/letsencrypt/renewal/${DOMAIN}.conf" ]; then
  log "Requesting Let's Encrypt certificate for ${DOMAIN}..."
  for attempt in 1 2 3 4 5; do
    if certbot certonly --webroot \
      -w /var/www/certbot \
      -d "${DOMAIN}" \
      --email "${EMAIL}" \
      --agree-tos --no-eff-email --non-interactive \
      --force-renewal; then
      log "Certificate obtained successfully"
      break
    fi
    log "Attempt ${attempt}/5 failed, retrying in 30s..."
    sleep 30
  done
fi

# ── 4. 续签循环 ──
log "Entering renewal loop (every 12h)"
while true; do
  sleep 43200
  log "Checking renewal..."
  certbot renew --quiet || log "Renewal check completed with warnings"
done
