import http from "node:http";
import { pathToFileURL } from "node:url";
import { createClient } from "@supabase/supabase-js";

export const AGENT_STATE_SCHEMA = "agent_private";
export const READABLE_TABLES = Object.freeze([
  "current_projects",
  "current_agents",
  "current_work",
  "current_resources",
  "current_coordination",
]);

const TABLE_ORDER_COLUMNS = Object.freeze({
  current_projects: ["project_key"],
  current_agents: ["project_key", "agent"],
  current_work: ["project_key", "work_key"],
  current_resources: ["project_key", "resource_key"],
  current_coordination: ["project_key", "sender", "recipient"],
});

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 8788;
const DEFAULT_PAGE_SIZE = 1_000;
const DEFAULT_POLL_INTERVAL_MS = 15_000;
const DEFAULT_HEARTBEAT_MS = 20_000;
const DEFAULT_RECONNECT_MS = 1_000;
const DEFAULT_SSE_RETRY_MS = 3_000;
const MAX_RECONNECT_MS = 30_000;

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

export function readRuntimeConfig(env = process.env) {
  const supabaseUrl = text(env.SUPABASE_URL);
  const supabaseSecretKey = text(env.SUPABASE_SECRET_KEY);
  if (!supabaseUrl) throw new Error("Missing required server environment variable: SUPABASE_URL");
  if (!supabaseSecretKey) throw new Error("Missing required server environment variable: SUPABASE_SECRET_KEY");

  const host = text(env.HOST) || text(env.SERVER_HOST) || DEFAULT_HOST;
  const rawPort = text(env.PORT) || text(env.SERVER_PORT);
  const port = rawPort ? Number(rawPort) : DEFAULT_PORT;
  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    throw new Error("PORT must be an integer between 0 and 65535");
  }

  return { supabaseUrl, supabaseSecretKey, host, port };
}

export function assertReadableTable(table) {
  if (!READABLE_TABLES.includes(table)) {
    const error = new Error("Unknown Agent State table");
    error.statusCode = 404;
    throw error;
  }
  return table;
}

export function createSupabaseClient(config) {
  return createClient(config.supabaseUrl, config.supabaseSecretKey, {
    db: { schema: AGENT_STATE_SCHEMA },
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: {
      headers: { "X-Client-Info": "streamscapetv-agent-state-dashboard-server" },
    },
  });
}

function normalizeReadError(error) {
  if (!error) return null;
  const normalized = new Error("Agent State read failed");
  normalized.statusCode = 503;
  return normalized;
}

function pageSize(value) {
  if (value === undefined) return DEFAULT_PAGE_SIZE;
  if (!Number.isInteger(value) || value < 1) throw new TypeError("pageSize must be a positive integer");
  return Math.min(value, DEFAULT_PAGE_SIZE);
}

export async function readTable(client, table, options = {}) {
  assertReadableTable(table);
  const limit = pageSize(options.pageSize);
  const rows = [];
  let from = 0;
  let totalRows = null;

  while (true) {
    const tableQuery = client.from(table);
    let query = totalRows === null
      ? tableQuery.select("*", { count: "exact" })
      : tableQuery.select("*");
    for (const column of TABLE_ORDER_COLUMNS[table]) {
      query = query.order(column, { ascending: true });
    }
    const result = await query.range(from, from + limit - 1);
    if (result.error) throw normalizeReadError(result.error);

    if (totalRows === null && Number.isInteger(result.count) && result.count >= 0) {
      totalRows = result.count;
    }
    const currentPage = Array.isArray(result.data) ? result.data : [];
    rows.push(...currentPage);

    if (totalRows !== null && rows.length >= totalRows) return rows;
    if (currentPage.length === 0) return rows;
    from += currentPage.length;
  }
}

export async function readSnapshot(client) {
  const entries = await Promise.all(
    READABLE_TABLES.map(async (table) => [table, await readTable(client, table)]),
  );
  return Object.fromEntries(entries);
}

function json(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "content-length": Buffer.byteLength(body),
  });
  res.end(body);
}

function sseWrite(res, event, payload) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

