# Agent State Dashboard release evidence

This repository publishes producer artifacts only. Flux #288 owns the live cluster desired state, encrypted Supabase/TLS Secret material, cert-manager certificate issuance, image-pull credentials, Tailscale and any owner-approved Cloudflare/ExternalDNS exposure, reconciliation, rollout health proof, and rollback.

## Release line and identity

### Published baseline: 1.0.0

The first real public dashboard release is immutable **`1.0.0`**. The owner-created human Git tag `1.0.0` resolves exactly to:

```text
9051fc35810b11a9697e09e7b53d48c006c7f07b
```

The owner confirmed that the automatic tag-triggered producer publication completed. The published product identities are:

```text
image: ghcr.io/streamscapetv/agent-state-dashboard:1.0.0
chart: oci://ghcr.io/streamscapetv/helm-charts/agent-state-dashboard:1.0.0
packaged chart version: 1.0.0
packaged chart appVersion: 1.0.0
```

Flux #288 may consume chart version `1.0.0`; this producer publication does not by itself prove live cluster deployment.

`1.0.0` predates the mandatory-TLS source change merged in #89. Its successful publication must not be reused as evidence that the current post-#89 image/chart have already been published, deployed, or validated as the HTTPS-only runtime.

Historical `0.1.0`, `0.1.2`, and published `1.0.0` tags are immutable. Never republish, move, recreate, replay, or redefine them.

### Current post-1.0.0 source and next target

Merged #89 changed the current producer contract to mandatory NGINX TLS and explicitly selected **`1.0.1`** as the next producer release target. Current `main` may continue to advance before tagging, so the exact `1.0.1` release source is not fixed until the owner creates the tag.

Do not claim `1.0.1` publication or deployment before the owner actually creates/pushes that fresh tag and the normal producer/deployment evidence exists.

For future releases, the **human Git tag is the canonical producer release version**. There is no release prerequisite requiring a preparatory source commit that makes all of these values identical:

- `package.json` `version`;
- source `charts/agent-state-dashboard/Chart.yaml` `version`;
- source `charts/agent-state-dashboard/Chart.yaml` `appVersion`;
- the Git tag.

Central projects the immutable product tag into the published image tag and packaged Helm `version` / `appVersion`. Checked-in package/chart versions can remain build/source metadata; they are not independent release selectors. Never use `latest` as release or deployment authority.

## Normal tag-driven release flow

`.github/workflows/release.yml` is the sole normal producer release entrypoint:

1. merge a consumable dashboard revision to `main`;
2. a human creates and pushes a fresh SemVer tag (the next owner-directed target is `1.0.1`);
3. the tag push automatically starts `.github/workflows/release.yml`;
4. the caller invokes `StreamScapeTV/ci-workflows/.github/workflows/reusable-public-native-image-chart.yml@main`;
5. Central revalidates the exact immutable tag/source relationship before privileged publication;
6. standard GitHub-hosted Linux publishes the native `linux/amd64` image and OCI Helm chart to GHCR;
7. Central drops publication credentials and anonymously reads back both remote OCI manifests before it can report success;
8. Flux later selects the published chart version and separately owns deployment.

The repository caller grants only:

```yaml
permissions:
  contents: read
  packages: write
```

It supplies bounded image/chart names and build/chart paths only. It does not pass private registry credentials, a release execution-backend selector, concrete runner labels, cluster credentials, Flux inputs, or product-side deployment policy.

The caller intentionally uses Central `@main`. A resolved Central implementation SHA may be recorded as supplementary run evidence if the successful run exposes it, but it is not the product release identity and operators do not supply a Central SHA to choose a release implementation.

The release workflow publishes no `latest` authority, performs no Kubernetes deployment, and the normal successful path retains zero routine GitHub Actions artifacts.

## Mandatory-TLS NGINX runtime evidence

The current post-#89 release candidate must prove the architecture that is actually shipped:

- Node `22.18.0` is a build/development/validation tool only; in the container image it appears only in the build stage and is never a deployed runtime dependency;
- the deployed application runtime is digest-pinned NGINX `1.29.8` only;
- NGINX terminates mandatory TLS directly on non-root port `8443`;
- there is no plaintext application listener, TLS-disabled mode, TLS sidecar, local Node server, `/api/*`, `/events`, loopback port `8788`, runtime npm execution, or process supervisor;
- runtime TLS files are required at `/tls/tls.crt` and `/tls/tls.key` from a read-only mounted existing Kubernetes Secret;
- startup fails closed if certificate/key files are missing, empty, unreadable, malformed, or mismatched, and NGINX configuration is validated against the mounted TLS material before startup;
- Docker healthcheck and Kubernetes readiness/liveness probes use HTTPS;
- the Service exposes HTTPS port `443` targeting container port `8443` named `https`;
- `GET https://<host>:8443/healthz` is served directly by NGINX;
- the browser reads only the five current Agent State tables through same-origin HTTPS `/supabase/rest/v1/*`;
- REST accepts only `GET`, `HEAD`, and `OPTIONS`; mutation methods are denied and unlisted table paths are not proxied;
- Realtime is exposed only through `/supabase/realtime/v1/websocket` on the same HTTPS server;
- NGINX injects `SUPABASE_SECRET_KEY` upstream and the real Supabase URL/key never enters generated static assets or browser-visible responses;
- TLS certificate/private-key material never enters generated assets, chart values, logs, repository evidence, or browser responses.

