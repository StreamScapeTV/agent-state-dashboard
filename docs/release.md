# Agent State Dashboard release evidence

This repository publishes producer artifacts only. Flux owns cluster selection, the existing Kubernetes Secret, Tailscale exposure, reconciliation, and live rollout.

## Release identity

A release is authorized only by one canonical SemVer Git tag. Before tagging, the following values must match exactly:

- Git tag: `<version>`
- `package.json` `version`: `<version>`
- `charts/agent-state-dashboard/Chart.yaml` `version`: `<version>`
- `charts/agent-state-dashboard/Chart.yaml` `appVersion`: `<version>`

Do not use `latest` as release or deployment authority.

## Required pre-publication evidence

Record exact-head evidence for the source that the tag will name:

```text
source_sha: <40-character commit SHA>
npm_ci: success
npm_test: success
npm_typecheck: success
npm_build: success
helm_lint: success
helm_template: success
container_healthz: success
container_api_proxy: success
container_events_proxy: success
browser_secret_scan: success
```

The container proof must exercise the actual `server/index.mjs` implementation from the same source revision. `/healthz`, `/api/*`, and `/events` must be reached through NGINX on port `8080`; the local server must listen only on loopback port `8788`.

Do not record a success value that has not been produced for the exact source SHA.

## Immutable publication

`.github/workflows/release.yml` delegates publication to the organization exact-tag image/chart workflow. The producer caller supplies only the image/chart names, chart path, Dockerfile/build context, and explicitly named registry credentials.

Expected immutable registry identities are:

```text
image: git.faruqi.dev/mimranfaruqi/agent-state-dashboard:<version>
chart: oci://git.faruqi.dev/mimranfaruqi/helm-charts/agent-state-dashboard
```

After the central workflow succeeds, record the read-back evidence from that exact run:

```text
release_workflow_run: <GitHub Actions run URL or ID>
source_sha: <verified tagged commit>
version: <canonical SemVer>
image_reference: <immutable versioned image reference>
image_digest: sha256:<verified multi-platform image index digest>
chart_reference: <OCI chart repository>
chart_version: <canonical SemVer>
chart_oci_digest: sha256:<verified OCI chart manifest digest>
chart_package_sha256: <verified packaged chart SHA-256 when provided>
read_back: success
```

If the central workflow exposes only a package checksum for the chart, retain the workflow read-back evidence that identifies the remote OCI manifest digest as well; the Flux handoff requires an immutable remote chart identity, not only a local package checksum.

Never put registry credentials, Supabase values, auth files, environment dumps, or cluster credentials into release evidence.

## Flux handoff

Do not edit or reconcile the Flux cluster from this repository. Hand off only:

- exact producer source SHA;
- canonical version;
- image repository plus verified digest;
- chart repository/version plus verified OCI digest;
- successful image/chart read-back evidence;
- successful Helm render/lint evidence;
- any known compatibility or rollout notes.

Flux issue #288 owns the desired-state change, image pull credentials, Supabase Secret material, Tailscale values, deployment health proof, and rollback.

## Cloudflare retirement

Repository Cloudflare Pages/Access runtime artifacts are retired by the K3s migration. External Cloudflare service removal must not be used as proof that the K3s release is healthy.

Once Flux #288 has selected the verified immutable release and live Tailscale health is confirmed, the former Pages Git deployment / Access application can be disabled or removed by the Cloudflare owner. No Cloudflare credential or configuration is part of the image, chart, or Flux handoff.
