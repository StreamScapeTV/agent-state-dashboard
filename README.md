# Agent State Control Room

Private, read-only StreamScapeTV dashboard for the current Agent State authority. The deployable product is an OCI image plus an OCI Helm chart for private K3s. Node.js is build-time only; the deployed application runtime is a single NGINX container that terminates mandatory TLS itself.

## Architecture

```text
Browser on the owner-approved private access path
  -> Flux-managed cluster exposure
     -> Kubernetes Service HTTPS :443
        -> NGINX HTTPS :8443
           -> /, /_next/*                         static Next.js export
           -> /healthz                            NGINX HTTPS health response
           -> /supabase/rest/v1/<allowed-table>   read-only Supabase REST proxy
           -> /supabase/realtime/v1/websocket     Supabase Realtime WebSocket proxy
                                                     -> Agent State Supabase
                                                        -> five current authority tables
```

The browser uses the same-origin HTTPS `/supabase` gateway and never receives the real Supabase project URL or secret. NGINX injects the Kubernetes-provided Supabase secret only on upstream requests. The REST gateway reaches exactly the five current Agent State tables and accepts only `GET`, `HEAD`, and `OPTIONS`. Realtime is exposed only through the exact WebSocket route.

There is no plaintext application listener, TLS-disabled mode, local Node data service, `/api/*`, `/events`, loopback port `8788`, runtime npm, TLS sidecar, or process supervisor.

## Runtime Secret contracts

Kubernetes supplies two existing Secret contracts consumed by the producer chart.

Supabase runtime Secret:

```text
Secret default: agent-state-dashboard-supabase
Keys:
  SUPABASE_URL
  SUPABASE_SECRET_KEY
```

Mandatory TLS Secret:

```text
Secret default: agent-state-dashboard-tls
Keys:
  tls.crt
  tls.key
Mounted runtime paths:
  /tls/tls.crt
  /tls/tls.key
```

The chart references Supabase values with `secretKeyRef` and mounts the TLS Secret read-only at `/tls`. Secret values, certificates, and private keys never belong in chart values, generated browser assets, logs, repository source, or release evidence.

The runtime entrypoint fails closed when Supabase inputs or TLS material are invalid, renders secret-bearing NGINX configuration only into ephemeral `/tmp`, validates the NGINX/TLS configuration, unsets Supabase credential environment variables, and then starts NGINX.

Flux #288 owns encrypted runtime/TLS Secret material, cert-manager `Certificate` resources, the actual certificate Secret/domain, cluster exposure, reconciliation, rollout health proof, and rollback.

## Container contract

The image build has two roles:

1. digest-pinned Node `22.18.0` installs the committed npm lockfile and creates the deterministic Next.js static export under `out/`;
2. digest-pinned NGINX `1.29.8` is the only runtime and contains the exported frontend plus gateway configuration/entrypoint.

The runtime listens only on HTTPS `8443`, serves `/healthz` directly, runs non-root, uses a read-only root filesystem, and requires the read-only TLS Secret mount. `out/` is generated and ignored; never commit a prebuilt deployment artifact.

## Same-origin Agent State reads

The browser reads exactly:

- `current_projects`
- `current_agents`
- `current_work`
- `current_resources`
- `current_coordination`

through `/supabase/rest/v1/*`. NGINX substitutes the server-side key, clears browser authorization/method-override headers, suppresses credential-bearing proxy logs, rejects unlisted tables, and returns `405` for mutation methods.

Realtime uses only:

```text
/supabase/realtime/v1/websocket
```

Current `main` is Realtime-first: after bootstrap, healthy Postgres Changes row payloads are applied directly in memory; normal live events do not trigger a full REST snapshot. Bounded polling/reconciliation is recovery-only while connection/data convergence is unhealthy. The compact activity feed is in-memory only and is not durable Agent State history.

This remains an observation-only product. Agent State schema/grant/publication/service changes belong in `StreamScapeTV/agent-state-supabase`.

## Helm chart and cluster ownership

The producer chart lives at `charts/agent-state-dashboard`. Important defaults include:

```yaml
image:
  repository: ghcr.io/streamscapetv/agent-state-dashboard
  tag: ""
  digest: ""

service:
  port: 443

supabase:
  existingSecret:
    name: agent-state-dashboard-supabase
    urlKey: SUPABASE_URL
    secretKeyKey: SUPABASE_SECRET_KEY

tls:
  existingSecret:
    name: agent-state-dashboard-tls
    certKey: tls.crt
    keyKey: tls.key

tailscale:
  enabled: true
  hostname: agent-state-dashboard
  tags:
    - tag:agent-state-dashboard
  proxyGroup: tailscale-proxy-group
```

