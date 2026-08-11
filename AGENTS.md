# AGENTS.md — StreamScapeTV/agent-state-dashboard

## Repository identity

- Repository: `StreamScapeTV/agent-state-dashboard`
- Agent State project key: `agent-state-dashboard`
- Integration branch: `main`
- Deployment target: Cloudflare Workers
- Application: private read-only Agent State dashboard

The sole shared organization-policy entry point is `StreamScapeTV/organization-rules@main/AGENTS.md`.

## Product boundary

This repository is a read-only visualization client for the separately owned `StreamScapeTV/agent-state-supabase` service.

- Never add, alter, migrate, seed, repair, reset, deploy, or otherwise mutate the Agent State Supabase project from this repository.
- Never call Agent State mutation RPCs from application code. Dashboard data access is limited to reviewed read RPCs such as `agent_api.get_project_state`, `agent_api.get_agent_state`, and `agent_api.get_storage_budget`.
- Never query the private Agent State tables directly.
- Supabase secret/service-role credentials are server-only Cloudflare secrets. They must never use `NEXT_PUBLIC_*`, be committed, be rendered into HTML, or be returned by an API route.
- Browser access is authenticated by Cloudflare Access SSO. Production must fail closed when Access authentication is not configured.
- Application logging must not include credentials, prompts, unrestricted state payloads, authorization headers, or raw Supabase responses.

## Stack

- Next.js App Router + TypeScript
- Material UI
- `@opennextjs/cloudflare` on Cloudflare Workers
- Supabase JavaScript client from server-only code

## CI and deployment

Follow `StreamScapeTV/ci-workflows@main/RUNNERS.md` for runner selection. Ordinary Node validation uses the general Linux capability set and must never use bare `self-hosted`.

Deployment uses Cloudflare Workers. Store Cloudflare and Supabase credentials only in approved secret stores / GitHub Actions secrets; never in repository files.
