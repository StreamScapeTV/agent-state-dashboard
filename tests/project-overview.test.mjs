import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const dashboardSource = readFileSync(new URL("../components/DashboardClient.tsx", import.meta.url), "utf8");
const overviewSource = readFileSync(new URL("../components/ProjectOverview.tsx", import.meta.url), "utf8");
const attentionSource = readFileSync(new URL("../components/AttentionInbox.tsx", import.meta.url), "utf8");

test("console is project-first with progressive status and advanced drill-down", () => {
  assert.ok(dashboardSource.includes('const [selectedProjectKey, setSelectedProjectKey] = useState("all")'));
  assert.ok(dashboardSource.includes("<ProjectOverview"));
  assert.ok(dashboardSource.includes('selectedProjectKey !== "all"'));
  assert.ok(dashboardSource.includes("Advanced operations"));

  assert.ok(overviewSource.includes("function AllProjectsLanding"));
  assert.ok(overviewSource.includes("Choose a project to inspect its actors, blockers, and current work."));
  assert.ok(overviewSource.includes("filterProjectRows(rows, selectedProjectKey, selectedStatus)"));
  assert.ok(overviewSource.includes("<Accordion"));
  assert.ok(overviewSource.includes("Blocked reason not recorded"));
  assert.ok(overviewSource.includes("Full agent details"));

  for (const label of ["Agents", "Working", "Blocked", "Returned", "Idle"]) {
    assert.ok(overviewSource.includes(`label: "${label}"`));
  }
});

test("advanced operations inherit project scope and keep heavy boards out of attention", () => {
  assert.ok(dashboardSource.includes('const [advancedScope, setAdvancedScope] = useState<AdvancedScope>("project")'));
  assert.ok(dashboardSource.includes("selectedProjectRows"));
  assert.ok(dashboardSource.includes('advancedScope === "project"'));
  assert.ok(dashboardSource.includes("rows={advancedRows}"));
  assert.ok(dashboardSource.includes("agents={advancedRows}"));
  assert.ok(dashboardSource.includes("work={advancedWork}"));
  assert.ok(dashboardSource.includes('value="all">All projects'));

  assert.ok(attentionSource.includes("Needs attention"));
  assert.equal(attentionSource.includes("WorkAssignmentBoard"), false);
  assert.equal(attentionSource.includes("CoordinationBoard"), false);
  assert.equal(attentionSource.includes("ResourcesCapacityBoard"), false);
});

test("raw tables and live diagnostics stay progressively disclosed", () => {
  assert.ok(dashboardSource.includes("Live details"));
  assert.ok(dashboardSource.includes("Recent live activity"));
  assert.ok(dashboardSource.includes('value="raw" label="Raw tables"'));
  assert.ok(dashboardSource.includes("projectScope={rawProjectScope}"));
  assert.ok(dashboardSource.includes("Open raw tables"));
  assert.ok(dashboardSource.includes("Raw current-table explorer"));
});
