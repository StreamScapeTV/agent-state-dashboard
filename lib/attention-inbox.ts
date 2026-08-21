import type { AgentViewRow, CurrentCoordinationRecord } from "@/types/dashboard";

export interface AttentionQueueItem {
  row: AgentViewRow;
  actionableCoordination: CurrentCoordinationRecord[];
  rank: number;
}

function coordinationKey(item: CurrentCoordinationRecord): string {
  return `${item.projectKey}::${item.sender}::${item.recipient}::${JSON.stringify(item.state)}`;
}

export function actionableCoordinationFor(
  row: AgentViewRow,
  recipient: string,
): CurrentCoordinationRecord[] {
  const unique = new Map<string, CurrentCoordinationRecord>();
  for (const item of row.coordination) {
    if (item.recipient !== recipient || item.sender !== row.identity) continue;
    unique.set(coordinationKey(item), item);
  }
  return [...unique.values()];
}

export function attentionQueueRank(row: AgentViewRow, actionableCoordinationCount: number): number {
  if (row.baseStatus === "returned" && row.blocked) return 0;
  if (actionableCoordinationCount > 0) return 1;
  if (row.blocked) return 2;
  if (row.baseStatus === "returned") return 3;
  if (row.baseStatus === "working") return 4;
  return 5;
}

export function buildAttentionQueue(
  rows: AgentViewRow[],
  recipient = "Orchestrator",
): AttentionQueueItem[] {
  return rows
    .map((row) => {
      const actionableCoordination = actionableCoordinationFor(row, recipient);
      return {
        row,
        actionableCoordination,
        rank: attentionQueueRank(row, actionableCoordination.length),
      };
    })
    .filter(({ row, actionableCoordination }) =>
      row.baseStatus !== "idle" || row.blocked || actionableCoordination.length > 0,
    )
    .sort((left, right) => {
      const rankDifference = left.rank - right.rank;
      if (rankDifference !== 0) return rankDifference;

      if (left.row.baseStatus === "working" && right.row.baseStatus === "working") {
        const durationDifference = (right.row.durationMs ?? -1) - (left.row.durationMs ?? -1);
        if (durationDifference !== 0) return durationDifference;
      }

      return left.row.key.localeCompare(right.row.key);
    });
}
