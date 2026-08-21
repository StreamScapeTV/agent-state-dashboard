import type { AgentBaseStatus, AgentViewRow, CurrentCoordinationRecord, IdentityKind } from "@/types/dashboard";

export const CAPACITY_LIMITS = {
  resourcesPerAgent: 64,
  workPerAgent: 8,
  workPerProject: 1024,
  coordinationSentPerActor: 32,
  coordinationReceivedPerActor: 32,
  coordinationPerProject: 2048,
} as const;

// Visual guidance only. Agent State owns the hard limits and does not define a
// dashboard warning threshold.
export const CAPACITY_WARNING_RATIO = 0.75;

export type CapacityLevel = "normal" | "near" | "at-limit";
export type ResourceOwnerStatusFilter = "all" | AgentBaseStatus | "blocked";

export interface CapacityUsage {
  used: number;
  limit: number;
  ratio: number;
  level: CapacityLevel;
}

export interface ResourceOwnershipItem {
  key: string;
  projectKey: string;
  resourceKey: string;
  owner: AgentViewRow;
  ownerStatus: AgentBaseStatus;
  blocked: boolean;
  workCount: number;
  workSummary: string;
  assignedAt: string | null;
  lastReturnedAt: string | null;
  durationMs: number | null;
  ownershipAttention: boolean;
}

export interface ActorCapacityItem {
  key: string;
  projectKey: string;
  identity: string;
  identityKind: IdentityKind;
  ownerStatus: AgentBaseStatus;
  blocked: boolean;
  resources: CapacityUsage;
  work: CapacityUsage;
  coordinationSent: CapacityUsage;
  coordinationReceived: CapacityUsage;
  ownershipAttention: boolean;
  nearCapacity: boolean;
}

export interface ProjectCapacityItem {
  projectKey: string;
  work: CapacityUsage;
  coordination: CapacityUsage;
  nearCapacity: boolean;
}

export interface ResourceCapacitySnapshot {
  resources: ResourceOwnershipItem[];
  actors: ActorCapacityItem[];
  projects: ProjectCapacityItem[];
}

export interface ResourceOwnershipFilters {
  project: string;
  owner: string;
  ownerStatus: ResourceOwnerStatusFilter;
  query: string;
}

function resourceIdentity(projectKey: string, resourceKey: string): string {
  return `${projectKey}::${resourceKey}`;
}

function actorIdentity(projectKey: string, identity: string): string {
  return `${projectKey}::${identity}`;
}

function coordinationIdentity(item: CurrentCoordinationRecord): string {
  return `${item.projectKey}::${item.sender}::${item.recipient}`;
}

export function capacityUsage(used: number, limit: number): CapacityUsage {
  const boundedUsed = Math.max(0, used);
  const ratio = limit > 0 ? boundedUsed / limit : 0;
  return {
    used: boundedUsed,
    limit,
    ratio,
    level: boundedUsed >= limit
      ? "at-limit"
      : ratio >= CAPACITY_WARNING_RATIO
        ? "near"
        : "normal",
  };
}

function uniqueResourceCount(row: AgentViewRow): number {
  return new Set(row.resources.map((item) => item.resourceKey)).size;
}

function uniqueWorkCount(row: AgentViewRow): number {
  return new Set(row.work.map((item) => item.workKey)).size;
}

export function buildResourceOwnership(rows: AgentViewRow[]): ResourceOwnershipItem[] {
  const resources = new Map<string, ResourceOwnershipItem>();

  for (const row of rows) {
    for (const resource of row.resources) {
      const key = resourceIdentity(resource.projectKey, resource.resourceKey);
      resources.set(key, {
        key,
        projectKey: resource.projectKey,
        resourceKey: resource.resourceKey,
        owner: row,
        ownerStatus: row.baseStatus,
        blocked: row.blocked,
        workCount: uniqueWorkCount(row),
        workSummary: row.workSummary,
        assignedAt: row.assignedAt,
        lastReturnedAt: row.lastReturnedAt,
        durationMs: row.durationMs,
        ownershipAttention:
          row.baseStatus === "returned" || row.baseStatus === "idle",
      });
    }
  }

  return [...resources.values()].sort((left, right) =>
    left.projectKey.localeCompare(right.projectKey)
    || left.resourceKey.localeCompare(right.resourceKey)
    || left.owner.identity.localeCompare(right.owner.identity, undefined, { numeric: true }),
  );
}

