"use client";

import {
  ArrowBackRounded,
  CheckCircleRounded,
  ErrorOutlineRounded,
  ExpandMoreRounded,
  HourglassTopRounded,
  PauseCircleRounded,
  PeopleAltRounded,
  VisibilityRounded,
} from "@mui/icons-material";
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  Button,
  Card,
  CardActionArea,
  CardContent,
  Chip,
  Paper,
  Stack,
  Typography,
} from "@mui/material";
import { useMemo } from "react";
import {
  attentionRank,
  filterProjectRows,
  formatDuration,
  statusLabel,
} from "@/lib/dashboard-model";
import { parseProjectStory } from "@/lib/project-story";
import type {
  AgentStatusFilter,
  AgentViewRow,
  ProjectStory,
  ProjectSummary,
} from "@/types/dashboard";

interface ProjectOverviewProps {
  projects: ProjectSummary[];
  rows: AgentViewRow[];
  selectedProjectKey: string;
  selectedStatus: AgentStatusFilter;
  nowMs: number;
  onSelectProject: (projectKey: string) => void;
  onSelectStatus: (status: AgentStatusFilter) => void;
  onView: (key: string) => void;
}

function statusColor(row: AgentViewRow): "success" | "warning" | "info" | "default" {
  if (row.blocked) return "warning";
  if (row.baseStatus === "returned") return "success";
  if (row.baseStatus === "working") return "info";
  return "default";
}

function statusIcon(row: AgentViewRow) {
  if (row.blocked) return <ErrorOutlineRounded fontSize="small" />;
  if (row.baseStatus === "returned") return <CheckCircleRounded fontSize="small" />;
  if (row.baseStatus === "working") return <HourglassTopRounded fontSize="small" />;
  return <PauseCircleRounded fontSize="small" />;
}

function assignmentPreview(row: AgentViewRow): string {
  const instructions = row.assignment?.instructions.trim();
  if (!instructions) return row.workSummary;
  return instructions.split(/\r?\n/, 1)[0] ?? row.workSummary;
}

function ageLabel(row: AgentViewRow, nowMs: number): string {
  if (row.baseStatus === "working") return `${formatDuration(row.durationMs)} working`;
  if (row.baseStatus === "returned" && row.lastReturnedAt) {
    const returnedAt = Date.parse(row.lastReturnedAt);
    if (Number.isFinite(returnedAt)) return `${formatDuration(Math.max(0, nowMs - returnedAt))} since return`;
  }
  return "Idle";
}

function projectHealthCue(summary: ProjectSummary): string | null {
  if (summary.blocked > 0 && summary.returned > 0) return `${summary.blocked} blocked · ${summary.returned} returned`;
  if (summary.blocked > 0) return `${summary.blocked} blocked`;
  if (summary.returned > 0) return `${summary.returned} returned`;
  return null;
}

function storyPrimaryText(story: ProjectStory | null): string | null {
  return story?.summary ?? story?.objective ?? null;
}

