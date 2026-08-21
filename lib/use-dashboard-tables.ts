"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { normalizeSnapshot } from "@/lib/dashboard-model";
import {
  DASHBOARD_TABLES,
  getDashboardSupabaseClient,
  readDashboardSnapshot,
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
  beginTableReads,
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
import type { DashboardSnapshot, RawTableName } from "@/types/dashboard";

export const BOOTSTRAP_SUBSCRIBE_GRACE_MS = 750;
export const RECOVERY_POLL_INTERVAL_MS = 5_000;
export const STALE_AFTER_MS = 75_000;

export type DashboardConnectionState = "connecting" | "live" | "reconnecting" | "recovering";
type ReconcileReason = "bootstrap" | "reconnect" | "recovery";

export interface DashboardTablesState {
  tableStates: TableReadStates;
  snapshot: DashboardSnapshot | null;
  connectionState: DashboardConnectionState;
  freshness: DashboardFreshness;
  lastRefresh: Date | null;
  loading: boolean;
  refreshing: boolean;
  issueTables: RawTableName[];
  activities: DashboardActivityItem[];
}

function nextIdsFor(
  sequenceRef: { current: TableRequestIds },
  tables: readonly RawTableName[],
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
  const reconcilingRef = useRef(false);
  const bufferedChangesRef = useRef<DashboardRealtimeChange[]>([]);
  const bootstrapStartedRef = useRef(false);
  const bootstrappedRef = useRef(false);
  const socketLiveRef = useRef(false);

  const appendActivity = useCallback((item: DashboardActivityItem) => {
    setActivities((current) => prependActivity(current, item));
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
      if (reason !== "bootstrap") setConnectionState(socketLiveRef.current ? "recovering" : "reconnecting");
      return false;
    } finally {
      if (fullControllerRef.current === controller) {
        fullControllerRef.current = null;
        reconcilingRef.current = false;
      }
    }
  }, [appendActivity]);

  const applyLiveChange = useCallback((change: DashboardRealtimeChange) => {
    appendActivity(activityFromRealtimeChange(change));

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
  }, [appendActivity, requestFullRefresh]);

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
      reconcilingRef.current = false;
      bufferedChangesRef.current = [];
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

  return {
    tableStates,
    snapshot,
    connectionState,
    freshness,
    lastRefresh: successAt ? new Date(successAt) : null,
    loading: !anyData && fallbackFreshness === "loading",
    refreshing: anyData && anyLoading,
    issueTables,
    activities,
  };
}
