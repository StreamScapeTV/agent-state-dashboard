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
- Application code must not call Agent State mutation RPCs, execute arbitrary SQL, expose a generic Supabase proxy, or provide browser-side Supabase access.
- The server-side dashboard data plane may read and subscribe to exactly these five current Agent State authority tables required by dashboard #4: `current_projects`, `current_agents`, `current_work`, `current_resources`, and `current_coordination`. Do not broaden that allowlist without a separately reviewed product change.
- `SUPABASE_URL` and `SUPABASE_SECRET_KEY` are server-only runtime environment variables supplied from the existing Kubernetes Secret. They must never use `NEXT_PUBLIC_*`, be committed, appear in generated static assets, be returned by an API route, or be logged.
- Browser-facing routes remain observation-only. No SQL editor, arbitrary RPC endpoint, Agent State mutation API, or mutation UI belongs in this product.
- The browser talks only to same-origin dashboard routes. NGINX serves the static frontend and proxies `/healthz`, `/api/*`, and `/events` to the loopback Node data process.
- Application logging must not include credentials, authorization headers, prompts beyond the intended dashboard response contract, or unrestricted or raw Supabase responses.
- Cloudflare Pages, Pages Functions, advanced-mode Workers, Cloudflare Access, and Cloudflare Tunnel are not part of the target deployment path. Issue #7 owns retirement of obsolete deployment and package artifacts; Flux #288 owns actual cluster activation.

## Stack

- Next.js App Router static export and TypeScript
- Material UI
- dependency-light Node server data plane
- NGINX static serving and local reverse proxy
- multi-platform Docker/OCI image
- versioned OCI Helm chart under `charts/agent-state-dashboard`
- private K3s exposure through the Tailscale Kubernetes operator
- committed `package-lock.json`; generated `out/` is ignored and produced during image builds

Issue #5 owns only the server, read, and Realtime implementation. Issue #6 owns the frontend operations console. Issue #7 owns Docker, NGINX, Helm, release packaging, and Cloudflare deployment-artifact retirement. Flux #288 owns cluster desired state, Secret material, Tailscale exposure, reconciliation, and live rollout.

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

## Product validation and release

Use the committed Node version and lockfile and run `npm ci`, `npm test`, `npm run typecheck`, and `npm run build` when those commands apply to the changed source. Packaging validation additionally requires `helm lint charts/agent-state-dashboard` and a `helm template` render that verifies the exact Secret/Tailscale contract, probes, resources, and security context. Runtime, integration, container, deployment, and release evidence remain distinct product proofs.

Do not add a product-local GitHub Actions job with concrete runner labels as a CI workaround. Use the reviewed central semantic callers and `StreamScapeTV/ci-workflows@main/RUNNERS.md` when the bounded task requires runner capability selection.

Tagged releases use `.github/workflows/release.yml` and the reviewed central image/chart publication contract. The Git tag, `package.json` version, `charts/agent-state-dashboard/Chart.yaml` `version`, and `appVersion` must be the same canonical SemVer. Publication is immutable: no `latest` authority. Record the exact source SHA plus verified image and chart read-back identities. This repository must not activate its own release in Kubernetes; Flux #288 owns desired state and live rollout.
