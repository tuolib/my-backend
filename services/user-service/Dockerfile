# User Service — :3001
FROM oven/bun:1-alpine AS base
WORKDIR /app

COPY package.json bun.lock ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/database/package.json ./packages/database/
COPY services/user-service/package.json ./services/user-service/
RUN bun install --frozen-lockfile

COPY packages/ ./packages/
COPY services/user-service/ ./services/user-service/

RUN addgroup -S app && adduser -S app -G app
USER app

EXPOSE 3001
CMD ["bun", "run", "services/user-service/src/index.ts"]
