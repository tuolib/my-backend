# K3s 5节点 VPC + VIP 高可用生产部署指南

> **操作最少化设计** — 你只需做 4 步，总计约 30 分钟。
> 日常发布零 SSH：GitHub Actions 通过 kubeconfig 直连 API Server。

---

## 目录

1. [架构总览](#1-架构总览)
2. [服务器规划](#2-服务器规划)
3. [Step 1：配置 5 台 VPS](#3-step-1配置-5-台-vps约-10-分钟)
4. [Step 2：配置 GitHub](#4-step-2配置-github约-5-分钟)
5. [Step 3：初始化集群](#5-step-3初始化集群约-15-分钟自动)
6. [Step 4：首次部署](#6-step-4首次部署约-10-分钟自动)
7. [日常发布流程](#7-日常发布流程)
8. [运维命令速查](#8-运维命令速查)
9. [常见问题](#9-常见问题)

---

## 1. 架构总览

### 设计原则

| 原则 | 实现方式 |
|------|---------|
| **零 SSH 发布** | GitHub Actions 通过 kubeconfig 直连 k3s API Server，不 SSH 到任何服务器 |
| **VIP 高可用** | kube-vip 提供控制面 VIP，任一 server 节点宕机不影响集群管理 |
| **Nginx 反向代理** | Nginx Ingress Controller（替代 Caddy），DaemonSet 模式 + hostNetwork |
| **VPC 内网通信** | 所有节点通过 VPC 私有网络通信，延迟低、安全 |
| **自动化发布** | push 代码 → 自动构建镜像 → 自动部署到集群 |

### 架构图

```
                    ┌──── GitHub Actions ────┐
                    │  Build → Push GHCR     │
                    │  kubectl/helm deploy   │
                    │  (via kubeconfig)      │
                    └──────────┬─────────────┘
                               │ kubeconfig (6443)
                               ▼
              ┌─── Cloud Floating IP (公网) ───┐
              │  控制面: <浮动IP> → VIP         │
              │  域名:   api.xxx.com → S3公网IP │
              └───────────────┬────────────────┘
                              │
    ┌─────────────── VPC 内网 (10.0.0.0/24) ──────────────┐
    │                                                      │
    │   ┌── VIP: 10.0.0.100 (kube-vip, 控制面浮动) ──┐    │
    │   │                                              │    │
    │   │  S1 (10.0.0.1) ── server + role=data        │    │
    │   │  │  PG 主库 + Redis 主节点                    │    │
    │   │  │                                           │    │
    │   │  S2 (10.0.0.2) ── server + role=data        │    │
    │   │  │  PG 备库 + Redis 副本                      │    │
    │   │  │                                           │    │
    │   │  S3 (10.0.0.3) ── server + role=ingress     │    │
    │   │     Nginx Ingress Controller (80/443)        │    │
    │   └──────────────────────────────────────────────┘    │
    │                                                      │
    │   S4 (10.0.0.4) ── agent + role=app                 │
    │   │  微服务 Pod（api-gateway, user, product...）      │
    │   │                                                  │
    │   S5 (10.0.0.5) ── agent + role=app                 │
    │      微服务 Pod（每个服务 2 副本，分布在 S4/S5）        │
    └──────────────────────────────────────────────────────┘
```

### 发布流程（零 SSH）

```
开发者 push 代码 → GitHub Actions 触发
  ├── ① TypeScript 类型检查
  ├── ② 并行构建 5 个 Docker 镜像 → 推送到 GHCR
  ├── ③ 通过 kubeconfig 连接 k3s API Server → Helm 部署
  └── ④ 健康检查 https://api.xxx.com/health

全程无 SSH，无服务器间通信
```

---

## 2. 服务器规划

### 节点角色

| 节点 | 类型 | 角色标签 | 运行组件 | 最低配置 | 推荐配置 |
|------|------|---------|---------|---------|---------|
| S1 | server | `role=data` | PG 主库 + Redis 主 + etcd | 2C 4G 50G SSD | 4C 8G |
| S2 | server | `role=data` | PG 备库 + Redis 副本 + etcd | 2C 4G 50G SSD | 4C 8G |
| S3 | server | `role=ingress` | Nginx Ingress + etcd | 2C 2G 30G SSD | 2C 4G |
| S4 | agent | `role=app` | 5 个微服务（各 1 副本） | 2C 2G 30G SSD | 2C 4G |
| S5 | agent | `role=app` | 5 个微服务（各 1 副本） | 2C 2G 30G SSD | 2C 4G |

### 网络需求

| 端口 | 用途 | 谁需要开 |
|------|------|---------|
| 22/tcp | SSH（初始化时用，可后续关闭） | 全部 |
| 80/tcp | HTTP | S3 |
| 443/tcp | HTTPS | S3 |
| 6443/tcp | k3s API Server | S1, S2, S3 |
| 8472/udp | Flannel VXLAN（VPC 内） | 全部 |
| 10250/tcp | kubelet（VPC 内） | 全部 |
| 2379-2380/tcp | etcd（VPC 内） | S1, S2, S3 |

### 你需要准备的东西

| 项目 | 说明 |
|------|------|
| 5 台 VPS | 同一云服务商、同一 VPC、推荐 Ubuntu 22.04/24.04 |
| 1 个 VPC VIP | VPC 子网内的一个空闲 IP（如 10.0.0.100），用于 kube-vip |
| 域名（可选） | 如 `api.find345.site`，A 记录指向 S3 的公网 IP |
| SSH 密钥对 | 用于 GitHub Actions 初始化集群 |
| GitHub 仓库 | 已推送项目代码到 main 分支 |

> **VPC VIP 怎么获取？**
> - Hetzner：在 Cloud Console 创建 Network，子网内选一个未使用的 IP
> - Vultr：VPC 2.0 网络，选一个子网内未分配的 IP
> - DigitalOcean：VPC 网络，选一个未使用的 IP
> - 阿里云/腾讯云：VPC 内创建"高可用虚拟 IP"

---

## 3. Step 1：配置 5 台 VPS（约 10 分钟）

### 3.1 生成 SSH 密钥（本地执行，只需一次）

```bash
ssh-keygen -t ed25519 -f ~/.ssh/k3s_deploy -C "github-actions-k3s"
```

> 直接按回车，不设密码。

### 3.2 查看公钥（待会要粘贴到每台 VPS）

```bash
cat ~/.ssh/k3s_deploy.pub
```

> 复制输出内容，下面要用。

### 3.3 逐台配置 VPS

**对每台 VPS（S1-S5）执行以下操作：**

SSH 登录到 VPS：

```bash
ssh root@<VPS公网IP>
```

添加 SSH 公钥：

```bash
mkdir -p ~/.ssh
```

```bash
echo "粘贴你的公钥内容" >> ~/.ssh/authorized_keys
```

```bash
chmod 700 ~/.ssh
```

```bash
chmod 600 ~/.ssh/authorized_keys
```

开放防火墙端口（一行搞定）：

```bash
ufw allow 22/tcp && ufw allow 80/tcp && ufw allow 443/tcp && ufw allow 6443/tcp && ufw allow 8472/udp && ufw allow 10250/tcp && ufw allow 2379:2380/tcp
```

启用防火墙（如果还没启用）：

```bash
ufw --force enable
```

退出：

```bash
exit
```

> 5 台都做完后，继续下一步。

### 3.4 验证所有节点 SSH 连通

在本地逐个测试：

```bash
ssh -i ~/.ssh/k3s_deploy root@<S1公网IP> "echo S1 OK"
```

```bash
ssh -i ~/.ssh/k3s_deploy root@<S2公网IP> "echo S2 OK"
```

```bash
ssh -i ~/.ssh/k3s_deploy root@<S3公网IP> "echo S3 OK"
```

```bash
ssh -i ~/.ssh/k3s_deploy root@<S4公网IP> "echo S4 OK"
```

```bash
ssh -i ~/.ssh/k3s_deploy root@<S5公网IP> "echo S5 OK"
```

> 全部输出 OK 即可。如果连不上，检查公钥和防火墙。

---

## 4. Step 2：配置 GitHub（约 5 分钟）

打开浏览器：`你的仓库 → Settings → Secrets and variables → Actions`

### 4.1 添加 Secrets（点 "New repository secret"）

| Name | Value | 说明 |
|------|-------|------|
| `K3S_SSH_KEY` | SSH 私钥内容 | 执行 `cat ~/.ssh/k3s_deploy` 复制全部内容 |
| `K3S_SSH_HOST` | S1 的公网 IP | 如 `203.0.113.10` |
| `K3S_SSH_USER` | `root` | SSH 用户名 |
| `K3S_POSTGRES_PASSWORD` | 自定义密码 | 至少 8 位 |
| `K3S_REPLICATION_PASSWORD` | 自定义密码 | 至少 8 位 |
| `K3S_JWT_ACCESS_SECRET` | 自定义密钥 | 至少 16 位 |
| `K3S_JWT_REFRESH_SECRET` | 自定义密钥 | 至少 16 位 |
| `K3S_INTERNAL_SECRET` | 自定义密钥 | 至少 8 位 |
| `GHCR_PAT` | GitHub Token | 需要 `read:packages` + `write:packages` 权限 |

> **快速生成密码：**
> ```bash
> openssl rand -base64 24
> ```
> 执行多次，每个 Secret 用不同的值。

> **获取 GHCR_PAT：**
> 打开 https://github.com/settings/tokens → Generate new token (classic) → 勾选 `read:packages` + `write:packages` → Generate

### 4.2 添加 Variables（点顶部 "Variables" 标签 → "New repository variable"）

| Name | Value | 说明 |
|------|-------|------|
| `K3S_S1_HOST` | S1 的公网 IP | 如 `203.0.113.10` |
| `K3S_S2_HOST` | S2 的公网 IP | 如 `203.0.113.11` |
| `K3S_S3_HOST` | S3 的公网 IP | 如 `203.0.113.12` |
| `K3S_S4_HOST` | S4 的公网 IP | 如 `203.0.113.13` |
| `K3S_S5_HOST` | S5 的公网 IP | 如 `203.0.113.14` |
| `K3S_VIP` | VPC 内网 VIP | 如 `10.0.0.100`（VPC 子网内未使用的 IP） |
| `K3S_VIP_INTERFACE` | VPC 网卡名 | 如 `eth1` 或 `ens10`（VPC 内网网卡） |

> **如何确认 VPC 网卡名？** SSH 到任一 VPS 执行：
> ```bash
> ip -4 addr show | grep "10\."
> ```
> 显示的网卡名（如 `eth1`、`ens10`、`enp7s0`）就是 VPC 网卡。

### 4.3 检查清单

```
═══ Secrets（共 9 个）═══
 ☐ K3S_SSH_KEY
 ☐ K3S_SSH_HOST              ← S1 的公网 IP
 ☐ K3S_SSH_USER              ← root
 ☐ K3S_POSTGRES_PASSWORD
 ☐ K3S_REPLICATION_PASSWORD
 ☐ K3S_JWT_ACCESS_SECRET
 ☐ K3S_JWT_REFRESH_SECRET
 ☐ K3S_INTERNAL_SECRET
 ☐ GHCR_PAT

═══ Variables（共 7 个）═══
 ☐ K3S_S1_HOST               ← S1 公网 IP
 ☐ K3S_S2_HOST               ← S2 公网 IP
 ☐ K3S_S3_HOST               ← S3 公网 IP
 ☐ K3S_S4_HOST               ← S4 公网 IP
 ☐ K3S_S5_HOST               ← S5 公网 IP
 ☐ K3S_VIP                   ← VPC 内网 VIP（如 10.0.0.100）
 ☐ K3S_VIP_INTERFACE          ← VPC 网卡名（如 eth1）
```

---

## 5. Step 3：初始化集群（约 15 分钟，自动）

### 5.1 运行 K3s Cluster Setup Workflow

```
你的仓库 → Actions → 左侧 "K3s Cluster Setup" → 右侧 "Run workflow"
```

配置：

```
集群模式: multi
执行到哪一步: all
```

点击 **Run workflow**。

### 5.2 执行过程

```
Job 1: 01 Install Server (S1)    ← 安装 k3s + kube-vip（约 3 分钟）
           ↓
Job 2: 02 Join Server (S2, S3)   ← S2/S3 加入集群（约 3 分钟）
           ↓
Job 3: 03 Join Agent (S4, S5)    ← S4/S5 加入集群（约 3 分钟）
           ↓
Job 4: 04 Install Operators      ← 安装 PG/Redis/Nginx/cert-manager（约 5 分钟）
           ↓
Job 5: Verify Cluster            ← 验证 5/5 节点就绪
```

### 5.3 确认成功

Verify Cluster Job 应显示：

```
══════════ Nodes ══════════
NAME   STATUS   ROLES                       AGE   VERSION
s1     Ready    control-plane,etcd,master   10m   v1.29.x+k3s1
s2     Ready    control-plane,etcd,master   8m    v1.29.x+k3s1
s3     Ready    control-plane,etcd,master   8m    v1.29.x+k3s1
s4     Ready    <none>                      6m    v1.29.x+k3s1
s5     Ready    <none>                      6m    v1.29.x+k3s1

══════════ Cluster Ready ══════════
5/5 nodes ready
✓ k3s 集群初始化成功！
```

### 5.4 获取 kubeconfig 并存储到 GitHub

集群初始化成功后，SSH 到 S1 导出 kubeconfig：

```bash
ssh -i ~/.ssh/k3s_deploy root@<S1公网IP>
```

查看 VIP 是否生效：

```bash
export KUBECONFIG=/etc/rancher/k3s/k3s.yaml
```

```bash
kubectl get pods -n kube-system | grep kube-vip
```

导出 kubeconfig（将 server 地址替换为 S1 的**公网 IP**）：

```bash
sed 's|https://127.0.0.1:6443|https://<S1公网IP>:6443|' /etc/rancher/k3s/k3s.yaml
```

> 复制完整输出内容。如果你有公网浮动 IP，将 `<S1公网IP>` 替换为浮动 IP。

退出 VPS：

```bash
exit
```

将复制的 kubeconfig 添加到 GitHub Secrets：

```
仓库 → Settings → Secrets and variables → Actions → New repository secret
Name: K3S_KUBECONFIG
Value: （粘贴刚才复制的 kubeconfig 内容）
```

> **重要**：这个 kubeconfig 让 GitHub Actions 能直接连接 k3s 集群，无需 SSH。

---

## 6. Step 4：首次部署（约 10 分钟，自动）

### 6.1 运行 Build & Deploy Workflow

```
你的仓库 → Actions → 左侧 "Build & Deploy" → 右侧 "Run workflow"
```

配置：

```
目标平台: k3s-multi
Custom image tag: （留空）
```

点击 **Run workflow**。

### 6.2 执行过程

```
Job 1: Type check             ← TypeScript 类型检查
Job 2: Build (5 个服务并行)    ← 构建 Docker 镜像 → 推送到 GHCR
Job 3: Deploy to k3s-multi    ← kubeconfig 直连 → Helm 部署（零 SSH）
Job 4: Smoke test             ← 健康检查
```

### 6.3 确认成功

Deploy Job 应显示 Pod 分布在不同节点：

```
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

### 6.4 验证 API

如果域名已配置（DNS A 记录指向 S3 公网 IP）：

```bash
curl -X POST https://api.find345.site/health
```

如果还没配置域名，SSH 到 S1 测试：

```bash
ssh -i ~/.ssh/k3s_deploy root@<S1公网IP>
```

```bash
export KUBECONFIG=/etc/rancher/k3s/k3s.yaml
```

```bash
kubectl get svc -n ecom ecom-api-gateway
```

```bash
curl -X POST http://<CLUSTER-IP>:3000/health
```

---

## 7. 日常发布流程

### 自动发布（推荐）

```
git add .
git commit -m "your changes"
git push origin main
```

然后手动触发 workflow：

```
Actions → Build & Deploy → Run workflow → 目标平台: k3s-multi → Run
```

### 全自动发布（修改 deploy.yml 默认平台）

如果希望 push 到 main 自动部署到 k3s，修改 `.github/workflows/deploy.yml`：

```yaml
# 将第 47 行的 'swarm' 改为 'k3s-multi'
env:
  PLATFORM: ${{ inputs.platform || 'k3s-multi' }}
```

修改后，每次 push 到 main 都会自动部署到 k3s 集群。

### 发布流程图

```
push 代码到 main
       │
       ▼
┌─────────────────────────────────────────┐
│  GitHub Actions（全自动，约 10 分钟）      │
│                                          │
│  ① bun typecheck       （类型检查）       │
│  ② docker build × 5    （并行构建镜像）    │
│  ③ helm upgrade         （kubeconfig 部署）│
│  ④ curl /health         （健康检查）       │
│                                          │
│  整个过程零 SSH，零服务器间通信             │
└─────────────────────────────────────────┘
       │
       ▼
  部署完成 ✓
```

---

## 8. 运维命令速查

> 所有命令在 S1（或任意 server 节点）上执行。

### 8.1 登录到 S1

```bash
ssh -i ~/.ssh/k3s_deploy root@<S1公网IP>
```

```bash
export KUBECONFIG=/etc/rancher/k3s/k3s.yaml
```

### 8.2 查看集群状态

查看所有节点：

```bash
kubectl get nodes -o wide
```

查看节点角色标签：

```bash
kubectl get nodes --show-labels | grep role
```

查看所有 Pod：

```bash
kubectl get pods -n ecom -o wide
```

查看服务：

```bash
kubectl get svc -n ecom
```

查看 Ingress：

```bash
kubectl get ingress -n ecom
```

查看 TLS 证书：

```bash
kubectl get certificate -n ecom
```

查看 PG 集群：

```bash
kubectl get cluster -n ecom
```

查看 kube-vip 状态：

```bash
kubectl get pods -n kube-system -l app.kubernetes.io/name=kube-vip-ds
```

### 8.3 查看日志

查看某个服务的日志：

```bash
kubectl logs -n ecom -l app=ecom-api-gateway --tail=100
```

```bash
kubectl logs -n ecom -l app=ecom-user-service --tail=100
```

查看 PG 日志：

```bash
kubectl logs -n ecom -l cnpg.io/cluster=ecom-pg --tail=100
```

查看 Nginx Ingress 日志：

```bash
kubectl logs -n ingress-nginx -l app.kubernetes.io/name=ingress-nginx --tail=100
```

### 8.4 扩缩容

扩容微服务副本（以 api-gateway 为例）：

```bash
kubectl scale deployment ecom-api-gateway -n ecom --replicas=3
```

### 8.5 回滚

回滚到上一个版本：

```bash
helm rollback ecom -n ecom
```

回滚到指定版本：

```bash
helm history ecom -n ecom
```

```bash
helm rollback ecom <REVISION> -n ecom
```

### 8.6 重启服务

重启某个服务（滚动重启，不中断）：

```bash
kubectl rollout restart deployment ecom-api-gateway -n ecom
```

重启所有微服务：

```bash
kubectl rollout restart deployment -n ecom
```

### 8.7 完全卸载

删除应用：

```bash
helm uninstall ecom -n ecom
```

```bash
kubectl delete namespace ecom
```

卸载 k3s（在每台 VPS 上执行）：

Server 节点（S1/S2/S3）：

```bash
/usr/local/bin/k3s-uninstall.sh
```

Agent 节点（S4/S5）：

```bash
/usr/local/bin/k3s-agent-uninstall.sh
```

---

## 9. 常见问题

### Q: kube-vip 没有启动

**检查：**

```bash
kubectl get pods -n kube-system -l app.kubernetes.io/name=kube-vip-ds
```

```bash
kubectl describe pod -n kube-system -l app.kubernetes.io/name=kube-vip-ds
```

**常见原因：**
- `K3S_VIP_INTERFACE` 网卡名不对 → SSH 到 VPS 执行 `ip link show` 确认
- `K3S_VIP` 已被占用 → 换一个 VPC 子网内未使用的 IP

### Q: 01 Install Server 失败 — "Permission denied"

**原因：** SSH 密钥不匹配或 VPS 未添加公钥。

**解决：**

```bash
ssh -i ~/.ssh/k3s_deploy root@<VPS_IP>
```

如果连不上，重新在 VPS 上添加公钥（见 Step 1）。

### Q: S2/S3 Join 失败 — "connection refused"

**原因：** S1 的 6443 端口未开放，或 VPC 内网不通。

**检查（在 S1 上）：**

```bash
ss -tlnp | grep 6443
```

**检查（在 S2 上）：**

```bash
curl -k https://<S1内网IP>:6443
```

> 返回 JSON（即使 401）说明端口通了。如果不通，检查防火墙和 VPC 安全组。

### Q: Deploy 失败 — "unable to connect to server"

**原因：** `K3S_KUBECONFIG` 中的 server 地址不可达。

**解决：**
1. 确认 kubeconfig 中的 IP 是 S1 的**公网 IP**
2. 确认 6443 端口对外开放
3. 重新导出 kubeconfig（见 Step 3 的 5.4）

### Q: Deploy 失败 — "ImagePullBackOff"

**原因：** GHCR 认证失败或镜像不存在。

**检查：**

```bash
kubectl describe pod <pod名> -n ecom
```

**解决：**
- 确认 `GHCR_PAT` 有 `read:packages` 权限
- 确认 GitHub Packages 页面有对应镜像

### Q: Pod 一直 Pending — "0/5 nodes available"

**原因：** nodeSelector 匹配不到节点。

**检查：**

```bash
kubectl get nodes --show-labels | grep role
```

**解决（手动打标签）：**

```bash
kubectl label node <S1节点名> role=data --overwrite
```

```bash
kubectl label node <S2节点名> role=data --overwrite
```

```bash
kubectl label node <S3节点名> role=ingress --overwrite
```

```bash
kubectl label node <S4节点名> role=app --overwrite
```

```bash
kubectl label node <S5节点名> role=app --overwrite
```

### Q: 域名 DNS 应该指向哪个 IP？

指向 **S3 的公网 IP**（Nginx Ingress Controller 运行在 S3 上）。

```
api.find345.site → <S3公网IP>
```

> 如果使用 Cloudflare 等 CDN，可以启用代理模式。

### Q: S1 宕机了怎么办？

**对集群的影响：**
- kube-vip 自动将控制面 VIP 转移到 S2 或 S3（约 5 秒）
- PG 备库（S2）自动提升为主库（CloudNativePG 自动故障转移）
- 微服务不受影响（运行在 S4/S5）
- 正在运行的 Pod 不会中断

**你需要做的：**
1. 修复或替换 S1
2. 重新加入集群即可

### Q: 如何更新 kubeconfig 使用 VIP？

如果你已经配置了 kube-vip，可以使用 VIP 地址替换 kubeconfig 中的 server：

```bash
sed 's|https://127.0.0.1:6443|https://<VPC_VIP>:6443|' /etc/rancher/k3s/k3s.yaml
```

> 注意：如果 GitHub Actions 从外网连接，需要使用公网可达的 IP。VPC VIP 通常是内网 IP，外网无法直接访问。建议使用 S1 的公网 IP 或云服务商的浮动 IP。

### Q: 如何添加 Swap（内存不足时）

```bash
fallocate -l 2G /swapfile
```

```bash
chmod 600 /swapfile
```

```bash
mkswap /swapfile
```

```bash
swapon /swapfile
```

```bash
echo '/swapfile none swap sw 0 0' >> /etc/fstab
```

### Q: Smoke Test 失败但 Deploy 成功

通常是 DNS 未生效或 TLS 证书还在申请中。等几分钟后手动验证：

```bash
kubectl get certificate -n ecom
```

```bash
kubectl describe certificate -n ecom
```

---

## 附录 A：kube-vip 工作原理

### 什么是 kube-vip？

kube-vip 在 k3s 集群的 server 节点上运行，提供一个**虚拟 IP（VIP）**：

```
            ┌──────────────────────────────────┐
            │  VIP: 10.0.0.100                 │
            │  kube-vip 选举一个 leader 节点     │
            │  leader 节点持有 VIP              │
            │                                  │
            │  S1 (leader) ← 持有 10.0.0.100   │
            │  S2 (standby)                    │
            │  S3 (standby)                    │
            └──────────────────────────────────┘

当 S1 宕机时（约 5 秒自动切换）：

            ┌──────────────────────────────────┐
            │  VIP: 10.0.0.100                 │
            │                                  │
            │  S1 (down) ✗                     │
            │  S2 (leader) ← 接管 10.0.0.100   │
            │  S3 (standby)                    │
            └──────────────────────────────────┘
```

### ARP 模式

kube-vip 使用 ARP（Address Resolution Protocol）在 VPC 网络中广播 VIP。所有节点在同一 L2 网段（VPC 保证），因此 ARP 模式直接可用。

### 为什么需要 VIP？

| 没有 VIP | 有 VIP |
|----------|--------|
| kubeconfig 写 S1 的 IP | kubeconfig 写 VIP |
| S1 宕机 → kubectl 不可用 | S1 宕机 → VIP 自动切到 S2/S3 |
| 需要手动改 kubeconfig | 无需任何操作 |

---

## 附录 B：手动安装 kube-vip（如果 Workflow 未自动安装）

SSH 到 S1：

```bash
ssh -i ~/.ssh/k3s_deploy root@<S1公网IP>
```

```bash
export KUBECONFIG=/etc/rancher/k3s/k3s.yaml
```

设置 VIP 参数：

```bash
export VIP=10.0.0.100
```

```bash
export INTERFACE=eth1
```

安装 kube-vip RBAC：

```bash
kubectl apply -f https://kube-vip.io/manifests/rbac.yaml
```

创建 kube-vip DaemonSet：

```bash
cat <<EOF | kubectl apply -f -
apiVersion: apps/v1
kind: DaemonSet
metadata:
  name: kube-vip-ds
  namespace: kube-system
  labels:
    app.kubernetes.io/name: kube-vip-ds
spec:
  selector:
    matchLabels:
      app.kubernetes.io/name: kube-vip-ds
  template:
    metadata:
      labels:
        app.kubernetes.io/name: kube-vip-ds
    spec:
      affinity:
        nodeAffinity:
          requiredDuringSchedulingIgnoredDuringExecution:
            nodeSelectorTerms:
            - matchExpressions:
              - key: node-role.kubernetes.io/master
                operator: Exists
            - matchExpressions:
              - key: node-role.kubernetes.io/control-plane
                operator: Exists
      tolerations:
      - effect: NoSchedule
        operator: Exists
      - effect: NoExecute
        operator: Exists
      containers:
      - name: kube-vip
        image: ghcr.io/kube-vip/kube-vip:v0.8.7
        args:
        - manager
        env:
        - name: vip_arp
          value: "true"
        - name: port
          value: "6443"
        - name: vip_interface
          value: "${INTERFACE}"
        - name: vip_address
          value: "${VIP}"
        - name: cp_enable
          value: "true"
        - name: cp_namespace
          value: kube-system
        - name: svc_enable
          value: "true"
        - name: svc_leasename
          value: plndr-svcs-lock
        - name: vip_leaderelection
          value: "true"
        - name: vip_leasename
          value: plndr-cp-lock
        - name: vip_leaseduration
          value: "5"
        - name: vip_renewdeadline
          value: "3"
        - name: vip_retryperiod
          value: "1"
        - name: address
          value: "${VIP}"
        securityContext:
          capabilities:
            add:
            - NET_ADMIN
            - NET_RAW
      hostNetwork: true
      serviceAccountName: kube-vip
EOF
```

验证 kube-vip 运行：

```bash
kubectl get pods -n kube-system -l app.kubernetes.io/name=kube-vip-ds
```

验证 VIP 可达（在 S2 或 S3 上测试）：

```bash
curl -k https://10.0.0.100:6443
```

---

## 附录 C：完整操作时间线

```
总计约 30 分钟

┌─ Step 1: 配置 VPS（10 分钟）─────────────────────────────┐
│  生成 SSH 密钥                                1 分钟     │
│  配置 5 台 VPS（公钥 + 防火墙）               8 分钟     │
│  验证 SSH 连通                                1 分钟     │
└──────────────────────────────────────────────────────────┘
          │
          ▼
┌─ Step 2: 配置 GitHub（5 分钟）───────────────────────────┐
│  添加 9 个 Secrets                           3 分钟     │
│  添加 7 个 Variables                         2 分钟     │
└──────────────────────────────────────────────────────────┘
          │
          ▼
┌─ Step 3: 初始化集群（15 分钟，自动）─────────────────────┐
│  运行 K3s Cluster Setup Workflow              1 分钟     │
│  等待自动执行完成                             12 分钟    │
│  导出 kubeconfig 到 GitHub                    2 分钟     │
└──────────────────────────────────────────────────────────┘
          │
          ▼
┌─ Step 4: 首次部署（10 分钟，自动）───────────────────────┐
│  运行 Build & Deploy Workflow                 1 分钟     │
│  等待自动执行完成                             9 分钟     │
└──────────────────────────────────────────────────────────┘
          │
          ▼
     部署完成 ✓

以后每次发布：push 代码 → 自动完成（约 10 分钟）
```

---

## 附录 D：与其他方案的对比

| 维度 | Docker Swarm | kubeadm K8s | K3s (本方案) |
|------|-------------|-------------|-------------|
| 安装复杂度 | 中 | 高 | **低** |
| 最低内存 | 1G/节点 | 4G/节点 | **2G/节点** |
| 高可用 | Manager 多节点 | kube-vip + etcd | **内嵌 etcd + kube-vip** |
| 数据库 HA | 手动主从 + Patroni | CloudNativePG | **CloudNativePG** |
| 反向代理 | Caddy | Nginx Ingress | **Nginx Ingress** |
| 发布方式 | SSH + docker service update | kubeconfig + Helm | **kubeconfig + Helm** |
| 发布需要 SSH | 是 | 否 | **否** |
| 回滚 | docker service rollback | helm rollback | **helm rollback** |
| 资源占用 | 低 | 高 | **中低** |
