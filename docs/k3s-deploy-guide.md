# K3s 部署指南（GitHub Actions 自动化）

> 面向新手的一步一步操作手册。
> 支持**单节点**（1 台低配 VPS）和**多节点**（3-5 台 VPS）两种模式。

---

## 目录

1. [前置准备](#1-前置准备)
2. [VPS 基础配置](#2-vps-基础配置)
3. [GitHub 配置 Secrets 和 Variables](#3-github-配置-secrets-和-variables)
4. [运行 K3s 集群初始化 Workflow](#4-运行-k3s-集群初始化-workflow)
5. [运行 Build & Deploy Workflow](#5-运行-build--deploy-workflow)
6. [验证部署结果](#6-验证部署结果)
7. [常见问题排查](#7-常见问题排查)
8. [多节点部署（multi 模式）](#8-多节点部署multi-模式)

---

## 1. 前置准备

### 选择你的模式

| 模式 | 节点数 | 适用场景 | 最低配置 |
|------|--------|----------|----------|
| **single** | 1 台 | 个人项目 / 低配 VPS | 1 CPU / 1 GB 内存 / 10 GB 磁盘 |
| **multi** | 3-5 台 | 生产环境 / 高可用 | 每台 2 CPU / 2 GB 内存 / 20 GB 磁盘 |

> 不确定选哪个？先用 **single** 模式部署，后续可以随时扩展为 multi。

### 你需要的东西

| 项目 | 说明 |
|------|------|
| **VPS** | 单节点 1 台，多节点 3-5 台，推荐 Ubuntu 22.04 |
| **GitHub 仓库** | 已推送本项目代码到 main 分支 |
| **域名**（可选） | 如 `api.find345.site`，已指向 VPS 的 IP |
| **SSH 密钥对** | 用于 GitHub Actions SSH 到 VPS（所有节点共用一个） |

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

在**每台 VPS** 上执行：

```bash
# 如果用 ufw（所有节点都需要）
ufw allow 22/tcp     # SSH
ufw allow 80/tcp     # HTTP（Let's Encrypt 验证用）
ufw allow 443/tcp    # HTTPS
ufw allow 6443/tcp   # K3s API（多节点必须，单节点可选）

# 多节点额外端口（节点间通信）
ufw allow 8472/udp   # Flannel VXLAN（多节点必须）
ufw allow 10250/tcp  # kubelet metrics（多节点必须）
ufw allow 2379:2380/tcp  # etcd（仅 server 节点间）
```

> **单节点**只需前 4 个端口。**多节点**全部都要。

### 2.3 创建工作目录

在**每台 VPS** 上执行：

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

#### 单节点（必须）

| Name | Value | 说明 |
|------|-------|------|
| `K3S_S1_HOST` | `你的VPS_IP` | 如 `203.0.113.10`（和 K3S_SSH_HOST 一样） |

#### 多节点（额外添加）

| Name | Value | 说明 |
|------|-------|------|
| `K3S_S2_HOST` | 第 2 台 server IP | 如 `203.0.113.11`（可选，追加 control-plane） |
| `K3S_S3_HOST` | 第 3 台 server IP | 如 `203.0.113.12`（可选，追加 control-plane） |
| `K3S_S4_HOST` | Agent 1 IP | 如 `203.0.113.13`（可选，worker 节点） |
| `K3S_S5_HOST` | Agent 2 IP | 如 `203.0.113.14`（可选，worker 节点） |

> 单节点只需 `K3S_S1_HOST`。没配置的多节点 Variable 会自动跳过。

### 3.4 检查清单

#### 单节点

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

#### 多节点（在单节点基础上追加）

```
Variables（额外 2-4 个）：
 ☐ K3S_S2_HOST        （第 2 台 server）
 ☐ K3S_S3_HOST        （第 3 台 server，可选）
 ☐ K3S_S4_HOST        （Agent 1，可选）
 ☐ K3S_S5_HOST        （Agent 2，可选）
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
   - **目标平台**：
     - 单节点选 `k3s-single`
     - 多节点选 `k3s-multi`
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

## 8. 多节点部署（multi 模式）

> 如果你只有 1 台 VPS，跳过这一节。以下面向有 3-5 台 VPS 的场景。

### 8.1 单节点 vs 多节点对比

| 维度 | 单节点 (single) | 多节点 (multi) |
|------|----------------|---------------|
| values 文件 | `values-k3s.yaml` | `values-k3s-multi.yaml` |
| PG 实例 | 1（仅主库） | 2（主 + 备） |
| Redis 节点 | 1 | 3（主 + 2 副本） |
| 服务副本 | 各 1 个 | 各 2 个 |
| nodeSelector | 全部 `{}`（不限制） | 按角色分布（见下方） |
| Nginx Ingress | 任意节点运行 | 仅 `role=ingress` 节点 |
| etcd | 单节点内嵌 | `--cluster-init` 分布式 etcd |

### 8.2 节点角色规划

多节点模式下，`04-install-operators.sh` 会自动给节点打标签：

```
S1 (server)  → role=data      ← PG 主库 + Redis
S2 (server)  → role=data      ← PG 备库 + Redis
S3 (server)  → role=ingress   ← Nginx Ingress Controller
A1 (agent)   → role=app       ← 微服务 Pod
A2 (agent)   → role=app       ← 微服务 Pod
```

> 不一定需要 5 台。最少 **3 台**（S1 + S2 + S3）也能跑，A1/A2 不配置会自动跳过。

### 8.3 多节点操作步骤

#### 步骤一：所有节点做基础配置

在**每台 VPS** 上重复 [第 2 节](#2-vps-基础配置) 的操作：
- 添加同一个 SSH 公钥
- 开放防火墙端口（包括多节点额外端口）
- 创建 `/opt/ecom/...` 目录

#### 步骤二：GitHub 添加多节点 Variables

在 [第 3.3 节](#33-添加-variables) 基础上，额外添加节点 IP：

```
Variables（示例 5 节点）：
  K3S_S1_HOST = 203.0.113.10   ← 已有
  K3S_S2_HOST = 203.0.113.11   ← 新增
  K3S_S3_HOST = 203.0.113.12   ← 新增
  K3S_S4_HOST = 203.0.113.13   ← 新增
  K3S_S5_HOST = 203.0.113.14   ← 新增
```

#### 步骤三：运行集群初始化（选 multi 模式）

```
Actions → K3s Cluster Setup → Run workflow
  集群模式: multi          ← 重要！不是 single
  执行到哪一步: all
```

执行流程：

```
01 Install Server (S1)              ← 安装 k3s + 启用 etcd
02 Join Server (S2) + (S3)          ← 追加 2 个 control-plane（并行）
03 Join Agent (A1) + (A2)           ← 追加 2 个 worker（并行）
04 Install Operators (S1)           ← 打节点标签 + 安装 Operator
Verify Cluster                      ← 验证 5/5 节点 Ready
```

#### 步骤四：运行部署（选 k3s-multi 平台）

```
Actions → Build & Deploy → Run workflow
  目标平台: k3s-multi      ← 重要！不是 k3s-single
  Custom image tag: （留空）
```

这会使用 `values-k3s-multi.yaml`，自动将 Pod 按 nodeSelector 分配到正确节点。

#### 步骤五：验证多节点分布

SSH 到任意 server 节点：

```bash
export KUBECONFIG=/etc/rancher/k3s/k3s.yaml

# 查看节点标签
kubectl get nodes --show-labels

# 确认 PG Pod 在 data 节点上
kubectl get pods -n ecom -l cnpg.io/cluster=ecom-pg -o wide

# 确认服务 Pod 在 app 节点上
kubectl get pods -n ecom -l app=ecom-api-gateway -o wide

# 确认 Ingress 在 ingress 节点上
kubectl get pods -n ingress-nginx -o wide
```

### 8.4 3 节点精简方案

如果只有 3 台 VPS，不配置 `K3S_S4_HOST` 和 `K3S_S5_HOST` 即可：

```
S1 → role=data      ← PG + Redis + 微服务（混合调度）
S2 → role=data      ← PG 备 + Redis 副本
S3 → role=ingress   ← Nginx Ingress
```

> 注意：3 节点方案中微服务会调度到 S1/S2（data 节点上），因为没有 `role=app` 节点。
> 如需精确控制，可以给 S1 追加标签：`kubectl label node <S1> role=app --overwrite`

### 8.5 手动部署脚本（多节点）

如果不使用 GitHub Actions，也可以在 server 节点上手动部署：

```bash
cd /path/to/my-backend/infra/k3s

# 设置多节点模式
export K3S_MODE=multi
export REGISTRY=ghcr.io/你的用户名
export TAG=latest

./deploy.sh setup    # 交互式配置 secrets
./deploy.sh build    # 构建镜像
./deploy.sh deploy   # Helm 部署（自动使用 values-k3s-multi.yaml）
```

---

## 附录：后续 push 代码的自动部署

默认 push 到 main 分支会自动触发 **k8s** 部署（为了不破坏现有流程）。

如果希望 push 时也部署到 k3s，需要手动运行 workflow：

```
Actions → Build & Deploy → Run workflow → 目标平台: k3s-single（或 k3s-multi）→ Run workflow
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
