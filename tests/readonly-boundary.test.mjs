import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const clientSource = readFileSync(new URL("../lib/dashboard-supabase.ts", import.meta.url), "utf8");
const contractSource = readFileSync(new URL("../lib/agent-state-read-contract.ts", import.meta.url), "utf8");
const dashboardSource = readFileSync(new URL("../components/DashboardClient.tsx", import.meta.url), "utf8");
const hookSource = readFileSync(new URL("../lib/use-dashboard-tables.ts", import.meta.url), "utf8");
const realtimeSource = readFileSync(new URL("../lib/realtime-dashboard-state.ts", import.meta.url), "utf8");
const typesSource = readFileSync(new URL("../types/dashboard.ts", import.meta.url), "utf8");

const browserSources = `${clientSource}\n${contractSource}\n${dashboardSource}\n${hookSource}\n${realtimeSource}`;

const CORE_TABLES = [
  "current_projects",
  "current_agents",
  "current_work",
  "current_resources",
  "current_coordination",
];
const ADDITIVE_TABLES = ["current_issues", "current_issue_dependencies"];

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

test("all seven dashboard tables bootstrap independently through the exact proxy-backed read boundary", () => {
  for (const table of CORE_TABLES) assert.match(typesSource, new RegExp(`"${table}"`));
  for (const table of ADDITIVE_TABLES) assert.match(contractSource, new RegExp(`"${table}"`));
  assert.match(clientSource, /DASHBOARD_TABLES: readonly DashboardTableName\[\] = DASHBOARD_TABLE_NAMES/);
  assert.match(clientSource, /Promise\.allSettled\(/);
  assert.match(clientSource, /DASHBOARD_TABLES\.map\(\(table\) => readDashboardTable\(client, table, options\)\)/);
  assert.match(clientSource, /client\.from\(table\)/);
  assert.match(clientSource, /select\("\*", \{ count: "exact" \}\)/);
  assert.match(clientSource, /query = query\.order\(column, \{ ascending: true \}\)/);
  assert.match(clientSource, /query\.range\(from, from \+ limit - 1\)/);
  assert.match(hookSource, /readDashboardSnapshot\(client, \{ signal: controller\.signal \}\)/);
  assert.match(hookSource, /readDashboardTable\(client, table, \{ signal: controller\.signal \}\)/);
  assert.match(dashboardSource, /readDashboardTable\(client, table, \{ signal: controller\.signal \}\)/);
});

test("Realtime keeps established row application and additive issue invalidation without mutation capability", () => {
  assert.match(clientSource, /client\.channel\("agent-state-dashboard-current"\)/);
  assert.match(clientSource, /client\.channel\("agent-state-dashboard-issues"\)/);
  assert.match(clientSource, /"postgres_changes"/);
  assert.match(clientSource, /\{ event: "\*", schema: AGENT_STATE_SCHEMA, table \}/);
  assert.match(clientSource, /onChange\(\{/);
  assert.match(clientSource, /newRow: asRecord\(payload\?\.new\)/);
  assert.match(clientSource, /oldRow: asRecord\(payload\?\.old\)/);
  assert.match(hookSource, /if \(isIssueTableName\(change\.table\)\)/);
  assert.match(hookSource, /void refreshIssueTable\(change\.table\)/);
  assert.match(hookSource, /applyRealtimeChangeToTableStates\(current, change\)/);
  assert.match(realtimeSource, /current_projects: \["project_key"\]/);
  assert.match(realtimeSource, /current_agents: \["project_key", "agent"\]/);
  assert.match(realtimeSource, /current_work: \["project_key", "work_key"\]/);
  assert.match(realtimeSource, /current_resources: \["project_key", "resource_key"\]/);
  assert.match(realtimeSource, /current_coordination: \["project_key", "sender", "recipient"\]/);
  assert.match(realtimeSource, /current_issues: \["project_key", "issue_number"\]/);
  assert.match(
    realtimeSource,
    /current_issue_dependencies: \[[\s\S]*"dependent_project_key"[\s\S]*"dependent_issue_number"[\s\S]*"blocker_project_key"[\s\S]*"blocker_issue_number"/,
  );
  assert.doesNotMatch(hookSource, /queueTableRefresh|INVALIDATION_DEBOUNCE_MS/);
});

test("healthy core Realtime has no fixed full-snapshot polling and recovery polling is bounded", () => {
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

test("browser UI and data client remain mutation-free", () => {
  assert.doesNotMatch(browserSources, /\.insert\s*\(/);
  assert.doesNotMatch(browserSources, /\.upsert\s*\(/);
  assert.doesNotMatch(browserSources, /\.update\s*\(/);
  assert.doesNotMatch(browserSources, /\.delete\s*\(/);
  assert.doesNotMatch(browserSources, /\.rpc\s*\(/);
  assert.doesNotMatch(browserSources, /\.functions\b|\.storage\b|\.auth\.(?:signIn|signUp|updateUser)/);
  assert.doesNotMatch(browserSources, /localStorage|sessionStorage|indexedDB/i);
});

test("rollout tolerance is bounded to the two additive tables and never negotiates schema versions", () => {
  assert.match(clientSource, /MISSING_TABLE_CODE = "PGRST205"/);
  assert.match(clientSource, /isIssueTableName\(table\)/);
  assert.match(clientSource, /isMissingAdditiveTableError\(result\.reason, table\)/);
  assert.match(hookSource, /isMissingAdditiveTableError\(caught, table\)/);
  assert.doesNotMatch(browserSources, /schemaVersion|schema_version|current_issues_v\d|current_issue_dependencies_v\d/i);
});
