import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { RAW_TABLE_NAMES, type RawTableName } from "@/types/dashboard";

export const AGENT_STATE_SCHEMA = "agent_private";
export const DASHBOARD_PROXY_PATH = "/supabase";
// supabase-js forwards its client key into Realtime channel auth. Keep the
// browser value explicitly non-secret but in the recognized sb_publishable_*
// API-key shape so Realtime treats it as an API key and falls back to the
// WebSocket tenant token that NGINX authenticates server-side.
export const DASHBOARD_PLACEHOLDER_KEY = "sb_publishable_dashboard_proxy_placeholder";
export const DASHBOARD_TABLES: readonly RawTableName[] = RAW_TABLE_NAMES;

const DEFAULT_PAGE_SIZE = 1_000;

const TABLE_ORDER_COLUMNS: Record<RawTableName, readonly string[]> = {
  current_projects: ["project_key"],
  current_agents: ["project_key", "agent"],
  current_work: ["project_key", "work_key"],
  current_resources: ["project_key", "resource_key"],
  current_coordination: ["project_key", "sender", "recipient"],
};

export interface DashboardRawSnapshot {
  tables: Record<RawTableName, unknown[]>;
  refreshedAt: string;
}

export interface DashboardRealtimeHandlers {
  onStatus: (status: "connecting" | "live" | "reconnecting") => void;
  onInvalidate: (table: RawTableName, eventType: string) => void;
}

interface ReadTableOptions {
  pageSize?: number;
  signal?: AbortSignal;
}

type DashboardSupabaseClient = SupabaseClient<
  any,
  typeof AGENT_STATE_SCHEMA,
  typeof AGENT_STATE_SCHEMA
>;

let browserClient: DashboardSupabaseClient | null = null;

export function dashboardProxyUrl(origin: string): string {
  const normalizedOrigin = origin.endsWith("/") ? origin : `${origin}/`;
  return new URL(DASHBOARD_PROXY_PATH.slice(1), normalizedOrigin).toString().replace(/\/$/, "");
}

export function getDashboardSupabaseClient(): DashboardSupabaseClient {
  if (browserClient) return browserClient;
  if (typeof window === "undefined") {
    throw new Error("Dashboard Supabase client is browser-only");
  }

  browserClient = createClient<any, typeof AGENT_STATE_SCHEMA>(
    dashboardProxyUrl(window.location.origin),
    DASHBOARD_PLACEHOLDER_KEY,
    {
      db: { schema: AGENT_STATE_SCHEMA },
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
      global: {
        headers: { "X-Client-Info": "streamscapetv-agent-state-dashboard-browser" },
      },
    },
  );
  return browserClient;
}

function pageSize(value: number | undefined): number {
  if (value === undefined) return DEFAULT_PAGE_SIZE;
  if (!Number.isInteger(value) || value < 1) {
    throw new TypeError("pageSize must be a positive integer");
  }
  return Math.min(value, DEFAULT_PAGE_SIZE);
}

export async function readDashboardTable(
  client: DashboardSupabaseClient,
  table: RawTableName,
  options: ReadTableOptions = {},
): Promise<unknown[]> {
  const limit = pageSize(options.pageSize);
  const rows: unknown[] = [];
  let from = 0;
  let totalRows: number | null = null;

  while (true) {
    const tableQuery = client.from(table);
    let query = totalRows === null
      ? tableQuery.select("*", { count: "exact" })
      : tableQuery.select("*");

    for (const column of TABLE_ORDER_COLUMNS[table]) {
      query = query.order(column, { ascending: true });
    }
    if (options.signal) query = query.abortSignal(options.signal);

    const result = await query.range(from, from + limit - 1);
    if (result.error) throw new Error(`Dashboard read failed for ${table}`);

    if (totalRows === null && Number.isInteger(result.count) && (result.count ?? -1) >= 0) {
      totalRows = result.count ?? 0;
    }
    const currentPage = Array.isArray(result.data) ? result.data : [];
    rows.push(...currentPage);

    if (totalRows !== null && rows.length >= totalRows) return rows;
    if (currentPage.length === 0) return rows;
    from += currentPage.length;
  }
}

export async function readDashboardSnapshot(
  client: DashboardSupabaseClient,
  options: Pick<ReadTableOptions, "signal"> = {},
): Promise<DashboardRawSnapshot> {
  const entries = await Promise.all(
    DASHBOARD_TABLES.map(async (table) => [
      table,
      await readDashboardTable(client, table, options),
    ] as const),
  );

  return {
    tables: Object.fromEntries(entries) as Record<RawTableName, unknown[]>,
    refreshedAt: new Date().toISOString(),
  };
}

export function subscribeToDashboardChanges(
  client: DashboardSupabaseClient,
  handlers: DashboardRealtimeHandlers,
): () => void {
  let active = true;
  handlers.onStatus("connecting");

  let channel = client.channel("agent-state-dashboard-current");
  for (const table of DASHBOARD_TABLES) {
    channel = channel.on(
      "postgres_changes",
      { event: "*", schema: AGENT_STATE_SCHEMA, table },
      (payload) => {
        if (!active) return;
        handlers.onInvalidate(
          table,
          typeof payload?.eventType === "string" ? payload.eventType : "unknown",
        );
      },
    );
  }

  channel.subscribe((status) => {
    if (!active) return;
    if (status === "SUBSCRIBED") {
      handlers.onStatus("live");
      return;
    }
    if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
      handlers.onStatus("reconnecting");
    }
  });

  return () => {
    active = false;
    void client.removeChannel(channel);
  };
}
