# AGENTS.md — StreamScapeTV/agent-state-dashboard

## Repository identity

- Repository: `StreamScapeTV/agent-state-dashboard`
- Agent State project key: `agent-state-dashboard`
- Integration branch: `main`
- Deployment target: private K3s through the repository OCI Helm chart
- Application: private read-only Agent State dashboard

The sole shared organization-policy entry point is `StreamScapeTV/organization-rules@main/AGENTS.md`.

## Product boundary

This repository is a read-only visualization client for the separately owned `StreamScapeTV/agent-state-supabase` service.

- Never add, alter, migrate, seed, repair, reset, deploy, or otherwise mutate the Agent State Supabase project from this repository.
- Application code must not call Agent State mutation RPCs, execute arbitrary SQL, expose a generic Supabase proxy, or provide browser-side Supabase access.
- The server-side dashboard data plane may read and subscribe to exactly these five current Agent State authority tables required by dashboard #4: `current_projects`, `current_agents`, `current_work`, `current_resources`, and `current_coordination`. Do not broaden that allowlist without a separately reviewed product change.
- `SUPABASE_URL` and `SUPABASE_SECRET_KEY` are server-only runtime environment variables supplied from the existing Kubernetes Secret. They must never use `NEXT_PUBLIC_*`, be committed, appear in generated static assets, be returned by an API route, or be logged.
- Browser-facing routes remain observation-only. No SQL editor, arbitrary RPC endpoint, Agent State mutation API, or mutation UI belongs in this product.
- The browser talks only to same-origin dashboard routes. NGINX serves the static frontend and proxies `/healthz`, `/api/*`, and `/events` to the loopback Node data process.
- Application logging must not include credentials, authorization headers, prompts beyond the intended dashboard response contract, or unrestricted/raw Supabase responses.
- Cloudflare Pages, Pages Functions, advanced-mode Workers, Cloudflare Access, and Cloudflare Tunnel are not part of the target deployment path. Issue #7 owns retirement of the obsolete deployment/package artifacts; Flux #288 owns actual cluster activation.

## Stack

- Next.js App Router static export + TypeScript
- Material UI
- dependency-light Node server data plane
- NGINX static serving and local reverse proxy
- multi-platform Docker/OCI image
- versioned OCI Helm chart under `charts/agent-state-dashboard`
- private K3s exposure through the Tailscale Kubernetes operator
- committed `package-lock.json`; generated `out/` is ignored and produced during image builds

Issue #5 owns only the server/read/Realtime implementation. Issue #6 owns the frontend operations console. Issue #7 owns Docker/NGINX/Helm/release packaging and Cloudflare deployment-artifact retirement. Flux #288 owns cluster desired state, Secret material, Tailscale exposure, reconciliation, and live rollout.

## Agent N work packets

When meaningful dependency-ready work exists, a normal Agent N assignment should target roughly 120 minutes of productive work. The worker owns each bounded issue end to end through implementation, tests, review feedback, exact-head validation when available, merge and integration verification, issue closure, resource release, and branch cleanup.

Finishing a small issue is not by itself a reason to return. After fully cleaning it up, reread Agent State and live GitHub state and continue with the next unassigned, dependency-ready, independently mergeable dashboard issue allowed by the current assignment and resource ownership. If none exists, a worker may create one bounded follow-up only for a real concrete gap in its existing dashboard #4 ownership surface. Preserve one issue/branch/PR and resource claims per independently mergeable result; do not invent busywork, cross another actor's surface, idle to fill time, or fabricate evidence. Return early only when no productive, authorized, dependency-ready work remains.

## Runtime and Helm contract

The container listens on port `8080`; the local server listens only on `127.0.0.1:8788`. Kubernetes probes use `GET /healthz` through NGINX.

The chart consumes the existing Secret contract only:

- Secret name: `agent-state-dashboard-supabase`
- URL key: `SUPABASE_URL`
- secret-key key: `SUPABASE_SECRET_KEY`

The default private Service contract is:

- `type: LoadBalancer`
- `loadBalancerClass: tailscale`
- `allocateLoadBalancerNodePorts: false`
- `tailscale.com/hostname: agent-state-dashboard`
- `tailscale.com/tags: tag:agent-state-dashboard`
- `tailscale.com/proxy-group: tailscale-proxy-group`

Do not add a public Ingress, public LoadBalancer, Cloudflare Tunnel, or credential-bearing chart value for the initial deployment.

## Validation and release

Before merging source changes, use the committed Node version and lockfile and run `npm ci`, `npm test`, `npm run typecheck`, and `npm run build` when those commands apply to the changed source. For packaging changes, also run `helm lint charts/agent-state-dashboard` and render the chart with `helm template` to verify the exact Secret/Tailscale contract, probes, resources, and security context. A worker must not fabricate unavailable runtime, integration, container, deployment, or release evidence.

Do not add a product-local GitHub Actions job with concrete runner labels. Follow `StreamScapeTV/ci-workflows@main/RUNNERS.md`; use a thin central semantic caller only after this repository is admitted to the corresponding reviewed central contract.

Tagged releases use the thin caller in `.github/workflows/release.yml` and `StreamScapeTV/ci-workflows@main/.github/workflows/reusable-tag-image-chart.yml`. The Git tag, `package.json` version, `Chart.yaml` `version`, and `appVersion` must be the same canonical SemVer. Publication is immutable: no `latest` authority. Record the exact source SHA and central workflow read-back evidence for the image and chart. This repository must not activate its own release in Kubernetes; Flux #288 owns desired state and live rollout.
