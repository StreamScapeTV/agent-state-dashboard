import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const dashboardSource = readFileSync(new URL("../components/DashboardClient.tsx", import.meta.url), "utf8");
const hookSource = readFileSync(new URL("../lib/use-dashboard-tables.ts", import.meta.url), "utf8");
const clientSource = readFileSync(new URL("../lib/dashboard-supabase.ts", import.meta.url), "utf8");
const realtimeSource = readFileSync(new URL("../lib/realtime-dashboard-state.ts", import.meta.url), "utf8");
const pageSource = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
const typesSource = readFileSync(new URL("../types/dashboard.ts", import.meta.url), "utf8");

test("frontend uses one resilient bootstrap loader plus direct Realtime changes without legacy fallbacks", () => {
  assert.match(dashboardSource, /useDashboardTables\(nowMs\)/);
  assert.match(hookSource, /readDashboardSnapshot\(client, \{ signal: controller\.signal \}\)/);
  assert.match(clientSource, /DASHBOARD_PROXY_PATH = "\/supabase"/);
  assert.match(clientSource, /Promise\.allSettled/);
  assert.match(clientSource, /handlers\.onChange\(\{/);
  assert.match(hookSource, /onChange: applyLiveChange/);
  assert.match(hookSource, /applyRealtimeChangeToTableStates\(current, change\)/);
  assert.doesNotMatch(hookSource, /readDashboardTable\(/);
  assert.doesNotMatch(dashboardSource, /\/api\/snapshot|\/api\/overview|\/api\/actors/);
  assert.doesNotMatch(hookSource, /\/api\/snapshot|\/api\/overview|\/api\/actors/);
  assert.doesNotMatch(dashboardSource, /legacyProjects|loadLegacySnapshot|LegacyOverviewPayload|LegacyActorsBatchPayload/);
});

test("home page no longer seeds a hardcoded legacy project list", () => {
  assert.match(pageSource, /<DashboardClient\s*\/>/);
  assert.doesNotMatch(pageSource, /LEGACY_PROJECTS|legacyProjects/);
});

test("retired legacy payload types are removed", () => {
  assert.doesNotMatch(typesSource, /LegacyActorSnapshot|LegacyOverviewPayload|LegacyActorsBatchPayload/);
});

test("subscription is established before bootstrap and buffered changes replay after snapshot", () => {
  const subscribeIndex = hookSource.indexOf("subscribeToDashboardChanges(client, {");
  const bootstrapIndex = hookSource.indexOf('void requestFullRefresh("bootstrap")');
  assert.ok(subscribeIndex >= 0);
  assert.ok(bootstrapIndex > subscribeIndex);
  assert.match(hookSource, /bufferedChangesRef\.current\.push\(change\)/);
  assert.match(hookSource, /replayRealtimeChanges/);
  assert.match(realtimeSource, /applyRealtimeChangeRows/);
});

test("healthy socket operation has no always-on snapshot poll and recovery reconciles explicitly", () => {
  assert.doesNotMatch(hookSource, /export const POLL_INTERVAL_MS\b/);
  assert.match(hookSource, /RECOVERY_POLL_INTERVAL_MS = 5_000/);
  assert.match(hookSource, /connectionState !== "reconnecting" && connectionState !== "recovering"/);
  assert.match(hookSource, /void requestFullRefresh\("recovery"\)/);
  assert.match(hookSource, /void requestFullRefresh\("reconnect"\)/);
  assert.doesNotMatch(dashboardSource, /Refresh all/);
});

test("raw explorer remains an independently selected read while normal live operation is socket-driven", () => {
  assert.match(dashboardSource, /readDashboardTable\(client, table, \{ signal: controller\.signal \}\)/);
  assert.match(dashboardSource, /Raw tables/);
  assert.match(dashboardSource, /Live activity/);
  assert.doesNotMatch(dashboardSource, /new EventSource\(|["']\/events["']|\/api\/tables/);
  assert.doesNotMatch(hookSource, /new EventSource\(|["']\/events["']|\/api\/tables/);
});
