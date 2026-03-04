# 修复 cert-manager ACME HTTP-01 自检超时（VPS Hairpin NAT）

## 问题现象

cert-manager 持续报错，TLS 证书无法签发：

```
propagation check failed: failed to perform self check GET request
'http://api.find345.site/.well-known/acme-challenge/xxx':
context deadline exceeded (Client.Timeout exceeded while awaiting headers)
```

外部访问正常（`curl -sk https://api.find345.site/health` 返回 200），但 cert-manager 的 self-check 始终超时。

## 根因分析

```
cert-manager pod (s1/s2)
  │
  │ 1. DNS 解析 api.find345.site → s3 公网 IP (如 45.76.151.34)
  │
  │ 2. HTTP GET http://45.76.151.34/.well-known/acme-challenge/xxx
  │
  ╳ ← 超时！VPS 不支持 Hairpin NAT（集群内部无法通过公网 IP 回访自身节点）
```

**Hairpin NAT**：从 VPS 内部访问自己（或同 VPC 其他节点）的公网 IP 时，数据包无法正确路由回来。这是 Vultr / Hetzner / 大多数 VPS 提供商的共同限制。

nginx-ingress 以 `hostNetwork: true` 运行在 s3 节点，直接绑定 s3 的 80/443 端口。外部流量通过公网 IP 到达 s3 没有问题，但集群内 pod 通过公网 IP 连接 s3 会超时。

## 解决方案

让集群内 CoreDNS 将 `api.find345.site` 解析到 s3 的**内网 IP**，绕过公网路由。

### 手动修复（在集群 server 节点执行）

```bash
# 1. 获取 s3 (ingress 节点) 的内网 IP
S3_IP=$(kubectl get nodes -l role=ingress \
  -o jsonpath='{.items[0].status.addresses[?(@.type=="InternalIP")].address}')
echo "s3 内网 IP: ${S3_IP}"

# 2. 创建 CoreDNS 自定义配置（用 template 插件，因为 hosts 插件已被 NodeHosts 占用）
cat <<EOF | kubectl apply -f -
apiVersion: v1
kind: ConfigMap
metadata:
  name: coredns-custom
  namespace: kube-system
data:
  ingress-hairpin.override: |
    template IN A api.find345.site {
      answer "api.find345.site. 60 IN A ${S3_IP}"
    }
EOF

# 3. 重启 CoreDNS 使配置生效
kubectl -n kube-system rollout restart deployment/coredns
kubectl -n kube-system rollout status deployment/coredns --timeout=60s

# 4. 删除卡住的 cert-manager 资源（让它基于新 DNS 重新发起 ACME 流程）
kubectl delete challenge -n ecom --all
kubectl delete order -n ecom --all
kubectl delete certificate -n ecom --all

# 5. 等待约 30 秒后验证
sleep 30
kubectl get certificate -n ecom
# 期望输出: READY = True
```

### 验证

```bash
# 检查集群内 DNS 是否返回内网 IP
kubectl run dns-test --rm -it --image=busybox:1.36 --restart=Never \
  -- nslookup api.find345.site

# 检查 cert-manager 日志是否不再超时
kubectl -n cert-manager logs -l app=cert-manager --tail=20

# 检查证书状态
kubectl get certificate,order,challenge -n ecom

# 外部 HTTPS 测试
curl -s -o /dev/null -w '%{http_code}' https://api.find345.site/health
# 期望: 200
```

## 自动化（已集成到部署脚本）

`deploy.sh` 和 `.github/workflows/deploy.yml` 中已添加 `ensure_ingress_dns_hairpin()` 函数，在每次部署时自动执行上述配置，无需手动干预。

## 影响范围

- 仅影响集群内部 DNS 解析，外部 DNS 不受影响
- `fallthrough` 确保其他域名解析不受干扰
- k3s 的 `coredns-custom` ConfigMap 不会被 k3s 升级覆盖（与主 `coredns` ConfigMap 独立）
- 如果 ingress 节点 IP 变化，需重新执行或重新部署
