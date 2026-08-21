import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const clientSource = readFileSync(new URL("../lib/dashboard-supabase.ts", import.meta.url), "utf8");
const dashboardSource = readFileSync(new URL("../components/DashboardClient.tsx", import.meta.url), "utf8");
const overviewSource = readFileSync(new URL("../components/ProjectOverview.tsx", import.meta.url), "utf8");
const attentionSource = readFileSync(new URL("../components/AttentionInbox.tsx", import.meta.url), "utf8");
const hookSource = readFileSync(new URL("../lib/use-dashboard-tables.ts", import.meta.url), "utf8");
const realtimeSource = readFileSync(new URL("../lib/realtime-dashboard-state.ts", import.meta.url), "utf8");
const typesSource = readFileSync(new URL("../types/dashboard.ts", import.meta.url), "utf8");

const browserSources = [
  clientSource,
  dashboardSource,
  overviewSource,
  attentionSource,
  hookSource,
  realtimeSource,
].join("\n");

const TABLES = [
  "current_projects",
  "current_agents",
  "current_work",
  "current_resources",
  "current_coordination",
];

test("browser Supabase client is same-origin and uses only a non-secret API-key-shaped placeholder", () => {
  assert.match(clientSource, /DASHBOARD_PROXY_PATH = "\/supabase"/);
  assert.match(clientSource, /DASHBOARD_PLACEHOLDER_KEY = "sb_publishable_dashboard_proxy_placeholder"/);
  assert.doesNotMatch(clientSource, /DASHBOARD_PLACEHOLDER_KEY = "sb_secret_/);
  assert.match(clientSource, /dashboardProxyUrl\(window\.location\.origin\)/);
  assert.match(clientSource, /createClient<any, typeof AGENT_STATE_SCHEMA>\([\s\S]*DASHBOARD_PLACEHOLDER_KEY/);
  assert.match(clientSource, /db: \{ schema: AGENT_STATE_SCHEMA \}/);
  assert.doesNotMatch(browserSources, /SUPABASE_URL|SUPABASE_SECRET_KEY|NEXT_PUBLIC_SUPABASE/i);
  assert.doesNotMatch(browserSources, /https?:\/\/[^"'\s]*\.supabase\.(?:co|in)/i);
});

test("all five authority tables bootstrap independently through the exact proxy-backed read boundary", () => {
  for (const table of TABLES) assert.match(typesSource, new RegExp(`"${table}"`));
  assert.match(clientSource, /DASHBOARD_TABLES: readonly RawTableName\[\] = RAW_TABLE_NAMES/);
  assert.match(clientSource, /Promise\.allSettled\(/);
  assert.match(clientSource, /DASHBOARD_TABLES\.map\(\(table\) => readDashboardTable\(client, table, options\)\)/);
  assert.match(clientSource, /client\.from\(table\)/);
  assert.match(clientSource, /select\("\*", \{ count: "exact" \}\)/);
  assert.match(clientSource, /query = query\.order\(column, \{ ascending: true \}\)/);
  assert.match(clientSource, /query\.range\(from, from \+ limit - 1\)/);
  assert.match(hookSource, /readDashboardSnapshot\(client, \{ signal: controller\.signal \}\)/);
  assert.doesNotMatch(hookSource, /readDashboardTable\(/);
  assert.match(dashboardSource, /readDashboardTable\(client, table, \{ signal: controller\.signal \}\)/);
});

test("Realtime row changes remain exact-five-table and are applied locally without mutation capability", () => {
  assert.match(clientSource, /client\.channel\("agent-state-dashboard-current"\)/);
  assert.match(clientSource, /"postgres_changes"/);
  assert.match(clientSource, /\{ event: "\*", schema: AGENT_STATE_SCHEMA, table \}/);
  assert.match(clientSource, /handlers\.onChange\(\{/);
  assert.match(clientSource, /newRow: asRecord\(payload\?\.new\)/);
  assert.match(clientSource, /oldRow: asRecord\(payload\?\.old\)/);
  assert.match(hookSource, /onChange: applyLiveChange/);
  assert.match(hookSource, /applyRealtimeChangeToTableStates\(current, change\)/);
  assert.match(realtimeSource, /current_projects: \["project_key"\]/);
  assert.match(realtimeSource, /current_agents: \["project_key", "agent"\]/);
  assert.match(realtimeSource, /current_work: \["project_key", "work_key"\]/);
  assert.match(realtimeSource, /current_resources: \["project_key", "resource_key"\]/);
  assert.match(realtimeSource, /current_coordination: \["project_key", "sender", "recipient"\]/);
  assert.doesNotMatch(hookSource, /queueTableRefresh|pendingInvalidationsRef|INVALIDATION_DEBOUNCE_MS/);
});

test("healthy Realtime has no fixed full-snapshot polling and recovery polling is bounded", () => {
  assert.doesNotMatch(hookSource, /export const POLL_INTERVAL_MS\b/);
  assert.match(hookSource, /RECOVERY_POLL_INTERVAL_MS = 5_000/);
  assert.match(hookSource, /connectionState !== "reconnecting" && connectionState !== "recovering"/);
  assert.match(hookSource, /void requestFullRefresh\("recovery"\)/);
  assert.match(hookSource, /void requestFullRefresh\("reconnect"\)/);
  assert.doesNotMatch(dashboardSource, /Refresh all/);
});

test("browser transport no longer depends on the local Node API or SSE endpoints", () => {
  assert.doesNotMatch(browserSources, /\/api\/snapshot|\/api\/tables|new EventSource\(|["']\/events["']/);
});

test("progressive browser UI and data client remain mutation-free and history-free", () => {
  assert.doesNotMatch(browserSources, /\.insert\s*\(/);
  assert.doesNotMatch(browserSources, /\.upsert\s*\(/);
  assert.doesNotMatch(browserSources, /\.update\s*\(/);
  assert.doesNotMatch(browserSources, /\.delete\s*\(/);
  assert.doesNotMatch(browserSources, /\.rpc\s*\(/);
  assert.doesNotMatch(browserSources, /\.functions\b|\.storage\b|\.auth\.(?:signIn|signUp|updateUser)/);
  assert.doesNotMatch(browserSources, /localStorage|sessionStorage|indexedDB/i);
});