export function createLiveController(client, options = {}) {
  const setTimer = options.setTimeout ?? setTimeout;
  const clearTimer = options.clearTimeout ?? clearTimeout;
  const setEvery = options.setInterval ?? setInterval;
  const clearEvery = options.clearInterval ?? clearInterval;
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const heartbeatMs = options.heartbeatMs ?? DEFAULT_HEARTBEAT_MS;
  const initialReconnectMs = options.reconnectMs ?? DEFAULT_RECONNECT_MS;
  const sseRetryMs = options.sseRetryMs ?? DEFAULT_SSE_RETRY_MS;

  const clients = new Set();
  let channel = null;
  let pollTimer = null;
  let heartbeatTimer = null;
  let reconnectTimer = null;
  let reconnectDelay = initialReconnectMs;
  let liveStatus = "starting";
  let stopped = false;

  const broadcast = (event, payload) => {
    for (const res of [...clients]) {
      if (res.destroyed || res.writableEnded) {
        clients.delete(res);
        continue;
      }
      try {
        sseWrite(res, event, payload);
      } catch {
        clients.delete(res);
      }
    }
  };

  const setStatus = (status) => {
    liveStatus = status;
    broadcast("status", { status });
  };

  const removeChannel = async (target) => {
    if (!target || typeof client.removeChannel !== "function") return;
    try {
      await client.removeChannel(target);
    } catch {
      // Realtime cleanup is best-effort; reconnect/refetch remains authoritative.
    }
  };

  const scheduleReconnect = () => {
    if (stopped || reconnectTimer) return;
    setStatus("reconnecting");
    reconnectTimer = setTimer(() => {
      reconnectTimer = null;
      if (!channel) subscribe();
    }, reconnectDelay);
    reconnectDelay = Math.min(reconnectDelay * 2, MAX_RECONNECT_MS);
  };

  const subscribe = () => {
    if (stopped || channel) return;

    let nextChannel;
    try {
      nextChannel = client.channel("agent-state-dashboard-current");
      for (const table of READABLE_TABLES) {
        nextChannel = nextChannel.on(
          "postgres_changes",
          { event: "*", schema: AGENT_STATE_SCHEMA, table },
          (payload) => {
            broadcast("invalidate", {
              table,
              eventType: payload?.eventType ?? "unknown",
            });
          },
        );
      }
      channel = nextChannel;
      nextChannel.subscribe((status) => {
        if (stopped || channel !== nextChannel) return;
        if (status === "SUBSCRIBED") {
          reconnectDelay = initialReconnectMs;
          setStatus("live");
          return;
        }
        if (["CHANNEL_ERROR", "TIMED_OUT", "CLOSED"].includes(status)) {
          channel = null;
          void removeChannel(nextChannel);
          scheduleReconnect();
        }
      });
    } catch {
      if (channel === nextChannel) channel = null;
      void removeChannel(nextChannel);
      scheduleReconnect();
    }
  };

  const start = () => {
    if (pollTimer || stopped) return;
    subscribe();
    pollTimer = setEvery(() => {
      broadcast("refresh", { source: "polling-fallback" });
    }, pollIntervalMs);
    heartbeatTimer = setEvery(() => {
      for (const res of [...clients]) {
        if (res.destroyed || res.writableEnded) {
          clients.delete(res);
          continue;
        }
        try {
          res.write(": heartbeat\n\n");
        } catch {
          clients.delete(res);
        }
      }
    }, heartbeatMs);
  };

  const attach = (req, res) => {
    res.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    });
    res.write(`retry: ${sseRetryMs}\n\n`);
    clients.add(res);
    sseWrite(res, "status", { status: liveStatus });
    sseWrite(res, "refresh", { source: "initial" });
    req.on("close", () => clients.delete(res));
  };

  const stop = async () => {
    stopped = true;
    if (pollTimer) clearEvery(pollTimer);
    if (heartbeatTimer) clearEvery(heartbeatTimer);
    if (reconnectTimer) clearTimer(reconnectTimer);
    pollTimer = null;
    heartbeatTimer = null;
    reconnectTimer = null;
    for (const res of clients) {
      if (!res.writableEnded) res.end();
    }
    clients.clear();
    const activeChannel = channel;
    channel = null;
    await removeChannel(activeChannel);
    liveStatus = "stopped";
  };

  return {
    start,
    stop,
    attach,
    status: () => liveStatus,
    broadcast,
  };
}

export function createRequestHandler({ client, live }) {
  return async function requestHandler(req, res) {
    try {
      if (req.method !== "GET") {
        json(res, 405, { error: "method_not_allowed" });
        return;
      }

      const url = new URL(req.url ?? "/", "http://dashboard.local");
      if (url.pathname === "/healthz") {
        json(res, 200, { status: "ok", live: live.status() });
        return;
      }
      if (url.pathname === "/api/snapshot") {
        const tables = await readSnapshot(client);
        json(res, 200, { tables, refreshedAt: new Date().toISOString() });
        return;
      }
      if (url.pathname.startsWith("/api/tables/")) {
        const table = decodeURIComponent(url.pathname.slice("/api/tables/".length));
        json(res, 200, { table, rows: await readTable(client, table) });
        return;
      }
      if (url.pathname === "/events") {
        live.attach(req, res);
        return;
      }

      json(res, 404, { error: "not_found" });
    } catch (error) {
      const statusCode = Number.isInteger(error?.statusCode) ? error.statusCode : 500;
      json(res, statusCode, {
        error: statusCode === 503 ? "agent_state_unavailable" : statusCode === 404 ? "not_found" : "internal_error",
      });
    }
  };
}

export function createDashboardServer(options = {}) {
  const config = options.config ?? readRuntimeConfig(options.env);
  const client = options.client ?? createSupabaseClient(config);
  const live = options.live ?? createLiveController(client, options.liveOptions);
  const server = http.createServer(createRequestHandler({ client, live }));

  return {
    config,
    client,
    live,
    server,
    async start() {
      try {
        live.start();
        await new Promise((resolve, reject) => {
          const onError = (error) => {
            server.off("listening", onListening);
            reject(error);
          };
          const onListening = () => {
            server.off("error", onError);
            resolve();
          };
          server.once("error", onError);
          server.once("listening", onListening);
          server.listen(config.port, config.host);
        });
        return server.address();
      } catch (error) {
        try {
          await live.stop();
        } catch {
          // Preserve the original startup failure without leaking cleanup details.
        }
        throw error;
      }
    },
    async stop() {
      await live.stop();
      if (!server.listening) return;
      await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    },
  };
}

async function main() {
  const runtime = createDashboardServer();
  const shutdown = async () => {
    try {
      await runtime.stop();
      process.exitCode = 0;
    } catch {
      process.exitCode = 1;
    }
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
  await runtime.start();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => {
    console.error("Server startup failed");
    process.exitCode = 1;
  });
}
