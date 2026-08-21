import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

function loadWorkBoardModel() {
  const source = readFileSync(new URL("../lib/work-assignment-board.ts", import.meta.url), "utf8");
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
    throw new Error(`Unexpected runtime import while testing work board: ${specifier}`);
  });
  return module.exports;
}

const board = loadWorkBoardModel();

function agent(projectKey, identity, overrides = {}) {
  return {
    key: `${projectKey}::${identity}`,
    projectKey,
    identity,
    assignment: {
      instructions: `Assignment for ${projectKey}/${identity}\nSecond line`,
      context: { priority: projectKey === "alpha" ? "P1" : "P2" },
    },
    assignmentAssignedAt: "2026-08-21T04:00:00Z",
    prompt: null,
    state: {},
    promptAssignedAt: null,
    lastResponse: null,
    lastReturnedAt: null,
    assignedAt: "2026-08-21T04:00:00Z",
    baseStatus: "working",
    blocked: false,
    durationMs: 300_000,
    work: [],
    resources: [],
    coordination: [],
    identityKind: "agent",
    workSummary: "Agent summary",
    nextAction: null,
    ...overrides,
    key: `${projectKey}::${identity}`,
    projectKey,
    identity,
  };
}

function work(projectKey, identity, workKey, state = {}) {
  return { projectKey, identity, workKey, state };
}

test("one actor with multiple current work rows remains explicit", () => {
  const owner = agent("alpha", "Agent 2");
  const rows = [
    work("alpha", "Agent 2", "issue-101", { objective: "First objective", next_action: "Review" }),
    work("alpha", "Agent 2", "issue-102", { objective: "Second objective", status: "testing" }),
  ];

  const items = board.buildWorkBoardItems(rows, [owner]);
  assert.equal(items.length, 2);
  assert.deepEqual(items.map((item) => item.workKey), ["issue-101", "issue-102"]);
  assert.deepEqual(items.map((item) => item.workSummary), ["First objective", "Second objective"]);
  assert.equal(items[0].owner, owner);
  assert.equal(items[1].owner, owner);
});

test("same identity in different projects is isolated by exact project identity", () => {
  const alpha = agent("alpha", "Agent 2", {
    assignment: { instructions: "Alpha assignment", context: { lane: "alpha" } },
  });
  const beta = agent("beta", "Agent 2", {
    assignment: { instructions: "Beta assignment", context: { lane: "beta" } },
  });

  const items = board.buildWorkBoardItems([
    work("beta", "Agent 2", "beta-work", { status: "queued" }),
    work("alpha", "Agent 2", "alpha-work", { status: "active" }),
  ], [alpha, beta]);

  assert.equal(items[0].projectKey, "alpha");
  assert.equal(items[0].owner, alpha);
  assert.equal(items[0].assignmentExcerpt, "Alpha assignment");
  assert.deepEqual(items[0].assignmentContext, { lane: "alpha" });
  assert.equal(items[1].projectKey, "beta");
  assert.equal(items[1].owner, beta);
  assert.equal(items[1].assignmentExcerpt, "Beta assignment");
});

test("returned owner with active work remains returned with ownership counts", () => {
  const owner = agent("alpha", "Agent 4", {
    baseStatus: "returned",
    lastReturnedAt: "2026-08-21T04:04:00Z",
    durationMs: 240_000,
    resources: [
      { projectKey: "alpha", identity: "Agent 4", resourceKey: "components/a" },
      { projectKey: "alpha", identity: "Agent 4", resourceKey: "components/b" },
    ],
    coordination: [
      { projectKey: "alpha", sender: "Agent 4", recipient: "Orchestrator", state: { status: "review" } },
    ],
  });

  const [item] = board.buildWorkBoardItems([
    work("alpha", "Agent 4", "issue-104", { status: "ready" }),
  ], [owner]);

  assert.equal(item.ownerStatus, "returned");
  assert.equal(item.resourceCount, 2);
  assert.equal(item.coordinationCount, 1);
  assert.equal(item.durationMs, 240_000);
  assert.equal(item.lastReturnedAt, "2026-08-21T04:04:00Z");
});

test("blocked owner applies to each independent current work row", () => {
  const owner = agent("alpha", "Agent 5", { blocked: true });
  const items = board.buildWorkBoardItems([
    work("alpha", "Agent 5", "one", { objective: "One" }),
    work("alpha", "Agent 5", "two", { objective: "Two" }),
  ], [owner]);

  assert.equal(items.length, 2);
  assert.ok(items.every((item) => item.blocked));
  assert.ok(items.every((item) => item.ownerStatus === "working"));
});

