# Plan: 添加 k3s 支持（与 k8s 并存）

## Context

当前项目有完整的 5 节点 kubeadm K8s 集群初始化方案，但用户的 VPS 资源不足（1 CPU / 954 MB），无法运行 kubeadm。需要添加 k3s 作为轻量级替代方案，两套配置完全独立、互不影响，GitHub Actions 可选择目标平台。

## 目录结构

```
infra/
  k8s/                              # 现有，不动
    cluster-setup/                   # kubeadm 脚本 01-06
    ecom-chart/                      # 共享 Helm Chart
      values.yaml                    # k8s 生产
      values-dev.yaml                # 开发
      values-k3s.yaml               # ← 新增：k3s 生产
    deploy.sh
  k3s/                               # ← 全新
    cluster-setup/
      01-install-server.sh           # 首个 server（单/多节点）
      02-join-server.sh              # 追加 server（多节点 HA）
      03-join-agent.sh               # 追加 agent/worker
      04-install-operators.sh        # Operator + 节点标签
    deploy.sh                        # 手动部署脚本

.github/workflows/
  k8s-cluster-setup.yml              # 现有，不动
  k3s-cluster-setup.yml              # ← 新增
  deploy.yml                         # ← 改动：加 platform 选择
```

## 文件清单（8 个文件，改 1 新建 7）

---

### 1. `infra/k3s/cluster-setup/01-install-server.sh`（新建）

安装首个 k3s server 节点。

- 环境变量：`K3S_MODE`（single/multi）、`NODE_IP`、`K3S_EXTRA_SANS`（可选）、`K3S_VERSION`（可选）
- 安装参数：
  - `--disable traefik --disable servicelb`（我们用 Nginx Ingress）
  - `--write-kubeconfig-mode 644`
  - `--node-ip` + `--tls-san`
  - 多节点模式追加 `--cluster-init`（启用内嵌 etcd）
- 安装方式：`curl -sfL https://get.k3s.io | sh -s - server <flags>`
- 安装后：等待节点 Ready，打印 node-token 路径

### 2. `infra/k3s/cluster-setup/02-join-server.sh`（新建）

追加 server 节点（仅多节点 HA 模式）。

- 环境变量：`K3S_URL`、`K3S_TOKEN`、`NODE_IP`
- 安装：`curl ... | K3S_URL=... K3S_TOKEN=... sh -s - server --disable traefik --disable servicelb`

### 3. `infra/k3s/cluster-setup/03-join-agent.sh`（新建）

追加 agent/worker 节点（仅多节点模式）。

- 环境变量：`K3S_URL`、`K3S_TOKEN`、`NODE_IP`
- 安装：`curl ... | K3S_URL=... K3S_TOKEN=... sh -s - agent --node-ip ...`

### 4. `infra/k3s/cluster-setup/04-install-operators.sh`（新建）

安装 Operators 和设置节点标签。参考 `infra/k8s/cluster-setup/06-install-operators.sh`。

**与 k8s 版的区别：**
- 跳过 local-path-provisioner（k3s 内置）
- 跳过 Calico CNI（k3s 内置 Flannel）
- 需要先检查/安装 Helm（k3s 不自带 Helm）
- 节点标签策略：
  - **单节点**：不设 `role` 标签（values-k3s.yaml 里 nodeSelector 全为 `{}`）
  - **多节点**：同 k8s（role=data / role=ingress / role=app）
- Operator 版本与 k8s 保持一致：CNPG 1.22.1、Redis 0.18.0、Nginx Ingress 4.9.1、cert-manager v1.14.3

### 5. `infra/k8s/ecom-chart/values-k3s.yaml`（新建）

k3s 生产环境 values，放在共享 chart 目录下。

| 配置项 | k8s values.yaml | k3s values-k3s.yaml |
|--------|-----------------|---------------------|
| PG instances | 2 | 1 |
| PG storage | 10Gi | 5Gi |
| PG resources | 500m-1000m / 512Mi-1Gi | 250m-500m / 256Mi-512Mi |
| PG nodeSelector | `role: data` | `{}` |
| Redis clusterSize | 3 | 1 |
| Redis storage | 2Gi | 1Gi |
| Redis nodeSelector | `role: data` | `{}` |
| 各服务 replicas | 2 | 1 |
| 各服务 resources | 250m-500m / 256Mi-512Mi | 100m-250m / 128Mi-256Mi |
| 各服务 nodeSelector | `role: app` | `{}` |
| Ingress host | api.find345.site | api.find345.site（可 --set 覆盖）|
| TLS | enabled | enabled |
| StorageClass | local-path | local-path（k3s 内置）|

nodeSelector 全部设为 `{}`，使单节点可以正常调度所有 Pod。多节点用户可通过 `--set` 覆盖。

### 6. `infra/k3s/deploy.sh`（新建）

手动部署脚本，复用 `infra/k8s/deploy.sh` 结构。

- `CHART_DIR` 指向共享 chart：`${PROJECT_ROOT}/infra/k8s/ecom-chart`
- 默认 values 文件：`values-k3s.yaml`
- `KUBECONFIG` 默认 `/etc/rancher/k3s/k3s.yaml`
- `check_kubectl()` 增加 `k3s kubectl` 降级检查
- 其余命令（setup/build/deploy/status/destroy/migrate/rollback/full）逻辑相同

