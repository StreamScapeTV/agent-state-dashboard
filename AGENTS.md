# AGENTS.md — StreamScapeTV/agent-state-dashboard

## Repository identity

- Repository: `StreamScapeTV/agent-state-dashboard`
- Agent State project key: `agent-state-dashboard`
- Integration branch: `main`
- Source repository: public GitHub repository
- Deployment target: private K3s through the repository OCI Helm chart; Flux #288 owns cluster activation
- Application: private read-only Agent State dashboard at runtime
- Sole shared organization-policy entry point: `StreamScapeTV/organization-rules@main/AGENTS.md`

Before any work, read this file and then the current shared organization entry point. This file defines only dashboard product authority and stricter data, security, deployment, and validation requirements; the shared entry point owns the generic collaboration and development lifecycle.

## Product boundary

This repository is a read-only visualization client for the separately owned `StreamScapeTV/agent-state-supabase` service.

- Never add, alter, migrate, seed, repair, reset, deploy, or otherwise mutate the Agent State Supabase project from this repository.
- Application code must not call Agent State mutation RPCs, execute arbitrary SQL, expose a generic Supabase proxy, or provide a mutation UI.
- Browser data access is only through the same-origin NGINX gateway rooted at `/supabase`.
- The REST gateway may reach exactly these five current Agent State authority tables required by dashboard #4: `current_projects`, `current_agents`, `current_work`, `current_resources`, and `current_coordination`.
- REST access is observation-only: only `GET`, `HEAD`, and `OPTIONS` are accepted. Mutation methods, arbitrary table paths, generic RPC paths, SQL, storage, functions, and other Supabase surfaces are outside the product boundary.
- Realtime is exposed only through the exact same-origin WebSocket route `/supabase/realtime/v1/websocket` and is used for Postgres Changes invalidation of the same five current tables.
- `SUPABASE_URL` and `SUPABASE_SECRET_KEY` are runtime-only server credentials supplied by the existing Kubernetes Secret. They must never use `NEXT_PUBLIC_*`, be committed, appear in generated static assets, be returned to the browser, be placed in query strings under browser control, or be logged.
- NGINX owns upstream credential substitution. The browser may use only the non-secret client placeholder required by `@supabase/supabase-js`; the real upstream URL/key remain server-side.
- The runtime entrypoint may render a secret-bearing NGINX configuration only into the ephemeral writable `/tmp` filesystem with restrictive permissions, then must unset the credential environment variables before starting NGINX.
- Browser-facing routes remain observation-only. No SQL editor, arbitrary RPC endpoint, mutation API, unrestricted/raw Supabase response proxy, or credential-debug endpoint belongs in this product.
- Application logging must not include credentials, authorization headers, unrestricted Supabase payloads, or prompts beyond the intended dashboard response contract.

There is no deployed local Node data service. Do not restore `/api/*`, `/events`, loopback port `8788`, runtime npm execution, or a Node/process supervisor as a fallback architecture.

Cloudflare Pages, Pages Functions, advanced-mode Workers, and the former Pages runtime are not producer runtime authorities. Flux #288 owns the live cluster desired state, encrypted Secret material, Tailscale and any owner-approved Cloudflare exposure, reconciliation, health proof, and rollback.

## Stack

- Next.js App Router static export and TypeScript
- Material UI
- `@supabase/supabase-js` in the browser, pointed only at the same-origin `/supabase` gateway
- Node.js as a build/development/validation tool only; in the container image it appears only in the build stage and is never a deployed runtime dependency
- digest-pinned NGINX as the sole deployed application runtime on port `8080`
- multi-stage Docker/OCI image with no Node runtime dependency
- versioned OCI Helm chart under `charts/agent-state-dashboard`
- private K3s deployment controlled by Flux
- committed `package-lock.json`; generated `out/` is ignored and produced during builds

Completed #31/#32 established the pure-NGINX same-origin gateway and browser client. Issue #7 owns remaining release/package finalization for the next release. Flux #288 owns actual cluster desired state, Secret material, exposure, reconciliation, and live rollout.

## Runtime and Helm contract

The container listens on port `8080` and NGINX serves the health endpoint directly at `GET /healthz`. There is no secondary application listener.

The image contract is intentionally split:

- build stage: digest-pinned Node `22.18.0`, committed npm lockfile, deterministic Next static export;
- runtime stage: digest-pinned NGINX `1.29.8`, non-root UID, exported frontend plus NGINX gateway configuration only.

The runtime must not require `node`, `npm`, `server/`, `tini`, another process supervisor, or loopback application ports.

The chart consumes the existing Secret contract only:

- Secret name: `agent-state-dashboard-supabase`
- URL key: `SUPABASE_URL`
- secret-key key: `SUPABASE_SECRET_KEY`

The chart references these values with `secretKeyRef`; credential material never belongs in Helm values, rendered documentation, release evidence, or repository source.

The current producer-chart private Service defaults remain:

- `type: LoadBalancer`
- `loadBalancerClass: tailscale`
- `allocateLoadBalancerNodePorts: false`
- `tailscale.com/hostname: agent-state-dashboard`
- `tailscale.com/tags: tag:agent-state-dashboard`
- `tailscale.com/proxy-group: tailscale-proxy-group`

These are producer-chart defaults, not live-cluster authority. Flux #288 owns the actual image/chart selection, encrypted Secret, image-pull credentials, Tailscale settings, any owner-approved Cloudflare exposure, rollout, health verification, and rollback.

