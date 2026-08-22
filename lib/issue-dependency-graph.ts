import type {
  CurrentIssueDependencyRecord,
  CurrentIssueRecord,
} from "@/lib/agent-state-read-contract";

export type IssueGraphVisualStatus = "blocked" | "active" | "ready";

export interface IssueGraphRelation {
  projectKey: string;
  issueNumber: number;
  reason: string | null;
}

export interface IssueGraphNode {
  id: string;
  issue: CurrentIssueRecord;
  visualStatus: IssueGraphVisualStatus;
  visualLabel: "Blocked" | "Active" | "Ready";
  target: boolean;
  blockers: IssueGraphRelation[];
  dependents: IssueGraphRelation[];
  x: number;
  y: number;
  component: number;
  rank: number;
}

export interface IssueGraphEdge {
  id: string;
  dependentId: string;
  blockerId: string;
  reason: string | null;
  crossProject: boolean;
}

export interface IssueDependencyGraphModel {
  nodes: IssueGraphNode[];
  edges: IssueGraphEdge[];
  width: number;
  height: number;
  targetProjectKey: string;
  visibleProjects: string[];
  availableProjects: string[];
}

const NODE_DIAMETER = 96;
const NODE_RADIUS = NODE_DIAMETER / 2;
const HORIZONTAL_GAP = 250;
const VERTICAL_GAP = 150;
const COMPONENT_GAP = 110;
const PADDING_X = 90;
const PADDING_Y = 80;
const MIN_WIDTH = 520;
const MIN_HEIGHT = 280;

export function issueGraphId(projectKey: string, issueNumber: number): string {
  return `${projectKey}#${issueNumber}`;
}

export function graphProjectKeys(issues: CurrentIssueRecord[]): string[] {
  return [...new Set(issues.map((issue) => issue.project_key))]
    .sort((left, right) => left.localeCompare(right));
}

export function directlyRelatedProjects(
  targetProjectKey: string,
  issues: CurrentIssueRecord[],
  dependencies: CurrentIssueDependencyRecord[],
): string[] {
  const available = new Set(graphProjectKeys(issues));
  const related = new Set<string>();
  for (const edge of dependencies) {
    if (edge.dependent_project_key === targetProjectKey && available.has(edge.blocker_project_key)) {
      related.add(edge.blocker_project_key);
    }
    if (edge.blocker_project_key === targetProjectKey && available.has(edge.dependent_project_key)) {
      related.add(edge.dependent_project_key);
    }
  }
  related.delete(targetProjectKey);
  return [...related].sort((left, right) => left.localeCompare(right));
}

export function defaultVisibleProjects(
  targetProjectKey: string,
  issues: CurrentIssueRecord[],
  dependencies: CurrentIssueDependencyRecord[],
): string[] {
  const available = new Set(graphProjectKeys(issues));
  if (!available.has(targetProjectKey)) return [];
  return [targetProjectKey, ...directlyRelatedProjects(targetProjectKey, issues, dependencies)];
}

export function normalizeVisibleProjects(
  targetProjectKey: string,
  selectedProjects: readonly string[],
  issues: CurrentIssueRecord[],
): string[] {
  const available = new Set(graphProjectKeys(issues));
  const selected = new Set(selectedProjects.filter((projectKey) => available.has(projectKey)));
  if (available.has(targetProjectKey)) selected.add(targetProjectKey);
  return [...selected].sort((left, right) => {
    if (left === targetProjectKey) return -1;
    if (right === targetProjectKey) return 1;
    return left.localeCompare(right);
  });
}

export function deriveIssueGraphStatus(
  issue: CurrentIssueRecord,
  liveBlockerCount: number,
): IssueGraphVisualStatus {
  if (liveBlockerCount > 0 || issue.status === "blocked" || issue.status === "waiting") return "blocked";
  if (issue.status === "in_progress" || issue.status === "validation") return "active";
  if (issue.status === "ready") return "ready";
  const impossible: never = issue.status;
  throw new Error(`Unsupported issue status: ${String(impossible)}`);
}

function statusLabel(status: IssueGraphVisualStatus): IssueGraphNode["visualLabel"] {
  if (status === "blocked") return "Blocked";
  if (status === "active") return "Active";
  return "Ready";
}

function relation(
  projectKey: string,
  issueNumber: number,
  reason: string | null,
): IssueGraphRelation {
  return { projectKey, issueNumber, reason };
}

