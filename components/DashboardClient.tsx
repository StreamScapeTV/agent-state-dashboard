"use client";

import {
  AutorenewRounded,
  CheckCircleRounded,
  ContentCopyRounded,
  ErrorOutlineRounded,
  GroupsRounded,
  HourglassTopRounded,
  PauseCircleRounded,
  SearchRounded,
  StorageRounded,
  VisibilityRounded,
} from "@mui/icons-material";
import {
  Alert, Box, Button, Card, CardActionArea, CardContent, Chip, CircularProgress,
  Container, Dialog, DialogActions, DialogContent, DialogTitle, FormControl,
  IconButton, InputAdornment, InputLabel, LinearProgress, MenuItem, Paper, Select,
  Skeleton, Stack, Tab, Table, TableBody, TableCell, TableContainer, TableHead,
  TablePagination, TableRow, TableSortLabel, Tabs, TextField, Tooltip, Typography,
} from "@mui/material";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  attentionRank, buildAgentRows, buildProjectSummaries, formatDuration,
  liveEventDecision, normalizeSnapshot, refreshAgentDurations, statusLabel,
  type DashboardLiveEvent, type DashboardLiveState,
} from "@/lib/dashboard-model";
import type {
  AgentStatusFilter, AgentViewRow, CurrentCoordinationRecord, CurrentProjectRecord,
  CurrentResourceRecord, CurrentWorkRecord, DashboardSnapshot, IdentityKind, JsonValue,
  LegacyActorsBatchPayload, LegacyOverviewPayload, ProjectSummary, RawTableName,
} from "@/types/dashboard";
import { RAW_TABLE_NAMES } from "@/types/dashboard";

interface DashboardClientProps { legacyProjects: string[]; }
type DataSource = "snapshot" | "legacy";
type SortKey = "attention" | "project" | "identity" | "duration" | "assigned" | "returned";
type SortDirection = "asc" | "desc";
const POLL_INTERVAL_MS = 30_000;
const STALE_AFTER_MS = 75_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function asJson(value: unknown): JsonValue {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.map(asJson);
  if (isRecord(value)) return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, asJson(item)]));
  return String(value);
}
async function readJson(response: Response): Promise<unknown> {
  const body = await response.json();
  if (!response.ok) throw new Error(isRecord(body) && typeof body.error === "string" ? body.error : `Request failed (${response.status})`);
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
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}
function pretty(value: unknown): string { return JSON.stringify(value, null, 2) ?? String(value); }
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

