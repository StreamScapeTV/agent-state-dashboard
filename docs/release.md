# Agent State Dashboard release evidence

This repository publishes producer artifacts only. Flux #288 owns the live cluster desired state, encrypted Supabase Secret material, image-pull credentials, Tailscale and any owner-approved Cloudflare exposure, reconciliation, rollout health proof, and rollback.

## Release line and identity

`0.1.0` is an immutable historical release identity. Do not republish it, move its tag, overwrite its published artifact references, or redefine it to represent the pure-NGINX architecture.

The next pure-NGINX release authority is **`0.1.1`**.

Before creating the `0.1.1` tag, the separately owned release/version change must make these values match exactly:

- Git tag: `0.1.1`
- `package.json` `version`: `0.1.1`
- `charts/agent-state-dashboard/Chart.yaml` `version`: `0.1.1`
- `charts/agent-state-dashboard/Chart.yaml` `appVersion`: `0.1.1`

Until that version-finalization change lands, the checked-in package/chart may correctly remain at historical `0.1.0`. Documentation changes must not perform the version bump.

For later releases, use the same rule with one canonical stable SemVer value across all four authorities. Never use `latest` as release or deployment authority.

## Pure-NGINX runtime evidence

The release candidate must prove the architecture that is actually shipped:

- Node `22.18.0` is a build/development/validation tool only; in the container image it appears only in the build stage and is never a deployed runtime dependency;
- the deployed image runtime is digest-pinned NGINX `1.29.8` listening on port `8080`;
- `/healthz` is served directly by NGINX;
- there is no local Node server, `/api/*`, `/events`, loopback port `8788`, runtime npm execution, or process supervisor;
- the browser reads only the five current Agent State tables through same-origin `/supabase/rest/v1/*`;
- REST accepts only `GET`, `HEAD`, and `OPTIONS`; mutation methods are denied and unlisted table paths are not proxied;
- Realtime is exposed only through `/supabase/realtime/v1/websocket`;
- NGINX injects `SUPABASE_SECRET_KEY` upstream and the real Supabase URL/key never enters generated static assets or browser-visible responses.

Record exact-source pre-publication evidence for the source revision the tag will name. A release packet may use the following bounded fields when the corresponding checks apply:

```text
source_sha: <40-character commit SHA>
npm_ci: success
npm_test: success
npm_typecheck: success
npm_build: success
helm_lint: success
helm_template: success
container_nginx_runtime_only: success
container_healthz: success
container_rest_readonly_gateway: success
container_realtime_gateway: success
browser_secret_scan: success
image_target_platform: linux/amd64
```

Do not record a success value that has not been produced for the exact source SHA. Documentation, source validation, image publication, Helm publication, cluster rollout, and live access are separate proofs.

## Image platform authority

The required producer image target for the current Debian/K3s environment is:

```text
linux/amd64
```

A multi-architecture image is optional future capability, not a prerequisite for `0.1.1`. Do not make `linux/arm64`, a multi-platform manifest list, or any other unused architecture a release gate merely because a reusable publisher is capable of producing it.

The release evidence handed to Flux must identify the immutable remote image digest that corresponds to the `linux/amd64` artifact actually selected for deployment. If a central capability also reports a platform config digest or an image index, retain that as supplementary evidence only when it is part of the exact successful run; it does not change the product's required platform.

## Repository-owned release workflow

`.github/workflows/release.yml` is the final producer release entrypoint. It is repository-owned and should remain thin: product-specific code supplies the bounded image/chart names, chart path, Dockerfile/build context, release identity, and named registry credentials, while reviewed generic central CI/release capabilities implement reusable publication mechanics.

The product repository must not embed reusable runner labels, container-engine/storage policy, cluster credentials, Flux operations, signing workarounds, or deployment logic in the release caller. Immutable central revisions may be pinned as implementation authority, but the producer contract is expressed in product terms rather than by copying central runner/platform internals into this repository.

Issue #7 owns final release/package reconciliation before `0.1.1` is tagged. If the currently pinned reusable publisher encodes assumptions broader than the product requirement—such as mandatory multi-architecture publication—#7 must select/configure the appropriate generic central capability without changing the product requirement to match that implementation detail.

The release workflow must publish no `latest` authority, retain zero routine Actions artifacts, and perform no Kubernetes deployment.

## Immutable publication and read-back

Expected registry identities remain:

```text
image: git.faruqi.dev/mimranfaruqi/agent-state-dashboard:<version>
chart: oci://git.faruqi.dev/mimranfaruqi/helm-charts/agent-state-dashboard
```

After the exact-tag producer workflow succeeds, record the bounded read-back evidence from that same run:

```text
release_workflow_run: <GitHub Actions run URL or ID>
central_capability_sha: <reviewed immutable ci-workflows commit SHA or SHAs>
source_sha: <verified tagged commit>
version: <canonical SemVer>
image_reference: <immutable versioned image reference>
image_platform: linux/amd64
image_digest: sha256:<verified remote digest for the released image identity>
chart_reference: <OCI chart repository>
chart_version: <canonical SemVer>
chart_digest: sha256:<verified remote OCI chart manifest digest>
chart_package_sha256: <verified packaged chart SHA-256 when provided>
read_back: success
actions_artifacts: zero
deployment_performed: false
```

A local image ID, build cache identifier, chart package checksum, or workflow success alone is not a substitute for the verified remote OCI identities. A chart package checksum is supplementary; the remote OCI chart manifest digest remains the chart handoff authority.

Never place registry credentials, Supabase values, rendered secret-bearing NGINX configuration, auth files, environment dumps, cluster credentials, or unrestricted logs into release evidence.

## Flux handoff

Do not edit or reconcile the Flux cluster from this repository. Hand off only producer facts:

- exact producer source SHA;
- canonical release version;
- immutable `linux/amd64` image reference plus verified remote digest;
- chart repository/version plus verified OCI digest;
- successful image/chart remote read-back evidence;
- successful applicable Node/Helm/container validation evidence;
- known compatibility or rollout notes.

Flux #288 owns:

- encrypted `agent-state-dashboard-supabase` Secret material;
- registry pull credentials;
- desired image/chart references and digests;
- Tailscale and any owner-approved Cloudflare exposure;
- cluster reconciliation;
- live `/healthz` and application health proof;
- rollback.

A producer release is not considered deployed merely because publication succeeded. Conversely, changing or removing an external access layer is never proof that the K3s workload is healthy.

## Historical Cloudflare runtime

Cloudflare Pages/Pages Functions are retired as application runtime architecture. Any remaining external Cloudflare access or cleanup is a Flux/owner exposure concern, not an image/chart producer concern. No Cloudflare credential or deployment configuration belongs in the producer image, chart, or release evidence.
