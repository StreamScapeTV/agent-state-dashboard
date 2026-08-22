import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

function loadGraphModel() {
  const source = readFileSync(new URL("../lib/issue-dependency-graph.ts", import.meta.url), "utf8");
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
    throw new Error(`Unexpected runtime import while testing graph model: ${specifier}`);
  });
  return module.exports;
}

const model = loadGraphModel();

function issue(projectKey, issueNumber, status = "ready", overrides = {}) {
  return {
    project_key: projectKey,
    issue_number: issueNumber,
    github_url: null,
    title: `${projectKey} issue ${issueNumber}`,
    summary: "",
    status,
    phase: null,
    priority: null,
    milestone: null,
    assigned_actor: null,
    blocker_reason: null,
    next_action: null,
    updated_at: "2026-08-22T20:00:00Z",
    ...overrides,
  };
}

function dependency(dependentProject, dependentIssue, blockerProject, blockerIssue, reason = null) {
  return {
    dependent_project_key: dependentProject,
    dependent_issue_number: dependentIssue,
    blocker_project_key: blockerProject,
    blocker_issue_number: blockerIssue,
    reason,
    updated_at: "2026-08-22T20:00:00Z",
  };
}

test("graph hides empty or non-visible issue datasets", () => {
  assert.equal(model.buildIssueDependencyGraph([], [], "app", ["app"]), null);
  assert.equal(
    model.buildIssueDependencyGraph([issue("media", 2)], [], "app", ["app"]),
    null,
    "a target/visible set without issue nodes must not create an empty graph shell",
  );
});

test("issue visual status precedence is deterministic and rejects impossible values", () => {
  assert.equal(model.deriveIssueGraphStatus(issue("app", 1, "ready"), 0), "ready");
  assert.equal(model.deriveIssueGraphStatus(issue("app", 1, "in_progress"), 0), "active");
  assert.equal(model.deriveIssueGraphStatus(issue("app", 1, "validation"), 0), "active");
  assert.equal(model.deriveIssueGraphStatus(issue("app", 1, "blocked"), 0), "blocked");
  assert.equal(model.deriveIssueGraphStatus(issue("app", 1, "waiting"), 0), "blocked");
  assert.equal(model.deriveIssueGraphStatus(issue("app", 1, "ready"), 1), "blocked");
  assert.equal(model.deriveIssueGraphStatus(issue("app", 1, "validation"), 1), "blocked");
  assert.throws(
    () => model.deriveIssueGraphStatus(issue("app", 1, "impossible"), 0),
    /Unsupported issue status/,
  );
});

test("live blocker edges override row status and retain blocker detail even across projects", () => {
  const issues = [
    issue("app", 101, "ready", { assigned_actor: "Agent 2" }),
    issue("ci", 301, "ready"),
  ];
  const dependencies = [dependency("app", 101, "ci", 301, "CI contract")];
  const graph = model.buildIssueDependencyGraph(
    issues,
    dependencies,
    "app",
    model.defaultVisibleProjects("app", issues, dependencies),
  );
  assert.ok(graph);
  const app = graph.nodes.find((node) => node.id === "app#101");
  assert.equal(app.visualStatus, "blocked");
  assert.equal(app.visualLabel, "Blocked");
  assert.deepEqual(app.blockers, [{ projectKey: "ci", issueNumber: 301, reason: "CI contract" }]);
  assert.equal(graph.edges.length, 1);
  assert.equal(graph.edges[0].crossProject, true);
  assert.ok(app.x < graph.nodes.find((node) => node.id === "ci#301").x, "dependent should lay out before its blocker");
  assert.match(model.dependencyEdgePath(graph.edges[0], graph.nodes), /^M /);
});

test("graph supports multiple blockers, shared blockers, cross-project topology and disconnected components", () => {
  const issues = [
    issue("app", 101),
    issue("app", 102, "in_progress"),
    issue("media", 201),
    issue("ci", 301),
    issue("misc", 401),
  ];
  const dependencies = [
    dependency("app", 101, "media", 201, "player prerequisite"),
    dependency("app", 101, "ci", 301, "pipeline prerequisite"),
    dependency("app", 102, "ci", 301, "shared pipeline prerequisite"),
  ];
  const visible = ["app", "media", "ci", "misc"];
  const graph = model.buildIssueDependencyGraph(issues, dependencies, "app", visible);
  assert.ok(graph);
  assert.equal(graph.nodes.length, 5);
  assert.equal(graph.edges.length, 3);
  assert.equal(graph.nodes.find((node) => node.id === "app#101").blockers.length, 2);
  assert.equal(graph.nodes.find((node) => node.id === "ci#301").dependents.length, 2);
  assert.equal(graph.nodes.find((node) => node.id === "app#102").visualStatus, "blocked", "live blocker beats active row status");
  const components = new Set(graph.nodes.map((node) => node.component));
  assert.equal(components.size, 2, "disconnected singleton must remain a separate visible component");
  assert.equal(graph.nodes.find((node) => node.id === "app#101").component, 0, "target component should be laid out first");
});

