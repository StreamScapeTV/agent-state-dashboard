import type {
  AgentBaseStatus,
  AgentStatusFilter,
  AgentViewRow,
  BlockerCue,
  CurrentAgentRecord,
  CurrentAssignment,
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

const BLOCKER_DETAIL_KEYS = ["reason", "message", "summary", "title", "status", "phase"];
const MAX_BLOCKER_CUES = 3;

export type DashboardLiveState = "connecting" | "live" | "reconnecting" | "stale";
export type DashboardLiveEvent = "open" | "error" | "refresh" | "invalidate" | "status";

export interface DashboardLiveDecision {
  state: DashboardLiveState | null;
  refresh: boolean;
}

type IdentityIndex<T> = Map<string, Map<string, T[]>>;

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

function parseAssignment(value: unknown): CurrentAssignment | null {
  if (!isObject(value)) return null;
  const instructions = rawStringFrom(value, ["instructions"]);
  if (instructions === null) return null;
  return {
    instructions,
    context: "context" in value ? asJson(value.context) : null,
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
    assignment: parseAssignment(valueFrom(value, ["assignment"])),
    assignmentAssignedAt: stringFrom(value, ["assignment_assigned_at", "assignmentAssignedAt"]),
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
      if (/^blocked(?:$|[:_\-\s])/.test(normalizedValue) || /^waiting(?:$|[:_\-\s])/.test(normalizedValue)) {
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

function collectBlockerReasons(value: JsonValue, output: string[], depth = 0): void {
  if (depth > 5 || value === null || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const item of value) collectBlockerReasons(item, output, depth + 1);
    return;
  }

  for (const [key, item] of Object.entries(value)) {
    const normalizedKey = key.toLowerCase();
    if (BLOCKER_KEYS.has(normalizedKey)) {
      if (typeof item === "string" && item.trim().length > 0) {
        output.push(item.trim());
      } else if (item !== null && typeof item === "object") {
        const detail = firstString(item, BLOCKER_DETAIL_KEYS);
        if (detail) output.push(detail);
      }
    }
    if ((normalizedKey === "status" || normalizedKey === "phase") && typeof item === "string") {
      const normalizedValue = item.trim().toLowerCase();
      if (/^blocked(?:$|[:_\-\s])/.test(normalizedValue) || /^waiting(?:$|[:_\-\s])/.test(normalizedValue)) {
        output.push(item.trim());
      }
    }
    collectBlockerReasons(item, output, depth + 1);
  }
}

function blockerReasons(value: JsonValue): string[] {
  const candidates: string[] = [];
  collectBlockerReasons(value, candidates);
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    const key = candidate.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function extractBlockerCues(agentState: JsonValue, work: CurrentWorkRecord[]): BlockerCue[] {
  const cues: BlockerCue[] = [];
  const seen = new Set<string>();

  const append = (state: JsonValue, source: "actor" | "work", workKey: string | null) => {
    const summary = firstString(state, ["objective", "summary", "title", "status", "phase"]);
    const nextAction = firstString(state, ["next_action", "nextAction", "next", "checkpoint"]);
    for (const reason of blockerReasons(state)) {
      const key = `${source}:${workKey ?? ""}:${reason.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      cues.push({ reason, source, workKey, summary, nextAction });
      if (cues.length >= MAX_BLOCKER_CUES) return;
    }
  };

  append(agentState, "actor", null);
  for (const item of work) {
    if (cues.length >= MAX_BLOCKER_CUES) break;
    append(item.state, "work", item.workKey);
  }
  return cues;
}

function addIndexed<T>(index: IdentityIndex<T>, projectKey: string, identity: string, value: T) {
  let project = index.get(projectKey);
  if (!project) {
    project = new Map<string, T[]>();
    index.set(projectKey, project);
  }
  const existing = project.get(identity);
  if (existing) existing.push(value);
  else project.set(identity, [value]);
}

function indexed<T>(index: IdentityIndex<T>, projectKey: string, identity: string): T[] {
  return index.get(projectKey)?.get(identity) ?? [];
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

export function currentAssignedAt(
  agent: Pick<CurrentAgentRecord, "assignmentAssignedAt" | "promptAssignedAt">,
): string | null {
  return agent.assignmentAssignedAt ?? agent.promptAssignedAt;
}

export function deriveBaseStatus(
  agent: Pick<CurrentAgentRecord, "assignmentAssignedAt" | "promptAssignedAt" | "lastReturnedAt">,
  work: CurrentWorkRecord[],
): AgentBaseStatus {
  const assignedAt = parseTimestamp(currentAssignedAt(agent));
  const returnedAt = parseTimestamp(agent.lastReturnedAt);

  if (assignedAt !== null) {
    if (returnedAt !== null && returnedAt >= assignedAt) return "returned";
    return "working";
  }
  if (work.length > 0) return "working";
  return "idle";
}

export function isBlocked(agentState: JsonValue, work: CurrentWorkRecord[]): boolean {
  return textSignalsBlocked(agentState) || work.some((item) => textSignalsBlocked(item.state));
}

export function durationMs(
  assignedAtValue: string | null,
  lastReturnedAt: string | null,
  baseStatus: AgentBaseStatus,
  nowMs = Date.now(),
): number | null {
  const assignedAt = parseTimestamp(assignedAtValue);
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
  const workIndex: IdentityIndex<CurrentWorkRecord> = new Map();
  const resourceIndex: IdentityIndex<CurrentResourceRecord> = new Map();
  const coordinationIndex: IdentityIndex<CurrentCoordinationRecord> = new Map();

  for (const item of snapshot.work) addIndexed(workIndex, item.projectKey, item.identity, item);
  for (const item of snapshot.resources) addIndexed(resourceIndex, item.projectKey, item.identity, item);
  for (const item of snapshot.coordination) {
    addIndexed(coordinationIndex, item.projectKey, item.sender, item);
    if (item.recipient !== item.sender) addIndexed(coordinationIndex, item.projectKey, item.recipient, item);
  }

  return snapshot.agents.map((agent) => {
    const work = indexed(workIndex, agent.projectKey, agent.identity);
    const resources = indexed(resourceIndex, agent.projectKey, agent.identity);
    const coordination = indexed(coordinationIndex, agent.projectKey, agent.identity);
    const assignedAt = currentAssignedAt(agent);
    const baseStatus = deriveBaseStatus(agent, work);
    const blocked = isBlocked(agent.state, work);
    const blockerCues = extractBlockerCues(agent.state, work);
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
      assignedAt,
      baseStatus,
      blocked,
      blockerCues,
      durationMs: durationMs(assignedAt, agent.lastReturnedAt, baseStatus, nowMs),
      work,
      resources,
      coordination,
      identityKind: identityKind(agent.identity),
      workSummary,
      nextAction,
    };
  });
}

export function refreshAgentDurations(rows: AgentViewRow[], nowMs = Date.now()): AgentViewRow[] {
  return rows.map((row) => {
    const nextDuration = durationMs(row.assignedAt, row.lastReturnedAt, row.baseStatus, nowMs);
    return nextDuration === row.durationMs ? row : { ...row, durationMs: nextDuration };
  });
}

export function filterProjectRows(
  rows: AgentViewRow[],
  projectKey: string,
  status: AgentStatusFilter = "all",
): AgentViewRow[] {
  return rows.filter((row) =>
    row.projectKey === projectKey
    && (status === "all" || (status === "blocked" ? row.blocked : row.baseStatus === status)),
  );
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
