import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const agentStateSource = await readFile(new URL("../lib/agent-state.ts", import.meta.url), "utf8");
const supabaseSource = await readFile(new URL("../lib/supabase.ts", import.meta.url), "utf8");
const runtimeSource = await readFile(new URL("../lib/runtime-env.ts", import.meta.url), "utf8");

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

test("Agent State application code contains only read RPC names", () => {
  assert.match(agentStateSource, /rpc\("get_project_state"/);
  assert.match(agentStateSource, /rpc\("get_storage_budget"/);
  assert.match(agentStateSource, /rpc\("get_agent_state"/);
  for (const rpc of mutationRpcs) assert.doesNotMatch(agentStateSource, new RegExp(`rpc\\(["']${rpc}["']`));
  assert.doesNotMatch(agentStateSource, /\bclient\s*\.\s*from\s*\(/);
  assert.doesNotMatch(agentStateSource, /agent_private/);
});

test("Supabase client is pinned to the reviewed agent_api schema", () => {
  assert.match(supabaseSource, /schema:\s*"agent_api"/);
  assert.doesNotMatch(supabaseSource, /\.from\s*\(/);
  assert.doesNotMatch(supabaseSource, /NEXT_PUBLIC_/);
  assert.match(runtimeSource, /AGENT_STATE_SUPABASE_SECRET_KEY/);
  assert.doesNotMatch(runtimeSource, /NEXT_PUBLIC_/);
});
