"use client";

import {
  AccountTreeRounded,
  AutorenewRounded,
  ForumRounded,
  GroupsRounded,
  SearchRounded,
  ShieldRounded,
  StorageRounded,
  TaskAltRounded,
} from "@mui/icons-material";
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Container,
  Divider,
  FormControl,
  InputAdornment,
  InputLabel,
  LinearProgress,
  MenuItem,
  Paper,
  Select,
  Skeleton,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { alpha } from "@mui/material/styles";
import { useEffect, useMemo, useState } from "react";
import type {
  ActorSnapshot,
  ActorsBatchPayload,
  JsonValue,
  OverviewPayload,
  ViewerIdentity,
} from "@/types/dashboard";

interface DashboardClientProps {
  projects: string[];
  viewer: ViewerIdentity;
}

function isRecord(value: JsonValue): value is { [key: string]: JsonValue } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isWorking(actor: ActorSnapshot): boolean {
  if (actor.work.length > 0) return true;
  const status = actor.status.toLowerCase();
  return ["working", "active", "implementing", "reviewing", "in_progress", "in-progress"].some((token) =>
    status.includes(token),
  );
}

function prettyValue(value: JsonValue): string {
  return JSON.stringify(value, null, 2);
}

async function readJson<T>(response: Response): Promise<T> {
  const body = (await response.json()) as T & { error?: string };
  if (!response.ok) throw new Error(body.error ?? `Request failed (${response.status})`);
  return body;
}

function JsonPanel({ value }: { value: JsonValue }) {
  return (
    <Box
      component="pre"
      sx={{
        m: 0,
        p: 1.5,
        maxHeight: 280,
        overflow: "auto",
        borderRadius: 2,
        bgcolor: "rgba(2, 8, 14, 0.68)",
        border: "1px solid",
        borderColor: "divider",
        color: "text.secondary",
        fontSize: 12,
        lineHeight: 1.65,
        whiteSpace: "pre-wrap",
        wordBreak: "break-word",
      }}
    >
      {prettyValue(value)}
    </Box>
  );
}

function MetricCard({
  label,
  value,
  helper,
  icon,
}: {
  label: string;
  value: number;
  helper: string;
  icon: React.ReactNode;
}) {
  return (
    <Card sx={{ minHeight: 154 }}>
      <CardContent>
        <Stack direction="row" justifyContent="space-between" alignItems="flex-start">
          <Box>
            <Typography variant="overline" color="text.secondary" sx={{ letterSpacing: "0.12em" }}>
              {label}
            </Typography>
            <Typography variant="h3" sx={{ mt: 0.5, fontSize: { xs: 40, md: 48 } }}>
              {value}
            </Typography>
          </Box>
          <Box
            sx={{
              display: "grid",
              placeItems: "center",
              width: 42,
              height: 42,
              borderRadius: 2.5,
              color: "primary.main",
              bgcolor: (theme) => alpha(theme.palette.primary.main, 0.11),
            }}
          >
            {icon}
          </Box>
        </Stack>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
          {helper}
        </Typography>
      </CardContent>
    </Card>
  );
}

function ActorCard({ actor }: { actor: ActorSnapshot }) {
  const working = isWorking(actor);
  return (
    <Card sx={{ height: "100%", overflow: "hidden" }}>
      <CardContent>
        <Stack direction="row" alignItems="center" justifyContent="space-between" gap={1}>
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="h6" noWrap>
              {actor.identity}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              prompt {actor.promptAssigned ? `${actor.promptLength.toLocaleString()} chars` : "not assigned"}
            </Typography>
          </Box>
          <Chip
            label={actor.status}
            size="small"
            color={working ? "success" : actor.coordination.length > 0 ? "warning" : "info"}
            variant="outlined"
          />
        </Stack>

        <Stack direction="row" spacing={1} sx={{ mt: 2, flexWrap: "wrap", rowGap: 1 }}>
          <Chip size="small" label={`${actor.work.length} work`} />
          <Chip size="small" label={`${actor.resources.length} resources`} />
          <Chip size="small" label={`${actor.coordination.length} messages`} />
        </Stack>
      </CardContent>
      <Divider />
      <Accordion disableGutters elevation={0} sx={{ bgcolor: "transparent", "&:before": { display: "none" } }}>
        <AccordionSummary>
          <Typography variant="body2" color="text.secondary">
            Inspect current state
          </Typography>
        </AccordionSummary>
        <AccordionDetails>
          <Stack spacing={1.5}>
            <Typography variant="caption" color="text.secondary">
              STATE
            </Typography>
            <JsonPanel value={actor.state} />
            {actor.work.length > 0 && (
              <>
                <Typography variant="caption" color="text.secondary">
                  WORK
                </Typography>
                <JsonPanel value={actor.work} />
              </>
            )}
            {actor.resources.length > 0 && (
              <>
                <Typography variant="caption" color="text.secondary">
                  RESOURCES
                </Typography>
                <JsonPanel value={actor.resources} />
              </>
            )}
            {actor.coordination.length > 0 && (
              <>
                <Typography variant="caption" color="text.secondary">
                  COORDINATION
                </Typography>
                <JsonPanel value={actor.coordination} />
              </>
            )}
          </Stack>
        </AccordionDetails>
      </Accordion>
    </Card>
  );
}