The empty default `image.tag` is intentional. The Deployment template uses `.Chart.AppVersion` when no explicit tag is supplied. Therefore packaged chart `X.Y.Z` (whose `appVersion` is stamped to `X.Y.Z` by the release workflow) deploys immutable image `ghcr.io/streamscapetv/agent-state-dashboard:X.Y.Z` by default.

Flux owns which chart release is selected. Flux must not deploy the moving Docker `:latest` alias; its desired state should select the newest allowed stable SemVer chart and inherit the matching image version from that chart.

## Development and validation

Use Node `22.18.0` from `.nvmrc` and the committed lockfile:

```bash
npm ci
npm test
npm run typecheck
npm run build
```

Packaging validation additionally uses:

```bash
helm lint charts/agent-state-dashboard
helm template agent-state-dashboard charts/agent-state-dashboard
```

Public repository validation remains on reviewed Central reusable workflows and standard GitHub-hosted Linux. Runtime secrets are never provided to public CI.

## Public release authority

### Published immutable release: 1.0.2

The currently recorded public producer release is immutable **`1.0.2`**, tagged at source:

```text
6335d577a8d94d90129d4069848f8c88fd888815
```

Published identities:

```text
image: ghcr.io/streamscapetv/agent-state-dashboard:1.0.2
chart: oci://ghcr.io/streamscapetv/helm-charts/agent-state-dashboard:1.0.2
```

Release run `32467249706` completed publication and anonymous read-back with zero routine Actions artifacts. `1.0.2` predates later `main` changes including Realtime-first #81 and this latest-alias release enhancement, so its evidence must not be copied forward to a future release.

Historical `0.1.0`, `0.1.2`, `1.0.0`, and `1.0.2` identities are immutable. Never move, replay, recreate, republish, or redefine them.

### Normal release flow

`.github/workflows/release.yml` is the sole normal producer release entrypoint:

1. merge a consumable dashboard revision to `main`;
2. a human creates and pushes a **fresh** SemVer product tag (for example a later patch such as `1.0.3`; never reuse `1.0.2`);
3. the tag automatically starts the repository release workflow;
4. the thin caller invokes `StreamScapeTV/ci-workflows/.github/workflows/reusable-public-native-image-chart.yml@main` with `publish_latest_image: true`;
5. Central validates exact tag/source identity and builds the native `linux/amd64` image exactly once on standard GitHub-hosted Linux;
6. Central publishes immutable image `<tag>` and immutable Helm chart `<tag>`; packaged chart `version` and `appVersion` are both `<tag>`;
7. Central tags that **same built image** as Docker `:latest`, removes publication credentials, anonymously reads back the immutable image, `:latest`, and chart, and requires the immutable and latest image manifest digests to match;
8. Flux separately selects/reconciles the newest allowed stable SemVer chart and deploys the chart's matching immutable image.

For release `X.Y.Z`, the coherent producer set is:

```text
immutable image: ghcr.io/streamscapetv/agent-state-dashboard:X.Y.Z
convenience alias: ghcr.io/streamscapetv/agent-state-dashboard:latest  # same image digest
immutable chart: oci://ghcr.io/streamscapetv/helm-charts/agent-state-dashboard:X.Y.Z
packaged chart version: X.Y.Z
packaged chart appVersion: X.Y.Z
default chart image: ghcr.io/streamscapetv/agent-state-dashboard:X.Y.Z
```

The **human Git tag is release/source authority**. The Docker `:latest` tag is only a mutable convenience alias for humans and registry browsing. It is **not** Helm chart authority, Flux deployment authority, historical evidence, or a replacement for the immutable SemVer image.

There is deliberately no mutable Helm chart `latest` release. Flux should resolve the newest stable SemVer chart; the chart then provides the exact matching image version through `appVersion`. This prevents chart/image drift while still making upgrades automatic.

The release caller grants only:

```yaml
permissions:
  contents: read
  packages: write
```

It passes bounded product names/paths plus the reviewed `publish_latest_image` boolean. It does not pass private registry credentials, a runner/backend selector, raw runner labels, cluster credentials, Flux inputs, or deployment policy. Central's public release API owns GitHub-hosted runner/publication mechanics internally.

The current required image platform is `linux/amd64`. Multi-architecture publication is optional future capability. Normal release runs retain zero routine Actions artifacts.

Publication and deployment remain separate authorities: this repository publishes/verifies producer artifacts; Flux owns cluster desired state, source selection, reconciliation, rollout, health proof, and rollback.

See [`docs/release.md`](docs/release.md) for the release evidence and Flux handoff contract.
