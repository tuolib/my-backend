# API Gateway — :3000
FROM oven/bun:1-alpine AS base
WORKDIR /app

COPY package.json bun.lock ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/database/package.json ./packages/database/
COPY apps/api-gateway/package.json ./apps/api-gateway/
RUN bun install --frozen-lockfile

COPY packages/ ./packages/
COPY apps/api-gateway/ ./apps/api-gateway/

RUN addgroup -S app && adduser -S app -G app
USER app

EXPOSE 3000
CMD ["bun", "run", "apps/api-gateway/src/index.ts"]
