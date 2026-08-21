# Agent State Control Room

Private, read-only StreamScapeTV dashboard for the current Agent State authority. The deployable product is an immutable OCI image plus an OCI Helm chart for K3s. Node.js is a build-time tool only; the deployed container is a pure NGINX runtime.

## Architecture

```text
Browser on the owner-approved private access path
  -> Flux-managed cluster exposure
     -> Kubernetes Service
        -> NGINX :8080
           -> /, /_next/*                         static Next.js export
           -> /healthz                            NGINX health response
           -> /supabase/rest/v1/<allowed-table>   read-only Supabase REST proxy
           -> /supabase/realtime/v1/websocket     Supabase Realtime WebSocket proxy
                                                     -> Agent State Supabase
                                                        -> five current authority tables
```

The browser uses the same-origin `/supabase` gateway and never receives the real Supabase project URL or secret. NGINX injects the Kubernetes-provided secret only on the upstream request. The REST gateway is intentionally narrower than the Supabase Data API: only the five current Agent State tables are reachable and only `GET`, `HEAD`, and `OPTIONS` are accepted. Realtime is exposed only through the exact WebSocket route.

There is no local Node data service in the deployed product: no `/api/*`, no `/events`, no loopback port `8788`, and no runtime npm or process supervisor.

## Runtime secret contract

Kubernetes must provide the existing Secret contract consumed by the chart:

```text
Secret: agent-state-dashboard-supabase
Keys:
  SUPABASE_URL
  SUPABASE_SECRET_KEY
```

The chart references those keys with `secretKeyRef`; it never contains credential values. The container entrypoint validates the values, renders the NGINX configuration into the ephemeral `/tmp` runtime filesystem with restrictive permissions, unsets the environment variables, and then starts NGINX. Do not use `NEXT_PUBLIC_*` for either value and do not place either value in generated static assets, logs, chart values, release evidence, or browser-visible responses.

Flux #288 owns the encrypted Secret material and the live cluster values. This repository owns only the producer-side Secret reference contract.

## Container contract

The image build has two distinct roles:

1. a digest-pinned Node `22.18.0` build stage installs the committed npm lockfile and produces the deterministic Next.js static export under `out/`;
2. a digest-pinned NGINX `1.29.8` runtime stage contains only the exported frontend plus the NGINX configuration and entrypoint.

The runtime listens on port `8080`, serves `/healthz` directly, runs as a non-root user, and has no Node executable requirement, npm lifecycle, local API process, or process supervisor. Kubernetes uses a read-only root filesystem with a bounded writable `/tmp` volume for NGINX state and the rendered secret-bearing configuration.

`/_next/static/*` receives immutable long-lived caching. The Next build ID is derived from the checked-in package metadata for deterministic build-scoped assets; it is not the producer release-version authority. Public release identity comes from the immutable human Git tag described below.

`out/` is generated during builds and is intentionally ignored. Never commit a prebuilt browser/runtime deployment artifact.

## Same-origin Supabase gateway

The browser reads exactly these current Agent State tables through `/supabase/rest/v1/*`:

- `current_projects`
- `current_agents`
- `current_work`
- `current_resources`
- `current_coordination`

NGINX rewrites only those exact table paths to the upstream Supabase REST endpoint. It replaces the browser API-key header with `SUPABASE_SECRET_KEY`, clears browser authorization and method-override headers, suppresses credential-bearing proxy logging, and returns `404` for the generic REST root or any other table path. Mutation methods receive `405`.

Realtime uses only:

```text
/supabase/realtime/v1/websocket
```

NGINX supplies the server-side key to the upstream WebSocket handshake, preserves only the bounded Realtime protocol parameters used by the client, disables proxy buffering/cache, and keeps the long-lived connection open. The frontend refreshes current state on Postgres Changes and retains its polling fallback for reconnect/staleness handling.

This is still an observation-only product. Do not add a generic Supabase proxy, arbitrary RPC/SQL surface, mutation endpoint, or mutation UI. Agent State schema/grant/publication/service changes belong in `StreamScapeTV/agent-state-supabase`, not this repository.

## Helm chart and cluster ownership

The producer chart lives at `charts/agent-state-dashboard`. Its current default Secret and private Service contract includes:

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

The chart can reference an immutable image digest and ordinary Kubernetes `imagePullSecrets`; registry credentials never belong in `values.yaml`.

