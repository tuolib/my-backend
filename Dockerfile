# ─── Stage 1: 安装依赖 ────────────────────────────────────────────────────────
FROM oven/bun:1-alpine AS deps
WORKDIR /app

COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile --production

# ─── Stage 2: 构建（类型检查 / 可选编译步骤） ─────────────────────────────────
FROM oven/bun:1-alpine AS builder
WORKDIR /app

# 复制全部依赖（含 devDependencies，用于 tsc）
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile

COPY . .

# 类型检查：构建时即暴露类型错误
RUN bunx tsc --noEmit

# ─── Stage 3: 生产运行时 ──────────────────────────────────────────────────────
FROM oven/bun:1-alpine AS runner
WORKDIR /app

# 只复制生产依赖和源码
COPY --from=deps    /app/node_modules  ./node_modules
COPY --from=builder /app/src           ./src
# migrate.ts 从 migrations/ 目录读取 SQL 文件
COPY --from=builder /app/migrations    ./migrations
# 运维脚本
COPY --from=builder /app/scripts       ./scripts
COPY package.json tsconfig.json        ./

# 以非 root 用户运行，遵循最小权限原则
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
USER appuser

EXPOSE 3000

# tini 风格：bun 已内置信号处理，直接 exec
CMD ["bun", "run", "src/index.ts"]
