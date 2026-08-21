import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

function loadCoordinationModel() {
  const source = readFileSync(new URL("../lib/coordination-board.ts", import.meta.url), "utf8");
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
    throw new Error(`Unexpected runtime import while testing coordination board: ${specifier}`);
  });
  return module.exports;
}

const board = loadCoordinationModel();

function agent(projectKey, identity, coordination = [], overrides = {}) {
  return {
    key: `${projectKey}::${identity}`,
    projectKey,
    identity,
    assignment: null,
    assignmentAssignedAt: null,
    prompt: null,
    state: {},
    promptAssignedAt: null,
    lastResponse: null,
    lastReturnedAt: null,
    assignedAt: null,
    baseStatus: "idle",
    blocked: false,
    durationMs: null,
    work: [],
    resources: [],
    coordination,
    identityKind: identity === "Orchestrator" ? "orchestrator" : "agent",
    workSummary: "No current work",
    nextAction: null,
    ...overrides,
    key: `${projectKey}::${identity}`,
    projectKey,
    identity,
    coordination,
  };
}

function coordination(projectKey, sender, recipient, state = {}) {
  return { projectKey, sender, recipient, state };
}

test("multiple sender/recipient pairs in one project remain independent current cells", () => {
  const a = coordination("alpha", "Agent 1", "Orchestrator", { type: "decision", summary: "Need owner choice" });
  const b = coordination("alpha", "Agent 2", "Orchestrator", { status: "blocked", blocker: "Waiting on package" });
  const c = coordination("alpha", "Orchestrator", "Agent 3", { kind: "handoff", next_action: "Continue issue" });

  const rows = [
    agent("alpha", "Agent 1", [a]),
    agent("alpha", "Agent 2", [b]),
    agent("alpha", "Orchestrator", [a, b, c]),
    agent("alpha", "Agent 3", [c]),
  ];

  const deduped = board.dedupeCurrentCoordination(rows);
  const items = board.buildCoordinationItems(deduped, rows);
  assert.equal(deduped.length, 3);
  assert.equal(items.length, 3);
  assert.deepEqual(items.map((item) => item.key), [
    "alpha::Agent 1::Orchestrator",
    "alpha::Agent 2::Orchestrator",
    "alpha::Orchestrator::Agent 3",
  ]);
});

test("same identity names in different projects resolve only to project-local participants", () => {
  const alphaCell = coordination("alpha", "Agent 2", "Orchestrator", { decision: "Alpha decision" });
  const betaCell = coordination("beta", "Agent 2", "Orchestrator", { decision: "Beta decision" });
  const alphaAgent = agent("alpha", "Agent 2", [alphaCell]);
  const alphaOrchestrator = agent("alpha", "Orchestrator", [alphaCell]);
  const betaAgent = agent("beta", "Agent 2", [betaCell]);
  const betaOrchestrator = agent("beta", "Orchestrator", [betaCell]);
  const rows = [betaAgent, alphaAgent, betaOrchestrator, alphaOrchestrator];

  const items = board.buildCoordinationItems(board.dedupeCurrentCoordination(rows), rows);
  assert.equal(items[0].projectKey, "alpha");
  assert.equal(items[0].senderAgent, alphaAgent);
  assert.equal(items[0].recipientAgent, alphaOrchestrator);
  assert.equal(items[0].decision, "Alpha decision");
  assert.equal(items[1].projectKey, "beta");
  assert.equal(items[1].senderAgent, betaAgent);
  assert.equal(items[1].recipientAgent, betaOrchestrator);
  assert.equal(items[1].decision, "Beta decision");
});

test("sender equals recipient produces one current cell even if association repeats", () => {
  const self = coordination("alpha", "Orchestrator", "Orchestrator", { status: "self-check" });
  const rows = [agent("alpha", "Orchestrator", [self, self])];
  const deduped = board.dedupeCurrentCoordination(rows);
  const items = board.buildCoordinationItems(deduped, rows);
  assert.equal(deduped.length, 1);
  assert.equal(items.length, 1);
  assert.equal(items[0].sender, "Orchestrator");
  assert.equal(items[0].recipient, "Orchestrator");
});

test("sparse and unknown coordination JSON remains inspectable without invented fields", () => {
  const cell = coordination("alpha", "Agent 4", "Agent 5", { opaque: { nested: [1, true, "value"] } });
  const rows = [agent("alpha", "Agent 4", [cell]), agent("alpha", "Agent 5", [cell])];
  const [item] = board.buildCoordinationItems(board.dedupeCurrentCoordination(rows), rows);

  assert.equal(item.status, null);
  assert.equal(item.type, null);
  assert.equal(item.summary, null);
  assert.equal(item.objective, null);
  assert.equal(item.decision, null);
  assert.equal(item.blocker, null);
  assert.equal(item.nextAction, null);
  assert.deepEqual(item.state, { opaque: { nested: [1, true, "value"] } });
});

