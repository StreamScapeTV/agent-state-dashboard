import {
  DASHBOARD_TABLE_NAMES,
  type DashboardTableName,
} from "@/lib/agent-state-read-contract";
import { RAW_TABLE_NAMES, type RawTableName } from "@/types/dashboard";

export interface TableReadState {
  rows: unknown[];
  hasData: boolean;
  loading: boolean;
  stale: boolean;
  error: string | null;
  lastSuccessAt: string | null;
  requestId: number;
}

export type TableReadStates = Record<DashboardTableName, TableReadState>;
export type TableRequestIds = Record<DashboardTableName, number>;
export type DashboardFreshness = "loading" | "fresh" | "partial" | "stale";

export interface PartialTableSnapshot {
  tables: Partial<Record<DashboardTableName, unknown[]>>;
  errors: Partial<Record<DashboardTableName, string>>;
}

function initialTableState(): TableReadState {
  return {
    rows: [],
    hasData: false,
    loading: false,
    stale: false,
    error: null,
    lastSuccessAt: null,
    requestId: 0,
  };
}

export function createTableReadStates(): TableReadStates {
  return Object.fromEntries(
    DASHBOARD_TABLE_NAMES.map((table) => [table, initialTableState()]),
  ) as TableReadStates;
}

export function beginTableRead(
  states: TableReadStates,
  table: DashboardTableName,
  requestId: number,
): TableReadStates {
  if (requestId <= states[table].requestId) return states;
  return {
    ...states,
    [table]: {
      ...states[table],
      loading: true,
      error: null,
      requestId,
    },
  };
}

export function beginTableReads(
  states: TableReadStates,
  requestIds: TableRequestIds,
): TableReadStates {
  let next = states;
  for (const table of DASHBOARD_TABLE_NAMES) {
    next = beginTableRead(next, table, requestIds[table]);
  }
  return next;
}

export function completeTableRead(
  states: TableReadStates,
  table: DashboardTableName,
  requestId: number,
  rows: unknown[],
  successAt: string,
): TableReadStates {
  if (requestId !== states[table].requestId) return states;
  return {
    ...states,
    [table]: {
      rows,
      hasData: true,
      loading: false,
      stale: false,
      error: null,
      lastSuccessAt: successAt,
      requestId,
    },
  };
}

export function failTableRead(
  states: TableReadStates,
  table: DashboardTableName,
  requestId: number,
  error: string,
): TableReadStates {
  if (requestId !== states[table].requestId) return states;
  const previous = states[table];
  return {
    ...states,
    [table]: {
      ...previous,
      loading: false,
      stale: previous.hasData,
      error,
    },
  };
}

export function applyPartialSnapshot(
  states: TableReadStates,
  snapshot: PartialTableSnapshot,
  requestIds: TableRequestIds,
  successAt: string,
): TableReadStates {
  let next = states;
  for (const table of DASHBOARD_TABLE_NAMES) {
    if (Object.prototype.hasOwnProperty.call(snapshot.tables, table)) {
      next = completeTableRead(
        next,
        table,
        requestIds[table],
        snapshot.tables[table] ?? [],
        successAt,
      );
      continue;
    }
    next = failTableRead(
      next,
      table,
      requestIds[table],
      snapshot.errors[table] ?? `Dashboard read failed for ${table}`,
    );
  }
  return next;
}

export function snapshotInputFromTableStates(
  states: TableReadStates,
): { tables: Partial<Record<RawTableName, unknown[]>> } {
  const tables: Partial<Record<RawTableName, unknown[]>> = {};
  for (const table of RAW_TABLE_NAMES) {
    if (states[table].hasData) tables[table] = states[table].rows;
  }
  return { tables };
}

export function hasAnyTableData(states: TableReadStates): boolean {
  // Preserve the established UI/bootstrap meaning: the current dashboard has
  // usable data only when at least one of the original five authority tables
  // has data. Additive issue tables never manufacture a core snapshot.
  return RAW_TABLE_NAMES.some((table) => states[table].hasData);
}

export function hasAnyTableLoading(states: TableReadStates): boolean {
  return DASHBOARD_TABLE_NAMES.some((table) => states[table].loading);
}

export function latestTableSuccessAt(states: TableReadStates): string | null {
  let latest: { value: string; timestamp: number } | null = null;
  for (const table of DASHBOARD_TABLE_NAMES) {
    const value = states[table].lastSuccessAt;
    if (!value) continue;
    const timestamp = Date.parse(value);
    if (!Number.isFinite(timestamp)) continue;
    if (!latest || timestamp > latest.timestamp) latest = { value, timestamp };
  }
  return latest?.value ?? null;
}

export function dashboardFreshness(
  states: TableReadStates,
  nowMs: number,
  staleAfterMs: number,
): DashboardFreshness {
  const values = DASHBOARD_TABLE_NAMES.map((table) => states[table]);
  if (!RAW_TABLE_NAMES.some((table) => states[table].hasData)) {
    if (values.some((state) => state.error)) return "partial";
    return "loading";
  }

  if (values.some((state) => state.error && !state.hasData)) return "partial";
  if (values.some((state) => !state.hasData)) return "partial";
  if (values.some((state) => state.stale)) return "stale";

  const successTimes = values.map((state) => Date.parse(state.lastSuccessAt ?? ""));
  if (successTimes.some((value) => !Number.isFinite(value))) return "partial";
  if (successTimes.some((value) => nowMs - value > staleAfterMs)) return "stale";
  return "fresh";
}

export function tableHealthLabel(
  state: TableReadState,
  _nowMs: number,
  _staleAfterMs: number,
): "loading" | "refreshing" | "fresh" | "stale" | "failed" {
  if (!state.hasData) {
    if (state.loading || state.requestId === 0) return "loading";
    return "failed";
  }
  if (state.stale) return "stale";
  if (state.loading) return "refreshing";
  return "fresh";
}

export function tableIssues(states: TableReadStates): DashboardTableName[] {
  return DASHBOARD_TABLE_NAMES.filter((table) => {
    const state = states[table];
    return state.requestId > 0
      && !state.loading
      && (!state.hasData || state.stale || Boolean(state.error));
  });
}

export function nextRequestIds(
  current: TableRequestIds,
  tables: readonly DashboardTableName[],
): TableRequestIds {
  const next = { ...current };
  for (const table of tables) next[table] += 1;
  return next;
}

export function createRequestIds(): TableRequestIds {
  return Object.fromEntries(DASHBOARD_TABLE_NAMES.map((table) => [table, 0])) as TableRequestIds;
}