The producer chart's default Secret surfaces are:

```text
Supabase Secret: agent-state-dashboard-supabase
  SUPABASE_URL
  SUPABASE_SECRET_KEY

TLS Secret: agent-state-dashboard-tls
  tls.crt -> /tls/tls.crt
  tls.key -> /tls/tls.key
```

Flux/cert-manager owns the real certificate issuance, domain, and actual TLS Secret used by deployment. Producer evidence validates the chart/runtime contract; it does not contain the certificate or private key.

Record exact-source pre-publication evidence for the source revision the human tag will name. A release packet may use the following bounded fields when the corresponding checks actually ran:

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
container_tls_mount_contract: success
container_https_only_listener: success
container_https_healthz: success
container_rest_readonly_gateway: success
container_realtime_gateway: success
browser_secret_scan: success
image_target_platform: linux/amd64
```

Do not record a success value that was not produced for the exact source SHA. Documentation, source validation, image publication, Helm publication, cluster rollout, certificate issuance, and live access are separate proofs.

## Image platform authority

The required producer image target for the current Debian/K3s environment is:

```text
linux/amd64
```

A multi-architecture image is optional future capability, not a release gate. Do not make `linux/arm64`, a multi-platform manifest list, or another unused architecture mandatory merely because a reusable publisher could support it.

The strongest Flux handoff includes the immutable remote image digest corresponding to the released `linux/amd64` identity. If a successful Central run also reports a platform config digest or an image index, that may be retained as supplementary evidence; it does not change the required product platform.

## Immutable publication and remote read-back

Normal public registry identities are:

```text
image: ghcr.io/streamscapetv/agent-state-dashboard:<tag>
chart: oci://ghcr.io/streamscapetv/helm-charts/agent-state-dashboard:<tag>
```

Central's successful public release path is fail-closed around remote read-back: after publication credentials are removed, the image and chart manifests are fetched anonymously and verified before success. The image read-back verifies the expected Linux/amd64 identity; the chart read-back records the OCI manifest identity.

When a successful fresh release run exposes the values, retain a bounded handoff packet such as:

```text
release_tag: <canonical human Git tag>
source_sha: <verified tagged commit>
caller_workflow: StreamScapeTV/agent-state-dashboard/.github/workflows/release.yml
central_workflow: StreamScapeTV/ci-workflows/.github/workflows/reusable-public-native-image-chart.yml@main
release_workflow_run: <GitHub Actions run URL or ID when known>
central_resolved_sha: <optional supplementary implementation SHA when emitted>
image_reference: ghcr.io/streamscapetv/agent-state-dashboard:<tag>
image_platform: linux/amd64
image_digest: sha256:<verified remote digest when available>
chart_reference: oci://ghcr.io/streamscapetv/helm-charts/agent-state-dashboard:<tag>
chart_version: <tag>
chart_digest: sha256:<verified remote OCI manifest digest when available>
chart_package_sha256: <optional packaged chart checksum when emitted>
read_back: success
actions_artifacts: zero
deployment_performed: false
```

A local image ID, build cache identifier, chart package checksum, or workflow success alone is not a substitute for verified remote OCI identity. A chart package checksum is supplementary; the remote OCI chart manifest digest is the stronger published-chart identity.

Never invent a missing run ID or digest. For the `1.0.0` reconciliation, the connected GitHub tool could not enumerate the tag-push run without a known run ID. Repository evidence therefore records the exact `1.0.0` tag/source and owner-confirmed completed publication together with the reviewed Central contract, but it does not fabricate unavailable digest/run fields.

Likewise, do not copy `1.0.0` run/read-back evidence forward to the post-#89 `1.0.1` candidate. `1.0.1` requires its own exact-tag publication evidence after the human tag exists.

Never place registry credentials, Supabase values, TLS certificate/private-key contents, rendered secret-bearing NGINX configuration, auth files, environment dumps, cluster credentials, or unrestricted logs into release evidence.

## Flux handoff

Do not edit or reconcile the Flux cluster from this repository. Hand off only producer facts that are actually known:

- exact producer source SHA;
- canonical human release tag;
- immutable `linux/amd64` image reference and verified remote digest when available;
- chart repository/version and verified OCI digest when available;
- successful image/chart remote read-back evidence;
- successful applicable Node/Helm/mandatory-TLS container validation evidence;
- the required TLS mount/key contract, never the certificate/private-key values;
- known compatibility or rollout notes.

Flux #288 owns:

- encrypted `agent-state-dashboard-supabase` Secret material;
- cert-manager `Certificate`, domain, and actual TLS Secret used by deployment;
- registry pull credentials if the selected registry ever requires them;
- desired image/chart references and digests;
- Tailscale and any owner-approved Cloudflare/ExternalDNS exposure;
- cluster reconciliation;
- live HTTPS `/healthz` and application health proof;
- rollback.

A producer release is not considered deployed merely because publication succeeded. Conversely, certificate issuance or changing an external access layer is never proof that the K3s workload is healthy.

## Historical Cloudflare runtime

Cloudflare Pages/Pages Functions are retired as application runtime architecture. Any remaining external Cloudflare access or cleanup is a Flux/owner exposure concern, not an image/chart producer concern. No Cloudflare credential or deployment configuration belongs in the producer image, chart, or release evidence.
