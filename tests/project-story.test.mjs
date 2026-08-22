import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

function loadTypeScriptModule(relativePath) {
  const source = readFileSync(new URL(relativePath, import.meta.url), "utf8");
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
    throw new Error(`Unexpected runtime import while testing ${relativePath}: ${specifier}`);
  });
  return module.exports;
}

const model = loadTypeScriptModule("../lib/dashboard-model.ts");
const storyModel = loadTypeScriptModule("../lib/project-story.ts");

function idleAgent() {
  return {
    projectKey: "demo",
    identity: "Agent 2",
    assignment: null,
    assignmentAssignedAt: null,
    prompt: null,
    state: {},
    promptAssignedAt: null,
    lastResponse: null,
    lastReturnedAt: null,
  };
}

test("stale project narrative cannot mark an idle current actor blocked", () => {
  const snapshot = {
    projects: [{
      projectKey: "demo",
      state: {
        parallel_state: {
          agent_2: {
            status: "waiting_owner_human_tag",
            blocker: "stale release narrative",
          },
        },
      },
    }],
    agents: [idleAgent()],
    work: [],
    resources: [],
    coordination: [],
    refreshedAt: "2026-08-22T00:00:00Z",
    missingTables: [],
  };

  const [row] = model.buildAgentRows(snapshot, Date.parse("2026-08-22T00:01:00Z"));
  assert.equal(row.baseStatus, "idle");
  assert.equal(row.blocked, false);
  assert.deepEqual(row.blockerCues, []);
  assert.equal(model.statusLabel(row), "Idle");
});

test("canonical project story is parsed only from state.story and omits empty members", () => {
  const story = storyModel.parseProjectStory({
    phase: "stale-root-phase",
    objective: "stale-root-objective",
    parallel_state: { agent_2: { status: "waiting_owner_human_tag" } },
    story: {
      summary: "  Dashboard work is moving  ",
      objective: "Ship the project-first view",
      phase: "UX refinement",
      focus_issues: [
        { project_key: "agent-state-dashboard", issue_number: 112 },
        { project_key: "agent-state-dashboard", issue_number: 112 },
        { project_key: "", issue_number: 1 },
      ],
      related_projects: ["agent-state-supabase", "", "agent-state-supabase"],
      next_actions: ["Finish story UI", "", "Finish story UI", "Validate the candidate"],
      owner_attention: "Review the resulting hierarchy",
    },
  });

  assert.deepEqual(story, {
    summary: "Dashboard work is moving",
    objective: "Ship the project-first view",
    phase: "UX refinement",
    focusIssues: [{ projectKey: "agent-state-dashboard", issueNumber: 112 }],
    relatedProjects: ["agent-state-supabase"],
    nextActions: ["Finish story UI", "Validate the candidate"],
    ownerAttention: "Review the resulting hierarchy",
  });
  assert.equal(story.summary.includes("stale-root"), false);

  assert.equal(storyModel.parseProjectStory({ phase: "legacy", objective: "legacy" }), null);
  assert.equal(storyModel.parseProjectStory({ story: { summary: "  ", next_actions: ["", "   "] } }), null);
});

test("project overview renders canonical story fields without placeholder narrative or an empty graph", () => {
  const overviewSource = readFileSync(new URL("../components/ProjectOverview.tsx", import.meta.url), "utf8");
  const typeSource = readFileSync(new URL("../types/dashboard.ts", import.meta.url), "utf8");

  for (const marker of [
    "parseProjectStory(summary.state)",
    "story.summary",
    "story.objective",
    "story?.phase",
    "story.focusIssues",
    "story.relatedProjects",
    "story.nextActions",
    "story.ownerAttention",
    "Owner attention",
    "Next actions",
    "Focus issues",
    "Related projects",
    "filterProjectRows(rows, selectedProjectKey, selectedStatus)",
    "<Accordion",
    "Full agent details",
  ]) {
    assert.ok(overviewSource.includes(marker), `missing project-story UI marker: ${marker}`);
  }

  for (const placeholder of [
    "No current objective recorded.",
    "No current next action recorded.",
    'row.nextAction ?? "—"',
    "Dependency graph",
    "No dependencies",
  ]) {
    assert.equal(overviewSource.includes(placeholder), false, `unexpected placeholder marker: ${placeholder}`);
  }

  assert.ok(typeSource.includes("export interface ProjectStory"));
  assert.ok(typeSource.includes("export interface ProjectStoryIssueRef"));
});
