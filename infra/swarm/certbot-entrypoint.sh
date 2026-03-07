#!/bin/sh
# certbot-entrypoint.sh — SSL 自动签发 & 续签
#
# 流程：
#   1. 首次运行：通过 standalone 模式申请 Let's Encrypt 证书
#   2. Nginx 代理 /.well-known/acme-challenge/ 到 certbot:8080
#   3. 获得证书后更新 Docker Secret 并触发 Nginx 滚动重启
#   4. 每 12 小时检查续签
#
# 前置条件：
#   - Docker socket 挂载到容器内
#   - init-node.sh 已创建自签名 ssl_cert/ssl_key secret（Nginx 首次启动需要）
#   - DNS A 记录已指向服务器

set -e

DOMAIN="${DOMAIN:?DOMAIN env required}"
EMAIL="${EMAIL:?EMAIL env required}"
STACK_NAME="${STACK_NAME:-ecom}"
CERT_DIR="/etc/letsencrypt/live/${DOMAIN}"

# 安装 Docker CLI（用于管理 secret 和触发 service update）
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

# 更新 SSL Docker Secret 并触发 Nginx 滚动重启
update_ssl_secrets() {
    local CERT_FILE="$1"
    local KEY_FILE="$2"
    local TIMESTAMP
    TIMESTAMP=$(date +%s)

    local NEW_CERT="ssl_cert_${TIMESTAMP}"
    local NEW_KEY="ssl_key_${TIMESTAMP}"

    echo "Creating new secrets: ${NEW_CERT}, ${NEW_KEY}"
    docker secret create "${NEW_CERT}" "${CERT_FILE}"
    docker secret create "${NEW_KEY}" "${KEY_FILE}"

    echo "Updating nginx service to use new secrets..."
    docker service update \
        --secret-rm ssl_cert --secret-add "source=${NEW_CERT},target=ssl_cert" \
        --secret-rm ssl_key --secret-add "source=${NEW_KEY},target=ssl_key" \
        --detach \
        "${STACK_NAME}_nginx"

    echo "Waiting for nginx to pick up new certs..."
    sleep 30

    # 清理旧 secret（保留当前使用的）
    docker secret ls --format '{{.Name}}' | grep -E '^ssl_(cert|key)_' | while read -r OLD; do
        if [ "${OLD}" != "${NEW_CERT}" ] && [ "${OLD}" != "${NEW_KEY}" ]; then
            docker secret rm "${OLD}" 2>/dev/null || true
        fi
    done

    echo "SSL secrets updated successfully"
}

install_docker_cli

# 尝试申请 Let's Encrypt 证书
echo "Attempting to obtain Let's Encrypt certificate for ${DOMAIN}..."
certbot certonly --standalone --http-01-port 8080 \
    -d "${DOMAIN}" --email "${EMAIL}" \
    --agree-tos --non-interactive \
    --preferred-challenges http 2>&1 || echo "Initial cert request failed (DNS may not be ready yet)"

# 如果成功获取，更新 secret
if [ -f "${CERT_DIR}/fullchain.pem" ]; then
    update_ssl_secrets "${CERT_DIR}/fullchain.pem" "${CERT_DIR}/privkey.pem"
fi

# 续签循环（每 12 小时）
echo "Entering renewal loop (every 12 hours)..."
while true; do
    sleep 43200

    echo "Checking certificate renewal..."
    certbot renew --standalone --http-01-port 8080 2>&1 || true

    # 检查证书是否更新（修改时间在 12 小时内）
    if [ -f "${CERT_DIR}/fullchain.pem" ]; then
        CERT_MOD=$(stat -c %Y "${CERT_DIR}/fullchain.pem" 2>/dev/null || echo 0)
        NOW=$(date +%s)
        AGE=$((NOW - CERT_MOD))
        if [ ${AGE} -lt 43200 ]; then
            echo "Certificate was renewed, updating secrets..."
            update_ssl_secrets "${CERT_DIR}/fullchain.pem" "${CERT_DIR}/privkey.pem"
        fi
    fi
done
