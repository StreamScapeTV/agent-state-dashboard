"use client";

import {
  AddRounded,
  CenterFocusStrongRounded,
  CheckCircleRounded,
  ErrorOutlineRounded,
  HourglassTopRounded,
  OpenInNewRounded,
  RemoveRounded,
  RestartAltRounded,
} from "@mui/icons-material";
import {
  Box,
  Button,
  ButtonBase,
  Chip,
  IconButton,
  Paper,
  Stack,
  Tooltip,
  Typography,
} from "@mui/material";
import {
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  CurrentIssueDependencyRecord,
  CurrentIssueRecord,
} from "@/lib/agent-state-read-contract";
import {
  buildIssueDependencyGraph,
  defaultVisibleProjects,
  dependencyEdgePath,
  graphProjectKeys,
  normalizeVisibleProjects,
  type IssueGraphNode,
  type IssueGraphVisualStatus,
} from "@/lib/issue-dependency-graph";

interface IssueDependencyGraphProps {
  issues: CurrentIssueRecord[];
  dependencies: CurrentIssueDependencyRecord[];
  targetProjectKey: string;
}

interface ViewTransform {
  x: number;
  y: number;
  scale: number;
}

const MIN_SCALE = 0.28;
const MAX_SCALE = 2;
const RESET_VIEW: ViewTransform = { x: 24, y: 24, scale: 1 };

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function statusColor(status: IssueGraphVisualStatus): "error" | "warning" | "success" {
  if (status === "blocked") return "error";
  if (status === "active") return "warning";
  return "success";
}

function StatusIcon({ status }: { status: IssueGraphVisualStatus }) {
  if (status === "blocked") return <ErrorOutlineRounded fontSize="small" />;
  if (status === "active") return <HourglassTopRounded fontSize="small" />;
  return <CheckCircleRounded fontSize="small" />;
}

function relationIdentity(projectKey: string, issueNumber: number): string {
  return `${projectKey}#${issueNumber}`;
}

