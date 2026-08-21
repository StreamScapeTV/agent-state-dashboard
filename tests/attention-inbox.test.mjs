import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

function loadAttentionInboxModel() {
  const source = readFileSync(new URL("../lib/attention-inbox.ts", import.meta.url), "utf8");
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
    throw new Error(`Unexpected runtime import while testing attention inbox: ${specifier}`);
  });
  return module.exports;
}

const inbox = loadAttentionInboxModel();

function row(identity, overrides = {}) {
  const projectKey = overrides.projectKey ?? "demo";
  return {
    key: `${projectKey}::${identity}`,
    projectKey,
    identity,
    assignment: { instructions: `Current assignment for ${identity}`, context: null },
    assignmentAssignedAt: "2026-08-21T04:00:00Z",
    prompt: null,
    state: {},
    promptAssignedAt: null,
    lastResponse: null,
    lastReturnedAt: null,
    assignedAt: "2026-08-21T04:00:00Z",
    baseStatus: "working",
    blocked: false,
    blockerCues: [],
    durationMs: 60_000,
    work: [],
    resources: [],
    coordination: [],
    identityKind: "agent",
    workSummary: "Current work",
    nextAction: "Continue",
    ...overrides,
    projectKey,
    key: `${projectKey}::${identity}`,
    identity,
  };
}

function coordination(sender, recipient = "Orchestrator", state = { status: "decision" }) {
  return { projectKey: "demo", sender, recipient, state };
}

test("queue ranks returned blocked and actionable coordination above ordinary returned", () => {
  const returnedBlocked = row("Agent 1", {
    baseStatus: "returned",
    blocked: true,
    lastReturnedAt: "2026-08-21T04:10:00Z",
  });
  const coordinatedWorking = row("Agent 2", {
    coordination: [coordination("Agent 2")],
  });
  const blockedWorking = row("Agent 3", { blocked: true });
  const ordinaryReturned = row("Agent 4", {
    baseStatus: "returned",
    lastReturnedAt: "2026-08-21T04:10:00Z",
  });
  const olderWorking = row("Agent 5", { durationMs: 900_000 });
  const newerWorking = row("Agent 6", { durationMs: 120_000 });

  const queue = inbox.buildAttentionQueue([
    newerWorking,
    ordinaryReturned,
    blockedWorking,
    olderWorking,
    coordinatedWorking,
    returnedBlocked,
  ]);

  assert.deepEqual(queue.map((item) => item.row.identity), [
    "Agent 1",
    "Agent 2",
    "Agent 3",
    "Agent 4",
    "Agent 5",
    "Agent 6",
  ]);
  assert.deepEqual(queue.map((item) => item.rank), [0, 1, 2, 3, 4, 4]);
});

test("coordination to Orchestrator appears once on its sender actor", () => {
  const inbound = coordination("Agent 2", "Orchestrator", { status: "needs-owner" });
  const sender = row("Agent 2", { coordination: [inbound] });
  const recipient = row("Orchestrator", {
    identityKind: "orchestrator",
    baseStatus: "idle",
    assignedAt: null,
    assignmentAssignedAt: null,
    durationMs: null,
    coordination: [inbound],
  });

  const queue = inbox.buildAttentionQueue([recipient, sender]);
  assert.equal(queue.length, 1);
  assert.equal(queue[0].row.identity, "Agent 2");
  assert.equal(queue[0].actionableCoordination.length, 1);
  assert.equal(queue[0].actionableCoordination[0].recipient, "Orchestrator");
});

test("self coordination and duplicate current rows do not duplicate queue coordination", () => {
  const self = coordination("Orchestrator", "Orchestrator", { status: "self-check" });
  const actor = row("Orchestrator", {
    identityKind: "orchestrator",
    coordination: [self, self],
  });

  const [item] = inbox.buildAttentionQueue([actor]);
  assert.equal(item.actionableCoordination.length, 1);
  assert.equal(item.actionableCoordination[0].sender, "Orchestrator");
  assert.equal(item.actionableCoordination[0].recipient, "Orchestrator");
});

test("working age affects only deterministic ordering and never authoritative status", () => {
  const older = row("Agent 1", { durationMs: 3_600_000, baseStatus: "working" });
  const newer = row("Agent 2", { durationMs: 30_000, baseStatus: "working" });

  const queue = inbox.buildAttentionQueue([newer, older]);
  assert.deepEqual(queue.map((item) => item.row.identity), ["Agent 1", "Agent 2"]);
  assert.equal(queue[0].row, older);
  assert.equal(queue[0].row.baseStatus, "working");
  assert.equal(queue[1].row.baseStatus, "working");
  assert.equal(older.blocked, false);
  assert.equal(newer.blocked, false);
});

