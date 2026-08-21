import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

function loadActivityLogModel() {
  const source = readFileSync(new URL("../lib/activity-log.ts", import.meta.url), "utf8");
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
    throw new Error(`Unexpected runtime import while testing activity log: ${specifier}`);
  });
  return module.exports;
}

const activity = loadActivityLogModel();

function item(overrides = {}) {
  return {
    id: "base",
    observedAt: "2026-08-21T10:00:00Z",
    kind: "change",
    summary: "base event",
    table: "current_agents",
    eventType: "UPDATE",
    projectKey: "alpha",
    identities: ["Agent 1"],
    rowKey: '["alpha","Agent 1"]',
    ...overrides,
  };
}

const items = [
  item({ id: "alpha-new", observedAt: "2026-08-21T10:03:00Z", summary: "alpha agent updated" }),
  item({
    id: "alpha-coordination",
    observedAt: "2026-08-21T10:02:00Z",
    table: "current_coordination",
    eventType: "INSERT",
    identities: ["Agent 2", "Orchestrator"],
    rowKey: '["alpha","Agent 2","Orchestrator"]',
    summary: "alpha coordination created",
  }),
  item({
    id: "beta-work",
    observedAt: "2026-08-21T10:01:00Z",
    table: "current_work",
    eventType: "DELETE",
    projectKey: "beta",
    identities: ["Agent 3"],
    rowKey: '["beta","issue-8"]',
    summary: "beta work removed",
  }),
  {
    id: "global-connection",
    observedAt: "2026-08-21T10:04:00Z",
    kind: "connection",
    summary: "Realtime connected",
  },
  {
    id: "global-reconcile",
    observedAt: "2026-08-21T09:59:00Z",
    kind: "reconcile",
    summary: "Reconciled current tables",
  },
];

const baseFilters = {
  projectKey: null,
  identity: "all",
  kind: "all",
  table: "all",
  eventType: "all",
};

test("activity log is newest-first and project scope keeps matching changes plus global session events", () => {
  const global = activity.filterActivityLog(items, baseFilters);
  assert.deepEqual(global.map((entry) => entry.id), [
    "global-connection",
    "alpha-new",
    "alpha-coordination",
    "beta-work",
    "global-reconcile",
  ]);

  const alpha = activity.filterActivityLog(items, { ...baseFilters, projectKey: "alpha" });
  assert.deepEqual(alpha.map((entry) => entry.id), [
    "global-connection",
    "alpha-new",
    "alpha-coordination",
    "global-reconcile",
  ]);
  assert.equal(alpha.some((entry) => entry.id === "beta-work"), false);
});

test("identity, kind, table and change-type filters are independent and deterministic", () => {
  assert.deepEqual(
    activity.filterActivityLog(items, { ...baseFilters, identity: "Agent 1" }).map((entry) => entry.id),
    ["alpha-new"],
  );
  assert.deepEqual(
    activity.filterActivityLog(items, { ...baseFilters, kind: "connection" }).map((entry) => entry.id),
    ["global-connection"],
  );
  assert.deepEqual(
    activity.filterActivityLog(items, { ...baseFilters, table: "current_coordination" }).map((entry) => entry.id),
    ["alpha-coordination"],
  );
  assert.deepEqual(
    activity.filterActivityLog(items, { ...baseFilters, eventType: "DELETE" }).map((entry) => entry.id),
    ["beta-work"],
  );
});

test("identity options inherit selected project scope and sort naturally", () => {
  assert.deepEqual(activity.activityIdentityOptions(items, "alpha"), ["Agent 1", "Agent 2", "Orchestrator"]);
  assert.deepEqual(activity.activityIdentityOptions(items, "beta"), ["Agent 3"]);
  assert.deepEqual(activity.activityIdentityOptions(items, null), ["Agent 1", "Agent 2", "Agent 3", "Orchestrator"]);
});

test("Logs / Activity UI is session-only, filtered, expandable and separate from health telemetry", () => {
  const source = readFileSync(new URL("../components/ActivityLogView.tsx", import.meta.url), "utf8");
  const dashboardSource = readFileSync(new URL("../components/DashboardClient.tsx", import.meta.url), "utf8");
  const realtimeSource = readFileSync(new URL("../lib/realtime-dashboard-state.ts", import.meta.url), "utf8");

  assert.match(source, /Logs \/ Activity/);
  assert.match(source, /Session-only live activity/);
  assert.match(source, /Reloading clears this view/);
  assert.match(source, /snapshots are not backfilled or presented as historical audit events/);
  assert.match(source, /<InputLabel>Identity<\/InputLabel>/);
  assert.match(source, /<InputLabel>Event kind<\/InputLabel>/);
  assert.match(source, /<InputLabel>Table<\/InputLabel>/);
  assert.match(source, /<InputLabel>Change type<\/InputLabel>/);
  assert.match(source, /<Accordion/);
  assert.match(source, /No raw row payload or durable event history is retained by this view/);

  assert.match(dashboardSource, /<Tab value="logs" label="Logs \/ Activity" \/>/);
  assert.match(dashboardSource, /<ActivityLogView activities=\{activities\} projectScope=\{rawProjectScope\} \/>/);
  assert.doesNotMatch(dashboardSource, /Recent live activity/);
  assert.doesNotMatch(`${source}\n${dashboardSource}\n${realtimeSource}`, /localStorage|sessionStorage|indexedDB/i);
});
