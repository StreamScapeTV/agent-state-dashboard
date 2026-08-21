"use client";

import { SearchRounded, VisibilityRounded } from "@mui/icons-material";
import {
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
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
import {
  buildCoordinationItems,
  coordinationCounts,
  dedupeCurrentCoordination,
  filterCoordinationItems,
  type CoordinationBoardItem,
  type CoordinationDirection,
} from "@/lib/coordination-board";
import type { AgentViewRow, CurrentCoordinationRecord } from "@/types/dashboard";

interface CoordinationBoardProps {
  coordination?: CurrentCoordinationRecord[];
  agents: AgentViewRow[];
  onView: (key: string) => void;
}

function compactSummary(item: CoordinationBoardItem): string {
  return item.decision
    ?? item.blocker
    ?? item.summary
    ?? item.objective
    ?? item.nextAction
    ?? item.status
    ?? item.type
    ?? "Structured summary unavailable";
}

function participantKey(item: CoordinationBoardItem, participant: "sender" | "recipient"): string | null {
  const actor = participant === "sender" ? item.senderAgent : item.recipientAgent;
  return actor?.key ?? null;
}

export function CoordinationBoard({ coordination, agents, onView }: CoordinationBoardProps) {
  const [direction, setDirection] = useState<CoordinationDirection>("inbox");
  const [identity, setIdentity] = useState("Orchestrator");
  const [project, setProject] = useState("all");
  const [query, setQuery] = useState("");
  const [rawItem, setRawItem] = useState<CoordinationBoardItem | null>(null);

  const currentCoordination = useMemo(
    () => coordination ?? dedupeCurrentCoordination(agents),
    [coordination, agents],
  );
  const items = useMemo(
    () => buildCoordinationItems(currentCoordination, agents),
    [currentCoordination, agents],
  );
  const filtered = useMemo(
    () => filterCoordinationItems(items, { direction, identity, project, query }),
    [items, direction, identity, project, query],
  );
  const counts = useMemo(() => coordinationCounts(filtered), [filtered]);

  const identities = useMemo(() => {
    const values = new Set<string>(["Orchestrator"]);
    for (const item of items) {
      values.add(item.sender);
      values.add(item.recipient);
    }
    return [...values].sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));
  }, [items]);
  const projects = useMemo(
    () => [...new Set(items.map((item) => item.projectKey))].sort((left, right) => left.localeCompare(right)),
    [items],
  );

  const clearFilters = () => {
    setDirection("inbox");
    setIdentity("Orchestrator");
    setProject("all");
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
            <Typography variant="h6">Coordination</Typography>
            <Chip size="small" label={`${counts.total} cells`} />
            <Chip size="small" variant="outlined" label={`${counts.projects} projects`} />
            <Chip size="small" variant="outlined" label={`${counts.senders} senders`} />
            <Chip size="small" variant="outlined" label={`${counts.recipients} recipients`} />
          </Stack>
          <Typography variant="caption" color="text.secondary">
            Current routing cells only. Resolved/deleted coordination disappears on refresh; no past routing or local read-state ledger is retained.
          </Typography>
        </Box>
      </Stack>

      <Stack direction={{ xs: "column", xl: "row" }} sx={{ gap: 1, px: 1.5, pb: 1.5 }}>
        <FormControl size="small" sx={{ minWidth: 130 }}>
          <InputLabel>Direction</InputLabel>
          <Select
            value={direction}
            label="Direction"
            onChange={(event) => setDirection(event.target.value as CoordinationDirection)}
          >
            <MenuItem value="inbox">Inbox</MenuItem>
            <MenuItem value="outbox">Outbox</MenuItem>
            <MenuItem value="all">All routing</MenuItem>
          </Select>
        </FormControl>
        <FormControl size="small" sx={{ minWidth: 190 }}>
          <InputLabel>Identity</InputLabel>
          <Select value={identity} label="Identity" onChange={(event) => setIdentity(String(event.target.value))}>
            {identities.map((value) => <MenuItem key={value} value={value}>{value}</MenuItem>)}
          </Select>
        </FormControl>
        <FormControl size="small" sx={{ minWidth: 160 }}>
          <InputLabel>Project</InputLabel>
          <Select value={project} label="Project" onChange={(event) => setProject(String(event.target.value))}>
            <MenuItem value="all">All projects</MenuItem>
            {projects.map((value) => <MenuItem key={value} value={value}>{value}</MenuItem>)}
          </Select>
        </FormControl>
        <TextField
          size="small"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search sender, recipient, status, decision, blocker…"
          sx={{ minWidth: 320 }}
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
        <IconButton aria-label="Reset coordination filters" onClick={clearFilters}>
          <SearchRounded />
        </IconButton>
      </Stack>

      {filtered.length === 0 ? (
        <Typography sx={{ px: 1.5, pb: 1.5 }} color="text.secondary">
          No current coordination matches this routing view.
        </Typography>
      ) : (
        <TableContainer sx={{ maxHeight: 420 }}>
          <Table size="small" stickyHeader aria-label="Current coordination routing">
            <TableHead>
              <TableRow>
                <TableCell>Project</TableCell>
                <TableCell>Sender</TableCell>
                <TableCell>Recipient</TableCell>
                <TableCell>Type / status</TableCell>
                <TableCell>Summary</TableCell>
                <TableCell>Next</TableCell>
                <TableCell>Inspect</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {filtered.map((item) => {
                const senderKey = participantKey(item, "sender");
                const recipientKey = participantKey(item, "recipient");
                const selfRoute = item.sender === item.recipient;
                return (
                  <TableRow key={item.key} hover>
                    <TableCell>{item.projectKey}</TableCell>
                    <TableCell>{item.sender}</TableCell>
                    <TableCell>{item.recipient}</TableCell>
                    <TableCell>
                      <Typography variant="caption">
                        {[item.type, item.status].filter(Boolean).join(" · ") || "—"}
                      </Typography>
                    </TableCell>
                    <TableCell sx={{ maxWidth: 360 }}>
                      <Typography noWrap>{compactSummary(item)}</Typography>
                      {item.blocker && item.blocker !== compactSummary(item) ? (
                        <Typography variant="caption" color="warning.main" noWrap>Blocker: {item.blocker}</Typography>
                      ) : null}
                      {item.decision && item.decision !== compactSummary(item) ? (
                        <Typography variant="caption" sx={{ display: "block" }} noWrap>Decision: {item.decision}</Typography>
                      ) : null}
                    </TableCell>
                    <TableCell sx={{ maxWidth: 260 }}>
                      <Typography variant="caption" noWrap>{item.nextAction ?? "—"}</Typography>
                    </TableCell>
                    <TableCell>
                      <Stack direction="row" spacing={0.5} sx={{ whiteSpace: "nowrap" }}>
                        <Button size="small" onClick={() => setRawItem(item)}>Raw</Button>
                        {senderKey ? (
                          <Button
                            size="small"
                            startIcon={<VisibilityRounded />}
                            onClick={() => onView(senderKey)}
                          >
                            {selfRoute ? "Actor" : "Sender"}
                          </Button>
                        ) : null}
                        {!selfRoute && recipientKey ? (
                          <Button
                            size="small"
                            startIcon={<VisibilityRounded />}
                            onClick={() => onView(recipientKey)}
                          >
                            Recipient
                          </Button>
                        ) : null}
                      </Stack>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      <Dialog open={Boolean(rawItem)} onClose={() => setRawItem(null)} maxWidth="md" fullWidth>
        <DialogTitle>
          {rawItem ? `${rawItem.projectKey} · ${rawItem.sender} → ${rawItem.recipient}` : "Coordination JSON"}
        </DialogTitle>
        <DialogContent dividers>
          <Box
            component="pre"
            sx={{
              m: 0,
              p: 1.5,
              maxHeight: 520,
              overflow: "auto",
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              border: "1px solid",
              borderColor: "divider",
              borderRadius: 1.5,
              userSelect: "text",
              fontSize: 12,
            }}
          >
            {rawItem ? JSON.stringify(rawItem.state, null, 2) : "{}"}
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRawItem(null)}>Close</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