test("returned actors keep current work and resource ownership visible without changing returned state", () => {
  const returned = row("Agent 7", {
    baseStatus: "returned",
    lastReturnedAt: "2026-08-21T04:10:00Z",
    work: [{ projectKey: "demo", identity: "Agent 7", workKey: "issue-77", state: { status: "review" } }],
    resources: [{ projectKey: "demo", identity: "Agent 7", resourceKey: "components/**" }],
  });

  const [item] = inbox.buildAttentionQueue([returned]);
  assert.equal(item.row.baseStatus, "returned");
  assert.equal(item.row.work.length, 1);
  assert.equal(item.row.resources.length, 1);
  assert.equal(item.rank, 3);
});

test("idle actors without blockers or actionable coordination produce an empty queue", () => {
  const idle = row("Agent 8", {
    baseStatus: "idle",
    assignment: null,
    assignmentAssignedAt: null,
    assignedAt: null,
    durationMs: null,
  });
  assert.deepEqual(inbox.buildAttentionQueue([idle]), []);
});

test("selected coordination recipient is respected without mutating actor state", () => {
  const actor = row("Agent 9", {
    coordination: [
      coordination("Agent 9", "Orchestrator", { status: "owner" }),
      coordination("Agent 9", "Agent 5", { status: "peer" }),
    ],
  });

  const [ownerItem] = inbox.buildAttentionQueue([actor], "Orchestrator");
  const [peerItem] = inbox.buildAttentionQueue([actor], "Agent 5");
  assert.equal(ownerItem.actionableCoordination.length, 1);
  assert.equal(ownerItem.actionableCoordination[0].recipient, "Orchestrator");
  assert.equal(peerItem.actionableCoordination.length, 1);
  assert.equal(peerItem.actionableCoordination[0].recipient, "Agent 5");
  assert.equal(actor.baseStatus, "working");
});

test("project and identity filters produce the bounded queue input", () => {
  const rows = [
    row("Agent 1", { projectKey: "alpha" }),
    row("Codex 2", { projectKey: "alpha", identityKind: "codex" }),
    row("Agent 3", { projectKey: "beta" }),
  ];

  assert.deepEqual(
    inbox.filterAttentionRows(rows, "alpha", "all").map((item) => item.identity),
    ["Agent 1", "Codex 2"],
  );
  assert.deepEqual(
    inbox.filterAttentionRows(rows, "all", "codex").map((item) => item.identity),
    ["Codex 2"],
  );
  assert.deepEqual(
    inbox.filterAttentionRows(rows, "beta", "agent").map((item) => item.identity),
    ["Agent 3"],
  );
  assert.deepEqual(inbox.filterAttentionRows(rows, "missing", "all"), []);
});

test("UI keeps source staleness outside the focused attention view and links to existing detail inspection", () => {
  const source = readFileSync(new URL("../components/AttentionInbox.tsx", import.meta.url), "utf8");
  const dashboardSource = readFileSync(new URL("../components/DashboardClient.tsx", import.meta.url), "utf8");

  assert.match(source, /filterAttentionRows\(rows, projectFilter, identityFilter\)/);
  assert.match(source, /Current-state triage only\. Assignment age is informational and never changes authoritative status\./);
  assert.match(source, /buildAttentionQueue\(filteredRows, recipient\)/);
  assert.match(source, /onClick=\{\(\) => onView\(row\.key\)\}/);
  assert.match(source, /\{row\.work\.length\} work · \{row\.resources\.length\} resources/);
  assert.match(source, /row\.blockerCues\[0\]\?\.reason \?\? "Blocked reason not recorded"/);
  assert.doesNotMatch(source, /DashboardLiveState|effectiveLiveState|"stale"|"failed"|timeout/i);
  assert.doesNotMatch(source, /WorkAssignmentBoard|CoordinationBoard|ResourcesCapacityBoard/);

  assert.match(dashboardSource, /<AttentionInbox/);
  assert.match(dashboardSource, /rows=\{advancedRows\}/);
  assert.match(dashboardSource, /projectFilter="all"/);
  assert.match(dashboardSource, /identityFilter="all"/);
  assert.match(dashboardSource, /selectedProjectKey !== "all"/);
  assert.match(dashboardSource, /advancedScope === "project"/);
  assert.match(dashboardSource, /connectionState === "live" && freshness === "fresh"/);
});
