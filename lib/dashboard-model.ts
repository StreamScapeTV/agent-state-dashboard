import type {
  AgentBaseStatus,
  AgentViewRow,
  CurrentAgentRecord,
  CurrentCoordinationRecord,
  CurrentProjectRecord,
  CurrentResourceRecord,
  CurrentWorkRecord,
  DashboardSnapshot,
  IdentityKind,
  JsonValue,
  ProjectSummary,
  RawTableName,
} from "@/types/dashboard";

const TABLE_ALIASES: Record<RawTableName, string[]> = {
  current_projects: ["current_projects", "projects"],
  current_agents: ["current_agents", "agents"],
  current_work: ["current_work", "work"],
  current_resources: ["current_resources", "resources"],
  current_coordination: ["current_coordination", "coordination"],
};

const BLOCKER_KEYS = new Set([
  "blocked",
  "blocker",
  "block_reason",
  "blocker_reason",
  "waiting_on",
  "waiting_for",
]);

export type DashboardLiveState = "connecting" | "live" | "reconnecting" | "stale";
export type DashboardLiveEvent = "open" | "error" | "refresh" | "invalidate" | "status";

export interface DashboardLiveDecision {
  state: DashboardLiveState | null;
  refresh: boolean;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function liveEventDecision(event: DashboardLiveEvent, payload?: unknown): DashboardLiveDecision {
  if (event === "open") return { state: "connecting", refresh: false };
  if (event === "error") return { state: "reconnecting", refresh: false };
  if (event === "refresh") return { state: null, refresh: true };
  if (event === "invalidate") return { state: "live", refresh: true };

  let parsed = payload;
  if (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed) as unknown;
    } catch {
      return { state: null, refresh: false };
    }
  }
  if (!isObject(parsed) || typeof parsed.status !== "string") {
    return { state: null, refresh: false };
  }
  if (parsed.status === "live") return { state: "live", refresh: false };
  if (parsed.status === "starting") return { state: "connecting", refresh: false };
  if (parsed.status === "reconnecting") return { state: "reconnecting", refresh: false };
  return { state: null, refresh: false };
}

function asJson(value: unknown): JsonValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (Array.isArray(value)) return value.map(asJson);
  if (isObject(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, asJson(item)]));
  }
  return String(value);
}

function valueFrom(record: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    if (key in record) return record[key];
  }
  return undefined;
}