function parseLegacyWork(projectKey: string, identity: string, values: JsonValue[]): CurrentWorkRecord[] {
  return values.map((state, index) => ({
    projectKey, identity,
    workKey: isRecord(state) ? String(state.work_key ?? state.workKey ?? `legacy-${index + 1}`) : `legacy-${index + 1}`,
    state: isRecord(state) && "state" in state ? asJson(state.state) : state,
  }));
}
function parseLegacyCoordination(projectKey: string, values: JsonValue[]): CurrentCoordinationRecord[] {
  return values.flatMap((state) => {
    if (!isRecord(state) || typeof state.sender !== "string" || typeof state.recipient !== "string") return [];
    return [{ projectKey, sender: state.sender, recipient: state.recipient, state: "state" in state ? asJson(state.state) : asJson(state) }];
  });
}
async function loadLegacySnapshot(projects: string[], signal: AbortSignal): Promise<DashboardSnapshot> {
  const projectRows: CurrentProjectRecord[] = [];
  const agents: DashboardSnapshot["agents"] = [];
  const work: CurrentWorkRecord[] = [];
  const resources: CurrentResourceRecord[] = [];
  const coordination: CurrentCoordinationRecord[] = [];
  const results = await Promise.allSettled(projects.map(async (projectKey) => {
    const overview = await readJson(await fetch(`/api/overview?project=${encodeURIComponent(projectKey)}`, { cache: "no-store", signal })) as LegacyOverviewPayload;
    const actors: LegacyActorsBatchPayload["actors"] = [];
    for (let batch = 0; batch < overview.actorBatchCount; batch += 1) {
      const payload = await readJson(await fetch(`/api/actors?project=${encodeURIComponent(projectKey)}&batch=${batch}`, { cache: "no-store", signal })) as LegacyActorsBatchPayload;
      actors.push(...payload.actors);
    }
    return { overview, actors };
  }));
  results.forEach((result, index) => {
    if (result.status !== "fulfilled") return;
    const projectKey = projects[index];
    projectRows.push({ projectKey, state: result.value.overview.projectState });
    result.value.actors.forEach((actor) => {
      agents.push({ projectKey, identity: actor.identity, prompt: actor.promptAssigned ? "Prompt content is unavailable through the compatibility endpoint." : null, state: actor.state, promptAssignedAt: null, lastResponse: null, lastReturnedAt: null });
      work.push(...parseLegacyWork(projectKey, actor.identity, actor.work));
      resources.push(...actor.resources.map((resourceKey) => ({ projectKey, identity: actor.identity, resourceKey })));
      coordination.push(...parseLegacyCoordination(projectKey, actor.coordination));
    });
  });
  if (projectRows.length === 0) throw new Error("Neither the snapshot API nor compatibility endpoints returned dashboard data.");
  return { projects: projectRows, agents, work, resources, coordination, refreshedAt: new Date().toISOString(), missingTables: RAW_TABLE_NAMES };
}
async function loadSnapshot(legacyProjects: string[], signal: AbortSignal): Promise<{ snapshot: DashboardSnapshot; source: DataSource }> {
  try {
    return { snapshot: normalizeSnapshot(await readJson(await fetch("/api/snapshot", { cache: "no-store", signal }))), source: "snapshot" };
  } catch (error) {
    if (signal.aborted) throw error;
    return { snapshot: await loadLegacySnapshot(legacyProjects, signal), source: "legacy" };
  }
}

function JsonPanel({ value }: { value: unknown }) {
  return <Box component="pre" sx={{ m: 0, p: 1.5, maxHeight: 360, overflow: "auto", border: "1px solid", borderColor: "divider", borderRadius: 1.5, whiteSpace: "pre-wrap", wordBreak: "break-word", userSelect: "text", fontSize: 12 }}>{pretty(value)}</Box>;
}
function LongText({ label, value }: { label: string; value: string | null }) {
  return <Box><Stack direction="row" sx={{ justifyContent: "space-between", alignItems: "center" }}><Typography variant="overline">{label}</Typography><IconButton size="small" disabled={!value} aria-label={`Copy ${label.toLowerCase()}`} onClick={() => { if (value) void navigator.clipboard.writeText(value); }}><ContentCopyRounded fontSize="small" /></IconButton></Stack><Box component="pre" sx={{ m: 0, p: 1.5, minHeight: 80, maxHeight: 260, overflow: "auto", border: "1px solid", borderColor: "divider", borderRadius: 1.5, whiteSpace: "pre-wrap", wordBreak: "break-word", userSelect: "text", font: "inherit", fontSize: 13 }}>{value ?? "No current value."}</Box></Box>;
}
function AgentDetailDialog({ row, onClose }: { row: AgentViewRow | null; onClose: () => void }) {
  return <Dialog open={Boolean(row)} onClose={onClose} maxWidth="lg" fullWidth>{row ? <><DialogTitle>{row.projectKey} · {row.identity}</DialogTitle><DialogContent dividers><Stack spacing={2}><Chip icon={statusIcon(row)} label={statusLabel(row)} color={statusColor(row)} variant="outlined" /><Typography>Assigned: {displayTime(row.promptAssignedAt)} · Returned: {displayTime(row.lastReturnedAt)} · Duration: {formatDuration(row.durationMs)}</Typography><LongText label="Current prompt" value={row.prompt} /><LongText label="Latest response" value={row.lastResponse} /><JsonPanel value={{ state: row.state, work: row.work, resources: row.resources, coordination: row.coordination }} /></Stack></DialogContent><DialogActions><Button onClick={onClose}>Close</Button></DialogActions></> : null}</Dialog>;
}

