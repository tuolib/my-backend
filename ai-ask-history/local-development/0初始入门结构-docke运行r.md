# 本地开发

在 Mac 终端运行 。你可以直接修改代码，API 会热重载。

#### 本地运行

- 本地开发运行命令, 启动数据库和redis, 并使用bun开启服务 3000端口

```
bun run dev 
```

- 如下是各个命令含义

```
docker compose -f docker-compose.dev.yml up

启动所有
docker compose -f docker-compose.dev.yml up -d

启动数据库
docker compose -f docker-compose.dev.yml up -d db

启动redis
docker compose -f docker-compose.dev.yml up -d redis

停止并移除容器 命令
docker compose -f docker-compose.dev.yml down

强制重新构建镜像 命令
docker compose -f docker-compose.dev.yml up --build
```

#### 本地开发 数据库生成

```
bunx drizzle-kit generate
bunx drizzle-kit push
```

####  接口测试

webstorm
```
user_test.http

```

#### 管理数据库

本地可以使用  连接 localhost:5432 观察数据。



# 发布生产环境

- 使用配置文件进行蓝绿发布
- docker 配置文件 docker-compose.yml
- 提交代码自动发布的脚本 deploy.yml
- deploy.yml 生效前提：在服务器执行一次 git clone 将代码拉取到 /root/my-app。 在 GitHub Repo 的 Settings 放入服务器 IP 和 SSH 密钥。


### 数据库迁移 升级和回滚 命令

升级 回滚脚本 在 [src/db/migrate.ts](src/db/migrate.ts)

```
升级
bun run migrate

回滚
bun run migrate:down
```