Do not add a public Ingress, public credential-bearing chart value, Cloudflare runtime dependency, or repository-driven cluster deployment without a separately reviewed product change.

## Same-origin Supabase gateway contract

The gateway is deliberately narrower than Supabase itself.

REST:

- browser prefix: `/supabase/rest/v1/`;
- allowed tables: exactly the five current authority tables listed above;
- methods: only `GET`, `HEAD`, `OPTIONS`;
- generic REST root or any other table path returns `404`;
- mutation methods return `405`;
- browser API-key query parameters are rejected;
- NGINX replaces the upstream API key with `SUPABASE_SECRET_KEY`, clears browser `Authorization` and method-override headers, and suppresses credential-bearing proxy logs;
- responses are non-cacheable and must not reveal the upstream credential.

Realtime:

- exact browser path: `/supabase/realtime/v1/websocket`;
- only a WebSocket `GET` is accepted;
- NGINX owns the upstream API-key substitution and preserves only the bounded Realtime protocol parameters required by the client;
- proxy buffering/cache stay disabled and long-lived read/write timeouts remain suitable for the subscription;
- browser code uses Realtime only for invalidation/refresh of the five current tables and retains polling fallback for reconnect/staleness handling.

Do not broaden either gateway surface merely because Supabase supports additional products or endpoints.

## Product validation

Use the committed Node version and lockfile and run the repository-defined Node validation when changed source/build inputs require it:

```text
npm ci
npm test
npm run typecheck
npm run build
```

Packaging validation additionally requires:

```text
helm lint charts/agent-state-dashboard
helm template agent-state-dashboard charts/agent-state-dashboard
```

The package tests are authoritative for the current pure-NGINX boundary: build-time-only Node, pinned NGINX runtime, exact `/supabase` REST/Realtime proxy, Secret references, Tailscale metadata, probes/resources/security posture, source package/chart consistency, and the repository release caller.

Documentation-only changes do not manufacture product-build, image, Helm, deployment, or live-cluster evidence. Runtime, integration, container, publication, deployment, and release evidence remain distinct product proofs tied to the exact source revision under test.

Do not add a product-local GitHub Actions job with concrete runner labels as a CI workaround. Use reviewed Central reusable callers. Public portable dashboard validation uses Central's explicit `github-hosted` backend; the public release API owns its fixed GitHub-hosted runner internally.

## Release authority

The repository-owned `.github/workflows/release.yml` is the sole normal producer release entrypoint. Normal release UX is intentionally human-operated and tag-driven:

1. merge a consumable dashboard revision to `main`;
2. a human creates and pushes a fresh SemVer product tag, with the public release line beginning at `1.0.0`;
3. that tag push automatically starts `.github/workflows/release.yml`;
4. the thin caller invokes `StreamScapeTV/ci-workflows/.github/workflows/reusable-public-native-image-chart.yml@main`;
5. Central runs the native `linux/amd64` build and Helm publication on standard GitHub-hosted Linux;
6. the product tag is the release-version authority for both the public image and packaged Helm chart;
7. Flux separately selects the published chart version and owns deployment.

The first real public release baseline is `1.0.0`. Future normal SemVer progression starts from that baseline (`1.0.1`, `1.1.0`, `2.0.0`, and so on) according to the product change being released. Historical `0.1.0` / `0.1.2` identities remain immutable pre-1.0 history and are not the normal public release line.

The public release caller grants only `contents: read` and `packages: write`. It passes bounded product names/paths only. It must not pass private registry credentials, PATs, maintenance tokens, raw runner labels, an `execution_backend` selector, cluster credentials, deployment inputs, or product-specific Central implementation policy.

Publication targets are fixed by the reviewed public Central API:

- image: `ghcr.io/streamscapetv/agent-state-dashboard:<tag>`;
- Helm OCI chart: `oci://ghcr.io/streamscapetv/helm-charts/agent-state-dashboard:<tag>`.

The Git tag is the release-version authority. Do **not** require a release-only source commit merely to make `package.json.version`, source `Chart.yaml version`, or source `Chart.yaml appVersion` equal the tag. Central stamps packaged Helm `version` and `appVersion` from the release tag and publishes the image with the same tag. Source package/chart metadata may remain useful development metadata and should stay internally consistent where repository tests require it, but it does not authorize or reject a human release tag.

Publication and deployment are separate authorities:

- this repository owns the human product tag, producer image/chart publication, public remote read-back, and release evidence;
- Flux #288 owns encrypted runtime Secret material, any required pull configuration, Tailscale/Cloudflare exposure, cluster desired state, reconciliation, rollout, live health proof, and rollback.

Historical tags are immutable. Never move, delete, recreate, republish, or redefine `0.1.0`, `0.1.2`, or the first public-release tag `1.0.0`. The historical `0.1.2` recovery attempt is not part of the normal release path and must not be used as a template for future releases.

The required current image target is `linux/amd64`. Multi-architecture publication is optional future capability, not a release gate. Public release evidence must identify the exact tagged source plus anonymously read-back image/chart identities produced by Central.

Publication remains immutable: no `latest` product release authority, no rewriting historical release identities, no manual existing-tag replay/tag-cut/request-ID ceremony, no consumer-maintained Central commit SHA, and zero routine Actions artifacts. The producer workflow must never activate its own release in Kubernetes.