function sortRelations(relations: IssueGraphRelation[]): IssueGraphRelation[] {
  return [...relations].sort((left, right) =>
    left.projectKey.localeCompare(right.projectKey)
    || left.issueNumber - right.issueNumber
    || (left.reason ?? "").localeCompare(right.reason ?? ""));
}

function connectedComponents(nodeIds: string[], edges: IssueGraphEdge[], targetNodeIds: Set<string>): string[][] {
  const adjacency = new Map<string, Set<string>>();
  for (const id of nodeIds) adjacency.set(id, new Set());
  for (const edge of edges) {
    adjacency.get(edge.dependentId)?.add(edge.blockerId);
    adjacency.get(edge.blockerId)?.add(edge.dependentId);
  }

  const unseen = new Set(nodeIds);
  const components: string[][] = [];
  for (const start of [...nodeIds].sort()) {
    if (!unseen.has(start)) continue;
    const queue = [start];
    unseen.delete(start);
    const component: string[] = [];
    while (queue.length > 0) {
      const current = queue.shift()!;
      component.push(current);
      for (const neighbor of [...(adjacency.get(current) ?? [])].sort()) {
        if (!unseen.has(neighbor)) continue;
        unseen.delete(neighbor);
        queue.push(neighbor);
      }
    }
    component.sort();
    components.push(component);
  }

  return components.sort((left, right) => {
    const leftTarget = left.some((id) => targetNodeIds.has(id));
    const rightTarget = right.some((id) => targetNodeIds.has(id));
    if (leftTarget !== rightTarget) return leftTarget ? -1 : 1;
    return (left[0] ?? "").localeCompare(right[0] ?? "");
  });
}

function ranksForComponent(component: string[], edges: IssueGraphEdge[]): Map<string, number> {
  const members = new Set(component);
  const blockers = new Map<string, string[]>();
  for (const id of component) blockers.set(id, []);
  for (const edge of edges) {
    if (members.has(edge.dependentId) && members.has(edge.blockerId)) {
      blockers.get(edge.dependentId)?.push(edge.blockerId);
    }
  }
  for (const values of blockers.values()) values.sort();

  const memo = new Map<string, number>();
  const visiting = new Set<string>();
  const rankFor = (id: string): number => {
    const known = memo.get(id);
    if (known !== undefined) return known;
    if (visiting.has(id)) {
      throw new Error("Issue dependency graph contains a cycle");
    }
    visiting.add(id);
    const outgoing = blockers.get(id) ?? [];
    const rank = outgoing.length === 0
      ? 0
      : Math.max(...outgoing.map((blockerId) => rankFor(blockerId) + 1));
    visiting.delete(id);
    memo.set(id, rank);
    return rank;
  };

  for (const id of component) rankFor(id);
  return memo;
}

function layoutNodes(
  nodes: Omit<IssueGraphNode, "x" | "y" | "component" | "rank">[],
  edges: IssueGraphEdge[],
  targetProjectKey: string,
): { nodes: IssueGraphNode[]; width: number; height: number } {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const targetIds = new Set(nodes.filter((node) => node.issue.project_key === targetProjectKey).map((node) => node.id));
  const components = connectedComponents([...nodeById.keys()], edges, targetIds);
  const positioned: IssueGraphNode[] = [];
  let componentTop = PADDING_Y + NODE_RADIUS;
  let widestRank = 0;

  components.forEach((component, componentIndex) => {
    const ranks = ranksForComponent(component, edges);
    const maxRank = Math.max(0, ...ranks.values());
    widestRank = Math.max(widestRank, maxRank);
    const groups = new Map<number, string[]>();
    for (const id of component) {
      const rank = ranks.get(id) ?? 0;
      const group = groups.get(rank) ?? [];
      group.push(id);
      groups.set(rank, group);
    }
    for (const group of groups.values()) group.sort();
    const maxRows = Math.max(1, ...[...groups.values()].map((group) => group.length));
    const componentHeight = NODE_DIAMETER + Math.max(0, maxRows - 1) * VERTICAL_GAP;

    for (const rank of [...groups.keys()].sort((left, right) => right - left)) {
      const ids = groups.get(rank) ?? [];
      ids.forEach((id, index) => {
        const node = nodeById.get(id)!;
        positioned.push({
          ...node,
          x: PADDING_X + NODE_RADIUS + (maxRank - rank) * HORIZONTAL_GAP,
          y: componentTop + index * VERTICAL_GAP,
          component: componentIndex,
          rank,
        });
      });
    }
    componentTop += componentHeight + COMPONENT_GAP;
  });

  positioned.sort((left, right) => left.component - right.component || left.id.localeCompare(right.id));
  const width = Math.max(MIN_WIDTH, PADDING_X * 2 + NODE_DIAMETER + widestRank * HORIZONTAL_GAP);
  const height = Math.max(MIN_HEIGHT, componentTop - COMPONENT_GAP + PADDING_Y + NODE_RADIUS);
  return { nodes: positioned, width, height };
}

