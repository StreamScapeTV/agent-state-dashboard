"use client";

import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TablePagination,
  TableRow,
  Tabs,
  Tooltip,
  Typography,
} from "@mui/material";
import { useEffect, useMemo, useState } from "react";
import type { RawTableName } from "@/types/dashboard";
import { RAW_TABLE_NAMES } from "@/types/dashboard";

interface DashboardClientProps {
  legacyProjects: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readJson(response: Response): Promise<unknown> {
  return response.json();
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
  return JSON.stringify(value) ?? String(value);
}

function JsonPanel({ value }: { value: unknown }) {
  return <Box component="pre">{JSON.stringify(value, null, 2) ?? String(value)}</Box>;
}

function RawTablesDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [table, setTable] = useState<RawTableName>("current_projects");
  const [rows, setRows] = useState<unknown[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(50);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    setRows([]);
    setSelectedIndex(0);
    setPage(0);
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

  const visibleRows = useMemo(
    () => rows.slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage),
    [rows, page, rowsPerPage],
  );

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xl" fullWidth>
      <DialogTitle>Raw current-table explorer</DialogTitle>
      <DialogContent dividers sx={{ p: 0 }}>
        <Tabs value={table} onChange={(_, value: RawTableName) => setTable(value)} variant="scrollable" scrollButtons="auto">
          {RAW_TABLE_NAMES.map((name) => <Tab key={name} value={name} label={name.replace("current_", "")} />)}
        </Tabs>
        {error && <Alert severity="error">{error}</Alert>}
        {loading ? <CircularProgress /> : (
          <Box>
            <TableContainer>
              <Table size="small" stickyHeader>
                <TableHead><TableRow>{columns.map((column) => <TableCell key={column}>{column}</TableCell>)}</TableRow></TableHead>
                <TableBody>
                  {visibleRows.map((row, pageIndex) => {
                    const index = page * rowsPerPage + pageIndex;
                    return (
                      <TableRow
                        key={index}
                        hover
                        selected={selectedIndex === index}
                        tabIndex={0}
                        aria-selected={selectedIndex === index}
                        onClick={() => setSelectedIndex(index)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            setSelectedIndex(index);
                          }
                        }}
                      >
                        {columns.map((column) => {
                          const value = isRecord(row) ? row[column] : row;
                          const text = cellText(value);
                          return <TableCell key={column}><Tooltip title={text}><Typography variant="caption" noWrap>{text}</Typography></Tooltip></TableCell>;
                        })}
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
                const nextRowsPerPage = Number.parseInt(event.target.value, 10);
                setRowsPerPage(nextRowsPerPage);
                setPage(0);
                setSelectedIndex(0);
              }}
            />
            <JsonPanel value={rows[selectedIndex] ?? {}} />
          </Box>
        )}
      </DialogContent>
      <DialogActions><Button onClick={onClose}>Close</Button></DialogActions>
    </Dialog>
  );
}

export function DashboardClient({ legacyProjects }: DashboardClientProps) {
  return <div data-project-count={legacyProjects.length}><RawTablesDialog open={false} onClose={() => undefined} /></div>;
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
