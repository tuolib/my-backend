# Docker Swarm 部署指南（5台服务器，IPv4优先/IPv6兼容）

## 架构规划

| 角色 | 节点 | 标签 | 说明 |
|------|------|------|------|
| Manager + API | node-1 | tier=api, api_slot=1 | Swarm Manager, self-hosted runner |
| API | node-2 | tier=api, api_slot=2 | API 节点 |
| API | node-3 | tier=api, api_slot=3 | API 节点 |
| DB Primary | node-4 | tier=db, db_slot=1 | PG 主库 + Redis |
| DB Replica | node-5 | tier=db, db_slot=2 | PG 从库 |

> 3 API + 2 DB，单 manager 够用。脚本自动检测 IPv4，无 IPv4 时回退 IPv6。

## 一、每台机器初始化（5台都执行）

```bash
# 1. 开放防火墙（如用 ufw）
# 2377/tcp   # Swarm 管理
# 7946/tcp   # 节点通信
# 4789/udp   # VXLAN overlay
ufw allow 2377/tcp
ufw allow 7946/tcp
ufw allow 7946/udp
ufw allow 4789/udp

# 2. 仅 IPv6-only 机器需要执行（IPv4 机器跳过）
sudo bash scripts/swarm/setup-docker-ipv6.sh
```

## 二、初始化 Swarm（仅 node-1）

```bash
# 自动检测：优先 IPv4，回退 IPv6
bash scripts/swarm/init-manager.sh

# 或手动指定：
# ADVERTISE_ADDR="192.168.1.10" bash scripts/swarm/init-manager.sh
# ADVERTISE_ADDR="[2001:db8::1]" bash scripts/swarm/init-manager.sh
```

执行后会输出 worker join 命令，在 node-2~5 上执行。

## 三、Worker 加入（node-2~5）

```bash
# 用 init-manager.sh 输出的命令，格式：
docker swarm join --token SWMTKN-xxx 192.168.1.10:2377
# IPv6-only: docker swarm join --token SWMTKN-xxx [2001:db8::1]:2377
```

## 四、打标签（node-1 上执行）

```bash
API_NODES="node-1,node-2,node-3" DB_NODES="node-4,node-5" bash scripts/swarm/label-nodes.sh
```

## 五、配置 GitHub Secrets/Variables

**Secrets（必须配置，否则部署使用不安全的默认值）：**

| Key | 说明 | 示例 |
|-----|------|------|
| `POSTGRES_PASSWORD` | PG 主库密码 | `my-strong-pg-pass` |
| `POSTGRES_REPLICATION_PASSWORD` | PG 主从复制密码 | `my-repl-pass` |
| `JWT_SECRET` | JWT 签名密钥 | `my-jwt-secret-key` |

**Variables：**

| Key | 说明 | 示例 |
|-----|------|------|
| `SWARM_DOMAIN` | 域名 | `api.example.com` |
| `DEPLOY_MODE` | 部署模式 | `multi` |
| `API_REPLICAS_MULTI` | API 副本数 | `3` |

## 六、部署

推送到 main 或手动触发 GitHub Actions 即可一键发布。

## 常用运维命令

```bash
docker node ls                          # 查看节点
docker stack services ho                # 查看服务状态
docker service logs ho_api --tail 100   # 查看 API 日志
docker service scale ho_api=5           # 扩缩容
```
