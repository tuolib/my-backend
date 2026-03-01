#!/bin/bash
# 冒烟测试 — 验证所有核心端点可用
# 用法: bash scripts/smoke-test.sh [base_url]
set -e

BASE_URL="${1:-http://localhost:80}"
PASS=0
FAIL=0

check() {
  local desc="$1"
  local url="$2"
  local data="$3"
  local expected_code="$4"
  local extra_headers="$5"

  local status
  if [ -n "$extra_headers" ]; then
    status=$(curl -s -o /dev/null -w "%{http_code}" \
      -X POST "$BASE_URL$url" \
      -H "Content-Type: application/json" \
      -H "$extra_headers" \
      ${data:+-d "$data"})
  else
    status=$(curl -s -o /dev/null -w "%{http_code}" \
      -X POST "$BASE_URL$url" \
      -H "Content-Type: application/json" \
      ${data:+-d "$data"})
  fi

  if [ "$status" = "$expected_code" ]; then
    echo "  PASS  $desc -> $status"
    PASS=$((PASS+1))
  else
    echo "  FAIL  $desc -> $status (expected $expected_code)"
    FAIL=$((FAIL+1))
  fi
}

echo "====== Smoke Test ======"
echo "Target: $BASE_URL"
echo ""

# ── 健康检查 ──
echo "[Health]"
check "Gateway health" "/health" "" "200"

# ── 公开路由 ──
echo ""
echo "[Public Routes]"
check "Product list" "/api/v1/product/list" '{"page":1}' "200"
check "Category tree" "/api/v1/category/tree" '{}' "200"
check "Product search" "/api/v1/product/search" '{"keyword":"test"}' "200"

# ── 认证 ──
echo ""
echo "[Auth]"
REGISTER_RESP=$(curl -s -X POST "$BASE_URL/api/v1/auth/register" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"smoke-$(date +%s)@test.com\",\"password\":\"password12345678\"}")
TOKEN=$(echo "$REGISTER_RESP" | grep -o '"accessToken":"[^"]*"' | cut -d'"' -f4)

if [ -n "$TOKEN" ]; then
  echo "  PASS  Register -> got token"
  PASS=$((PASS+1))

  echo ""
  echo "[Authenticated Routes]"
  check "User profile" "/api/v1/user/profile" "" "200" "Authorization: Bearer $TOKEN"
  check "Cart list" "/api/v1/cart/list" "" "200" "Authorization: Bearer $TOKEN"
  check "Order list" "/api/v1/order/list" '{"page":1}' "200" "Authorization: Bearer $TOKEN"
else
  echo "  FAIL  Register failed"
  FAIL=$((FAIL+1))
fi

# ── 未认证拦截 ──
echo ""
echo "[Auth Guard]"
check "Cart without auth" "/api/v1/cart/list" "" "401"
check "Order without auth" "/api/v1/order/list" '{"page":1}' "401"

# ── 内部路由拦截 ──
echo ""
echo "[Internal Block]"
check "Internal route blocked" "/internal/user/detail" '{"id":"x"}' "403"

# ── 404 ──
echo ""
echo "[404]"
check "Unknown route" "/api/v1/nonexistent" "" "404"

# ── 结果汇总 ──
echo ""
echo "====== Results ======"
echo "Passed: $PASS  Failed: $FAIL"

if [ $FAIL -gt 0 ]; then
  exit 1
fi
