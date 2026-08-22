"use client";

import { ExpandMoreRounded, FilterAltOffRounded } from "@mui/icons-material";
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  Chip,
  FormControl,
  IconButton,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  Typography,
} from "@mui/material";
import { useEffect, useMemo, useState } from "react";
import {
  activityIdentityOptions,
  filterActivityLog,
  type ActivityEventFilter,
  type ActivityKindFilter,
  type ActivityTableFilter,
} from "@/lib/activity-log";
import { DASHBOARD_TABLE_NAMES } from "@/lib/agent-state-read-contract";
import type { DashboardActivityItem } from "@/lib/realtime-dashboard-state";

interface ActivityLogViewProps {
  activities: readonly DashboardActivityItem[];
  projectScope: string | null;
}

function displayTime(value: string): string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
}

function tableLabel(value: ActivityTableFilter): string {
  return value === "all" ? "All tables" : value.replace("current_", "");
}

function kindLabel(value: ActivityKindFilter): string {
  if (value === "all") return "All event kinds";
  if (value === "reconcile") return "Reconciliation";
  return value[0].toUpperCase() + value.slice(1);
}

function changeLabel(value: ActivityEventFilter): string {
  if (value === "all") return "All change types";
  return value[0] + value.slice(1).toLowerCase();
}

