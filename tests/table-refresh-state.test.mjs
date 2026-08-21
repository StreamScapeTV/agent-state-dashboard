import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

function loadTableState() {
  const source = readFileSync(new URL("../lib/table-refresh-state.ts", import.meta.url), "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  }).outputText;
  const module = { exports: {} };
  const evaluate = new Function("exports", "module", "require", output);
  evaluate(module.exports, module, (specifier) => {
    if (specifier === "@/types/dashboard") {
      return {
        RAW_TABLE_NAMES: [
          "current_projects",
          "current_agents",
          "current_work",
          "current_resources",
          "current_coordination",
        ],
      };
    }
    throw new Error(`Unexpected runtime import while testing table state: ${specifier}`);
  });
  return module.exports;
}

const state = loadTableState();
const tables = [
  "current_projects",
  "current_agents",
  "current_work",
  "current_resources",
  "current_coordination",
];

function requestIds(value) {
  return Object.fromEntries(tables.map((table) => [table, value]));
}

test("initial partial snapshot preserves four successful tables when one table fails", () => {
  let current = state.createTableReadStates();
  current = state.beginTableReads(current, requestIds(1));
  current = state.applyPartialSnapshot(current, {
    tables: {
      current_projects: [{ project_key: "demo" }],
      current_agents: [{ project_key: "demo", agent: "Agent 1" }],
      current_resources: [],
      current_coordination: [],
    },
    errors: { current_work: "Dashboard read failed for current_work" },
  }, requestIds(1), "2026-08-21T05:00:00Z");

  assert.equal(current.current_projects.hasData, true);
  assert.equal(current.current_agents.hasData, true);
  assert.equal(current.current_resources.hasData, true);
  assert.equal(current.current_coordination.hasData, true);
  assert.equal(current.current_work.hasData, false);
  assert.equal(current.current_work.error, "Dashboard read failed for current_work");
  assert.equal(current.current_work.stale, false);
  assert.equal(
    state.dashboardFreshness(current, Date.parse("2026-08-21T05:00:10Z"), 75_000),
    "partial",
  );
  assert.deepEqual(state.tableIssues(current), ["current_work"]);

  const input = state.snapshotInputFromTableStates(current);
  assert.deepEqual(Object.keys(input.tables).sort(), [
    "current_agents",
    "current_coordination",
    "current_projects",
    "current_resources",
  ]);
});

test("failed refresh retains last-good rows and marks only that table stale", () => {
  let current = state.createTableReadStates();
  current = state.beginTableRead(current, "current_work", 1);
  current = state.completeTableRead(
    current,
    "current_work",
    1,
    [{ work_key: "issue-1" }],
    "2026-08-21T05:00:00Z",
  );
  current = state.beginTableRead(current, "current_work", 2);
  current = state.failTableRead(current, "current_work", 2, "temporary outage");

  assert.deepEqual(current.current_work.rows, [{ work_key: "issue-1" }]);
  assert.equal(current.current_work.hasData, true);
  assert.equal(current.current_work.stale, true);
  assert.equal(current.current_work.loading, false);
  assert.equal(current.current_work.error, "temporary outage");
  assert.equal(current.current_work.lastSuccessAt, "2026-08-21T05:00:00Z");
});

test("a failed table later recovers and clears stale/error state", () => {
  let current = state.createTableReadStates();
  current = state.beginTableRead(current, "current_agents", 1);
  current = state.failTableRead(current, "current_agents", 1, "offline");
  current = state.beginTableRead(current, "current_agents", 2);
  current = state.completeTableRead(
    current,
    "current_agents",
    2,
    [{ agent: "Agent 2" }],
    "2026-08-21T05:01:00Z",
  );

  assert.equal(current.current_agents.hasData, true);
  assert.equal(current.current_agents.stale, false);
  assert.equal(current.current_agents.error, null);
  assert.deepEqual(current.current_agents.rows, [{ agent: "Agent 2" }]);
  assert.equal(current.current_agents.lastSuccessAt, "2026-08-21T05:01:00Z");
});

test("older response cannot overwrite a newer table request", () => {
  let current = state.createTableReadStates();
  current = state.beginTableRead(current, "current_resources", 1);
  current = state.beginTableRead(current, "current_resources", 2);
  const afterOldSuccess = state.completeTableRead(
    current,
    "current_resources",
    1,
    [{ resource_key: "old" }],
    "2026-08-21T05:00:00Z",
  );
  assert.equal(afterOldSuccess, current);

  current = state.completeTableRead(
    current,
    "current_resources",
    2,
    [{ resource_key: "new" }],
    "2026-08-21T05:00:10Z",
  );
  const afterOldFailure = state.failTableRead(current, "current_resources", 1, "late failure");
  assert.equal(afterOldFailure, current);
  assert.deepEqual(current.current_resources.rows, [{ resource_key: "new" }]);
  assert.equal(current.current_resources.error, null);
});

test("full request-id generations advance only selected table identities", () => {
  const initial = state.createRequestIds();
  const scoped = state.nextRequestIds(initial, ["current_work"]);
  assert.equal(scoped.current_work, 1);
  assert.equal(scoped.current_agents, 0);

  const full = state.nextRequestIds(scoped, tables);
  assert.equal(full.current_work, 2);
  assert.equal(full.current_agents, 1);
  assert.equal(full.current_projects, 1);
});

test("freshness separates loading, partial, stale and healthy states", () => {
  let current = state.createTableReadStates();
  current = state.beginTableReads(current, requestIds(1));
  assert.equal(state.dashboardFreshness(current, 0, 75_000), "loading");

  current = state.applyPartialSnapshot(current, {
    tables: Object.fromEntries(tables.map((table) => [table, []])),
    errors: {},
  }, requestIds(1), "2026-08-21T05:00:00Z");
  assert.equal(
    state.dashboardFreshness(current, Date.parse("2026-08-21T05:00:30Z"), 75_000),
    "fresh",
  );
  assert.equal(
    state.dashboardFreshness(current, Date.parse("2026-08-21T05:02:00Z"), 75_000),
    "stale",
  );

  current = state.beginTableRead(current, "current_coordination", 2);
  assert.equal(
    state.tableHealthLabel(current.current_coordination, Date.parse("2026-08-21T05:00:30Z"), 75_000),
    "refreshing",
  );
  current = state.failTableRead(current, "current_coordination", 2, "down");
  assert.equal(
    state.tableHealthLabel(current.current_coordination, Date.parse("2026-08-21T05:00:30Z"), 75_000),
    "stale",
  );
});

test("latest success timestamp is independent from table error state", () => {
  let current = state.createTableReadStates();
  current = state.beginTableRead(current, "current_projects", 1);
  current = state.completeTableRead(current, "current_projects", 1, [], "2026-08-21T05:00:00Z");
  current = state.beginTableRead(current, "current_agents", 1);
  current = state.completeTableRead(current, "current_agents", 1, [], "2026-08-21T05:00:10Z");
  current = state.beginTableRead(current, "current_agents", 2);
  current = state.failTableRead(current, "current_agents", 2, "temporary");

  assert.equal(state.latestTableSuccessAt(current), "2026-08-21T05:00:10Z");
  assert.equal(state.hasAnyTableData(current), true);
  assert.equal(state.hasAnyTableLoading(current), false);
});

test("client source contract is Realtime-first with subscription-aware bootstrap and recovery-only polling", () => {
  const hookSource = readFileSync(new URL("../lib/use-dashboard-tables.ts", import.meta.url), "utf8");
  const dashboardSource = readFileSync(new URL("../components/DashboardClient.tsx", import.meta.url), "utf8");
  const transportSource = readFileSync(new URL("../lib/dashboard-supabase.ts", import.meta.url), "utf8");
  const realtimeSource = readFileSync(new URL("../lib/realtime-dashboard-state.ts", import.meta.url), "utf8");

  assert.match(transportSource, /onChange: \(change: DashboardRealtimeChange\) => void/);
  assert.match(transportSource, /newRow: asRecord\(payload\?\.new\)/);
  assert.match(transportSource, /oldRow: asRecord\(payload\?\.old\)/);
  assert.match(hookSource, /const unsubscribe = subscribeToDashboardChanges\(client, \{/);
  assert.match(hookSource, /onChange: applyLiveChange/);
  assert.match(hookSource, /Realtime subscribed; bootstrapping/);
  assert.match(hookSource, /startBootstrap\(true\)/);
  assert.match(hookSource, /BOOTSTRAP_SUBSCRIBE_GRACE_MS = 750/);
  assert.match(hookSource, /window\.setTimeout\(\(\) => startBootstrap\(false\), BOOTSTRAP_SUBSCRIBE_GRACE_MS\)/);
  assert.match(hookSource, /Realtime joined after bootstrap start; reconciling/);
  assert.match(hookSource, /bufferedChangesRef\.current\.push\(change\)/);
  assert.match(hookSource, /replayRealtimeChanges/);
  assert.match(hookSource, /applyRealtimeChangeToTableStates\(current, change\)/);
  assert.doesNotMatch(hookSource, /readDashboardTable\(/);
  assert.doesNotMatch(hookSource, /export const POLL_INTERVAL_MS\b|INVALIDATION_DEBOUNCE_MS|pendingInvalidationsRef|queueTableRefresh/);
  assert.match(hookSource, /connectionState !== "reconnecting" && connectionState !== "recovering"/);
  assert.match(hookSource, /if \(!reconcilingRef\.current\) void requestFullRefresh\("recovery"\)/);
  assert.match(hookSource, /RECOVERY_POLL_INTERVAL_MS = 5_000/);
  assert.match(hookSource, /Realtime reconnected; reconciling/);
  assert.match(hookSource, /void requestFullRefresh\("reconnect"\)/);
  assert.match(hookSource, /fullControllerRef\.current\?\.abort\(\)/);
  assert.match(transportSource, /Promise\.allSettled/);
  assert.match(realtimeSource, /ACTIVITY_LIMIT = 12/);
  assert.doesNotMatch(realtimeSource, /localStorage|sessionStorage|indexedDB/i);
  assert.match(dashboardSource, /Live activity/);
  assert.doesNotMatch(dashboardSource, /Refresh all/);
  assert.match(dashboardSource, /Partial Agent State data/);
  assert.match(dashboardSource, /tableHealthLabel/);
  assert.doesNotMatch(dashboardSource, /data-source.*baseStatus|baseStatus.*data-source/i);
});
