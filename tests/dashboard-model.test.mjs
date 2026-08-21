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
    assignment: null,
    assignmentAssignedAt: null,
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
  assert.equal(row.blockerCues[0].reason, "blocked");
  assert.equal(row.blockerCues[1].reason, "CI credential");
  assert.equal(model.statusLabel(row), "Blocked · returned");
  assert.equal(model.attentionRank(row), 0);
});

test("blocked status variants used by current Agent State are recognized", () => {
  assert.equal(model.isBlocked({ status: "blocked_on_external_ci_contract" }, []), true);
  assert.equal(model.isBlocked({ phase: "blocked-review" }, []), true);
  assert.equal(model.isBlocked({ status: "blocked: waiting for owner" }, []), true);
  assert.equal(model.isBlocked({ status: "waiting_for_owner" }, []), true);
  assert.equal(model.isBlocked({ status: "working" }, []), false);
});

test("blocker cues are deterministic, bounded, and retain actor/work source context", () => {
  const cues = model.extractBlockerCues(
    {
      blocker: "Owner decision",
      waiting_for: "Release tag",
      next_action: "Ask owner",
    },
    [
      {
        projectKey: "demo",
        identity: "Agent 2",
        workKey: "issue-7",
        state: {
          block_reason: "CI unavailable",
          objective: "Publish release",
          next_action: "Retry validation",
        },
      },
      {
        projectKey: "demo",
        identity: "Agent 2",
        workKey: "issue-8",
        state: { blocker_reason: "Fourth cue must be truncated" },
      },
    ],
  );

  assert.deepEqual(cues.map((cue) => cue.reason), ["Owner decision", "Release tag", "CI unavailable"]);
  assert.equal(cues[0].source, "actor");
  assert.equal(cues[0].nextAction, "Ask owner");
  assert.equal(cues[2].source, "work");
  assert.equal(cues[2].workKey, "issue-7");
  assert.equal(cues[2].summary, "Publish release");
  assert.equal(cues[2].nextAction, "Retry validation");
});

test("boolean-only blocker stays blocked without fabricating a reason", () => {
  const currentWork = work({ blocked: true });
  assert.equal(model.isBlocked({}, currentWork), true);
  assert.deepEqual(model.extractBlockerCues({}, currentWork), []);
});

