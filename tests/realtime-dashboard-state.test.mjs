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
    ...overrides,
  };
}

test("natural current keys isolate every table and project", () => {
  assert.equal(realtime.realtimeRowKey("current_projects", { project_key: "alpha" }), '["alpha"]');
  assert.equal(realtime.realtimeRowKey("current_agents", { project_key: "alpha", agent: "Agent 2" }), '["alpha","Agent 2"]');
  assert.equal(realtime.realtimeRowKey("current_work", { project_key: "alpha", work_key: "issue-81" }), '["alpha","issue-81"]');
  assert.equal(realtime.realtimeRowKey("current_resources", { project_key: "alpha", resource_key: "src/**" }), '["alpha","src/**"]');
  assert.equal(
    realtime.realtimeRowKey("current_coordination", { project_key: "alpha", sender: "Agent 2", recipient: "Orchestrator" }),
    '["alpha","Agent 2","Orchestrator"]',
  );
  assert.notEqual(
    realtime.realtimeRowKey("current_agents", { project_key: "alpha", agent: "Agent 2" }),
    realtime.realtimeRowKey("current_agents", { project_key: "beta", agent: "Agent 2" }),
  );
});

for (const [table, sample] of Object.entries(samples)) {
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

test("duplicate/replayed inserts and updates are idempotent", () => {
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
  const current = states({
    current_agents: { ...tableState(), hasData: false },
  });
  const result = realtime.applyRealtimeChangeToTableStates(
    current,
    change("current_agents", "INSERT", samples.current_agents.next, null),
  );
  assert.equal(result.applied, false);
  assert.equal(result.states, current);
});

test("live changes preserve an existing stale/error marker until authoritative reconciliation", () => {
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

test("buffered bootstrap/reconciliation events replay in observed order", () => {
  const sample = samples.current_coordination;
  const current = states({ current_coordination: tableState([]) });
  const replayed = realtime.replayRealtimeChanges(current, [
    change("current_coordination", "INSERT", sample.old, null),
    change("current_coordination", "UPDATE", sample.next, sample.old),
    change("current_coordination", "DELETE", null, sample.next),
  ]);
  assert.deepEqual(replayed.current_coordination.rows, []);
});

test("activity feed is bounded, deduplicated and in-memory data only", () => {
  let feed = [];
  for (let index = 0; index < 20; index += 1) {
    feed = realtime.prependActivity(feed, {
      id: `event-${index}`,
      observedAt: `2026-08-21T09:30:${String(index).padStart(2, "0")}Z`,
      kind: "change",
      summary: `event ${index}`,
    });
  }
  assert.equal(feed.length, realtime.ACTIVITY_LIMIT);
  assert.equal(feed[0].id, "event-19");

  const item = realtime.activityFromRealtimeChange(
    change("current_agents", "UPDATE", samples.current_agents.next, samples.current_agents.old),
  );
  assert.equal(item.kind, "change");
  assert.equal(item.table, "current_agents");
  assert.match(item.summary, /agents/);
  assert.doesNotMatch(readFileSync(new URL("../lib/realtime-dashboard-state.ts", import.meta.url), "utf8"), /localStorage|sessionStorage|indexedDB/i);
});
