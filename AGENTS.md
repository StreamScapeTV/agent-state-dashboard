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
- Supabase secret/service-role credentials are server-only Cloudflare Pages Function secrets. They must never use `NEXT_PUBLIC_*`, be committed, be rendered into static HTML, or be returned by an API route.
- Browser access is authenticated by Cloudflare Access SSO. Pages Functions must independently verify the signed Access assertion before returning Agent State data.
- The committed `out/` directory contains only static frontend assets. Pages Function entrypoints live under root-level `/functions/api/*`; shared server-only helper modules live under `/pages-server` and may be imported only by Pages Functions, never by the static frontend.
- Application logging must not include credentials, prompts, unrestricted state payloads, authorization headers, or raw Supabase responses.

## Stack

- Next.js App Router static export + TypeScript
- Material UI
- Committed `out/` directory served by Cloudflare Pages
- Cloudflare Pages Functions for authenticated `/api/*` reads
- Supabase JavaScript client from Pages Functions only

## CI and deployment

Follow `StreamScapeTV/ci-workflows@main/RUNNERS.md` for runner selection. CI must verify that `out/` is reproducible from the reviewed source before merge and must never use bare `self-hosted`.

Cloudflare Pages is connected directly to GitHub `main`. Configure the Pages project with no application build step and build output directory `out`. Root-level `/functions` is deployed by Pages for server-side API routes. Store Supabase and Cloudflare Access credentials only as encrypted Cloudflare Pages secrets; never in repository files.
