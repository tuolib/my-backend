# Cart Service — :3003
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
COPY services/cart-service/ ./services/cart-service/

RUN addgroup -g 1000 -S app && adduser -u 1000 -S app -G app
USER 1000

EXPOSE 3003
CMD ["bun", "run", "services/cart-service/src/index.ts"]
