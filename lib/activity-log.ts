import type { DashboardTableName } from "@/lib/agent-state-read-contract";
import type {
  DashboardActivityItem,
  DashboardRealtimeEventType,
} from "@/lib/realtime-dashboard-state";

export type ActivityKindFilter = "all" | DashboardActivityItem["kind"];
export type ActivityTableFilter = "all" | DashboardTableName;
export type ActivityEventFilter = "all" | DashboardRealtimeEventType;

export interface ActivityLogFilters {
  projectKey: string | null;
  identity: string;
  kind: ActivityKindFilter;
  table: ActivityTableFilter;
  eventType: ActivityEventFilter;
}

function observedAtMs(item: DashboardActivityItem): number {
  const value = Date.parse(item.observedAt);
  return Number.isFinite(value) ? value : 0;
}

function projectMatches(item: DashboardActivityItem, projectKey: string | null): boolean {
  if (!projectKey) return true;
  // Connection/reconciliation events describe the current browser session rather
  // than one Agent State project, so retain them as explicitly Global context.
  if (item.kind !== "change") return true;
  return item.projectKey === projectKey;
}

export function filterActivityLog(
  items: readonly DashboardActivityItem[],
  filters: ActivityLogFilters,
): DashboardActivityItem[] {
  return [...items]
    .filter((item) =>
      projectMatches(item, filters.projectKey)
      && (filters.identity === "all" || item.identities?.includes(filters.identity) === true)
      && (filters.kind === "all" || item.kind === filters.kind)
      && (filters.table === "all" || item.table === filters.table)
      && (filters.eventType === "all" || item.eventType === filters.eventType),
    )
    .sort((left, right) =>
      observedAtMs(right) - observedAtMs(left)
      || right.id.localeCompare(left.id),
    );
}

export function activityIdentityOptions(
  items: readonly DashboardActivityItem[],
  projectKey: string | null,
): string[] {
  const identities = new Set<string>();
  for (const item of items) {
    if (!projectMatches(item, projectKey)) continue;
    for (const identity of item.identities ?? []) identities.add(identity);
  }
  return [...identities].sort((left, right) =>
    left.localeCompare(right, undefined, { numeric: true }),
  );
}
