"use client";

import {
  CheckCircleRounded,
  ContentCopyRounded,
  ErrorOutlineRounded,
  HourglassTopRounded,
  PauseCircleRounded,
  StorageRounded,
} from "@mui/icons-material";
import {
  Alert,
  Box,
  Button,
  Chip,
  Collapse,
  Container,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  IconButton,
  InputLabel,
  LinearProgress,
  MenuItem,
  Paper,
  Select,
  Stack,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TablePagination,
  TableRow,
  Tabs,
  Typography,
} from "@mui/material";
import { useEffect, useMemo, useState } from "react";
import { ActivityLogView } from "@/components/ActivityLogView";
import { AttentionInbox } from "@/components/AttentionInbox";
import { CoordinationBoard } from "@/components/CoordinationBoard";
import { ProjectOverview } from "@/components/ProjectOverview";
import { ResourcesCapacityBoard } from "@/components/ResourcesCapacityBoard";
import { WorkAssignmentBoard } from "@/components/WorkAssignmentBoard";
import {
  buildAgentRows,
  buildProjectSummaries,
  formatDuration,
  refreshAgentDurations,
  statusLabel,
} from "@/lib/dashboard-model";
import {
  getDashboardSupabaseClient,
  readDashboardTable,
} from "@/lib/dashboard-supabase";
import { tableHealthLabel } from "@/lib/table-refresh-state";
import { STALE_AFTER_MS, useDashboardTables } from "@/lib/use-dashboard-tables";
import type {
  AgentStatusFilter,
  AgentViewRow,
  RawTableName,
} from "@/types/dashboard";
import { RAW_TABLE_NAMES } from "@/types/dashboard";

type AdvancedView = "logs" | "attention" | "work" | "coordination" | "resources" | "raw";
type AdvancedScope = "project" | "all";

function displayTime(value: string | null): string {
  if (!value) return "—";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
}

