# backend

To install dependencies:

```bash
bun install
```

To run:

```bash
bun run index.ts
```

This project was created using `bun init` in bun v1.3.9. [Bun](https://bun.com) is a fast all-in-one JavaScript runtime.


本地开发：在 Mac 终端运行 docker compose -f docker-compose.dev.yml up。你可以直接修改代码，API 会热重载。

管理数据库：本地可以使用 TablePlus 连接 localhost:5432 观察数据。

部署：

在服务器执行一次 git clone 将代码拉取到 /root/my-app。

在 GitHub Repo 的 Settings 放入服务器 IP 和 SSH 密钥。