function StoryDetails({ story }: { story: ProjectStory }) {
  const hasReferences = story.focusIssues.length > 0 || story.relatedProjects.length > 0;
  return (
    <Paper variant="outlined" sx={{ p: { xs: 1.25, sm: 1.5, md: 2 } }}>
      <Stack spacing={1.5}>
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="overline" color="text.secondary">Current story</Typography>
          {story.summary ? (
            <Typography variant="h6" sx={{ overflowWrap: "anywhere" }}>{story.summary}</Typography>
          ) : null}
          {story.objective ? (
            <Typography
              variant="body1"
              color={story.summary ? "text.secondary" : "text.primary"}
              sx={{ mt: story.summary ? 0.5 : 0, overflowWrap: "anywhere" }}
            >
              {story.objective}
            </Typography>
          ) : null}
        </Box>

        {story.ownerAttention ? (
          <Alert severity="info" variant="outlined">
            <Typography variant="overline">Owner attention</Typography>
            <Typography variant="body2" sx={{ overflowWrap: "anywhere", whiteSpace: "pre-wrap" }}>
              {story.ownerAttention}
            </Typography>
          </Alert>
        ) : null}

        {story.nextActions.length > 0 ? (
          <Box>
            <Typography variant="overline" color="text.secondary">Next actions</Typography>
            <Stack spacing={0.65}>
              {story.nextActions.map((action) => (
                <Typography key={action} variant="body2" sx={{ overflowWrap: "anywhere", whiteSpace: "pre-wrap" }}>
                  {action}
                </Typography>
              ))}
            </Stack>
          </Box>
        ) : null}

        {hasReferences ? (
          <Stack spacing={0.75}>
            {story.focusIssues.length > 0 ? (
              <Stack direction="row" sx={{ gap: 0.6, flexWrap: "wrap", alignItems: "center" }}>
                <Typography variant="overline" color="text.secondary">Focus issues</Typography>
                {story.focusIssues.map((issue) => (
                  <Chip
                    key={`${issue.projectKey}#${issue.issueNumber}`}
                    size="small"
                    variant="outlined"
                    label={`${issue.projectKey}#${issue.issueNumber}`}
                  />
                ))}
              </Stack>
            ) : null}
            {story.relatedProjects.length > 0 ? (
              <Stack direction="row" sx={{ gap: 0.6, flexWrap: "wrap", alignItems: "center" }}>
                <Typography variant="overline" color="text.secondary">Related projects</Typography>
                {story.relatedProjects.map((projectKey) => (
                  <Chip key={projectKey} size="small" variant="outlined" label={projectKey} />
                ))}
              </Stack>
            ) : null}
          </Stack>
        ) : null}
      </Stack>
    </Paper>
  );
}

function AllProjectsLanding({
  projects,
  rows,
  onSelectProject,
}: Pick<ProjectOverviewProps, "projects" | "rows" | "onSelectProject">) {
  return (
    <Box>
      <Stack
        direction={{ xs: "column", sm: "row" }}
        sx={{ justifyContent: "space-between", gap: 1, alignItems: { sm: "center" }, mb: 1.5 }}
      >
        <Box>
          <Typography variant="h5">Projects</Typography>
          <Typography variant="body2" color="text.secondary">
            Choose a project to inspect its actors, blockers, and current work.
          </Typography>
        </Box>
        <Chip
          label={`${projects.length} projects · ${rows.length} agents`}
          variant="outlined"
          sx={{ alignSelf: { xs: "flex-start", sm: "center" } }}
        />
      </Stack>

      {projects.length === 0 ? (
        <Paper variant="outlined" sx={{ p: 2 }}>
          <Typography color="text.secondary">No current projects are available.</Typography>
        </Paper>
      ) : (
        <Box
          sx={{
            display: "grid",
            gridTemplateColumns: { xs: "1fr", md: "repeat(2, minmax(0, 1fr))", xl: "repeat(3, minmax(0, 1fr))" },
            gap: { xs: 1, sm: 1.25 },
          }}
        >
          {projects.map((summary) => {
            const cue = projectHealthCue(summary);
            const story = parseProjectStory(summary.state);
            const primaryText = storyPrimaryText(story);
            return (
              <Card key={summary.projectKey} variant="outlined" sx={{ minWidth: 0 }}>
                <CardActionArea
                  onClick={() => onSelectProject(summary.projectKey)}
                  aria-label={`Open ${summary.projectKey}`}
                  sx={{ height: "100%", minHeight: { xs: 154, sm: 164 }, alignItems: "stretch" }}
                >
                  <CardContent sx={{ height: "100%", p: { xs: 1.5, sm: 2 } }}>
                    <Stack spacing={1.1} sx={{ height: "100%" }}>
                      <Stack
                        direction={{ xs: "column", sm: "row" }}
                        sx={{ justifyContent: "space-between", gap: 0.75, alignItems: { sm: "center" } }}
                      >
                        <Typography variant="h6" sx={{ minWidth: 0, overflowWrap: "anywhere" }}>
                          {summary.projectKey}
                        </Typography>
                        {story?.phase ? (
                          <Chip size="small" label={story.phase} variant="outlined" sx={{ alignSelf: "flex-start" }} />
                        ) : null}
                      </Stack>

                      {primaryText ? (
                        <Typography
                          variant="body2"
                          color="text.secondary"
                          sx={{
                            display: "-webkit-box",
                            WebkitLineClamp: 3,
                            WebkitBoxOrient: "vertical",
                            overflow: "hidden",
                            overflowWrap: "anywhere",
                          }}
                        >
                          {primaryText}
                        </Typography>
                      ) : null}

                      {story?.ownerAttention ? (
                        <Typography
                          variant="caption"
                          color="info.main"
                          sx={{
                            display: "-webkit-box",
                            WebkitLineClamp: 2,
                            WebkitBoxOrient: "vertical",
                            overflow: "hidden",
                            overflowWrap: "anywhere",
                          }}
                        >
                          Owner attention · {story.ownerAttention}
                        </Typography>
                      ) : null}

                      <Stack direction="row" sx={{ gap: 0.6, flexWrap: "wrap", mt: "auto" }}>
                        <Chip size="small" label={`${summary.total} agents`} />
                        <Chip size="small" label={`${summary.working} working`} color={summary.working > 0 ? "info" : "default"} variant="outlined" />
                        <Chip size="small" label={`${summary.blocked} blocked`} color={summary.blocked > 0 ? "warning" : "default"} variant="outlined" />
                        <Chip size="small" label={`${summary.returned} returned`} color={summary.returned > 0 ? "success" : "default"} variant="outlined" />
                        <Chip size="small" label={`${summary.idle} idle`} variant="outlined" />
                      </Stack>
                      {cue ? (
                        <Typography variant="caption" color={summary.blocked > 0 ? "warning.main" : "success.main"}>
                          Needs attention · {cue}
                        </Typography>
                      ) : null}
                    </Stack>
                  </CardContent>
                </CardActionArea>
              </Card>
            );
          })}
        </Box>
      )}
    </Box>
  );
}