export function filterResourceOwnership(
  items: ResourceOwnershipItem[],
  filters: ResourceOwnershipFilters,
): ResourceOwnershipItem[] {
  const needle = filters.query.trim().toLowerCase();
  return items.filter((item) =>
    (filters.project === "all" || item.projectKey === filters.project)
    && (filters.owner === "all" || item.owner.identity === filters.owner)
    && (
      filters.ownerStatus === "all"
      || (filters.ownerStatus === "blocked" ? item.blocked : item.ownerStatus === filters.ownerStatus)
    )
    && (
      !needle
      || [item.resourceKey, item.projectKey, item.owner.identity, item.workSummary]
        .join(" ")
        .toLowerCase()
        .includes(needle)
    ),
  );
}

export function buildResourceCapacitySnapshot(rows: AgentViewRow[]): ResourceCapacitySnapshot {
  const coordination = new Map<string, CurrentCoordinationRecord>();
  const projectWork = new Map<string, Set<string>>();
  const sent = new Map<string, number>();
  const received = new Map<string, number>();
  const projectCoordination = new Map<string, number>();

  for (const row of rows) {
    let workKeys = projectWork.get(row.projectKey);
    if (!workKeys) {
      workKeys = new Set<string>();
      projectWork.set(row.projectKey, workKeys);
    }
    for (const item of row.work) workKeys.add(item.workKey);

    for (const item of row.coordination) {
      coordination.set(coordinationIdentity(item), item);
    }
  }

  for (const item of coordination.values()) {
    const senderKey = actorIdentity(item.projectKey, item.sender);
    const recipientKey = actorIdentity(item.projectKey, item.recipient);
    sent.set(senderKey, (sent.get(senderKey) ?? 0) + 1);
    received.set(recipientKey, (received.get(recipientKey) ?? 0) + 1);
    projectCoordination.set(
      item.projectKey,
      (projectCoordination.get(item.projectKey) ?? 0) + 1,
    );
  }

  const actors = rows
    .map((row): ActorCapacityItem => {
      const key = actorIdentity(row.projectKey, row.identity);
      const resources = capacityUsage(uniqueResourceCount(row), CAPACITY_LIMITS.resourcesPerAgent);
      const work = capacityUsage(uniqueWorkCount(row), CAPACITY_LIMITS.workPerAgent);
      const coordinationSent = capacityUsage(
        sent.get(key) ?? 0,
        CAPACITY_LIMITS.coordinationSentPerActor,
      );
      const coordinationReceived = capacityUsage(
        received.get(key) ?? 0,
        CAPACITY_LIMITS.coordinationReceivedPerActor,
      );
      const ownershipAttention = resources.used > 0
        && (row.baseStatus === "returned" || row.baseStatus === "idle");
      const nearCapacity = [resources, work, coordinationSent, coordinationReceived]
        .some((usage) => usage.level !== "normal");

      return {
        key,
        projectKey: row.projectKey,
        identity: row.identity,
        identityKind: row.identityKind,
        ownerStatus: row.baseStatus,
        blocked: row.blocked,
        resources,
        work,
        coordinationSent,
        coordinationReceived,
        ownershipAttention,
        nearCapacity,
      };
    })
    .sort((left, right) =>
      left.projectKey.localeCompare(right.projectKey)
      || left.identity.localeCompare(right.identity, undefined, { numeric: true }),
    );

  const projectKeys = new Set<string>([
    ...rows.map((row) => row.projectKey),
    ...projectWork.keys(),
    ...projectCoordination.keys(),
  ]);

  const projects = [...projectKeys]
    .sort((left, right) => left.localeCompare(right))
    .map((projectKey): ProjectCapacityItem => {
      const work = capacityUsage(
        projectWork.get(projectKey)?.size ?? 0,
        CAPACITY_LIMITS.workPerProject,
      );
      const coordinationUsage = capacityUsage(
        projectCoordination.get(projectKey) ?? 0,
        CAPACITY_LIMITS.coordinationPerProject,
      );
      return {
        projectKey,
        work,
        coordination: coordinationUsage,
        nearCapacity: work.level !== "normal" || coordinationUsage.level !== "normal",
      };
    });

  return {
    resources: buildResourceOwnership(rows),
    actors,
    projects,
  };
}
