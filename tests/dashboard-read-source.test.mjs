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

function loadBoundary() {
  const productionSource = {
    tables: allTables,
    readSnapshot: async () => ({ tables: {}, errors: {}, refreshedAt: "production" }),
    readTable: async () => [],
    subscribe: () => () => {},
  };
  let factoryCalls = 0;
  const { source, output } = transpile("lib/dashboard-read-source.ts");
  const module = { exports: {} };
  new Function("exports", "module", "require", output)(module.exports, module, (specifier) => {
    if (specifier === "@/lib/agent-state-read-contract") {
      return { DASHBOARD_TABLE_NAMES: allTables };
    }
    if (specifier === "@/lib/dashboard-supabase") {
      return {
        createSupabaseDashboardReadSource() {
          factoryCalls += 1;
          return productionSource;
        },
      };
    }
    throw new Error(`Unexpected boundary runtime import: ${specifier}`);
  });
  return { boundary: module.exports, source, productionSource, factoryCalls: () => factoryCalls };
}

function loadTransport() {
  const { output } = transpile("lib/dashboard-supabase.ts");
  const module = { exports: {} };
  new Function("exports", "module", "require", output)(module.exports, module, (specifier) => {
    if (specifier === "@supabase/supabase-js") return { createClient: () => ({}) };
    if (specifier === "@/lib/agent-state-read-contract") {
      return {
        DASHBOARD_TABLE_NAMES: allTables,
        ISSUE_TABLE_NAMES: issueTables,
        isIssueTableName: (table) => issueTables.includes(table),
      };
    }
    if (specifier === "@/types/dashboard") return { RAW_TABLE_NAMES: coreTables };
    throw new Error(`Unexpected adapter runtime import: ${specifier}`);
  });
  return module.exports;
}

function fakeReadClient({ errors = {}, rows = {} } = {}) {
  const seenTables = [];
  return {
    seenTables,
    from(table) {
      seenTables.push(table);
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

function fakeRealtimeClient() {
  const channels = [];
  const removed = [];
  return {
    channels,
    removed,
    channel(name) {
      const filters = [];
      const channel = {
        name,
        filters,
        on(_kind, filter) {
          filters.push(filter);
          return channel;
        },
        subscribe(callback) {
          callback?.("SUBSCRIBED");
          return channel;
        },
      };
      channels.push(channel);
      return channel;
    },
    async removeChannel(channel) {
      removed.push(channel.name);
    },
  };
}

const { boundary, source: boundarySource, productionSource, factoryCalls } = loadBoundary();
const transport = loadTransport();
const hookSource = readFileSync(new URL("../lib/use-dashboard-tables.ts", import.meta.url), "utf8");

test("read-source contract is one bounded provider-neutral seam with a singleton production source", async () => {
  assert.deepEqual(boundary.DASHBOARD_READ_TABLES, allTables);
  assert.match(boundarySource, /export interface DashboardReadSource[\s\S]*readSnapshot[\s\S]*readTable[\s\S]*subscribe/);
  assert.doesNotMatch(boundarySource, /providerRegistry|registerProvider|providerSelector|wrangler|cloudflare|\bD1\b|\bR2\b/i);

  assert.equal(boundary.getDashboardReadSource(), productionSource);
  assert.equal(boundary.getDashboardReadSource(), productionSource);
  assert.equal(factoryCalls(), 1);

  const calls = [];
  const fakeSource = {
    tables: allTables,
    async readSnapshot() {
      calls.push("snapshot");
      return { tables: { current_projects: [{ project_key: "demo" }] }, errors: {}, refreshedAt: "now" };
    },
    async readTable(table) {
      calls.push(`table:${table}`);
      return [{ table }];
    },
    subscribe(handlers) {
      calls.push("subscribe");
      handlers.onStatus("live");
      return () => calls.push("cleanup");
    },
  };

  const snapshot = await fakeSource.readSnapshot();
  assert.deepEqual(snapshot.tables.current_projects, [{ project_key: "demo" }]);
  assert.deepEqual(await fakeSource.readTable("current_issues"), [{ table: "current_issues" }]);
  let status = null;
  const cleanup = fakeSource.subscribe({ onStatus: (next) => { status = next; }, onChange: () => {} });
  cleanup();
  assert.equal(status, "live");
  assert.deepEqual(calls, ["snapshot", "table:current_issues", "subscribe", "cleanup"]);
});

test("Supabase adapter reads the exact seven tables and keeps rollout-only PGRST205 normalization behind the boundary", async () => {
  const client = fakeReadClient({
    rows: {
      current_projects: [{ project_key: "demo" }],
      current_issues: [{ project_key: "demo", issue_number: 82 }],
    },
  });
  const source = transport.createSupabaseDashboardReadSource(() => client);

  assert.deepEqual(source.tables, allTables);
  const snapshot = await source.readSnapshot();
  assert.deepEqual([...new Set(client.seenTables)], allTables);
  assert.deepEqual(snapshot.tables.current_projects, [{ project_key: "demo" }]);
  assert.deepEqual(snapshot.tables.current_issues, [{ project_key: "demo", issue_number: 82 }]);

  const rolloutMissing = transport.createSupabaseDashboardReadSource(() => fakeReadClient({
    errors: { current_issues: { code: "PGRST205" } },
  }));
  assert.deepEqual(await rolloutMissing.readTable("current_issues"), []);

  const missingCore = transport.createSupabaseDashboardReadSource(() => fakeReadClient({
    errors: { current_agents: { code: "PGRST205" } },
  }));
  await assert.rejects(() => missingCore.readTable("current_agents"), /Dashboard read failed for current_agents/);

  const unexpectedAdditive = transport.createSupabaseDashboardReadSource(() => fakeReadClient({
    errors: { current_issues: { code: "42501" } },
  }));
  await assert.rejects(() => unexpectedAdditive.readTable("current_issues"), /Dashboard read failed for current_issues/);
});

test("Supabase adapter preserves core status authority, separate additive invalidation channel and cleanup", () => {
  const client = fakeRealtimeClient();
  const source = transport.createSupabaseDashboardReadSource(() => client);
  const statuses = [];
  const cleanup = source.subscribe({ onStatus: (status) => statuses.push(status), onChange: () => {} });

  assert.deepEqual(client.channels.map((channel) => channel.name), [
    "agent-state-dashboard-current",
    "agent-state-dashboard-issues",
  ]);
  assert.deepEqual(client.channels[0].filters.map((filter) => filter.table), coreTables);
  assert.deepEqual(client.channels[1].filters.map((filter) => filter.table), issueTables);
  assert.deepEqual(statuses, ["connecting", "live"]);

  cleanup();
  assert.deepEqual(client.removed, ["agent-state-dashboard-current", "agent-state-dashboard-issues"]);
});

test("application hook depends on the read-source boundary rather than Supabase transport orchestration", () => {
  assert.match(hookSource, /from "@\/lib\/dashboard-read-source"/);
  assert.match(hookSource, /getDashboardReadSource\(\)/);
  assert.match(hookSource, /source\.readSnapshot\(\{ signal: controller\.signal \}\)/);
  assert.match(hookSource, /source\.readTable\(table, \{ signal: controller\.signal \}\)/);
  assert.match(hookSource, /source\.subscribe\(\{/);
  assert.doesNotMatch(hookSource, /getDashboardSupabaseClient|readDashboardSnapshot|readDashboardTable|subscribeToDashboardChanges|isMissingAdditiveTableError/);
  assert.doesNotMatch(hookSource, /wrangler|cloudflare|\bD1\b|\bR2\b/i);
});
