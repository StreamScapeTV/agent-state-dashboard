import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const agentStateSource = await readFile(new URL("../pages-server/agent-state.js", import.meta.url), "utf8");
const configSource = await readFile(new URL("../pages-server/config.js", import.meta.url), "utf8");
const accessSource = await readFile(new URL("../pages-server/access.js", import.meta.url), "utf8");
const pageSource = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");

const mutationRpcs = [
  "set_project_state",
  "set_agents_prompt",
  "set_agent_state",
  "set_work",
  "finish_work",
  "claim_resource",
  "release_resource",
  "set_coordination",
  "resolve_coordination",
  "cleanup_agent",
  "takeover_resource",
];

test("Pages Functions contain only reviewed Agent State read RPCs", () => {
  assert.match(agentStateSource, /rpc\("get_project_state"/);
  assert.match(agentStateSource, /rpc\("get_storage_budget"/);
  assert.match(agentStateSource, /rpc\("get_agent_state"/);
  for (const rpc of mutationRpcs) assert.doesNotMatch(agentStateSource, new RegExp(`rpc\\(["']${rpc}["']`));
  assert.doesNotMatch(agentStateSource, /\.from\s*\(/);
  assert.doesNotMatch(agentStateSource, /agent_private/);
});

test("Supabase secret stays in Pages Functions and never in static frontend source", () => {
  assert.match(configSource, /schema:\s*"agent_api"/);
  assert.match(configSource, /AGENT_STATE_SUPABASE_SECRET_KEY/);
  assert.doesNotMatch(configSource, /NEXT_PUBLIC_/);
  assert.doesNotMatch(accessSource, /NEXT_PUBLIC_/);
  assert.doesNotMatch(pageSource, /AGENT_STATE_SUPABASE_SECRET_KEY|NEXT_PUBLIC_/);
});

test("Cloudflare Access assertion is independently verified before API reads", () => {
  assert.match(accessSource, /cf-access-jwt-assertion/i);
  assert.match(accessSource, /jwtVerify/);
  assert.match(accessSource, /TEAM_DOMAIN/);
  assert.match(accessSource, /POLICY_AUD/);
});
