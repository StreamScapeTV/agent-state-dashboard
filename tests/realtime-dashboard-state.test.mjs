import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

function loadRealtimeState() {
  const source = readFileSync(new URL("../lib/realtime-dashboard-state.ts", import.meta.url), "utf8");
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
    throw new Error(`Unexpected runtime import while testing Realtime state: ${specifier}`);
  });
  return module.exports;
}

const realtime = loadRealtimeState();
const observedAt = "2026-08-21T09:30:00Z";
const coreTables = [
  "current_projects",
  "current_agents",
  "current_work",
  "current_resources",
  "current_coordination",
];

const samples = {
  current_projects: {
    old: { project_key: "alpha", state: { phase: "old" } },
    next: { project_key: "alpha", state: { phase: "new" } },
  },
  current_agents: {
    old: { project_key: "alpha", agent: "Agent 2", state: { checkpoint: "old" } },
    next: { project_key: "alpha", agent: "Agent 2", state: { checkpoint: "new" } },
  },
  current_work: {
    old: { project_key: "alpha", work_key: "issue-81", agent: "Agent 2", state: { status: "old" } },
    next: { project_key: "alpha", work_key: "issue-81", agent: "Agent 2", state: { status: "new" } },
  },
  current_resources: {
    old: { project_key: "alpha", resource_key: "lib/live.ts", agent: "Agent 2" },
    next: { project_key: "alpha", resource_key: "lib/live.ts", agent: "Agent 3" },
  },
  current_coordination: {
    old: { project_key: "alpha", sender: "Agent 2", recipient: "Orchestrator", state: { status: "old" } },
    next: { project_key: "alpha", sender: "Agent 2", recipient: "Orchestrator", state: { status: "new" } },
  },
};

const issueSample = {
  old: { project_key: "alpha", issue_number: 111, title: "Old", assigned_actor: "Agent 1" },
  next: { project_key: "alpha", issue_number: 111, title: "New", assigned_actor: "Agent 2" },
};
const dependencySample = {
  old: {
    dependent_project_key: "alpha",
    dependent_issue_number: 111,
    blocker_project_key: "beta",
    blocker_issue_number: 71,
    reason: "old",
  },
  next: {
    dependent_project_key: "alpha",
    dependent_issue_number: 111,
    blocker_project_key: "beta",
    blocker_issue_number: 71,
    reason: "new",
  },
};

function change(table, eventType, newRow, oldRow) {
  return { table, eventType, newRow, oldRow, observedAt };
}

function tableState(rows = []) {
  return {
    rows,
    hasData: true,
    loading: false,
    stale: false,
    error: null,
    lastSuccessAt: "2026-08-21T09:29:00Z",
    requestId: 1,
  };
}

function states(overrides = {}) {
  return {
    current_projects: tableState(),
    current_agents: tableState(),
    current_work: tableState(),
    current_resources: tableState(),
    current_coordination: tableState(),
    current_issues: tableState(),
    current_issue_dependencies: tableState(),
    ...overrides,
  };
}

test("natural current keys cover established and additive tables", () => {
  assert.equal(realtime.realtimeRowKey("current_projects", { project_key: "alpha" }), '["alpha"]');
  assert.equal(realtime.realtimeRowKey("current_agents", { project_key: "alpha", agent: "Agent 2" }), '["alpha","Agent 2"]');
  assert.equal(realtime.realtimeRowKey("current_work", { project_key: "alpha", work_key: "issue-81" }), '["alpha","issue-81"]');
  assert.equal(realtime.realtimeRowKey("current_resources", { project_key: "alpha", resource_key: "src/**" }), '["alpha","src/**"]');
  assert.equal(
    realtime.realtimeRowKey("current_coordination", { project_key: "alpha", sender: "Agent 2", recipient: "Orchestrator" }),
    '["alpha","Agent 2","Orchestrator"]',
  );
  assert.equal(realtime.realtimeRowKey("current_issues", issueSample.old), '["alpha","111"]');
  assert.equal(
    realtime.realtimeRowKey("current_issue_dependencies", dependencySample.old),
    '["alpha","111","beta","71"]',
  );
});

for (const table of coreTables) {
  const sample = samples[table];
  test(`${table} INSERT/UPDATE/DELETE applies directly by natural key`, () => {
    const inserted = realtime.applyRealtimeChangeRows([], change(table, "INSERT", sample.old, null));
    assert.equal(inserted.applied, true);
    assert.deepEqual(inserted.rows, [sample.old]);

    const updated = realtime.applyRealtimeChangeRows(inserted.rows, change(table, "UPDATE", sample.next, sample.old));
    assert.equal(updated.applied, true);
    assert.deepEqual(updated.rows, [sample.next]);

    const deleted = realtime.applyRealtimeChangeRows(updated.rows, change(table, "DELETE", null, sample.next));
    assert.equal(deleted.applied, true);
    assert.deepEqual(deleted.rows, []);
  });
}

