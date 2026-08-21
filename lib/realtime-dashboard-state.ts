import type { RawTableName } from "@/types/dashboard";
import type { TableReadStates } from "@/lib/table-refresh-state";

export type DashboardRealtimeEventType = "INSERT" | "UPDATE" | "DELETE";

export interface DashboardRealtimeChange {
  table: RawTableName;
  eventType: DashboardRealtimeEventType;
  newRow: Record<string, unknown> | null;
  oldRow: Record<string, unknown> | null;
  observedAt: string;
}

export interface DashboardActivityItem {
  id: string;
  observedAt: string;
  kind: "change" | "connection" | "reconcile";
  summary: string;
  table?: RawTableName;
  eventType?: DashboardRealtimeEventType;
  projectKey?: string;
  identities?: string[];
  rowKey?: string;
}

export const ACTIVITY_LIMIT = 50;

const TABLE_KEY_FIELDS: Record<RawTableName, readonly string[]> = {
  current_projects: ["project_key"],
  current_agents: ["project_key", "agent"],
  current_work: ["project_key", "work_key"],
  current_resources: ["project_key", "resource_key"],
  current_coordination: ["project_key", "sender", "recipient"],
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function stringField(row: Record<string, unknown> | null, key: string): string | null {
  const value = row?.[key];
  if (value === null || value === undefined) return null;
  const rendered = String(value).trim();
  return rendered.length > 0 ? rendered : null;
}

function activityRow(change: DashboardRealtimeChange): Record<string, unknown> | null {
  return change.eventType === "DELETE"
    ? change.oldRow ?? change.newRow
    : change.newRow ?? change.oldRow;
}

function activityIdentities(row: Record<string, unknown> | null): string[] {
  const identities = [
    stringField(row, "agent"),
    stringField(row, "sender"),
    stringField(row, "recipient"),
  ].filter((value): value is string => value !== null);
  return [...new Set(identities)];
}

export function realtimeRowKey(table: RawTableName, value: unknown): string | null {
  const row = asRecord(value);
  if (!row) return null;
  const parts: string[] = [];
  for (const field of TABLE_KEY_FIELDS[table]) {
    const raw = row[field];
    if (raw === null || raw === undefined) return null;
    const part = String(raw);
    if (part.length === 0) return null;
    parts.push(part);
  }
  return JSON.stringify(parts);
}

function sortedRows(table: RawTableName, rows: unknown[]): unknown[] {
  return [...rows].sort((left, right) => {
    const leftKey = realtimeRowKey(table, left) ?? "";
    const rightKey = realtimeRowKey(table, right) ?? "";
    return leftKey.localeCompare(rightKey, undefined, { numeric: true });
  });
}

export interface RealtimeRowApplyResult {
  rows: unknown[];
  applied: boolean;
  rowKey: string | null;
}

export function applyRealtimeChangeRows(
  rows: unknown[],
  change: DashboardRealtimeChange,
): RealtimeRowApplyResult {
  const oldKey = realtimeRowKey(change.table, change.oldRow);
  const newKey = realtimeRowKey(change.table, change.newRow);

  if (change.eventType === "DELETE") {
    const rowKey = oldKey ?? newKey;
    if (!rowKey) return { rows, applied: false, rowKey: null };
    return {
      rows: rows.filter((row) => realtimeRowKey(change.table, row) !== rowKey),
      applied: true,
      rowKey,
    };
  }

  if (!change.newRow || !newKey) return { rows, applied: false, rowKey: null };
  const keysToReplace = new Set([newKey]);
  if (oldKey) keysToReplace.add(oldKey);
  const nextRows = rows.filter((row) => {
    const key = realtimeRowKey(change.table, row);
    return key === null || !keysToReplace.has(key);
  });
  nextRows.push(change.newRow);
  return {
    rows: sortedRows(change.table, nextRows),
    applied: true,
    rowKey: newKey,
  };
}

export interface RealtimeStateApplyResult {
  states: TableReadStates;
  applied: boolean;
  rowKey: string | null;
}

export function applyRealtimeChangeToTableStates(
  states: TableReadStates,
  change: DashboardRealtimeChange,
): RealtimeStateApplyResult {
  const current = states[change.table];
  if (!current.hasData) return { states, applied: false, rowKey: null };
  const applied = applyRealtimeChangeRows(current.rows, change);
  if (!applied.applied) return { states, applied: false, rowKey: applied.rowKey };
  return {
    states: {
      ...states,
      [change.table]: {
        ...current,
        rows: applied.rows,
      },
    },
    applied: true,
    rowKey: applied.rowKey,
  };
}

export function replayRealtimeChanges(
  states: TableReadStates,
  changes: readonly DashboardRealtimeChange[],
): TableReadStates {
  let next = states;
  for (const change of changes) {
    next = applyRealtimeChangeToTableStates(next, change).states;
  }
  return next;
}

function activityId(observedAt: string, suffix: string): string {
  return `${observedAt}:${suffix}`;
}

export function activityFromRealtimeChange(change: DashboardRealtimeChange): DashboardActivityItem {
  const row = activityRow(change);
  const rowKey = realtimeRowKey(change.table, row);
  const label = change.table.replace("current_", "");
  const verb = change.eventType === "INSERT"
    ? "created"
    : change.eventType === "DELETE"
      ? "removed"
      : "updated";
  const projectKey = stringField(row, "project_key");
  const identities = activityIdentities(row);
  return {
    id: activityId(change.observedAt, `${change.table}:${change.eventType}:${rowKey ?? "unknown"}`),
    observedAt: change.observedAt,
    kind: "change",
    table: change.table,
    eventType: change.eventType,
    ...(projectKey ? { projectKey } : {}),
    ...(identities.length > 0 ? { identities } : {}),
    ...(rowKey ? { rowKey } : {}),
    summary: `${label} ${rowKey ?? "unknown row"} ${verb}`,
  };
}

export function connectionActivity(
  observedAt: string,
  summary: string,
): DashboardActivityItem {
  return {
    id: activityId(observedAt, `connection:${summary}`),
    observedAt,
    kind: "connection",
    summary,
  };
}

export function reconciliationActivity(
  observedAt: string,
  summary: string,
): DashboardActivityItem {
  return {
    id: activityId(observedAt, `reconcile:${summary}`),
    observedAt,
    kind: "reconcile",
    summary,
  };
}

export function prependActivity(
  current: readonly DashboardActivityItem[],
  item: DashboardActivityItem,
  limit = ACTIVITY_LIMIT,
): DashboardActivityItem[] {
  const boundedLimit = Math.max(1, Math.floor(limit));
  return [item, ...current.filter((existing) => existing.id !== item.id)].slice(0, boundedLimit);
}
