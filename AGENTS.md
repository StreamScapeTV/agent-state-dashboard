# AGENTS.md — StreamScapeTV/agent-state-dashboard

## Repository identity

- Repository: `StreamScapeTV/agent-state-dashboard`
- Agent State project key: `agent-state-dashboard`
- Integration branch: `main`
- Deployment migration: private K3s/Tailscale per dashboard #4; issue #7 owns producer packaging/release and Flux #288 owns cluster activation
- Application: private read-only Agent State dashboard

The sole shared organization-policy entry point is `StreamScapeTV/organization-rules@main/AGENTS.md`.

## Product boundary

This repository is a read-only visualization client for the separately owned `StreamScapeTV/agent-state-supabase` service.

- Never add, alter, migrate, seed, repair, reset, deploy, or otherwise mutate the Agent State Supabase project from this repository.
- Application code must not call Agent State mutation RPCs, execute arbitrary SQL, expose a generic Supabase proxy, or provide browser-side Supabase access.
- The server-side dashboard data plane may read and subscribe to exactly these five current Agent State authority tables required by dashboard #4: `current_projects`, `current_agents`, `current_work`, `current_resources`, and `current_coordination`. Do not broaden that allowlist without a separately reviewed product change.
- `SUPABASE_URL` and `SUPABASE_SECRET_KEY` are server-only runtime configuration. They must never use `NEXT_PUBLIC_*`, be committed, be rendered into static browser assets, be returned by an API route, or be logged.
- Browser-facing routes remain observation-only. No SQL editor, arbitrary RPC endpoint, Agent State mutation API, or mutation UI belongs in this product.
- The previous Cloudflare Pages/Access/Pages Functions prototype is not an architectural requirement for the new server data path. Issue #7 owns removal of the obsolete deployment/package artifacts; do not expand that cleanup into unrelated work while implementing #5.
- Application logging must not include credentials, authorization headers, prompts beyond the intended dashboard response contract, or unrestricted/raw Supabase responses.

## Current migration stack

- Next.js App Router static export + TypeScript
- Material UI
- dependency-light server-side Node data plane for dashboard reads and Realtime invalidation
- committed `package-lock.json`

Issue #5 owns only the server/read/Realtime implementation. Issue #6 owns the frontend operations console. Issue #7 owns Docker/NGINX/Helm/release packaging and Cloudflare deployment-artifact retirement. Flux #288 owns cluster desired state, Secret material, Tailscale exposure, reconciliation, and live rollout.

## Validation and CI

Before merging source changes, use the committed Node version and lockfile and run `npm ci`, `npm test`, `npm run typecheck`, and `npm run build` when those commands apply to the changed source. A worker must not fabricate unavailable runtime, integration, container, device, deployment, or release evidence.

Do not add a product-local GitHub Actions job with concrete runner labels as a CI workaround. Follow `StreamScapeTV/ci-workflows@main/RUNNERS.md`; use a thin central semantic caller only after the repository is admitted to the corresponding reviewed central contract.

The legacy Cloudflare Pages deployment configuration is transitional residue, not the target architecture. Do not make new server work depend on Cloudflare Access assertions, Pages Function bindings, committed advanced-mode Worker output, or Cloudflare runtime secrets. Producer packaging/release migration is bounded to #7, and actual K3s activation remains bounded to Flux #288.
