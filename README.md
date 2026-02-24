# Hono API: Local = Production

这个版本已经按以下目标重构：
- Kubernetes 部署（Helm）
- API 蓝绿发布（blue/green）
- PostgreSQL 主从（写主读从）
- PgBouncer 连接池（rw/ro 分离）
- Redis
- Caddy 网关
- GitHub Actions 自动构建与发布

## 1. 本地开发（快速模式）

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

## 2. 本地开发（生产同构：kind + Helm）

### 前置
- Docker
- kind
- kubectl
- helm

### 一键启动
```bash
bun run k8s:kind:up
```

访问：
- `http://api.localtest.me`

### 关闭
```bash
bun run k8s:kind:down
```

相关文件：
- Helm Chart: `charts/ho-stack`
- kind 配置: `scripts/kind/kind-config.yaml`
- 本地 values: `charts/ho-stack/values-local.yaml`

## 3. 架构要点

- API：`api-blue` / `api-green` 双 Deployment。
- 切流：`Service ...-api-active` 的 selector `color=blue|green`。
- PostgreSQL：`primary`（写） + `replica`（读）。
- PgBouncer：
  - `pgbouncer-rw` -> primary
  - `pgbouncer-ro` -> replica
- 应用连接：
  - `DATABASE_WRITE_URL`
  - `DATABASE_READ_URL`
  - `REDIS_URL`
- 探针：
  - liveness: `/healthz`
  - readiness: `/readyz`（检查 DB + Redis）

## 4. 生产部署（GitHub Actions）

工作流：`.github/workflows/deploy.yml`

流程：
1. Build 镜像并推送 GHCR。
2. 执行 `scripts/deploy/bluegreen-k8s.sh`：
   - 判定当前 active color
   - 部署闲置 color 新版本
   - 跑迁移 `bun run migrate`
   - 就绪后切换 Service selector
   - 老 color 缩容为 standby

### 必需 Secrets
- `KUBE_CONFIG_DATA`：base64 编码 kubeconfig
- `K8S_NAMESPACE`：默认 `ho`
- `K8S_RELEASE_NAME`：默认 `ho`
- `K8S_VALUES_FILE`：默认 `./charts/ho-stack/values-prod.yaml`
- `K8S_API_ACTIVE_REPLICAS`：默认 `4`
- `K8S_API_STANDBY_REPLICAS`：默认 `1`

> 注意：生产环境请把 `values-prod.yaml` 中数据库和 JWT 密码改为真实强密码，并建议改为外部 Secret 管理（如 External Secrets / Vault）。

## 5. 迁移策略

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
5. 灰度+蓝绿完成后清理旧字段