export function ActivityLogView({ activities, projectScope }: ActivityLogViewProps) {
  const [identity, setIdentity] = useState("all");
  const [kind, setKind] = useState<ActivityKindFilter>("all");
  const [table, setTable] = useState<ActivityTableFilter>("all");
  const [eventType, setEventType] = useState<ActivityEventFilter>("all");

  const identities = useMemo(
    () => activityIdentityOptions(activities, projectScope),
    [activities, projectScope],
  );

  useEffect(() => {
    if (identity !== "all" && !identities.includes(identity)) setIdentity("all");
  }, [identities, identity]);

  const visible = useMemo(
    () => filterActivityLog(activities, {
      projectKey: projectScope,
      identity,
      kind,
      table,
      eventType,
    }),
    [activities, projectScope, identity, kind, table, eventType],
  );

  const clearFilters = () => {
    setIdentity("all");
    setKind("all");
    setTable("all");
    setEventType("all");
  };

  return (
    <Box sx={{ p: { xs: 1.25, sm: 1.5 } }}>
      <Stack spacing={1.5}>
        <Stack
          direction={{ xs: "column", md: "row" }}
          sx={{ gap: 1, justifyContent: "space-between", alignItems: { md: "center" } }}
        >
          <Box>
            <Stack direction="row" sx={{ gap: 0.75, alignItems: "center", flexWrap: "wrap" }}>
              <Typography variant="h6">Logs / Activity</Typography>
              <Chip size="small" label={`${visible.length}/${activities.length}`} />
              <Chip
                size="small"
                variant="outlined"
                label={projectScope ? `Project · ${projectScope}` : "All projects"}
              />
            </Stack>
            <Typography variant="caption" color="text.secondary">
              Newest first · only events observed during this browser session.
            </Typography>
          </Box>
        </Stack>

        <Alert severity="info" variant="outlined" sx={{ "& .MuiAlert-message": { minWidth: 0 } }}>
          Session-only live activity. Realtime changes, connection transitions and reconciliation observed after this page opened are shown here. Reloading clears this view; snapshots are not backfilled or presented as historical audit events.
        </Alert>

        <Stack direction={{ xs: "column", lg: "row" }} sx={{ gap: 1, alignItems: { lg: "center" } }}>
          <FormControl size="small" sx={{ minWidth: { lg: 190 }, width: { xs: "100%", lg: "auto" } }}>
            <InputLabel>Identity</InputLabel>
            <Select value={identity} label="Identity" onChange={(event) => setIdentity(String(event.target.value))}>
              <MenuItem value="all">All identities</MenuItem>
              {identities.map((value) => <MenuItem key={value} value={value}>{value}</MenuItem>)}
            </Select>
          </FormControl>
          <FormControl size="small" sx={{ minWidth: { lg: 170 }, width: { xs: "100%", lg: "auto" } }}>
            <InputLabel>Event kind</InputLabel>
            <Select
              value={kind}
              label="Event kind"
              onChange={(event) => setKind(event.target.value as ActivityKindFilter)}
            >
              <MenuItem value="all">All event kinds</MenuItem>
              <MenuItem value="change">Change</MenuItem>
              <MenuItem value="connection">Connection</MenuItem>
              <MenuItem value="reconcile">Reconciliation</MenuItem>
            </Select>
          </FormControl>
          <FormControl size="small" sx={{ minWidth: { lg: 180 }, width: { xs: "100%", lg: "auto" } }}>
            <InputLabel>Table</InputLabel>
            <Select
              value={table}
              label="Table"
              onChange={(event) => setTable(event.target.value as ActivityTableFilter)}
            >
              <MenuItem value="all">All tables</MenuItem>
              {DASHBOARD_TABLE_NAMES.map((value) => (
                <MenuItem key={value} value={value}>{value.replace("current_", "")}</MenuItem>
              ))}
            </Select>
          </FormControl>
          <FormControl size="small" sx={{ minWidth: { lg: 180 }, width: { xs: "100%", lg: "auto" } }}>
            <InputLabel>Change type</InputLabel>
            <Select
              value={eventType}
              label="Change type"
              onChange={(event) => setEventType(event.target.value as ActivityEventFilter)}
            >
              <MenuItem value="all">All change types</MenuItem>
              <MenuItem value="INSERT">Insert</MenuItem>
              <MenuItem value="UPDATE">Update</MenuItem>
              <MenuItem value="DELETE">Delete</MenuItem>
            </Select>
          </FormControl>
          <IconButton
            aria-label="Clear activity filters"
            onClick={clearFilters}
            sx={{ alignSelf: { xs: "flex-end", lg: "center" } }}
          >
            <FilterAltOffRounded />
          </IconButton>
        </Stack>

        {visible.length === 0 ? (
          <Typography color="text.secondary">
            No session activity matches these filters.
          </Typography>
        ) : (
          <Box sx={{ borderBottom: "1px solid", borderColor: "divider" }}>
            {visible.map((item) => {
              const identityLabel = item.identities?.join(" · ") ?? null;
              return (
                <Accordion
                  key={item.id}
                  disableGutters
                  elevation={0}
                  sx={{ borderTop: "1px solid", borderColor: "divider", "&:before": { display: "none" } }}
                >
                  <AccordionSummary expandIcon={<ExpandMoreRounded />} sx={{ px: { xs: 1, sm: 2 } }}>
                    <Box
                      sx={{
                        width: "100%",
                        display: "grid",
                        gridTemplateColumns: {
                          xs: "minmax(0, 1fr)",
                          sm: "minmax(150px,.7fr) minmax(0,1.3fr)",
                          lg: "minmax(160px,.8fr) minmax(260px,2fr) minmax(150px,.8fr) minmax(180px,1fr)",
                        },
                        gap: { xs: 0.45, sm: 0.75, lg: 1.25 },
                        alignItems: "center",
                        pr: { xs: 0.5, sm: 1 },
                      }}
                    >
                      <Typography variant="caption" color="text.secondary" sx={{ overflowWrap: "anywhere" }}>
                        {displayTime(item.observedAt)}
                      </Typography>
                      <Typography
                        sx={{
                          display: "-webkit-box",
                          WebkitLineClamp: 2,
                          WebkitBoxOrient: "vertical",
                          overflow: "hidden",
                          overflowWrap: "anywhere",
                        }}
                      >
                        {item.summary}
                      </Typography>
                      <Stack direction="row" sx={{ gap: 0.5, flexWrap: "wrap" }}>
                        <Chip size="small" label={kindLabel(item.kind)} variant="outlined" />
                        {item.eventType ? <Chip size="small" label={changeLabel(item.eventType)} variant="outlined" /> : null}
                      </Stack>
                      <Box sx={{ minWidth: 0 }}>
                        <Typography variant="caption" sx={{ display: "block", whiteSpace: "normal", overflowWrap: "anywhere" }}>
                          {item.projectKey ? `Project: ${item.projectKey}` : "Global session event"}
                        </Typography>
                        {identityLabel ? (
                          <Typography variant="caption" color="text.secondary" sx={{ display: "block", whiteSpace: "normal", overflowWrap: "anywhere" }}>
                            {identityLabel}
                          </Typography>
                        ) : null}
                      </Box>
                    </Box>
                  </AccordionSummary>
                  <AccordionDetails sx={{ pt: 0, px: { xs: 1, sm: 2 }, pb: 1.5 }}>
                    <Stack direction="row" sx={{ gap: 0.75, flexWrap: "wrap" }}>
                      <Chip size="small" label={`Kind · ${kindLabel(item.kind)}`} />
                      <Chip size="small" label={item.projectKey ? `Project · ${item.projectKey}` : "Project · Global"} />
                      {item.table ? <Chip size="small" label={`Table · ${tableLabel(item.table)}`} /> : null}
                      {item.eventType ? <Chip size="small" label={`Change · ${changeLabel(item.eventType)}`} /> : null}
                      {(item.identities ?? []).map((value) => (
                        <Chip key={value} size="small" label={`Actor · ${value}`} />
                      ))}
                    </Stack>
                    {item.rowKey ? (
                      <Box sx={{ mt: 1 }}>
                        <Typography variant="overline">Current row key</Typography>
                        <Typography variant="body2" sx={{ fontFamily: "monospace", overflowWrap: "anywhere" }}>
                          {item.rowKey}
                        </Typography>
                      </Box>
                    ) : null}
                    <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 1 }}>
                      Observed in this browser session. No raw row payload or durable event history is retained by this view.
                    </Typography>
                  </AccordionDetails>
                </Accordion>
              );
            })}
          </Box>
        )}
      </Stack>
    </Box>
  );
}
