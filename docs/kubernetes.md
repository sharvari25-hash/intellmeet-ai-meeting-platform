# Kubernetes and Helm: the scalable path

**Production runs on Vercel (client) and Render (API).** That is the
deployment the live demo uses, because both have free tiers and no cluster to
operate. The Kubernetes manifests and the Helm chart in this repository show
how the same two images run when one instance is no longer enough: several API
pods behind an Ingress, autoscaled on CPU, optionally with the AI worker as a
Deployment of its own. They are validated locally; nothing in production
depends on them.

```
                         Ingress (one host)
             /api ──────────┐      ┌────────── /socket.io (sticky)
                            ▼      ▼
   /  ──► client Service ─► nginx pods        server Service ─► API pods (HPA 2-6)
                                                    │   │ Socket.io Redis adapter,
                                                    │   │ rate limits, presence, BullMQ
                                                    ▼   ▼
                                               MongoDB   Redis     (Atlas / Upstash,
                                                                    or local-only pods)
```

## What is in the repository

| Path | What |
| --- | --- |
| `k8s/base/` | Plain manifests (Kustomize): namespace, ConfigMap, API and client Deployments and Services, HPA, Ingress. `kubectl apply -k k8s/base` |
| `k8s/secret.example.yaml` | The Secret's shape, with placeholders. Not applied by anything; create the real one with `kubectl create secret` |
| `k8s/local/` | Overlay for kind: in-cluster MongoDB and Redis, locally built images, one replica, the site on `http://localhost:8081` |
| `helm/intellmeet/` | The same stack as a parameterised chart (`values.yaml`), plus a PodDisruptionBudget, an optional separate AI worker, and a `helm test` |
| `helm/intellmeet/values-local.yaml` | The chart's equivalent of `k8s/local` |

## Design decisions

