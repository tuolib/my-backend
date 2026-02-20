## 本地开发

在 Mac 终端运行 。你可以直接修改代码，API 会热重载。

```
docker compose -f docker-compose.dev.yml up

docker compose -f docker-compose.dev.yml up -d

docker compose -f docker-compose.dev.yml up -d db
```


## 管理数据库

本地可以使用 TablePlus 连接 localhost:5432 观察数据。

## 部署：

在服务器执行一次 git clone 将代码拉取到 /root/my-app。

在 GitHub Repo 的 Settings 放入服务器 IP 和 SSH 密钥。


## 数据库生成

npx drizzle-kit generate
npx drizzle-kit push

bunx drizzle-kit push

Hono 增删改查 例子编写

2 停止并移除容器（防止旧缓存干扰）
docker compose -f docker-compose.dev.yml down

3 强制重新构建镜像（这会重新执行 Dockerfile 中的 bun install）
docker compose -f docker-compose.dev.yml up --build


##  接口测试

```
bun ./demo/user.ts

```


## 发布 数据库更新

```
docker exec db_container pg_dump -U user mydb > backup.sql

docker compose up --build -d
```