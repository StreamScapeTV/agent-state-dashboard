import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const clientSource = readFileSync(new URL("../lib/dashboard-supabase.ts", import.meta.url), "utf8");
const dashboardSource = readFileSync(new URL("../components/DashboardClient.tsx", import.meta.url), "utf8");
const hookSource = readFileSync(new URL("../lib/use-dashboard-tables.ts", import.meta.url), "utf8");
const typesSource = readFileSync(new URL("../types/dashboard.ts", import.meta.url), "utf8");

const browserSources = `${clientSource}\n${dashboardSource}\n${hookSource}`;

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

test("all five authority tables are read completely and independently through the proxy-backed client", () => {
  for (const table of TABLES) assert.match(typesSource, new RegExp(`"${table}"`));
  assert.match(clientSource, /DASHBOARD_TABLES: readonly RawTableName\[\] = RAW_TABLE_NAMES/);
  assert.match(clientSource, /Promise\.allSettled\(/);
  assert.match(clientSource, /DASHBOARD_TABLES\.map\(\(table\) => readDashboardTable\(client, table, options\)\)/);
  assert.match(clientSource, /client\.from\(table\)/);
  assert.match(clientSource, /select\("\*", \{ count: "exact" \}\)/);
  assert.match(clientSource, /query = query\.order\(column, \{ ascending: true \}\)/);
  assert.match(clientSource, /query\.range\(from, from \+ limit - 1\)/);
  assert.match(hookSource, /readDashboardSnapshot\(client, \{ signal: controller\.signal \}\)/);
  assert.match(hookSource, /readDashboardTable\(client, table, \{ signal: controller\.signal \}\)/);
});

test("Realtime invalidation remains exact-five-table and uses scoped refresh with full polling convergence", () => {
  assert.match(clientSource, /client\.channel\("agent-state-dashboard-current"\)/);
  assert.match(clientSource, /"postgres_changes"/);
  assert.match(clientSource, /\{ event: "\*", schema: AGENT_STATE_SCHEMA, table \}/);
  assert.match(clientSource, /status === "SUBSCRIBED"/);
  assert.match(clientSource, /status === "CHANNEL_ERROR" \|\| status === "TIMED_OUT" \|\| status === "CLOSED"/);
  assert.match(hookSource, /subscribeToDashboardChanges\(client, \{/);
  assert.match(hookSource, /onInvalidate: \(table\) => \{/);
  assert.match(hookSource, /queueTableRefresh\(table\)/);
  assert.match(hookSource, /window\.setInterval\(\(\) => \{\s*void requestFullRefresh\(\);\s*\}, POLL_INTERVAL_MS\)/);
});

test("browser transport no longer depends on the local Node API or SSE endpoints", () => {
  assert.doesNotMatch(browserSources, /\/api\/snapshot|\/api\/tables|new EventSource\(|["']\/events["']/);
});

test("browser UI and data client remain mutation-free", () => {
  assert.doesNotMatch(browserSources, /\.insert\s*\(/);
  assert.doesNotMatch(browserSources, /\.upsert\s*\(/);
  assert.doesNotMatch(browserSources, /\.update\s*\(/);
  assert.doesNotMatch(browserSources, /\.delete\s*\(/);
  assert.doesNotMatch(browserSources, /\.rpc\s*\(/);
  assert.doesNotMatch(browserSources, /\.functions\b|\.storage\b|\.auth\.(?:signIn|signUp|updateUser)/);
});
