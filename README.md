## 本地开发

在 Mac 终端运行 。你可以直接修改代码，API 会热重载。

```
docker compose -f docker-compose.dev.yml up

启动所有
docker compose -f docker-compose.dev.yml up -d

启动数据库
docker compose -f docker-compose.dev.yml up -d db

启动redis
docker compose -f docker-compose.dev.yml up -d redis
```

本地开发 数据库生成

```
bunx drizzle-kit generate
bunx drizzle-kit push
```

停止并移除容器 命令
```
docker compose -f docker-compose.dev.yml down
```

强制重新构建镜像 命令
```
docker compose -f docker-compose.dev.yml up --build
```

##  接口测试

webstorm
```
user_test.http

```


## 管理数据库

本地可以使用  连接 localhost:5432 观察数据。


## 发布生产环境

docker 配置文件 docker-compose.yml

在服务器执行一次 git clone 将代码拉取到 /root/my-app。

在 GitHub Repo 的 Settings 放入服务器 IP 和 SSH 密钥。

发布, 提交代码自动发布的脚本
```
deploy.yml
```