function shortTime(value: string | null): string {
  if (!value) return "—";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? value
    : parsed.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function pretty(value: unknown): string {
  return JSON.stringify(value, null, 2) ?? String(value);
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

function tableHealthColor(
  value: ReturnType<typeof tableHealthLabel>,
): "default" | "info" | "success" | "warning" | "error" {
  if (value === "failed") return "error";
  if (value === "stale") return "warning";
  if (value === "loading" || value === "refreshing") return "info";
  return "success";
}

function JsonPanel({ value }: { value: unknown }) {
  return (
    <Box
      component="pre"
      sx={{
        m: 0,
        p: 1.5,
        maxHeight: 360,
        overflow: "auto",
        border: "1px solid",
        borderColor: "divider",
        borderRadius: 1.5,
        whiteSpace: "pre-wrap",
        wordBreak: "break-word",
        userSelect: "text",
        fontSize: 12,
      }}
    >
      {pretty(value)}
    </Box>
  );
}

function LongText({ label, value }: { label: string; value: string | null }) {
  return (
    <Box>
      <Stack direction="row" sx={{ justifyContent: "space-between", alignItems: "center" }}>
        <Typography variant="overline">{label}</Typography>
        <IconButton
          size="small"
          disabled={!value}
          aria-label={`Copy ${label.toLowerCase()}`}
          onClick={() => {
            if (value) void navigator.clipboard.writeText(value);
          }}
        >
          <ContentCopyRounded fontSize="small" />
        </IconButton>
      </Stack>
      <Box
        component="pre"
        sx={{
          m: 0,
          p: 1.5,
          minHeight: 72,
          maxHeight: 260,
          overflow: "auto",
          border: "1px solid",
          borderColor: "divider",
          borderRadius: 1.5,
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
          userSelect: "text",
          font: "inherit",
          fontSize: 13,
        }}
      >
        {value ?? "No current value."}
      </Box>
    </Box>
  );
}

function AgentDetailDialog({ row, onClose }: { row: AgentViewRow | null; onClose: () => void }) {
  return (
    <Dialog open={Boolean(row)} onClose={onClose} maxWidth="lg" fullWidth>
      {row ? (
        <>
          <DialogTitle>{row.projectKey} · {row.identity}</DialogTitle>
          <DialogContent dividers>
            <Stack spacing={2}>
              <Stack direction="row" sx={{ gap: 0.75, alignItems: "center", flexWrap: "wrap" }}>
                <Chip
                  icon={statusIcon(row)}
                  label={statusLabel(row)}
                  color={statusColor(row)}
                  variant="outlined"
                />
                <Typography variant="body2" color="text.secondary">
                  Assigned: {displayTime(row.assignedAt)} · Returned: {displayTime(row.lastReturnedAt)} · Duration: {formatDuration(row.durationMs)}
                </Typography>
              </Stack>
              {row.blocked ? (
                <Box>
                  <Typography variant="overline">Blocker / waiting reason</Typography>
                  <Stack spacing={0.75}>
                    {row.blockerCues.length === 0 ? (
                      <Alert severity="warning">Blocked reason not recorded</Alert>
                    ) : row.blockerCues.map((cue, index) => (
                      <Alert key={`${cue.source}-${cue.workKey ?? "actor"}-${index}`} severity="warning" variant="outlined">
                        <Typography variant="body2" sx={{ fontWeight: 700 }}>{cue.reason}</Typography>
                        <Typography variant="caption" color="text.secondary">
                          {cue.source === "work" ? `Work ${cue.workKey ?? "unknown"}` : "Actor state"}
                          {cue.summary ? ` · ${cue.summary}` : ""}
                          {cue.nextAction ? ` · Next: ${cue.nextAction}` : ""}
                        </Typography>
                      </Alert>
                    ))}
                  </Stack>
                </Box>
              ) : null}
              <Typography variant="caption" color="text.secondary">
                Assignment timing: {row.assignmentAssignedAt ? "typed assignment" : row.promptAssignedAt ? "compatibility prompt" : "not observed"}
              </Typography>
              <LongText label="Current assignment" value={row.assignment?.instructions ?? null} />
              {row.assignment?.context !== null && row.assignment?.context !== undefined ? (
                <Box>
                  <Typography variant="overline">Assignment context</Typography>
                  <JsonPanel value={row.assignment.context} />
                </Box>
              ) : null}
              <LongText label="Compatibility prompt" value={row.prompt} />
              <LongText label="Latest response" value={row.lastResponse} />
              <Box>
                <Typography variant="overline">Raw current actor associations</Typography>
                <JsonPanel
                  value={{
                    state: row.state,
                    work: row.work,
                    resources: row.resources,
                    coordination: row.coordination,
                  }}
                />
              </Box>
            </Stack>
          </DialogContent>
          <DialogActions>
            <Button onClick={onClose}>Close</Button>
          </DialogActions>
        </>
      ) : null}
    </Dialog>
  );
}

function rawProjectKey(row: unknown): string | null {
  if (typeof row !== "object" || row === null || Array.isArray(row)) return null;
  const record = row as Record<string, unknown>;
  const value = record.project_key ?? record.projectKey;
  return typeof value === "string" ? value : null;
}

function RawTablesDialog({
  open,
  onClose,
  projectScope,
}: {
  open: boolean;
  onClose: () => void;
  projectScope: string | null;
}) {
  const [table, setTable] = useState<RawTableName>("current_projects");
  const [rows, setRows] = useState<unknown[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(50);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setRows([]);
    setSelectedIndex(0);
    setPage(0);
    setError(null);

    const client = getDashboardSupabaseClient();
    readDashboardTable(client, table, { signal: controller.signal })
      .then((loadedRows) => {
        const scopedRows = projectScope
          ? loadedRows.filter((row) => rawProjectKey(row) === projectScope)
          : loadedRows;
        setRows(scopedRows);
      })
      .catch((caught) => {
        if (!controller.signal.aborted) {
          setError(caught instanceof Error ? caught.message : "Raw table could not be loaded.");
        }
      });

    return () => controller.abort();
  }, [open, table, projectScope]);

  const visibleRows = useMemo(
    () => rows.slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage),
    [rows, page, rowsPerPage],
  );

  return (
    <Dialog open={open} onClose={onClose} maxWidth="lg" fullWidth>
      <DialogTitle>
        Raw current-table explorer{projectScope ? ` · ${projectScope}` : " · All projects"}
      </DialogTitle>
      <DialogContent dividers>
        <Tabs
          value={table}
          onChange={(_, value: RawTableName) => setTable(value)}
          variant="scrollable"
        >
          {RAW_TABLE_NAMES.map((name) => (
            <Tab key={name} value={name} label={name.replace("current_", "")} />
          ))}
        </Tabs>
        {error ? <Alert severity="error">{error}</Alert> : null}
        <TableContainer sx={{ maxHeight: 420 }}>
          <Table size="small">
            <TableBody>
              {visibleRows.map((row, pageIndex) => {
                const index = page * rowsPerPage + pageIndex;
                return (
                  <TableRow
                    key={index}
                    hover
                    tabIndex={0}
                    selected={selectedIndex === index}
                    onClick={() => setSelectedIndex(index)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        setSelectedIndex(index);
                      }
                    }}
                  >
                    <TableCell>
                      <Typography variant="caption" sx={{ fontFamily: "monospace" }}>
                        {pretty(row)}
                      </Typography>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </TableContainer>
        <TablePagination
          component="div"
          count={rows.length}
          page={page}
          rowsPerPage={rowsPerPage}
          rowsPerPageOptions={[25, 50, 100]}
          onPageChange={(_, nextPage) => {
            setPage(nextPage);
            setSelectedIndex(nextPage * rowsPerPage);
          }}
          onRowsPerPageChange={(event) => {
            setRowsPerPage(Number.parseInt(event.target.value, 10));
            setPage(0);
            setSelectedIndex(0);
          }}
        />
        <Typography variant="overline">Selected row JSON</Typography>
        <JsonPanel value={rows[selectedIndex] ?? {}} />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}

export function DashboardClient() {
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [selectedProjectKey, setSelectedProjectKey] = useState("all");
  const [selectedStatus, setSelectedStatus] = useState<AgentStatusFilter>("all");
  const [selectedAgentKey, setSelectedAgentKey] = useState<string | null>(null);
  const [advancedView, setAdvancedView] = useState<AdvancedView>("logs");
  const [advancedScope, setAdvancedScope] = useState<AdvancedScope>("project");
  const [rawOpen, setRawOpen] = useState(false);
  const [healthOpen, setHealthOpen] = useState(false);

  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);

  const {
    tableStates,
    snapshot,
    connectionState,
    freshness,
    lastRefresh,
    loading,
    refreshing,
    issueTables,
    activities,
  } = useDashboardTables(nowMs);

  const baseRows = useMemo(() => (snapshot ? buildAgentRows(snapshot, 0) : []), [snapshot]);
  const rows = useMemo(() => refreshAgentDurations(baseRows, nowMs), [baseRows, nowMs]);
  const projects = useMemo(
    () => (snapshot ? buildProjectSummaries(snapshot, baseRows) : []),
    [snapshot, baseRows],
  );
  const selectedAgent = useMemo(
    () => (selectedAgentKey ? rows.find((row) => row.key === selectedAgentKey) ?? null : null),
    [rows, selectedAgentKey],
  );

  useEffect(() => {
    if (selectedAgentKey && !baseRows.some((row) => row.key === selectedAgentKey)) {
      setSelectedAgentKey(null);
    }
  }, [baseRows, selectedAgentKey]);

  useEffect(() => {
    if (selectedProjectKey !== "all" && !projects.some((project) => project.projectKey === selectedProjectKey)) {
      setSelectedProjectKey("all");
    }
  }, [projects, selectedProjectKey]);

  const selectProject = (projectKey: string) => {
    setSelectedProjectKey(projectKey);
    setSelectedStatus("all");
    setAdvancedScope("project");
    setAdvancedView("logs");
  };

  const selectedProjectRows = useMemo(
    () => selectedProjectKey === "all" ? [] : rows.filter((row) => row.projectKey === selectedProjectKey),
    [rows, selectedProjectKey],
  );
  const advancedRows = selectedProjectKey !== "all" && advancedScope === "project"
    ? selectedProjectRows
    : rows;
  const advancedWork = useMemo(() => advancedRows.flatMap((row) => row.work), [advancedRows]);
  const rawProjectScope = selectedProjectKey !== "all" && advancedScope === "project"
    ? selectedProjectKey
    : null;

  const connectionLabel = connectionState === "live"
    ? "Live"
    : connectionState === "recovering"
      ? "Recovering"
      : connectionState === "reconnecting"
        ? "Reconnecting"
        : "Connecting";
  const healthy = connectionState === "live" && freshness === "fresh" && issueTables.length === 0;
  const partialWarning = issueTables.length > 0
    ? issueTables
      .map((table) => `${table.replace("current_", "")} · ${tableHealthLabel(tableStates[table], nowMs, STALE_AFTER_MS)}`)
      .join(" · ")
    : null;

  return (
    <Container maxWidth="xl" sx={{ py: { xs: 1.5, md: 2.5 } }}>
      <Stack
        direction={{ xs: "column", md: "row" }}
        sx={{ justifyContent: "space-between", gap: 1.5, mb: 1.5, alignItems: { md: "center" } }}
      >
        <Box>
          <Typography variant="overline">STREAMSCAPETV · AGENT STATE</Typography>
          <Typography variant="h4">Operations console</Typography>
        </Box>
        <Stack direction="row" sx={{ gap: 0.75, alignItems: "center", flexWrap: "wrap" }}>
          <Chip
            label={healthy
              ? `Live · ${lastRefresh ? shortTime(lastRefresh.toISOString()) : "current"}`
              : `${connectionLabel} · data ${freshness}`}
            color={healthy ? "success" : connectionState === "connecting" ? "info" : "warning"}
            variant={healthy ? "outlined" : "filled"}
          />
          <Button size="small" onClick={() => setHealthOpen((value) => !value)}>
            {healthOpen ? "Hide live details" : "Live details"}
          </Button>
        </Stack>
      </Stack>

      {partialWarning ? (
        <Alert severity={snapshot ? "warning" : "error"} sx={{ mb: 1.5 }}>
          {snapshot ? "Partial Agent State data" : "Agent State data unavailable"}: {partialWarning}
        </Alert>
      ) : null}
      {refreshing && !healthy ? <LinearProgress sx={{ mb: 1 }} /> : null}

      <Collapse in={healthOpen || !healthy}>
        <Paper variant="outlined" sx={{ p: 1.25, mb: 1.5 }}>
          <Stack spacing={1}>
            <Stack direction="row" sx={{ gap: 0.75, flexWrap: "wrap" }}>
              {RAW_TABLE_NAMES.map((table) => {
                const health = tableHealthLabel(tableStates[table], nowMs, STALE_AFTER_MS);
                return (
                  <Chip
                    key={table}
                    size="small"
                    label={`${table.replace("current_", "")} · ${health}`}
                    color={tableHealthColor(health)}
                    variant={health === "fresh" ? "outlined" : "filled"}
                  />
                );
              })}
            </Stack>
            <Typography variant="caption" color="text.secondary">
              Session event details are available under Logs / Activity after selecting a project.
            </Typography>
          </Stack>
        </Paper>
      </Collapse>

      {loading && !snapshot ? (
        <Paper variant="outlined" sx={{ p: 3 }}>
          <Typography color="text.secondary">Loading current Agent State…</Typography>
        </Paper>
      ) : snapshot ? (
        <>
          <ProjectOverview
            projects={projects}
            rows={rows}
            selectedProjectKey={selectedProjectKey}
            selectedStatus={selectedStatus}
            nowMs={nowMs}
            onSelectProject={selectProject}
            onSelectStatus={setSelectedStatus}
            onView={setSelectedAgentKey}
          />

          {selectedProjectKey !== "all" ? (
            <Paper variant="outlined" sx={{ mt: 1.5 }}>
              <Stack
                direction={{ xs: "column", md: "row" }}
                sx={{ px: 1.5, pt: 1.25, gap: 1, justifyContent: "space-between", alignItems: { md: "center" } }}
              >
                <Box>
                  <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>Advanced operations</Typography>
                  <Typography variant="caption" color="text.secondary">
                    Deep current-state inspection stays secondary to the project overview.
                  </Typography>
                </Box>
                <FormControl size="small" sx={{ minWidth: 210 }}>
                  <InputLabel>Advanced scope</InputLabel>
                  <Select
                    value={advancedScope}
                    label="Advanced scope"
                    onChange={(event) => setAdvancedScope(event.target.value as AdvancedScope)}
                  >
                    <MenuItem value="project">{selectedProjectKey}</MenuItem>
                    <MenuItem value="all">All projects</MenuItem>
                  </Select>
                </FormControl>
              </Stack>
              <Tabs
                value={advancedView}
                onChange={(_, value: AdvancedView) => setAdvancedView(value)}
                variant="scrollable"
                scrollButtons="auto"
                sx={{ px: 0.5, borderBottom: "1px solid", borderColor: "divider" }}
              >
                <Tab value="logs" label="Logs / Activity" />
                <Tab value="attention" label="Attention" />
                <Tab value="work" label="Work / assignments" />
                <Tab value="coordination" label="Coordination" />
                <Tab value="resources" label="Resources / capacity" />
                <Tab value="raw" label="Raw tables" />
              </Tabs>

              <Box sx={{ p: advancedView === "raw" ? 1.5 : 0 }}>
                {advancedView === "logs" ? (
                  <ActivityLogView activities={activities} projectScope={rawProjectScope} />
                ) : null}
                {advancedView === "attention" ? (
                  <AttentionInbox
                    rows={advancedRows}
                    projectFilter="all"
                    identityFilter="all"
                    nowMs={nowMs}
                    onView={setSelectedAgentKey}
                  />
                ) : null}
                {advancedView === "work" ? (
                  <WorkAssignmentBoard work={advancedWork} agents={advancedRows} onView={setSelectedAgentKey} />
                ) : null}
                {advancedView === "coordination" ? (
                  <CoordinationBoard agents={advancedRows} onView={setSelectedAgentKey} />
                ) : null}
                {advancedView === "resources" ? (
                  <ResourcesCapacityBoard rows={advancedRows} onView={setSelectedAgentKey} />
                ) : null}
                {advancedView === "raw" ? (
                  <Stack direction={{ xs: "column", sm: "row" }} sx={{ gap: 1, justifyContent: "space-between", alignItems: { sm: "center" } }}>
                    <Box>
                      <Typography variant="subtitle2">Raw current tables</Typography>
                      <Typography variant="caption" color="text.secondary">
                        Opens deliberate JSON inspection for {rawProjectScope ?? "all projects"}.
                      </Typography>
                    </Box>
                    <Button startIcon={<StorageRounded />} onClick={() => setRawOpen(true)}>Open raw tables</Button>
                  </Stack>
                ) : null}
              </Box>
            </Paper>
          ) : null}
        </>
      ) : (
        <Paper variant="outlined" sx={{ p: 2 }}>
          <Typography>No current Agent State table data is available.</Typography>
        </Paper>
      )}

      <AgentDetailDialog row={selectedAgent} onClose={() => setSelectedAgentKey(null)} />
      <RawTablesDialog open={rawOpen} onClose={() => setRawOpen(false)} projectScope={rawProjectScope} />
    </Container>
  );
}
