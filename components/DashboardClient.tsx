"use client";

import {
  AutorenewRounded,
  CheckCircleRounded,
  ContentCopyRounded,
  ErrorOutlineRounded,
  HourglassTopRounded,
  PauseCircleRounded,
  SearchRounded,
  StorageRounded,
  VisibilityRounded,
} from "@mui/icons-material";
import {
  Alert,
  Box,
  Button,
  Card,
  CardActionArea,
  CardContent,
  Chip,
  CircularProgress,
  Container,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  IconButton,
  InputAdornment,
  InputLabel,
  LinearProgress,
  MenuItem,
  Paper,
  Select,
  Skeleton,
  Stack,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TablePagination,
  TableRow,
  TableSortLabel,
  Tabs,
  TextField,
  Typography,
} from "@mui/material";
import { useEffect, useMemo, useState } from "react";
import { AttentionInbox } from "@/components/AttentionInbox";
import {
  attentionRank,
  buildAgentRows,
  buildProjectSummaries,
  formatDuration,
  refreshAgentDurations,
  statusLabel,
  type DashboardLiveState,
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
  IdentityKind,
  ProjectSummary,
  RawTableName,
} from "@/types/dashboard";
import { RAW_TABLE_NAMES } from "@/types/dashboard";

type SortKey = "attention" | "project" | "identity" | "duration" | "assigned" | "returned";
type SortDirection = "asc" | "desc";

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
          minHeight: 80,
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
              <Chip
                icon={statusIcon(row)}
                label={statusLabel(row)}
                color={statusColor(row)}
                variant="outlined"
              />
              <Typography>
                Assigned: {displayTime(row.assignedAt)} · Returned: {displayTime(row.lastReturnedAt)} · Duration: {formatDuration(row.durationMs)}
              </Typography>
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
              <JsonPanel
                value={{
                  state: row.state,
                  work: row.work,
                  resources: row.resources,
                  coordination: row.coordination,
                }}
              />
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

function RawTablesDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
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
      .then(setRows)
      .catch((caught) => {
        if (!controller.signal.aborted) {
          setError(caught instanceof Error ? caught.message : "Raw table could not be loaded.");
        }
      });

    return () => controller.abort();
  }, [open, table]);

  const visibleRows = useMemo(
    () => rows.slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage),
    [rows, page, rowsPerPage],
  );

  return (
    <Dialog open={open} onClose={onClose} maxWidth="lg" fullWidth>
      <DialogTitle>Raw current-table explorer</DialogTitle>
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

function ProjectCards({
  projects,
  selected,
  onSelect,
}: {
  projects: ProjectSummary[];
  selected: string;
  onSelect: (value: string) => void;
}) {
  return (
    <Stack direction="row" sx={{ gap: 1, overflowX: "auto", mb: 2 }}>
      {projects.map((summary) => {
        const active = selected === summary.projectKey;
        return (
          <Card
            key={summary.projectKey}
            variant="outlined"
            sx={{ minWidth: 260, bgcolor: active ? "action.selected" : "background.paper" }}
          >
            <CardActionArea
              aria-pressed={active}
              onClick={() => onSelect(active ? "all" : summary.projectKey)}
            >
              <CardContent>
                <Typography variant="subtitle2">{summary.projectKey}</Typography>
                <Typography variant="caption" color="text.secondary" noWrap>
                  {summary.phase ?? "No phase"} · {summary.objective ?? "No current objective"}
                </Typography>
                {summary.nextAction ? (
                  <Typography variant="caption" sx={{ display: "block" }} noWrap>
                    Next: {summary.nextAction}
                  </Typography>
                ) : null}
                <Typography variant="caption">
                  {summary.working} working · {summary.returned} returned · {summary.blocked} blocked · {summary.idle} idle
                </Typography>
              </CardContent>
            </CardActionArea>
          </Card>
        );
      })}
    </Stack>
  );
}

interface AgentTableProps {
  rows: AgentViewRow[];
  sortKey: SortKey;
  sortDirection: SortDirection;
  sort: (key: SortKey) => void;
  onView: (key: string) => void;
}

function AgentTable({ rows, sortKey, sortDirection, sort, onView }: AgentTableProps) {
  const dir = (key: SortKey): SortDirection => (sortKey === key ? sortDirection : "asc");
  return (
    <TableContainer sx={{ maxHeight: "calc(100vh - 390px)", minHeight: 300 }}>
      <Table size="small" stickyHeader>
        <TableHead>
          <TableRow>
            <TableCell>
              <TableSortLabel active={sortKey === "project"} direction={dir("project")} onClick={() => sort("project")}>
                Project
              </TableSortLabel>
            </TableCell>
            <TableCell>
              <TableSortLabel active={sortKey === "identity"} direction={dir("identity")} onClick={() => sort("identity")}>
                Identity
              </TableSortLabel>
            </TableCell>
            <TableCell>
              <TableSortLabel active={sortKey === "attention"} direction={dir("attention")} onClick={() => sort("attention")}>
                Status
              </TableSortLabel>
            </TableCell>
            <TableCell>Current work / next action</TableCell>
            <TableCell>
              <TableSortLabel active={sortKey === "assigned"} direction={dir("assigned")} onClick={() => sort("assigned")}>
                Assigned
              </TableSortLabel>
            </TableCell>
            <TableCell>
              <TableSortLabel active={sortKey === "returned"} direction={dir("returned")} onClick={() => sort("returned")}>
                Returned
              </TableSortLabel>
            </TableCell>
            <TableCell>
              <TableSortLabel active={sortKey === "duration"} direction={dir("duration")} onClick={() => sort("duration")}>
                Duration
              </TableSortLabel>
            </TableCell>
            <TableCell />
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.key} hover>
              <TableCell>{row.projectKey}</TableCell>
              <TableCell>
                <Typography sx={{ fontWeight: 700 }}>{row.identity}</Typography>
                <Typography variant="caption">{row.identityKind}</Typography>
              </TableCell>
              <TableCell>
                <Chip size="small" icon={statusIcon(row)} label={statusLabel(row)} color={statusColor(row)} />
              </TableCell>
              <TableCell>
                <Typography noWrap>{row.workSummary}</Typography>
                {row.nextAction ? <Typography variant="caption" noWrap>Next: {row.nextAction}</Typography> : null}
              </TableCell>
              <TableCell>{shortTime(row.assignedAt)}</TableCell>
              <TableCell>{shortTime(row.lastReturnedAt)}</TableCell>
              <TableCell>{formatDuration(row.durationMs)}</TableCell>
              <TableCell>
                <Button size="small" startIcon={<VisibilityRounded />} onClick={() => onView(row.key)}>View</Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  );
}

