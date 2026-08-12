import assert from "node:assert/strict";
import test from "node:test";
import {
  AGENT_STATE_SCHEMA,
  READABLE_TABLES,
  assertReadableTable,
  createDashboardServer,
  createLiveController,
  readRuntimeConfig,
  readSnapshot,
} from "../server/index.mjs";

function createFakeClient(fixtures = {}) {
  const subscriptions = [];
  const channels = [];
  const reads = [];

  return {
    subscriptions,
    channels,
    reads,
    from(table) {
      return {
        async select(selection) {
          reads.push({ table, selection });
          return { data: fixtures[table] ?? [], error: null };
        },
      };
    },
    channel(name) {
      const handlers = [];
      const channel = {
        name,
        handlers,
        statusCallback: null,
        on(kind, filter, callback) {
          handlers.push({ kind, filter, callback });
          return this;
        },
        subscribe(callback) {
          this.statusCallback = callback;
          subscriptions.push(this);
          return this;
        },
      };
      channels.push(channel);
      return channel;
    },
    async removeChannel(channel) {
      channel.removed = true;
      return "ok";
    },
  };
}

function createSseFixture() {
  const writes = [];
  const req = { on() {} };
  const res = {
    destroyed: false,
    writableEnded: false,
    writeHead(status, headers) {
      this.status = status;
      this.headers = headers;
    },
    write(chunk) {
      writes.push(chunk);
    },
    end() {
      this.writableEnded = true;
    },
  };
  return { req, res, writes };
}

async function listen(runtime) {
  const address = await runtime.start();
  assert.equal(typeof address, "object");
  return `http://127.0.0.1:${address.port}`;
}

test("runtime config requires server-only Supabase values and validates loopback fallbacks", () => {
  assert.throws(() => readRuntimeConfig({}), /SUPABASE_URL/);
  assert.throws(
    () => readRuntimeConfig({ SUPABASE_URL: "https://example.invalid", SUPABASE_SECRET_KEY: "secret", PORT: "nope" }),
    /PORT/,
  );
  assert.deepEqual(
    readRuntimeConfig({ SUPABASE_URL: " https://example.invalid ", SUPABASE_SECRET_KEY: " secret " }),
    {
      supabaseUrl: "https://example.invalid",
      supabaseSecretKey: "secret",
      host: "127.0.0.1",
      port: 8788,
    },
  );
  assert.deepEqual(
    readRuntimeConfig({
      SUPABASE_URL: "https://example.invalid",
      SUPABASE_SECRET_KEY: "secret",
      HOST: "   ",
      SERVER_HOST: "127.0.0.2",
      PORT: "   ",
      SERVER_PORT: "9876",
    }),
    {
      supabaseUrl: "https://example.invalid",
      supabaseSecretKey: "secret",
      host: "127.0.0.2",
      port: 9876,
    },
  );
});

test("table allowlist is exactly the five current Agent State authority tables", () => {
  assert.deepEqual(READABLE_TABLES, [
    "current_projects",
    "current_agents",
    "current_work",
    "current_resources",
    "current_coordination",
  ]);
  for (const table of READABLE_TABLES) assert.equal(assertReadableTable(table), table);
  assert.throws(() => assertReadableTable("current_history"), /Unknown Agent State table/);
});

test("snapshot reads all five tables and preserves authoritative current-agent fields", async () => {
  const fixtures = {
    current_projects: [{ project_key: "dashboard", state: { phase: "build" } }],
    current_agents: [
      {
        project_key: "dashboard",
        agent: "Agent 1",
        prompt: "work",
        prompt_assigned_at: "2026-08-12T01:00:00Z",
        last_response: "done",
        last_returned_at: "2026-08-12T01:01:00Z",
      },
    ],
    current_work: [{ project_key: "dashboard", work_key: "issue-5" }],
    current_resources: [{ project_key: "dashboard", resource_key: "server/**" }],
    current_coordination: [{ project_key: "dashboard", sender: "Agent 1", recipient: "Orchestrator" }],
  };
  const client = createFakeClient(fixtures);
  const snapshot = await readSnapshot(client);

  assert.deepEqual(Object.keys(snapshot), READABLE_TABLES);
  assert.equal(snapshot.current_agents[0].prompt_assigned_at, "2026-08-12T01:00:00Z");
  assert.equal(snapshot.current_agents[0].last_response, "done");
  assert.equal(snapshot.current_agents[0].last_returned_at, "2026-08-12T01:01:00Z");
  assert.deepEqual(client.reads, READABLE_TABLES.map((table) => ({ table, selection: "*" })));
});

