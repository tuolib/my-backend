# Hono API: Local = Production

这个版本聚焦以下目标：
- Docker Swarm 部署（单机/多机）
- API 多实例
- PostgreSQL 主从（写主读从）
- PgBouncer 连接池（rw/ro 分离）
- Redis
- Caddy 网关
- GitHub Actions 自动构建与发布

## 1. Swarm 本地同构开发（多 API + 多数据库）

本地 Swarm 详细手册见：[README-swarm.md](./README-swarm.md)

快速入口：
- 单机最快跑通：[`README-swarm.md` 单机章节](./README-swarm.md#swarm-local-single)
- 多机完整演练：[`README-swarm.md` 多机章节](./README-swarm.md#swarm-local-multi)
- 数据库操作（主从验证）：[`README-swarm.md` 数据库章节](./README-swarm.md#swarm-db-ops)

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

## 8. WSL DNS 问题修复记录（已恢复）

问题现象（历史）：
- WSL 内网络解析失败，常见表现为 `Temporary failure in name resolution`。

当时的处理方式：
1. 在 `/etc/wsl.conf` 关闭自动生成 `resolv.conf`：

```ini
[network]
generateResolvConf = false
```

2. 重启 WSL（Windows 侧执行）：

```powershell
wsl --shutdown
```

3. 在 WSL 内手动写入 DNS（`/etc/resolv.conf`）：

```conf
nameserver 1.1.1.1
nameserver 8.8.8.8
```

4. 验证解析恢复（示例）：

```bash
getent hosts github.com
curl -I https://registry.npmjs.org
```

当前状态：
- 目前 DNS 已恢复正常，可继续按上述配置作为同类问题的固定解法。
