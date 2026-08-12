"use client";

import {
  AutorenewRounded,
  CheckCircleRounded,
  ContentCopyRounded,
  DataObjectRounded,
  ErrorOutlineRounded,
  FilterAltRounded,
  GroupsRounded,
  HourglassTopRounded,
  PauseCircleRounded,
  SearchRounded,
  SensorsRounded,
  StorageRounded,
  VisibilityRounded,
} from "@mui/icons-material";
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Container,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
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
  TableRow,
  TableSortLabel,
  Tabs,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import { alpha } from "@mui/material/styles";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  attentionRank,
  buildAgentRows,
  buildProjectSummaries,
  formatDuration,
  normalizeSnapshot,
  statusLabel,
} from "@/lib/dashboard-model";
import type {
  AgentStatusFilter,
  AgentViewRow,
  CurrentCoordinationRecord,
  CurrentProjectRecord,
  CurrentResourceRecord,
  CurrentWorkRecord,
  DashboardSnapshot,
  IdentityKind,
  JsonValue,
  LegacyActorsBatchPayload,
  LegacyOverviewPayload,
  ProjectSummary,
  RawTableName,
} from "@/types/dashboard";
import { RAW_TABLE_NAMES } from "@/types/dashboard";

interface DashboardClientProps {
  legacyProjects: string[];
}

type LiveState = "connecting" | "live" | "reconnecting" | "stale";
type DataSource = "snapshot" | "legacy";
type SortKey = "attention" | "project" | "identity" | "status" | "duration" | "assigned" | "returned";
type SortDirection = "asc" | "desc";

const POLL_INTERVAL_MS = 30_000;
const STALE_AFTER_MS = 75_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asJson(value: unknown): JsonValue {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (Array.isArray(value)) return value.map(asJson);
  if (isRecord(value)) return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, asJson(item)]));
  return String(value);
}

async function readJson(response: Response): Promise<unknown> {
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("json")) {
    throw new Error(`Expected JSON from ${response.url || "dashboard API"} (${response.status})`);
  }
  const body = await response.json();
  if (!response.ok) {
    const message = isRecord(body) && typeof body.error === "string" ? body.error : `Request failed (${response.status})`;
    throw new Error(message);
  }
  return body;
}

function displayTime(value: string | null): string {
  if (!value) return "—";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
}