function rawRows(payload: unknown, table: RawTableName): unknown[] {
  if (Array.isArray(payload)) return payload;
  if (!isRecord(payload)) return [];
  if (Array.isArray(payload.rows)) return payload.rows;
  if (Array.isArray(payload[table])) return payload[table] as unknown[];
  const tables = payload.tables;
  return isRecord(tables) && Array.isArray(tables[table]) ? tables[table] as unknown[] : [];
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
    setRows([]); setSelectedIndex(0); setPage(0); setError(null);
    fetch(`/api/tables/${table}`, { cache: "no-store", signal: controller.signal }).then(readJson).then((value) => setRows(rawRows(value, table))).catch((caught) => { if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : "Raw table could not be loaded."); });
    return () => controller.abort();
  }, [open, table]);
  const visibleRows = useMemo(() => rows.slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage), [rows, page, rowsPerPage]);
  return <Dialog open={open} onClose={onClose} maxWidth="lg" fullWidth><DialogTitle>Raw current-table explorer</DialogTitle><DialogContent dividers><Tabs value={table} onChange={(_, value: RawTableName) => setTable(value)} variant="scrollable">{RAW_TABLE_NAMES.map((name) => <Tab key={name} value={name} label={name.replace("current_", "")} />)}</Tabs>{error ? <Alert severity="error">{error}</Alert> : null}<TableContainer sx={{ maxHeight: 420 }}><Table size="small"><TableBody>{visibleRows.map((row, pageIndex) => { const index = page * rowsPerPage + pageIndex; return <TableRow key={index} hover tabIndex={0} selected={selectedIndex === index} onClick={() => setSelectedIndex(index)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setSelectedIndex(index); } }}><TableCell><Typography variant="caption" sx={{ fontFamily: "monospace" }}>{pretty(row)}</Typography></TableCell></TableRow>; })}</TableBody></Table></TableContainer><TablePagination component="div" count={rows.length} page={page} rowsPerPage={rowsPerPage} rowsPerPageOptions={[25, 50, 100]} onPageChange={(_, nextPage) => { setPage(nextPage); setSelectedIndex(nextPage * rowsPerPage); }} onRowsPerPageChange={(event) => { setRowsPerPage(Number.parseInt(event.target.value, 10)); setPage(0); setSelectedIndex(0); }} /><Typography variant="overline">Selected row JSON</Typography><JsonPanel value={rows[selectedIndex] ?? {}} /></DialogContent><DialogActions><Button onClick={onClose}>Close</Button></DialogActions></Dialog>;
}

function ProjectCards({ projects, selected, onSelect }: { projects: ProjectSummary[]; selected: string; onSelect: (value: string) => void }) {
  return <Stack direction="row" sx={{ gap: 1, overflowX: "auto", mb: 2 }}>{projects.map((summary) => { const active = selected === summary.projectKey; return <Card key={summary.projectKey} variant="outlined" sx={{ minWidth: 260, bgcolor: active ? "action.selected" : "background.paper" }}><CardActionArea aria-pressed={active} onClick={() => onSelect(active ? "all" : summary.projectKey)}><CardContent><Typography variant="subtitle2">{summary.projectKey}</Typography><Typography variant="caption" color="text.secondary" noWrap>{summary.phase ?? "No phase"} · {summary.objective ?? "No current objective"}</Typography>{summary.nextAction ? <Typography variant="caption" sx={{ display: "block" }} noWrap>Next: {summary.nextAction}</Typography> : null}<Typography variant="caption">{summary.working} working · {summary.returned} returned · {summary.blocked} blocked · {summary.idle} idle</Typography></CardContent></CardActionArea></Card>; })}</Stack>;
}

