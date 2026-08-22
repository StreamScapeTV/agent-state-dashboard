"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  isIssueTableName,
  type CurrentIssueDependencyRecord,
  type CurrentIssueRecord,
  type DashboardTableName,
  type IssueTableName,
} from "@/lib/agent-state-read-contract";
import { normalizeSnapshot } from "@/lib/dashboard-model";
import {
  DASHBOARD_TABLES,
  getDashboardSupabaseClient,
  isMissingAdditiveTableError,
  readDashboardSnapshot,
  readDashboardTable,
  subscribeToDashboardChanges,
} from "@/lib/dashboard-supabase";
import {
  activityFromRealtimeChange,
  applyRealtimeChangeToTableStates,
  connectionActivity,
  prependActivity,
  reconciliationActivity,
  realtimeRowKey,
  replayRealtimeChanges,
  type DashboardActivityItem,
  type DashboardRealtimeChange,
} from "@/lib/realtime-dashboard-state";
import {
  applyPartialSnapshot,
  beginTableRead,
  beginTableReads,
  completeTableRead,
  createRequestIds,
  createTableReadStates,
  dashboardFreshness,
  failTableRead,
  hasAnyTableData,
  hasAnyTableLoading,
  latestTableSuccessAt,
  nextRequestIds,
  snapshotInputFromTableStates,
  tableIssues,
  type DashboardFreshness,
  type TableReadStates,
  type TableRequestIds,
} from "@/lib/table-refresh-state";
import type { DashboardSnapshot } from "@/types/dashboard";

export const BOOTSTRAP_SUBSCRIBE_GRACE_MS = 750;
export const RECOVERY_POLL_INTERVAL_MS = 5_000;
export const STALE_AFTER_MS = 75_000;

export type DashboardConnectionState = "connecting" | "live" | "reconnecting" | "recovering";
type ReconcileReason = "bootstrap" | "reconnect" | "recovery";

export interface DashboardTablesState {
  tableStates: TableReadStates;
  snapshot: DashboardSnapshot | null;
  issues: CurrentIssueRecord[];
  issueDependencies: CurrentIssueDependencyRecord[];
  connectionState: DashboardConnectionState;
  freshness: DashboardFreshness;
  lastRefresh: Date | null;
  loading: boolean;
  refreshing: boolean;
  issueTables: DashboardTableName[];
  activities: DashboardActivityItem[];
}

function nextIdsFor(
  sequenceRef: { current: TableRequestIds },
  tables: readonly DashboardTableName[],
): TableRequestIds {
  const next = nextRequestIds(sequenceRef.current, tables);
  sequenceRef.current = next;
  return next;
}

function changeKey(change: DashboardRealtimeChange): string | null {
  return realtimeRowKey(
    change.table,
    change.eventType === "DELETE" ? change.oldRow ?? change.newRow : change.newRow ?? change.oldRow,
  );
}

