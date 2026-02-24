{{- define "ho-stack.name" -}}
{{- default .Chart.Name .Values.global.nameOverride | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "ho-stack.fullname" -}}
{{- if .Values.global.fullnameOverride -}}
{{- .Values.global.fullnameOverride | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- printf "%s-%s" .Release.Name (include "ho-stack.name" .) | trunc 63 | trimSuffix "-" -}}
{{- end -}}
{{- end -}}

{{- define "ho-stack.labels" -}}
app.kubernetes.io/name: {{ include "ho-stack.name" . }}
helm.sh/chart: {{ .Chart.Name }}-{{ .Chart.Version | replace "+" "_" }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end -}}

{{- define "ho-stack.selectorLabels" -}}
app.kubernetes.io/name: {{ include "ho-stack.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}

{{- define "ho-stack.apiName" -}}
{{- printf "%s-api" (include "ho-stack.fullname" .) -}}
{{- end -}}

{{- define "ho-stack.postgresPrimary" -}}
{{- printf "%s-postgres-primary" (include "ho-stack.fullname" .) -}}
{{- end -}}

{{- define "ho-stack.postgresReplica" -}}
{{- printf "%s-postgres-replica" (include "ho-stack.fullname" .) -}}
{{- end -}}

{{- define "ho-stack.redis" -}}
{{- printf "%s-redis" (include "ho-stack.fullname" .) -}}
{{- end -}}

{{- define "ho-stack.pgbouncerRw" -}}
{{- printf "%s-pgbouncer-rw" (include "ho-stack.fullname" .) -}}
{{- end -}}

{{- define "ho-stack.pgbouncerRo" -}}
{{- printf "%s-pgbouncer-ro" (include "ho-stack.fullname" .) -}}
{{- end -}}