test("duplicate/replayed core inserts and updates are idempotent", () => {
  const sample = samples.current_work;
  let rows = realtime.applyRealtimeChangeRows([], change("current_work", "INSERT", sample.old, null)).rows;
  rows = realtime.applyRealtimeChangeRows(rows, change("current_work", "INSERT", sample.old, null)).rows;
  assert.equal(rows.length, 1);
  rows = realtime.applyRealtimeChangeRows(rows, change("current_work", "UPDATE", sample.next, sample.old)).rows;
  rows = realtime.applyRealtimeChangeRows(rows, change("current_work", "UPDATE", sample.next, sample.old)).rows;
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0], sample.next);
});

test("direct row changes never fabricate a complete table without bootstrap data", () => {
  const current = states({ current_agents: { ...tableState(), hasData: false } });
  const result = realtime.applyRealtimeChangeToTableStates(
    current,
    change("current_agents", "INSERT", samples.current_agents.next, null),
  );
  assert.equal(result.applied, false);
  assert.equal(result.states, current);
});

test("live core changes preserve an existing stale/error marker until authoritative reconciliation", () => {
  const current = states({
    current_resources: {
      ...tableState([samples.current_resources.old]),
      stale: true,
      error: "recovery read failed",
    },
  });
  const result = realtime.applyRealtimeChangeToTableStates(
    current,
    change("current_resources", "UPDATE", samples.current_resources.next, samples.current_resources.old),
  );
  assert.equal(result.applied, true);
  assert.equal(result.states.current_resources.stale, true);
  assert.equal(result.states.current_resources.error, "recovery read failed");
  assert.deepEqual(result.states.current_resources.rows, [samples.current_resources.next]);
});

test("buffered core bootstrap/reconciliation events replay in observed order", () => {
  const sample = samples.current_coordination;
  const current = states({ current_coordination: tableState([]) });
  const replayed = realtime.replayRealtimeChanges(current, [
    change("current_coordination", "INSERT", sample.old, null),
    change("current_coordination", "UPDATE", sample.next, sample.old),
    change("current_coordination", "DELETE", null, sample.next),
  ]);
  assert.deepEqual(replayed.current_coordination.rows, []);
});

test("buffered core live update wins over an older reconciliation snapshot", () => {
  const sample = samples.current_agents;
  const staleSnapshot = states({ current_agents: tableState([sample.old]) });
  const converged = realtime.replayRealtimeChanges(staleSnapshot, [
    change("current_agents", "UPDATE", sample.next, sample.old),
  ]);
  assert.deepEqual(converged.current_agents.rows, [sample.next]);
});

test("activity feed derives context for additive issue/dependency invalidations without retaining payloads", () => {
  const issueItem = realtime.activityFromRealtimeChange(
    change("current_issues", "UPDATE", issueSample.next, issueSample.old),
  );
  assert.equal(issueItem.projectKey, "alpha");
  assert.deepEqual(issueItem.identities, ["Agent 2"]);
  assert.equal(issueItem.rowKey, '["alpha","111"]');
  assert.equal(Object.hasOwn(issueItem, "newRow"), false);
  assert.equal(Object.hasOwn(issueItem, "oldRow"), false);

  const dependencyItem = realtime.activityFromRealtimeChange(
    change("current_issue_dependencies", "UPDATE", dependencySample.next, dependencySample.old),
  );
  assert.equal(dependencyItem.projectKey, "alpha");
  assert.equal(dependencyItem.rowKey, '["alpha","111","beta","71"]');
});

test("activity feed remains bounded and preserves established actor context", () => {
  let feed = [];
  for (let index = 0; index < realtime.ACTIVITY_LIMIT + 8; index += 1) {
    feed = realtime.prependActivity(feed, {
      id: `event-${index}`,
      observedAt: `2026-08-21T09:${String(Math.floor(index / 60) + 30).padStart(2, "0")}:${String(index % 60).padStart(2, "0")}Z`,
      kind: "change",
      summary: `event ${index}`,
    });
  }
  assert.equal(feed.length, realtime.ACTIVITY_LIMIT);
  assert.equal(feed[0].id, `event-${realtime.ACTIVITY_LIMIT + 7}`);

  const coordinationItem = realtime.activityFromRealtimeChange(
    change("current_coordination", "UPDATE", samples.current_coordination.next, samples.current_coordination.old),
  );
  assert.equal(coordinationItem.projectKey, "alpha");
  assert.deepEqual(coordinationItem.identities, ["Agent 2", "Orchestrator"]);

  assert.doesNotMatch(readFileSync(new URL("../lib/realtime-dashboard-state.ts", import.meta.url), "utf8"), /localStorage|sessionStorage|indexedDB/i);
});
