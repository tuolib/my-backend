# Product Service — :3002
FROM oven/bun:1-alpine AS base
WORKDIR /app

COPY package.json bun.lock ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/database/package.json ./packages/database/
COPY services/product-service/package.json ./services/product-service/
RUN bun install --frozen-lockfile

COPY packages/ ./packages/
COPY services/product-service/ ./services/product-service/

RUN addgroup -S app && adduser -S app -G app
USER app

EXPOSE 3002
CMD ["bun", "run", "services/product-service/src/index.ts"]
