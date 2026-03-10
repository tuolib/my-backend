# 单机部署指南（Single Server）

> 适用于学习/演示环境，1 台 2 核 2G 服务器即可运行。

---

## 目录

1. [服务器要求](#1-服务器要求)
2. [购买服务器](#2-购买服务器)
3. [域名解析](#3-域名解析)
4. [服务器初始化](#4-服务器初始化)
5. [配置 GitHub Secrets](#5-配置-github-secrets)
6. [配置 GitHub Variables](#6-配置-github-variables)
7. [触发部署](#7-触发部署)
8. [验证部署](#8-验证部署)
9. [日常运维](#9-日常运维)
10. [常见问题](#10-常见问题)

---

## 1. 服务器要求

| 资源 | 最低配置 |
|------|---------|
| CPU | 2 核 |
| 内存 | 2 GB |
| 磁盘 | 20 GB SSD |
| 系统 | Ubuntu 22.04 / 24.04 |
| 网络 | 公网 IP，开放 80/443 端口 |

---

## 2. 购买服务器

任意云厂商均可，推荐：

- 阿里云轻量应用服务器
- 腾讯云轻量应用服务器
- Vultr / DigitalOcean / Hetzner

购买时选择 **Ubuntu 22.04 / 24.04** 系统镜像，创建后记录：

- 服务器公网 IP（例如 `123.45.67.89`）
- SSH 登录方式（密码或密钥）

---

## 3. 域名解析

在域名服务商后台添加 **A 记录**：

| 记录类型 | 主机记录 | 记录值 | TTL |
|---------|---------|--------|-----|
| A | api（或你想要的子域名） | `123.45.67.89` | 600 |

例如域名是 `example.com`，添加后访问地址为 `api.example.com`。

验证解析是否生效：

```bash
# 在本地终端执行
dig api.example.com

# 应返回你的服务器 IP
```

> 解析生效通常需要 1-10 分钟，国内域名可能需要更长时间。

---

## 4. 服务器初始化

### 4.1 SSH 登录服务器

```bash
ssh root@123.45.67.89
```

### 4.2 生成 SSH 密钥对（用于 GitHub Actions 免密部署）

如果服务器上还没有 SSH 密钥：

```bash
ssh-keygen -t ed25519 -C "github-actions" -f ~/.ssh/id_ed25519 -N ""
```

将公钥添加到 `authorized_keys`，允许 GitHub Actions SSH 连接：

```bash
cat ~/.ssh/id_ed25519.pub >> ~/.ssh/authorized_keys
```

复制**私钥**内容，后面配置 GitHub Secrets 时需要：

```bash
cat ~/.ssh/id_ed25519
```

> 复制完整输出，包括 `-----BEGIN` 和 `-----END` 行。

### 4.3 运行初始化脚本

```bash
# 下载并执行初始化脚本（替换为你的域名）
curl -fsSL https://raw.githubusercontent.com/你的用户名/你的仓库名/main/infra/single-server/init-server.sh -o init-server.sh
bash init-server.sh api.example.com
```

或者手动执行以下步骤：

```bash
# 安装 Docker
curl -fsSL https://get.docker.com | sh
systemctl enable --now docker

# 防火墙
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

# 创建部署目录 + 自签 SSL
mkdir -p /opt/ecom/ssl
openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
    -keyout /opt/ecom/ssl/privkey.pem \
    -out /opt/ecom/ssl/fullchain.pem \
    -subj "/CN=api.example.com" 2>/dev/null

# Docker 垃圾清理定时任务
(crontab -l 2>/dev/null; echo '0 3 * * * docker system prune -af --filter "until=72h" >/dev/null 2>&1') | crontab -
```

### 4.4 验证 Docker 安装

```bash
docker --version
docker compose version
```

---

## 5. 配置 GitHub Secrets

进入 GitHub 仓库 → **Settings** → **Secrets and variables** → **Actions** → **Secrets** → **New repository secret**

逐个添加以下 Secrets：

| Secret 名称 | 值 | 说明 |
|-------------|---|------|
| `SINGLE_SSH_KEY` | 步骤 4.2 复制的私钥内容 | SSH 私钥，用于 CI 连接服务器 |
| `GHCR_PAT` | GitHub PAT | 拉取 Docker 镜像用（见下方说明） |
| `SINGLE_POSTGRES_PASSWORD` | 自定义强密码 | 数据库密码 |
| `SINGLE_JWT_ACCESS_SECRET` | 随机字符串（32+ 位） | JWT 签名密钥 |
| `SINGLE_JWT_REFRESH_SECRET` | 随机字符串（32+ 位） | JWT 刷新密钥 |
| `SINGLE_INTERNAL_SECRET` | 随机字符串（32+ 位） | 服务间通信密钥 |

### 生成随机密码

```bash
# 在本地终端执行，生成 4 个随机密码
for i in 1 2 3 4; do openssl rand -base64 32; done
```

### 创建 GHCR_PAT（GitHub Personal Access Token）

1. 打开 https://github.com/settings/tokens?type=beta
2. **Generate new token**
3. Token name: `ghcr-deploy`
4. Expiration: 选择合适的过期时间
5. Repository access: 选择你的仓库
6. Permissions → **Packages** → **Read**
7. 点击 **Generate token**，复制 token

---

## 6. 配置 GitHub Variables

进入 GitHub 仓库 → **Settings** → **Secrets and variables** → **Actions** → **Variables** → **New repository variable**

逐个添加以下 Variables：

| Variable 名称 | 示例值 | 说明 |
|---------------|--------|------|
| `SINGLE_HOST` | `123.45.67.89` | 服务器公网 IP |
| `SINGLE_USER` | `root` | SSH 用户名（默认 root） |
| `SINGLE_DOMAIN` | `api.example.com` | 你的域名 |
| `SINGLE_EMAIL` | `you@example.com` | Let's Encrypt 证书邮箱 |

---

## 7. 触发部署

### 方式一：手动触发（推荐首次使用）

1. 进入 GitHub 仓库 → **Actions** → **Build & Deploy**
2. 点击右侧 **Run workflow**
3. 目标平台选择 **single-server**
4. Image tag 留空（自动使用 commit SHA）
5. 点击 **Run workflow**

### 方式二：自动触发

默认 push 到 main 会部署到 Swarm。如需改为自动部署到 single-server，修改 `.github/workflows/deploy.yml`：

```yaml
env:
  PLATFORM: ${{ inputs.platform || 'single-server' }}  # 改这里
```

### 部署流程（自动执行，无需干预）

```
[1/7] 上传配置文件到服务器
[2/7] 检查自签 SSL 证书
[3/7] 登录 GHCR 镜像仓库
[4/7] 写入环境变量
[5/7] 拉取 Docker 镜像
[6/7] Docker Compose 启动服务
[7/7] 等待健康检查 + 数据库迁移
```

---

## 8. 验证部署

### 8.1 查看 GitHub Actions 日志

进入 **Actions** 页面，点击最新的 workflow run，查看每个步骤的执行结果。

### 8.2 SSH 到服务器检查

```bash
ssh root@123.45.67.89

# 查看所有容器状态
cd /opt/ecom
docker compose -f docker-compose.prod.yml ps

# 所有容器应显示 healthy 状态
```

### 8.3 测试 API

```bash
# 健康检查（在本地终端执行）
curl -X POST https://api.example.com/health

# 预期返回
# {"code":200,"success":true,"data":{"status":"ok",...}}
```

### 8.4 检查 SSL 证书

```bash
# 查看证书信息
curl -vI https://api.example.com 2>&1 | grep -E "subject|issuer|expire"
```

> 首次部署使用自签证书，Certbot 会在几分钟内自动申请 Let's Encrypt 真实证书。

---

## 9. 日常运维

SSH 登录服务器后，使用 `ops.sh` 运维工具：

```bash
# 上传 ops.sh 到服务器（首次）
scp infra/single-server/ops.sh root@123.45.67.89:/opt/ecom/

# SSH 到服务器
ssh root@123.45.67.89
```

### 查看状态

```bash
bash /opt/ecom/ops.sh status
```

输出包括：容器状态、CPU/内存占用、磁盘使用、SSL 证书信息。

### 查看日志

```bash
# 所有服务日志（最近 50 行）
bash /opt/ecom/ops.sh logs

# 指定服务日志
bash /opt/ecom/ops.sh logs api-gateway
bash /opt/ecom/ops.sh logs postgres
bash /opt/ecom/ops.sh logs nginx

# 指定行数
bash /opt/ecom/ops.sh logs api-gateway 100
```

### 重启服务

```bash
# 重启所有应用服务（不影响数据库）
bash /opt/ecom/ops.sh restart

# 重启单个服务
bash /opt/ecom/ops.sh restart api-gateway
```

### 手动刷新 SSL 证书

```bash
bash /opt/ecom/ops.sh reload-ssl
```

### 完全重置（危险：清除所有数据）

```bash
bash /opt/ecom/ops.sh reset
```

### 手动更新部署

如果不想通过 GitHub Actions，也可以手动更新：

```bash
cd /opt/ecom

# 编辑 .env 更新镜像 TAG
vim .env

# 拉取新镜像
docker compose -f docker-compose.prod.yml pull

# 滚动更新
docker compose -f docker-compose.prod.yml up -d
```

---

## 10. 常见问题

### Q: 部署后访问返回 502 Bad Gateway

API Gateway 还在启动中，等待 30 秒后重试。查看日志排查：

```bash
docker compose -f docker-compose.prod.yml logs api-gateway --tail 30
```

### Q: SSL 证书是自签的，浏览器提示不安全

Certbot 需要几分钟申请真实证书。检查 Certbot 日志：

```bash
docker compose -f docker-compose.prod.yml logs certbot --tail 30
```

常见原因：
- DNS 解析未生效 → `dig api.example.com` 检查
- 80 端口未开放 → 检查防火墙和云服务商安全组
- 域名使用了 CDN → 先关闭代理，等证书申请成功后再开启

### Q: 数据库迁移失败

手动执行迁移：

```bash
cd /opt/ecom
docker compose -f docker-compose.prod.yml exec api-gateway \
    bun run packages/database/src/migrate.ts
```

### Q: 服务器内存不足

查看内存使用：

```bash
free -h
docker stats --no-stream
```

如果 OOM，可以减少 PG 内存。编辑 `/opt/ecom/postgresql.conf`：

```
shared_buffers = 128MB
effective_cache_size = 384MB
```

然后重启：

```bash
docker compose -f docker-compose.prod.yml restart postgres
```

### Q: 如何备份数据库

```bash
# 导出数据库
docker compose -f docker-compose.prod.yml exec postgres \
    pg_dump -U postgres ecommerce > backup_$(date +%Y%m%d).sql

# 恢复数据库
docker compose -f docker-compose.prod.yml exec -T postgres \
    psql -U postgres ecommerce < backup_20260310.sql
```

### Q: 如何查看 Redis 数据

```bash
docker compose -f docker-compose.prod.yml exec redis redis-cli

# 常用命令
> DBSIZE          # 查看 key 数量
> KEYS stock:*    # 查看库存相关 key
> INFO memory     # 查看内存使用
```
