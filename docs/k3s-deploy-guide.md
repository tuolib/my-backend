# K3s 部署指南（GitHub Actions 自动化）

> 面向新手的一步一步操作手册。
> 假设你有一台低配 VPS（1 CPU / 1 GB 内存），一个 GitHub 仓库，一个域名。

---

## 目录

1. [前置准备](#1-前置准备)
2. [VPS 基础配置](#2-vps-基础配置)
3. [GitHub 配置 Secrets 和 Variables](#3-github-配置-secrets-和-variables)
4. [运行 K3s 集群初始化 Workflow](#4-运行-k3s-集群初始化-workflow)
5. [运行 Build & Deploy Workflow](#5-运行-build--deploy-workflow)
6. [验证部署结果](#6-验证部署结果)
7. [常见问题排查](#7-常见问题排查)

---

## 1. 前置准备

### 你需要的东西

| 项目 | 说明 |
|------|------|
| **VPS** | 至少 1 CPU / 1 GB 内存 / 10 GB 磁盘，推荐 Ubuntu 22.04 |
| **GitHub 仓库** | 已推送本项目代码到 main 分支 |
| **域名**（可选） | 如 `api.find345.site`，已指向 VPS 的 IP |
| **SSH 密钥对** | 用于 GitHub Actions SSH 到 VPS |

### 生成 SSH 密钥对（如果还没有）

在你的**本地电脑**执行：

```bash
# 生成专用密钥对（不要设密码，直接回车）
ssh-keygen -t ed25519 -f ~/.ssh/k3s_deploy -C "github-actions-k3s"
```

这会生成两个文件：
- `~/.ssh/k3s_deploy` — **私钥**（待会配置到 GitHub Secrets）
- `~/.ssh/k3s_deploy.pub` — **公钥**（待会配置到 VPS）

---

## 2. VPS 基础配置

SSH 登录到你的 VPS：

```bash
ssh root@你的VPS_IP
```

### 2.1 把公钥添加到 VPS

```bash
# 在 VPS 上执行（把下面的内容替换为你的公钥）
mkdir -p ~/.ssh
echo "你的公钥内容（~/.ssh/k3s_deploy.pub 的内容）" >> ~/.ssh/authorized_keys
chmod 700 ~/.ssh
chmod 600 ~/.ssh/authorized_keys
```

> **验证**：在本地执行 `ssh -i ~/.ssh/k3s_deploy root@你的VPS_IP`，应能免密登录。

### 2.2 确保防火墙放行端口

```bash
# 如果用 ufw
ufw allow 22/tcp     # SSH
ufw allow 80/tcp     # HTTP（Let's Encrypt 验证用）
ufw allow 443/tcp    # HTTPS
ufw allow 6443/tcp   # K3s API（多节点需要，单节点可选）
```

### 2.3 创建工作目录

```bash
mkdir -p /opt/ecom/infra/k3s/cluster-setup
```

完成后**退出 VPS**，回到本地电脑继续操作。

---

## 3. GitHub 配置 Secrets 和 Variables

打开浏览器，进入你的 GitHub 仓库页面。

### 3.1 进入设置页面

```
仓库页面 → Settings（顶部标签）→ 左侧菜单 Secrets and variables → Actions
```

### 3.2 添加 Secrets

点击 **"New repository secret"** 按钮，逐个添加以下 Secrets：

#### 集群初始化用（K3s Cluster Setup Workflow）

| Name | Value | 说明 |
|------|-------|------|
| `K3S_SSH_KEY` | 私钥文件内容 | 执行 `cat ~/.ssh/k3s_deploy`，复制全部内容（包括 BEGIN 和 END 行） |

#### 部署用（Build & Deploy Workflow）

| Name | Value | 说明 |
|------|-------|------|
| `K3S_SSH_HOST` | `你的VPS_IP` | 如 `203.0.113.10` |
| `K3S_SSH_USER` | `root` | SSH 用户名 |
| `K3S_SSH_KEY` | 同上 | 如果已添加则跳过（和上面是同一个） |
| `K3S_POSTGRES_PASSWORD` | 自己想一个 | 至少 8 位，如 `MyPgPass2024!` |
| `K3S_REPLICATION_PASSWORD` | 自己想一个 | 至少 8 位，如 `MyReplPass2024!` |
| `K3S_JWT_ACCESS_SECRET` | 自己想一个 | 至少 16 位，如 `my-jwt-access-secret-key-2024` |
| `K3S_JWT_REFRESH_SECRET` | 自己想一个 | 至少 16 位，如 `my-jwt-refresh-secret-key-2024` |
| `K3S_INTERNAL_SECRET` | 自己想一个 | 至少 8 位，如 `InternalSvc2024!` |
| `GHCR_PAT` | GitHub Token | 见下方说明 |

> **快速生成安全密码**：在终端执行 `openssl rand -base64 24`，每次生成一个不同的。

#### 如何获取 GHCR_PAT

1. 打开 https://github.com/settings/tokens
2. 点击 **"Generate new token (classic)"**
3. 勾选权限：`read:packages`、`write:packages`
4. 点击 **"Generate token"**
5. 复制生成的 token，粘贴为 `GHCR_PAT` 的值

### 3.3 添加 Variables

点击顶部 **"Variables"** 标签（在 Secrets 旁边），点击 **"New repository variable"**：

| Name | Value | 说明 |
|------|-------|------|
| `K3S_S1_HOST` | `你的VPS_IP` | 如 `203.0.113.10`（和 K3S_SSH_HOST 一样） |

> 单节点部署只需要这一个 Variable。多节点的 `K3S_S2_HOST`、`K3S_A1_HOST` 等**不需要添加**。

### 3.4 检查清单

确认你已添加以下内容（打勾确认）：

```
Secrets（共 9 个）：
 ☐ K3S_SSH_KEY
 ☐ K3S_SSH_HOST
 ☐ K3S_SSH_USER
 ☐ K3S_POSTGRES_PASSWORD
 ☐ K3S_REPLICATION_PASSWORD
 ☐ K3S_JWT_ACCESS_SECRET
 ☐ K3S_JWT_REFRESH_SECRET
 ☐ K3S_INTERNAL_SECRET
 ☐ GHCR_PAT

Variables（共 1 个）：
 ☐ K3S_S1_HOST
```

---

## 4. 运行 K3s 集群初始化 Workflow

这一步会 SSH 到你的 VPS，自动安装 k3s + 所有 Operator。

### 4.1 打开 Actions 页面

```
仓库页面 → Actions（顶部标签）
```

### 4.2 找到 "K3s Cluster Setup" Workflow

在左侧 Workflow 列表中，点击 **"K3s Cluster Setup"**。

### 4.3 运行 Workflow

1. 点击右侧 **"Run workflow"** 按钮
2. 弹出配置框：
   - **集群模式**：选择 `single`（单节点）
   - **执行到哪一步**：选择 `all`（全部执行）
3. 点击绿色 **"Run workflow"** 按钮

### 4.4 等待执行完成

点击刚创建的运行记录，查看实时日志。

```
执行流程（约 5-10 分钟）：
  01 Install Server (S1)     ← 安装 k3s
  02 Join Server             ← 跳过（单节点无需）
  03 Join Agent              ← 跳过（单节点无需）
  04 Install Operators (S1)  ← 安装 PG/Redis/Ingress 等 Operator
  Verify Cluster             ← 验证集群状态
```

### 4.5 确认成功

**"Verify Cluster"** Job 应显示类似输出：

```
══════════ Nodes ══════════
NAME     STATUS   ROLES                  AGE   VERSION
vps123   Ready    control-plane,master   5m    v1.29.2+k3s1

══════════ Cluster Ready ══════════
1/1 nodes ready
✓ k3s 集群初始化成功！
```

> **如果失败了**：看哪个 Job 报错，点进去看详细日志。常见原因见 [第 7 节](#7-常见问题排查)。

---

## 5. 运行 Build & Deploy Workflow

集群就绪后，部署应用服务。

### 5.1 找到 "Build & Deploy" Workflow

在 Actions 左侧列表中，点击 **"Build & Deploy"**。

### 5.2 运行 Workflow

1. 点击右侧 **"Run workflow"** 按钮
2. 弹出配置框：
   - **目标平台**：选择 `k3s`
   - **Custom image tag**：留空（自动使用 commit SHA）
3. 点击绿色 **"Run workflow"** 按钮

### 5.3 等待执行完成

```
执行流程（约 10-15 分钟）：
  Type check           ← TypeScript 类型检查
  Build (5 个服务)     ← 并行构建 Docker 镜像，推送到 GHCR
  Deploy to k3s        ← SSH 到 VPS，Helm 部署
  Smoke test           ← 健康检查
```

### 5.4 确认成功

**"Deploy to k3s"** Job 应显示：

```
══════════════════════════════════════════
Deploying ecom to k3s (tag: a1b2c3d4e5f6)
══════════════════════════════════════════

...

══════════ Pod Status ══════════
NAME                                  READY   STATUS    AGE
ecom-api-gateway-xxx                  1/1     Running   30s
ecom-user-service-xxx                 1/1     Running   30s
ecom-product-service-xxx              1/1     Running   30s
ecom-cart-service-xxx                 1/1     Running   30s
ecom-order-service-xxx                1/1     Running   30s
ecom-pg-1                             1/1     Running   60s
ecom-redis-replication-0              1/1     Running   45s
```

> **Smoke Test 失败但 Deploy 成功？** 这可能是 DNS 还没生效或 TLS 证书还在申请中，不影响实际部署。等几分钟后手动验证即可。

---

## 6. 验证部署结果

### 6.1 SSH 到 VPS 手动检查

```bash
ssh root@你的VPS_IP

# 设置 kubeconfig（每次 SSH 登录后执行一次）
export KUBECONFIG=/etc/rancher/k3s/k3s.yaml

# 查看所有 Pod 状态（应全部 Running）
kubectl get pods -n ecom

# 查看服务
kubectl get svc -n ecom

# 查看 Ingress
kubectl get ingress -n ecom

# 查看 TLS 证书状态
kubectl get certificate -n ecom

# 查看 PG 集群状态
kubectl get cluster -n ecom

# 看某个 Pod 的日志（替换 Pod 名）
kubectl logs -n ecom ecom-api-gateway-xxx
```

### 6.2 测试 API（如果域名已配置）

```bash
# 健康检查
curl -X POST https://api.find345.site/health

# 应返回类似：
# {"code":200,"success":true,"data":{"status":"ok"},...}
```

### 6.3 测试 API（如果没有域名）

```bash
# 在 VPS 上直接访问 api-gateway 的 ClusterIP
kubectl get svc -n ecom ecom-api-gateway
# 记下 CLUSTER-IP，如 10.43.x.x

curl -X POST http://10.43.x.x:3000/health
```

---

## 7. 常见问题排查

### Q: 01 Install Server 失败 — "Permission denied"

**原因**：SSH 密钥不对，或 VPS 没有添加公钥。

**解决**：
```bash
# 在本地验证能否 SSH
ssh -i ~/.ssh/k3s_deploy root@你的VPS_IP

# 如果不行，重新在 VPS 上添加公钥
```

### Q: 04 Install Operators 失败 — 超时

**原因**：VPS 内存不足，Operator Pod 无法启动。

**解决**：
```bash
# SSH 到 VPS 查看
export KUBECONFIG=/etc/rancher/k3s/k3s.yaml
kubectl get pods -A
kubectl describe pod <pending的pod> -n <namespace>

# 如果是内存不足，考虑增加 swap
fallocate -l 2G /swapfile
chmod 600 /swapfile
mkswap /swapfile
swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab
```

### Q: Deploy 失败 — "Helm: unable to connect"

**原因**：VPS 上 `kubectl` / `helm` 未正确配置。

**解决**：
```bash
# SSH 到 VPS 检查
export KUBECONFIG=/etc/rancher/k3s/k3s.yaml
kubectl cluster-info
helm version

# 如果 helm 未安装
curl -fsSL https://raw.githubusercontent.com/helm/helm/main/scripts/get-helm-3 | bash
```

### Q: Deploy 失败 — "ImagePullBackOff"

**原因**：GHCR_PAT 不对，或镜像不存在。

**解决**：
```bash
# SSH 到 VPS 查看错误详情
export KUBECONFIG=/etc/rancher/k3s/k3s.yaml
kubectl describe pod <失败的pod> -n ecom

# 检查 GHCR_PAT 是否有 read:packages 权限
# 检查镜像名是否正确（看 GitHub Packages 页面）
```

### Q: Smoke Test 失败 — "Health check failed"

**原因**：通常是 TLS 证书还没申请完，或 DNS 没生效。

**解决**：
```bash
# 检查证书状态
export KUBECONFIG=/etc/rancher/k3s/k3s.yaml
kubectl get certificate -n ecom
kubectl describe certificate -n ecom

# 检查 cert-manager 日志
kubectl logs -n cert-manager deployment/cert-manager

# 如果域名还没配置，Smoke Test 失败是正常的
```

### Q: Pod 状态一直 Pending

**原因**：资源不足，或 StorageClass 有问题。

**解决**：
```bash
export KUBECONFIG=/etc/rancher/k3s/k3s.yaml

# 查看 Pod 事件
kubectl describe pod <pod名> -n ecom

# 检查 StorageClass
kubectl get storageclass

# 检查 PVC 状态
kubectl get pvc -n ecom
```

### Q: 如何重新部署（代码更新后）

两种方式：

1. **自动**：push 代码到 main 分支（默认走 k8s），或手动触发 workflow 选择 k3s
2. **手动触发**：Actions → Build & Deploy → Run workflow → 选 k3s → Run

### Q: 如何完全卸载重来

```bash
# SSH 到 VPS
export KUBECONFIG=/etc/rancher/k3s/k3s.yaml

# 删除应用
helm uninstall ecom -n ecom
kubectl delete namespace ecom

# 如果要彻底卸载 k3s
/usr/local/bin/k3s-uninstall.sh
```

---

## 附录：后续 push 代码的自动部署

默认 push 到 main 分支会自动触发 **k8s** 部署（为了不破坏现有流程）。

如果希望 push 时也部署到 k3s，需要手动运行 workflow：

```
Actions → Build & Deploy → Run workflow → 目标平台: k3s → Run workflow
```

> 两个平台的部署互不影响，可以同时运行。

---

## 整体流程图

```
┌─────────────────────────────────────────────────────────────┐
│                      一次性操作（只做一次）                    │
│                                                             │
│  ① 生成 SSH 密钥 → ② VPS 加公钥 → ③ GitHub 配 Secrets      │
│                         ↓                                   │
│  ④ 运行 K3s Cluster Setup Workflow（安装 k3s + Operators）   │
└─────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────┐
│                     每次部署（可重复）                         │
│                                                             │
│  ⑤ 运行 Build & Deploy Workflow（选 k3s 平台）               │
│     Type Check → Build Images → Deploy → Smoke Test         │
└─────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────┐
│                       验证                                   │
│                                                             │
│  ⑥ SSH 到 VPS：kubectl get pods -n ecom                     │
│  ⑦ 浏览器访问：https://api.find345.site/health              │
└─────────────────────────────────────────────────────────────┘
```
