# K3s 部署指南（GitHub Actions 自动化）

> 面向新手的一步一步操作手册。
> 支持**单节点**（1 台低配 VPS）和**多节点**（3-5 台 VPS）两种模式。

---

## 目录

**单节点（1 台 VPS）：**

1. [前置准备](#1-前置准备)
2. [VPS 基础配置](#2-vps-基础配置)
3. [GitHub 配置 Secrets 和 Variables](#3-github-配置-secrets-和-variables)
4. [运行 K3s 集群初始化 Workflow](#4-运行-k3s-集群初始化-workflow)
5. [运行 Build & Deploy Workflow](#5-运行-build--deploy-workflow)
6. [验证部署结果](#6-验证部署结果)
7. [常见问题排查](#7-常见问题排查)

**多节点（3-5 台 VPS）：**

8. [多节点部署 — 完整新手教程](#8-多节点部署multi-模式-完整新手教程)
   - [8.1 理解多节点](#81-理解多节点和单节点有什么不同)
   - [8.2 节点角色规划](#82-节点角色规划)
   - [8.3 准备所有 VPS](#83-第一步准备所有-vps)
   - [8.4 GitHub 配置](#84-第二步github-配置-secrets-和-variables)
   - [8.5 运行集群初始化](#85-第三步运行-k3s-集群初始化选-multi-模式)
   - [8.6 运行部署](#86-第四步运行-build--deploy选-k3s-multi-平台)
   - [8.7 验证多节点分布](#87-第五步验证多节点分布)
   - [8.8 多节点常见问题](#88-多节点常见问题)
   - [8.9 手动部署](#89-手动部署不用-github-actions)

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
# 单节点（一行搞定）
ufw allow 22/tcp && ufw allow 80/tcp && ufw allow 443/tcp && ufw allow 6443/tcp

# 多节点（一行搞定，包含节点间通信端口）
ufw allow 22/tcp && ufw allow 80/tcp && ufw allow 443/tcp && ufw allow 6443/tcp && ufw allow 8472/udp && ufw allow 10250/tcp && ufw allow 2379:2380/tcp
```

> **单节点**用第一行。**多节点**用第二行（每台 VPS 都执行）。

完成后**退出 VPS**，回到本地电脑继续操作。

> **注意**：不需要手动创建工作目录。GitHub Actions 在 SCP 脚本之前会自动执行 `mkdir -p /opt/ecom/infra/k3s/cluster-setup`。

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

## 8. 多节点部署（multi 模式）— 完整新手教程

> 如果你只有 1 台 VPS，跳过这一节。以下面向有 3-5 台 VPS 的场景。
>
> **前提**：你已经看完了上面 1-7 节单节点的内容，了解了基本操作流程。

---

### 8.1 理解多节点：和单节点有什么不同？

| 维度 | 单节点 (single) | 多节点 (multi) |
|------|----------------|---------------|
| VPS 数量 | 1 台 | 3-5 台 |
| values 文件 | `values-k3s.yaml` | `values-k3s-multi.yaml` |
| PG 数据库 | 1 个实例（仅主库） | 2 个实例（主 + 热备，数据自动同步） |
| Redis | 1 个节点 | 3 个节点（主 + 2 副本） |
| 每个微服务副本 | 1 个 | 2 个（挂一个不影响服务） |
| Pod 分配 | 全部挤在一台机器 | 按角色分散到不同机器 |
| Nginx Ingress | 任意位置运行 | 仅在 ingress 专用节点运行 |
| 高可用 | 无（机器挂了全挂） | 有（etcd 分布式，任一节点挂了集群仍可用） |

**一句话总结**：多节点 = 更安全 + 更稳定 + 不同服务跑在不同机器上。

---

### 8.2 节点角色规划

多节点模式下，每台 VPS 会被分配一个**角色**，不同的 Pod 只会调度到对应角色的机器上：

```
┌──────────────────────────────────────────────────────┐
│ 5 节点完整方案                                        │
│                                                      │
│ S1 (server)  → role=data     ← PG 主库 + Redis 主    │
│ S2 (server)  → role=data     ← PG 备库 + Redis 副本  │
│ S3 (server)  → role=ingress  ← Nginx Ingress（流量入口）│
│ S4 (agent)   → role=app      ← 微服务 Pod            │
│ S5 (agent)   → role=app      ← 微服务 Pod            │
└──────────────────────────────────────────────────────┘
```

> **server** = 参与集群管理决策的节点（类似"领导"）
> **agent** = 只运行工作负载的节点（类似"员工"）

#### 我只有 3 台 VPS，可以吗？

可以！只配置 S1 + S2 + S3，跳过 S4/S5：

```
┌──────────────────────────────────────────────────────┐
│ 3 节点精简方案                                        │
│                                                      │
│ S1 (server)  → role=data     ← PG + Redis + 微服务   │
│ S2 (server)  → role=data     ← PG 备 + Redis 副本    │
│ S3 (server)  → role=ingress  ← Nginx Ingress         │
└──────────────────────────────────────────────────────┘
```

> 3 节点方案中，微服务 Pod 会调度到 S1/S2（和数据库混合运行）。这完全没问题，只是没有 5 节点方案那样完全隔离。

#### 我有 4 台 VPS 呢？

配置 S1 + S2 + S3 + S4，跳过 S5：

```
S1 → role=data, S2 → role=data, S3 → role=ingress, S4 → role=app
```

> **规则**：不配置的节点 Variable 留空即可，Workflow 会自动跳过，不会报错。

---

### 8.3 第一步：准备所有 VPS

假设你有 5 台 VPS，IP 分别是：

| 节点 | IP（示例） | 角色 |
|------|-----------|------|
| S1 | `203.0.113.10` | server + data |
| S2 | `203.0.113.11` | server + data |
| S3 | `203.0.113.12` | server + ingress |
| S4 | `203.0.113.13` | agent + app |
| S5 | `203.0.113.14` | agent + app |

> 把上面的 IP 替换成你自己的实际 IP。

#### 8.3.1 生成 SSH 密钥（只需一次）

如果你在单节点步骤中已经生成过，直接复用那个密钥，**跳过这步**。

如果还没有，在你的**本地电脑**执行：

```bash
ssh-keygen -t ed25519 -f ~/.ssh/k3s_deploy -C "github-actions-k3s"
# 直接按回车（不要设密码）
```

#### 8.3.2 逐台配置每个 VPS

你需要在**每一台** VPS 上做同样的操作。下面以 S1 为例，S2-S5 都重复同样的步骤。

**配置 S1（`203.0.113.10`）：**

```bash
# 1. 从本地 SSH 登录到 S1
ssh root@203.0.113.10

# 2. 添加公钥（只需做一次，让 GitHub Actions 能免密登录）
mkdir -p ~/.ssh
echo "这里粘贴你的公钥内容" >> ~/.ssh/authorized_keys
chmod 700 ~/.ssh
chmod 600 ~/.ssh/authorized_keys

# 3. 开放防火墙端口（一行搞定）
ufw allow 22/tcp && ufw allow 80/tcp && ufw allow 443/tcp && ufw allow 6443/tcp && ufw allow 8472/udp && ufw allow 10250/tcp && ufw allow 2379:2380/tcp

# 4. 退出这台 VPS（不需要手动创建目录，Workflow 会自动创建）
exit
```

**配置 S2（`203.0.113.11`）：**

```bash
ssh root@203.0.113.11
# 重复上面第 2-5 步（完全一样的命令）
```

**配置 S3（`203.0.113.12`）：**

```bash
ssh root@203.0.113.12
# 重复上面第 2-5 步
```

**配置 S4（`203.0.113.13`）：**

```bash
ssh root@203.0.113.13
# 重复上面第 2-5 步
# 注意：agent 节点不需要 2379:2380/tcp（etcd），但加上也无妨
```

**配置 S5（`203.0.113.14`）：**

```bash
ssh root@203.0.113.14
# 重复上面第 2-5 步
```

#### 8.3.3 验证所有节点都能 SSH 登录

在**本地电脑**逐一测试（全部应能免密登录）：

```bash
ssh -i ~/.ssh/k3s_deploy root@203.0.113.10  # S1
ssh -i ~/.ssh/k3s_deploy root@203.0.113.11  # S2
ssh -i ~/.ssh/k3s_deploy root@203.0.113.12  # S3
ssh -i ~/.ssh/k3s_deploy root@203.0.113.13  # S4
ssh -i ~/.ssh/k3s_deploy root@203.0.113.14  # S5
```

> 如果任何一台连不上，回去检查公钥是否正确添加、防火墙是否放行了 22 端口。

---

### 8.4 第二步：GitHub 配置 Secrets 和 Variables

打开浏览器：`你的仓库 → Settings → Secrets and variables → Actions`

#### 8.4.1 添加 Secrets（如果单节点时已添加，检查是否齐全即可）

多节点和单节点需要的 Secrets **完全一样**，不需要额外添加。回顾一下清单：

| Name | Value |
|------|-------|
| `K3S_SSH_KEY` | SSH 私钥内容（`cat ~/.ssh/k3s_deploy`） |
| `K3S_SSH_HOST` | S1 的 IP（如 `203.0.113.10`）— 部署 Workflow 用 |
| `K3S_SSH_USER` | `root` |
| `K3S_POSTGRES_PASSWORD` | 自定义，至少 8 位 |
| `K3S_REPLICATION_PASSWORD` | 自定义，至少 8 位 |
| `K3S_JWT_ACCESS_SECRET` | 自定义，至少 16 位 |
| `K3S_JWT_REFRESH_SECRET` | 自定义，至少 16 位 |
| `K3S_INTERNAL_SECRET` | 自定义，至少 8 位 |
| `GHCR_PAT` | GitHub Personal Access Token |

> **K3S_SSH_HOST** 填 S1 的 IP 就行。部署时 Helm 命令只需要在一台 server 节点上执行。

#### 8.4.2 添加 Variables（重点！多节点需要额外添加）

点击 **"Variables"** 标签 → **"New repository variable"**，逐个添加：

**5 节点方案：**

| Name | Value | 说明 |
|------|-------|------|
| `K3S_S1_HOST` | `203.0.113.10` | 第 1 台 server（首个 control-plane） |
| `K3S_S2_HOST` | `203.0.113.11` | 第 2 台 server（追加 control-plane） |
| `K3S_S3_HOST` | `203.0.113.12` | 第 3 台 server（追加 control-plane） |
| `K3S_S4_HOST` | `203.0.113.13` | 第 1 台 agent（worker 节点） |
| `K3S_S5_HOST` | `203.0.113.14` | 第 2 台 agent（worker 节点） |

**3 节点方案**：只添加 `K3S_S1_HOST`、`K3S_S2_HOST`、`K3S_S3_HOST`。

**4 节点方案**：添加 `K3S_S1_HOST` 到 `K3S_S4_HOST`。

> 没有添加的 Variable，Workflow 会自动跳过那些节点，不会报错。

#### 8.4.3 多节点完整检查清单

对照检查，确保每一项都已配置：

```
═══ Secrets（共 9 个，多节点和单节点一样）═══
 ☐ K3S_SSH_KEY               ← SSH 私钥
 ☐ K3S_SSH_HOST              ← S1 的 IP
 ☐ K3S_SSH_USER              ← root
 ☐ K3S_POSTGRES_PASSWORD     ← PG 密码
 ☐ K3S_REPLICATION_PASSWORD  ← PG 复制密码
 ☐ K3S_JWT_ACCESS_SECRET     ← JWT Access
 ☐ K3S_JWT_REFRESH_SECRET    ← JWT Refresh
 ☐ K3S_INTERNAL_SECRET       ← 内部通信密钥
 ☐ GHCR_PAT                  ← GitHub Token

═══ Variables（根据你的节点数量）═══
 ☐ K3S_S1_HOST  = S1 的 IP   ← 必须
 ☐ K3S_S2_HOST  = S2 的 IP   ← 必须（至少 3 节点）
 ☐ K3S_S3_HOST  = S3 的 IP   ← 必须（至少 3 节点）
 ☐ K3S_S4_HOST  = S4 的 IP   ← 可选（4 或 5 节点）
 ☐ K3S_S5_HOST  = S5 的 IP   ← 可选（仅 5 节点）
```

---

### 8.5 第三步：运行 K3s 集群初始化（选 multi 模式）

这一步 Workflow 会自动 SSH 到每台 VPS，依次安装 k3s 并组建集群。

#### 8.5.1 打开 Actions 页面

```
你的仓库 → Actions（顶部标签）→ 左侧列表点击 "K3s Cluster Setup"
```

#### 8.5.2 运行 Workflow

1. 点击右侧 **"Run workflow"** 按钮
2. 弹出配置框，设置如下：

```
┌─────────────────────────────────────────┐
│  Use workflow from: Branch: main        │
│                                         │
│  集群模式 (single/multi):               │
│  ┌─────────────────────────┐            │
│  │ multi                   │ ← 选 multi │
│  └─────────────────────────┘            │
│                                         │
│  执行到哪一步:                           │
│  ┌─────────────────────────┐            │
│  │ all                     │ ← 选 all   │
│  └─────────────────────────┘            │
│                                         │
│  [Run workflow]                         │
└─────────────────────────────────────────┘
```

3. 点击绿色 **"Run workflow"** 按钮

#### 8.5.3 执行过程（约 10-15 分钟）

点击刚创建的运行记录，可以看到 5 个 Job 依次执行：

```
Job 1: 01 Install Server (S1)          🟢 安装 k3s 到 S1，启用 --cluster-init（分布式 etcd）
                                            这是第一个节点，其他节点会加入它
                 ↓
Job 2: 02 Join Server                   🟢 S2 和 S3 同时加入集群（并行执行）
       ├── S2 join                          S2 作为第 2 个 server 加入
       └── S3 join                          S3 作为第 3 个 server 加入
                 ↓
Job 3: 03 Join Agent                    🟢 S4 和 S5 同时加入集群（并行执行）
       ├── S4 join                          S4 作为 agent（worker）加入
       └── S5 join                          S5 作为 agent（worker）加入
                 ↓
Job 4: 04 Install Operators (S1)        🟢 在 S1 上执行：
                                            - 安装 Helm（如果没有）
                                            - 给节点打角色标签（role=data/ingress/app）
                                            - 安装 CloudNativePG Operator
                                            - 安装 Redis Operator
                                            - 安装 Nginx Ingress Controller
                                            - 安装 cert-manager
                 ↓
Job 5: Verify Cluster                   🟢 检查所有节点是否 Ready
```

> **S2/S3 没配置怎么办**？Workflow 会自动跳过没有配置 Variable 的节点，不会报错。
>
> **某个 Job 失败了**？点进去看日志。修复问题后，可以重新运行 Workflow，选择 `执行到哪一步` 为失败的那一步（如 `02-join-server`），不用从头来。

#### 8.5.4 确认集群初始化成功

**"Verify Cluster"** Job 应显示类似输出（5 节点示例）：

```
══════════ Nodes ══════════
NAME    STATUS   ROLES                       AGE   VERSION
s1      Ready    control-plane,etcd,master   10m   v1.29.2+k3s1
s2      Ready    control-plane,etcd,master   8m    v1.29.2+k3s1
s3      Ready    control-plane,etcd,master   8m    v1.29.2+k3s1
s4      Ready    <none>                      6m    v1.29.2+k3s1
s5      Ready    <none>                      6m    v1.29.2+k3s1

══════════ Node Labels ══════════
s1: role=data
s2: role=data
s3: role=ingress
s4: role=app
s5: role=app

══════════ Operators ══════════
cnpg-system        cnpg-controller-manager       Running
redis-operator-system  redis-operator             Running
ingress-nginx      ingress-nginx-controller       Running
cert-manager       cert-manager                   Running

══════════ Cluster Ready ══════════
5/5 nodes ready
✓ k3s 集群初始化成功！
```

> **3 节点方案**会显示 `3/3 nodes ready`，S4/S5 不会出现。

---

### 8.6 第四步：运行 Build & Deploy（选 k3s-multi 平台）

集群就绪后，部署应用。

#### 8.6.1 打开 Actions 页面

```
你的仓库 → Actions → 左侧列表点击 "Build & Deploy"
```

#### 8.6.2 运行 Workflow

1. 点击右侧 **"Run workflow"** 按钮
2. 设置如下：

```
┌─────────────────────────────────────────┐
│  Use workflow from: Branch: main        │
│                                         │
│  目标平台:                               │
│  ┌─────────────────────────┐            │
│  │ k3s-multi               │ ← 选这个！ │
│  └─────────────────────────┘            │
│                                         │
│  Custom image tag:                      │
│  ┌─────────────────────────┐            │
│  │                         │ ← 留空     │
│  └─────────────────────────┘            │
│                                         │
│  [Run workflow]                         │
└─────────────────────────────────────────┘
```

> **千万不要选 `k3s-single`！** 选错了会使用单节点的 values 文件，所有 Pod 都挤在一台机器上、没有副本冗余。

#### 8.6.3 等待执行完成（约 10-15 分钟）

```
Job 1: Type check                ← TypeScript 类型检查
Job 2: Build (5 个服务并行)       ← 构建 Docker 镜像，推送到 GHCR
Job 3: Deploy to k3s-multi       ← SSH 到 S1，Helm 部署（使用 values-k3s-multi.yaml）
Job 4: Smoke test                ← 健康检查 https://api.find345.site/health
```

#### 8.6.4 确认部署成功

**"Deploy to k3s-multi"** Job 应显示：

```
══════════════════════════════════════════
Deploying ecom to k3s-multi (tag: a1b2c3d4e5f6)
══════════════════════════════════════════

══════════ Pod Status ══════════
NAME                                  READY   STATUS    NODE   AGE
ecom-api-gateway-xxx-aaa              1/1     Running   s4     30s
ecom-api-gateway-xxx-bbb              1/1     Running   s5     30s
ecom-user-service-xxx-aaa             1/1     Running   s4     30s
ecom-user-service-xxx-bbb             1/1     Running   s5     30s
ecom-product-service-xxx-aaa          1/1     Running   s4     30s
ecom-product-service-xxx-bbb          1/1     Running   s5     30s
ecom-cart-service-xxx-aaa             1/1     Running   s4     30s
ecom-cart-service-xxx-bbb             1/1     Running   s5     30s
ecom-order-service-xxx-aaa            1/1     Running   s4     30s
ecom-order-service-xxx-bbb            1/1     Running   s5     30s
ecom-pg-1                             1/1     Running   s1     60s
ecom-pg-2                             1/1     Running   s2     50s
ecom-redis-replication-0              1/1     Running   s1     45s
ecom-redis-replication-1              1/1     Running   s2     40s
ecom-redis-replication-2              1/1     Running   s1     35s
```

注意看 **NODE** 列 — Pod 应该分布在不同节点上：
- PG Pod → 在 s1、s2（data 节点）
- Redis Pod → 在 s1、s2（data 节点）
- 微服务 Pod → 在 s4、s5（app 节点）
- 每个微服务有 2 个副本，分布在不同的 app 节点

---

### 8.7 第五步：验证多节点分布

SSH 到 S1（任意 server 节点都行）：

```bash
ssh root@203.0.113.10
export KUBECONFIG=/etc/rancher/k3s/k3s.yaml
```

#### 8.7.1 查看所有节点和角色标签

```bash
kubectl get nodes --show-labels | grep role
```

期望输出：
```
s1    Ready   control-plane,etcd,master   role=data
s2    Ready   control-plane,etcd,master   role=data
s3    Ready   control-plane,etcd,master   role=ingress
s4    Ready   <none>                      role=app
s5    Ready   <none>                      role=app
```

#### 8.7.2 确认 PG 数据库在 data 节点上

```bash
kubectl get pods -n ecom -l cnpg.io/cluster=ecom-pg -o wide
```

期望输出（NODE 列应为 s1 和 s2）：
```
NAME       READY   STATUS    NODE   AGE
ecom-pg-1  1/1     Running   s1     5m
ecom-pg-2  1/1     Running   s2     4m
```

#### 8.7.3 确认微服务在 app 节点上

```bash
kubectl get pods -n ecom -l app=ecom-api-gateway -o wide
```

期望输出（NODE 列应为 s4 和 s5）：
```
NAME                             READY   STATUS    NODE   AGE
ecom-api-gateway-xxx-aaa         1/1     Running   s4     5m
ecom-api-gateway-xxx-bbb         1/1     Running   s5     5m
```

#### 8.7.4 确认 Ingress 在 ingress 节点上

```bash
kubectl get pods -n ingress-nginx -o wide
```

期望输出（NODE 列应为 s3）：
```
NAME                                      READY   STATUS    NODE   AGE
ingress-nginx-controller-xxx              1/1     Running   s3     10m
```

#### 8.7.5 查看整体状态

```bash
# 所有 Pod 一览
kubectl get pods -n ecom -o wide

# Helm release 状态
helm list -n ecom

# 证书状态
kubectl get certificate -n ecom
```

---

### 8.8 多节点常见问题

#### Q: S2/S3 Join Server 失败 — "connection refused"

**原因**：S1 上的 6443 端口未开放，或 S2/S3 无法访问 S1 的内网/公网 IP。

**解决**：
```bash
# 在 S1 上检查 6443 是否监听
ss -tlnp | grep 6443

# 在 S2 上测试连通性
curl -k https://203.0.113.10:6443
# 应返回 JSON（即使是 401 也说明端口通了）

# 如果不通，检查防火墙
ufw status
```

#### Q: S4/S5 Join Agent 失败 — "token not valid"

**原因**：node-token 可能过期或传输不完整。

**解决**：
```bash
# 在 S1 上查看正确的 token
cat /var/lib/rancher/k3s/server/node-token
```

> 通常重新运行 Workflow（选 `03-join-agent` 步骤）即可自动修复。

#### Q: Pod 一直 Pending — "0/5 nodes are available"

**原因**：Pod 的 nodeSelector 要求 `role=app`，但没有节点有这个标签。

**解决**：
```bash
# 检查节点标签
kubectl get nodes --show-labels | grep role

# 如果标签缺失，手动打标签
kubectl label node s1 role=data
kubectl label node s2 role=data
kubectl label node s3 role=ingress
kubectl label node s4 role=app
kubectl label node s5 role=app
```

> 通常是 `04-install-operators.sh` 没有正确执行。重新运行 Workflow 选 `04-install-operators` 步骤即可。

#### Q: 3 节点方案微服务 Pod 全在 Pending

**原因**：3 节点没有 `role=app` 的节点，但 `values-k3s-multi.yaml` 里微服务要求 `nodeSelector: role=app`。

**解决**：给 S1 或 S2 追加 app 标签：

```bash
# 让 S1 同时承担 data 和 app 角色
kubectl label node s1 role=app --overwrite

# 或者更好的做法：移除 nodeSelector 约束
# 重新运行部署，选 k3s-single 平台（它的 nodeSelector 全是 {}）
```

> **推荐**：3 节点方案建议使用 `k3s-single` 平台而非 `k3s-multi`，因为节点太少没必要强制隔离。

#### Q: 域名 DNS 应该指向哪台 VPS？

多节点模式下，域名应该指向 **S3**（role=ingress 的那台），因为 Nginx Ingress Controller 运行在 S3 上。

```
api.find345.site → 203.0.113.12（S3 的 IP）
```

> 如果你有负载均衡器（如 Cloudflare），可以把所有 server 节点 IP 都加上。

#### Q: 如何从单节点升级到多节点？

1. 准备额外的 VPS，完成 [8.3 节](#83-第一步准备所有-vps) 的基础配置
2. GitHub 添加新的 Variables（`K3S_S2_HOST` 等）
3. 运行 K3s Cluster Setup Workflow（选 `multi` 模式），**不需要卸载已有的单节点**
4. 运行 Build & Deploy（选 `k3s-multi` 平台）

> 注意：从 single 升级到 multi 需要重新初始化集群（因为 single 模式没有启用 etcd 集群）。建议先在 S1 上卸载 k3s（`/usr/local/bin/k3s-uninstall.sh`），然后用 multi 模式全部重装。

---

### 8.9 手动部署（不用 GitHub Actions）

如果你不想用 GitHub Actions，也可以在 S1 上手动操作：

```bash
# 1. 把项目代码传到 S1
scp -r /path/to/my-backend root@203.0.113.10:/opt/ecom/

# 2. SSH 到 S1
ssh root@203.0.113.10
cd /opt/ecom/infra/k3s

# 3. 设置多节点模式
export K3S_MODE=multi
export REGISTRY=ghcr.io/你的github用户名
export TAG=latest
export KUBECONFIG=/etc/rancher/k3s/k3s.yaml

# 4. 依次执行
./deploy.sh setup    # 交互式输入密码和 Secret
./deploy.sh build    # 构建并推送镜像（需要 docker login ghcr.io）
./deploy.sh deploy   # Helm 部署（自动使用 values-k3s-multi.yaml）
./deploy.sh status   # 查看部署状态
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
