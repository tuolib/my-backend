
## 8. WSL DNS 问题修复记录（已恢复）

问题现象（历史）：
- WSL 内网络解析失败，常见表现为 `Temporary failure in name resolution`。

当时的处理方式：
1. 在 `/etc/wsl.conf` 关闭自动生成 `resolv.conf`：

```ini
[network]
generateResolvConf = false
```

2. 重启 WSL（Windows 侧执行）：

```powershell
wsl --shutdown
```

3. 在 WSL 内手动写入 DNS（`/etc/resolv.conf`）：

```conf
nameserver 1.1.1.1
nameserver 8.8.8.8
```

4. 验证解析恢复（示例）：

```bash
getent hosts github.com
curl -I https://registry.npmjs.org
```

当前状态：
- 目前 DNS 已恢复正常，可继续按上述配置作为同类问题的固定解法。
