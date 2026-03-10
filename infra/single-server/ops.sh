#!/bin/bash
# ops.sh — 单机部署运维工具
#
# 用法: bash ops.sh <command>
# 命令: status | logs | restart | reload-ssl | reset

set -euo pipefail

DEPLOY_DIR="/opt/ecom"
COMPOSE="docker compose -f ${DEPLOY_DIR}/docker-compose.prod.yml"

case "${1:-help}" in

  status)
    echo "══════════ Containers ══════════"
    ${COMPOSE} ps
    echo ""
    echo "══════════ Resource Usage ══════════"
    docker stats --no-stream --format "table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}" $(${COMPOSE} ps -q) 2>/dev/null || true
    echo ""
    echo "══════════ Disk Usage ══════════"
    docker system df
    echo ""
    echo "══════════ SSL Certificate ══════════"
    echo | openssl s_client -connect localhost:443 2>/dev/null | openssl x509 -noout -subject -issuer -dates 2>/dev/null || echo "No valid certificate"
    ;;

  logs)
    SERVICE="${2:-}"
    LINES="${3:-50}"
    if [ -n "${SERVICE}" ]; then
      ${COMPOSE} logs --tail "${LINES}" -f "${SERVICE}"
    else
      ${COMPOSE} logs --tail "${LINES}" -f
    fi
    ;;

  restart)
    SERVICE="${2:-}"
    if [ -n "${SERVICE}" ]; then
      ${COMPOSE} restart "${SERVICE}"
    else
      ${COMPOSE} restart api-gateway user-service product-service cart-service order-service
    fi
    ;;

  reload-ssl)
    echo "Reloading Nginx SSL..."
    # 拷贝 certbot 证书到 nginx ssl 目录
    CERT_DIR=$(docker volume inspect ecom_certbot_conf --format '{{.Mountpoint}}')/live
    DOMAIN=$(grep DOMAIN "${DEPLOY_DIR}/.env" | head -1 | cut -d= -f2)
    if [ -f "${CERT_DIR}/${DOMAIN}/fullchain.pem" ]; then
      cp -fL "${CERT_DIR}/${DOMAIN}/fullchain.pem" "${DEPLOY_DIR}/ssl/fullchain.pem"
      cp -fL "${CERT_DIR}/${DOMAIN}/privkey.pem" "${DEPLOY_DIR}/ssl/privkey.pem"
      ${COMPOSE} exec nginx nginx -s reload
      echo "SSL reloaded"
    else
      echo "No certificate found for ${DOMAIN}"
    fi
    ;;

  reset)
    echo "WARNING: This will destroy all data (DB, Redis, certs)!"
    read -p "Type YES to confirm: " CONFIRM
    if [ "${CONFIRM}" != "YES" ]; then
      echo "Cancelled"
      exit 0
    fi
    ${COMPOSE} down -v
    rm -f "${DEPLOY_DIR}/.env"
    echo "Reset complete. Run deploy again to recreate."
    ;;

  help|*)
    echo "Usage: bash ops.sh <command>"
    echo ""
    echo "Commands:"
    echo "  status              Show container status, resources, SSL info"
    echo "  logs [service] [n]  Tail logs (default: all services, 50 lines)"
    echo "  restart [service]   Restart app services (or specific service)"
    echo "  reload-ssl          Copy certbot certs and reload nginx"
    echo "  reset               Destroy all data and containers"
    ;;
esac
