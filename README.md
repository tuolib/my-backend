# Hono API: Local = Production

这个版本聚焦以下目标：
- Docker Swarm 部署（单机/多机）
- API 多实例
- PostgreSQL 主从（写主读从）
- PgBouncer 连接池（rw/ro 分离）
- Redis
- Caddy 网关
- GitHub Actions 自动构建与发布

## 2. 本地开发（快速模式）

```bash
bun run dev
```

常用命令：

```bash
bun run dr
bun run stop
bun run down
bun run migrate
bun run migrate:down
```

## 3. 本地开发（生产同构模拟）

使用 `docker-compose.sim.yml` 模拟多 API、多数据库与网关：

```bash
bun run sim:up
bun run sim:migrate
bun run sim:down
bun run sim:clean
```

## 4. Swarm 部署（多机/单机）

完整 Swarm 方案见：
- [README-swarm.md](./README-swarm.md)
- `swarm/stack.yml`
- `swarm/stack-single.yml`
- `scripts/swarm/deploy-stack.sh`
- `.github/workflows/deploy.yml`

## 5. 日志方案（本地 + 服务器）

日志实操文档见：
- [README-logging.md](./README-logging.md)

快速命令：

```bash
bun run log:up
bun run log:tail
bun run log:down
```

## 6. 生产部署（GitHub Actions）

工作流：`.github/workflows/deploy.yml`

流程：
1. `push` / `pull_request` 到 `main`：自动 `bun install` + `tsc --noEmit` + Docker Build。
2. 非 `pull_request` 场景会推送镜像到 GHCR。
3. 在 self-hosted `swarm-manager` runner 上执行 `scripts/swarm/deploy-stack.sh`。
4. 发布后执行公网健康检查（`/healthz`）。

## 7. 迁移策略

迁移脚本：`src/db/migrate.ts`

```bash
bun run migrate
bun run migrate:down
```

线上变更建议执行 Expand-Contract：
1. 先加可空字段（向后兼容）
2. 回填数据
3. 加默认值
4. 加约束（NOT NULL / CHECK）
5. 灰度完成后清理旧字段
