import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

function loadDashboardModel() {
  const source = readFileSync(new URL("../lib/dashboard-model.ts", import.meta.url), "utf8");
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
    throw new Error(`Unexpected runtime import while testing dashboard model: ${specifier}`);
  });
  return module.exports;
}

const model = loadDashboardModel();

function agent(overrides = {}) {
  return {
    projectKey: "demo",
    identity: "Agent 2",
    prompt: null,
    state: {},
    promptAssignedAt: null,
    lastResponse: null,
    lastReturnedAt: null,
    ...overrides,
  };
}

function work(state = {}) {
  return [{ projectKey: "demo", identity: "Agent 2", workKey: "issue-1", state }];
}

test("status derivation covers null, assigned, mid-work, returned, reassigned and idle", () => {
  assert.equal(model.deriveBaseStatus(agent(), []), "idle");
  assert.equal(
    model.deriveBaseStatus(agent({ prompt: "Pre-observability retained prompt" }), []),
    "idle",
    "retained prompt text without an authoritative assignment timestamp must not fabricate working state",
  );
  assert.equal(
    model.deriveBaseStatus(agent({ promptAssignedAt: "2026-08-12T00:00:00Z" }), []),
    "working",
  );
  assert.equal(
    model.deriveBaseStatus(
      agent({ promptAssignedAt: "2026-08-12T00:10:00Z", lastReturnedAt: "2026-08-12T00:05:00Z" }),
      work({ status: "implementing" }),
    ),
    "working",
  );
  assert.equal(
    model.deriveBaseStatus(
      agent({ promptAssignedAt: "2026-08-12T00:00:00Z", lastReturnedAt: "2026-08-12T00:04:00Z" }),
      work({ status: "done" }),
    ),
    "returned",
  );
  assert.equal(
    model.deriveBaseStatus(
      agent({ promptAssignedAt: "2026-08-12T00:12:00Z", lastReturnedAt: "2026-08-12T00:04:00Z" }),
      work(),
    ),
    "working",
  );
  assert.equal(model.deriveBaseStatus(agent(), work()), "working");
});

test("blocked is an overlay and can coexist with a returned chat", () => {
  const snapshot = {
    projects: [{ projectKey: "demo", state: { phase: "build" } }],
    agents: [agent({
      prompt: "Finish issue",
      promptAssignedAt: "2026-08-12T00:00:00Z",
      lastReturnedAt: "2026-08-12T00:05:00Z",
      lastResponse: "Waiting for CI",
      state: { status: "blocked", blocker: "CI credential" },
    })],
    work: work({ next_action: "Retry deployment" }),
    resources: [],
    coordination: [],
    refreshedAt: "2026-08-12T00:05:00Z",
    missingTables: [],
  };
  const [row] = model.buildAgentRows(snapshot, Date.parse("2026-08-12T00:10:00Z"));
  assert.equal(row.baseStatus, "returned");
  assert.equal(row.blocked, true);
  assert.equal(model.statusLabel(row), "Blocked · returned");
  assert.equal(model.attentionRank(row), 0);
});

test("duration stays live while working and freezes at return", () => {
  const assigned = "2026-08-12T00:00:00Z";
  const returned = "2026-08-12T00:05:30Z";
  assert.equal(
    model.durationMs(assigned, null, "working", Date.parse("2026-08-12T00:02:00Z")),
    120_000,
  );
  assert.equal(
    model.durationMs(assigned, returned, "returned", Date.parse("2026-08-12T01:00:00Z")),
    330_000,
  );
  assert.equal(model.formatDuration(330_000), "5m 30s");
});

test("snapshot normalization accepts the five authority-table contract", () => {
  const snapshot = model.normalizeSnapshot({
    current_projects: [{ project_key: "demo", state: { phase: "build", objective: "Ship console" } }],
    current_agents: [{
      project_key: "demo",
      agent: "Agent 2",
      prompt: "Implement UI",
      state: { checkpoint: "grid" },
      prompt_assigned_at: "2026-08-12T00:00:00Z",
      last_response: null,
      last_returned_at: null,
    }],
    current_work: [{ project_key: "demo", work_key: "issue-6", agent: "Agent 2", state: { next_action: "Open PR" } }],
    current_resources: [{ project_key: "demo", resource_key: "components/**", agent: "Agent 2" }],
    current_coordination: [{ project_key: "demo", sender: "Agent 2", recipient: "Orchestrator", state: { status: "review" } }],
    refreshed_at: "2026-08-12T00:01:00Z",
  });
  assert.deepEqual(snapshot.missingTables, []);
  assert.equal(snapshot.projects[0].projectKey, "demo");
  assert.equal(snapshot.agents[0].identity, "Agent 2");
  assert.equal(snapshot.work[0].workKey, "issue-6");
  assert.equal(snapshot.resources[0].resourceKey, "components/**");
  assert.equal(snapshot.coordination[0].recipient, "Orchestrator");
});

test("project summaries preserve returned attention counts and current project fields", () => {
  const snapshot = model.normalizeSnapshot({
    tables: {
      projects: [{ projectKey: "demo", state: { phase: "validation", objective: "Ship console", next_action: "Merge" } }],
      agents: [
        { projectKey: "demo", identity: "Agent 1", prompt: "a", promptAssignedAt: "2026-08-12T00:00:00Z", lastReturnedAt: "2026-08-12T00:01:00Z", lastResponse: "done", state: {} },
        { projectKey: "demo", identity: "Agent 2", prompt: "b", promptAssignedAt: "2026-08-12T00:02:00Z", lastReturnedAt: null, lastResponse: null, state: {} },
      ],
      work: [],
      resources: [],
      coordination: [],
    },
  });
  const rows = model.buildAgentRows(snapshot, Date.parse("2026-08-12T00:03:00Z"));
  const [summary] = model.buildProjectSummaries(snapshot, rows);
  assert.equal(summary.returned, 1);
  assert.equal(summary.working, 1);
  assert.equal(summary.phase, "validation");
  assert.equal(summary.nextAction, "Merge");
});