test("live event policy separates fallback freshness from Realtime connection state", () => {
  assert.deepEqual(model.liveEventDecision("open"), { state: "connecting", refresh: false });
  assert.deepEqual(model.liveEventDecision("error"), { state: "reconnecting", refresh: false });
  assert.deepEqual(model.liveEventDecision("refresh"), { state: null, refresh: true });
  assert.deepEqual(model.liveEventDecision("invalidate"), { state: "live", refresh: true });
  assert.deepEqual(model.liveEventDecision("status", '{"status":"live"}'), { state: "live", refresh: false });
  assert.deepEqual(model.liveEventDecision("status", '{"status":"starting"}'), { state: "connecting", refresh: false });
  assert.deepEqual(model.liveEventDecision("status", { status: "reconnecting" }), { state: "reconnecting", refresh: false });
  assert.deepEqual(model.liveEventDecision("status", '{"status":"unknown"}'), { state: null, refresh: false });
  assert.deepEqual(model.liveEventDecision("status", "not-json"), { state: null, refresh: false });
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

test("duration-only refresh does not rebuild static row semantics", () => {
  const snapshot = {
    projects: [],
    agents: [
      agent({ identity: "Agent 1", promptAssignedAt: "2026-08-12T00:00:00Z" }),
      agent({ identity: "Agent 2", promptAssignedAt: "2026-08-12T00:00:00Z", lastReturnedAt: "2026-08-12T00:01:00Z" }),
    ],
    work: [],
    resources: [],
    coordination: [],
    refreshedAt: "2026-08-12T00:01:00Z",
    missingTables: [],
  };
  const baseRows = model.buildAgentRows(snapshot, 0);
  const refreshed = model.refreshAgentDurations(baseRows, Date.parse("2026-08-12T00:02:00Z"));

  assert.equal(refreshed[0].durationMs, 120_000);
  assert.equal(refreshed[0].baseStatus, "working");
  assert.equal(refreshed[1], baseRows[1], "completed rows should retain identity when duration is unchanged");
  assert.equal(refreshed[1].durationMs, 60_000);
});

test("agent association indexes isolate project and identity ownership", () => {
  const snapshot = {
    projects: [],
    agents: [
      agent({ projectKey: "alpha", identity: "Agent 1" }),
      agent({ projectKey: "alpha", identity: "Agent 2" }),
      agent({ projectKey: "beta", identity: "Agent 1" }),
    ],
    work: [
      { projectKey: "alpha", identity: "Agent 1", workKey: "a1", state: { objective: "Alpha one" } },
      { projectKey: "alpha", identity: "Agent 2", workKey: "a2", state: { objective: "Alpha two" } },
      { projectKey: "beta", identity: "Agent 1", workKey: "b1", state: { objective: "Beta one" } },
    ],
    resources: [
      { projectKey: "alpha", identity: "Agent 1", resourceKey: "alpha-one" },
      { projectKey: "alpha", identity: "Agent 2", resourceKey: "alpha-two" },
      { projectKey: "beta", identity: "Agent 1", resourceKey: "beta-one" },
    ],
    coordination: [
      { projectKey: "alpha", sender: "Agent 1", recipient: "Agent 2", state: { status: "handoff" } },
      { projectKey: "beta", sender: "Agent 1", recipient: "Agent 1", state: { status: "self-check" } },
    ],
    refreshedAt: "2026-08-12T00:00:00Z",
    missingTables: [],
  };

  const rows = model.buildAgentRows(snapshot, 0);
  const alphaOne = rows.find((row) => row.projectKey === "alpha" && row.identity === "Agent 1");
  const alphaTwo = rows.find((row) => row.projectKey === "alpha" && row.identity === "Agent 2");
  const betaOne = rows.find((row) => row.projectKey === "beta" && row.identity === "Agent 1");

  assert.deepEqual(alphaOne.work.map((item) => item.workKey), ["a1"]);
  assert.deepEqual(alphaTwo.work.map((item) => item.workKey), ["a2"]);
  assert.deepEqual(betaOne.work.map((item) => item.workKey), ["b1"]);
  assert.deepEqual(alphaOne.resources.map((item) => item.resourceKey), ["alpha-one"]);
  assert.deepEqual(alphaTwo.resources.map((item) => item.resourceKey), ["alpha-two"]);
  assert.deepEqual(betaOne.resources.map((item) => item.resourceKey), ["beta-one"]);
  assert.equal(alphaOne.coordination.length, 1);
  assert.equal(alphaTwo.coordination.length, 1);
  assert.equal(betaOne.coordination.length, 1, "self-coordination must not be duplicated");
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

test("snapshot normalization preserves the full authoritative prompt and response text", () => {
  const prompt = "  Keep leading space\nKeep trailing space  ";
  const response = "\nLatest response with framing whitespace\n";
  const snapshot = model.normalizeSnapshot({
    current_projects: [],
    current_agents: [{
      project_key: "demo",
      agent: "Agent 2",
      prompt,
      state: { status: "blocked_on_external_ci_contract" },
      prompt_assigned_at: " 2026-08-12T00:00:00Z ",
      last_response: response,
      last_returned_at: null,
    }],
    current_work: [],
    current_resources: [],
    current_coordination: [],
  });

  assert.equal(snapshot.agents[0].prompt, prompt);
  assert.equal(snapshot.agents[0].lastResponse, response);
  assert.equal(snapshot.agents[0].promptAssignedAt, "2026-08-12T00:00:00Z");
  const [row] = model.buildAgentRows(snapshot, Date.parse("2026-08-12T00:01:00Z"));
  assert.equal(row.blocked, true);
  assert.equal(model.statusLabel(row), "Blocked · working");
});

test("agent next action prefers explicit current work action over a generic actor checkpoint", () => {
  const snapshot = {
    projects: [],
    agents: [agent({
      state: { checkpoint: "Source review complete" },
      promptAssignedAt: "2026-08-12T00:00:00Z",
    })],
    work: work({ objective: "Ship console", next_action: "Run exact-head validation" }),
    resources: [],
    coordination: [],
    refreshedAt: "2026-08-12T00:01:00Z",
    missingTables: [],
  };

  const [row] = model.buildAgentRows(snapshot, Date.parse("2026-08-12T00:02:00Z"));
  assert.equal(row.nextAction, "Run exact-head validation");
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
  assert.equal(summary.total, 2);
  assert.equal(summary.phase, "validation");
  assert.equal(summary.objective, "Ship console");
  assert.equal(summary.nextAction, "Merge");
});

test("project status slices exactly match project summary counters", () => {
  const snapshot = {
    projects: [{ projectKey: "alpha", state: {} }, { projectKey: "beta", state: {} }],
    agents: [
      agent({ projectKey: "alpha", identity: "Agent 1", promptAssignedAt: "2026-08-12T00:00:00Z" }),
      agent({ projectKey: "alpha", identity: "Agent 2", promptAssignedAt: "2026-08-12T00:00:00Z", lastReturnedAt: "2026-08-12T00:01:00Z", state: { blocker: "Review" } }),
      agent({ projectKey: "alpha", identity: "Agent 3" }),
      agent({ projectKey: "beta", identity: "Agent 1", promptAssignedAt: "2026-08-12T00:00:00Z" }),
    ],
    work: [],
    resources: [],
    coordination: [],
    refreshedAt: "2026-08-12T00:01:00Z",
    missingTables: [],
  };
  const rows = model.buildAgentRows(snapshot, Date.parse("2026-08-12T00:02:00Z"));
  const alpha = model.buildProjectSummaries(snapshot, rows).find((item) => item.projectKey === "alpha");

  assert.equal(model.filterProjectRows(rows, "alpha", "all").length, alpha.total);
  assert.equal(model.filterProjectRows(rows, "alpha", "working").length, alpha.working);
  assert.equal(model.filterProjectRows(rows, "alpha", "blocked").length, alpha.blocked);
  assert.equal(model.filterProjectRows(rows, "alpha", "returned").length, alpha.returned);
  assert.equal(model.filterProjectRows(rows, "alpha", "idle").length, alpha.idle);
  assert.equal(model.filterProjectRows(rows, "alpha", "all").every((row) => row.projectKey === "alpha"), true);
});

test("client source contract preserves progressive owner interaction while live orchestration is delegated", () => {
  const source = readFileSync(new URL("../components/DashboardClient.tsx", import.meta.url), "utf8");
  const overviewSource = readFileSync(new URL("../components/ProjectOverview.tsx", import.meta.url), "utf8");
  const hookSource = readFileSync(new URL("../lib/use-dashboard-tables.ts", import.meta.url), "utf8");

  assert.match(source, /useDashboardTables\(nowMs\)/);
  assert.match(source, /readDashboardTable\(client, table, \{ signal: controller\.signal \}\)/);
  assert.match(source, /tableHealthLabel\(tableStates\[table\], nowMs, STALE_AFTER_MS\)/);
  assert.match(source, /Partial Agent State data/);
  assert.match(source, /Live details/);
  assert.match(source, /Recent live activity/);
  assert.doesNotMatch(source, /Refresh all/);
  assert.match(hookSource, /subscribeToDashboardChanges\(client, \{/);
  assert.match(hookSource, /readDashboardSnapshot\(client, \{ signal: controller\.signal \}\)/);
  assert.match(hookSource, /onChange: applyLiveChange/);
  assert.match(hookSource, /applyRealtimeChangeToTableStates\(current, change\)/);
  assert.doesNotMatch(hookSource, /readDashboardTable\(/);
  assert.match(source, /const baseRows = useMemo\(\(\) => \(snapshot \? buildAgentRows\(snapshot, 0\) : \[\]\), \[snapshot\]\)/);
  assert.match(source, /refreshAgentDurations\(baseRows, nowMs\)/);
  assert.match(source, /const \[selectedProjectKey, setSelectedProjectKey\] = useState\("all"\)/);
  assert.match(source, /const \[selectedStatus, setSelectedStatus\] = useState<AgentStatusFilter>\("all"\)/);
  assert.match(source, /const \[selectedAgentKey, setSelectedAgentKey\] = useState<string \| null>\(null\)/);
  assert.match(source, /rows\.find\(\(row\) => row\.key === selectedAgentKey\)/);
  assert.match(source, /!baseRows\.some\(\(row\) => row\.key === selectedAgentKey\)/);
  assert.match(source, /setSelectedAgentKey\(null\)/);
  assert.match(source, /<ProjectOverview/);
  assert.match(source, /Advanced operations/);
  assert.match(source, /<Tab value="attention" label="Attention"/);
  assert.match(source, /<Tab value="work" label="Work \/ assignments"/);
  assert.match(source, /<Tab value="coordination" label="Coordination"/);
  assert.match(source, /<Tab value="resources" label="Resources \/ capacity"/);
  assert.match(source, /<Tab value="raw" label="Raw tables"/);
  assert.match(source, /advancedScope === "project"/);
  assert.match(source, /selectedProjectRows/);
  assert.match(source, /projectScope=\{rawProjectScope\}/);
  assert.match(source, /rows\.slice\(page \* rowsPerPage, page \* rowsPerPage \+ rowsPerPage\)/);
  assert.match(source, /<TablePagination/);
  assert.match(source, /rowsPerPageOptions=\{\[25, 50, 100\]\}/);
  assert.match(source, /event\.key === "Enter" \|\| event\.key === " "/);

  assert.match(overviewSource, /Choose a project to inspect its actors, blockers, and current work/);
  assert.match(overviewSource, /<CardActionArea/);
  assert.match(overviewSource, /aria-pressed=\{active\}/);
  assert.match(overviewSource, /filterProjectRows\(rows, selectedProjectKey, selectedStatus\)/);
  assert.match(overviewSource, /<Accordion/);
  assert.match(overviewSource, /Blocked reason not recorded/);
  assert.match(overviewSource, /Full agent details/);
});