export function buildIssueDependencyGraph(
  issues: CurrentIssueRecord[],
  dependencies: CurrentIssueDependencyRecord[],
  targetProjectKey: string,
  selectedProjects: readonly string[],
): IssueDependencyGraphModel | null {
  const availableProjects = graphProjectKeys(issues);
  const visibleProjects = normalizeVisibleProjects(targetProjectKey, selectedProjects, issues);
  const visibleSet = new Set(visibleProjects);
  const visibleIssues = issues
    .filter((issue) => visibleSet.has(issue.project_key))
    .sort((left, right) =>
      left.project_key.localeCompare(right.project_key) || left.issue_number - right.issue_number);
  if (visibleIssues.length === 0) return null;

  const issueById = new Map(issues.map((issue) => [issueGraphId(issue.project_key, issue.issue_number), issue]));
  const visibleIssueIds = new Set(visibleIssues.map((issue) => issueGraphId(issue.project_key, issue.issue_number)));
  const blockersByDependent = new Map<string, IssueGraphRelation[]>();
  const dependentsByBlocker = new Map<string, IssueGraphRelation[]>();

  for (const edge of dependencies) {
    const dependentId = issueGraphId(edge.dependent_project_key, edge.dependent_issue_number);
    const blockerId = issueGraphId(edge.blocker_project_key, edge.blocker_issue_number);
    const blockerRelations = blockersByDependent.get(dependentId) ?? [];
    blockerRelations.push(relation(edge.blocker_project_key, edge.blocker_issue_number, edge.reason));
    blockersByDependent.set(dependentId, blockerRelations);
    const dependentRelations = dependentsByBlocker.get(blockerId) ?? [];
    dependentRelations.push(relation(edge.dependent_project_key, edge.dependent_issue_number, edge.reason));
    dependentsByBlocker.set(blockerId, dependentRelations);
  }

  const edges: IssueGraphEdge[] = dependencies
    .map((edge) => {
      const dependentId = issueGraphId(edge.dependent_project_key, edge.dependent_issue_number);
      const blockerId = issueGraphId(edge.blocker_project_key, edge.blocker_issue_number);
      if (!visibleIssueIds.has(dependentId) || !visibleIssueIds.has(blockerId)) return null;
      if (!issueById.has(dependentId) || !issueById.has(blockerId)) return null;
      return {
        id: `${dependentId}->${blockerId}`,
        dependentId,
        blockerId,
        reason: edge.reason,
        crossProject: edge.dependent_project_key !== edge.blocker_project_key,
      } satisfies IssueGraphEdge;
    })
    .filter((edge): edge is IssueGraphEdge => edge !== null)
    .sort((left, right) => left.id.localeCompare(right.id));

  const unpositioned = visibleIssues.map((issue) => {
    const id = issueGraphId(issue.project_key, issue.issue_number);
    const blockers = sortRelations(blockersByDependent.get(id) ?? []);
    const dependents = sortRelations(dependentsByBlocker.get(id) ?? []);
    const visualStatus = deriveIssueGraphStatus(issue, blockers.length);
    return {
      id,
      issue,
      visualStatus,
      visualLabel: statusLabel(visualStatus),
      target: issue.project_key === targetProjectKey,
      blockers,
      dependents,
    };
  });

  const layout = layoutNodes(unpositioned, edges, targetProjectKey);
  return {
    ...layout,
    edges,
    targetProjectKey,
    visibleProjects,
    availableProjects,
  };
}

export function dependencyEdgePath(edge: IssueGraphEdge, nodes: IssueGraphNode[]): string {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const dependent = nodeById.get(edge.dependentId);
  const blocker = nodeById.get(edge.blockerId);
  if (!dependent || !blocker) return "";
  const direction = blocker.x >= dependent.x ? 1 : -1;
  const startX = dependent.x + direction * (NODE_RADIUS + 4);
  const endX = blocker.x - direction * (NODE_RADIUS + 10);
  const midX = (startX + endX) / 2;
  return `M ${startX} ${dependent.y} C ${midX} ${dependent.y}, ${midX} ${blocker.y}, ${endX} ${blocker.y}`;
}
