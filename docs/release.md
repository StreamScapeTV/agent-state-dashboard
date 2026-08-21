# Agent State Dashboard release evidence

This repository publishes producer artifacts only. Flux owns live cluster desired state, encrypted Supabase/TLS Secret material, cert-manager certificate issuance, Tailscale/ExternalDNS exposure, reconciliation, rollout health proof, and rollback.

## Release authority

The **human SemVer Git tag** is canonical producer release/source authority.

For fresh release `X.Y.Z`, the normal producer contract is:

```text
immutable image: ghcr.io/streamscapetv/agent-state-dashboard:X.Y.Z
convenience image alias: ghcr.io/streamscapetv/agent-state-dashboard:latest
immutable chart: oci://ghcr.io/streamscapetv/helm-charts/agent-state-dashboard:X.Y.Z
packaged chart version: X.Y.Z
packaged chart appVersion: X.Y.Z
default rendered image: ghcr.io/streamscapetv/agent-state-dashboard:X.Y.Z
```

`latest` is deliberately **only a mutable Docker image convenience alias**. It is never:

- the human release/source authority;
- a Helm chart version;
- Flux desired-state authority;
- a replacement for immutable SemVer image evidence;
- permission to rewrite/replay a historical release.

There is no mutable Helm chart `latest` identity. Helm remains SemVer-versioned and release-coherent with the image through `appVersion`.

## Current published evidence

The currently recorded public producer release is immutable **`1.0.2`**, tagged at source:

```text
6335d577a8d94d90129d4069848f8c88fd888815
```

Published identities:

```text
image: ghcr.io/streamscapetv/agent-state-dashboard:1.0.2
chart: oci://ghcr.io/streamscapetv/helm-charts/agent-state-dashboard:1.0.2
packaged chart version: 1.0.2
packaged chart appVersion: 1.0.2
```

Release run `32467249706` completed the public producer publication and anonymous remote image/chart read-back with zero routine Actions artifacts.

This `1.0.2` release predates later `main` changes including Realtime-first #81 and the opt-in Docker `:latest` alias. Do **not** reinterpret or replay `1.0.2` to manufacture latest-alias evidence. A later fresh SemVer tag must prove the new contract.

Historical `0.1.0`, `0.1.2`, `1.0.0`, and `1.0.2` identities are immutable. Never move, recreate, replay, republish, or redefine them.

## Normal tag-driven release flow

`.github/workflows/release.yml` is the sole normal producer release entrypoint:

1. merge a consumable dashboard revision to `main`;
2. a human creates and pushes a fresh SemVer tag (for example a later patch such as `1.0.3`; never reuse an existing tag);
3. the tag push automatically starts `.github/workflows/release.yml`;
4. the caller invokes `StreamScapeTV/ci-workflows/.github/workflows/reusable-public-native-image-chart.yml@main` with `publish_latest_image: true`;
5. Central revalidates the exact immutable tag/source relationship before privileged publication;
6. standard GitHub-hosted Linux builds one native `linux/amd64` image;
7. Central publishes the immutable image `<tag>` and immutable Helm chart `<tag>`;
8. the packaged chart receives `version=<tag>` and `appVersion=<tag>`;
9. Central tags the same local built image as Docker `:latest` and pushes it—there is no second image build;
10. Central removes publication credentials and anonymously reads back the immutable image, `:latest`, and the chart;
11. the run fails unless the immutable and `:latest` image manifest digests are equal and the image is Linux/amd64;
12. Flux separately resolves/reconciles the newest allowed stable SemVer chart and deploys the chart's matching immutable image.

The repository caller grants only:

```yaml
permissions:
  contents: read
  packages: write
```

It supplies bounded image/chart names and paths plus the reviewed boolean `publish_latest_image`. It does not pass private registry credentials, an execution-backend selector, concrete runner labels, cluster credentials, Flux inputs, or deployment policy.

Central is intentionally referenced at `@main`. A resolved Central implementation SHA may be useful supplementary run evidence but is not product release identity and is not supplied by the operator.

## Helm/image coherence

The producer source chart intentionally keeps:

```yaml
image:
  repository: ghcr.io/streamscapetv/agent-state-dashboard
  tag: ""
  digest: ""
```

The Deployment template uses:

```text
.Values.image.tag when explicitly supplied, otherwise .Chart.AppVersion
```

