# Agent State Control Room

Private, read-only StreamScapeTV dashboard for the current Agent State authority. The UI is a committed Next.js static export served directly by Cloudflare Pages; authenticated data reads run only in Cloudflare Pages Functions.

## Architecture

```text
Browser
  -> Cloudflare Access SSO
     -> committed static assets from out/
     -> /api/* Cloudflare Pages Functions
        -> verify Cf-Access-Jwt-Assertion
        -> encrypted AGENT_STATE_SUPABASE_SECRET_KEY
           -> agent_api.get_project_state
           -> agent_api.get_agent_state
           -> agent_api.get_storage_budget
```

The browser never receives a Supabase credential. The repository contains no secret value, no Agent State mutation code, and no direct query of `agent_private` tables. Prompt bodies are deliberately not returned to the dashboard client.

`public/_routes.json` limits Pages Function invocation to `/api/*`, so the dashboard HTML, CSS, JavaScript, and other assets are served directly from `out/`.

## Why Pages Functions still exist

A truly static browser bundle cannot safely contain the Supabase secret/service-role credential. Pages Functions are therefore the narrow server-side boundary for read-only Agent State RPCs. Cloudflare deploys those Functions automatically from the root `/functions` directory when the Git-connected Pages project deploys; there is no GitHub-to-Cloudflare deployment workflow.

## Agent discovery

The current Agent State API intentionally has no list-all-agents RPC. The supported identity space is bounded to `Orchestrator`, `Dependabot`, `Agent 1..100`, and `Codex 1..100`. The API scans those exact identities through `get_agent_state` in batches of 28 and discards empty actors. It never circumvents the RPC boundary with a table query.

## Cloudflare Pages setup

Connect `StreamScapeTV/agent-state-dashboard` to Cloudflare Pages using Git integration and use:

- Production branch: `main`
- Root directory: repository root
- Framework preset: None
- Build command: leave blank (or `exit 0` if the UI requires a command)
- Build output directory: `out`

The repository already contains the built static output. Source changes must regenerate and commit `out/` before merge so a `main` deployment never depends on Cloudflare building the Next.js application.

Configure these **encrypted Pages secrets** under the production project:

- `AGENT_STATE_SUPABASE_SECRET_KEY`
- `TEAM_DOMAIN` — Cloudflare Access team domain, including `https://`
- `POLICY_AUD` — Access application audience tag

The Agent State Supabase URL is public routing metadata and is fixed in the Pages Function source as `https://fvbaxyklaclgdzyhybbr.supabase.co`.

Protect the Pages hostname with a Cloudflare Access self-hosted application and the desired SSO identity provider/policy. The `/api/*` Functions independently verify the signed Access JWT before returning data. For a security-sensitive deployment, configure Pages Functions to fail closed rather than serving protected routes when Functions cannot execute.

## Supabase boundary

The existing Supabase project must already expose `agent_api` through the Data API and allow the configured server credential to execute these existing read RPCs:

- `agent_api.get_project_state(text)`
- `agent_api.get_agent_state(text,text)`
- `agent_api.get_storage_budget()`

Do not modify the Supabase project from this repository. If the existing API/grants are insufficient, the dashboard fails closed and reports the configuration problem.

## Development

Use Node `22.18.0` or newer.

```bash
npm install
npm run dev
```

Static export and Pages Function validation:

```bash
npm test
npm run typecheck
npm run build
npm run pages:functions
```

`npm run build` regenerates `out/`. Commit the resulting `out/` changes together with source changes before merging to `main`.

For local Pages Function testing, put the three runtime secrets in ignored `.dev.vars`, run `npm run build`, then:

```bash
npm run pages:dev
```

Never commit `.dev.vars` or any Supabase credential.

## CI

`.github/workflows/ci.yml` validates the exact source SHA, read-only boundary tests, TypeScript, the Next.js static export, the Pages Functions bundle, and that the committed `out/` tree exactly matches a fresh build. Cloudflare deployment itself is owned by Pages Git integration, not GitHub Actions.
