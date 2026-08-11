# Agent State Control Room

Private, read-only StreamScapeTV dashboard for the current Agent State authority. The repository commits the complete Cloudflare Pages output: static Next.js assets plus a precompiled advanced-mode Worker for authenticated API reads.

## Architecture

```text
Browser
  -> Cloudflare Access SSO
     -> committed out/_worker.js
        -> /api/*: verify Cf-Access-Jwt-Assertion
                   -> encrypted AGENT_STATE_SUPABASE_SECRET_KEY
                      -> agent_api.get_project_state
                      -> agent_api.get_agent_state
                      -> agent_api.get_storage_budget
        -> everything else: env.ASSETS.fetch(request)
                            -> committed static files in out/
```

The browser never receives a Supabase credential. The repository contains no secret value, no Agent State mutation code, and no direct query of `agent_private` tables. Prompt bodies are deliberately not returned to the dashboard client.

`out/_worker.js` is generated before merge from the reviewed `/functions/api/*` entrypoints and `/pages-server` helpers. Because `_worker.js` is already in the Pages output directory, Cloudflare Pages uses advanced mode and does not need to compile the application or the Function sources during deployment.

## Agent discovery

The current Agent State API intentionally has no list-all-agents RPC. The supported identity space is bounded to `Orchestrator`, `Dependabot`, `Agent 1..100`, and `Codex 1..100`. The API scans those exact identities through `get_agent_state` in batches of 28 and discards empty actors. It never circumvents the RPC boundary with a table query.

## Cloudflare Pages setup

Connect `StreamScapeTV/agent-state-dashboard` to Cloudflare Pages using Git integration and use:

- Production branch: `main`
- Root directory: repository root
- Framework preset: None
- Build command: leave blank (or `exit 0` if the UI requires a command)
- Build output directory: `out`

The repository already contains the complete deployable output in `out/`, including `out/_worker.js`. Source changes must regenerate and commit `out/` before merge so a `main` deployment never depends on Cloudflare running `next build` or bundling the API Worker.

Configure these **encrypted Pages secrets** under the production project:

- `AGENT_STATE_SUPABASE_SECRET_KEY`
- `TEAM_DOMAIN` — Cloudflare Access team domain, including `https://`
- `POLICY_AUD` — Access application audience tag

The Agent State Supabase URL is public routing metadata and is fixed in the server source as `https://fvbaxyklaclgdzyhybbr.supabase.co`.

Protect the Pages hostname with a Cloudflare Access self-hosted application and the desired SSO identity provider/policy. The advanced-mode Worker independently verifies the signed Access JWT before returning `/api/*` data. Static assets are served through the Pages `ASSETS` binding.

## Supabase boundary

The existing Supabase project must already expose `agent_api` through the Data API and allow the configured server credential to execute these existing read RPCs:

- `agent_api.get_project_state(text)`
- `agent_api.get_agent_state(text,text)`
- `agent_api.get_storage_budget()`

Do not modify the Supabase project from this repository. If the existing API/grants are insufficient, the dashboard fails closed and reports the configuration problem.

## Development and artifact refresh

Use Node `22.18.0` or newer and the committed npm lockfile.

```bash
npm ci
npm run dev
```

Generate and validate the complete Pages output before merging source changes:

```bash
npm test
npm run typecheck
npm run pages:build
git diff --exit-code -- package-lock.json out
```

`npm run pages:build` regenerates the static Next.js export and then precompiles the Pages API boundary into `out/_worker.js`. If source changes intentionally alter the artifact, commit the resulting `out/` changes together with the source changes, then rerun the commands above until the tree is stable.

For local full Pages testing, put the three runtime secrets in ignored `.dev.vars`, generate the output, then run:

```bash
npm run pages:build
npm run pages:dev
```

Never commit `.dev.vars` or any Supabase credential.

## GitHub and deployment automation

This repository intentionally contains **no GitHub Actions build or Cloudflare deployment workflow**. Cloudflare Pages Git integration owns deployment from `main` and consumes the already-committed `out/` directory directly.

The organization-wide `ci-workflows` repository currently has active shared-registration work and its browser-only static-export contract intentionally rejects `_worker.js`. Do not add a product-local workflow with concrete runner labels as a workaround. When central CI gains a reviewed profile for a prebuilt Pages advanced-mode artifact, adopt it through a thin semantic caller.
