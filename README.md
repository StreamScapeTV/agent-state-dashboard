# Agent State Control Room

Private, read-only StreamScapeTV dashboard for the current Agent State authority. The deployable product is an immutable OCI image plus an OCI Helm chart for K3s. Node.js is a build-time tool only; the deployed application runtime is a single NGINX container that terminates mandatory TLS itself.

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

The browser uses the same-origin HTTPS `/supabase` gateway and never receives the real Supabase project URL or secret. NGINX injects the Kubernetes-provided Supabase secret only on the upstream request. The REST gateway is intentionally narrower than the Supabase Data API: only the five current Agent State tables are reachable and only `GET`, `HEAD`, and `OPTIONS` are accepted. Realtime is exposed only through the exact WebSocket route.

There is no plaintext application listener and no TLS-disabled mode. There is also no local Node data service in the deployed product: no `/api/*`, no `/events`, no loopback port `8788`, runtime npm, Node process, TLS sidecar, or process supervisor.

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

The chart references the Supabase values with `secretKeyRef` and mounts the TLS Secret read-only at `/tls`. Secret values, certificates, and private keys never belong in chart values, generated browser assets, logs, repository source, or release evidence.

The runtime entrypoint fails closed when the Supabase inputs are invalid or when the TLS certificate/private key are missing, empty, unreadable, malformed, or mismatched. It renders the secret-bearing NGINX configuration only into the ephemeral writable `/tmp` filesystem with restrictive permissions, validates the NGINX/TLS configuration, unsets the Supabase credential environment variables, and then starts NGINX. There is intentionally no no-TLS fallback.

Flux #288 owns the encrypted runtime/TLS Secret material, cert-manager `Certificate` and actual certificate Secret/domain selection, cluster values, exposure, reconciliation, rollout health proof, and rollback. This repository owns only the producer-side Secret/mount contract.

## Container contract

The image build has two distinct roles:

1. a digest-pinned Node `22.18.0` build stage installs the committed npm lockfile and produces the deterministic Next.js static export under `out/`;
2. a digest-pinned NGINX `1.29.8` runtime stage contains only the exported frontend plus the NGINX configuration and entrypoint.

The runtime listens only on non-root HTTPS port `8443`, requires `/tls/tls.crt` and `/tls/tls.key`, serves `GET https://<host>:8443/healthz` directly, and runs as a non-root user. The Docker healthcheck uses HTTPS. Kubernetes uses a read-only root filesystem with a bounded writable `/tmp` volume for NGINX state/configuration plus the read-only TLS Secret mount.

`/_next/static/*` receives immutable long-lived caching. The Next build ID is derived from checked-in package metadata for deterministic build-scoped assets; it is not the producer release-version authority. Public release identity comes from the immutable human Git tag described below.

`out/` is generated during builds and is intentionally ignored. Never commit a prebuilt browser/runtime deployment artifact.

## Same-origin Supabase gateway

The browser reads exactly these current Agent State tables through HTTPS `/supabase/rest/v1/*`:

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

This remains an observation-only product. Do not add a generic Supabase proxy, arbitrary RPC/SQL surface, mutation endpoint, or mutation UI. Agent State schema/grant/publication/service changes belong in `StreamScapeTV/agent-state-supabase`, not this repository.

## Helm chart and cluster ownership

The producer chart lives at `charts/agent-state-dashboard`. Its current default Secret and private Service contract includes:

```yaml
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

The chart mounts the TLS Secret read-only at `/tls`, exposes container port `8443` as `https`, uses HTTPS readiness/liveness probes, and exposes Service HTTPS port `443` targeting `https`. TLS is required; there is no optional plaintext branch.

The chart can reference an immutable image digest and ordinary Kubernetes `imagePullSecrets`; registry credentials never belong in `values.yaml`.

Flux #288 owns the desired-state selection of the released image/chart, encrypted Supabase/TLS Secret material, cert-manager certificate issuance and actual Secret/domain, image-pull credentials, Tailscale and any owner-approved Cloudflare/ExternalDNS exposure, reconciliation, live health proof, and rollback. This repository must not activate its own release in Kubernetes or treat an external access-layer change as deployment evidence.

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

The package tests cover the build-time-only Node boundary, pinned mandatory-TLS NGINX runtime, HTTPS-only listener, mounted TLS Secret contract, exact same-origin REST/Realtime gateway, Supabase Secret references, Tailscale metadata, probes/resources/security posture, tag-driven release projection, and the Central release caller.

Documentation-only changes do not manufacture product-build evidence. Runtime, release, container, deployment, and live-cluster evidence remain separate proofs tied to the exact source revision being tested or released.

## Public release authority

### Published baseline: 1.0.0

The first real public release baseline is immutable **`1.0.0`**. The owner-created human Git tag `1.0.0` resolves exactly to producer source:

```text
9051fc35810b11a9697e09e7b53d48c006c7f07b
```

The owner confirmed the automatic tag-triggered publication completed through the permanent public release path. The published producer identities are:

```text
image: ghcr.io/streamscapetv/agent-state-dashboard:1.0.0
chart: oci://ghcr.io/streamscapetv/helm-charts/agent-state-dashboard:1.0.0
```

The packaged Helm `version` and `appVersion` for that historical release are both `1.0.0`, projected from the human Git tag by the release capability. Flux #288 may select chart version `1.0.0`; publication itself is not proof that Flux deployed it.

`1.0.0` predates the mandatory-TLS source change merged in #89. Do not reinterpret the already-published `1.0.0` artifacts as evidence for the current HTTPS-only runtime contract.

Historical `0.1.0`, `0.1.2`, and published `1.0.0` identities are immutable. Never move, recreate, replay, republish, or redefine them.

### Next owner-directed release target: 1.0.1

Merged #89 made mounted TLS mandatory in current `main` and explicitly designated **`1.0.1`** as the next producer release after immutable `1.0.0`. Additional changes may continue to land before the human tag is created; the exact `1.0.1` source is therefore whichever consumable `main` revision the owner ultimately tags.

Do not claim `1.0.1` is published or deployed until the owner actually creates/pushes that fresh tag and the normal release/deployment evidence exists.

### Normal release flow

`.github/workflows/release.yml` is the sole normal producer release entrypoint:

1. merge a consumable dashboard revision to `main`;
2. a human creates and pushes a fresh SemVer product tag (the next owner-directed target is `1.0.1`);
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
