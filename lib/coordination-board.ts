import type { AgentViewRow, CurrentCoordinationRecord, JsonValue } from "@/types/dashboard";

export type CoordinationDirection = "inbox" | "outbox" | "all";

export interface CoordinationBoardItem {
  key: string;
  projectKey: string;
  sender: string;
  recipient: string;
  senderAgent: AgentViewRow | null;
  recipientAgent: AgentViewRow | null;
  status: string | null;
  type: string | null;
  summary: string | null;
  objective: string | null;
  decision: string | null;
  blocker: string | null;
  nextAction: string | null;
  state: JsonValue;
}

export interface CoordinationFilters {
  direction: CoordinationDirection;
  identity: string;
  project: string;
  query: string;
}

export interface CoordinationCounts {
  total: number;
  projects: number;
  senders: number;
  recipients: number;
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

function coordinationKey(item: Pick<CurrentCoordinationRecord, "projectKey" | "sender" | "recipient">): string {
  return `${item.projectKey}::${item.sender}::${item.recipient}`;
}

function actorKey(projectKey: string, identity: string): string {
  return `${projectKey}::${identity}`;
}

function compareCoordinationIdentity(
  left: Pick<CurrentCoordinationRecord, "projectKey" | "sender" | "recipient">,
  right: Pick<CurrentCoordinationRecord, "projectKey" | "sender" | "recipient">,
): number {
  return left.projectKey.localeCompare(right.projectKey)
    || left.sender.localeCompare(right.sender, undefined, { numeric: true })
    || left.recipient.localeCompare(right.recipient, undefined, { numeric: true });
}

export function dedupeCurrentCoordination(rows: AgentViewRow[]): CurrentCoordinationRecord[] {
  const current = new Map<string, CurrentCoordinationRecord>();
  for (const row of rows) {
    for (const item of row.coordination) {
      current.set(coordinationKey(item), item);
    }
  }
  return [...current.values()].sort(compareCoordinationIdentity);
}

export function buildCoordinationItems(
  coordination: CurrentCoordinationRecord[],
  agents: AgentViewRow[],
): CoordinationBoardItem[] {
  const actors = new Map(agents.map((row) => [actorKey(row.projectKey, row.identity), row]));
  const unique = new Map<string, CurrentCoordinationRecord>();
  for (const item of coordination) unique.set(coordinationKey(item), item);

  return [...unique.values()]
    .sort(compareCoordinationIdentity)
    .map((item) => ({
      key: coordinationKey(item),
      projectKey: item.projectKey,
      sender: item.sender,
      recipient: item.recipient,
      senderAgent: actors.get(actorKey(item.projectKey, item.sender)) ?? null,
      recipientAgent: actors.get(actorKey(item.projectKey, item.recipient)) ?? null,
      status: firstString(item.state, ["status", "phase"]),
      type: firstString(item.state, ["type", "kind"]),
      summary: firstString(item.state, ["summary", "message", "title"]),
      objective: firstString(item.state, ["objective", "goal"]),
      decision: firstString(item.state, ["decision", "resolution"]),
      blocker: firstString(item.state, ["blocker", "blocked_reason", "block_reason", "waiting_on", "waiting_for"]),
      nextAction: firstString(item.state, ["next_action", "nextAction", "next", "checkpoint"]),
      state: item.state,
    }));
}

function matchesDirection(item: CoordinationBoardItem, direction: CoordinationDirection, identity: string): boolean {
  if (direction === "all") return true;
  if (direction === "inbox") return item.recipient === identity;
  return item.sender === identity;
}

function searchableText(item: CoordinationBoardItem): string {
  return [
    item.projectKey,
    item.sender,
    item.recipient,
    item.status ?? "",
    item.type ?? "",
    item.summary ?? "",
    item.objective ?? "",
    item.decision ?? "",
    item.blocker ?? "",
    item.nextAction ?? "",
    JSON.stringify(item.state),
  ].join(" ").toLowerCase();
}

export function filterCoordinationItems(
  items: CoordinationBoardItem[],
  filters: CoordinationFilters,
): CoordinationBoardItem[] {
  const needle = filters.query.trim().toLowerCase();
  return items.filter((item) =>
    (filters.project === "all" || item.projectKey === filters.project)
    && matchesDirection(item, filters.direction, filters.identity)
    && (!needle || searchableText(item).includes(needle)),
  );
}

export function coordinationCounts(items: CoordinationBoardItem[]): CoordinationCounts {
  return {
    total: items.length,
    projects: new Set(items.map((item) => item.projectKey)).size,
    senders: new Set(items.map((item) => `${item.projectKey}::${item.sender}`)).size,
    recipients: new Set(items.map((item) => `${item.projectKey}::${item.recipient}`)).size,
  };
}