test("common bounded coordination fields are extracted independently", () => {
  const cell = coordination("alpha", "Agent 6", "Orchestrator", {
    status: "blocked",
    type: "owner-decision",
    summary: "Choose release mode",
    objective: "Complete release",
    decision: "Pending owner",
    blocker: "No selected mode",
    next_action: "Select one mode",
  });
  const rows = [agent("alpha", "Agent 6", [cell]), agent("alpha", "Orchestrator", [cell])];
  const [item] = board.buildCoordinationItems(board.dedupeCurrentCoordination(rows), rows);

  assert.equal(item.status, "blocked");
  assert.equal(item.type, "owner-decision");
  assert.equal(item.summary, "Choose release mode");
  assert.equal(item.objective, "Complete release");
  assert.equal(item.decision, "Pending owner");
  assert.equal(item.blocker, "No selected mode");
  assert.equal(item.nextAction, "Select one mode");
});

test("recipient, sender, project and search filters form inbox/outbox routing views", () => {
  const cells = [
    coordination("alpha", "Agent 1", "Orchestrator", { summary: "Alpha inbox" }),
    coordination("alpha", "Orchestrator", "Agent 2", { summary: "Alpha outbox" }),
    coordination("beta", "Agent 3", "Orchestrator", { summary: "Beta inbox" }),
  ];
  const rows = [
    agent("alpha", "Agent 1", [cells[0]]),
    agent("alpha", "Agent 2", [cells[1]]),
    agent("alpha", "Orchestrator", [cells[0], cells[1]]),
    agent("beta", "Agent 3", [cells[2]]),
    agent("beta", "Orchestrator", [cells[2]]),
  ];
  const items = board.buildCoordinationItems(board.dedupeCurrentCoordination(rows), rows);

  assert.deepEqual(
    board.filterCoordinationItems(items, { direction: "inbox", identity: "Orchestrator", project: "all", query: "" })
      .map((item) => item.summary),
    ["Alpha inbox", "Beta inbox"],
  );
  assert.deepEqual(
    board.filterCoordinationItems(items, { direction: "outbox", identity: "Orchestrator", project: "all", query: "" })
      .map((item) => item.summary),
    ["Alpha outbox"],
  );
  assert.deepEqual(
    board.filterCoordinationItems(items, { direction: "all", identity: "Agent 1", project: "beta", query: "inbox" })
      .map((item) => item.summary),
    ["Beta inbox"],
  );
  assert.deepEqual(
    board.filterCoordinationItems(items, { direction: "all", identity: "Orchestrator", project: "alpha", query: "Agent 2" })
      .map((item) => item.summary),
    ["Alpha outbox"],
  );
});

test("removed coordination disappears completely after refreshed current rows", () => {
  const cell = coordination("alpha", "Agent 1", "Orchestrator", { status: "pending" });
  const before = [agent("alpha", "Agent 1", [cell]), agent("alpha", "Orchestrator", [cell])];
  const after = [agent("alpha", "Agent 1", []), agent("alpha", "Orchestrator", [])];

  assert.equal(board.dedupeCurrentCoordination(before).length, 1);
  assert.equal(board.buildCoordinationItems(board.dedupeCurrentCoordination(before), before).length, 1);
  assert.deepEqual(board.dedupeCurrentCoordination(after), []);
  assert.deepEqual(board.buildCoordinationItems(board.dedupeCurrentCoordination(after), after), []);
});

test("counts are canonical by project plus participant identity", () => {
  const items = board.buildCoordinationItems([
    coordination("alpha", "Agent 1", "Orchestrator"),
    coordination("alpha", "Agent 2", "Orchestrator"),
    coordination("beta", "Agent 1", "Orchestrator"),
  ], []);
  assert.deepEqual(board.coordinationCounts(items), {
    total: 3,
    projects: 2,
    senders: 3,
    recipients: 2,
  });
});

test("UI defaults to Orchestrator inbox, provides raw JSON fallback and remains read-only/current-state only", () => {
  const source = readFileSync(new URL("../components/CoordinationBoard.tsx", import.meta.url), "utf8");
  const mountSource = readFileSync(new URL("../components/DashboardClient.tsx", import.meta.url), "utf8");

  assert.match(source, /useState<CoordinationDirection>\("inbox"\)/);
  assert.match(source, /useState\("Orchestrator"\)/);
  assert.match(source, /Resolved\/deleted coordination disappears on refresh; no past routing or local read-state ledger is retained\./);
  assert.match(source, /JSON\.stringify\(rawItem\.state, null, 2\)/);
  assert.match(source, />Inbox</);
  assert.match(source, />Outbox</);
  assert.match(source, /onClick=\{\(\) => onView\(senderKey\)\}/);
  assert.match(source, /onClick=\{\(\) => onView\(recipientKey\)\}/);
  assert.doesNotMatch(source, /resolveCoordination|setCoordination|set_work|set_agent|Reply|Reassign|Acknowledge|localStorage|sessionStorage/i);
  assert.doesNotMatch(source, /history/i);
  assert.match(mountSource, /<Tab value="coordination" label="Coordination" \/>/);
  assert.match(mountSource, /<CoordinationBoard agents=\{advancedRows\} onView=\{setSelectedAgentKey\} \/>/);
  assert.match(mountSource, /advancedScope === "project"/);
});
