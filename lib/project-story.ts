import type { JsonValue, ProjectStory, ProjectStoryIssueRef } from "@/types/dashboard";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function uniqueStrings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of value) {
    const text = optionalString(item);
    if (!text || seen.has(text)) continue;
    seen.add(text);
    result.push(text);
  }
  return result;
}

function focusIssues(value: unknown): ProjectStoryIssueRef[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const result: ProjectStoryIssueRef[] = [];
  for (const item of value) {
    if (!isRecord(item)) continue;
    const projectKey = optionalString(item.project_key);
    const issueNumber = item.issue_number;
    if (!projectKey || typeof issueNumber !== "number" || !Number.isSafeInteger(issueNumber) || issueNumber <= 0) {
      continue;
    }
    const key = `${projectKey}#${issueNumber}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({ projectKey, issueNumber });
  }
  return result;
}

export function parseProjectStory(state: JsonValue): ProjectStory | null {
  if (!isRecord(state) || !isRecord(state.story)) return null;

  const story = state.story;
  const parsed: ProjectStory = {
    summary: optionalString(story.summary),
    objective: optionalString(story.objective),
    phase: optionalString(story.phase),
    focusIssues: focusIssues(story.focus_issues),
    relatedProjects: uniqueStrings(story.related_projects),
    nextActions: uniqueStrings(story.next_actions),
    ownerAttention: optionalString(story.owner_attention),
  };

  if (
    !parsed.summary
    && !parsed.objective
    && !parsed.phase
    && parsed.focusIssues.length === 0
    && parsed.relatedProjects.length === 0
    && parsed.nextActions.length === 0
    && !parsed.ownerAttention
  ) {
    return null;
  }

  return parsed;
}
