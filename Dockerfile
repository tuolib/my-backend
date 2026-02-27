FROM oven/bun:1 AS base
WORKDIR /app

# --- Dependencies ---
FROM base AS deps
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile --production

# --- Build ---
FROM base AS build
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile
COPY . .
# type-check only; Bun runs TS directly
RUN bun run --bun tsc --noEmit

# --- Runtime ---
FROM base AS runtime
ENV NODE_ENV=production

COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/src ./src
COPY --from=build /app/package.json ./
COPY --from=build /app/tsconfig.json ./
COPY --from=build /app/drizzle ./drizzle

EXPOSE 3000
USER bun
CMD ["bun", "run", "src/index.ts"]