Flux #288 owns the desired-state selection of the released image/chart, encrypted Secret material, image-pull credentials, Tailscale and any owner-approved Cloudflare exposure, reconciliation, live health proof, and rollback. This repository must not activate its own release in Kubernetes or treat an external access-layer change as deployment evidence.

## Development and validation

Use the committed Node `22.18.0` toolchain from `.nvmrc` with the committed npm lockfile for frontend/build work:

```bash
npm ci
npm test
npm run typecheck
npm run build
```

Packaging validation additionally uses Helm:

```bash
helm lint charts/agent-state-dashboard
helm template agent-state-dashboard charts/agent-state-dashboard
```

The package tests cover the build-time-only Node boundary, pinned NGINX runtime, exact same-origin REST/Realtime gateway, Secret references, Tailscale metadata, probes/resources/security posture, tag-driven release projection, and the central release caller.

Documentation-only changes do not manufacture product-build evidence. Release, container, deployment, and live-cluster evidence remain separate proofs tied to the exact source revision being released.

## Public release authority

The first real public release baseline is **`1.0.0`**. The owner created and pushed the human Git tag `1.0.0`; it resolves exactly to producer source:

```text
9051fc35810b11a9697e09e7b53d48c006c7f07b
```

The owner confirmed the automatic tag-triggered publication completed through the permanent public release path. The published producer identities are:

```text
image: ghcr.io/streamscapetv/agent-state-dashboard:1.0.0
chart: oci://ghcr.io/streamscapetv/helm-charts/agent-state-dashboard:1.0.0
```

The packaged Helm `version` and `appVersion` for that release are both `1.0.0`, projected from the human Git tag by the release capability. Flux #288 may select chart version `1.0.0`; publication itself is not proof that Flux has deployed it.

Historical `0.1.0` and `0.1.2` identities remain immutable pre-1.0 history. Never move, recreate, replay, or redefine them. `1.0.0` is also immutable now that it has been published.

### Normal release flow

`.github/workflows/release.yml` is the sole normal producer release entrypoint:

1. merge a consumable dashboard revision to `main`;
2. a human creates and pushes a fresh SemVer product tag (`1.0.1`, `1.1.0`, `2.0.0`, and so on as appropriate);
3. the tag push starts the repository release workflow automatically;
4. the thin caller invokes `StreamScapeTV/ci-workflows/.github/workflows/reusable-public-native-image-chart.yml@main`;
5. Central validates the exact tag/source identity and publishes the native `linux/amd64` image and OCI Helm chart on standard GitHub-hosted Linux;
6. Central removes publication credentials and anonymously reads back both remote OCI manifests before a successful run can complete;
7. Flux separately selects the published chart version and owns deployment.

The **human Git tag is the producer release-version authority**. A release does not require a preparatory commit that makes `package.json`, source `Chart.yaml` `version`, source `Chart.yaml` `appVersion`, and the Git tag identical. Central projects the immutable tag into the published image tag and packaged Helm chart version/appVersion. Checked-in package/chart versions may still be useful build/source metadata, but they are not an independent release selector and must not be moved merely to satisfy a release-alignment ceremony.

The release caller grants only:

```yaml
permissions:
  contents: read
  packages: write
```

It passes bounded product names and paths only. It does **not** pass private registry credentials, a release backend selector, raw runner labels, cluster credentials, or deployment inputs. Runner/container/publication mechanics belong to the reviewed Central public API, not this product caller. The caller intentionally references Central at `@main`; an implementation SHA resolved during a run may be useful supplementary evidence, but it is not the product release identity or an operator-supplied release selector.

The required current image target is **`linux/amd64`**. Multi-architecture publication is optional future capability, not a release gate. The producer publishes no `latest` authority and the normal release path retains zero routine GitHub Actions artifacts.

Release evidence must distinguish what is actually known from what is not. For `1.0.0`, the owner-confirmed successful publication plus the reviewed fail-closed Central contract establishes that the GitHub-hosted runner and anonymous OCI read-back gates passed. The connected GitHub tooling used during release reconciliation could not enumerate the tag-push run without a known run ID, so no workflow run ID or remote digest is fabricated in repository evidence.

See [`docs/release.md`](docs/release.md) for the producer evidence and Flux handoff contract.
