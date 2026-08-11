# Agent State Control Room

Private, read-only StreamScapeTV dashboard for the current Agent State authority. It is a Next.js App Router application rendered on Cloudflare Workers with Material UI.

## Security architecture

```text
Browser
  -> Cloudflare Access SSO
     -> Next.js Worker
        -> verify Cf-Access-Jwt-Assertion
        -> server-only Supabase secret key
           -> agent_api.get_project_state
           -> agent_api.get_agent_state
           -> agent_api.get_storage_budget
```

The browser never receives a Supabase URL/key pair and the repository contains no credential values. The application has no Agent State mutation code and never queries `agent_private` tables. API routes validate Cloudflare Access again even when the hostname is already protected by Access.

Prompt bodies are deliberately not returned to the dashboard client. The UI shows whether a prompt exists and its size, while rendering the current actor state, work, resource keys, and coordination cells needed for operations.

## Why actor scanning is batched

The current Agent State API intentionally has no list-all-agents RPC. The supported identity space is bounded to `Orchestrator`, `Dependabot`, `Agent 1..100`, and `Codex 1..100`. The Worker scans those exact identities through `get_agent_state` in batches of 28 and discards empty actors. It never circumvents the RPC boundary with a table query.

## Required Cloudflare configuration

The Worker requires these **server-only secrets**:

- `AGENT_STATE_SUPABASE_URL`
- `AGENT_STATE_SUPABASE_SECRET_KEY` — use a current Supabase secret key or compatible server-side service-role credential; never a browser key
- `TEAM_DOMAIN` — Cloudflare Access team domain, including `https://`
- `POLICY_AUD` — the Access application's audience tag

`AGENT_STATE_PROJECTS` is a non-secret comma-separated allowlist in `wrangler.jsonc`. Add or remove project keys there; the browser cannot request a project outside the allowlist.

Configure a Cloudflare Access self-hosted application for the Worker hostname and attach the desired SSO identity provider/policy. The application itself verifies the `Cf-Access-Jwt-Assertion` signature, issuer, and audience before returning any data, so a direct unprotected Worker URL still fails closed.

## Supabase read-only prerequisite

The existing Supabase project must already expose the `agent_api` schema through its Data API for server-side PostgREST RPC calls. If it does not, this dashboard reports a configuration error and stops. **Do not change the Supabase project from this repository.** Exposing a schema or changing grants is owner-reviewed Supabase work outside this dashboard task.

Only these existing RPCs are consumed:

- `agent_api.get_project_state(text)`
- `agent_api.get_agent_state(text,text)`
- `agent_api.get_storage_budget()`

## Local development

Use Node `22.18.0` or newer. Install dependencies, generate Wrangler binding types, then run Next.js:

```bash
npm install
npm run cf-typegen
npm run dev
```

For local authenticated data access, provide the four required server-only values through an ignored `.dev.vars` file. Never commit that file.

Validation:

```bash
npm test
npm run cf-typegen
npm run typecheck
npm run cf:build
```

## CI and deployment

`.github/workflows/ci.yml` runs on the organization-managed `[linux, amd64, mobile]` capability set. The OpenNext production bundle materially exceeded the 1 GiB general runner's practical envelope, so CI uses the documented 4 GiB exact-source Node-capable class and creates no routine Actions artifacts.

`main` deploys with `.github/workflows/deploy.yml`. Configure these GitHub `production` environment secrets before deployment:

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`
- `AGENT_STATE_SUPABASE_URL`
- `AGENT_STATE_SUPABASE_SECRET_KEY`
- `TEAM_DOMAIN`
- `POLICY_AUD`

The workflow builds the OpenNext Worker first, then `wrangler-action` uploads the four runtime values as Worker secrets. No credential is embedded in the Next.js browser bundle.
