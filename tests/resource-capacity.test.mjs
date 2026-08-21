import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

function loadResourceCapacityModel() {
  const source = readFileSync(new URL("../lib/resource-capacity.ts", import.meta.url), "utf8");
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
    throw new Error(`Unexpected runtime import while testing resource capacity: ${specifier}`);
  });
  return module.exports;
}

const capacity = loadResourceCapacityModel();

function resource(projectKey, identity, resourceKey) {
  return { projectKey, identity, resourceKey };
}

function work(projectKey, identity, workKey, state = {}) {
  return { projectKey, identity, workKey, state };
}

function coordination(projectKey, sender, recipient, state = {}) {
  return { projectKey, sender, recipient, state };
}

function row(projectKey, identity, overrides = {}) {
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
    coordination: [],
    identityKind: identity === "Orchestrator" ? "orchestrator" : "agent",
    workSummary: "No current work",
    nextAction: null,
    ...overrides,
    key: `${projectKey}::${identity}`,
    projectKey,
    identity,
  };
}

test("exact resource ownership remains isolated by project even for identical resource text", () => {
  const alpha = row("alpha", "Agent 1", {
    resources: [resource("alpha", "Agent 1", "components/player.tsx")],
  });
  const beta = row("beta", "Agent 1", {
    resources: [resource("beta", "Agent 1", "components/player.tsx")],
  });

  const resources = capacity.buildResourceOwnership([beta, alpha]);
  assert.deepEqual(resources.map((item) => item.key), [
    "alpha::components/player.tsx",
    "beta::components/player.tsx",
  ]);
  assert.equal(resources[0].owner, alpha);
  assert.equal(resources[1].owner, beta);
});

test("actor and project capacity counts use unique current rows", () => {
  const toOwner = coordination("alpha", "Agent 1", "Orchestrator", { status: "decision" });
  const toPeer = coordination("alpha", "Agent 1", "Agent 2", { status: "handoff" });
  const agent1 = row("alpha", "Agent 1", {
    baseStatus: "working",
    resources: [
      resource("alpha", "Agent 1", "a"),
      resource("alpha", "Agent 1", "b"),
      resource("alpha", "Agent 1", "b"),
    ],
    work: [
      work("alpha", "Agent 1", "issue-1"),
      work("alpha", "Agent 1", "issue-2"),
      work("alpha", "Agent 1", "issue-2"),
    ],
    coordination: [toOwner, toPeer],
  });
  const agent2 = row("alpha", "Agent 2", {
    baseStatus: "working",
    work: [work("alpha", "Agent 2", "issue-3")],
    coordination: [toPeer],
  });
  const orchestrator = row("alpha", "Orchestrator", { coordination: [toOwner] });

  const snapshot = capacity.buildResourceCapacitySnapshot([orchestrator, agent2, agent1]);
  const actor = snapshot.actors.find((item) => item.identity === "Agent 1");
  const project = snapshot.projects.find((item) => item.projectKey === "alpha");

  assert.equal(actor.resources.used, 2);
  assert.equal(actor.work.used, 2);
  assert.equal(actor.coordinationSent.used, 2);
  assert.equal(actor.coordinationReceived.used, 0);
  assert.equal(project.work.used, 3);
  assert.equal(project.coordination.used, 2);
});

test("capacity guidance recognizes values near and at authoritative resource/work limits", () => {
  assert.equal(capacity.capacityUsage(47, capacity.CAPACITY_LIMITS.resourcesPerAgent).level, "normal");
  assert.equal(capacity.capacityUsage(48, capacity.CAPACITY_LIMITS.resourcesPerAgent).level, "near");
  assert.equal(capacity.capacityUsage(64, capacity.CAPACITY_LIMITS.resourcesPerAgent).level, "at-limit");

  assert.equal(capacity.capacityUsage(5, capacity.CAPACITY_LIMITS.workPerAgent).level, "normal");
  assert.equal(capacity.capacityUsage(6, capacity.CAPACITY_LIMITS.workPerAgent).level, "near");
  assert.equal(capacity.capacityUsage(8, capacity.CAPACITY_LIMITS.workPerAgent).level, "at-limit");
  assert.equal(capacity.CAPACITY_WARNING_RATIO, 0.75);
});

test("self coordination counts once per sent/received dimension and once for the project", () => {
  const self = coordination("alpha", "Orchestrator", "Orchestrator", { status: "self-check" });
  const orchestrator = row("alpha", "Orchestrator", {
    coordination: [self, self],
  });

  const snapshot = capacity.buildResourceCapacitySnapshot([orchestrator]);
  const [actor] = snapshot.actors;
  const [project] = snapshot.projects;

  assert.equal(actor.coordinationSent.used, 1);
  assert.equal(actor.coordinationReceived.used, 1);
  assert.equal(project.coordination.used, 1);
});

