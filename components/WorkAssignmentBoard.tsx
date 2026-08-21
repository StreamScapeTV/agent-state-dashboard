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
import { formatDuration } from "@/lib/dashboard-model";
import {
  buildWorkBoardItems,
  filterWorkBoardItems,
  groupWorkBoardItems,
  type WorkBoardItem,
  type WorkOwnerStatus,
} from "@/lib/work-assignment-board";
import type { AgentViewRow, CurrentWorkRecord, IdentityKind, JsonValue } from "@/types/dashboard";

interface WorkAssignmentBoardProps {
  work: CurrentWorkRecord[];
  agents: AgentViewRow[];
  onView: (key: string) => void;
}

function shortTime(value: string | null): string {
  if (!value) return "—";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? value
    : parsed.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function compactContext(value: JsonValue | null): string | null {
  if (value === null) return null;
  const rendered = JSON.stringify(value);
  return rendered.length > 140 ? `${rendered.slice(0, 137)}…` : rendered;
}

function ownerStatus(item: WorkBoardItem): { label: string; color: "success" | "warning" | "info" | "default" } {
  if (!item.owner) return { label: "Owner unavailable", color: "default" };
  if (item.blocked) return { label: `Blocked · ${item.ownerStatus}`, color: "warning" };
  if (item.ownerStatus === "returned") return { label: "Returned · current work", color: "success" };
  if (item.ownerStatus === "working") return { label: "Working", color: "info" };
  return { label: "Idle · current work", color: "default" };
}

function timingLabel(item: WorkBoardItem): string {
  const duration = formatDuration(item.durationMs);
  return `A ${shortTime(item.assignedAt)} · R ${shortTime(item.lastReturnedAt)} · ${duration}`;
}

export function WorkAssignmentBoard({ work, agents, onView }: WorkAssignmentBoardProps) {
  const [query, setQuery] = useState("");
  const [project, setProject] = useState("all");
  const [identity, setIdentity] = useState("all");
  const [identityKind, setIdentityKind] = useState<IdentityKind | "all">("all");
  const [ownerState, setOwnerState] = useState<WorkOwnerStatus | "all">("all");

  const items = useMemo(() => buildWorkBoardItems(work, agents), [work, agents]);
  const projects = useMemo(
    () => [...new Set(items.map((item) => item.projectKey))].sort((a, b) => a.localeCompare(b)),
    [items],
  );
  const identities = useMemo(
    () => [...new Set(items.map((item) => item.identity))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })),
    [items],
  );

  const filteredItems = useMemo(
    () => filterWorkBoardItems(items, {
      project,
      identity,
      identityKind,
      ownerStatus: ownerState,
      query,
    }),
    [items, project, identity, identityKind, ownerState, query],
  );
  const groups = useMemo(() => groupWorkBoardItems(filteredItems), [filteredItems]);

  const clearFilters = () => {
    setQuery("");
    setProject("all");
    setIdentity("all");
    setIdentityKind("all");
    setOwnerState("all");
  };

  return (
    <Box sx={{ borderTop: "1px solid", borderColor: "divider" }}>
      <Stack
        direction={{ xs: "column", lg: "row" }}
        sx={{ gap: 1, p: 1.5, alignItems: { lg: "center" }, justifyContent: "space-between" }}
      >
        <Box>
          <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
            <Typography variant="h6">Work / Assignment board</Typography>
            <Chip size="small" label={`${filteredItems.length}/${items.length}`} />
          </Stack>
          <Typography variant="caption" color="text.secondary">
            Current Agent State work only. Each current_work row stays independent; returned does not mean completed.
          </Typography>
        </Box>
      </Stack>

      <Stack direction={{ xs: "column", xl: "row" }} sx={{ gap: 1, px: 1.5, pb: 1.5 }}>
        <TextField
          size="small"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search work key, assignment, state, next action…"
          sx={{ minWidth: 280 }}
          slotProps={{
            input: {
              startAdornment: (
                <InputAdornment position="start">
                  <SearchRounded />
                </InputAdornment>
              ),
            },
          }}
        />
        <FormControl size="small" sx={{ minWidth: 160 }}>
          <InputLabel>Project</InputLabel>
          <Select value={project} label="Project" onChange={(event) => setProject(String(event.target.value))}>
            <MenuItem value="all">All projects</MenuItem>
            {projects.map((value) => <MenuItem key={value} value={value}>{value}</MenuItem>)}
          </Select>
        </FormControl>
        <FormControl size="small" sx={{ minWidth: 160 }}>
          <InputLabel>Owner</InputLabel>
          <Select value={identity} label="Owner" onChange={(event) => setIdentity(String(event.target.value))}>
            <MenuItem value="all">All owners</MenuItem>
            {identities.map((value) => <MenuItem key={value} value={value}>{value}</MenuItem>)}
          </Select>
        </FormControl>
        <FormControl size="small" sx={{ minWidth: 150 }}>
          <InputLabel>Identity kind</InputLabel>
          <Select
            value={identityKind}
            label="Identity kind"
            onChange={(event) => setIdentityKind(event.target.value as IdentityKind | "all")}
          >
            <MenuItem value="all">All kinds</MenuItem>
            <MenuItem value="agent">Agent N</MenuItem>
            <MenuItem value="codex">Codex N</MenuItem>
            <MenuItem value="orchestrator">Orchestrator</MenuItem>
            <MenuItem value="dependabot">Dependabot</MenuItem>
            <MenuItem value="other">Other</MenuItem>
          </Select>
        </FormControl>
        <FormControl size="small" sx={{ minWidth: 170 }}>
          <InputLabel>Owner state</InputLabel>
          <Select
            value={ownerState}
            label="Owner state"
            onChange={(event) => setOwnerState(event.target.value as WorkOwnerStatus | "all")}
          >
            <MenuItem value="all">All states</MenuItem>
            <MenuItem value="working">Working</MenuItem>
            <MenuItem value="returned">Returned</MenuItem>
            <MenuItem value="blocked">Blocked</MenuItem>
            <MenuItem value="idle">Idle</MenuItem>
            <MenuItem value="unknown">Owner unavailable</MenuItem>
          </Select>
        </FormControl>
        <IconButton aria-label="Clear work board filters" onClick={clearFilters}>
          <SearchRounded />
        </IconButton>
      </Stack>

      {groups.length === 0 ? (
        <Typography sx={{ px: 1.5, pb: 1.5 }} color="text.secondary">
          No current work rows match these filters.
        </Typography>
      ) : groups.map((group) => (
        <Box key={group.projectKey} sx={{ borderTop: "1px solid", borderColor: "divider" }}>
          <Stack direction="row" spacing={1} sx={{ px: 1.5, py: 1, alignItems: "center" }}>
            <Typography variant="subtitle2">{group.projectKey}</Typography>
            <Chip size="small" variant="outlined" label={`${group.items.length} work`} />
          </Stack>
          <TableContainer sx={{ maxHeight: 420 }}>
            <Table size="small" stickyHeader aria-label={`${group.projectKey} current work`}>
              <TableHead>
                <TableRow>
                  <TableCell>Work key</TableCell>
                  <TableCell>Owner</TableCell>
                  <TableCell>Owner state</TableCell>
                  <TableCell>Assignment</TableCell>
                  <TableCell>Work state</TableCell>
                  <TableCell>Timing</TableCell>
                  <TableCell>Ownership</TableCell>
                  <TableCell>Next</TableCell>
                  <TableCell />
                </TableRow>
              </TableHead>
              <TableBody>
                {group.items.map((item) => {
                  const status = ownerStatus(item);
                  const context = compactContext(item.assignmentContext);
                  return (
                    <TableRow key={item.key} hover>
                      <TableCell>
                        <Typography sx={{ fontFamily: "monospace", fontWeight: 700 }}>{item.workKey}</Typography>
                      </TableCell>
                      <TableCell>
                        <Typography sx={{ fontWeight: 700 }}>{item.identity}</Typography>
                        <Typography variant="caption">{item.identityKind}</Typography>
                      </TableCell>
                      <TableCell>
                        <Chip size="small" label={status.label} color={status.color} />
                      </TableCell>
                      <TableCell sx={{ maxWidth: 280 }}>
                        <Typography noWrap>{item.assignmentExcerpt ?? "—"}</Typography>
                        {context ? <Typography variant="caption" noWrap>{context}</Typography> : null}
                      </TableCell>
                      <TableCell sx={{ maxWidth: 260 }}>
                        <Typography noWrap>{item.workSummary}</Typography>
                        {item.workStatus ? <Typography variant="caption">Status: {item.workStatus}</Typography> : null}
                      </TableCell>
                      <TableCell>
                        <Typography variant="caption" sx={{ whiteSpace: "nowrap" }}>{timingLabel(item)}</Typography>
                      </TableCell>
                      <TableCell>
                        <Typography variant="caption">
                          {item.resourceCount} resources · {item.coordinationCount} coordination
                        </Typography>
                      </TableCell>
                      <TableCell sx={{ maxWidth: 240 }}>
                        <Typography variant="caption" noWrap>{item.nextAction ?? "—"}</Typography>
                      </TableCell>
                      <TableCell>
                        <Button
                          size="small"
                          disabled={!item.owner}
                          startIcon={<VisibilityRounded />}
                          onClick={() => item.owner && onView(item.owner.key)}
                        >
                          View owner
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </TableContainer>
        </Box>
      ))}
    </Box>
  );
}
