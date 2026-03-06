{{/*
_helpers.tpl — Helm 模板函数
*/}}

{{/*
Chart 完整名称
*/}}
{{- define "ecom.fullname" -}}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Chart 名称
*/}}
{{- define "ecom.name" -}}
{{- .Chart.Name | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
通用标签
*/}}
{{- define "ecom.labels" -}}
helm.sh/chart: {{ .Chart.Name }}-{{ .Chart.Version | replace "+" "_" }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
app.kubernetes.io/part-of: ecom
{{- end }}

{{/*
服务选择器标签
*/}}
{{- define "ecom.selectorLabels" -}}
app.kubernetes.io/name: {{ .name }}
app.kubernetes.io/instance: {{ .release }}
{{- end }}

{{/*
服务完整镜像路径
用法: {{ include "ecom.serviceImage" (dict "registry" .Values.global.registry "image" .Values.apiGateway.image "tag" .Values.global.imageTag) }}
*/}}
{{- define "ecom.serviceImage" -}}
{{ .registry }}/{{ .image }}:{{ .tag }}
{{- end }}

{{/*
CloudNativePG 读写 Service 地址
用法: {{ include "ecom.pgRwHost" . }}
*/}}
{{- define "ecom.pgRwHost" -}}
{{ include "ecom.fullname" . }}-pg-rw
{{- end }}

{{/*
DATABASE_URL 连接字符串
*/}}
{{- define "ecom.databaseUrl" -}}
postgresql://postgres:$(POSTGRES_PASSWORD)@{{ include "ecom.pgRwHost" . }}:5432/{{ .Values.postgresql.database }}
{{- end }}

{{/*
Redis Sentinel Service 地址（Bitnami Redis 子图）
Sentinel 模式下 ioredis 通过 sentinel 发现 master，REDIS_URL 作为 fallback
*/}}
{{- define "ecom.redisSentinelHost" -}}
{{ include "ecom.fullname" . }}-redis
{{- end }}

{{/*
REDIS_URL 连接字符串（fallback，Sentinel 不可用时使用）
*/}}
{{- define "ecom.redisUrl" -}}
redis://{{ include "ecom.redisSentinelHost" . }}:6379
{{- end }}

{{/*
REDIS_SENTINELS（逗号分隔的 host:port）
*/}}
{{- define "ecom.redisSentinels" -}}
{{ include "ecom.redisSentinelHost" . }}:26379
{{- end }}

{{/*
Secret 名称
*/}}
{{- define "ecom.secretName" -}}
{{ include "ecom.fullname" . }}-secrets
{{- end }}

{{/*
PG Superuser Secret 名称
*/}}
{{- define "ecom.pgSecretName" -}}
{{ include "ecom.fullname" . }}-pg-superuser
{{- end }}

{{/*
imagePullSecrets（拉取私有镜像仓库凭证）
用法: {{ include "ecom.imagePullSecrets" . | nindent 6 }}
*/}}
{{- define "ecom.imagePullSecrets" -}}
{{- if .Values.global.imagePullSecrets }}
imagePullSecrets:
{{- range .Values.global.imagePullSecrets }}
  - name: {{ . }}
{{- end }}
{{- end }}
{{- end }}

{{/*
通用环境变量（所有微服务共享）
*/}}
{{- define "ecom.commonEnv" -}}
- name: NODE_ENV
  value: {{ .Values.services.nodeEnv | quote }}
- name: LOG_LEVEL
  value: {{ .Values.services.logLevel | quote }}
- name: CORS_ORIGINS
  value: {{ .Values.services.corsOrigins | quote }}
- name: POSTGRES_PASSWORD
  valueFrom:
    secretKeyRef:
      name: {{ include "ecom.secretName" . }}
      key: postgres-password
- name: DATABASE_URL
  valueFrom:
    secretKeyRef:
      name: {{ include "ecom.secretName" . }}
      key: database-url
- name: REDIS_URL
  value: {{ include "ecom.redisUrl" . }}
- name: REDIS_SENTINELS
  value: {{ include "ecom.redisSentinels" . }}
- name: REDIS_SENTINEL_MASTER
  value: {{ .Values.redis.sentinel.masterSet | default "mymaster" | quote }}
- name: JWT_ACCESS_SECRET
  valueFrom:
    secretKeyRef:
      name: {{ include "ecom.secretName" . }}
      key: jwt-access-secret
- name: JWT_REFRESH_SECRET
  valueFrom:
    secretKeyRef:
      name: {{ include "ecom.secretName" . }}
      key: jwt-refresh-secret
- name: INTERNAL_SECRET
  valueFrom:
    secretKeyRef:
      name: {{ include "ecom.secretName" . }}
      key: internal-secret
{{- end }}

{{/*
容器安全上下文（非 root、禁止提权、丢弃所有 capabilities）
所有服务 Dockerfile 统一 UID/GID 1000
不设 readOnlyRootFilesystem：Bun 运行时需写 /tmp 缓存
用法: {{ include "ecom.securityContext" . | nindent 10 }}
*/}}
{{- define "ecom.securityContext" -}}
securityContext:
  runAsNonRoot: true
  runAsUser: 1000
  runAsGroup: 1000
  allowPrivilegeEscalation: false
  capabilities:
    drop: [ALL]
{{- end }}

{{/*
通用健康检查探针
用法: {{ include "ecom.probes" (dict "port" 3000 "path" "/health") }}
      {{ include "ecom.probes" (dict "port" 3000 "path" "/health/ready" "livePath" "/health/live") }}
livePath 可选，默认与 path 相同；用于 API Gateway 区分存活/就绪探针
*/}}
{{- define "ecom.probes" -}}
{{- $path := default "/health" .path -}}
{{- $livePath := default $path .livePath -}}
startupProbe:
  httpGet:
    path: {{ $path }}
    port: {{ .port }}
  initialDelaySeconds: 1
  periodSeconds: 2
  timeoutSeconds: 3
  failureThreshold: 30
livenessProbe:
  httpGet:
    path: {{ $livePath }}
    port: {{ .port }}
  periodSeconds: 10
  timeoutSeconds: 3
  failureThreshold: 3
readinessProbe:
  httpGet:
    path: {{ $path }}
    port: {{ .port }}
  periodSeconds: 5
  timeoutSeconds: 3
  failureThreshold: 3
{{- end }}

{{/*
preStop 钩子：Pod 收到 SIGTERM 后先等 3 秒
让 K8s Endpoint 控制器有时间将此 Pod 从 Service 中摘除
避免 NGINX Ingress 仍往已停止的 Pod 发请求
用法: {{ include "ecom.lifecycle" . | nindent 10 }}
*/}}
{{- define "ecom.lifecycle" -}}
lifecycle:
  preStop:
    exec:
      command: ["sh", "-c", "sleep 3"]
{{- end }}
