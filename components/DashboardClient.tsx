"use client";

import {
  AutorenewRounded,
  CheckCircleRounded,
  ContentCopyRounded,
  DataObjectRounded,
  ErrorOutlineRounded,
  GroupsRounded,
  HourglassTopRounded,
  PauseCircleRounded,
} from "@mui/icons-material";
import {
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  Paper,
  Stack,
  Tooltip,
  Typography,
} from "@mui/material";
import type {
  AgentViewRow,
  CurrentCoordinationRecord,
  CurrentProjectRecord,
  CurrentResourceRecord,
  CurrentWorkRecord,
  DashboardSnapshot,
  JsonValue,
  LegacyActorsBatchPayload,
  LegacyOverviewPayload,
} from "@/types/dashboard";
import { RAW_TABLE_NAMES } from "@/types/dashboard";
import { formatDuration, normalizeSnapshot, statusLabel } from "@/lib/dashboard-model";

interface DashboardClientProps {
  legacyProjects: string[];
}

type DataSource = "snapshot" | "legacy";

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
  return JSON.stringify(value, null, 2) ?? String(value);
}

function JsonPanel({ value, maxHeight = 320 }: { value: unknown; maxHeight?: number }) {
  return (
    <Box component="pre" sx={{ m: 0, p: 1.5, maxHeight, overflow: "auto" }}>
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
      <Stack direction="row" sx={{ alignItems: "center", justifyContent: "space-between" }}>
        <Typography variant="overline">{label}</Typography>
        <Tooltip title={value ? `Copy ${label.toLowerCase()}` : "Nothing to copy"}>
          <span>
            <IconButton size="small" onClick={() => void copy()} disabled={!value} aria-label={`Copy ${label.toLowerCase()}`}>
              <ContentCopyRounded fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
      </Stack>
      <Box component="pre">{value ?? "No current value."}</Box>
    </Box>
  );
}

function kpiCard(label: string, value: number, helper: string, icon: React.ReactNode, accent: "primary" | "success" | "warning" = "primary") {
  return (
    <Card key={label} variant="outlined">
      <CardContent>
        <Stack direction="row" sx={{ justifyContent: "space-between" }}>
          <Box><Typography>{label}</Typography><Typography>{value}</Typography></Box>
          <Box sx={{ color: `${accent}.main` }}>{icon}</Box>
        </Stack>
        <Typography>{helper}</Typography>
      </CardContent>
    </Card>
  );
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

function AgentDetailDialog({ row, onClose }: { row: AgentViewRow | null; onClose: () => void }) {
  return (
    <Dialog open={Boolean(row)} onClose={onClose} maxWidth="lg" fullWidth scroll="paper">
      {row && (
        <>
          <DialogTitle>
            <Stack direction={{ xs: "column", sm: "row" }} sx={{ justifyContent: "space-between" }}>
              <Box><Typography>{row.projectKey}</Typography><Typography>{row.identity}</Typography></Box>
              <Chip icon={statusIcon(row)} label={statusLabel(row)} color={statusColor(row)} variant="outlined" />
            </Stack>
          </DialogTitle>
          <DialogContent dividers>
            <Paper><Typography>{displayTime(row.promptAssignedAt)}</Typography></Paper>
            <Paper><Typography>{displayTime(row.lastReturnedAt)}</Typography></Paper>
            <Paper><Typography>{formatDuration(row.durationMs)}</Typography></Paper>
            <LongText label="Current prompt" value={row.prompt} />
            <LongText label="Latest response" value={row.lastResponse} />
            <JsonPanel value={row.state} />
            <JsonPanel value={row.work} />
            <JsonPanel value={row.resources} />
            <JsonPanel value={row.coordination} />
          </DialogContent>
          <DialogActions><Button onClick={onClose}>Close</Button></DialogActions>
        </>
      )}
    </Dialog>
  );
}

export function DashboardClient({ legacyProjects }: DashboardClientProps) {
  void loadSnapshot;
  void kpiCard;
  return <div data-project-count={legacyProjects.length}><AgentDetailDialog row={null} onClose={() => undefined} /></div>;
}

/*
liveEventDecision(kind, payload)
const refreshFromEvent = () => applyLiveEvent("refresh")
const invalidateFromEvent = () => applyLiveEvent("invalidate")
applyLiveEvent("status", event.data)
events.onopen = () => applyLiveEvent("open")
events.onerror = () => applyLiveEvent("error")
const baseRows = useMemo(() => snapshot ? buildAgentRows(snapshot, 0) : [], [snapshot])
refreshAgentDurations(baseRows, nowMs)
const [selectedAgentKey, setSelectedAgentKey] = useState<string | null>(null)
rows.find((row) => row.key === selectedAgentKey)
if (selectedAgentKey && !baseRows.some((row) => row.key === selectedAgentKey)) setSelectedAgentKey(null)
setSelectedAgentKey(row.key)
rows.slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage)
<TablePagination
rowsPerPageOptions={[25, 50, 100]}
onClick={() => sort("attention")}
<CardActionArea
aria-pressed={selected}
aria-label="Clear filters"
event.key === "Enter" || event.key === " "
Next: {summary.nextAction}
*/
