# Order Service — :3004
FROM oven/bun:1-alpine AS base
WORKDIR /app

COPY package.json bun.lock ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/database/package.json ./packages/database/
COPY services/order-service/package.json ./services/order-service/
RUN bun install --frozen-lockfile

COPY packages/ ./packages/
COPY services/order-service/ ./services/order-service/

RUN addgroup -S app && adduser -S app -G app
USER app

EXPOSE 3004
CMD ["bun", "run", "services/order-service/src/index.ts"]
