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

function typedAgent(overrides = {}) {
  return {
    projectKey: "demo",
    identity: "Agent 2",
    assignment: { instructions: "Implement issue #75", context: { priority: "P1" } },
    assignmentAssignedAt: "2026-08-21T04:10:00Z",
    prompt: "Legacy compatibility prompt",
    promptAssignedAt: "2026-08-21T04:00:00Z",
    state: {},
    lastResponse: null,
    lastReturnedAt: null,
    ...overrides,
  };
}

function snapshotFor(agent) {
  return {
    projects: [],
    agents: [agent],
    work: [],
    resources: [],
    coordination: [],
    refreshedAt: "2026-08-21T04:12:00Z",
    missingTables: [],
  };
}

test("normalization preserves typed assignment instructions, context and authoritative timestamp", () => {
  const instructions = "  Keep assignment framing whitespace\nExactly as stored  ";
  const prompt = " compatibility prompt stays separate ";
  const normalized = model.normalizeSnapshot({
    current_projects: [],
    current_agents: [{
      project_key: "demo",
      agent: "Agent 2",
      assignment: {
        instructions,
        context: { priority: "P1", nested: { release: "1.0.0" }, flags: [true, false] },
      },
      assignment_assigned_at: " 2026-08-21T04:10:00Z ",
      prompt,
      prompt_assigned_at: "2026-08-21T04:00:00Z",
      state: {},
      last_response: null,
      last_returned_at: null,
    }],
    current_work: [],
    current_resources: [],
    current_coordination: [],
  });

  const [agent] = normalized.agents;
  assert.equal(agent.assignment.instructions, instructions);
  assert.deepEqual(agent.assignment.context, {
    priority: "P1",
    nested: { release: "1.0.0" },
    flags: [true, false],
  });
  assert.equal(agent.assignmentAssignedAt, "2026-08-21T04:10:00Z");
  assert.equal(agent.prompt, prompt);
  assert.equal(agent.promptAssignedAt, "2026-08-21T04:00:00Z");
  assert.equal("assignmentHistory" in agent, false);
  assert.equal("runId" in agent, false);
  assert.equal("sessionId" in agent, false);
});

test("typed assignment timing is primary even when compatibility prompt timing differs", () => {
  const agent = typedAgent({
    assignmentAssignedAt: "2026-08-21T04:10:00Z",
    promptAssignedAt: "2026-08-21T04:00:00Z",
    lastReturnedAt: "2026-08-21T04:05:00Z",
  });

  assert.equal(model.currentAssignedAt(agent), "2026-08-21T04:10:00Z");
  assert.equal(model.deriveBaseStatus(agent, []), "working");

  const [row] = model.buildAgentRows(snapshotFor(agent), Date.parse("2026-08-21T04:15:00Z"));
  assert.equal(row.assignedAt, "2026-08-21T04:10:00Z");
  assert.equal(row.baseStatus, "working");
  assert.equal(row.durationMs, 300_000);
});

test("typed assignment newer than prior return represents reassignment", () => {
  const agent = typedAgent({
    assignment: { instructions: "New assignment", context: null },
    assignmentAssignedAt: "2026-08-21T04:20:00Z",
    prompt: "Old compatibility projection",
    promptAssignedAt: "2026-08-21T04:00:00Z",
    lastResponse: "Previous assignment returned",
    lastReturnedAt: "2026-08-21T04:15:00Z",
  });

  assert.equal(model.deriveBaseStatus(agent, []), "working");
  const [row] = model.buildAgentRows(snapshotFor(agent), Date.parse("2026-08-21T04:22:00Z"));
  assert.equal(row.assignedAt, "2026-08-21T04:20:00Z");
  assert.equal(row.baseStatus, "working");
  assert.equal(row.durationMs, 120_000);
});

test("typed assignment return equality and later return are both returned", () => {
  const equal = typedAgent({ lastReturnedAt: "2026-08-21T04:10:00Z" });
  const later = typedAgent({ lastReturnedAt: "2026-08-21T04:11:00Z" });
  assert.equal(model.deriveBaseStatus(equal, []), "returned");
  assert.equal(model.deriveBaseStatus(later, []), "returned");
});

test("typed assignment works without compatibility prompt and legacy rows still fall back", () => {
  const typedOnly = typedAgent({
    prompt: null,
    promptAssignedAt: null,
    assignment: { instructions: "Typed only", context: { source: "assignment" } },
    assignmentAssignedAt: "2026-08-21T04:10:00Z",
  });
  assert.equal(model.currentAssignedAt(typedOnly), "2026-08-21T04:10:00Z");
  assert.equal(model.deriveBaseStatus(typedOnly, []), "working");

  const legacy = typedAgent({
    assignment: null,
    assignmentAssignedAt: null,
    prompt: "Legacy assignment",
    promptAssignedAt: "2026-08-21T04:00:00Z",
    lastReturnedAt: "2026-08-21T04:02:00Z",
  });
  assert.equal(model.currentAssignedAt(legacy), "2026-08-21T04:00:00Z");
  assert.equal(model.deriveBaseStatus(legacy, []), "returned");
});

test("progressive UI keeps typed assignment primary, compatibility diagnostics and searchable work context", () => {
  const source = readFileSync(new URL("../components/DashboardClient.tsx", import.meta.url), "utf8");
  const overviewSource = readFileSync(new URL("../components/ProjectOverview.tsx", import.meta.url), "utf8");
  const workSource = readFileSync(new URL("../components/WorkAssignmentBoard.tsx", import.meta.url), "utf8");

  assert.match(source, /<LongText label="Current assignment" value=\{row\.assignment\?\.instructions \?\? null\} \/>/);
  assert.match(source, /Assignment context/);
  assert.match(source, /<JsonPanel value=\{row\.assignment\.context\} \/>/);
  assert.match(source, /<LongText label="Compatibility prompt" value=\{row\.prompt\} \/>/);
  assert.match(source, /Assigned: \{displayTime\(row\.assignedAt\)\}/);
  assert.match(overviewSource, /const instructions = row\.assignment\?\.instructions\.trim\(\)/);
  assert.match(overviewSource, /return instructions\.split/);
  assert.match(workSource, /Search work key, assignment, state, next action…/);
  assert.doesNotMatch(`${source}\n${overviewSource}\n${workSource}`, /assignmentHistory|runId|sessionId/);
});
