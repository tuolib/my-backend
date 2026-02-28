# Cart Service — :3003
FROM oven/bun:1-alpine AS base
WORKDIR /app

COPY package.json bun.lock ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/database/package.json ./packages/database/
COPY services/cart-service/package.json ./services/cart-service/
RUN bun install --frozen-lockfile

COPY packages/ ./packages/
COPY services/cart-service/ ./services/cart-service/

RUN addgroup -S app && adduser -S app -G app
USER app

EXPOSE 3003
CMD ["bun", "run", "services/cart-service/src/index.ts"]