test("Realtime subscribes to all five tables, removes failed channels, and ignores stale callbacks", async () => {
  const client = createFakeClient();
  const scheduled = [];
  const intervals = [];
  const live = createLiveController(client, {
    setTimeout(callback, delay) {
      scheduled.push({ callback, delay });
      return scheduled.length;
    },
    clearTimeout() {},
    setInterval(callback, delay) {
      intervals.push({ callback, delay });
      return intervals.length;
    },
    clearInterval() {},
    reconnectMs: 5,
    pollIntervalMs: 50,
    heartbeatMs: 100,
  });

  live.start();
  assert.equal(client.channels.length, 1);
  assert.deepEqual(
    client.channels[0].handlers.map(({ kind, filter }) => ({ kind, filter })),
    READABLE_TABLES.map((table) => ({
      kind: "postgres_changes",
      filter: { event: "*", schema: AGENT_STATE_SCHEMA, table },
    })),
  );

  const firstChannel = client.channels[0];
  firstChannel.statusCallback("SUBSCRIBED");
  assert.equal(live.status(), "live");
  firstChannel.statusCallback("CHANNEL_ERROR");
  assert.equal(live.status(), "reconnecting");
  assert.equal(firstChannel.removed, true);
  assert.equal(scheduled.length, 1);

  scheduled[0].callback();
  assert.equal(client.channels.length, 2);
  const secondChannel = client.channels[1];
  secondChannel.statusCallback("SUBSCRIBED");
  assert.equal(live.status(), "live");

  firstChannel.statusCallback("CLOSED");
  assert.equal(live.status(), "live");
  assert.equal(scheduled.length, 1);

  secondChannel.statusCallback("TIMED_OUT");
  assert.equal(live.status(), "reconnecting");
  assert.equal(secondChannel.removed, true);
  assert.equal(scheduled.length, 2);
  await live.stop();
});

test("Realtime invalidation events identify the changed table and operation without exposing row data", async () => {
  const client = createFakeClient();
  const live = createLiveController(client, {
    setInterval() {
      return 1;
    },
    clearInterval() {},
    setTimeout() {
      return 1;
    },
    clearTimeout() {},
  });
  const { req, res, writes } = createSseFixture();

  live.start();
  live.attach(req, res);
  const agentHandler = client.channels[0].handlers.find(
    ({ filter }) => filter.table === "current_agents",
  );
  assert.ok(agentHandler);

  for (const eventType of ["INSERT", "UPDATE", "DELETE"]) {
    agentHandler.callback({
      eventType,
      new: { prompt: "must-not-be-emitted" },
      old: { last_response: "must-not-be-emitted" },
    });
  }

  const output = writes.join("");
  assert.match(output, /event: invalidate/);
  assert.match(output, /"table":"current_agents"/);
  assert.match(output, /"eventType":"INSERT"/);
  assert.match(output, /"eventType":"UPDATE"/);
  assert.match(output, /"eventType":"DELETE"/);
  assert.doesNotMatch(output, /must-not-be-emitted/);
  await live.stop();
});

