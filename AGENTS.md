# AGENTS.md — StreamScapeTV/agent-state-dashboard

## Repository identity

- Repository: `StreamScapeTV/agent-state-dashboard`
- Agent State project key: `agent-state-dashboard`
- Integration branch: `main`
- Deployment target: Cloudflare Pages Git integration
- Application: private read-only Agent State dashboard

The sole shared organization-policy entry point is `StreamScapeTV/organization-rules@main/AGENTS.md`.

## Product boundary

This repository is a read-only visualization client for the separately owned `StreamScapeTV/agent-state-supabase` service.

- Never add, alter, migrate, seed, repair, reset, deploy, or otherwise mutate the Agent State Supabase project from this repository.
- Never call Agent State mutation RPCs from application code. Dashboard data access is limited to reviewed read RPCs such as `agent_api.get_project_state`, `agent_api.get_agent_state`, and `agent_api.get_storage_budget`.
- Never query the private Agent State tables directly.
- Supabase secret/service-role credentials are server-only Cloudflare Pages secrets. They must never use `NEXT_PUBLIC_*`, be committed, be rendered into static HTML, or be returned by an API route.
- Browser access is authenticated by Cloudflare Access SSO. The prebuilt API Worker must independently verify the signed Access assertion before returning Agent State data.
- The committed `out/` directory is the complete deployment artifact: static frontend assets plus precompiled `out/_worker.js`. `/functions/api/*` and `/pages-server` are source-only inputs used to regenerate that Worker before merge.
- `out/_worker.js` may contain secret binding names but never secret values. Browser-visible assets other than `_worker.js` must contain neither secret names nor credential material.
- Application logging must not include credentials, prompts, unrestricted state payloads, authorization headers, or raw Supabase responses.

## Stack

- Next.js App Router static export + TypeScript
- Material UI
- Committed `out/` directory served by Cloudflare Pages
- Cloudflare Pages advanced-mode `out/_worker.js` for authenticated `/api/*` reads and `env.ASSETS` fallback
- Supabase JavaScript client bundled only into the server-side Worker

## CI and deployment

Follow `StreamScapeTV/ci-workflows@main/RUNNERS.md` for runner selection. CI must prove that the complete `out/` artifact is reproducible from the reviewed source before merge and must never use bare `self-hosted`.

Cloudflare Pages is connected directly to GitHub `main`. Configure the Pages project with no application build step and build output directory `out`. Cloudflare must deploy the already-committed advanced-mode output rather than build application source. Store the Supabase credential and Cloudflare Access configuration only as encrypted Cloudflare Pages secrets; never in repository files.
