"use client";

import { SearchRounded, VisibilityRounded } from "@mui/icons-material";
import {
  Box,
  Button,
  Chip,
  FormControl,
  IconButton,
  InputAdornment,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from "@mui/material";
import { useMemo, useState } from "react";
import { formatDuration, statusLabel } from "@/lib/dashboard-model";
import {
  CAPACITY_WARNING_RATIO,
  buildResourceCapacitySnapshot,
  filterResourceOwnership,
  type ActorCapacityItem,
  type CapacityUsage,
  type ResourceOwnerStatusFilter,
} from "@/lib/resource-capacity";
import type { AgentViewRow } from "@/types/dashboard";

interface ResourcesCapacityBoardProps {
  rows: AgentViewRow[];
  onView: (key: string) => void;
}

function shortTime(value: string | null): string {
  if (!value) return "—";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? value
    : parsed.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function usageColor(level: CapacityUsage["level"]): "default" | "warning" | "error" {
  if (level === "at-limit") return "error";
  if (level === "near") return "warning";
  return "default";
}

function CapacityChip({ usage }: { usage: CapacityUsage }) {
  return (
    <Chip
      size="small"
      label={`${usage.used} / ${usage.limit}`}
      color={usageColor(usage.level)}
      variant={usage.level === "normal" ? "outlined" : "filled"}
    />
  );
}

function actorMatchesStatus(actor: ActorCapacityItem, status: ResourceOwnerStatusFilter): boolean {
  if (status === "all") return true;
  if (status === "blocked") return actor.blocked;
  return actor.ownerStatus === status;
}

function ownerStatusColor(row: AgentViewRow): "default" | "info" | "success" | "warning" {
  if (row.blocked) return "warning";
  if (row.baseStatus === "working") return "info";
  if (row.baseStatus === "returned") return "success";
  return "default";
}

export function ResourcesCapacityBoard({ rows, onView }: ResourcesCapacityBoardProps) {
  const [project, setProject] = useState("all");
  const [owner, setOwner] = useState("all");
  const [ownerStatus, setOwnerStatus] = useState<ResourceOwnerStatusFilter>("all");
  const [query, setQuery] = useState("");

  const snapshot = useMemo(() => buildResourceCapacitySnapshot(rows), [rows]);
  const projects = useMemo(
    () => snapshot.projects.map((item) => item.projectKey),
    [snapshot.projects],
  );
  const owners = useMemo(
    () => [...new Set(snapshot.actors.map((item) => item.identity))]
      .sort((left, right) => left.localeCompare(right, undefined, { numeric: true })),
    [snapshot.actors],
  );

  const filteredResources = useMemo(
    () => filterResourceOwnership(snapshot.resources, {
      project,
      owner,
      ownerStatus,
      query,
    }),
    [snapshot.resources, project, owner, ownerStatus, query],
  );

  const filteredActors = useMemo(
    () => snapshot.actors.filter((item) =>
      (project === "all" || item.projectKey === project)
      && (owner === "all" || item.identity === owner)
      && actorMatchesStatus(item, ownerStatus),
    ),
    [snapshot.actors, project, owner, ownerStatus],
  );

  const filteredProjects = useMemo(
    () => snapshot.projects.filter((item) => project === "all" || item.projectKey === project),
    [snapshot.projects, project],
  );

  const clearFilters = () => {
    setProject("all");
    setOwner("all");
    setOwnerStatus("all");
    setQuery("");
  };

  return (
    <Box sx={{ borderTop: "1px solid", borderColor: "divider" }}>
      <Stack
        direction={{ xs: "column", lg: "row" }}
        sx={{ gap: 1, p: 1.5, alignItems: { lg: "center" }, justifyContent: "space-between" }}
      >
        <Box>
          <Stack direction="row" spacing={1} sx={{ alignItems: "center", flexWrap: "wrap" }}>
            <Typography variant="h6">Resources &amp; Capacity</Typography>
            <Chip size="small" label={`${snapshot.resources.length} exact resources`} />
            <Chip size="small" variant="outlined" label={`${snapshot.actors.length} actors`} />
          </Stack>
          <Typography variant="caption" color="text.secondary">
            Exact current resource keys are authoritative. Pattern expansion and age expiry are not inferred; capacity warning at {Math.round(CAPACITY_WARNING_RATIO * 100)}% is visual guidance only.
          </Typography>
        </Box>
      </Stack>

      <Stack direction={{ xs: "column", xl: "row" }} sx={{ gap: 1, px: 1.5, pb: 1.5 }}>
        <FormControl size="small" sx={{ minWidth: 170 }}>
          <InputLabel>Project</InputLabel>
          <Select value={project} label="Project" onChange={(event) => setProject(String(event.target.value))}>
            <MenuItem value="all">All projects</MenuItem>
            {projects.map((value) => <MenuItem key={value} value={value}>{value}</MenuItem>)}
          </Select>
        </FormControl>
        <FormControl size="small" sx={{ minWidth: 170 }}>
          <InputLabel>Owner</InputLabel>
          <Select value={owner} label="Owner" onChange={(event) => setOwner(String(event.target.value))}>
            <MenuItem value="all">All owners</MenuItem>
            {owners.map((value) => <MenuItem key={value} value={value}>{value}</MenuItem>)}
          </Select>
        </FormControl>
        <FormControl size="small" sx={{ minWidth: 160 }}>
          <InputLabel>Owner status</InputLabel>
          <Select
            value={ownerStatus}
            label="Owner status"
            onChange={(event) => setOwnerStatus(event.target.value as ResourceOwnerStatusFilter)}
          >
            <MenuItem value="all">All statuses</MenuItem>
            <MenuItem value="working">Working</MenuItem>
            <MenuItem value="returned">Returned</MenuItem>
            <MenuItem value="blocked">Blocked</MenuItem>
            <MenuItem value="idle">Idle</MenuItem>
          </Select>
        </FormControl>
        <TextField
          size="small"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search exact resource key or owner…"
          sx={{ minWidth: 300 }}
          slotProps={{
            input: {
              startAdornment: (
                <InputAdornment position="start"><SearchRounded /></InputAdornment>
              ),
            },
          }}
        />
        <IconButton aria-label="Reset resource filters" onClick={clearFilters}>
          <SearchRounded />
        </IconButton>
      </Stack>

      <Typography variant="overline" sx={{ px: 1.5 }}>Exact resource ownership</Typography>
      {filteredResources.length === 0 ? (
        <Typography color="text.secondary" sx={{ px: 1.5, pb: 1.5 }}>
          No exact current resource matches these filters.
        </Typography>
      ) : (
        <TableContainer sx={{ maxHeight: 360 }}>
          <Table size="small" stickyHeader aria-label="Exact resource ownership">
            <TableHead>
              <TableRow>
                <TableCell>Project</TableCell>
                <TableCell>Exact resource key</TableCell>
                <TableCell>Owner</TableCell>
                <TableCell>Status</TableCell>
                <TableCell>Current work</TableCell>
                <TableCell>Assignment timing</TableCell>
                <TableCell>Attention</TableCell>
                <TableCell />
              </TableRow>
            </TableHead>
            <TableBody>
              {filteredResources.map((item) => (
                <TableRow key={item.key} hover>
                  <TableCell>{item.projectKey}</TableCell>
                  <TableCell>
                    <Typography variant="body2" sx={{ fontFamily: "monospace" }}>{item.resourceKey}</Typography>
                  </TableCell>
                  <TableCell>{item.owner.identity}</TableCell>
                  <TableCell>
                    <Chip
                      size="small"
                      label={statusLabel(item.owner)}
                      color={ownerStatusColor(item.owner)}
                    />
                  </TableCell>
                  <TableCell sx={{ maxWidth: 280 }}>
                    <Typography variant="caption" noWrap>{item.workCount} · {item.workSummary}</Typography>
                  </TableCell>
                  <TableCell>
                    <Typography variant="caption">
                      A {shortTime(item.assignedAt)} · R {shortTime(item.lastReturnedAt)} · {formatDuration(item.durationMs)}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    {item.ownershipAttention ? (
                      <Chip size="small" color="warning" variant="outlined" label={`${item.ownerStatus} owner`} />
                    ) : "—"}
                  </TableCell>
                  <TableCell>
                    <Button
                      size="small"
                      startIcon={<VisibilityRounded />}
                      onClick={() => onView(item.owner.key)}
                    >
                      View
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      <Typography variant="overline" sx={{ px: 1.5, pt: 1.5, display: "block" }}>Actor capacity</Typography>
      <TableContainer sx={{ maxHeight: 360 }}>
        <Table size="small" stickyHeader aria-label="Actor Agent State capacity">
          <TableHead>
            <TableRow>
              <TableCell>Actor</TableCell>
              <TableCell>Status</TableCell>
              <TableCell>Resources</TableCell>
              <TableCell>Work</TableCell>
              <TableCell>Coordination sent</TableCell>
              <TableCell>Coordination received</TableCell>
              <TableCell>Cues</TableCell>
              <TableCell />
            </TableRow>
          </TableHead>
          <TableBody>
            {filteredActors.map((item) => {
              const row = rows.find((candidate) => candidate.key === item.key);
              return (
                <TableRow key={item.key} hover>
                  <TableCell>
                    <Typography sx={{ fontWeight: 700 }}>{item.identity}</Typography>
                    <Typography variant="caption">{item.projectKey}</Typography>
                  </TableCell>
                  <TableCell>{item.blocked ? `Blocked · ${item.ownerStatus}` : item.ownerStatus}</TableCell>
                  <TableCell><CapacityChip usage={item.resources} /></TableCell>
                  <TableCell><CapacityChip usage={item.work} /></TableCell>
                  <TableCell><CapacityChip usage={item.coordinationSent} /></TableCell>
                  <TableCell><CapacityChip usage={item.coordinationReceived} /></TableCell>
                  <TableCell>
                    <Stack direction="row" spacing={0.5} sx={{ flexWrap: "wrap" }}>
                      {item.ownershipAttention ? <Chip size="small" color="warning" label="Ownership attention" /> : null}
                      {item.nearCapacity ? <Chip size="small" color="warning" variant="outlined" label="Capacity attention" /> : null}
                      {!item.ownershipAttention && !item.nearCapacity ? "—" : null}
                    </Stack>
                  </TableCell>
                  <TableCell>
                    {row ? (
                      <Button size="small" startIcon={<VisibilityRounded />} onClick={() => onView(row.key)}>View</Button>
                    ) : null}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </TableContainer>

      <Typography variant="overline" sx={{ px: 1.5, pt: 1.5, display: "block" }}>Project capacity</Typography>
      <TableContainer sx={{ maxHeight: 260, pb: 1.5 }}>
        <Table size="small" stickyHeader aria-label="Project Agent State capacity">
          <TableHead>
            <TableRow>
              <TableCell>Project</TableCell>
              <TableCell>Current work</TableCell>
              <TableCell>Current coordination</TableCell>
              <TableCell>Cue</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {filteredProjects.map((item) => (
              <TableRow key={item.projectKey}>
                <TableCell>{item.projectKey}</TableCell>
                <TableCell><CapacityChip usage={item.work} /></TableCell>
                <TableCell><CapacityChip usage={item.coordination} /></TableCell>
                <TableCell>{item.nearCapacity ? <Chip size="small" color="warning" label="Capacity attention" /> : "—"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
    </Box>
  );
}