export function DashboardClient({ projects, viewer }: DashboardClientProps) {
  const [project, setProject] = useState(projects[0]);
  const [overview, setOverview] = useState<OverviewPayload | null>(null);
  const [actors, setActors] = useState<ActorSnapshot[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [scanProgress, setScanProgress] = useState(0);
  const [refreshToken, setRefreshToken] = useState(0);
  const [query, setQuery] = useState("");

  useEffect(() => {
    const controller = new AbortController();

    async function load() {
      setLoading(true);
      setError(null);
      setOverview(null);
      setActors([]);
      setScanProgress(0);

      try {
        const overviewResponse = await fetch(`/api/overview?project=${encodeURIComponent(project)}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        const nextOverview = await readJson<OverviewPayload>(overviewResponse);
        setOverview(nextOverview);

        const collected: ActorSnapshot[] = [];
        const concurrency = 2;
        for (let start = 0; start < nextOverview.actorBatchCount; start += concurrency) {
          const batches = Array.from(
            { length: Math.min(concurrency, nextOverview.actorBatchCount - start) },
            (_, offset) => start + offset,
          );
          const responses = await Promise.all(
            batches.map(async (batch) => {
              const response = await fetch(
                `/api/actors?project=${encodeURIComponent(project)}&batch=${batch}`,
                { cache: "no-store", signal: controller.signal },
              );
              return readJson<ActorsBatchPayload>(response);
            }),
          );
          collected.push(...responses.flatMap((response) => response.actors));
          collected.sort((left, right) => left.identity.localeCompare(right.identity, undefined, { numeric: true }));
          setActors([...collected]);
          setScanProgress(Math.min(100, Math.round(((start + responses.length) / nextOverview.actorBatchCount) * 100)));
        }
      } catch (caught) {
        if (controller.signal.aborted) return;
        setError(caught instanceof Error ? caught.message : "Dashboard data could not be loaded.");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }

    void load();
    return () => controller.abort();
  }, [project, refreshToken]);

  const visibleActors = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return actors;
    return actors.filter((actor) => {
      const searchable = `${actor.identity} ${actor.status} ${prettyValue(actor.state)} ${prettyValue(actor.work)}`.toLowerCase();
      return searchable.includes(needle);
    });
  }, [actors, query]);

  const metrics = useMemo(() => {
    const working = actors.filter(isWorking).length;
    const resources = actors.reduce((total, actor) => total + actor.resources.length, 0);
    const coordination = actors.reduce((total, actor) => total + actor.coordination.length, 0);
    return { active: actors.length, working, resources, coordination };
  }, [actors]);

  const projectState = overview?.projectState;
  const objective = projectState && isRecord(projectState) && typeof projectState.objective === "string"
    ? projectState.objective
    : null;
  const phase = projectState && isRecord(projectState) && typeof projectState.phase === "string"
    ? projectState.phase
    : null;

  return (
    <Container maxWidth="xl" sx={{ py: { xs: 2, md: 4 } }}>
      <Paper
        sx={{
          p: { xs: 2.5, md: 4 },
          mb: 3,
          overflow: "hidden",
          position: "relative",
          border: "1px solid",
          borderColor: "rgba(255,255,255,0.08)",
          background: (theme) =>
            `linear-gradient(120deg, ${alpha(theme.palette.primary.main, 0.12)}, ${alpha(theme.palette.secondary.main, 0.08)} 48%, rgba(13,24,35,0.92) 78%)`,
        }}
      >
        <Stack direction={{ xs: "column", md: "row" }} justifyContent="space-between" gap={3}>
          <Box sx={{ maxWidth: 820 }}>
            <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 2 }}>
              <Chip icon={<ShieldRounded />} label="Cloudflare Access" size="small" color="primary" variant="outlined" />
              <Chip label="Read only" size="small" variant="outlined" />
            </Stack>
            <Typography variant="overline" color="primary.main" sx={{ letterSpacing: "0.18em" }}>
              STREAMSCAPETV · OPERATIONS
            </Typography>
            <Typography variant="h3" sx={{ mt: 0.5, fontSize: { xs: 38, md: 60 } }}>
              Agent State Control Room
            </Typography>
            <Typography color="text.secondary" sx={{ mt: 1.5, maxWidth: 720, fontSize: { md: 17 } }}>
              Live, bounded visibility into current projects, active agents, work assignments, resource ownership and coordination.
            </Typography>
          </Box>
          <Stack alignItems={{ xs: "flex-start", md: "flex-end" }} justifyContent="space-between" gap={2}>
            <Box sx={{ textAlign: { xs: "left", md: "right" } }}>
              <Typography variant="caption" color="text.secondary">
                SIGNED IN
              </Typography>
              <Typography variant="body2" fontWeight={700}>
                {viewer.email}
              </Typography>
            </Box>
            <Button startIcon={<AutorenewRounded />} variant="contained" onClick={() => setRefreshToken((value) => value + 1)}>
              Refresh snapshot
            </Button>
          </Stack>
        </Stack>
      </Paper>

      <Stack direction={{ xs: "column", md: "row" }} spacing={2} sx={{ mb: 3 }}>
        <FormControl sx={{ minWidth: { xs: "100%", md: 280 } }}>
          <InputLabel id="project-label">Project</InputLabel>
          <Select
            labelId="project-label"
            value={project}
            label="Project"
            onChange={(event) => setProject(String(event.target.value))}
          >
            {projects.map((item) => (
              <MenuItem key={item} value={item}>
                {item}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
        <TextField
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Filter agents, status or work…"
          sx={{ flex: 1 }}
          slotProps={{
            input: {
              startAdornment: (
                <InputAdornment position="start">
                  <SearchRounded fontSize="small" />
                </InputAdornment>
              ),
            },
          }}
        />
      </Stack>

      {error && <Alert severity="error" sx={{ mb: 3 }}>{error}</Alert>}
      {(loading || (overview && scanProgress < 100)) && <LinearProgress variant="determinate" value={scanProgress || 8} sx={{ mb: 3, borderRadius: 999 }} />}

      <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "repeat(2, 1fr)", xl: "repeat(4, 1fr)" }, gap: 2, mb: 3 }}>
        {loading && actors.length === 0 ? (
          Array.from({ length: 4 }, (_, index) => <Skeleton key={index} variant="rounded" height={154} />)
        ) : (
          <>
            <MetricCard label="Active actors" value={metrics.active} helper="Current actor rows with actionable state" icon={<GroupsRounded />} />
            <MetricCard label="Working" value={metrics.working} helper="Actors with work or active lifecycle" icon={<TaskAltRounded />} />
            <MetricCard label="Resources" value={metrics.resources} helper="Current exclusive resource claims" icon={<AccountTreeRounded />} />
            <MetricCard label="Coordination" value={metrics.coordination} helper="Current sender/recipient messages" icon={<ForumRounded />} />
          </>
        )}
      </Box>

      <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", lg: "minmax(0, 1.4fr) minmax(320px, 0.6fr)" }, gap: 2, mb: 3 }}>
        <Card>
          <CardContent>
            <Stack direction="row" justifyContent="space-between" gap={2} sx={{ mb: 2 }}>
              <Box>
                <Typography variant="overline" color="text.secondary">CURRENT PROJECT</Typography>
                <Typography variant="h5">{project}</Typography>
              </Box>
              {phase && <Chip label={phase} color="secondary" variant="outlined" />}
            </Stack>
            {objective && <Typography sx={{ mb: 2 }}>{objective}</Typography>}
            {overview ? <JsonPanel value={overview.projectState} /> : <Skeleton variant="rounded" height={190} />}
          </CardContent>
        </Card>
        <Card>
          <CardContent>
            <Stack direction="row" spacing={1.25} alignItems="center" sx={{ mb: 2 }}>
              <StorageRounded color="primary" />
              <Box>
                <Typography variant="overline" color="text.secondary">STORAGE BUDGET</Typography>
                <Typography variant="h6">Authority footprint</Typography>
              </Box>
            </Stack>
            {overview ? <JsonPanel value={overview.storageBudget} /> : <Skeleton variant="rounded" height={190} />}
          </CardContent>
        </Card>
      </Box>

      <Stack direction="row" justifyContent="space-between" alignItems="flex-end" gap={2} sx={{ mb: 2 }}>
        <Box>
          <Typography variant="overline" color="text.secondary">ACTOR DIRECTORY</Typography>
          <Typography variant="h4" sx={{ fontSize: { xs: 28, md: 34 } }}>Current activity</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            {visibleActors.length} shown · {actors.length} active · {overview?.actorCapacity ?? 202} identities scanned
          </Typography>
        </Box>
        {overview && (
          <Typography variant="caption" color="text.secondary" sx={{ display: { xs: "none", sm: "block" } }}>
            Snapshot {new Date(overview.scannedAt).toLocaleString()}
          </Typography>
        )}
      </Stack>

      <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", md: "repeat(2, minmax(0, 1fr))", xl: "repeat(3, minmax(0, 1fr))" }, gap: 2 }}>
        {visibleActors.map((actor) => <ActorCard key={actor.identity} actor={actor} />)}
      </Box>

      {!loading && !error && visibleActors.length === 0 && (
        <Paper variant="outlined" sx={{ mt: 2, p: 5, textAlign: "center" }}>
          <GroupsRounded sx={{ fontSize: 40, color: "text.disabled", mb: 1 }} />
          <Typography variant="h6">No matching active actors</Typography>
          <Typography color="text.secondary" variant="body2">Try another project or clear the filter.</Typography>
        </Paper>
      )}
    </Container>
  );
}
