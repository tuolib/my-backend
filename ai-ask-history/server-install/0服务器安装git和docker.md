
## 服务器上使用 git 拉取代码

ssh-keygen -t ed25519

cat ~/.ssh/id_ed25519.pub

apt update

apt install git -y


---

## 1️⃣ 卸载旧版本（可选）

如果系统里有旧版本的 Docker，先卸载：

```bash
sudo apt remove docker docker-engine docker.io containerd runc
```

---

## 2️⃣ 更新软件包并安装依赖

```bash
sudo apt update
sudo apt install \
    ca-certificates \
    curl \
    gnupg \
    lsb-release -y
```

---

## 3️⃣ 添加 Docker 官方 GPG key

```bash
sudo mkdir -p /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/debian/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
```

---

## 4️⃣ 设置 Docker 官方仓库

```bash
echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
  https://download.docker.com/linux/debian $(lsb_release -cs) stable" | \
  sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
```

---

## 5️⃣ 安装 Docker Engine

```bash
sudo apt update
sudo apt install docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin -y
```

---

## 6️⃣ 验证 Docker 是否安装成功

```bash
docker --version
```

应该输出类似：

```
Docker version 24.0.2, build abc1234
```

---

## 7️⃣ 非 root 用户运行 Docker（可选）

如果你不想每次都用 `sudo docker`，可以把当前用户加入 `docker` 组：

```bash
sudo usermod -aG docker $USER
```

然后 **注销重新登录** 或运行：

```bash
newgrp docker
```