test("HTTP surface is GET-only, read-only, allowlisted, and does not expose configuration", async (t) => {
  const client = createFakeClient({
    current_projects: [{ project_key: "dashboard" }],
    current_agents: [],
    current_work: [],
    current_resources: [],
    current_coordination: [],
  });
  const runtime = createDashboardServer({
    config: {
      supabaseUrl: "https://sensitive.example.invalid",
      supabaseSecretKey: "super-secret-value",
      host: "127.0.0.1",
      port: 0,
    },
    client,
    liveOptions: { pollIntervalMs: 60_000, heartbeatMs: 60_000 },
  });
  t.after(() => runtime.stop());
  const base = await listen(runtime);

  const health = await fetch(`${base}/healthz`);
  assert.equal(health.status, 200);
  const healthText = await health.text();
  assert.doesNotMatch(healthText, /sensitive|super-secret/);

  const snapshot = await fetch(`${base}/api/snapshot`);
  assert.equal(snapshot.status, 200);
  const snapshotText = await snapshot.text();
  assert.doesNotMatch(snapshotText, /sensitive|super-secret/);
  const snapshotBody = JSON.parse(snapshotText);
  assert.equal(snapshotBody.tables.current_projects[0].project_key, "dashboard");
  assert.equal(Number.isNaN(Date.parse(snapshotBody.refreshedAt)), false);

  const table = await fetch(`${base}/api/tables/current_projects`);
  assert.equal(table.status, 200);
  assert.equal((await table.json()).table, "current_projects");

  const forbiddenTable = await fetch(`${base}/api/tables/current_history`);
  assert.equal(forbiddenTable.status, 404);

  const mutation = await fetch(`${base}/api/snapshot`, { method: "POST" });
  assert.equal(mutation.status, 405);
  assert.deepEqual(await mutation.json(), { error: "method_not_allowed" });

  const arbitrary = await fetch(`${base}/api/rpc/set_agent_state`);
  assert.equal(arbitrary.status, 404);
});

test("Supabase read failures return a generic response without leaking raw configuration or provider errors", async (t) => {
  const client = createFakeClient();
  client.from = () => ({
    async select() {
      return {
        data: null,
        error: {
          message: "failed against https://sensitive.example.invalid with super-secret-value",
        },
      };
    },
  });
  const runtime = createDashboardServer({
    config: {
      supabaseUrl: "https://sensitive.example.invalid",
      supabaseSecretKey: "super-secret-value",
      host: "127.0.0.1",
      port: 0,
    },
    client,
    liveOptions: { pollIntervalMs: 60_000, heartbeatMs: 60_000 },
  });
  t.after(() => runtime.stop());
  const base = await listen(runtime);

  const response = await fetch(`${base}/api/snapshot`);
  assert.equal(response.status, 503);
  const body = await response.text();
  assert.equal(body, JSON.stringify({ error: "agent_state_unavailable" }));
  assert.doesNotMatch(body, /sensitive|super-secret|failed against/);
});

test("SSE emits retry guidance, initial refresh, and polling fallback", async () => {
  const client = createFakeClient();
  const intervals = [];
  const live = createLiveController(client, {
    setInterval(callback, delay) {
      intervals.push({ callback, delay });
      return intervals.length;
    },
    clearInterval() {},
    setTimeout() {
      return 1;
    },
    clearTimeout() {},
    pollIntervalMs: 25,
    heartbeatMs: 50,
    sseRetryMs: 1234,
  });
  const { req, res, writes } = createSseFixture();

  live.start();
  live.attach(req, res);
  assert.equal(res.status, 200);
  assert.equal(res.headers["content-type"], "text/event-stream; charset=utf-8");
  assert.match(writes.join(""), /retry: 1234/);
  assert.match(writes.join(""), /event: refresh/);
  assert.match(writes.join(""), /"source":"initial"/);

  intervals[0].callback();
  assert.match(writes.join(""), /"source":"polling-fallback"/);
  await live.stop();
});

test("listen failure cleans up the live controller so timers and subscriptions do not keep the process alive", async (t) => {
  const first = createDashboardServer({
    config: {
      supabaseUrl: "https://example.invalid",
      supabaseSecretKey: "secret",
      host: "127.0.0.1",
      port: 0,
    },
    client: createFakeClient(),
    liveOptions: { pollIntervalMs: 60_000, heartbeatMs: 60_000 },
  });
  t.after(() => first.stop());
  const firstAddress = await first.start();
  assert.equal(typeof firstAddress, "object");

  const second = createDashboardServer({
    config: {
      supabaseUrl: "https://example.invalid",
      supabaseSecretKey: "secret",
      host: "127.0.0.1",
      port: firstAddress.port,
    },
    client: createFakeClient(),
    liveOptions: { pollIntervalMs: 60_000, heartbeatMs: 60_000 },
  });

  await assert.rejects(second.start(), (error) => error?.code === "EADDRINUSE");
  assert.equal(second.live.status(), "stopped");
  assert.equal(second.server.listening, false);
});