test("returned and idle owners holding resources receive non-authoritative ownership attention", () => {
  const returned = row("alpha", "Agent 1", {
    baseStatus: "returned",
    resources: [resource("alpha", "Agent 1", "returned-resource")],
  });
  const idle = row("alpha", "Agent 2", {
    baseStatus: "idle",
    resources: [resource("alpha", "Agent 2", "idle-resource")],
  });
  const working = row("alpha", "Agent 3", {
    baseStatus: "working",
    resources: [resource("alpha", "Agent 3", "working-resource")],
  });

  const snapshot = capacity.buildResourceCapacitySnapshot([returned, idle, working]);
  const byIdentity = new Map(snapshot.actors.map((item) => [item.identity, item]));
  const resourceByOwner = new Map(snapshot.resources.map((item) => [item.owner.identity, item]));

  assert.equal(byIdentity.get("Agent 1").ownershipAttention, true);
  assert.equal(byIdentity.get("Agent 2").ownershipAttention, true);
  assert.equal(byIdentity.get("Agent 3").ownershipAttention, false);
  assert.equal(resourceByOwner.get("Agent 1").ownershipAttention, true);
  assert.equal(resourceByOwner.get("Agent 2").ownershipAttention, true);
  assert.equal(resourceByOwner.get("Agent 3").ownershipAttention, false);
});

test("resource filters respect project, exact owner status and resource-key text", () => {
  const rows = [
    row("alpha", "Agent 1", {
      baseStatus: "returned",
      resources: [resource("alpha", "Agent 1", "components/player.tsx")],
      workSummary: "Player cleanup",
    }),
    row("alpha", "Agent 2", {
      baseStatus: "working",
      blocked: true,
      resources: [resource("alpha", "Agent 2", "lib/parser.ts")],
      workSummary: "Parser work",
    }),
    row("beta", "Agent 1", {
      baseStatus: "working",
      resources: [resource("beta", "Agent 1", "components/player.tsx")],
    }),
  ];
  const items = capacity.buildResourceOwnership(rows);

  assert.deepEqual(
    capacity.filterResourceOwnership(items, { project: "alpha", owner: "all", ownerStatus: "all", query: "player" })
      .map((item) => item.key),
    ["alpha::components/player.tsx"],
  );
  assert.deepEqual(
    capacity.filterResourceOwnership(items, { project: "all", owner: "Agent 1", ownerStatus: "returned", query: "" })
      .map((item) => item.key),
    ["alpha::components/player.tsx"],
  );
  assert.deepEqual(
    capacity.filterResourceOwnership(items, { project: "alpha", owner: "all", ownerStatus: "blocked", query: "parser" })
      .map((item) => item.key),
    ["alpha::lib/parser.ts"],
  );
});

test("resource strings stay literal and model contains no pattern-expansion or age-expiry mechanism", () => {
  const actor = row("alpha", "Agent 1", {
    resources: [resource("alpha", "Agent 1", "src/**")],
  });
  const [item] = capacity.buildResourceOwnership([actor]);
  const source = readFileSync(new URL("../lib/resource-capacity.ts", import.meta.url), "utf8");

  assert.equal(item.resourceKey, "src/**");
  assert.equal(item.key, "alpha::src/**");
  assert.doesNotMatch(source, /minimatch|micromatch|globToRegex|expiresAt|ttlMs|leaseExpires/i);
});

test("UI exposes exact counts and guidance without takeover/release controls or persistence", () => {
  const source = readFileSync(new URL("../components/ResourcesCapacityBoard.tsx", import.meta.url), "utf8");
  const mountSource = readFileSync(new URL("../components/AttentionInbox.tsx", import.meta.url), "utf8");

  assert.match(source, /Resources &amp; Capacity/);
  assert.match(source, /Exact current resource keys are authoritative\. Pattern expansion and age expiry are not inferred/);
  assert.match(source, /CAPACITY_WARNING_RATIO/);
  assert.match(source, /\{usage\.used\} \/ \{usage\.limit\}/);
  assert.match(source, /Ownership attention/);
  assert.match(source, /Capacity attention/);
  assert.match(source, /onClick=\{\(\) => onView\(item\.owner\.key\)\}/);
  assert.doesNotMatch(source, /takeoverResource|releaseResource|claimResource|set_agent_resources|localStorage|sessionStorage/i);
  assert.match(mountSource, /<ResourcesCapacityBoard rows=\{rows\} onView=\{onView\} \/>/);
});