export function DashboardClient() {
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [query, setQuery] = useState("");
  const [projectFilter, setProjectFilter] = useState("all");
  const [identityFilter, setIdentityFilter] = useState<IdentityKind | "all">("all");
  const [statusFilter, setStatusFilter] = useState<AgentStatusFilter>("all");
  const [sortKey, setSortKey] = useState<SortKey>("attention");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const [selectedAgentKey, setSelectedAgentKey] = useState<string | null>(null);
  const [rawOpen, setRawOpen] = useState(false);

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
    requestFullRefresh,
  } = useDashboardTables(nowMs);

  const baseRows = useMemo(() => (snapshot ? buildAgentRows(snapshot, 0) : []), [snapshot]);
  const rows = useMemo(() => refreshAgentDurations(baseRows, nowMs), [baseRows, nowMs]);
  const selectedAgent = useMemo(
    () => (selectedAgentKey ? rows.find((row) => row.key === selectedAgentKey) ?? null : null),
    [rows, selectedAgentKey],
  );

  useEffect(() => {
    if (selectedAgentKey && !baseRows.some((row) => row.key === selectedAgentKey)) {
      setSelectedAgentKey(null);
    }
  }, [baseRows, selectedAgentKey]);

  const projects = useMemo(
    () => (snapshot ? buildProjectSummaries(snapshot, baseRows) : []),
    [snapshot, baseRows],
  );

  const filteredRows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const filtered = rows.filter((row) =>
      (projectFilter === "all" || row.projectKey === projectFilter)
      && (identityFilter === "all" || row.identityKind === identityFilter)
      && (statusFilter === "all" || (statusFilter === "blocked" ? row.blocked : row.baseStatus === statusFilter))
      && (
        !needle
        || [
          row.projectKey,
          row.identity,
          row.assignment?.instructions ?? "",
          row.assignment?.context === null || row.assignment?.context === undefined ? "" : pretty(row.assignment.context),
          row.prompt ?? "",
          row.workSummary,
          row.nextAction ?? "",
          statusLabel(row),
        ].join(" ").toLowerCase().includes(needle)
      ),
    );
    const sign = sortDirection === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => {
      let value = 0;
      if (sortKey === "attention") value = attentionRank(a) - attentionRank(b);
      if (sortKey === "project") value = a.projectKey.localeCompare(b.projectKey);
      if (sortKey === "identity") value = a.identity.localeCompare(b.identity, undefined, { numeric: true });
      if (sortKey === "duration") value = (a.durationMs ?? -1) - (b.durationMs ?? -1);
      if (sortKey === "assigned") value = (Date.parse(a.assignedAt ?? "") || 0) - (Date.parse(b.assignedAt ?? "") || 0);
      if (sortKey === "returned") value = (Date.parse(a.lastReturnedAt ?? "") || 0) - (Date.parse(b.lastReturnedAt ?? "") || 0);
      return (value || a.key.localeCompare(b.key)) * sign;
    });
  }, [rows, projectFilter, identityFilter, statusFilter, query, sortKey, sortDirection]);

  const sort = (key: SortKey) => {
    if (sortKey === key) setSortDirection((value) => (value === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDirection("asc");
    }
  };

  const clearFilters = () => {
    setQuery("");
    setProjectFilter("all");
    setIdentityFilter("all");
    setStatusFilter("all");
  };

  // Compatibility name retained for the existing view contract: this is only
  // the Realtime connection state. Data freshness is rendered separately.
  const effectiveLiveState: DashboardLiveState = connectionState;
  const partialWarning = issueTables.length > 0
    ? issueTables.map((table) => `${table.replace("current_", "")} · ${tableHealthLabel(tableStates[table], nowMs, STALE_AFTER_MS)}`).join(" · ")
    : null;

  return (
    <Container maxWidth={false} sx={{ py: 2 }}>
      <Stack direction={{ xs: "column", md: "row" }} sx={{ justifyContent: "space-between", gap: 2, mb: 2 }}>
        <Box>
          <Typography variant="overline">STREAMSCAPETV · AGENT STATE</Typography>
          <Typography variant="h4">Operations console</Typography>
        </Box>
        <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap" }}>
          <Chip label={`Realtime · ${effectiveLiveState}`} />
          <Chip
            label={`Data · ${freshness}${lastRefresh ? ` · ${shortTime(lastRefresh.toISOString())}` : ""}`}
            color={freshness === "fresh" ? "success" : freshness === "loading" ? "info" : "warning"}
            variant="outlined"
          />
          <Button
            startIcon={refreshing ? <CircularProgress size={16} /> : <AutorenewRounded />}
            onClick={() => { void requestFullRefresh(); }}
          >
            Refresh all
          </Button>
          <Button startIcon={<StorageRounded />} onClick={() => setRawOpen(true)}>Raw tables</Button>
        </Stack>
      </Stack>

      <Stack direction="row" spacing={0.75} sx={{ flexWrap: "wrap", mb: 1 }}>
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

      {partialWarning ? (
        <Alert severity={snapshot ? "warning" : "error"} sx={{ mb: 2 }}>
          {snapshot ? "Partial Agent State data" : "Agent State data unavailable"}: {partialWarning}
        </Alert>
      ) : null}
      {refreshing ? <LinearProgress sx={{ mb: 2 }} /> : null}

      <Box sx={{ display: "grid", gridTemplateColumns: { xs: "repeat(2,1fr)", md: "repeat(4,1fr)" }, gap: 1, mb: 2 }}>
        {loading && !snapshot ? (
          <Skeleton height={100} />
        ) : snapshot ? (
          <>
            <Paper sx={{ p: 1 }}><Typography>Agents {rows.length}</Typography></Paper>
            <Paper sx={{ p: 1 }}><Typography>Working {rows.filter((row) => row.baseStatus === "working").length}</Typography></Paper>
            <Paper sx={{ p: 1 }}><Typography>Returned {rows.filter((row) => row.baseStatus === "returned").length}</Typography></Paper>
            <Paper sx={{ p: 1 }}><Typography>Blocked {rows.filter((row) => row.blocked).length}</Typography></Paper>
          </>
        ) : (
          <Paper sx={{ p: 1, gridColumn: "1 / -1" }}><Typography>No current Agent State table data is available.</Typography></Paper>
        )}
      </Box>

      <ProjectCards projects={projects} selected={projectFilter} onSelect={setProjectFilter} />
      <AttentionInbox rows={rows} projectFilter={projectFilter} identityFilter={identityFilter} nowMs={nowMs} onView={setSelectedAgentKey} />
      <Paper variant="outlined">
        <Stack direction={{ xs: "column", lg: "row" }} sx={{ gap: 1, p: 1 }}>
          <TextField
            size="small"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search…"
            slotProps={{ input: { startAdornment: <InputAdornment position="start"><SearchRounded /></InputAdornment> } }}
          />
          <FormControl size="small">
            <InputLabel>Project</InputLabel>
            <Select value={projectFilter} label="Project" onChange={(event) => setProjectFilter(String(event.target.value))}>
              <MenuItem value="all">All projects</MenuItem>
              {projects.map((project) => <MenuItem key={project.projectKey} value={project.projectKey}>{project.projectKey}</MenuItem>)}
            </Select>
          </FormControl>
          <FormControl size="small">
            <InputLabel>Identity</InputLabel>
            <Select value={identityFilter} label="Identity" onChange={(event) => setIdentityFilter(event.target.value as IdentityKind | "all")}>
              <MenuItem value="all">All identities</MenuItem>
              <MenuItem value="agent">Agent N</MenuItem>
              <MenuItem value="codex">Codex N</MenuItem>
              <MenuItem value="orchestrator">Orchestrator</MenuItem>
              <MenuItem value="dependabot">Dependabot</MenuItem>
              <MenuItem value="other">Other</MenuItem>
            </Select>
          </FormControl>
          <FormControl size="small">
            <InputLabel>Status</InputLabel>
            <Select value={statusFilter} label="Status" onChange={(event) => setStatusFilter(event.target.value as AgentStatusFilter)}>
              <MenuItem value="all">All statuses</MenuItem>
              <MenuItem value="working">Working</MenuItem>
              <MenuItem value="returned">Returned</MenuItem>
              <MenuItem value="blocked">Blocked</MenuItem>
              <MenuItem value="idle">Idle</MenuItem>
            </Select>
          </FormControl>
          <IconButton aria-label="Clear filters" onClick={clearFilters}><SearchRounded /></IconButton>
        </Stack>
        <AgentTable rows={filteredRows} sortKey={sortKey} sortDirection={sortDirection} sort={sort} onView={setSelectedAgentKey} />
      </Paper>
      <AgentDetailDialog row={selectedAgent} onClose={() => setSelectedAgentKey(null)} />
      <RawTablesDialog open={rawOpen} onClose={() => setRawOpen(false)} />
    </Container>
  );
}
