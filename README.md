# Agent State Control Room

Private, read-only StreamScapeTV dashboard for the current Agent State authority. The deployable product is an immutable OCI image plus an OCI Helm chart for K3s; Cloudflare Pages is no longer the application runtime.

## Architecture

```text
Browser on the private tailnet
  -> Tailscale Kubernetes LoadBalancer
     -> NGINX :8080
        -> /, /_next/*      static Next.js export
        -> /healthz         Node server on 127.0.0.1:8788
        -> /api/*           Node server on 127.0.0.1:8788
        -> /events          Node SSE endpoint on 127.0.0.1:8788
                              -> server-only Supabase client
                                 -> five Agent State current tables
                                 -> Supabase Realtime invalidation
```

The browser never receives a Supabase credential. The server is observation-only: no mutation RPC, SQL editor, generic RPC proxy, or write endpoint belongs in this application.

## Runtime secret contract

Kubernetes must already contain a Secret named `agent-state-dashboard-supabase` with these keys:

```text
SUPABASE_URL
SUPABASE_SECRET_KEY
```

The chart references those keys with `secretKeyRef`; it never contains credential values. The same names are the only Supabase configuration accepted by the container entrypoint. Do not use `NEXT_PUBLIC_*` for either value.

## Container contract

The image build:

1. installs the committed npm lockfile;
2. creates the deterministic Next.js static export;
3. stages the `server/` data process from the same exact source revision;
4. serves static assets with NGINX on port `8080`;
5. starts the Node data process on loopback port `8788`;
6. proxies `/healthz`, `/api/*`, and `/events` to that process.

Both image stages use the same digest-pinned multi-platform Node base. Do not replace that digest pin with a mutable tag-only `FROM` reference during release work.

`/_next/static/*` receives immutable long-lived caching. The Next build ID is derived from the `package.json` release version so build-scoped manifests move to a new immutable URL namespace on every versioned release instead of reusing the retired prototype's fixed cache path. Other frontend routes fall back to `index.html` so the single-screen client remains navigable. NGINX and the Node process run as a non-root user, and the Helm workload uses a read-only root filesystem with a bounded `/tmp` volume.

`out/` is generated during builds and is intentionally ignored. Never commit a prebuilt browser/runtime deployment artifact.

## Helm chart

The chart lives at `charts/agent-state-dashboard`. Its default Tailscale contract is intentionally exact:

```yaml
supabase:
  existingSecret:
    name: agent-state-dashboard-supabase
    urlKey: SUPABASE_URL
    secretKeyKey: SUPABASE_SECRET_KEY

tailscale:
  enabled: true
  hostname: agent-state-dashboard
  tags:
    - tag:agent-state-dashboard
  proxyGroup: tailscale-proxy-group
```

The resulting Service is a Tailscale `LoadBalancer` with `allocateLoadBalancerNodePorts: false` and annotations for hostname `agent-state-dashboard`, tag `tag:agent-state-dashboard`, and proxy group `tailscale-proxy-group`. No public Ingress or Cloudflare Tunnel is part of the initial chart.

For private registry authentication, provide ordinary Kubernetes `imagePullSecrets`. Do not place registry credentials in `values.yaml`.

The image may be pinned by digest:

```yaml
image:
  repository: git.faruqi.dev/mimranfaruqi/agent-state-dashboard
  digest: sha256:<verified-image-index-digest>
```

Flux owns the actual cluster values and rollout; this repository owns only the producer chart and release.

## Development and validation

Use the committed Node `22.18.0` runtime from `.nvmrc` with the committed npm lockfile.

```bash
npm ci
npm test
npm run typecheck
npm run build
```

Packaging validation additionally requires Helm:

```bash
helm lint charts/agent-state-dashboard
helm template agent-state-dashboard charts/agent-state-dashboard
```

The package tests check the NGINX route contract, Secret references, Tailscale metadata, probes/resources/security posture, release-version alignment, and the central release caller. A clean image build must be exercised against the merged server data plane before tagging a release.

## Immutable release

`.github/workflows/release.yml` is a thin tag-push caller of the organization release primitive. It does not choose a runner or container engine. Before tagging, that caller must reference the reviewed central publisher by a full immutable `ci-workflows` commit SHA containing the required verified chart-digest contract; mutable `@main` is not release authority.

For every release, keep these four versions identical before creating the tag:

- Git tag, for example `0.1.0`;
- `package.json` `version`;
- `charts/agent-state-dashboard/Chart.yaml` `version`;
- `charts/agent-state-dashboard/Chart.yaml` `appVersion`.

The current registry layout is:

```text
git.faruqi.dev/mimranfaruqi/agent-state-dashboard:<version>
oci://git.faruqi.dev/mimranfaruqi/helm-charts/agent-state-dashboard
```

The workflow uses the repository secrets `FORGEJO_REGISTRY_USERNAME` and `FORGEJO_REGISTRY_TOKEN`, publishes no `latest` authority, retains no routine Actions artifact, and performs no deployment. Keep the exact source SHA, immutable central publisher SHA, and verified remote image/chart digest evidence from the central workflow for the release handoff to Flux.

The required evidence fields and Cloudflare retirement handoff are documented in [`docs/release.md`](docs/release.md). External Pages/Access removal follows successful Flux #288 activation; disabling the old service is never used as proof that the K3s release is healthy.

## Supabase boundary

The server reads only the five current Agent State tables required by the dashboard and subscribes to their Realtime changes:

- `current_projects`
- `current_agents`
- `current_work`
- `current_resources`
- `current_coordination`

The dashboard must never mutate the Agent State project. Any schema, grant, publication, or service change belongs in `StreamScapeTV/agent-state-supabase`, not here.
