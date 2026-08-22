import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  DASHBOARD_TABLE_NAMES,
  ISSUE_TABLE_NAMES,
  isIssueTableName,
  type DashboardTableName,
} from "@/lib/agent-state-read-contract";
import type { DashboardRealtimeChange, DashboardRealtimeEventType } from "@/lib/realtime-dashboard-state";
import { RAW_TABLE_NAMES } from "@/types/dashboard";

export const AGENT_STATE_SCHEMA = "agent_private";
export const DASHBOARD_PROXY_PATH = "/supabase";
// supabase-js forwards its client key into Realtime channel auth. Keep the
// browser value explicitly non-secret but in the recognized sb_publishable_*
// API-key shape so Realtime treats it as an API key and falls back to the
// WebSocket tenant token that NGINX authenticates server-side.
export const DASHBOARD_PLACEHOLDER_KEY = "sb_publishable_dashboard_proxy_placeholder";
export const DASHBOARD_TABLES: readonly DashboardTableName[] = DASHBOARD_TABLE_NAMES;

const DEFAULT_PAGE_SIZE = 1_000;
const MISSING_TABLE_CODE = "PGRST205";

const TABLE_ORDER_COLUMNS: Record<DashboardTableName, readonly string[]> = {
  current_projects: ["project_key"],
  current_agents: ["project_key", "agent"],
  current_work: ["project_key", "work_key"],
  current_resources: ["project_key", "resource_key"],
  current_coordination: ["project_key", "sender", "recipient"],
  current_issues: ["project_key", "issue_number"],
  current_issue_dependencies: [
    "dependent_project_key",
    "dependent_issue_number",
    "blocker_project_key",
    "blocker_issue_number",
  ],
};

export interface DashboardRawSnapshot {
  tables: Partial<Record<DashboardTableName, unknown[]>>;
  errors: Partial<Record<DashboardTableName, string>>;
  refreshedAt: string;
}

export interface DashboardRealtimeHandlers {
  onStatus: (status: "connecting" | "live" | "reconnecting") => void;
  onChange: (change: DashboardRealtimeChange) => void;
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

interface PostgrestErrorLike {
  code?: unknown;
}

export class DashboardTableReadError extends Error {
  readonly table: DashboardTableName;
  readonly code: string | null;

  constructor(table: DashboardTableName, error: PostgrestErrorLike | null | undefined) {
    super(`Dashboard read failed for ${table}`);
    this.name = "DashboardTableReadError";
    this.table = table;
    this.code = typeof error?.code === "string" ? error.code : null;
  }
}

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
  table: DashboardTableName,
  options: ReadTableOptions = {},
): Promise<unknown[]> {
  const limit = pageSize(options.pageSize);
  const rows: unknown[] = [];
  let from = 0;
  let totalRows: number | null = null;

  while (true) {
    const tableQuery = client.from(table);
    let query: ReturnType<typeof tableQuery.select> = totalRows === null
      ? tableQuery.select("*", { count: "exact" })
      : tableQuery.select("*");

    for (const column of TABLE_ORDER_COLUMNS[table]) {
      query = query.order(column, { ascending: true });
    }
    if (options.signal) query = query.abortSignal(options.signal);

    const result = await query.range(from, from + limit - 1);
    if (result.error) throw new DashboardTableReadError(table, result.error);

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

export function isMissingAdditiveTableError(
  caught: unknown,
  table: DashboardTableName,
): boolean {
  return isIssueTableName(table)
    && caught instanceof DashboardTableReadError
    && caught.code === MISSING_TABLE_CODE;
}

function errorMessage(caught: unknown, table: DashboardTableName): string {
  return caught instanceof Error && caught.message.trim().length > 0
    ? caught.message
    : `Dashboard read failed for ${table}`;
}

export async function readDashboardSnapshot(
  client: DashboardSupabaseClient,
  options: Pick<ReadTableOptions, "signal"> = {},
): Promise<DashboardRawSnapshot> {
  const results = await Promise.allSettled(
    DASHBOARD_TABLES.map((table) => readDashboardTable(client, table, options)),
  );

  if (options.signal?.aborted) {
    const aborted = new Error("Dashboard snapshot read aborted");
    aborted.name = "AbortError";
    throw aborted;
  }

  const tables: Partial<Record<DashboardTableName, unknown[]>> = {};
  const errors: Partial<Record<DashboardTableName, string>> = {};
  for (let index = 0; index < DASHBOARD_TABLES.length; index += 1) {
    const table = DASHBOARD_TABLES[index];
    const result = results[index];
    if (result.status === "fulfilled") {
      tables[table] = result.value;
      continue;
    }
    if (isMissingAdditiveTableError(result.reason, table)) {
      tables[table] = [];
      continue;
    }
    errors[table] = errorMessage(result.reason, table);
  }

  return {
    tables,
    errors,
    refreshedAt: new Date().toISOString(),
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function realtimeEventType(value: unknown): DashboardRealtimeEventType | null {
  return value === "INSERT" || value === "UPDATE" || value === "DELETE" ? value : null;
}

function attachTableSubscriptions(
  channel: ReturnType<DashboardSupabaseClient["channel"]>,
  tables: readonly DashboardTableName[],
  active: () => boolean,
  onChange: (change: DashboardRealtimeChange) => void,
): ReturnType<DashboardSupabaseClient["channel"]> {
  let next = channel;
  for (const table of tables) {
    next = next.on(
      "postgres_changes",
      { event: "*", schema: AGENT_STATE_SCHEMA, table },
      (payload) => {
        if (!active()) return;
        const eventType = realtimeEventType(payload?.eventType);
        if (!eventType) return;
        onChange({
          table,
          eventType,
          newRow: asRecord(payload?.new),
          oldRow: asRecord(payload?.old),
          observedAt: new Date().toISOString(),
        });
      },
    );
  }
  return next;
}

export function subscribeToDashboardChanges(
  client: DashboardSupabaseClient,
  handlers: DashboardRealtimeHandlers,
): () => void {
  let active = true;
  handlers.onStatus("connecting");

  let coreChannel = client.channel("agent-state-dashboard-current");
  coreChannel = attachTableSubscriptions(
    coreChannel,
    RAW_TABLE_NAMES,
    () => active,
    handlers.onChange,
  );

  // Keep the additive issue tables on a separate channel during rollout. A
  // pre-migration subscription error must not downgrade the established five-
  // table Realtime connection; once hosted, the same canonical subscription
  // receives changes without a schema/version negotiation path.
  let issueChannel = client.channel("agent-state-dashboard-issues");
  issueChannel = attachTableSubscriptions(
    issueChannel,
    ISSUE_TABLE_NAMES,
    () => active,
    handlers.onChange,
  );

  coreChannel.subscribe((status) => {
    if (!active) return;
    if (status === "SUBSCRIBED") {
      handlers.onStatus("live");
      return;
    }
    if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
      handlers.onStatus("reconnecting");
    }
  });
  issueChannel.subscribe();

  return () => {
    active = false;
    void client.removeChannel(coreChannel);
    void client.removeChannel(issueChannel);
  };
}
