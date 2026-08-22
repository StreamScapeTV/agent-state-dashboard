import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const coreTables = [
  "current_projects",
  "current_agents",
  "current_work",
  "current_resources",
  "current_coordination",
];
const issueTables = ["current_issues", "current_issue_dependencies"];
const allTables = [...coreTables, ...issueTables];

function transpile(path) {
  const source = readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
  return {
    source,
    output: ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        esModuleInterop: true,
      },
    }).outputText,
  };
}

function loadContract() {
  const { source, output } = transpile("lib/agent-state-read-contract.ts");
  const module = { exports: {} };
  new Function("exports", "module", "require", output)(module.exports, module, (specifier) => {
    if (specifier === "@/types/dashboard") return { RAW_TABLE_NAMES: coreTables };
    throw new Error(`Unexpected contract runtime import: ${specifier}`);
  });
  return { source, contract: module.exports };
}

function loadTransport(contract) {
  const { source, output } = transpile("lib/dashboard-supabase.ts");
  const module = { exports: {} };
  new Function("exports", "module", "require", output)(module.exports, module, (specifier) => {
    if (specifier === "@supabase/supabase-js") return { createClient: () => ({}) };
    if (specifier === "@/lib/agent-state-read-contract") return contract;
    if (specifier === "@/types/dashboard") return { RAW_TABLE_NAMES: coreTables };
    throw new Error(`Unexpected transport runtime import: ${specifier}`);
  });
  return { source, transport: module.exports };
}

function fakeClient({ errors = {}, rows = {} } = {}) {
  return {
    from(table) {
      const query = {
        select() { return query; },
        order() { return query; },
        abortSignal() { return query; },
        async range() {
          const error = errors[table] ?? null;
          const data = rows[table] ?? [];
          return { error, data: error ? null : data, count: error ? null : data.length };
        },
      };
      return query;
    },
  };
}

const { source: contractSource, contract } = loadContract();
const { source: transportSource, transport } = loadTransport(contract);
const nginx = readFileSync(new URL("../docker/nginx.conf", import.meta.url), "utf8");

test("canonical additive contract has exactly the frozen table names and wire fields", () => {
  assert.deepEqual(contract.ISSUE_TABLE_NAMES, issueTables);
  assert.deepEqual(contract.DASHBOARD_TABLE_NAMES, allTables);

  const issueFields = [
    "project_key",
    "issue_number",
    "github_url",
    "title",
    "summary",
    "status",
    "phase",
    "priority",
    "milestone",
    "assigned_actor",
    "blocker_reason",
    "next_action",
    "updated_at",
  ];
  const dependencyFields = [
    "dependent_project_key",
    "dependent_issue_number",
    "blocker_project_key",
    "blocker_issue_number",
    "reason",
    "updated_at",
  ];
  for (const field of [...issueFields, ...dependencyFields]) {
    assert.match(contractSource, new RegExp(`\\b${field}\\b`));
  }
  assert.match(contractSource, /"ready"[\s\S]*"in_progress"[\s\S]*"blocked"[\s\S]*"waiting"[\s\S]*"validation"/);
  assert.doesNotMatch(contractSource, /schemaVersion|schema_version|legacy|compatibility|alternateTable|current_issues_v\d|current_issue_dependencies_v\d/i);
});

test("optional project story shape matches the frozen unversioned story object", () => {
  for (const field of [
    "summary",
    "objective",
    "phase",
    "focus_issues",
    "related_projects",
    "next_actions",
    "owner_attention",
  ]) {
    assert.match(contractSource, new RegExp(`\\b${field}\\??:`));
  }
  assert.match(contractSource, /interface ProjectStoryFocusIssue[\s\S]*project_key: string;[\s\S]*issue_number: number;/);
});

