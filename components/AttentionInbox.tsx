"use client";

import { VisibilityRounded } from "@mui/icons-material";
import {
  Box,
  Button,
  Chip,
  FormControl,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from "@mui/material";
import { useMemo, useState } from "react";
import { buildAttentionQueue, filterAttentionRows } from "@/lib/attention-inbox";
import { formatDuration, statusLabel } from "@/lib/dashboard-model";
import type { AgentViewRow, IdentityKind } from "@/types/dashboard";

interface AttentionInboxProps {
  rows: AgentViewRow[];
  projectFilter: string;
  identityFilter: IdentityKind | "all";
  nowMs: number;
  onView: (key: string) => void;
}

function assignmentPreview(row: AgentViewRow): string {
  const instructions = row.assignment?.instructions.trim();
  if (!instructions) return row.workSummary;
  return instructions.split(/\r?\n/, 1)[0] ?? row.workSummary;
}

function ageLabel(row: AgentViewRow, nowMs: number): string {
  if (row.baseStatus === "working") return `${formatDuration(row.durationMs)} working`;
  if (row.baseStatus === "returned" && row.lastReturnedAt) {
    const returnedAt = Date.parse(row.lastReturnedAt);
    if (Number.isFinite(returnedAt)) return `${formatDuration(Math.max(0, nowMs - returnedAt))} since return`;
  }
  return "No active age cue";
}

function statusColor(row: AgentViewRow): "success" | "warning" | "info" | "default" {
  if (row.blocked) return "warning";
  if (row.baseStatus === "returned") return "success";
  if (row.baseStatus === "working") return "info";
  return "default";
}

export function AttentionInbox({
  rows,
  projectFilter,
  identityFilter,
  nowMs,
  onView,
}: AttentionInboxProps) {
  const [recipient, setRecipient] = useState("Orchestrator");

  const recipientOptions = useMemo(() => {
    const values = new Set<string>(["Orchestrator"]);
    for (const row of rows) {
      values.add(row.identity);
      for (const item of row.coordination) values.add(item.recipient);
    }
    return [...values].sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));
  }, [rows]);

  const filteredRows = useMemo(
    () => filterAttentionRows(rows, projectFilter, identityFilter),
    [rows, projectFilter, identityFilter],
  );

  const items = useMemo(
    () => buildAttentionQueue(filteredRows, recipient),
    [filteredRows, recipient],
  );

  return (
    <Paper variant="outlined" sx={{ mb: 2 }}>
      <Stack
        direction={{ xs: "column", md: "row" }}
        sx={{ gap: 1, p: 1.5, alignItems: { md: "center" }, justifyContent: "space-between" }}
      >
        <Box>
          <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
            <Typography variant="h6">Needs attention</Typography>
            <Chip size="small" label={items.length} />
          </Stack>
          <Typography variant="caption" color="text.secondary">
            Current-state triage only. Assignment age is informational and never changes authoritative status.
          </Typography>
        </Box>
        <FormControl size="small" sx={{ minWidth: 190 }}>
          <InputLabel>Coordination recipient</InputLabel>
          <Select
            value={recipient}
            label="Coordination recipient"
            onChange={(event) => setRecipient(String(event.target.value))}
          >
            {recipientOptions.map((identity) => (
              <MenuItem key={identity} value={identity}>{identity}</MenuItem>
            ))}
          </Select>
        </FormControl>
      </Stack>

      {items.length === 0 ? (
        <Typography sx={{ px: 1.5, pb: 1.5 }} color="text.secondary">
          No current actors match the attention queue for these filters.
        </Typography>
      ) : (
        <TableContainer sx={{ maxHeight: 330 }}>
          <Table size="small" stickyHeader aria-label="Needs attention queue">
            <TableHead>
              <TableRow>
                <TableCell>Actor</TableCell>
                <TableCell>Status</TableCell>
                <TableCell>Current assignment / work</TableCell>
                <TableCell>Age</TableCell>
                <TableCell>Coordination</TableCell>
                <TableCell>Current ownership</TableCell>
                <TableCell>Next</TableCell>
                <TableCell />
              </TableRow>
            </TableHead>
            <TableBody>
              {items.map(({ row, actionableCoordination }) => (
                <TableRow key={row.key} hover>
                  <TableCell>
                    <Typography sx={{ fontWeight: 700 }}>{row.identity}</Typography>
                    <Typography variant="caption">{row.projectKey}</Typography>
                  </TableCell>
                  <TableCell>
                    <Chip size="small" label={statusLabel(row)} color={statusColor(row)} />
                  </TableCell>
                  <TableCell sx={{ maxWidth: 280 }}>
                    <Typography noWrap>{assignmentPreview(row)}</Typography>
                  </TableCell>
                  <TableCell>
                    <Typography variant="caption">{ageLabel(row, nowMs)}</Typography>
                  </TableCell>
                  <TableCell>
                    {actionableCoordination.length > 0 ? (
                      <Typography variant="caption">
                        {row.identity} → {recipient}
                        {actionableCoordination.length > 1 ? ` · ${actionableCoordination.length} items` : ""}
                      </Typography>
                    ) : "—"}
                  </TableCell>
                  <TableCell>
                    <Typography variant="caption">
                      {row.work.length} work · {row.resources.length} resources
                    </Typography>
                  </TableCell>
                  <TableCell sx={{ maxWidth: 240 }}>
                    <Typography variant="caption" noWrap>{row.nextAction ?? "—"}</Typography>
                  </TableCell>
                  <TableCell>
                    <Button
                      size="small"
                      startIcon={<VisibilityRounded />}
                      onClick={() => onView(row.key)}
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
    </Paper>
  );
}