| Decision | Why |
| --- | --- |
| **Readiness on `/api/health/ready`, liveness on `/api/health`** | Readiness answers 503 while MongoDB or Redis is unreachable, which takes a pod out of the Service without restarting it. Liveness only fails if the process cannot answer at all: restarting every pod during a database outage turns a partial outage into a total one (the Phase 1 decision, now used as intended). |
| **A startup probe** (2 minutes) | The server connects to MongoDB and Redis, with retries, before it listens. Without it the liveness probe would kill a pod that is simply waiting for Atlas. |
| **Sticky sessions on the Ingress** | Socket.io opens a WebSocket but falls back to HTTP long-polling, whose requests must all reach the pod holding that session. A cookie pins a browser to one API pod. Broadcasts still reach everyone, whichever pod they are on, through the Redis adapter the server has had since Phase 3. |
| **One-hour proxy timeouts, 60 MB bodies** | A quiet meeting's socket must not be cut at the default 60 s; a recording uploaded to the API (no Cloudinary) can be up to `MAX_RECORDING_MB` (50). |
| **HPA on CPU at 70%, 2 to 6 pods, slow scale-down** | The API is stateless apart from each socket. Rate limits, presence, room state and the job queue are in Redis, and the housekeeping sweep is idempotent, so pods are interchangeable. Scale-down waits five minutes because removing a pod drops its sockets (clients reconnect elsewhere). |
| **The worker in-process by default, or its own Deployment** | Each API pod consumes the BullMQ queue, like Render's single instance; BullMQ gives each job to exactly one worker. `worker.enabled=true` in the chart moves transcription (ffmpeg and long provider calls) to its own pods, and the API pods stop consuming. |
| **"Restricted" Pod Security Standard** | Non-root (the images' own `node` and `nginx` users), no privilege escalation, all capabilities dropped, RuntimeDefault seccomp, **read-only root filesystem**. The only writable paths are emptyDirs: `/tmp` (ffmpeg's scratch space, nginx's pid) and the recordings directory. The server image was run this way under Docker (`--read-only --cap-drop ALL`) and answered its health check. |
| **`maxUnavailable: 0`, a preStop pause, 30 s grace** | A new pod is ready before an old one goes; the 5 s pause lets endpoint removal reach the Ingress before SIGTERM; 30 s is more than the server's own 10 s graceful shutdown. |
| **Secrets created outside Helm by default** | `secrets.create=false` references an existing Secret, so values never sit in a values file or in Helm's release history. `values-local.yaml` creates one for kind, with `JWT_SECRET` passed on the command line. |
| **Config checksums on the pod template** | The ConfigMap is read at start-up only; a `helm upgrade` that changes a setting rolls the pods. |
| **Local databases are a separate, labelled opt-in** | `k8s/local/databases.yaml` and `localDatabases.enabled` exist only so the stack runs on a laptop. Single replica, emptyDir, no auth; production uses Atlas and Upstash. |

### About the Ingress controller

The annotations are for **ingress-nginx**, which the Kubernetes project
retired on **24 March 2026** (the repository is read-only; no more fixes). It
still installs on kind, which is all it is used for here. The `Ingress`
resource itself is unchanged in Kubernetes; only the controller is gone. For a
real cluster:

- keep the Ingress and switch controller: the chart takes `ingress.className`
  and `ingress.annotations` as values. What to express in the new controller's
  terms is the same three things: cookie affinity, a one-hour read timeout, and
  a 60 MB request body;
- or move to the **Gateway API** (`HTTPRoute`), for which SIG Network's
  `ingress2gateway` converts these annotations.

## Validation performed (no cluster needed)

Nothing is installed for these: Helm, kubeconform and actionlint run from
their official Docker images.

```powershell
# helm lint, strict, with the default and the local values (Helm 4.3 and 3.22)
docker run --rm -v "${PWD}:/w" -w /w alpine/helm:4.3.0 lint helm/intellmeet --strict
docker run --rm -v "${PWD}:/w" -w /w alpine/helm:4.3.0 lint helm/intellmeet --strict `
  -f helm/intellmeet/values-local.yaml --set-string secrets.values.JWT_SECRET=x

# helm template: render the manifests
docker run --rm -v "${PWD}:/w" -w /w alpine/helm:4.3.0 template intellmeet helm/intellmeet -n intellmeet

# kustomize (built into kubectl)
kubectl kustomize k8s/base
kubectl kustomize k8s/local

# Schema-check what the overlays and the chart render, strictly (piped, so
# no temporary files; the manifests are plain ASCII)
kubectl kustomize k8s/local | docker run --rm -i ghcr.io/yannh/kubeconform:v0.8.0 -strict -summary -kubernetes-version 1.33.0 -
docker run --rm -v "${PWD}:/w" -w /w alpine/helm:4.3.0 template intellmeet helm/intellmeet -n intellmeet |
  docker run --rm -i ghcr.io/yannh/kubeconform:v0.8.0 -strict -summary -kubernetes-version 1.33.0 -
```

Results at the Phase 11 checkpoint: `helm lint --strict` passes (Helm 4.3.0
and 3.22.0, default and local values; the only note is the optional chart
icon); `helm template` renders 9 objects with the defaults, 13 with the local
values and the worker variant as expected; a missing `JWT_SECRET` stops the
render with a readable message; **kubeconform: 50 resources in 6 renders, 50
valid, 0 invalid** (strict mode, Kubernetes 1.33 schemas).

## Running it on kind

kind runs a Kubernetes cluster inside Docker containers, so Docker Desktop is
all it needs. (Docker Desktop's own Kubernetes, *Settings → Kubernetes →
Enable*, works too; skip the `kind` commands and the port becomes 80.)

**Install** (one of):

```powershell
winget install Kubernetes.kind      # or: choco install kind / scoop install kind
winget install Helm.Helm            # only for the Helm route
```

**Create the cluster and its ingress controller:**

```powershell
kind create cluster --config k8s/local/kind-config.yaml
kubectl apply -f https://raw.githubusercontent.com/kubernetes/ingress-nginx/controller-v1.15.1/deploy/static/provider/kind/deploy.yaml
kubectl -n ingress-nginx wait --for=condition=ready pod -l app.kubernetes.io/component=controller --timeout=180s

# Optional, for the HPA: metrics-server (kind's kubelets use self-signed certs)
kubectl apply -f https://github.com/kubernetes-sigs/metrics-server/releases/download/v0.9.0/components.yaml
kubectl -n kube-system patch deployment metrics-server --type=json `
  -p '[{"op":"add","path":"/spec/template/spec/containers/0/args/-","value":"--kubelet-insecure-tls"}]'
```

**Build the images and copy them into the cluster** (kind nodes cannot see
the host's images):

```powershell
docker build -f server/Dockerfile -t intellmeet-server:local .
docker build -f client/Dockerfile -t intellmeet-client:local .
kind load docker-image intellmeet-server:local intellmeet-client:local --name intellmeet
```

**Deploy, either with Kustomize...**

```powershell
kubectl apply -f k8s/base/namespace.yaml
$jwt = node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
kubectl -n intellmeet create secret generic intellmeet-secrets `
  --from-literal=JWT_SECRET=$jwt `
  --from-literal=MONGODB_URI=mongodb://mongo:27017/intellmeet `
  --from-literal=REDIS_URL=redis://redis:6379
kubectl apply -k k8s/local
kubectl -n intellmeet rollout status deploy/intellmeet-server --timeout=180s
kubectl -n intellmeet exec deploy/intellmeet-server -- node dist/scripts/seed.js
```

**...or with Helm** (use one route per cluster, not both):

```powershell
$jwt = node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
helm upgrade --install intellmeet helm/intellmeet -n intellmeet --create-namespace `
  -f helm/intellmeet/values-local.yaml --set-string secrets.values.JWT_SECRET=$jwt
kubectl label namespace intellmeet pod-security.kubernetes.io/enforce=restricted
kubectl -n intellmeet rollout status deploy/intellmeet-server --timeout=180s
kubectl -n intellmeet exec deploy/intellmeet-server -- node dist/scripts/seed.js
helm test intellmeet -n intellmeet
```

**Check it:**

```powershell
kubectl -n intellmeet get pods,svc,ingress,hpa
curl.exe http://localhost:8081/api/health        # {"status":"ok",...,"mongo":{"status":"up"},...}
start http://localhost:8081                      # Try Live Demo
kubectl -n intellmeet top pods                   # with metrics-server
```

What to look for: every pod `Running` and `READY 1/1`; the API's readiness
turning 503 if you `kubectl -n intellmeet scale deploy/redis --replicas=0`
(the pod leaves the Service but is not restarted), and back once Redis
returns; a demo sign-in surviving a page reload (the refresh cookie works on
`localhost`).

**Remove everything:** `kind delete cluster --name intellmeet`.

## Using the GHCR images on a real cluster

The Docker workflow pushes `ghcr.io/sharvari25-hash/intellmeet-server` and
`-client` on every merge to main, tagged `latest` and `sha-<commit>`. The
repository is private, so the packages are too: either make them public
(*GitHub → your profile → Packages → the package → Package settings → Change
visibility*), or give the cluster a pull secret:

```powershell
kubectl -n intellmeet create secret docker-registry ghcr `
  --docker-server=ghcr.io --docker-username=<github-user> --docker-password=<PAT with read:packages>
helm upgrade --install intellmeet helm/intellmeet -n intellmeet `
  --set imagePullSecrets[0].name=ghcr --set server.image.tag=sha-<commit> --set client.image.tag=sha-<commit>
```