function shortTime(value: string | null): string {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function statusColor(row: AgentViewRow): "success" | "warning" | "default" | "info" {
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

function pretty(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function JsonPanel({ value, maxHeight = 320 }: { value: unknown; maxHeight?: number }) {
  return (
    <Box
      component="pre"
      sx={{
        m: 0,
        p: 1.5,
        maxHeight,
        overflow: "auto",
        borderRadius: 1.5,
        bgcolor: "rgba(2, 8, 14, 0.72)",
        border: "1px solid",
        borderColor: "divider",
        color: "text.secondary",
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
        fontSize: 12,
        lineHeight: 1.55,
        whiteSpace: "pre-wrap",
        wordBreak: "break-word",
        userSelect: "text",
      }}
    >
      {pretty(value)}
    </Box>
  );
}

function LongText({ label, value }: { label: string; value: string | null }) {
  const copy = async () => {
    if (value && navigator.clipboard) await navigator.clipboard.writeText(value);
  };
  return (
    <Box>
      <Stack direction="row" sx={{ mb: 0.75, alignItems: "center", justifyContent: "space-between", gap: 1 }}>
        <Typography variant="overline" color="text.secondary">{label}</Typography>
        <Tooltip title={value ? `Copy ${label.toLowerCase()}` : "Nothing to copy"}>
          <span>
            <IconButton size="small" onClick={() => void copy()} disabled={!value} aria-label={`Copy ${label.toLowerCase()}`}>
              <ContentCopyRounded fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
      </Stack>
      <Box
        component="pre"
        sx={{
          m: 0,
          minHeight: 96,
          maxHeight: 300,
          overflow: "auto",
          p: 1.5,
          borderRadius: 1.5,
          border: "1px solid",
          borderColor: "divider",
          bgcolor: "rgba(2, 8, 14, 0.72)",
          font: "inherit",
          fontSize: 13,
          lineHeight: 1.55,
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
          userSelect: "text",
          color: value ? "text.primary" : "text.disabled",
        }}
      >
        {value ?? "No current value."}
      </Box>
    </Box>
  );
}

function kpiCard(label: string, value: number, helper: string, icon: React.ReactNode, accent: "primary" | "success" | "warning" = "primary") {
  return (
    <Card key={label} variant="outlined" sx={{ minWidth: 0 }}>
      <CardContent sx={{ p: "14px !important" }}>
        <Stack direction="row" sx={{ justifyContent: "space-between", gap: 1, alignItems: "flex-start" }}>
          <Box>
            <Typography variant="caption" color="text.secondary" sx={{ textTransform: "uppercase", letterSpacing: ".08em" }}>
              {label}
            </Typography>
            <Typography variant="h4" sx={{ mt: 0.25, fontWeight: 800 }}>{value}</Typography>
          </Box>
          <Box sx={{ color: `${accent}.main`, display: "grid", placeItems: "center" }}>{icon}</Box>
        </Stack>
        <Typography variant="caption" color="text.secondary">{helper}</Typography>
      </CardContent>
    </Card>
  );
}

function projectDescription(summary: ProjectSummary): string {
  return summary.objective ?? summary.nextAction ?? summary.phase ?? "Current Agent State project";
}

function parseLegacyWork(projectKey: string, identity: string, values: JsonValue[]): CurrentWorkRecord[] {
  return values.map((state, index) => {
    const workKey = isRecord(state)
      ? String(state.work_key ?? state.workKey ?? `legacy-${index + 1}`)
      : `legacy-${index + 1}`;
    const body = isRecord(state) && "state" in state ? asJson(state.state) : state;
    return { projectKey, identity, workKey, state: body };
  });
}

function parseLegacyCoordination(projectKey: string, identity: string, values: JsonValue[]): CurrentCoordinationRecord[] {
  return values.flatMap((state) => {
    if (!isRecord(state)) return [];
    const sender = typeof state.sender === "string" ? state.sender : null;
    const recipient = typeof state.recipient === "string" ? state.recipient : null;
    if (!sender || !recipient) return [];
    return [{ projectKey, sender, recipient, state: "state" in state ? asJson(state.state) : asJson(state) }];
  });
}

async function loadLegacySnapshot(projects: string[], signal: AbortSignal): Promise<DashboardSnapshot> {
  const projectRows: CurrentProjectRecord[] = [];
  const agentRows: DashboardSnapshot["agents"] = [];
  const workRows: CurrentWorkRecord[] = [];
  const resourceRows: CurrentResourceRecord[] = [];
  const coordinationRows: CurrentCoordinationRecord[] = [];

  const results = await Promise.allSettled(projects.map(async (projectKey) => {
    const overviewResponse = await fetch(`/api/overview?project=${encodeURIComponent(projectKey)}`, { cache: "no-store", signal });
    const overview = await readJson(overviewResponse) as LegacyOverviewPayload;
    const actors: LegacyActorsBatchPayload["actors"] = [];
    for (let batch = 0; batch < overview.actorBatchCount; batch += 1) {
      const response = await fetch(`/api/actors?project=${encodeURIComponent(projectKey)}&batch=${batch}`, { cache: "no-store", signal });
      const payload = await readJson(response) as LegacyActorsBatchPayload;
      actors.push(...payload.actors);
    }
    return { overview, actors };
  }));

  results.forEach((result, projectIndex) => {
    if (result.status !== "fulfilled") return;
    const projectKey = projects[projectIndex];
    projectRows.push({ projectKey, state: result.value.overview.projectState });
    result.value.actors.forEach((actor) => {
      agentRows.push({
        projectKey,
        identity: actor.identity,
        prompt: actor.promptAssigned ? "Prompt content is unavailable through the compatibility endpoint." : null,
        state: actor.state,
        promptAssignedAt: null,
        lastResponse: null,
        lastReturnedAt: null,
      });
      workRows.push(...parseLegacyWork(projectKey, actor.identity, actor.work));
      resourceRows.push(...actor.resources.map((resourceKey) => ({ projectKey, identity: actor.identity, resourceKey })));
      coordinationRows.push(...parseLegacyCoordination(projectKey, actor.identity, actor.coordination));
    });
  });

  if (projectRows.length === 0) throw new Error("Neither the snapshot API nor compatibility endpoints returned dashboard data.");
  return {
    projects: projectRows,
    agents: agentRows,
    work: workRows,
    resources: resourceRows,
    coordination: coordinationRows,
    refreshedAt: new Date().toISOString(),
    missingTables: RAW_TABLE_NAMES,
  };
}

async function loadSnapshot(legacyProjects: string[], signal: AbortSignal): Promise<{ snapshot: DashboardSnapshot; source: DataSource }> {
  try {
    const response = await fetch("/api/snapshot", { cache: "no-store", signal });
    const body = await readJson(response);
    return { snapshot: normalizeSnapshot(body), source: "snapshot" };
  } catch (snapshotError) {
    if (signal.aborted) throw snapshotError;
    const snapshot = await loadLegacySnapshot(legacyProjects, signal);
    return { snapshot, source: "legacy" };
  }
}

function rawRows(payload: unknown, table: RawTableName): unknown[] {
  if (Array.isArray(payload)) return payload;
  if (!isRecord(payload)) return [];
  if (Array.isArray(payload.rows)) return payload.rows;
  if (Array.isArray(payload[table])) return payload[table] as unknown[];
  if (isRecord(payload.tables) && Array.isArray(payload.tables[table])) return payload.tables[table] as unknown[];
  return [];
}

function cellText(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

function AgentDetailDialog({ row, onClose }: { row: AgentViewRow | null; onClose: () => void }) {
  return (
    <Dialog open={Boolean(row)} onClose={onClose} maxWidth="lg" fullWidth scroll="paper">
      {row && (
        <>
          <DialogTitle>
            <Stack direction={{ xs: "column", sm: "row" }} sx={{ gap: 1, alignItems: { sm: "center" }, justifyContent: "space-between" }}>
              <Box>
                <Typography variant="caption" color="text.secondary">{row.projectKey}</Typography>
                <Typography variant="h5">{row.identity}</Typography>
              </Box>
              <Chip icon={statusIcon(row)} label={statusLabel(row)} color={statusColor(row)} variant="outlined" />
            </Stack>
          </DialogTitle>
          <DialogContent dividers>
            <Stack spacing={2.5}>
              <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "repeat(3, 1fr)" }, gap: 1.5 }}>
                <Paper variant="outlined" sx={{ p: 1.5 }}><Typography variant="caption" color="text.secondary">PROMPT ASSIGNED</Typography><Typography variant="body2">{displayTime(row.promptAssignedAt)}</Typography></Paper>
                <Paper variant="outlined" sx={{ p: 1.5 }}><Typography variant="caption" color="text.secondary">LAST RETURNED</Typography><Typography variant="body2">{displayTime(row.lastReturnedAt)}</Typography></Paper>
                <Paper variant="outlined" sx={{ p: 1.5 }}><Typography variant="caption" color="text.secondary">DURATION</Typography><Typography variant="body2">{formatDuration(row.durationMs)}</Typography></Paper>
              </Box>
              <LongText label="Current prompt" value={row.prompt} />
              <LongText label="Latest response" value={row.lastResponse} />
              <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", md: "repeat(2, minmax(0, 1fr))" }, gap: 2 }}>
                <Box><Typography variant="overline" color="text.secondary">Actor state</Typography><JsonPanel value={row.state} /></Box>
                <Box><Typography variant="overline" color="text.secondary">Current work</Typography><JsonPanel value={row.work} /></Box>
                <Box><Typography variant="overline" color="text.secondary">Owned resources</Typography><JsonPanel value={row.resources} /></Box>
                <Box><Typography variant="overline" color="text.secondary">Coordination</Typography><JsonPanel value={row.coordination} /></Box>
              </Box>
            </Stack>
          </DialogContent>
          <DialogActions><Button onClick={onClose}>Close</Button></DialogActions>
        </>
      )}
    </Dialog>
  );
}

function RawTablesDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [table, setTable] = useState<RawTableName>("current_projects");
  const [rows, setRows] = useState<unknown[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    setRows([]);
    setSelectedIndex(0);
    fetch(`/api/tables/${table}`, { cache: "no-store", signal: controller.signal })
      .then(readJson)
      .then((payload) => setRows(rawRows(payload, table)))
      .catch((caught) => {
        if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : "Raw table could not be loaded.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [open, table]);

  const columns = useMemo(() => {
    const names = new Set<string>();
    rows.slice(0, 25).forEach((row) => {
      if (isRecord(row)) Object.keys(row).forEach((key) => names.add(key));
    });
    return [...names].slice(0, 8);
  }, [rows]);

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xl" fullWidth>
      <DialogTitle>Raw current-table explorer</DialogTitle>
      <DialogContent dividers sx={{ p: 0 }}>
        <Tabs value={table} onChange={(_, value: RawTableName) => setTable(value)} variant="scrollable" scrollButtons="auto" sx={{ px: 2, borderBottom: "1px solid", borderColor: "divider" }}>
          {RAW_TABLE_NAMES.map((name) => <Tab key={name} value={name} label={name.replace("current_", "")} />)}
        </Tabs>
        {error && <Alert severity="error" sx={{ m: 2 }}>{error}</Alert>}
        {loading ? <Box sx={{ p: 5, display: "grid", placeItems: "center" }}><CircularProgress /></Box> : (
          <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", lg: "minmax(0, 1.5fr) minmax(320px, .5fr)" }, minHeight: 430 }}>
            <TableContainer sx={{ maxHeight: 520, borderRight: { lg: "1px solid" }, borderColor: { lg: "divider" } }}>
              <Table size="small" stickyHeader>
                <TableHead><TableRow>{columns.map((column) => <TableCell key={column}>{column}</TableCell>)}</TableRow></TableHead>
                <TableBody>
                  {rows.map((row, index) => (
                    <TableRow key={index} hover selected={selectedIndex === index} onClick={() => setSelectedIndex(index)} sx={{ cursor: "pointer" }}>
                      {columns.map((column) => {
                        const value = isRecord(row) ? row[column] : row;
                        const text = cellText(value);
                        return <TableCell key={column} sx={{ maxWidth: 240 }}><Tooltip title={text}><Typography variant="caption" noWrap>{text}</Typography></Tooltip></TableCell>;
                      })}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {!error && rows.length === 0 && <Box sx={{ p: 5, textAlign: "center" }}><Typography color="text.secondary">This current table is empty.</Typography></Box>}
            </TableContainer>
            <Box sx={{ p: 2, minWidth: 0 }}>
              <Typography variant="overline" color="text.secondary">Selected row JSON</Typography>
              <JsonPanel value={rows[selectedIndex] ?? {}} maxHeight={460} />
            </Box>
          </Box>
        )}
      </DialogContent>
      <DialogActions><Button onClick={onClose}>Close</Button></DialogActions>
    </Dialog>
  );
}

export function DashboardClient({ legacyProjects }: DashboardClientProps) {
  const [snapshot, setSnapshot] = useState<DashboardSnapshot | null>(null);
  const [source, setSource] = useState<DataSource>("snapshot");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [partialError, setPartialError] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [liveState, setLiveState] = useState<LiveState>("connecting");
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [query, setQuery] = useState("");
  const [projectFilter, setProjectFilter] = useState("all");
  const [identityFilter, setIdentityFilter] = useState<IdentityKind | "all">("all");
  const [statusFilter, setStatusFilter] = useState<AgentStatusFilter>("all");
  const [sortKey, setSortKey] = useState<SortKey>("attention");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const [selectedAgent, setSelectedAgent] = useState<AgentViewRow | null>(null);
  const [rawOpen, setRawOpen] = useState(false);
  const hasLoaded = useRef(false);

  const requestRefresh = useCallback(() => setRefreshToken((value) => value + 1), []);

  useEffect(() => {
    const ticker = window.setInterval(() => setNowMs(Date.now()), 1_000);
    return () => window.clearInterval(ticker);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    if (hasLoaded.current) setRefreshing(true); else setLoading(true);
    setError(null);
    loadSnapshot(legacyProjects, controller.signal)
      .then(({ snapshot: nextSnapshot, source: nextSource }) => {
        setSnapshot(nextSnapshot);
        setSource(nextSource);
        setLastRefresh(new Date());
        setPartialError(nextSnapshot.missingTables.length > 0 && nextSource === "snapshot"
          ? `Snapshot is missing: ${nextSnapshot.missingTables.join(", ")}`
          : null);
        hasLoaded.current = true;
      })
      .catch((caught) => {
        if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : "Dashboard data could not be loaded.");
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setLoading(false);
          setRefreshing(false);
        }
      });
    return () => controller.abort();
  }, [legacyProjects, refreshToken]);

  useEffect(() => {
    let staleTimer: number | null = null;
    setLiveState("connecting");
    const events = new EventSource("/events");
    const markLive = () => {
      if (staleTimer) window.clearTimeout(staleTimer);
      staleTimer = null;
      setLiveState("live");
    };
    const refreshFromEvent = () => {
      markLive();
      requestRefresh();
    };
    const handleStatus = (event: Event) => {
      if (!(event instanceof MessageEvent)) return;
      try {
        const payload = JSON.parse(event.data) as { status?: unknown };
        if (payload.status === "live") {
          markLive();
          return;
        }
        if (payload.status === "reconnecting" || payload.status === "starting") {
          setLiveState(payload.status === "starting" ? "connecting" : "reconnecting");
        }
      } catch {
        // Ignore malformed status events; connection/polling fallback still protects freshness.
      }
    };
    events.onopen = markLive;
    events.addEventListener("refresh", refreshFromEvent);
    events.addEventListener("invalidate", refreshFromEvent);
    events.addEventListener("status", handleStatus);
    events.onerror = () => {
      setLiveState("reconnecting");
      if (staleTimer) window.clearTimeout(staleTimer);
      staleTimer = window.setTimeout(() => setLiveState("stale"), 20_000);
    };
    const poll = window.setInterval(() => requestRefresh(), POLL_INTERVAL_MS);
    return () => {
      events.removeEventListener("refresh", refreshFromEvent);
      events.removeEventListener("invalidate", refreshFromEvent);
      events.removeEventListener("status", handleStatus);
      events.close();
      window.clearInterval(poll);
      if (staleTimer) window.clearTimeout(staleTimer);
    };
  }, [requestRefresh]);

  const rows = useMemo(() => snapshot ? buildAgentRows(snapshot, nowMs) : [], [snapshot, nowMs]);
  const projects = useMemo(() => snapshot ? buildProjectSummaries(snapshot, rows) : [], [snapshot, rows]);

  const isStale = lastRefresh ? nowMs - lastRefresh.getTime() > STALE_AFTER_MS : liveState === "stale";
  const effectiveLiveState: LiveState = isStale ? "stale" : liveState;

  const metrics = useMemo(() => ({
    projects: projects.length,
    agents: rows.length,
    working: rows.filter((row) => row.baseStatus === "working").length,
    returned: rows.filter((row) => row.baseStatus === "returned").length,
    blocked: rows.filter((row) => row.blocked).length,
    idle: rows.filter((row) => row.baseStatus === "idle").length,
  }), [projects, rows]);

  const filteredRows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const filtered = rows.filter((row) => {
      if (projectFilter !== "all" && row.projectKey !== projectFilter) return false;
      if (identityFilter !== "all" && row.identityKind !== identityFilter) return false;
      if (statusFilter === "blocked" && !row.blocked) return false;
      if (statusFilter !== "all" && statusFilter !== "blocked" && row.baseStatus !== statusFilter) return false;
      if (!needle) return true;
      return [row.projectKey, row.identity, row.workSummary, row.nextAction ?? "", statusLabel(row), pretty(row.state), pretty(row.work)]
        .join(" ")
        .toLowerCase()
        .includes(needle);
    });

    const sign = sortDirection === "asc" ? 1 : -1;
    return [...filtered].sort((left, right) => {
      let comparison = 0;
      if (sortKey === "attention") comparison = attentionRank(left) - attentionRank(right);
      if (sortKey === "project") comparison = left.projectKey.localeCompare(right.projectKey);
      if (sortKey === "identity") comparison = left.identity.localeCompare(right.identity, undefined, { numeric: true });
      if (sortKey === "status") comparison = statusLabel(left).localeCompare(statusLabel(right));
      if (sortKey === "duration") comparison = (left.durationMs ?? -1) - (right.durationMs ?? -1);
      if (sortKey === "assigned") comparison = (Date.parse(left.promptAssignedAt ?? "") || 0) - (Date.parse(right.promptAssignedAt ?? "") || 0);
      if (sortKey === "returned") comparison = (Date.parse(left.lastReturnedAt ?? "") || 0) - (Date.parse(right.lastReturnedAt ?? "") || 0);
      if (comparison === 0) comparison = left.key.localeCompare(right.key, undefined, { numeric: true });
      return comparison * sign;
    });
  }, [rows, projectFilter, identityFilter, statusFilter, query, sortKey, sortDirection]);

  const sort = (key: SortKey) => {
    if (sortKey === key) setSortDirection((direction) => direction === "asc" ? "desc" : "asc");
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

  const liveChip = effectiveLiveState === "live"
    ? { label: "Live", color: "success" as const, icon: <SensorsRounded /> }
    : effectiveLiveState === "stale"
      ? { label: "Stale", color: "warning" as const, icon: <ErrorOutlineRounded /> }
      : { label: effectiveLiveState === "connecting" ? "Connecting" : "Reconnecting", color: "info" as const, icon: <AutorenewRounded /> };

  return (
    <Container maxWidth={false} sx={{ py: { xs: 1.5, md: 2.5 }, px: { xs: 1.5, md: 2.5 }, maxWidth: 1920 }}>
      <Paper variant="outlined" sx={{ p: { xs: 1.5, md: 2 }, mb: 2, background: (theme) => `linear-gradient(110deg, ${alpha(theme.palette.primary.main, .1)}, transparent 42%)` }}>
        <Stack direction={{ xs: "column", md: "row" }} sx={{ gap: 2, alignItems: { md: "center" }, justifyContent: "space-between" }}>
          <Box>
            <Typography variant="overline" color="primary.main" sx={{ letterSpacing: ".14em" }}>STREAMSCAPETV · AGENT STATE</Typography>
            <Typography variant="h4" sx={{ fontWeight: 800, lineHeight: 1.05 }}>Operations console</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: .5 }}>See who is working, who returned, and who needs attention without opening every agent tab.</Typography>
          </Box>
          <Stack direction="row" sx={{ gap: 1, alignItems: "center", flexWrap: "wrap" }}>
            <Tooltip title={lastRefresh ? `Last successful refresh: ${lastRefresh.toLocaleString()}` : "No successful refresh yet"}>
              <Chip icon={liveChip.icon} label={`${liveChip.label}${lastRefresh ? ` · ${lastRefresh.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}` : ""}`} color={liveChip.color} variant="outlined" />
            </Tooltip>
            <Chip label={source === "snapshot" ? "Snapshot API" : "Compatibility data"} size="small" variant="outlined" />
            <Button size="small" startIcon={refreshing ? <CircularProgress size={16} /> : <AutorenewRounded />} onClick={requestRefresh} disabled={refreshing}>Refresh</Button>
            <Button size="small" startIcon={<StorageRounded />} onClick={() => setRawOpen(true)}>Raw tables</Button>
          </Stack>
        </Stack>
      </Paper>

      {source === "legacy" && !error && <Alert severity="warning" sx={{ mb: 2 }}>The new snapshot API is not available yet. Compatibility data keeps the UI usable, but prompt/return timestamps and latest responses are incomplete until the server workstream lands.</Alert>}
      {partialError && <Alert severity="warning" sx={{ mb: 2 }}>{partialError}</Alert>}
      {error && <Alert severity="error" sx={{ mb: 2 }} action={<Button color="inherit" size="small" onClick={requestRefresh}>Retry</Button>}>{error}</Alert>}
      {refreshing && <LinearProgress sx={{ mb: 1.5 }} />}

      <Box sx={{ display: "grid", gridTemplateColumns: { xs: "repeat(2, 1fr)", sm: "repeat(3, 1fr)", lg: "repeat(6, 1fr)" }, gap: 1, mb: 2 }}>
        {loading && !snapshot ? Array.from({ length: 6 }, (_, index) => <Skeleton key={index} variant="rounded" height={104} />) : <>
          {kpiCard("Projects", metrics.projects, "Current projects", <DataObjectRounded />)}
          {kpiCard("Agents", metrics.agents, "Known current actors", <GroupsRounded />)}
          {kpiCard("Working", metrics.working, "Prompt still in progress", <HourglassTopRounded />)}
          {kpiCard("Returned", metrics.returned, "Ready for attention", <CheckCircleRounded />, "success")}
          {kpiCard("Blocked", metrics.blocked, "Explicit blocker present", <ErrorOutlineRounded />, "warning")}
          {kpiCard("Idle", metrics.idle, "No active prompt/work", <PauseCircleRounded />)}
        </>}
      </Box>

      <Paper variant="outlined" sx={{ mb: 2, p: 1.25 }}>
        <Stack direction="row" sx={{ gap: 1, overflowX: "auto", pb: .25 }}>
          {projects.map((summary) => (
            <Card
              key={summary.projectKey}
              variant="outlined"
              onClick={() => setProjectFilter(projectFilter === summary.projectKey ? "all" : summary.projectKey)}
              sx={{ minWidth: 250, maxWidth: 320, cursor: "pointer", borderColor: projectFilter === summary.projectKey ? "primary.main" : "divider", bgcolor: projectFilter === summary.projectKey ? (theme) => alpha(theme.palette.primary.main, .07) : undefined }}
            >
              <CardContent sx={{ p: "12px !important" }}>
                <Stack direction="row" sx={{ alignItems: "center", justifyContent: "space-between", gap: 1 }}>
                  <Typography variant="subtitle2" noWrap>{summary.projectKey}</Typography>
                  {summary.phase && <Chip label={summary.phase} size="small" variant="outlined" />}
                </Stack>
                <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: .5, minHeight: 36 }} noWrap>{projectDescription(summary)}</Typography>
                <Stack direction="row" sx={{ gap: .5, mt: 1, flexWrap: "wrap" }}>
                  <Chip size="small" label={`${summary.working} working`} />
                  <Chip size="small" color="success" variant="outlined" label={`${summary.returned} returned`} />
                  {summary.blocked > 0 && <Chip size="small" color="warning" variant="outlined" label={`${summary.blocked} blocked`} />}
                  <Chip size="small" variant="outlined" label={`${summary.idle} idle`} />
                </Stack>
              </CardContent>
            </Card>
          ))}
          {!loading && projects.length === 0 && <Typography color="text.secondary" sx={{ p: 2 }}>No current projects were returned.</Typography>}
        </Stack>
      </Paper>

      <Paper variant="outlined" sx={{ overflow: "hidden" }}>
        <Box sx={{ p: 1.25, borderBottom: "1px solid", borderColor: "divider", position: "sticky", top: 0, zIndex: 2, bgcolor: "background.paper" }}>
          <Stack direction={{ xs: "column", lg: "row" }} sx={{ gap: 1, alignItems: { lg: "center" } }}>
            <TextField
              size="small"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search project, agent, work, status, next action…"
              sx={{ minWidth: { lg: 340 }, flex: 1 }}
              slotProps={{ input: { startAdornment: <InputAdornment position="start"><SearchRounded fontSize="small" /></InputAdornment> } }}
            />
            <FormControl size="small" sx={{ minWidth: 180 }}><InputLabel>Project</InputLabel><Select value={projectFilter} label="Project" onChange={(event) => setProjectFilter(String(event.target.value))}><MenuItem value="all">All projects</MenuItem>{projects.map((item) => <MenuItem key={item.projectKey} value={item.projectKey}>{item.projectKey}</MenuItem>)}</Select></FormControl>
            <FormControl size="small" sx={{ minWidth: 150 }}><InputLabel>Identity</InputLabel><Select value={identityFilter} label="Identity" onChange={(event) => setIdentityFilter(event.target.value as IdentityKind | "all")}><MenuItem value="all">All identities</MenuItem><MenuItem value="orchestrator">Orchestrator</MenuItem><MenuItem value="agent">Agent N</MenuItem><MenuItem value="codex">Codex N</MenuItem><MenuItem value="dependabot">Dependabot</MenuItem><MenuItem value="other">Other</MenuItem></Select></FormControl>
            <FormControl size="small" sx={{ minWidth: 150 }}><InputLabel>Status</InputLabel><Select value={statusFilter} label="Status" onChange={(event) => setStatusFilter(event.target.value as AgentStatusFilter)}><MenuItem value="all">All statuses</MenuItem><MenuItem value="returned">Returned / ready</MenuItem><MenuItem value="working">Working</MenuItem><MenuItem value="blocked">Blocked</MenuItem><MenuItem value="idle">Idle</MenuItem></Select></FormControl>
            <Tooltip title="Clear filters"><IconButton onClick={clearFilters}><FilterAltRounded /></IconButton></Tooltip>
          </Stack>
          <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: .75 }}>{filteredRows.length} of {rows.length} agents shown · returned/ready is the default attention-first order</Typography>
        </Box>

        <TableContainer sx={{ maxHeight: "calc(100vh - 360px)", minHeight: 300 }}>
          <Table size="small" stickyHeader aria-label="Agent operations grid">
            <TableHead><TableRow>
              <TableCell sortDirection={sortKey === "project" ? sortDirection : false}><TableSortLabel active={sortKey === "project"} direction={sortKey === "project" ? sortDirection : "asc"} onClick={() => sort("project")}>Project</TableSortLabel></TableCell>
              <TableCell sortDirection={sortKey === "identity" ? sortDirection : false}><TableSortLabel active={sortKey === "identity"} direction={sortKey === "identity" ? sortDirection : "asc"} onClick={() => sort("identity")}>Identity</TableSortLabel></TableCell>
              <TableCell sortDirection={sortKey === "status" || sortKey === "attention" ? sortDirection : false}><TableSortLabel active={sortKey === "status" || sortKey === "attention"} direction={sortDirection} onClick={() => sort(sortKey === "attention" ? "status" : "attention")}>Status</TableSortLabel></TableCell>
              <TableCell>Current work / next action</TableCell>
              <TableCell sortDirection={sortKey === "assigned" ? sortDirection : false}><TableSortLabel active={sortKey === "assigned"} direction={sortKey === "assigned" ? sortDirection : "asc"} onClick={() => sort("assigned")}>Assigned</TableSortLabel></TableCell>
              <TableCell sortDirection={sortKey === "returned" ? sortDirection : false}><TableSortLabel active={sortKey === "returned"} direction={sortKey === "returned" ? sortDirection : "asc"} onClick={() => sort("returned")}>Returned</TableSortLabel></TableCell>
              <TableCell sortDirection={sortKey === "duration" ? sortDirection : false}><TableSortLabel active={sortKey === "duration"} direction={sortKey === "duration" ? sortDirection : "asc"} onClick={() => sort("duration")}>Duration</TableSortLabel></TableCell>
              <TableCell align="right">Details</TableCell>
            </TableRow></TableHead>
            <TableBody>
              {filteredRows.map((row) => (
                <TableRow key={row.key} hover sx={{ "& td": { py: .8 }, bgcolor: row.baseStatus === "returned" ? (theme) => alpha(theme.palette.success.main, .035) : undefined }}>
                  <TableCell sx={{ maxWidth: 190 }}><Typography variant="body2" noWrap>{row.projectKey}</Typography></TableCell>
                  <TableCell sx={{ whiteSpace: "nowrap" }}><Typography variant="body2" fontWeight={700}>{row.identity}</Typography><Typography variant="caption" color="text.secondary">{row.identityKind}</Typography></TableCell>
                  <TableCell sx={{ minWidth: 170 }}><Chip size="small" icon={statusIcon(row)} label={statusLabel(row)} color={statusColor(row)} variant="outlined" /></TableCell>
                  <TableCell sx={{ minWidth: 260, maxWidth: 420 }}><Tooltip title={row.nextAction ?? row.workSummary}><Box><Typography variant="body2" noWrap>{row.workSummary}</Typography>{row.nextAction && <Typography variant="caption" color="text.secondary" noWrap>Next: {row.nextAction}</Typography>}</Box></Tooltip></TableCell>
                  <TableCell sx={{ whiteSpace: "nowrap" }}><Tooltip title={displayTime(row.promptAssignedAt)}><Typography variant="body2">{shortTime(row.promptAssignedAt)}</Typography></Tooltip></TableCell>
                  <TableCell sx={{ whiteSpace: "nowrap" }}><Tooltip title={displayTime(row.lastReturnedAt)}><Typography variant="body2">{shortTime(row.lastReturnedAt)}</Typography></Tooltip></TableCell>
                  <TableCell sx={{ whiteSpace: "nowrap" }}><Typography variant="body2" fontWeight={700}>{formatDuration(row.durationMs)}</Typography></TableCell>
                  <TableCell align="right"><Button size="small" startIcon={<VisibilityRounded />} onClick={() => setSelectedAgent(row)}>View</Button></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {!loading && !error && filteredRows.length === 0 && <Box sx={{ p: 6, textAlign: "center" }}><GroupsRounded sx={{ fontSize: 42, color: "text.disabled" }} /><Typography variant="h6" sx={{ mt: 1 }}>No matching agents</Typography><Typography variant="body2" color="text.secondary">Clear filters or wait for the next live snapshot.</Typography></Box>}
        </TableContainer>
      </Paper>

      <AgentDetailDialog row={selectedAgent} onClose={() => setSelectedAgent(null)} />
      <RawTablesDialog open={rawOpen} onClose={() => setRawOpen(false)} />
    </Container>
  );
}
