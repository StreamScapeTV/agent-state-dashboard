import type {
  AgentBaseStatus,
  AgentViewRow,
  CurrentWorkRecord,
  IdentityKind,
  JsonValue,
} from "@/types/dashboard";

export type WorkOwnerStatus = AgentBaseStatus | "blocked" | "unknown";

export interface WorkBoardItem {
  key: string;
  projectKey: string;
  workKey: string;
  identity: string;
  identityKind: IdentityKind | "unknown";
  owner: AgentViewRow | null;
  ownerStatus: AgentBaseStatus | "unknown";
  blocked: boolean;
  assignmentExcerpt: string | null;
  assignmentContext: JsonValue | null;
  workSummary: string;
  workStatus: string | null;
  nextAction: string | null;
  resourceCount: number;
  coordinationCount: number;
  assignedAt: string | null;
  lastReturnedAt: string | null;
  durationMs: number | null;
  work: CurrentWorkRecord;
}

export interface WorkBoardFilters {
  project: string;
  identity: string;
  identityKind: IdentityKind | "all";
  ownerStatus: WorkOwnerStatus | "all";
  query: string;
}

export interface WorkBoardGroup {
  projectKey: string;
  items: WorkBoardItem[];
}

function isObject(value: JsonValue): value is { [key: string]: JsonValue } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function firstString(value: JsonValue, keys: string[], depth = 0): string | null {
  if (depth > 4 || value === null || typeof value !== "object") return null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = firstString(item, keys, depth + 1);
      if (found) return found;
    }
    return null;
  }

  for (const key of keys) {
    const candidate = value[key];
    if (typeof candidate === "string" && candidate.trim().length > 0) return candidate.trim();
  }
  for (const candidate of Object.values(value)) {
    const found = firstString(candidate, keys, depth + 1);
    if (found) return found;
  }
  return null;
}

function firstLine(value: string | null): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.split(/\r?\n/, 1)[0] ?? null;
}

function ownerKey(projectKey: string, identity: string): string {
  return `${projectKey}::${identity}`;
}

export function buildWorkBoardItems(
  work: CurrentWorkRecord[],
  agents: AgentViewRow[],
): WorkBoardItem[] {
  const owners = new Map(agents.map((row) => [ownerKey(row.projectKey, row.identity), row]));

  return work
    .map((item) => {
      const owner = owners.get(ownerKey(item.projectKey, item.identity)) ?? null;
      const workStatus = firstString(item.state, ["status", "phase"]);
      const workSummary =
        firstString(item.state, ["objective", "summary", "title", "status", "phase"])
        ?? "Current work";
      const nextAction = firstString(item.state, ["next_action", "nextAction", "next", "checkpoint"]);
      const assignmentExcerpt = firstLine(owner?.assignment?.instructions ?? owner?.prompt ?? null);

      return {
        key: `${item.projectKey}::${item.identity}::${item.workKey}`,
        projectKey: item.projectKey,
        workKey: item.workKey,
        identity: item.identity,
        identityKind: owner?.identityKind ?? "unknown",
        owner,
        ownerStatus: owner?.baseStatus ?? "unknown",
        blocked: owner?.blocked ?? false,
        assignmentExcerpt,
        assignmentContext: owner?.assignment?.context ?? null,
        workSummary,
        workStatus,
        nextAction,
        resourceCount: owner?.resources.length ?? 0,
        coordinationCount: owner?.coordination.length ?? 0,
        assignedAt: owner?.assignedAt ?? null,
        lastReturnedAt: owner?.lastReturnedAt ?? null,
        durationMs: owner?.durationMs ?? null,
        work: item,
      } satisfies WorkBoardItem;
    })
    .sort((left, right) =>
      left.projectKey.localeCompare(right.projectKey)
      || left.identity.localeCompare(right.identity, undefined, { numeric: true })
      || left.workKey.localeCompare(right.workKey, undefined, { numeric: true }),
    );
}

function matchesOwnerStatus(item: WorkBoardItem, status: WorkBoardFilters["ownerStatus"]): boolean {
  if (status === "all") return true;
  if (status === "blocked") return item.blocked;
  return item.ownerStatus === status;
}

function searchableText(item: WorkBoardItem): string {
  return [
    item.projectKey,
    item.workKey,
    item.identity,
    item.identityKind,
    item.ownerStatus,
    item.blocked ? "blocked" : "",
    item.assignmentExcerpt ?? "",
    item.assignmentContext === null ? "" : JSON.stringify(item.assignmentContext),
    item.workSummary,
    item.workStatus ?? "",
    item.nextAction ?? "",
    JSON.stringify(item.work.state),
  ]
    .join(" ")
    .toLowerCase();
}

export function filterWorkBoardItems(
  items: WorkBoardItem[],
  filters: WorkBoardFilters,
): WorkBoardItem[] {
  const needle = filters.query.trim().toLowerCase();
  return items.filter((item) =>
    (filters.project === "all" || item.projectKey === filters.project)
    && (filters.identity === "all" || item.identity === filters.identity)
    && (filters.identityKind === "all" || item.identityKind === filters.identityKind)
    && matchesOwnerStatus(item, filters.ownerStatus)
    && (!needle || searchableText(item).includes(needle)),
  );
}

export function groupWorkBoardItems(items: WorkBoardItem[]): WorkBoardGroup[] {
  const groups = new Map<string, WorkBoardItem[]>();
  for (const item of items) {
    const existing = groups.get(item.projectKey);
    if (existing) existing.push(item);
    else groups.set(item.projectKey, [item]);
  }
  return [...groups.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([projectKey, projectItems]) => ({ projectKey, items: projectItems }));
}