Because Central stamps packaged chart `appVersion` from the human release tag, chart `X.Y.Z` defaults to image `X.Y.Z`. This is the normal deployment path.

Flux should therefore:

- select a stable SemVer Helm chart release;
- not override `values.image.tag` merely to repeat the chart version;
- never deploy Docker `:latest`;
- optionally use an immutable digest only if a separately reviewed digest-pinning design owns that value.

This lets one source-aware Flux reconcile advance the chart and matching image together without a Git edit for each release.

## Mandatory-TLS runtime evidence

Every fresh release source must still prove the actual shipped architecture:

- Node `22.18.0` is build/development/validation only;
- digest-pinned NGINX `1.29.8` is the sole deployed application runtime;
- NGINX terminates mandatory TLS on non-root port `8443`;
- runtime TLS files are `/tls/tls.crt` and `/tls/tls.key` from a read-only existing Kubernetes Secret;
- startup fails closed for missing/empty/unreadable/malformed/mismatched TLS material;
- Docker healthcheck and Kubernetes probes use HTTPS;
- Service exposes HTTPS `443` -> container `8443` named `https`;
- browser accesses only the exact same-origin five-table REST gateway and exact Realtime WebSocket route;
- no browser-visible upstream Supabase URL/key, mutation surface, local Node service, plaintext listener, or TLS sidecar exists.

Producer validation fields may include, when actually executed for the exact release source:

```text
source_sha: <40-character commit SHA>
release_tag: <fresh SemVer tag>
npm_ci: success
npm_test: success
npm_typecheck: success
npm_build: success
helm_lint: success
helm_template: success
container_nginx_runtime_only: success
container_tls_required: success
container_https_healthz: success
container_rest_readonly_gateway: success
container_realtime_gateway: success
browser_secret_scan: success
image_target_platform: linux/amd64
```

Do not record success values that were not produced for the exact source SHA.

## Remote publication/read-back evidence

For a fresh release after latest-alias adoption, retain bounded evidence when available:

```text
release_tag: <canonical human Git tag>
source_sha: <verified tagged commit>
caller_workflow: StreamScapeTV/agent-state-dashboard/.github/workflows/release.yml
central_workflow: StreamScapeTV/ci-workflows/.github/workflows/reusable-public-native-image-chart.yml@main
release_workflow_run: <run URL or ID when known>
image_reference: ghcr.io/streamscapetv/agent-state-dashboard:<tag>
image_digest: sha256:<verified immutable image manifest digest>
latest_image_reference: ghcr.io/streamscapetv/agent-state-dashboard:latest
latest_image_digest: sha256:<verified latest manifest digest>
latest_matches_version: true
chart_reference: oci://ghcr.io/streamscapetv/helm-charts/agent-state-dashboard:<tag>
chart_version: <tag>
chart_app_version: <tag>
chart_digest: sha256:<verified remote OCI manifest digest>
read_back: success
actions_artifacts: zero
deployment_performed: false
```

A successful latest-alias release requires `latest_image_digest == image_digest`. The mutable alias is evidence about the current convenience pointer only; the immutable `<tag>` image/chart remain historical release evidence.

Never invent missing run IDs or digests, and never place registry credentials, Supabase values, TLS certificate/private-key contents, auth files, environment dumps, cluster credentials, or unrestricted logs into release evidence.

## Flux handoff

Do not deploy/reconcile the cluster from this repository. Hand off producer facts only:

- exact producer source SHA;
- canonical human release tag;
- immutable image reference/digest;
- convenience latest-image equality evidence when the release uses it;
- immutable chart repository/version/digest;
- chart `appVersion` / default image-version coherence;
- successful applicable Node/Helm/container validation;
- known rollout/compatibility notes.

Flux owns:

- selecting the newest allowed stable SemVer chart;
- encrypted Supabase/TLS Secrets;
- cert-manager Certificate/domain;
- Tailscale and any owner-approved Cloudflare/ExternalDNS exposure;
- cluster reconciliation and rollout;
- live HTTPS health proof;
- rollback.

A producer release is not deployed merely because publication succeeded. Conversely, Flux should not need a manual Docker-tag edit or rollout restart to consume a newly selected chart release: source + Helm reconciliation should apply the matching chart/image pair.

## Historical Cloudflare runtime

Cloudflare Pages/Pages Functions remain retired as application runtime architecture. Any external Cloudflare access is a Flux/owner exposure concern, not a producer image/chart publication concern.
