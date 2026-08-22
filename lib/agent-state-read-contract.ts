import { RAW_TABLE_NAMES, type RawTableName } from "@/types/dashboard";

export const ISSUE_TABLE_NAMES = [
  "current_issues",
  "current_issue_dependencies",
] as const;

export type IssueTableName = typeof ISSUE_TABLE_NAMES[number];
export type DashboardTableName = RawTableName | IssueTableName;

export const DASHBOARD_TABLE_NAMES: readonly DashboardTableName[] = [
  ...RAW_TABLE_NAMES,
  ...ISSUE_TABLE_NAMES,
];

export type CurrentIssueStatus =
  | "ready"
  | "in_progress"
  | "blocked"
  | "waiting"
  | "validation";

export interface CurrentIssueRecord {
  project_key: string;
  issue_number: number;
  github_url: string | null;
  title: string;
  summary: string;
  status: CurrentIssueStatus;
  phase: string | null;
  priority: string | null;
  milestone: string | null;
  assigned_actor: string | null;
  blocker_reason: string | null;
  next_action: string | null;
  updated_at: string;
}

export interface CurrentIssueDependencyRecord {
  dependent_project_key: string;
  dependent_issue_number: number;
  blocker_project_key: string;
  blocker_issue_number: number;
  reason: string | null;
  updated_at: string;
}

export interface ProjectStoryFocusIssue {
  project_key: string;
  issue_number: number;
}

export interface CurrentProjectStory {
  summary?: string;
  objective?: string;
  phase?: string;
  focus_issues?: ProjectStoryFocusIssue[];
  related_projects?: string[];
  next_actions?: string[];
  owner_attention?: string;
}

export interface DashboardIssueData {
  issues: CurrentIssueRecord[];
  dependencies: CurrentIssueDependencyRecord[];
}

export function isIssueTableName(table: DashboardTableName): table is IssueTableName {
  return table === "current_issues" || table === "current_issue_dependencies";
}

export function issueDataFromTableRows(
  tables: Partial<Record<DashboardTableName, unknown[]>>,
): DashboardIssueData {
  return {
    issues: (tables.current_issues ?? []) as CurrentIssueRecord[],
    dependencies: (tables.current_issue_dependencies ?? []) as CurrentIssueDependencyRecord[],
  };
}
