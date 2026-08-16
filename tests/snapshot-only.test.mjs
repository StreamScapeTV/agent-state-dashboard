import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const dashboardSource = readFileSync(new URL("../components/DashboardClient.tsx", import.meta.url), "utf8");
const clientSource = readFileSync(new URL("../lib/dashboard-supabase.ts", import.meta.url), "utf8");
const pageSource = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
const typesSource = readFileSync(new URL("../types/dashboard.ts", import.meta.url), "utf8");

test("frontend uses the proxy-backed Supabase snapshot loader without legacy fallbacks", () => {
  assert.match(dashboardSource, /readDashboardSnapshot\(client, \{ signal: controller\.signal \}\)/);
  assert.match(clientSource, /DASHBOARD_PROXY_PATH = "\/supabase"/);
  assert.doesNotMatch(dashboardSource, /\/api\/snapshot|\/api\/overview|\/api\/actors/);
  assert.doesNotMatch(dashboardSource, /legacyProjects|loadLegacySnapshot|LegacyOverviewPayload|LegacyActorsBatchPayload/);
});

test("home page no longer seeds a hardcoded legacy project list", () => {
  assert.match(pageSource, /<DashboardClient\s*\/>/);
  assert.doesNotMatch(pageSource, /LEGACY_PROJECTS|legacyProjects/);
});

test("retired legacy payload types are removed", () => {
  assert.doesNotMatch(typesSource, /LegacyActorSnapshot|LegacyOverviewPayload|LegacyActorsBatchPayload/);
});

test("snapshot cleanup preserves proxy-backed Realtime and raw-table reads", () => {
  assert.match(dashboardSource, /subscribeToDashboardChanges\(client, \{/);
  assert.match(dashboardSource, /readDashboardTable\(client, table, \{ signal: controller\.signal \}\)/);
  assert.doesNotMatch(dashboardSource, /new EventSource\(|["']\/events["']|\/api\/tables/);
});
