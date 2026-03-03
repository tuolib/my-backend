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
Redis Primary Service 地址
*/}}
{{- define "ecom.redisPrimaryHost" -}}
{{- if .Values.redis.serviceName -}}
{{ .Values.redis.serviceName }}
{{- else -}}
{{ include "ecom.fullname" . }}-redis
{{- end -}}
{{- end }}

{{/*
REDIS_URL 连接字符串
*/}}
{{- define "ecom.redisUrl" -}}
redis://{{ include "ecom.redisPrimaryHost" . }}:6379
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
  value: {{ include "ecom.databaseUrl" . }}
- name: REDIS_URL
  value: {{ include "ecom.redisUrl" . }}
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
通用健康检查探针
用法: {{ include "ecom.probes" (dict "port" 3000) }}
*/}}
{{- define "ecom.probes" -}}
startupProbe:
  httpGet:
    path: /health
    port: {{ .port }}
  initialDelaySeconds: 5
  periodSeconds: 5
  failureThreshold: 12
livenessProbe:
  httpGet:
    path: /health
    port: {{ .port }}
  periodSeconds: 15
  timeoutSeconds: 5
  failureThreshold: 3
readinessProbe:
  httpGet:
    path: /health
    port: {{ .port }}
  periodSeconds: 10
  timeoutSeconds: 5
  failureThreshold: 3
{{- end }}
