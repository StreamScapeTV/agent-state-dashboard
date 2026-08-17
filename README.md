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

`/_next/static/*` receives immutable long-lived caching. The Next build ID is derived from the `package.json` release version so build-scoped assets move to a new immutable URL namespace on every versioned release. Other frontend routes fall back to `index.html` so the single-screen client remains navigable.

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

The package tests cover the build-time-only Node boundary, pinned NGINX runtime, exact same-origin REST/Realtime gateway, Secret references, Tailscale metadata, probes/resources/security posture, release-version alignment, and the central release caller.

Documentation-only changes do not manufacture product-build evidence. Release, container, deployment, and live-cluster evidence remain separate proofs tied to the exact source revision being released.

## Immutable release authority

The repository-owned `.github/workflows/release.yml` remains the final release entrypoint. Product-specific runner labels, container-engine policy, or deployment logic do not belong in that workflow; it should call reviewed generic central CI/release capabilities and pass only the bounded producer inputs and named registry credentials required for publication. Flux, not the producer workflow, owns deployment.

`0.1.0` is an immutable historical release identity. It must never be republished, retagged, or redefined as the pure-NGINX release. The next pure-NGINX release authority is **`0.1.1`**. Before a `0.1.1` tag is created, the normal release work must make these four values identical:

- Git tag `0.1.1`;
- `package.json` `version` `0.1.1`;
- `charts/agent-state-dashboard/Chart.yaml` `version` `0.1.1`;
- `charts/agent-state-dashboard/Chart.yaml` `appVersion` `0.1.1`.

The current source may continue to report `0.1.0` until the separately owned release/version change is finalized; documentation does not perform that bump.

The required publication target for the current Debian/K3s environment is **`linux/amd64`**. A multi-architecture image is optional future capability, not a prerequisite for `0.1.1`. Release evidence must therefore prove the immutable `linux/amd64` image identity actually handed to Flux rather than requiring an image-index spanning architectures the deployment does not use.

Current registry locations remain:

```text
image: git.faruqi.dev/mimranfaruqi/agent-state-dashboard:<version>
chart: oci://git.faruqi.dev/mimranfaruqi/helm-charts/agent-state-dashboard
```

The producer release must publish no `latest` authority, retain no routine Actions artifact, perform verified remote read-back, and hand Flux the exact source SHA, versioned image reference/digest, chart reference/version/digest, and validation evidence. See [`docs/release.md`](docs/release.md) for the release evidence contract.
