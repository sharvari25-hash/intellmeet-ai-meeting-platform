{{/*
Names and labels shared by every template.
*/}}

{{- define "intellmeet.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
The release's base name: "intellmeet" for `helm install intellmeet`, or
"<release>-intellmeet" otherwise. Truncated to the 63 characters a DNS label
allows.
*/}}
{{- define "intellmeet.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- if contains $name .Release.Name }}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}
{{- end }}

{{- define "intellmeet.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/* Labels on every object. */}}
{{- define "intellmeet.labels" -}}
helm.sh/chart: {{ include "intellmeet.chart" . }}
app.kubernetes.io/name: {{ include "intellmeet.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
app.kubernetes.io/part-of: intellmeet
{{- end }}

{{/*
Selector labels for one component. Call with (dict "ctx" $ "component" "server").
Selectors are immutable on a Deployment, so they hold only what never changes.
*/}}
{{- define "intellmeet.selectorLabels" -}}
app.kubernetes.io/name: {{ include "intellmeet.name" .ctx }}
app.kubernetes.io/instance: {{ .ctx.Release.Name }}
app.kubernetes.io/component: {{ .component }}
{{- end }}

{{/* Name of the Secret the API reads: the chart's own, or an existing one. */}}
{{- define "intellmeet.secretName" -}}
{{- if .Values.secrets.create }}
{{- include "intellmeet.fullname" . }}
{{- else }}
{{- required "secrets.existingSecret is required when secrets.create is false" .Values.secrets.existingSecret }}
{{- end }}
{{- end }}

{{/* "repository:tag" for an image block. */}}
{{- define "intellmeet.image" -}}
{{- printf "%s:%s" .repository (toString .tag) }}
{{- end }}

{{/*
The API's environment: the ConfigMap, the Secret, and the settings the chart
itself decides. Shared by the API, the worker and the Helm test.
*/}}
{{- define "intellmeet.serverEnv" -}}
envFrom:
  - configMapRef:
      name: {{ include "intellmeet.fullname" . }}
  - secretRef:
      name: {{ include "intellmeet.secretName" . }}
env:
  - name: PORT
    value: {{ .Values.server.port | quote }}
  - name: NODE_OPTIONS
    value: {{ .Values.server.nodeOptions | quote }}
{{- with .Values.server.extraEnv }}
{{ toYaml . }}
{{- end }}
{{- end }}

{{/*
Restarts pods when their configuration changes: the ConfigMap and Secret are
read only at start-up, so without this a `helm upgrade` that changes only a
setting would leave the old value running.
*/}}
{{- define "intellmeet.configChecksums" -}}
checksum/config: {{ include (print .Template.BasePath "/configmap.yaml") . | sha256sum }}
{{- if .Values.secrets.create }}
checksum/secret: {{ include (print .Template.BasePath "/secret.yaml") . | sha256sum }}
{{- end }}
{{- end }}
