#!/bin/sh
# certbot-entrypoint.sh — SSL 自动签发 & 续签
#
# 流程：
#   1. 启动时如果 volume 中已有有效证书 → 立即恢复到 Docker Secret（覆盖自签）
#   2. 等待 Nginx ready → 申请/续签 Let's Encrypt 证书
#   3. 获得证书后更新 Docker Secret 并触发 Nginx 滚动重启
#   4. 每 12 小时检查续签
#
# 前置条件：
#   - Docker socket 挂载到容器内
#   - init-node.sh 或 CI 已创建自签名 ssl_cert/ssl_key secret（Nginx 首次启动需要）
#   - DNS A 记录已指向服务器

set -e

DOMAIN="${DOMAIN:?DOMAIN env required}"
EMAIL="${EMAIL:?EMAIL env required}"
STACK_NAME="${STACK_NAME:-ecom}"
CERT_DIR="/etc/letsencrypt/live/${DOMAIN}"

# ── 安装 Docker CLI ──────────────────────────────────────────────────────────

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

# ── 更新 SSL Docker Secret 并触发 Nginx 滚动重启 ────────────────────────────

update_ssl_secrets() {
    local CERT_FILE="$1"
    local KEY_FILE="$2"
    local TIMESTAMP
    TIMESTAMP=$(date +%s)

    local NEW_CERT="ssl_cert_${TIMESTAMP}"
    local NEW_KEY="ssl_key_${TIMESTAMP}"

    echo "Creating new secrets: ${NEW_CERT}, ${NEW_KEY}"

    # 防止同名 secret 已存在（上次 update 中途失败残留）
    docker secret rm "${NEW_CERT}" 2>/dev/null || true
    docker secret rm "${NEW_KEY}" 2>/dev/null || true
    docker secret create "${NEW_CERT}" "${CERT_FILE}"
    docker secret create "${NEW_KEY}" "${KEY_FILE}"

    echo "Updating nginx service to use new secrets..."
    # --secret-rm 按 target 名称移除（nginx 始终 mount 到 /run/secrets/ssl_cert）
    docker service update \
        --secret-rm ssl_cert --secret-add "source=${NEW_CERT},target=ssl_cert" \
        --secret-rm ssl_key --secret-add "source=${NEW_KEY},target=ssl_key" \
        --detach \
        "${STACK_NAME}_nginx"

    echo "Waiting for nginx to pick up new certs..."
    sleep 30

    # 清理旧的带时间戳 secret（保留当前使用的）
    docker secret ls --format '{{.Name}}' | grep -E '^ssl_(cert|key)_' | while read -r OLD; do
        if [ "${OLD}" != "${NEW_CERT}" ] && [ "${OLD}" != "${NEW_KEY}" ]; then
            docker secret rm "${OLD}" 2>/dev/null || true
        fi
    done

    echo "SSL secrets updated successfully"
}

# ── Main ─────────────────────────────────────────────────────────────────────

install_docker_cli

# ── 1) 恢复已有证书 ──────────────────────────────────────────────────────────
# 每次部署 step [3/6] 重建 ssl_cert/ssl_key 为自签证书
# 如果 volume 中有上次申请的真实证书，立即恢复到 Docker Secret
if [ -f "${CERT_DIR}/fullchain.pem" ] && [ -f "${CERT_DIR}/privkey.pem" ]; then
    echo "Found existing certificate in volume, checking validity..."
    if openssl x509 -checkend 86400 -noout -in "${CERT_DIR}/fullchain.pem" 2>/dev/null; then
        echo "Certificate valid, restoring to Docker Secrets..."
        update_ssl_secrets "${CERT_DIR}/fullchain.pem" "${CERT_DIR}/privkey.pem" \
            || echo "WARN: Failed to restore cert (will try fresh request)"
        echo "Existing certificate restored"
    else
        echo "Existing certificate expired or invalid, will request new one"
    fi
fi

# ── 2) 等待 Nginx 就绪 ──────────────────────────────────────────────────────
# ACME HTTP-01 challenge: Let's Encrypt → :80 → Nginx → proxy → certbot:8080
# 如果 Nginx 还没 ready，challenge 请求到不了 certbot
echo "Waiting for Nginx to be ready..."
NGINX_READY=false
for i in $(seq 1 90); do
    # certbot/certbot 镜像基于 Alpine，有 wget
    if wget -q --spider --timeout=2 "http://nginx:80/" 2>/dev/null; then
        NGINX_READY=true
        echo "Nginx ready (${i}s)"
        break
    fi
    sleep 1
done
if [ "${NGINX_READY}" = "false" ]; then
    echo "WARN: Nginx not detected after 90s, attempting cert request anyway..."
fi

# ── 3) 申请/续签 Let's Encrypt 证书 ─────────────────────────────────────────
echo "Requesting Let's Encrypt certificate for ${DOMAIN}..."
CERT_OBTAINED=false
for ATTEMPT in $(seq 1 6); do
    if certbot certonly --standalone --http-01-port 8080 \
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

# ── 4) 更新 Docker Secret ────────────────────────────────────────────────────
if [ "${CERT_OBTAINED}" = "true" ] && [ -f "${CERT_DIR}/fullchain.pem" ]; then
    # --keep-until-expiring: 证书未过期时 certbot 输出 "not yet due for renewal" 但仍 exit 0
    # 只在证书文件最近被修改时才更新 secret（避免每次部署都触发 nginx 重启）
    CERT_MOD=$(stat -c %Y "${CERT_DIR}/fullchain.pem" 2>/dev/null || echo 0)
    NOW=$(date +%s)
    AGE=$((NOW - CERT_MOD))
    if [ ${AGE} -lt 300 ]; then
        echo "New certificate obtained, updating secrets..."
        update_ssl_secrets "${CERT_DIR}/fullchain.pem" "${CERT_DIR}/privkey.pem"
    else
        echo "Certificate unchanged (already up to date)"
    fi
else
    echo "WARN: Certificate request did not succeed"
    echo "  - Check DNS: dig ${DOMAIN} should resolve to server IPs"
    echo "  - Check port 80 reachable: curl -v http://${DOMAIN}/.well-known/acme-challenge/test"
fi

# ── 5) 续签循环（每 12 小时） ────────────────────────────────────────────────
echo "Entering renewal loop (every 12 hours)..."
while true; do
    sleep 43200

    echo "Checking certificate renewal..."
    if certbot renew --standalone --http-01-port 8080 2>&1; then
        # 检查证书是否实际更新（修改时间在 12 小时内）
        if [ -f "${CERT_DIR}/fullchain.pem" ]; then
            CERT_MOD=$(stat -c %Y "${CERT_DIR}/fullchain.pem" 2>/dev/null || echo 0)
            NOW=$(date +%s)
            AGE=$((NOW - CERT_MOD))
            if [ ${AGE} -lt 43200 ]; then
                echo "Certificate was renewed, updating secrets..."
                update_ssl_secrets "${CERT_DIR}/fullchain.pem" "${CERT_DIR}/privkey.pem"
            fi
        fi
    else
        echo "WARN: Certificate renewal failed, will retry next cycle"
    fi
done