interface AgentTableProps { rows: AgentViewRow[]; sortKey: SortKey; sortDirection: SortDirection; sort: (key: SortKey) => void; onView: (key: string) => void; }
function AgentTable({ rows, sortKey, sortDirection, sort, onView }: AgentTableProps) {
  const dir = (key: SortKey): SortDirection => sortKey === key ? sortDirection : "asc";
  return <TableContainer sx={{ maxHeight: "calc(100vh - 390px)", minHeight: 300 }}><Table size="small" stickyHeader><TableHead><TableRow><TableCell><TableSortLabel active={sortKey === "project"} direction={dir("project")} onClick={() => sort("project")}>Project</TableSortLabel></TableCell><TableCell><TableSortLabel active={sortKey === "identity"} direction={dir("identity")} onClick={() => sort("identity")}>Identity</TableSortLabel></TableCell><TableCell><TableSortLabel active={sortKey === "attention"} direction={dir("attention")} onClick={() => sort("attention")}>Status</TableSortLabel></TableCell><TableCell>Current work / next action</TableCell><TableCell>Assigned</TableCell><TableCell>Returned</TableCell><TableCell><TableSortLabel active={sortKey === "duration"} direction={dir("duration")} onClick={() => sort("duration")}>Duration</TableSortLabel></TableCell><TableCell /></TableRow></TableHead><TableBody>{rows.map((row) => <TableRow key={row.key} hover><TableCell>{row.projectKey}</TableCell><TableCell><Typography sx={{ fontWeight: 700 }}>{row.identity}</Typography><Typography variant="caption">{row.identityKind}</Typography></TableCell><TableCell><Chip size="small" icon={statusIcon(row)} label={statusLabel(row)} color={statusColor(row)} /></TableCell><TableCell><Typography noWrap>{row.workSummary}</Typography>{row.nextAction ? <Typography variant="caption" noWrap>Next: {row.nextAction}</Typography> : null}</TableCell><TableCell>{shortTime(row.promptAssignedAt)}</TableCell><TableCell>{shortTime(row.lastReturnedAt)}</TableCell><TableCell>{formatDuration(row.durationMs)}</TableCell><TableCell><Button size="small" startIcon={<VisibilityRounded />} onClick={() => onView(row.key)}>View</Button></TableCell></TableRow>)}</TableBody></Table></TableContainer>;
}

