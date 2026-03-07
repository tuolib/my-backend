# Swarm 部署操作手册

## Step 1: 生成 SSH Key（本地电脑）

```bash
ssh-keygen -t ed25519 -f ~/.ssh/vultr-key -N ""
```

- `~/.ssh/vultr-key` — 私钥
- `~/.ssh/vultr-key.pub` — 公钥

## Step 2: Vultr 创建 5 台服务器

1. 控制台 → Deploy → Add SSH Key → 粘贴 `~/.ssh/vultr-key.pub` 的内容
2. 创建 5 台服务器，Authentication 都选这个 SSH Key
3. 记下 5 个 IP

## Step 3: 初始化集群（只 SSH 到 S1）

```bash
ssh -i ~/.ssh/vultr-key root@<S1-IP>

curl -fsSL https://raw.githubusercontent.com/<你的用户名>/my-backend/main/infra/swarm/init-node.sh \
  | bash -s -- <S1-IP> <S2-IP> <S3-IP> <S4-IP> <S5-IP>
```

## Step 4: 配置 GitHub

仓库 Settings → Secrets and variables → Actions

**Secrets**（加密存储）：

| Secret | 值 |
|--------|------|
| `SWARM_SSH_KEY` | `~/.ssh/vultr-key` 私钥内容 |
| `GHCR_PAT` | GitHub Personal Access Token |
| `SWARM_POSTGRES_PASSWORD` | 自定义密码 |
| `SWARM_JWT_ACCESS_SECRET` | 自定义密钥 |
| `SWARM_JWT_REFRESH_SECRET` | 自定义密钥 |
| `SWARM_INTERNAL_SECRET` | 自定义密钥 |

> GHCR_PAT: GitHub → Settings → Developer settings → Personal access tokens → 勾选 `read:packages`

**Variables**（明文配置）：

| Variable | 值 |
|----------|------|
| `SWARM_HOST` | S1 的 IP |
| `SWARM_USER` | `root` |
| `CERTBOT_DOMAIN` | `api.find345.site` |
| `CERTBOT_EMAIL` | 你的邮箱 |
| `CORS_ORIGINS` | 前端域名（可选） |

## Step 5: DNS

域名管理后台，添加 3 条 A 记录：

| 主机记录 | 记录值 |
|---------|--------|
| `api` | S3 的 IP |
| `api` | S4 的 IP |
| `api` | S5 的 IP |

## Step 6: 触发部署

GitHub → Actions → Build & Deploy → Run workflow → Platform 选 `swarm` → Run
