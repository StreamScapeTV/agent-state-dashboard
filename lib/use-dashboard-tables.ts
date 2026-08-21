"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { normalizeSnapshot, type DashboardLiveState } from "@/lib/dashboard-model";
import {
  DASHBOARD_TABLES,
  getDashboardSupabaseClient,
  readDashboardSnapshot,
  readDashboardTable,
  subscribeToDashboardChanges,
} from "@/lib/dashboard-supabase";
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
import type { DashboardSnapshot, RawTableName } from "@/types/dashboard";

export const POLL_INTERVAL_MS = 30_000;
export const INVALIDATION_DEBOUNCE_MS = 150;
export const STALE_AFTER_MS = 75_000;

export interface DashboardTablesState {
  tableStates: TableReadStates;
  snapshot: DashboardSnapshot | null;
  connectionState: DashboardLiveState;
  freshness: DashboardFreshness;
  lastRefresh: Date | null;
  loading: boolean;
  refreshing: boolean;
  issueTables: RawTableName[];
  requestFullRefresh: () => Promise<void>;
}

function nextIdsFor(
  sequenceRef: { current: TableRequestIds },
  tables: readonly RawTableName[],
): TableRequestIds {
  const next = nextRequestIds(sequenceRef.current, tables);
  sequenceRef.current = next;
  return next;
}

export function useDashboardTables(nowMs: number): DashboardTablesState {
  const [tableStates, setTableStates] = useState<TableReadStates>(() => createTableReadStates());
  const [connectionState, setConnectionState] = useState<DashboardLiveState>("connecting");
  const requestSequenceRef = useRef<TableRequestIds>(createRequestIds());
  const fullControllerRef = useRef<AbortController | null>(null);
  const tableControllersRef = useRef<Partial<Record<RawTableName, AbortController>>>({});
  const pendingInvalidationsRef = useRef<Set<RawTableName>>(new Set());
  const invalidationTimerRef = useRef<number | null>(null);

  const requestTableRefresh = useCallback(async (table: RawTableName) => {
    const client = getDashboardSupabaseClient();
    tableControllersRef.current[table]?.abort();
    const controller = new AbortController();
    tableControllersRef.current[table] = controller;

    const requestIds = nextIdsFor(requestSequenceRef, [table]);
    const requestId = requestIds[table];
    setTableStates((current) => beginTableRead(current, table, requestId));

    try {
      const rows = await readDashboardTable(client, table, { signal: controller.signal });
      if (controller.signal.aborted) return;
      const successAt = new Date().toISOString();
      setTableStates((current) => completeTableRead(current, table, requestId, rows, successAt));
    } catch (caught) {
      if (controller.signal.aborted) return;
      const message = caught instanceof Error ? caught.message : `Dashboard read failed for ${table}`;
      setTableStates((current) => failTableRead(current, table, requestId, message));
    } finally {
      if (tableControllersRef.current[table] === controller) {
        delete tableControllersRef.current[table];
      }
    }
  }, []);

  const requestFullRefresh = useCallback(async () => {
    fullControllerRef.current?.abort();
    for (const table of DASHBOARD_TABLES) {
      tableControllersRef.current[table]?.abort();
      delete tableControllersRef.current[table];
    }

    const controller = new AbortController();
    fullControllerRef.current = controller;
    const requestIds = nextIdsFor(requestSequenceRef, DASHBOARD_TABLES);
    setTableStates((current) => beginTableReads(current, requestIds));

    try {
      const client = getDashboardSupabaseClient();
      const rawSnapshot = await readDashboardSnapshot(client, { signal: controller.signal });
      if (controller.signal.aborted) return;
      setTableStates((current) => applyPartialSnapshot(
        current,
        rawSnapshot,
        requestIds,
        rawSnapshot.refreshedAt,
      ));
    } catch (caught) {
      if (controller.signal.aborted) return;
      const message = caught instanceof Error ? caught.message : "Dashboard snapshot could not be loaded.";
      setTableStates((current) => {
        let next = current;
        for (const table of DASHBOARD_TABLES) {
          next = failTableRead(next, table, requestIds[table], message);
        }
        return next;
      });
    } finally {
      if (fullControllerRef.current === controller) fullControllerRef.current = null;
    }
  }, []);

  const queueTableRefresh = useCallback((table: RawTableName) => {
    pendingInvalidationsRef.current.add(table);
    if (invalidationTimerRef.current !== null) return;

    invalidationTimerRef.current = window.setTimeout(() => {
      const pending = [...pendingInvalidationsRef.current];
      pendingInvalidationsRef.current.clear();
      invalidationTimerRef.current = null;
      for (const pendingTable of pending) void requestTableRefresh(pendingTable);
    }, INVALIDATION_DEBOUNCE_MS);
  }, [requestTableRefresh]);

  useEffect(() => {
    void requestFullRefresh();
    const client = getDashboardSupabaseClient();
    const unsubscribe = subscribeToDashboardChanges(client, {
      onStatus: (status) => setConnectionState(status),
      onInvalidate: (table) => {
        setConnectionState("live");
        queueTableRefresh(table);
      },
    });
    const poll = window.setInterval(() => {
      void requestFullRefresh();
    }, POLL_INTERVAL_MS);

    return () => {
      unsubscribe();
      window.clearInterval(poll);
      if (invalidationTimerRef.current !== null) {
        window.clearTimeout(invalidationTimerRef.current);
        invalidationTimerRef.current = null;
      }
      pendingInvalidationsRef.current.clear();
      fullControllerRef.current?.abort();
      fullControllerRef.current = null;
      for (const controller of Object.values(tableControllersRef.current)) controller?.abort();
      tableControllersRef.current = {};
    };
  }, [queueTableRefresh, requestFullRefresh]);

  const anyData = hasAnyTableData(tableStates);
  const anyLoading = hasAnyTableLoading(tableStates);
  const successAt = latestTableSuccessAt(tableStates);
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
    freshness: dashboardFreshness(tableStates, nowMs, STALE_AFTER_MS),
    lastRefresh: successAt ? new Date(successAt) : null,
    loading: !anyData && anyLoading,
    refreshing: anyData && anyLoading,
    issueTables: tableIssues(tableStates),
    requestFullRefresh,
  };
}
