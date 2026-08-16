import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const clientSource = readFileSync(new URL("../lib/dashboard-supabase.ts", import.meta.url), "utf8");
const dashboardSource = readFileSync(new URL("../components/DashboardClient.tsx", import.meta.url), "utf8");
const typesSource = readFileSync(new URL("../types/dashboard.ts", import.meta.url), "utf8");

const browserSources = `${clientSource}\n${dashboardSource}`;

const TABLES = [
  "current_projects",
  "current_agents",
  "current_work",
  "current_resources",
  "current_coordination",
];

test("browser Supabase client is same-origin and uses only a non-secret placeholder credential", () => {
  assert.match(clientSource, /DASHBOARD_PROXY_PATH = "\/supabase"/);
  assert.match(clientSource, /DASHBOARD_PLACEHOLDER_KEY = "dashboard-proxy-placeholder"/);
  assert.match(clientSource, /dashboardProxyUrl\(window\.location\.origin\)/);
  assert.match(clientSource, /createClient\(/);
  assert.match(clientSource, /db: \{ schema: AGENT_STATE_SCHEMA \}/);
  assert.doesNotMatch(browserSources, /SUPABASE_URL|SUPABASE_SECRET_KEY|NEXT_PUBLIC_SUPABASE/i);
  assert.doesNotMatch(browserSources, /https?:\/\/[^"'\s]*\.supabase\.(?:co|in)/i);
});

test("all five authority tables are read completely through the proxy-backed client", () => {
  for (const table of TABLES) assert.match(typesSource, new RegExp(`"${table}"`));
  assert.match(clientSource, /DASHBOARD_TABLES: readonly RawTableName\[\] = RAW_TABLE_NAMES/);
  assert.match(clientSource, /DASHBOARD_TABLES\.map\(async \(table\) =>/);
  assert.match(clientSource, /client\.from\(table\)/);
  assert.match(clientSource, /select\("\*", \{ count: "exact" \}\)/);
  assert.match(clientSource, /query = query\.order\(column, \{ ascending: true \}\)/);
  assert.match(clientSource, /query\.range\(from, from \+ limit - 1\)/);
  assert.match(dashboardSource, /readDashboardSnapshot\(client, \{ signal: controller\.signal \}\)/);
  assert.match(dashboardSource, /readDashboardTable\(client, table, \{ signal: controller\.signal \}\)/);
});

test("Realtime invalidation uses Postgres Changes on all current tables with polling fallback", () => {
  assert.match(clientSource, /client\.channel\("agent-state-dashboard-current"\)/);
  assert.match(clientSource, /"postgres_changes"/);
  assert.match(clientSource, /\{ event: "\*", schema: AGENT_STATE_SCHEMA, table \}/);
  assert.match(clientSource, /status === "SUBSCRIBED"/);
  assert.match(clientSource, /status === "CHANNEL_ERROR" \|\| status === "TIMED_OUT" \|\| status === "CLOSED"/);
  assert.match(dashboardSource, /subscribeToDashboardChanges\(client, \{/);
  assert.match(dashboardSource, /onInvalidate: \(\) => applyLiveEvent\("invalidate"\)/);
  assert.match(dashboardSource, /window\.setInterval\(requestRefresh, POLL_INTERVAL_MS\)/);
});

test("browser transport no longer depends on the local Node API or SSE endpoints", () => {
  assert.doesNotMatch(dashboardSource, /\/api\/snapshot|\/api\/tables|new EventSource\(|["']\/events["']/);
});

test("browser UI and data client remain mutation-free", () => {
  assert.doesNotMatch(browserSources, /\.insert\s*\(/);
  assert.doesNotMatch(browserSources, /\.upsert\s*\(/);
  assert.doesNotMatch(browserSources, /\.update\s*\(/);
  assert.doesNotMatch(browserSources, /\.delete\s*\(/);
  assert.doesNotMatch(browserSources, /\.rpc\s*\(/);
  assert.doesNotMatch(browserSources, /\.functions\b|\.storage\b|\.auth\.(?:signIn|signUp|updateUser)/);
});