test("sparse or unknown work JSON remains inspectable without invented semantics", () => {
  const [item] = board.buildWorkBoardItems([
    work("alpha", "Agent 6", "opaque-key", { arbitrary: { nested: true } }),
  ], []);

  assert.equal(item.owner, null);
  assert.equal(item.ownerStatus, "unknown");
  assert.equal(item.identityKind, "unknown");
  assert.equal(item.workSummary, "Current work");
  assert.equal(item.workStatus, null);
  assert.equal(item.nextAction, null);
  assert.equal(item.assignmentExcerpt, null);
  assert.deepEqual(item.work.state, { arbitrary: { nested: true } });
});

test("search and filters cover project, owner, kind, status, work key and state text", () => {
  const returned = agent("alpha", "Agent 1", {
    baseStatus: "returned",
    lastReturnedAt: "2026-08-21T04:05:00Z",
  });
  const codex = agent("beta", "Codex 2", {
    identityKind: "codex",
    assignment: { instructions: "Refactor dashboard model", context: { priority: "P1" } },
  });
  const items = board.buildWorkBoardItems([
    work("alpha", "Agent 1", "release-proof", { status: "review", next_action: "Close issue" }),
    work("beta", "Codex 2", "refactor-22", { objective: "Split model", checkpoint: "Tests next" }),
  ], [returned, codex]);

  const base = { project: "all", identity: "all", identityKind: "all", ownerStatus: "all", query: "" };
  assert.deepEqual(board.filterWorkBoardItems(items, { ...base, project: "alpha" }).map((item) => item.workKey), ["release-proof"]);
  assert.deepEqual(board.filterWorkBoardItems(items, { ...base, identity: "Codex 2" }).map((item) => item.workKey), ["refactor-22"]);
  assert.deepEqual(board.filterWorkBoardItems(items, { ...base, identityKind: "codex" }).map((item) => item.workKey), ["refactor-22"]);
  assert.deepEqual(board.filterWorkBoardItems(items, { ...base, ownerStatus: "returned" }).map((item) => item.workKey), ["release-proof"]);
  assert.deepEqual(board.filterWorkBoardItems(items, { ...base, query: "close issue" }).map((item) => item.workKey), ["release-proof"]);
  assert.deepEqual(board.filterWorkBoardItems(items, { ...base, query: "refactor dashboard" }).map((item) => item.workKey), ["refactor-22"]);
  assert.deepEqual(board.filterWorkBoardItems(items, { ...base, query: "refactor-22" }).map((item) => item.workKey), ["refactor-22"]);
});

test("grouping is deterministic by project and retains every work row", () => {
  const items = board.buildWorkBoardItems([
    work("beta", "Agent 3", "b2"),
    work("alpha", "Agent 1", "a1"),
    work("beta", "Agent 3", "b1"),
  ], [agent("alpha", "Agent 1"), agent("beta", "Agent 3")]);

  const groups = board.groupWorkBoardItems(items);
  assert.deepEqual(groups.map((group) => group.projectKey), ["alpha", "beta"]);
  assert.deepEqual(groups[0].items.map((item) => item.workKey), ["a1"]);
  assert.deepEqual(groups[1].items.map((item) => item.workKey), ["b1", "b2"]);
});

test("work keys never imply GitHub issue links or durable history", () => {
  const source = readFileSync(new URL("../lib/work-assignment-board.ts", import.meta.url), "utf8");
  const uiSource = readFileSync(new URL("../components/WorkAssignmentBoard.tsx", import.meta.url), "utf8");
  const [item] = board.buildWorkBoardItems([
    work("alpha", "Agent 7", "issue-999", { status: "current" }),
  ], [agent("alpha", "Agent 7")]);

  assert.equal(item.workKey, "issue-999");
  assert.equal("githubUrl" in item, false);
  assert.equal("history" in item, false);
  assert.doesNotMatch(source, /github\.com|\/issues\//i);
  assert.doesNotMatch(uiSource, /github\.com|\/issues\//i);
  assert.match(uiSource, /Returned · current work/);
  assert.match(uiSource, /Current Agent State work only\. Each current_work row stays independent; returned does not mean completed\./);
  assert.match(uiSource, /\{item\.resourceCount\} resources · \{item\.coordinationCount\} coordination/);
});
