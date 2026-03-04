# User Service — :3001
FROM oven/bun:1.3.9-alpine AS base
WORKDIR /app

COPY package.json bun.lock ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/database/package.json ./packages/database/
COPY apps/api-gateway/package.json ./apps/api-gateway/
COPY services/user-service/package.json ./services/user-service/
COPY services/product-service/package.json ./services/product-service/
COPY services/cart-service/package.json ./services/cart-service/
COPY services/order-service/package.json ./services/order-service/
RUN bun install --frozen-lockfile

COPY packages/ ./packages/
COPY services/user-service/ ./services/user-service/

USER bun

EXPOSE 3001
CMD ["bun", "run", "services/user-service/src/index.ts"]