test("missing additive tables normalize only PGRST205 to empty datasets", async () => {
  const snapshot = await transport.readDashboardSnapshot(fakeClient({
    errors: {
      current_issues: { code: "PGRST205", message: "missing" },
      current_issue_dependencies: { code: "PGRST205", message: "missing" },
    },
    rows: {
      current_projects: [{ project_key: "demo" }],
    },
  }));

  assert.deepEqual(snapshot.tables.current_issues, []);
  assert.deepEqual(snapshot.tables.current_issue_dependencies, []);
  assert.equal(Object.hasOwn(snapshot.errors, "current_issues"), false);
  assert.equal(Object.hasOwn(snapshot.errors, "current_issue_dependencies"), false);
  assert.deepEqual(snapshot.tables.current_projects, [{ project_key: "demo" }]);
});

test("missing core tables and unexpected additive errors keep normal failure semantics", async () => {
  const coreFailure = await transport.readDashboardSnapshot(fakeClient({
    errors: { current_agents: { code: "PGRST205", message: "missing" } },
  }));
  assert.equal(coreFailure.errors.current_agents, "Dashboard read failed for current_agents");
  assert.equal(Object.hasOwn(coreFailure.tables, "current_agents"), false);

  for (const code of ["PGRST301", "PGRST106", "42501"]) {
    const additiveFailure = await transport.readDashboardSnapshot(fakeClient({
      errors: { current_issues: { code, message: "not rollout missing" } },
    }));
    assert.equal(additiveFailure.errors.current_issues, "Dashboard read failed for current_issues");
    assert.equal(Object.hasOwn(additiveFailure.tables, "current_issues"), false);
  }
});

test("normal additive reads stay on the same canonical table path", async () => {
  const issues = [{
    project_key: "demo",
    issue_number: 111,
    github_url: null,
    title: "Contract",
    summary: "",
    status: "ready",
    phase: null,
    priority: "P1",
    milestone: null,
    assigned_actor: null,
    blocker_reason: null,
    next_action: null,
    updated_at: "2026-08-22T14:00:00Z",
  }];
  const dependencies = [{
    dependent_project_key: "demo",
    dependent_issue_number: 111,
    blocker_project_key: "other",
    blocker_issue_number: 71,
    reason: null,
    updated_at: "2026-08-22T14:00:00Z",
  }];
  const snapshot = await transport.readDashboardSnapshot(fakeClient({
    rows: {
      current_issues: issues,
      current_issue_dependencies: dependencies,
    },
  }));
  assert.deepEqual(snapshot.tables.current_issues, issues);
  assert.deepEqual(snapshot.tables.current_issue_dependencies, dependencies);
  assert.deepEqual(snapshot.errors, {});
  assert.deepEqual(contract.issueDataFromTableRows(snapshot.tables), { issues, dependencies });
});

test("transport uses separate additive Realtime subscription so rollout errors cannot poison core status", () => {
  assert.match(transportSource, /client\.channel\("agent-state-dashboard-current"\)/);
  assert.match(transportSource, /client\.channel\("agent-state-dashboard-issues"\)/);
  assert.match(transportSource, /RAW_TABLE_NAMES/);
  assert.match(transportSource, /ISSUE_TABLE_NAMES/);
  assert.match(transportSource, /coreChannel\.subscribe\(\(status\) =>/);
  assert.match(transportSource, /issueChannel\.subscribe\(\)/);
  assert.doesNotMatch(transportSource, /schemaVersion|schema_version|current_issues_v\d|current_issue_dependencies_v\d/i);
});

test("NGINX exposes exactly the seven current tables and remains observation-only", () => {
  const allowlist = "current_projects|current_agents|current_work|current_resources|current_coordination|current_issues|current_issue_dependencies";
  assert.match(nginx, new RegExp(`location ~ \\^/supabase/rest/v1/\\(${allowlist}\\)/\\?\\$`));
  assert.match(nginx, new RegExp(`rewrite \\^/supabase/rest/v1/\\(${allowlist}\\)/\\?\\$ /rest/v1/\\$1 break`));
  assert.match(nginx, /\$request_method !~ \^\(GET\|HEAD\|OPTIONS\)\$/);
  assert.match(nginx, /location \/supabase\/rest\/v1\/ \{\s*return 404;/);
  assert.doesNotMatch(nginx, /\/rest\/v1\/rpc|location[^\n]*\/rpc/);
});
