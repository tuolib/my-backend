# GitHub Actions + Deploy 脚本模板（草案，不改现网）

本文件用于沉淀「一键发布」方案模板。  
当前仓库不会自动启用本模板，除非你手动落地到 `.github/workflows/` 和 `scripts/`。

## 1. 目标

1. 代码 push 到 `main` 后，自动构建镜像并部署到服务器。
2. 支持手动触发部署（`workflow_dispatch`）。
3. 发布后自动健康检查，失败立即报错。

## 2. 前置条件（一次性）

1. 域名已解析：`api.example.com`（或你自己的域名）
2. 服务器已安装 Docker / Docker Compose
3. GitHub Runner 方案二选一：
   - self-hosted runner（推荐）
   - GitHub-hosted + SSH 远程执行
4. 服务器已可拉取镜像仓库（如 GHCR）

## 3. 建议的 GitHub Secrets / Variables

Secrets:
1. `SSH_PRIVATE_KEY`
2. `SERVER_HOST`
3. `SERVER_USER`
4. `GHCR_PAT`（如需）
5. `JWT_SECRET`

Variables:
1. `APP_DOMAIN`（例如 `api.example.com`）
2. `DEPLOY_PATH`（例如 `/opt/ho`）
3. `IMAGE_NAME`（例如 `ho-api`）
4. `LOG_LEVEL`（例如 `info`）

## 4. Workflow 模板（GitHub-hosted + SSH）

保存为：`.github/workflows/deploy-template.yml`（模板文件，不直接替换现有 deploy）

```yaml
name: Deploy Template

on:
  workflow_dispatch:
  push:
    branches: [main]

permissions:
  contents: read
  packages: write

env:
  IMAGE_NAME: ${{ vars.IMAGE_NAME || 'ho-api' }}

jobs:
  build_and_deploy:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup Docker Buildx
        uses: docker/setup-buildx-action@v3

      - name: Login GHCR
        uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - name: Compute image
        id: vars
        run: |
          OWNER_LC=$(echo "${GITHUB_REPOSITORY_OWNER}" | tr '[:upper:]' '[:lower:]')
          echo "repo=ghcr.io/${OWNER_LC}/${IMAGE_NAME}" >> "$GITHUB_OUTPUT"
          echo "tag=${GITHUB_SHA::12}" >> "$GITHUB_OUTPUT"

      - name: Build & Push
        uses: docker/build-push-action@v6
        with:
          context: .
          push: true
          tags: |
            ${{ steps.vars.outputs.repo }}:${{ steps.vars.outputs.tag }}
            ${{ steps.vars.outputs.repo }}:latest

      - name: Setup SSH
        uses: webfactory/ssh-agent@v0.9.0
        with:
          ssh-private-key: ${{ secrets.SSH_PRIVATE_KEY }}

      - name: Add host key
        run: ssh-keyscan -H "${{ secrets.SERVER_HOST }}" >> ~/.ssh/known_hosts

      - name: Remote deploy
        run: |
          ssh "${{ secrets.SERVER_USER }}@${{ secrets.SERVER_HOST }}" \
            "cd ${{ vars.DEPLOY_PATH }} && \
             IMAGE_REPO=${{ steps.vars.outputs.repo }} \
             IMAGE_TAG=${{ steps.vars.outputs.tag }} \
             APP_DOMAIN=${{ vars.APP_DOMAIN }} \
             LOG_LEVEL=${{ vars.LOG_LEVEL || 'info' }} \
             bash scripts/deploy.sh"
```

## 5. deploy 脚本模板（服务器）

保存为：`scripts/deploy.sh`

```bash
#!/usr/bin/env bash
set -euo pipefail

: "${IMAGE_REPO:?missing IMAGE_REPO}"
: "${IMAGE_TAG:?missing IMAGE_TAG}"
: "${APP_DOMAIN:?missing APP_DOMAIN}"

echo "[deploy] image: ${IMAGE_REPO}:${IMAGE_TAG}"

cat > .env.deploy <<EOF
IMAGE_REPOSITORY=${IMAGE_REPO}
IMAGE_TAG=${IMAGE_TAG}
APP_DOMAIN=${APP_DOMAIN}
LOG_LEVEL=${LOG_LEVEL:-info}
EOF

docker login ghcr.io -u "${GITHUB_ACTOR:-token}" -p "${GHCR_PAT:-}"
docker compose --env-file .env.deploy pull
docker compose --env-file .env.deploy up -d --remove-orphans

echo "[deploy] health check"
for i in $(seq 1 30); do
  if curl -fsS --max-time 5 "https://${APP_DOMAIN}/healthz" >/dev/null; then
    echo "[deploy] success"
    exit 0
  fi
  sleep 5
done

echo "[deploy] failed"
exit 1
```

## 6. 回滚模板

```bash
IMAGE_TAG=<old_tag> bash scripts/deploy.sh
```

建议额外实现：
1. 部署前记录当前 tag 到 `releases/last_successful`
2. 健康检查失败时自动回滚到上一个成功 tag

## 7. 日志与观测建议

1. 应用日志统一 JSON（已支持 `requestId`）。
2. 部署脚本输出关键步骤：镜像 tag、容器状态、健康检查结果。
3. 发布后在 Grafana 以 `requestId` 和 `level=error` 做快速验证。

## 8. 启用方式（手动）

1. 先在测试环境创建 `deploy-template.yml`、`scripts/deploy.sh`。
2. 配好 Secrets/Variables。
3. 用 `workflow_dispatch` 人工触发一次验证。
4. 验证通过后，再决定是否切换主部署流程。