### 7. `.github/workflows/k3s-cluster-setup.yml`（新建）

k3s 集群初始化 workflow，仅 `workflow_dispatch` 触发。

**Inputs：**
- `mode`：single / multi
- `step`：all / 01-install-server / 02-join-server / 03-join-agent / 04-install-operators

**Secrets / Variables（K3S_ 前缀，与 K8S_ 独立）：**
- Secrets：`K3S_SSH_KEY`
- Variables：`K3S_SSH_USER`、`K3S_S1_HOST`、`K3S_S2_HOST`...、`K3S_VIP_INTERFACE`（可选）

**Jobs 结构：**
1. `install-server` — SSH S1，运行 01-install-server.sh，输出 node_token
2. `join-server` — 仅 multi 模式，matrix 遍历额外 server 节点
3. `join-agent` — 仅 multi 模式，matrix 遍历 agent 节点
4. `install-operators` — SSH S1，运行 04-install-operators.sh
5. `verify` — 检查节点和 Pod 状态

SSH 模式同 k8s workflow：SCP 脚本 → SSH 执行，nick-fields/retry 重试。

### 8. `.github/workflows/deploy.yml`（修改）

添加 `platform` 输入，push/PR 默认 k8s，workflow_dispatch 可选。

**改动点：**
1. `workflow_dispatch.inputs` 增加 `platform` choice（k8s / k3s）
2. 新增 env `PLATFORM: ${{ inputs.platform || 'k8s' }}`
3. `deploy` job 中根据 platform 选择：
   - SSH 目标：`K8S_SSH_HOST` vs `K3S_SSH_HOST`
   - Values 文件：默认 vs `values-k3s.yaml`
   - KUBECONFIG 路径
   - Secrets 前缀：`K8S_*` vs `K3S_*`
4. `smoke-test` summary 显示目标平台
5. 并发组按平台隔离：`deploy-{platform}-{ref}`

**不影响现有行为：** push/PR 触发时 `inputs.platform` 为空，回退到 `k8s`。

---

## 不修改的文件

- `infra/k8s/cluster-setup/*` — 6 个脚本 + kubeadm-config.yaml 全部不动
- `infra/k8s/ecom-chart/templates/*` — 所有 Helm 模板不动
- `infra/k8s/ecom-chart/Chart.yaml` — 不动
- `infra/k8s/ecom-chart/values.yaml` — 不动
- `infra/k8s/ecom-chart/values-dev.yaml` — 不动
- `infra/k8s/deploy.sh` — 不动
- `.github/workflows/k8s-cluster-setup.yml` — 不动

## 实施顺序

1. k3s 初始化脚本 01-04（`infra/k3s/cluster-setup/`）
2. `values-k3s.yaml`
3. `infra/k3s/deploy.sh`
4. `k3s-cluster-setup.yml` workflow
5. 修改 `deploy.yml` 加 platform 选择

## 验证方式

1. 脚本语法检查：`bash -n infra/k3s/cluster-setup/*.sh`
2. Helm 模板渲染：`helm template ecom infra/k8s/ecom-chart -f infra/k8s/ecom-chart/values-k3s.yaml` 确认无 nodeSelector 约束
3. Workflow 语法：`act` 或 GitHub 页面验证
4. 现有 k8s 流程不受影响：push to main 仍默认走 k8s

## GitHub Secrets/Variables 配置清单

### K3s 专用（新增）

| 类型 | 名称 | 用途 |
|------|------|------|
| Secret | `K3S_SSH_KEY` | SSH 私钥 |
| Secret | `K3S_SSH_HOST` | Server 节点 IP（deploy.yml 用） |
| Secret | `K3S_SSH_USER` | SSH 用户名（deploy.yml 用） |
| Secret | `K3S_POSTGRES_PASSWORD` | PG 密码 |
| Secret | `K3S_REPLICATION_PASSWORD` | PG 复制密码 |
| Secret | `K3S_JWT_ACCESS_SECRET` | JWT Access Secret |
| Secret | `K3S_JWT_REFRESH_SECRET` | JWT Refresh Secret |
| Secret | `K3S_INTERNAL_SECRET` | 内部服务通信密钥 |
| Variable | `K3S_SSH_USER` | SSH 用户名（cluster-setup 用） |
| Variable | `K3S_S1_HOST` | 首个 server IP |
| Variable | `K3S_S2_HOST` | 第二个 server IP（multi 可选） |
| Variable | `K3S_S3_HOST` | 第三个 server IP（multi 可选） |
| Variable | `K3S_A1_HOST` | Agent 1 IP（multi 可选） |
| Variable | `K3S_A2_HOST` | Agent 2 IP（multi 可选） |
| Variable | `K3S_EXTRA_SANS` | 额外 TLS SAN（可选） |
| Variable | `K3S_VERSION` | 指定 k3s 版本（可选） |

### K8s 现有（不变）

所有 `K8S_*` 前缀的 Secrets/Variables 保持不变。