interface StatusCard {
  value: AgentStatusFilter;
  label: string;
  count: number;
  icon: React.ReactNode;
  color: "default" | "info" | "warning" | "success";
}

function SelectedProjectOverview({
  projects,
  rows,
  selectedProjectKey,
  selectedStatus,
  nowMs,
  onSelectProject,
  onSelectStatus,
  onView,
}: ProjectOverviewProps) {
  const summary = projects.find((project) => project.projectKey === selectedProjectKey) ?? null;
  const projectRows = useMemo(
    () => rows.filter((row) => row.projectKey === selectedProjectKey),
    [rows, selectedProjectKey],
  );
  const visibleRows = useMemo(
    () => [...filterProjectRows(rows, selectedProjectKey, selectedStatus)]
      .sort((left, right) => attentionRank(left) - attentionRank(right) || left.identity.localeCompare(right.identity, undefined, { numeric: true })),
    [rows, selectedProjectKey, selectedStatus],
  );

  if (!summary) {
    return (
      <Alert severity="warning" action={<Button onClick={() => onSelectProject("all")}>All projects</Button>}>
        The selected project is no longer present in current Agent State.
      </Alert>
    );
  }

  const story = parseProjectStory(summary.state);
  const cards: StatusCard[] = [
    { value: "all", label: "Agents", count: summary.total, icon: <PeopleAltRounded />, color: "default" },
    { value: "working", label: "Working", count: summary.working, icon: <HourglassTopRounded />, color: "info" },
    { value: "blocked", label: "Blocked", count: summary.blocked, icon: <ErrorOutlineRounded />, color: "warning" },
    { value: "returned", label: "Returned", count: summary.returned, icon: <CheckCircleRounded />, color: "success" },
    { value: "idle", label: "Idle", count: summary.idle, icon: <PauseCircleRounded />, color: "default" },
  ];
  const selectedLabel = cards.find((card) => card.value === selectedStatus)?.label ?? "Agents";

  return (
    <Stack spacing={1.5}>
      <Paper variant="outlined" sx={{ p: { xs: 1.25, sm: 1.5, md: 2 } }}>
        <Stack spacing={1.5}>
          <Stack
            direction={{ xs: "column", md: "row" }}
            sx={{ justifyContent: "space-between", gap: 1.5, alignItems: { md: "flex-start" } }}
          >
            <Box sx={{ minWidth: 0 }}>
              <Button size="small" startIcon={<ArrowBackRounded />} onClick={() => onSelectProject("all")} sx={{ mb: 0.5 }}>
                All projects
              </Button>
              <Stack direction="row" sx={{ gap: 1, alignItems: "center", flexWrap: "wrap" }}>
                <Typography
                  variant="h4"
                  sx={{ fontSize: { xs: "1.65rem", sm: "2rem", md: "2.125rem" }, overflowWrap: "anywhere" }}
                >
                  {summary.projectKey}
                </Typography>
                {story?.phase ? <Chip label={story.phase} size="small" variant="outlined" /> : null}
              </Stack>
            </Box>
            {(summary.blocked > 0 || summary.returned > 0) ? (
              <Stack direction="row" sx={{ gap: 0.75, flexWrap: "wrap" }}>
                {summary.blocked > 0 ? <Chip color="warning" label={`${summary.blocked} blocked`} /> : null}
                {summary.returned > 0 ? <Chip color="success" label={`${summary.returned} returned`} /> : null}
              </Stack>
            ) : null}
          </Stack>

          <Box
            sx={{
              display: "grid",
              gridTemplateColumns: {
                xs: "repeat(2, minmax(0, 1fr))",
                sm: "repeat(3, minmax(0, 1fr))",
                lg: "repeat(5, minmax(0, 1fr))",
              },
              gap: { xs: 0.75, sm: 1 },
            }}
          >
            {cards.map((card) => {
              const active = selectedStatus === card.value;
              return (
                <Card key={card.value} variant="outlined" sx={{ bgcolor: active ? "action.selected" : "background.paper" }}>
                  <CardActionArea
                    aria-pressed={active}
                    aria-label={`Show ${card.label.toLowerCase()} agents`}
                    onClick={() => onSelectStatus(card.value)}
                    sx={{ minHeight: { xs: 78, sm: 82 } }}
                  >
                    <CardContent sx={{ py: 1.1, px: { xs: 1.1, sm: 1.5 }, "&:last-child": { pb: 1.1 } }}>
                      <Stack direction="row" sx={{ gap: 0.85, alignItems: "center" }}>
                        <Box sx={{ color: card.color === "default" ? "text.secondary" : `${card.color}.main`, display: "flex" }}>
                          {card.icon}
                        </Box>
                        <Box sx={{ minWidth: 0 }}>
                          <Typography variant="h5" sx={{ lineHeight: 1 }}>{card.count}</Typography>
                          <Typography variant="caption" color="text.secondary">{card.label}</Typography>
                        </Box>
                      </Stack>
                    </CardContent>
                  </CardActionArea>
                </Card>
              );
            })}
          </Box>
        </Stack>
      </Paper>

      {story ? <StoryDetails story={story} /> : null}

      <Paper variant="outlined" sx={{ overflow: "hidden" }}>
        <Stack
          direction={{ xs: "column", sm: "row" }}
          sx={{ px: { xs: 1.25, sm: 1.5 }, py: 1.25, justifyContent: "space-between", gap: 0.75, alignItems: { sm: "center" } }}
        >
          <Box>
            <Typography variant="h6">{selectedLabel}</Typography>
            <Typography variant="caption" color="text.secondary">
              {visibleRows.length} of {projectRows.length} current actors · expand for operational detail
            </Typography>
          </Box>
        </Stack>

        {visibleRows.length === 0 ? (
          <Typography sx={{ px: 1.5, pb: 1.5 }} color="text.secondary">
            No actors match this project status slice.
          </Typography>
        ) : visibleRows.map((row) => {
          const primaryBlocker = row.blockerCues[0]?.reason ?? "Blocked reason not recorded";
          return (
            <Accordion key={row.key} disableGutters elevation={0} sx={{ borderTop: "1px solid", borderColor: "divider", "&:before": { display: "none" } }}>
              <AccordionSummary
                expandIcon={<ExpandMoreRounded />}
                aria-controls={`${row.key}-details`}
                sx={{ px: { xs: 1.25, sm: 2 }, py: { xs: 0.25, sm: 0 } }}
              >
                <Box
                  sx={{
                    width: "100%",
                    display: "grid",
                    gridTemplateColumns: {
                      xs: "minmax(0, 1fr)",
                      sm: "minmax(0, 1.3fr) minmax(120px, .7fr)",
                      lg: "minmax(130px, .7fr) minmax(140px, .8fr) minmax(220px, 1.8fr) minmax(110px, .7fr) minmax(180px, 1fr)",
                    },
                    gap: { xs: 0.45, sm: 0.75, lg: 1.25 },
                    alignItems: "center",
                    pr: { xs: 0.5, sm: 1 },
                  }}
                >
                  <Typography sx={{ fontWeight: 700, overflowWrap: "anywhere" }}>{row.identity}</Typography>
                  <Chip size="small" icon={statusIcon(row)} label={statusLabel(row)} color={statusColor(row)} sx={{ justifySelf: "start" }} />
                  <Box sx={{ minWidth: 0 }}>
                    <Typography
                      sx={{
                        display: "-webkit-box",
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: "vertical",
                        overflow: "hidden",
                        overflowWrap: "anywhere",
                      }}
                    >
                      {row.workSummary}
                    </Typography>
                    {row.blocked ? (
                      <Typography
                        variant="caption"
                        color="warning.main"
                        sx={{ display: "block", whiteSpace: "normal", overflowWrap: "anywhere" }}
                      >
                        Blocker: {primaryBlocker}
                      </Typography>
                    ) : null}
                  </Box>
                  <Typography variant="caption" color="text.secondary">{ageLabel(row, nowMs)}</Typography>
                  {row.nextAction ? (
                    <Typography variant="caption" sx={{ whiteSpace: "normal", overflowWrap: "anywhere" }}>
                      Next: {row.nextAction}
                    </Typography>
                  ) : <Box />}
                </Box>
              </AccordionSummary>
              <AccordionDetails sx={{ pt: 0, px: { xs: 1.25, sm: 2 }, pb: { xs: 1.5, sm: 2 } }} id={`${row.key}-details`}>
                <Stack spacing={1.25}>
                  <Box>
                    <Typography variant="overline">Current assignment / work</Typography>
                    <Typography variant="body2" sx={{ overflowWrap: "anywhere" }}>{assignmentPreview(row)}</Typography>
                  </Box>

                  {row.blocked ? (
                    <Stack spacing={0.75}>
                      <Typography variant="overline">Blocker / waiting reason</Typography>
                      {row.blockerCues.length === 0 ? (
                        <Alert severity="warning">Blocked reason not recorded</Alert>
                      ) : row.blockerCues.map((cue, index) => (
                        <Alert key={`${cue.source}-${cue.workKey ?? "actor"}-${index}`} severity="warning" variant="outlined">
                          <Typography variant="body2" sx={{ fontWeight: 700, overflowWrap: "anywhere" }}>{cue.reason}</Typography>
                          <Typography variant="caption" color="text.secondary" sx={{ overflowWrap: "anywhere" }}>
                            {cue.source === "work" ? `Work ${cue.workKey ?? "unknown"}` : "Actor state"}
                            {cue.summary ? ` · ${cue.summary}` : ""}
                            {cue.nextAction ? ` · Next: ${cue.nextAction}` : ""}
                          </Typography>
                        </Alert>
                      ))}
                    </Stack>
                  ) : null}

                  <Stack direction="row" sx={{ gap: 0.75, flexWrap: "wrap" }}>
                    {row.work.map((item) => <Chip key={item.workKey} size="small" label={item.workKey} variant="outlined" />)}
                    <Chip size="small" label={`${row.resources.length} resources`} variant="outlined" />
                    <Chip size="small" label={`${row.coordination.length} coordination`} variant="outlined" />
                  </Stack>

                  {row.nextAction ? (
                    <Box>
                      <Typography variant="overline">Next action</Typography>
                      <Typography variant="body2" sx={{ overflowWrap: "anywhere", whiteSpace: "pre-wrap" }}>
                        {row.nextAction}
                      </Typography>
                    </Box>
                  ) : null}

                  <Box>
                    <Button
                      size="small"
                      startIcon={<VisibilityRounded />}
                      onClick={() => onView(row.key)}
                      sx={{ width: { xs: "100%", sm: "auto" } }}
                    >
                      Full agent details
                    </Button>
                  </Box>
                </Stack>
              </AccordionDetails>
            </Accordion>
          );
        })}
      </Paper>
    </Stack>
  );
}

export function ProjectOverview(props: ProjectOverviewProps) {
  if (props.selectedProjectKey === "all") {
    return (
      <AllProjectsLanding
        projects={props.projects}
        rows={props.rows}
        onSelectProject={props.onSelectProject}
      />
    );
  }
  return <SelectedProjectOverview {...props} />;
}
