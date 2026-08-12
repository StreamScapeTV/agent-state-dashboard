export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export type RawTableName =
  | "current_projects"
  | "current_agents"
  | "current_work"
  | "current_resources"
  | "current_coordination";

export const RAW_TABLE_NAMES: RawTableName[] = [
  "current_projects",
  "current_agents",
  "current_work",
  "current_resources",
  "current_coordination",
];

export interface CurrentProjectRecord {
  projectKey: string;
  state: JsonValue;
}

export interface CurrentAgentRecord {
  projectKey: string;
  identity: string;
  prompt: string | null;
  state: JsonValue;
  promptAssignedAt: string | null;
  lastResponse: string | null;
  lastReturnedAt: string | null;
}

export interface CurrentWorkRecord {
  projectKey: string;
  workKey: string;
  identity: string;
  state: JsonValue;
}

export interface CurrentResourceRecord {
  projectKey: string;
  resourceKey: string;
  identity: string;
}

export interface CurrentCoordinationRecord {
  projectKey: string;
  sender: string;
  recipient: string;
  state: JsonValue;
}

export interface DashboardSnapshot {
  projects: CurrentProjectRecord[];
  agents: CurrentAgentRecord[];
  work: CurrentWorkRecord[];
  resources: CurrentResourceRecord[];
  coordination: CurrentCoordinationRecord[];
  refreshedAt: string | null;
  missingTables: RawTableName[];
}

export type AgentBaseStatus = "working" | "returned" | "idle";
export type AgentStatusFilter = "all" | AgentBaseStatus | "blocked";
export type IdentityKind = "orchestrator" | "agent" | "codex" | "dependabot" | "other";

export interface AgentViewRow extends CurrentAgentRecord {
  key: string;
  baseStatus: AgentBaseStatus;
  blocked: boolean;
  durationMs: number | null;
  work: CurrentWorkRecord[];
  resources: CurrentResourceRecord[];
  coordination: CurrentCoordinationRecord[];
  identityKind: IdentityKind;
  workSummary: string;
  nextAction: string | null;
}

export interface ProjectSummary {
  projectKey: string;
  state: JsonValue;
  total: number;
  working: number;
  returned: number;
  blocked: number;
  idle: number;
  phase: string | null;
  objective: string | null;
  nextAction: string | null;
}

export interface LegacyActorSnapshot {
  identity: string;
  status: string;
  promptAssigned: boolean;
  promptLength: number;
  state: JsonValue;
  work: JsonValue[];
  resources: string[];
  coordination: JsonValue[];
}

export interface LegacyOverviewPayload {
  project: string;
  projectState: JsonValue;
  storageBudget: JsonValue;
  actorBatchCount: number;
  actorCapacity: number;
  scannedAt: string;
}

export interface LegacyActorsBatchPayload {
  project: string;
  batch: number;
  actors: LegacyActorSnapshot[];
  scannedIdentities: number;
}
