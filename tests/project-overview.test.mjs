import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const dashboardSource = readFileSync(new URL("../components/DashboardClient.tsx", import.meta.url), "utf8");
const overviewSource = readFileSync(new URL("../components/ProjectOverview.tsx", import.meta.url), "utf8");
const attentionSource = readFileSync(new URL("../components/AttentionInbox.tsx", import.meta.url), "utf8");
const modelSource = readFileSync(new URL("../lib/dashboard-model.ts", import.meta.url), "utf8");

test("default console is project-first instead of rendering every operations board", () => {
  assert.match(dashboardSource, /const \[selectedProjectKey, setSelectedProjectKey\] = useState\("all"\)/);
  assert.match(dashboardSource, /<ProjectOverview/);
  assert.match(dashboardSource, /selectedProjectKey !== "all" \? \(/);
  assert.match(dashboardSource, /Advanced operations/);
  assert.doesNotMatch(dashboardSource, /function ProjectCards\(/);
  assert.doesNotMatch(dashboardSource, /function AgentTable\(/);
  assert.doesNotMatch(dashboardSource, /aria-label="Clear filters"/);

  assert.match(overviewSource, /function AllProjectsLanding/);
  assert.match(overviewSource, /Choose a project to inspect its actors, blockers, and current work/);
  assert.match(overviewSource, /summary\.objective \?\? "No current objective recorded\."/);
  assert.match(overviewSource, /Next: \{summary\.nextAction\}/);
  assert.match(overviewSource, /summary\.total} agents/);
  assert.match(overviewSource, /summary\.working} working/);
  assert.match(overviewSource, /summary\.blocked} blocked/);
  assert.match(overviewSource, /summary\.returned} returned/);
  assert.match(overviewSource, /summary\.idle} idle/);
});

test("selected project owns one interactive status drill-down", () => {
  for (const label of ["Agents", "Working", "Blocked", "Returned", "Idle"]) {
    assert.match(overviewSource, new RegExp(`label: "${label}"`));
  }
  assert.match(overviewSource, /aria-label=\{`Show \$\{card\.label\.toLowerCase\(\)\} agents`}\s*/);
  assert.match(overviewSource, /onClick=\{\(\) => onSelectStatus\(card\.value\)\}/);
  assert.match(overviewSource, /filterProjectRows\(rows, selectedProjectKey, selectedStatus\)/);
  assert.match(overviewSource, /<Accordion/);
  assert.match(overviewSource, /expand for operational detail/);
  assert.match(overviewSource, /Full agent details/);
});

test("blocker drill-down exposes bounded recorded reasons and truthful fallback", () => {
  assert.match(modelSource, /MAX_BLOCKER_CUES = 3/);
  assert.match(modelSource, /export function extractBlockerCues/);
  assert.match(modelSource, /source: "actor" \| "work"/);
  assert.match(modelSource, /workKey: string \| null/);
  assert.match(modelSource, /normalizedValue !== "blocked" && normalizedValue !== "waiting"/);
  assert.match(overviewSource, /row\.blockerCues\[0\]\?\.reason \?\? "Blocked reason not recorded"/);
  assert.match(overviewSource, /Blocker \/ waiting reason/);
  assert.match(overviewSource, /cue\.source === "work" \? `Work \$\{cue\.workKey \?\? "unknown"}` : "Actor state"/);
  assert.match(overviewSource, /Blocked reason not recorded/);
});

test("attention is focused and no longer nests the other advanced boards", () => {
  assert.doesNotMatch(attentionSource, /WorkAssignmentBoard/);
  assert.doesNotMatch(attentionSource, /CoordinationBoard/);
  assert.doesNotMatch(attentionSource, /ResourcesCapacityBoard/);
  assert.match(attentionSource, /Needs attention/);
  assert.match(attentionSource, /row\.blockerCues\[0\]\?\.reason \?\? "Blocked reason not recorded"/);
});

test("advanced operations inherit selected project unless explicitly switched to all projects", () => {
  assert.match(dashboardSource, /const \[advancedScope, setAdvancedScope\] = useState<AdvancedScope>\("project"\)/);
  assert.match(dashboardSource, /selectedProjectRows = useMemo/);
  assert.match(dashboardSource, /selectedProjectKey === "all" \? \[\] : rows\.filter\(\(row\) => row\.projectKey === selectedProjectKey\)/);
  assert.match(dashboardSource, /selectedProjectKey !== "all" && advancedScope === "project"/);
  assert.match(dashboardSource, /\? selectedProjectRows\s*:\s*rows/);
  assert.match(dashboardSource, /<MenuItem value="project">\{selectedProjectKey}<\/MenuItem>/);
  assert.match(dashboardSource, /<MenuItem value="all">All projects<\/MenuItem>/);
  assert.match(dashboardSource, /<AttentionInbox[\s\S]*rows=\{advancedRows\}/);
  assert.match(dashboardSource, /<WorkAssignmentBoard work=\{advancedWork\} agents=\{advancedRows\}/);
  assert.match(dashboardSource, /<CoordinationBoard agents=\{advancedRows\}/);
  assert.match(dashboardSource, /<ResourcesCapacityBoard rows=\{advancedRows\}/);
});

test("raw tables and live diagnostics remain deliberate progressive disclosure", () => {
  assert.match(dashboardSource, /const \[healthOpen, setHealthOpen\] = useState\(false\)/);
  assert.match(dashboardSource, /<Collapse in=\{healthOpen \|\| !healthy\}>/);
  assert.match(dashboardSource, /Live details/);
  assert.match(dashboardSource, /Recent live activity/);
  assert.match(dashboardSource, /<Tab value="raw" label="Raw tables"/);
  assert.match(dashboardSource, /projectScope=\{rawProjectScope\}/);
  assert.match(dashboardSource, /loadedRows\.filter\(\(row\) => rawProjectKey\(row\) === projectScope\)/);
  assert.match(dashboardSource, /Open raw tables/);
  assert.match(dashboardSource, /Raw current-table explorer/);
});