export function useDashboardTables(nowMs: number): DashboardTablesState {
  const [tableStates, setTableStates] = useState<TableReadStates>(() => createTableReadStates());
  const [connectionState, setConnectionState] = useState<DashboardConnectionState>("connecting");
  const [activities, setActivities] = useState<DashboardActivityItem[]>([]);
  const requestSequenceRef = useRef<TableRequestIds>(createRequestIds());
  const fullControllerRef = useRef<AbortController | null>(null);
  const issueControllersRef = useRef<Partial<Record<IssueTableName, AbortController>>>({});
  const reconcilingRef = useRef(false);
  const bufferedChangesRef = useRef<DashboardRealtimeChange[]>([]);
  const pendingIssueRefreshesRef = useRef<Set<IssueTableName>>(new Set());
  const bootstrapStartedRef = useRef(false);
  const bootstrappedRef = useRef(false);
  const socketLiveRef = useRef(false);

  const appendActivity = useCallback((item: DashboardActivityItem) => {
    setActivities((current) => prependActivity(current, item));
  }, []);

  const refreshIssueTable = useCallback(async (table: IssueTableName): Promise<boolean> => {
    issueControllersRef.current[table]?.abort();
    const controller = new AbortController();
    issueControllersRef.current[table] = controller;
    const requestIds = nextIdsFor(requestSequenceRef, [table]);
    const requestId = requestIds[table];
    setTableStates((current) => beginTableRead(current, table, requestId));

    try {
      const client = getDashboardSupabaseClient();
      const rows = await readDashboardTable(client, table, { signal: controller.signal });
      if (controller.signal.aborted) return false;
      const successAt = new Date().toISOString();
      setTableStates((current) => completeTableRead(current, table, requestId, rows, successAt));
      return true;
    } catch (caught) {
      if (controller.signal.aborted) return false;
      if (isMissingAdditiveTableError(caught, table)) {
        const successAt = new Date().toISOString();
        setTableStates((current) => completeTableRead(current, table, requestId, [], successAt));
        return true;
      }
      const message = caught instanceof Error ? caught.message : `Dashboard read failed for ${table}`;
      setTableStates((current) => failTableRead(current, table, requestId, message));
      return false;
    } finally {
      if (issueControllersRef.current[table] === controller) {
        delete issueControllersRef.current[table];
      }
    }
  }, []);

  const requestFullRefresh = useCallback(async (reason: ReconcileReason): Promise<boolean> => {
    fullControllerRef.current?.abort();
    const controller = new AbortController();
    fullControllerRef.current = controller;
    reconcilingRef.current = true;

    if (reason !== "bootstrap") setConnectionState("recovering");
    const requestIds = nextIdsFor(requestSequenceRef, DASHBOARD_TABLES);
    setTableStates((current) => beginTableReads(current, requestIds));

    try {
      const client = getDashboardSupabaseClient();
      const rawSnapshot = await readDashboardSnapshot(client, { signal: controller.signal });
      if (controller.signal.aborted) return false;

      const replay = bufferedChangesRef.current;
      bufferedChangesRef.current = [];
      setTableStates((current) => replayRealtimeChanges(
        applyPartialSnapshot(current, rawSnapshot, requestIds, rawSnapshot.refreshedAt),
        replay,
      ));
      bootstrappedRef.current = true;

      const complete = Object.keys(rawSnapshot.errors).length === 0;
      if (complete && socketLiveRef.current) setConnectionState("live");
      else setConnectionState(socketLiveRef.current ? "recovering" : "reconnecting");

      appendActivity(reconciliationActivity(
        rawSnapshot.refreshedAt,
        complete
          ? reason === "bootstrap" ? "Bootstrap snapshot converged" : "Agent State reconciled"
          : "Agent State reconciliation is partial",
      ));

      const pendingIssueTables = [...pendingIssueRefreshesRef.current];
      pendingIssueRefreshesRef.current.clear();
      for (const table of pendingIssueTables) void refreshIssueTable(table);
      return complete;
    } catch (caught) {
      if (controller.signal.aborted) return false;
      const message = caught instanceof Error ? caught.message : "Dashboard snapshot could not be loaded.";
      setTableStates((current) => {
        let next = current;
        for (const table of DASHBOARD_TABLES) {
          next = failTableRead(next, table, requestIds[table], message);
        }
        return next;
      });
      setConnectionState(socketLiveRef.current ? "recovering" : "reconnecting");
      return false;
    } finally {
      if (fullControllerRef.current === controller) {
        fullControllerRef.current = null;
        reconcilingRef.current = false;
      }
    }
  }, [appendActivity, refreshIssueTable]);

  const applyLiveChange = useCallback((change: DashboardRealtimeChange) => {
    appendActivity(activityFromRealtimeChange(change));

    if (isIssueTableName(change.table)) {
      if (reconcilingRef.current || !bootstrappedRef.current) {
        pendingIssueRefreshesRef.current.add(change.table);
        return;
      }
      void refreshIssueTable(change.table);
      return;
    }

    if (reconcilingRef.current || !bootstrappedRef.current) {
      bufferedChangesRef.current.push(change);
    }
    if (!bootstrappedRef.current) return;

    if (!changeKey(change)) {
      setConnectionState("recovering");
      if (!reconcilingRef.current) void requestFullRefresh("recovery");
      return;
    }

    setTableStates((current) => applyRealtimeChangeToTableStates(current, change).states);
  }, [appendActivity, refreshIssueTable, requestFullRefresh]);

  useEffect(() => {
    const client = getDashboardSupabaseClient();
    let bootstrapTimer: number | null = null;

    const startBootstrap = (socketReadyAtStart: boolean) => {
      if (bootstrapStartedRef.current) return;
      bootstrapStartedRef.current = true;
      if (bootstrapTimer !== null) {
        window.clearTimeout(bootstrapTimer);
        bootstrapTimer = null;
      }
      appendActivity(connectionActivity(new Date().toISOString(), "Bootstrap snapshot started"));
      void requestFullRefresh("bootstrap").then(() => {
        if (!socketReadyAtStart && socketLiveRef.current) {
          setConnectionState("recovering");
          appendActivity(connectionActivity(new Date().toISOString(), "Realtime joined after bootstrap start; reconciling"));
          void requestFullRefresh("reconnect");
        }
      });
    };

    const unsubscribe = subscribeToDashboardChanges(client, {
      onStatus: (status) => {
        const observedAt = new Date().toISOString();
        if (status === "connecting") {
          if (!bootstrappedRef.current) setConnectionState("connecting");
          return;
        }
        if (status === "reconnecting") {
          socketLiveRef.current = false;
          setConnectionState(bootstrappedRef.current ? "reconnecting" : "connecting");
          appendActivity(connectionActivity(observedAt, "Realtime reconnecting"));
          return;
        }

        const wasLive = socketLiveRef.current;
        socketLiveRef.current = true;
        if (!bootstrapStartedRef.current) {
          appendActivity(connectionActivity(observedAt, "Realtime subscribed; bootstrapping"));
          startBootstrap(true);
          return;
        }
        if (!bootstrappedRef.current) {
          appendActivity(connectionActivity(observedAt, "Realtime subscribed during bootstrap"));
          return;
        }
        if (!wasLive) {
          setConnectionState("recovering");
          appendActivity(connectionActivity(observedAt, "Realtime reconnected; reconciling"));
          void requestFullRefresh("reconnect");
          return;
        }
        setConnectionState("live");
      },
      onChange: applyLiveChange,
    });

    bootstrapTimer = window.setTimeout(() => startBootstrap(false), BOOTSTRAP_SUBSCRIBE_GRACE_MS);

    return () => {
      unsubscribe();
      if (bootstrapTimer !== null) window.clearTimeout(bootstrapTimer);
      socketLiveRef.current = false;
      fullControllerRef.current?.abort();
      fullControllerRef.current = null;
      for (const controller of Object.values(issueControllersRef.current)) controller?.abort();
      issueControllersRef.current = {};
      reconcilingRef.current = false;
      bufferedChangesRef.current = [];
      pendingIssueRefreshesRef.current.clear();
      bootstrapStartedRef.current = false;
      bootstrappedRef.current = false;
    };
  }, [appendActivity, applyLiveChange, requestFullRefresh]);

  useEffect(() => {
    if (!bootstrappedRef.current) return;
    if (connectionState !== "reconnecting" && connectionState !== "recovering") return;
    const poll = window.setInterval(() => {
      if (!reconcilingRef.current) void requestFullRefresh("recovery");
    }, RECOVERY_POLL_INTERVAL_MS);
    return () => window.clearInterval(poll);
  }, [connectionState, requestFullRefresh]);

  const anyData = hasAnyTableData(tableStates);
  const anyLoading = hasAnyTableLoading(tableStates);
  const successAt = latestTableSuccessAt(tableStates);
  const issueTables = tableIssues(tableStates);
  const fallbackFreshness = dashboardFreshness(tableStates, nowMs, STALE_AFTER_MS);
  const freshness: DashboardFreshness = connectionState === "live" && issueTables.length === 0
    ? "fresh"
    : fallbackFreshness;
  const snapshot = useMemo(() => {
    if (!anyData) return null;
    return normalizeSnapshot({
      ...snapshotInputFromTableStates(tableStates),
      refreshed_at: successAt,
    });
  }, [anyData, tableStates, successAt]);

  const issues = tableStates.current_issues.hasData
    ? tableStates.current_issues.rows as CurrentIssueRecord[]
    : [];
  const issueDependencies = tableStates.current_issue_dependencies.hasData
    ? tableStates.current_issue_dependencies.rows as CurrentIssueDependencyRecord[]
    : [];

  return {
    tableStates,
    snapshot,
    issues,
    issueDependencies,
    connectionState,
    freshness,
    lastRefresh: successAt ? new Date(successAt) : null,
    loading: !anyData && fallbackFreshness === "loading",
    refreshing: anyData && anyLoading,
    issueTables,
    activities,
  };
}