test("target project and visible-project filters are separate and switching target gets a sensible default", () => {
  const issues = [issue("app", 1), issue("media", 2), issue("ci", 3), issue("misc", 4)];
  const dependencies = [
    dependency("app", 1, "media", 2),
    dependency("ci", 3, "app", 1),
  ];
  assert.deepEqual(model.defaultVisibleProjects("app", issues, dependencies), ["app", "ci", "media"]);
  assert.deepEqual(
    model.normalizeVisibleProjects("app", ["misc"], issues),
    ["app", "misc"],
    "visible projects can vary independently while retaining the narrative target",
  );
  assert.deepEqual(model.defaultVisibleProjects("misc", issues, dependencies), ["misc"]);
});

test("derivation and layout are stable for identical canonical input", () => {
  const issues = [issue("zeta", 2), issue("alpha", 1), issue("alpha", 3), issue("beta", 4)];
  const dependencies = [
    dependency("alpha", 3, "alpha", 1),
    dependency("alpha", 3, "zeta", 2),
  ];
  const visible = ["zeta", "alpha", "beta"];
  const first = model.buildIssueDependencyGraph(issues, dependencies, "alpha", visible);
  const second = model.buildIssueDependencyGraph([...issues].reverse(), [...dependencies].reverse(), "alpha", [...visible].reverse());
  assert.deepEqual(
    first.nodes.map(({ id, x, y, component, rank, visualStatus }) => ({ id, x, y, component, rank, visualStatus })),
    second.nodes.map(({ id, x, y, component, rank, visualStatus }) => ({ id, x, y, component, rank, visualStatus })),
  );
  assert.deepEqual(first.edges, second.edges);
});

test("cycle input fails visibly rather than inventing a layout category", () => {
  const issues = [issue("app", 1), issue("app", 2)];
  const dependencies = [
    dependency("app", 1, "app", 2),
    dependency("app", 2, "app", 1),
  ];
  assert.throws(
    () => model.buildIssueDependencyGraph(issues, dependencies, "app", ["app"]),
    /contains a cycle/,
  );
});

test("graph UI is canonical, accessible, responsive and omits optional filler", () => {
  const graphSource = readFileSync(new URL("../components/IssueDependencyGraph.tsx", import.meta.url), "utf8");
  const dashboardSource = readFileSync(new URL("../components/DashboardClient.tsx", import.meta.url), "utf8");

  for (const marker of [
    'from "@/lib/agent-state-read-contract"',
    "buildIssueDependencyGraph",
    "defaultVisibleProjects",
    "normalizeVisibleProjects",
    'aria-expanded={expanded}',
    "aria-label={`${issue.project_key} issue ${issue.issue_number}",
    'role="region"',
    'aria-label={`Directed issue dependency graph for ${targetProjectKey}`}',
    "Blocked",
    "Active",
    "Ready",
    "Target + related",
    "Visible projects",
    "Zoom graph in",
    "Zoom graph out",
    "Fit dependency graph to view",
    "Reset dependency graph view",
    "onPointerDown={handlePointerDown}",
    "onWheel={handleWheel}",
    'target="_blank"',
    "if (!graph) return null",
    'height: { xs: 430, sm: 520, md: 620 }',
  ]) {
    assert.ok(graphSource.includes(marker), `missing graph UI marker: ${marker}`);
  }

  for (const filler of ["N/A", "No issue", "No blocker", "No next action", "—", "demo node", "sample node"]) {
    assert.equal(graphSource.includes(filler), false, `unexpected graph filler: ${filler}`);
  }
  assert.equal(graphSource.includes("useDashboardTables("), false, "graph component must not create a second data source");

  for (const marker of [
    'import { IssueDependencyGraph } from "@/components/IssueDependencyGraph"',
    "issues,",
    "issueDependencies,",
    "<IssueDependencyGraph",
    "issues={issues}",
    "dependencies={issueDependencies}",
    "targetProjectKey={selectedProjectKey}",
  ]) {
    assert.ok(dashboardSource.includes(marker), `missing DashboardClient graph integration marker: ${marker}`);
  }
});