function IssueGraphNodeCard({
  node,
  expanded,
  onToggle,
}: {
  node: IssueGraphNode;
  expanded: boolean;
  onToggle: () => void;
}) {
  const issue = node.issue;
  const color = statusColor(node.visualStatus);
  const summary = issue.summary.trim();
  const assignedActor = issue.assigned_actor?.trim() || null;
  const blockerReason = issue.blocker_reason?.trim() || null;
  const nextAction = issue.next_action?.trim() || null;
  const githubUrl = issue.github_url?.trim() || null;

  return (
    <Paper
      data-graph-node="true"
      elevation={expanded ? 10 : 2}
      sx={{
        position: "absolute",
        left: node.x,
        top: node.y,
        width: expanded ? 310 : 96,
        height: expanded ? 330 : 96,
        transform: "translate(-50%, -50%)",
        transformOrigin: "center",
        borderRadius: expanded ? 3 : "50%",
        borderStyle: "solid",
        borderWidth: node.target ? 3 : 2,
        borderColor: `${color}.main`,
        bgcolor: "background.paper",
        overflow: "hidden",
        zIndex: expanded ? 5 : 2,
        transition: "width 180ms ease, height 180ms ease, border-radius 180ms ease, box-shadow 180ms ease",
      }}
    >
      <ButtonBase
        onClick={onToggle}
        aria-expanded={expanded}
        aria-current={node.target ? "true" : undefined}
        aria-label={`${issue.project_key} issue ${issue.issue_number}, ${node.visualLabel}${assignedActor ? `, assigned to ${assignedActor}` : ""}. ${expanded ? "Collapse" : "Expand"} issue details.`}
        sx={{
          width: "100%",
          height: expanded ? 82 : "100%",
          px: expanded ? 1.5 : 0.75,
          py: expanded ? 1 : 0.7,
          display: "flex",
          flexDirection: "column",
          alignItems: expanded ? "flex-start" : "center",
          justifyContent: "center",
          borderBottom: expanded ? "1px solid" : "none",
          borderColor: "divider",
          textAlign: expanded ? "left" : "center",
        }}
      >
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{ width: "100%", fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
        >
          {issue.project_key}
        </Typography>
        <Typography
          variant={expanded ? "subtitle2" : "caption"}
          sx={{ width: "100%", fontWeight: 800, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
        >
          {assignedActor ? `${assignedActor} · #${issue.issue_number}` : `#${issue.issue_number}`}
        </Typography>
        <Stack direction="row" sx={{ gap: 0.35, alignItems: "center", color: `${color}.main`, mt: 0.2 }}>
          <StatusIcon status={node.visualStatus} />
          <Typography variant="caption" sx={{ fontWeight: 800 }}>{node.visualLabel}</Typography>
          {expanded && node.target ? <Chip size="small" label="Target" color="info" variant="outlined" sx={{ ml: 0.5 }} /> : null}
        </Stack>
      </ButtonBase>

      {expanded ? (
        <Box sx={{ height: "calc(100% - 82px)", overflowY: "auto", px: 1.5, py: 1.25 }}>
          <Stack spacing={1}>
            <Typography variant="subtitle2" sx={{ overflowWrap: "anywhere", lineHeight: 1.25 }}>
              {issue.title}
            </Typography>
            {summary ? (
              <Typography variant="body2" color="text.secondary" sx={{ overflowWrap: "anywhere", whiteSpace: "pre-wrap" }}>
                {summary}
              </Typography>
            ) : null}

            {(issue.phase || issue.priority || issue.milestone) ? (
              <Stack direction="row" sx={{ gap: 0.5, flexWrap: "wrap" }}>
                {issue.phase ? <Chip size="small" label={issue.phase} variant="outlined" /> : null}
                {issue.priority ? <Chip size="small" label={issue.priority} variant="outlined" /> : null}
                {issue.milestone ? <Chip size="small" label={issue.milestone} variant="outlined" /> : null}
              </Stack>
            ) : null}

            {blockerReason ? (
              <Box>
                <Typography variant="overline" color="error.main">Blocker / waiting reason</Typography>
                <Typography variant="body2" sx={{ overflowWrap: "anywhere", whiteSpace: "pre-wrap" }}>
                  {blockerReason}
                </Typography>
              </Box>
            ) : null}

            {node.blockers.length > 0 ? (
              <Box>
                <Typography variant="overline" color="text.secondary">Blocked by</Typography>
                <Stack spacing={0.35}>
                  {node.blockers.map((blocker) => (
                    <Typography key={relationIdentity(blocker.projectKey, blocker.issueNumber)} variant="body2" sx={{ overflowWrap: "anywhere" }}>
                      {relationIdentity(blocker.projectKey, blocker.issueNumber)}{blocker.reason ? ` · ${blocker.reason}` : ""}
                    </Typography>
                  ))}
                </Stack>
              </Box>
            ) : null}

            {node.dependents.length > 0 ? (
              <Box>
                <Typography variant="overline" color="text.secondary">Blocks</Typography>
                <Typography variant="body2" sx={{ overflowWrap: "anywhere" }}>
                  {node.dependents.map((dependent) => relationIdentity(dependent.projectKey, dependent.issueNumber)).join(" · ")}
                </Typography>
              </Box>
            ) : null}

            {nextAction ? (
              <Box>
                <Typography variant="overline" color="text.secondary">Next action</Typography>
                <Typography variant="body2" sx={{ overflowWrap: "anywhere", whiteSpace: "pre-wrap" }}>
                  {nextAction}
                </Typography>
              </Box>
            ) : null}

            {githubUrl ? (
              <Button
                component="a"
                href={githubUrl}
                target="_blank"
                rel="noreferrer"
                size="small"
                endIcon={<OpenInNewRounded />}
                sx={{ alignSelf: "flex-start" }}
              >
                Open GitHub issue
              </Button>
            ) : null}
          </Stack>
        </Box>
      ) : null}
    </Paper>
  );
}

export function IssueDependencyGraph({
  issues,
  dependencies,
  targetProjectKey,
}: IssueDependencyGraphProps) {
  const availableProjects = useMemo(() => graphProjectKeys(issues), [issues]);
  const [visibleProjects, setVisibleProjects] = useState<string[]>(() =>
    defaultVisibleProjects(targetProjectKey, issues, dependencies));
  const [expandedNodeId, setExpandedNodeId] = useState<string | null>(null);
  const [view, setView] = useState<ViewTransform>(RESET_VIEW);
  const [isPanning, setIsPanning] = useState(false);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const previousTargetRef = useRef(targetProjectKey);
  const panRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
  } | null>(null);

  const issueProjectSignature = availableProjects.join("\u0000");
  const relationSignature = useMemo(() => dependencies
    .map((edge) => `${edge.dependent_project_key}#${edge.dependent_issue_number}>${edge.blocker_project_key}#${edge.blocker_issue_number}`)
    .sort()
    .join("\u0000"), [dependencies]);

  useEffect(() => {
    const targetChanged = previousTargetRef.current !== targetProjectKey;
    previousTargetRef.current = targetProjectKey;
    setVisibleProjects((current) => {
      if (targetChanged || current.length === 0) {
        return defaultVisibleProjects(targetProjectKey, issues, dependencies);
      }
      return normalizeVisibleProjects(targetProjectKey, current, issues);
    });
    if (targetChanged) setExpandedNodeId(null);
  }, [targetProjectKey, issueProjectSignature, relationSignature, issues, dependencies]);

  const graph = useMemo(() => buildIssueDependencyGraph(
    issues,
    dependencies,
    targetProjectKey,
    visibleProjects,
  ), [issues, dependencies, targetProjectKey, visibleProjects]);

  const graphWidth = graph?.width ?? 0;
  const graphHeight = graph?.height ?? 0;
  const layoutKey = graph
    ? `${targetProjectKey}|${graph.visibleProjects.join(",")}|${graph.nodes.map((node) => `${node.id}:${node.x}:${node.y}`).join("|")}`
    : "";

  const fitToContent = useCallback(() => {
    const viewport = viewportRef.current;
    if (!viewport || graphWidth <= 0 || graphHeight <= 0) return;
    const padding = 32;
    const scale = clamp(Math.min(
      (viewport.clientWidth - padding * 2) / graphWidth,
      (viewport.clientHeight - padding * 2) / graphHeight,
    ), MIN_SCALE, 1.25);
    setView({
      scale,
      x: (viewport.clientWidth - graphWidth * scale) / 2,
      y: (viewport.clientHeight - graphHeight * scale) / 2,
    });
  }, [graphWidth, graphHeight]);

  useEffect(() => {
    if (!layoutKey) return;
    const frame = window.requestAnimationFrame(fitToContent);
    return () => window.cancelAnimationFrame(frame);
  }, [layoutKey, fitToContent]);

  useEffect(() => {
    if (expandedNodeId && !graph?.nodes.some((node) => node.id === expandedNodeId)) {
      setExpandedNodeId(null);
    }
  }, [expandedNodeId, graph]);

  const zoomAround = useCallback((factor: number, centerX?: number, centerY?: number) => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    setView((current) => {
      const nextScale = clamp(current.scale * factor, MIN_SCALE, MAX_SCALE);
      const x = centerX ?? viewport.clientWidth / 2;
      const y = centerY ?? viewport.clientHeight / 2;
      const graphX = (x - current.x) / current.scale;
      const graphY = (y - current.y) / current.scale;
      return {
        scale: nextScale,
        x: x - graphX * nextScale,
        y: y - graphY * nextScale,
      };
    });
  }, []);

  const handleWheel = (event: ReactWheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    zoomAround(event.deltaY < 0 ? 1.12 : 0.89, event.clientX - rect.left, event.clientY - rect.top);
  };

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const element = event.target instanceof Element ? event.target : null;
    if (element?.closest("[data-graph-node], [data-graph-control]")) return;
    panRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: view.x,
      originY: view.y,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    setIsPanning(true);
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const pan = panRef.current;
    if (!pan || pan.pointerId !== event.pointerId) return;
    setView((current) => ({
      ...current,
      x: pan.originX + event.clientX - pan.startX,
      y: pan.originY + event.clientY - pan.startY,
    }));
  };

  const endPointerPan = (event: ReactPointerEvent<HTMLDivElement>) => {
    const pan = panRef.current;
    if (!pan || pan.pointerId !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    panRef.current = null;
    setIsPanning(false);
  };

  if (!graph) return null;

  const toggleProject = (projectKey: string) => {
    if (projectKey === targetProjectKey) return;
    setVisibleProjects((current) => {
      const next = current.includes(projectKey)
        ? current.filter((value) => value !== projectKey)
        : [...current, projectKey];
      return normalizeVisibleProjects(targetProjectKey, next, issues);
    });
    setExpandedNodeId(null);
  };

  return (
    <Paper variant="outlined" sx={{ mt: 1.5, p: { xs: 1.25, sm: 1.5 }, minWidth: 0 }}>
      <Stack spacing={1.25}>
        <Stack
          direction={{ xs: "column", md: "row" }}
          sx={{ gap: 1, justifyContent: "space-between", alignItems: { md: "flex-start" } }}
        >
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="h6">Live issue dependencies</Typography>
            <Typography variant="caption" color="text.secondary" sx={{ display: "block", maxWidth: 760 }}>
              Target: {targetProjectKey}. Directed arrows point from dependent issues to their blockers. Drag the canvas to pan; use the controls to zoom or fit.
            </Typography>
          </Box>
          <Button
            variant="outlined"
            size="small"
            onClick={() => {
              setVisibleProjects(defaultVisibleProjects(targetProjectKey, issues, dependencies));
              setExpandedNodeId(null);
            }}
            sx={{ alignSelf: { xs: "stretch", md: "flex-start" }, whiteSpace: "nowrap" }}
          >
            Target + related
          </Button>
        </Stack>

        <Box>
          <Typography variant="overline" color="text.secondary">Visible projects</Typography>
          <Stack direction="row" sx={{ gap: 0.6, flexWrap: "wrap" }}>
            {availableProjects.map((projectKey) => {
              const visible = graph.visibleProjects.includes(projectKey);
              const target = projectKey === targetProjectKey;
              return (
                <Button
                  key={projectKey}
                  size="small"
                  variant={visible ? "contained" : "outlined"}
                  color={target ? "info" : "inherit"}
                  disabled={target}
                  aria-pressed={visible}
                  onClick={() => toggleProject(projectKey)}
                  sx={{ maxWidth: "100%", textTransform: "none", overflowWrap: "anywhere" }}
                >
                  {projectKey}{target ? " · target" : ""}
                </Button>
              );
            })}
          </Stack>
        </Box>

        <Stack direction="row" sx={{ gap: 0.6, flexWrap: "wrap", alignItems: "center" }}>
          <Chip size="small" icon={<ErrorOutlineRounded />} label="Blocked" color="error" variant="outlined" />
          <Chip size="small" icon={<HourglassTopRounded />} label="Active" color="warning" variant="outlined" />
          <Chip size="small" icon={<CheckCircleRounded />} label="Ready" color="success" variant="outlined" />
          <Typography variant="caption" color="text.secondary">
            Red/blocked also applies whenever a live blocker edge exists, regardless of the issue row status.
          </Typography>
        </Stack>

        <Box
          ref={viewportRef}
          role="region"
          aria-label={`Directed issue dependency graph for ${targetProjectKey}`}
          tabIndex={0}
          onWheel={handleWheel}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={endPointerPan}
          onPointerCancel={endPointerPan}
          sx={{
            position: "relative",
            width: "100%",
            height: { xs: 430, sm: 520, md: 620 },
            overflow: "hidden",
            border: "1px solid",
            borderColor: "divider",
            borderRadius: 2,
            bgcolor: "background.default",
            touchAction: "none",
            cursor: isPanning ? "grabbing" : "grab",
            outlineOffset: 2,
          }}
        >
          <Stack
            data-graph-control="true"
            direction="row"
            sx={{
              position: "absolute",
              top: 8,
              right: 8,
              zIndex: 20,
              p: 0.4,
              gap: 0.25,
              borderRadius: 1.5,
              bgcolor: "background.paper",
              border: "1px solid",
              borderColor: "divider",
            }}
          >
            <Tooltip title="Zoom in">
              <IconButton size="small" aria-label="Zoom graph in" onClick={() => zoomAround(1.2)}>
                <AddRounded fontSize="small" />
              </IconButton>
            </Tooltip>
            <Tooltip title="Zoom out">
              <IconButton size="small" aria-label="Zoom graph out" onClick={() => zoomAround(0.8)}>
                <RemoveRounded fontSize="small" />
              </IconButton>
            </Tooltip>
            <Tooltip title="Fit graph">
              <IconButton size="small" aria-label="Fit dependency graph to view" onClick={fitToContent}>
                <CenterFocusStrongRounded fontSize="small" />
              </IconButton>
            </Tooltip>
            <Tooltip title="Reset view">
              <IconButton size="small" aria-label="Reset dependency graph view" onClick={() => setView(RESET_VIEW)}>
                <RestartAltRounded fontSize="small" />
              </IconButton>
            </Tooltip>
          </Stack>

          <Box
            sx={{
              position: "absolute",
              left: 0,
              top: 0,
              width: graph.width,
              height: graph.height,
              transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`,
              transformOrigin: "0 0",
              transition: isPanning ? "none" : "transform 120ms ease-out",
            }}
          >
            <svg
              viewBox={`0 0 ${graph.width} ${graph.height}`}
              aria-hidden="true"
              style={{
                position: "absolute",
                left: 0,
                top: 0,
                width: graph.width,
                height: graph.height,
                overflow: "visible",
                color: "currentColor",
                pointerEvents: "none",
                zIndex: 1,
              }}
            >
              <defs>
                <marker id="dependency-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto" markerUnits="strokeWidth">
                  <path d="M 0 0 L 8 4 L 0 8 z" fill="currentColor" />
                </marker>
              </defs>
              {graph.edges.map((edge) => (
                <path
                  key={edge.id}
                  d={dependencyEdgePath(edge, graph.nodes)}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                  strokeDasharray={edge.crossProject ? "7 5" : undefined}
                  markerEnd="url(#dependency-arrow)"
                  opacity={0.72}
                />
              ))}
            </svg>

            {graph.nodes.map((node) => (
              <IssueGraphNodeCard
                key={node.id}
                node={node}
                expanded={expandedNodeId === node.id}
                onToggle={() => setExpandedNodeId((current) => current === node.id ? null : node.id)}
              />
            ))}
          </Box>
        </Box>
      </Stack>
    </Paper>
  );
}