export function DashboardClient({ legacyProjects }: DashboardClientProps) {
  const [snapshot, setSnapshot] = useState<DashboardSnapshot | null>(null);
  const [source, setSource] = useState<DataSource>("snapshot");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [liveState, setLiveState] = useState<DashboardLiveState>("connecting");
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [query, setQuery] = useState("");
  const [projectFilter, setProjectFilter] = useState("all");
  const [identityFilter, setIdentityFilter] = useState<IdentityKind | "all">("all");
  const [statusFilter, setStatusFilter] = useState<AgentStatusFilter>("all");
  const [sortKey, setSortKey] = useState<SortKey>("attention");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const [selectedAgentKey, setSelectedAgentKey] = useState<string | null>(null);
  const [rawOpen, setRawOpen] = useState(false);
  const loaded = useRef(false);
  const requestRefresh = useCallback(() => setRefreshToken((value) => value + 1), []);

  useEffect(() => { const timer = window.setInterval(() => setNowMs(Date.now()), 1_000); return () => window.clearInterval(timer); }, []);
  useEffect(() => {
    const controller = new AbortController();
    if (loaded.current) setRefreshing(true); else setLoading(true);
    setError(null);
    loadSnapshot(legacyProjects, controller.signal).then(({ snapshot: value, source: dataSource }) => { setSnapshot(value); setSource(dataSource); setLastRefresh(new Date()); loaded.current = true; }).catch((caught) => { if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : "Dashboard data could not be loaded."); }).finally(() => { if (!controller.signal.aborted) { setLoading(false); setRefreshing(false); } });
    return () => controller.abort();
  }, [legacyProjects, refreshToken]);
  useEffect(() => {
    const applyLiveEvent = (kind: DashboardLiveEvent, payload?: unknown) => { const decision = liveEventDecision(kind, payload); if (decision.state) setLiveState(decision.state); if (decision.refresh) requestRefresh(); };
    const events = new EventSource("/events");
    const refreshFromEvent = () => applyLiveEvent("refresh");
    const invalidateFromEvent = () => applyLiveEvent("invalidate");
    const handleStatus = (event: Event) => { if (event instanceof MessageEvent) applyLiveEvent("status", event.data); };
    events.onopen = () => applyLiveEvent("open");
    events.onerror = () => applyLiveEvent("error");
    events.addEventListener("refresh", refreshFromEvent); events.addEventListener("invalidate", invalidateFromEvent); events.addEventListener("status", handleStatus);
    const poll = window.setInterval(requestRefresh, POLL_INTERVAL_MS);
    return () => { events.close(); window.clearInterval(poll); };
  }, [requestRefresh]);

  const baseRows = useMemo(() => snapshot ? buildAgentRows(snapshot, 0) : [], [snapshot]);
  const rows = useMemo(() => refreshAgentDurations(baseRows, nowMs), [baseRows, nowMs]);
  const selectedAgent = useMemo(() => selectedAgentKey ? rows.find((row) => row.key === selectedAgentKey) ?? null : null, [rows, selectedAgentKey]);
  useEffect(() => { if (selectedAgentKey && !baseRows.some((row) => row.key === selectedAgentKey)) setSelectedAgentKey(null); }, [baseRows, selectedAgentKey]);
  const projects = useMemo(() => snapshot ? buildProjectSummaries(snapshot, baseRows) : [], [snapshot, baseRows]);
  const filteredRows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const filtered = rows.filter((row) => (projectFilter === "all" || row.projectKey === projectFilter) && (identityFilter === "all" || row.identityKind === identityFilter) && (statusFilter === "all" || statusFilter === "blocked" ? statusFilter !== "blocked" || row.blocked : row.baseStatus === statusFilter) && (!needle || [row.projectKey, row.identity, row.workSummary, row.nextAction ?? "", statusLabel(row)].join(" ").toLowerCase().includes(needle)));
    const sign = sortDirection === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => { let value = 0; if (sortKey === "attention") value = attentionRank(a) - attentionRank(b); if (sortKey === "project") value = a.projectKey.localeCompare(b.projectKey); if (sortKey === "identity") value = a.identity.localeCompare(b.identity, undefined, { numeric: true }); if (sortKey === "duration") value = (a.durationMs ?? -1) - (b.durationMs ?? -1); if (sortKey === "assigned") value = (Date.parse(a.promptAssignedAt ?? "") || 0) - (Date.parse(b.promptAssignedAt ?? "") || 0); if (sortKey === "returned") value = (Date.parse(a.lastReturnedAt ?? "") || 0) - (Date.parse(b.lastReturnedAt ?? "") || 0); return (value || a.key.localeCompare(b.key)) * sign; });
  }, [rows, projectFilter, identityFilter, statusFilter, query, sortKey, sortDirection]);
  const sort = (key: SortKey) => { if (sortKey === key) setSortDirection((value) => value === "asc" ? "desc" : "asc"); else { setSortKey(key); setSortDirection("asc"); } };
  const clearFilters = () => { setQuery(""); setProjectFilter("all"); setIdentityFilter("all"); setStatusFilter("all"); };
  const effectiveLiveState: DashboardLiveState = lastRefresh && nowMs - lastRefresh.getTime() > STALE_AFTER_MS ? "stale" : liveState;

  return <Container maxWidth={false} sx={{ py: 2 }}><Stack direction={{ xs: "column", md: "row" }} sx={{ justifyContent: "space-between", gap: 2, mb: 2 }}><Box><Typography variant="overline">STREAMSCAPETV · AGENT STATE</Typography><Typography variant="h4">Operations console</Typography></Box><Stack direction="row" spacing={1}><Chip label={`${effectiveLiveState}${lastRefresh ? ` · ${shortTime(lastRefresh.toISOString())}` : ""}`} /><Button startIcon={refreshing ? <CircularProgress size={16} /> : <AutorenewRounded />} onClick={requestRefresh}>Refresh</Button><Button startIcon={<StorageRounded />} onClick={() => setRawOpen(true)}>Raw tables</Button></Stack></Stack>{source === "legacy" ? <Alert severity="warning" sx={{ mb: 2 }}>Compatibility data is in use.</Alert> : null}{error ? <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert> : null}{refreshing ? <LinearProgress sx={{ mb: 2 }} /> : null}<Box sx={{ display: "grid", gridTemplateColumns: { xs: "repeat(2,1fr)", md: "repeat(4,1fr)" }, gap: 1, mb: 2 }}>{loading && !snapshot ? <Skeleton height={100} /> : <><Paper sx={{ p: 1 }}><Typography>Agents {rows.length}</Typography></Paper><Paper sx={{ p: 1 }}><Typography>Working {rows.filter((row) => row.baseStatus === "working").length}</Typography></Paper><Paper sx={{ p: 1 }}><Typography>Returned {rows.filter((row) => row.baseStatus === "returned").length}</Typography></Paper><Paper sx={{ p: 1 }}><Typography>Blocked {rows.filter((row) => row.blocked).length}</Typography></Paper></>}</Box><ProjectCards projects={projects} selected={projectFilter} onSelect={setProjectFilter} /><Paper variant="outlined"><Stack direction={{ xs: "column", lg: "row" }} sx={{ gap: 1, p: 1 }}><TextField size="small" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search…" slotProps={{ input: { startAdornment: <InputAdornment position="start"><SearchRounded /></InputAdornment> } }} /><FormControl size="small"><InputLabel>Project</InputLabel><Select value={projectFilter} label="Project" onChange={(event) => setProjectFilter(String(event.target.value))}><MenuItem value="all">All projects</MenuItem>{projects.map((project) => <MenuItem key={project.projectKey} value={project.projectKey}>{project.projectKey}</MenuItem>)}</Select></FormControl><FormControl size="small"><InputLabel>Identity</InputLabel><Select value={identityFilter} label="Identity" onChange={(event) => setIdentityFilter(event.target.value as IdentityKind | "all")}><MenuItem value="all">All identities</MenuItem><MenuItem value="agent">Agent N</MenuItem><MenuItem value="codex">Codex N</MenuItem><MenuItem value="orchestrator">Orchestrator</MenuItem><MenuItem value="dependabot">Dependabot</MenuItem><MenuItem value="other">Other</MenuItem></Select></FormControl><FormControl size="small"><InputLabel>Status</InputLabel><Select value={statusFilter} label="Status" onChange={(event) => setStatusFilter(event.target.value as AgentStatusFilter)}><MenuItem value="all">All statuses</MenuItem><MenuItem value="working">Working</MenuItem><MenuItem value="returned">Returned</MenuItem><MenuItem value="blocked">Blocked</MenuItem><MenuItem value="idle">Idle</MenuItem></Select></FormControl><IconButton aria-label="Clear filters" onClick={clearFilters}><SearchRounded /></IconButton></Stack><AgentTable rows={filteredRows} sortKey={sortKey} sortDirection={sortDirection} sort={sort} onView={setSelectedAgentKey} /></Paper><AgentDetailDialog row={selectedAgent} onClose={() => setSelectedAgentKey(null)} /><RawTablesDialog open={rawOpen} onClose={() => setRawOpen(false)} /></Container>;
}
