# AGENTS.md — StreamScapeTV/agent-state-dashboard

## Repository identity

- Repository: `StreamScapeTV/agent-state-dashboard`
- Agent State project key: `agent-state-dashboard`
- Integration branch: `main`
- Deployment target: private K3s through the repository OCI Helm chart; Flux #288 owns cluster activation
- Application: private read-only Agent State dashboard
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

The package tests are authoritative for the current pure-NGINX boundary: build-time-only Node, pinned NGINX runtime, exact `/supabase` REST/Realtime proxy, Secret references, Tailscale metadata, probes/resources/security posture, release-version alignment, and the repository release caller.

Documentation-only changes do not manufacture product-build, image, Helm, deployment, or live-cluster evidence. Runtime, integration, container, publication, deployment, and release evidence remain distinct product proofs tied to the exact source revision under test.

Do not add a product-local GitHub Actions job with concrete runner labels as a CI workaround. Use the reviewed central semantic callers and `StreamScapeTV/ci-workflows@main/RUNNERS.md` only when the bounded task requires runner capability selection.

## Release authority

The repository-owned `.github/workflows/release.yml` is the final producer release entrypoint. It must remain product-specific only at the bounded input layer and call reviewed generic central CI/release capabilities for reusable implementation. Product repository code must not hard-code reusable runner labels, container-engine policy, cluster credentials, or deployment behavior into the release caller.

Publication and deployment are separate authorities:

- this repository owns the source/tag identity, producer image/chart publication, immutable remote read-back, and release evidence;
- Flux #288 owns encrypted runtime Secret material, registry pull credentials, Tailscale/Cloudflare exposure, cluster desired state, reconciliation, rollout, live health proof, and rollback.

`0.1.0` is immutable historical release identity. Never republish, retag, or redefine it to represent the pure-NGINX architecture.

The next pure-NGINX release authority is `0.1.1`. Before tagging `0.1.1`, the separately owned release/version change must make these values exactly equal:

- Git tag `0.1.1`;
- `package.json` version `0.1.1`;
- `charts/agent-state-dashboard/Chart.yaml` `version: 0.1.1`;
- `charts/agent-state-dashboard/Chart.yaml` `appVersion: "0.1.1"`.

Until that version-finalization change lands, `package.json` and the chart may correctly remain at historical `0.1.0`; documentation alone must not bump them.

The required image publication target for the current Debian/K3s environment is `linux/amd64`. Multi-architecture publication is optional future capability, not a release gate for `0.1.1`. Release evidence must identify and verify the immutable `linux/amd64` image handed to Flux.

Publication is immutable: no `latest` authority, no rewriting historical release identities, and zero routine Actions artifacts. Record the exact tagged source SHA plus verified remote image and chart identities. The producer workflow must not activate its own release in Kubernetes.