function stringFrom(record: Record<string, unknown>, keys: string[]): string | null {
  const value = valueFrom(record, keys);
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function rawStringFrom(record: Record<string, unknown>, keys: string[]): string | null {
  const value = valueFrom(record, keys);
  return typeof value === "string" ? value : null;
}

function rawTablesRoot(input: unknown): Record<string, unknown> {
  if (!isObject(input)) return {};
  const tables = input.tables;
  return isObject(tables) ? { ...input, ...tables } : input;
}

function arrayForTable(root: Record<string, unknown>, table: RawTableName): unknown[] | null {
  for (const key of TABLE_ALIASES[table]) {
    if (Array.isArray(root[key])) return root[key] as unknown[];
  }
  return null;
}

function parseProject(value: unknown): CurrentProjectRecord | null {
  if (!isObject(value)) return null;
  const projectKey = stringFrom(value, ["project_key", "projectKey", "project", "key"]);
  if (!projectKey) return null;
  return {
    projectKey,
    state: asJson(valueFrom(value, ["state", "project_state", "projectState"]) ?? {}),
  };
}

function parseAgent(value: unknown): CurrentAgentRecord | null {
  if (!isObject(value)) return null;
  const projectKey = stringFrom(value, ["project_key", "projectKey", "project"]);
  const identity = stringFrom(value, ["agent", "identity", "display_identity", "displayIdentity"]);
  if (!projectKey || !identity) return null;
  return {
    projectKey,
    identity,
    // Prompt/response are owner-visible authoritative text. Preserve their bytes
    // instead of applying identifier/timestamp whitespace normalization.
    prompt: rawStringFrom(value, ["prompt", "current_prompt", "currentPrompt"]),
    state: asJson(valueFrom(value, ["state", "actor_state", "actorState"]) ?? {}),
    promptAssignedAt: stringFrom(value, ["prompt_assigned_at", "promptAssignedAt"]),
    lastResponse: rawStringFrom(value, ["last_response", "lastResponse"]),
    lastReturnedAt: stringFrom(value, ["last_returned_at", "lastReturnedAt"]),
  };
}

function parseWork(value: unknown): CurrentWorkRecord | null {
  if (!isObject(value)) return null;
  const projectKey = stringFrom(value, ["project_key", "projectKey", "project"]);
  const identity = stringFrom(value, ["agent", "identity", "display_identity", "displayIdentity"]);
  const workKey = stringFrom(value, ["work_key", "workKey", "key"]);
  if (!projectKey || !identity || !workKey) return null;
  return {
    projectKey,
    identity,
    workKey,
    state: asJson(valueFrom(value, ["state", "work_state", "workState"]) ?? {}),
  };
}

function parseResource(value: unknown): CurrentResourceRecord | null {
  if (!isObject(value)) return null;
  const projectKey = stringFrom(value, ["project_key", "projectKey", "project"]);
  const identity = stringFrom(value, ["agent", "identity", "display_identity", "displayIdentity"]);
  const resourceKey = stringFrom(value, ["resource_key", "resourceKey", "key"]);
  if (!projectKey || !identity || !resourceKey) return null;
  return { projectKey, identity, resourceKey };
}

function parseCoordination(value: unknown): CurrentCoordinationRecord | null {
  if (!isObject(value)) return null;
  const projectKey = stringFrom(value, ["project_key", "projectKey", "project"]);
  const sender = stringFrom(value, ["sender"]);
  const recipient = stringFrom(value, ["recipient"]);
  if (!projectKey || !sender || !recipient) return null;
  return {
    projectKey,
    sender,
    recipient,
    state: asJson(valueFrom(value, ["state", "coordination_state", "coordinationState"]) ?? {}),
  };
}

function parseTimestamp(value: string | null): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function textSignalsBlocked(value: unknown, depth = 0): boolean {
  if (depth > 5 || value === null || value === undefined) return false;
  if (Array.isArray(value)) return value.some((item) => textSignalsBlocked(item, depth + 1));
  if (!isObject(value)) return false;

  for (const [key, item] of Object.entries(value)) {
    const normalizedKey = key.toLowerCase();
    if (BLOCKER_KEYS.has(normalizedKey)) {
      if (item === true) return true;
      if (typeof item === "string" && item.trim().length > 0) return true;
      if (isObject(item) || Array.isArray(item)) {
        if (JSON.stringify(item) !== "{}" && JSON.stringify(item) !== "[]") return true;
      }
    }
    if ((normalizedKey === "status" || normalizedKey === "phase") && typeof item === "string") {
      const normalizedValue = item.trim().toLowerCase();
      if (/^blocked(?:$|[:_\-\s])/.test(normalizedValue) || normalizedValue === "waiting") {
        return true;
      }
    }
    if (textSignalsBlocked(item, depth + 1)) return true;
  }
  return false;
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

export function normalizeSnapshot(input: unknown, nowIso = new Date().toISOString()): DashboardSnapshot {
  const root = rawTablesRoot(input);
  const missingTables: RawTableName[] = [];

  function parseTable<T>(table: RawTableName, parser: (value: unknown) => T | null): T[] {
    const rows = arrayForTable(root, table);
    if (!rows) {
      missingTables.push(table);
      return [];
    }
    return rows.map(parser).filter((row): row is T => row !== null);
  }

  const refreshedAt = stringFrom(root, ["refreshed_at", "refreshedAt", "generated_at", "generatedAt", "scanned_at", "scannedAt"]);

  return {
    projects: parseTable("current_projects", parseProject),
    agents: parseTable("current_agents", parseAgent),
    work: parseTable("current_work", parseWork),
    resources: parseTable("current_resources", parseResource),
    coordination: parseTable("current_coordination", parseCoordination),
    refreshedAt: refreshedAt ?? nowIso,
    missingTables,
  };
}

export function deriveBaseStatus(
  agent: Pick<CurrentAgentRecord, "promptAssignedAt" | "lastReturnedAt">,
  work: CurrentWorkRecord[],
): AgentBaseStatus {
  const assignedAt = parseTimestamp(agent.promptAssignedAt);
  const returnedAt = parseTimestamp(agent.lastReturnedAt);

  if (assignedAt !== null) {
    if (returnedAt !== null && returnedAt >= assignedAt) return "returned";
    return "working";
  }

  // Rows that predate assignment observability deliberately keep NULL timestamps.
  // Do not infer an active prompt from retained text; only current work can make
  // such a row operationally active until a real future assignment is stamped.
  if (work.length > 0) return "working";
  return "idle";
}

export function isBlocked(agentState: JsonValue, work: CurrentWorkRecord[]): boolean {
  return textSignalsBlocked(agentState) || work.some((item) => textSignalsBlocked(item.state));
}

export function durationMs(
  promptAssignedAt: string | null,
  lastReturnedAt: string | null,
  baseStatus: AgentBaseStatus,
  nowMs = Date.now(),
): number | null {
  const assignedAt = parseTimestamp(promptAssignedAt);
  if (assignedAt === null) return null;
  const returnedAt = parseTimestamp(lastReturnedAt);
  const end = baseStatus === "returned" && returnedAt !== null && returnedAt >= assignedAt ? returnedAt : nowMs;
  return Math.max(0, end - assignedAt);
}

export function formatDuration(value: number | null): string {
  if (value === null) return "—";
  const totalSeconds = Math.max(0, Math.floor(value / 1000));
  const days = Math.floor(totalSeconds / 86_400);
  const hours = Math.floor((totalSeconds % 86_400) / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

export function identityKind(identity: string): IdentityKind {
  const normalized = identity.trim().toLowerCase();
  if (normalized === "orchestrator") return "orchestrator";
  if (/^agent\s+\d+$/.test(normalized)) return "agent";
  if (/^codex\s+\d+$/.test(normalized)) return "codex";
  if (normalized === "dependabot") return "dependabot";
  return "other";
}

export function buildAgentRows(snapshot: DashboardSnapshot, nowMs = Date.now()): AgentViewRow[] {
  return snapshot.agents.map((agent) => {
    const work = snapshot.work.filter(
      (item) => item.projectKey === agent.projectKey && item.identity === agent.identity,
    );
    const resources = snapshot.resources.filter(
      (item) => item.projectKey === agent.projectKey && item.identity === agent.identity,
    );
    const coordination = snapshot.coordination.filter(
      (item) =>
        item.projectKey === agent.projectKey &&
        (item.sender === agent.identity || item.recipient === agent.identity),
    );
    const baseStatus = deriveBaseStatus(agent, work);
    const blocked = isBlocked(agent.state, work);
    const workSummary =
      work.map((item) => firstString(item.state, ["objective", "status", "summary", "title"])).find(Boolean) ??
      firstString(agent.state, ["objective", "status", "summary", "checkpoint"]) ??
      (work.length > 0 ? `${work.length} current work item${work.length === 1 ? "" : "s"}` : "No current work");
    const explicitNextAction =
      firstString(agent.state, ["next_action", "nextAction", "next"]) ??
      work.map((item) => firstString(item.state, ["next_action", "nextAction", "next"])).find(Boolean) ??
      null;
    const checkpoint =
      firstString(agent.state, ["checkpoint"]) ??
      work.map((item) => firstString(item.state, ["checkpoint"])).find(Boolean) ??
      null;
    const nextAction = explicitNextAction ?? checkpoint;

    return {
      ...agent,
      key: `${agent.projectKey}::${agent.identity}`,
      baseStatus,
      blocked,
      durationMs: durationMs(agent.promptAssignedAt, agent.lastReturnedAt, baseStatus, nowMs),
      work,
      resources,
      coordination,
      identityKind: identityKind(agent.identity),
      workSummary,
      nextAction,
    };
  });
}

export function buildProjectSummaries(snapshot: DashboardSnapshot, rows: AgentViewRow[]): ProjectSummary[] {
  const projectKeys = new Set<string>([
    ...snapshot.projects.map((project) => project.projectKey),
    ...rows.map((row) => row.projectKey),
    ...snapshot.work.map((row) => row.projectKey),
  ]);

  return [...projectKeys]
    .sort((left, right) => left.localeCompare(right))
    .map((projectKey) => {
      const projectRows = rows.filter((row) => row.projectKey === projectKey);
      const state = snapshot.projects.find((project) => project.projectKey === projectKey)?.state ?? {};
      return {
        projectKey,
        state,
        total: projectRows.length,
        working: projectRows.filter((row) => row.baseStatus === "working").length,
        returned: projectRows.filter((row) => row.baseStatus === "returned").length,
        blocked: projectRows.filter((row) => row.blocked).length,
        idle: projectRows.filter((row) => row.baseStatus === "idle").length,
        phase: firstString(state, ["phase", "status"]),
        objective: firstString(state, ["objective", "goal"]),
        nextAction: firstString(state, ["next_action", "nextAction", "next"]),
      };
    });
}

export function attentionRank(row: AgentViewRow): number {
  if (row.baseStatus === "returned" && row.blocked) return 0;
  if (row.baseStatus === "returned") return 1;
  if (row.blocked) return 2;
  if (row.baseStatus === "working") return 3;
  return 4;
}

export function statusLabel(row: Pick<AgentViewRow, "baseStatus" | "blocked">): string {
  if (!row.blocked) {
    if (row.baseStatus === "returned") return "Returned / ready";
    if (row.baseStatus === "working") return "Working";
    return "Idle";
  }
  if (row.baseStatus === "returned") return "Blocked · returned";
  if (row.baseStatus === "working") return "Blocked · working";
  return "Blocked · idle";
}
