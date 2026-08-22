import {
  DASHBOARD_TABLE_NAMES,
  type DashboardTableName,
} from "@/lib/agent-state-read-contract";
import { createSupabaseDashboardReadSource } from "@/lib/dashboard-supabase";
import type { DashboardRealtimeChange } from "@/lib/realtime-dashboard-state";

export const DASHBOARD_READ_TABLES: readonly DashboardTableName[] = DASHBOARD_TABLE_NAMES;

export type DashboardReadStatus = "connecting" | "live" | "reconnecting";

export interface DashboardReadOptions {
  signal?: AbortSignal;
}

export interface DashboardTableReadOptions extends DashboardReadOptions {
  pageSize?: number;
}

export interface DashboardRawSnapshot {
  tables: Partial<Record<DashboardTableName, unknown[]>>;
  errors: Partial<Record<DashboardTableName, string>>;
  refreshedAt: string;
}

export interface DashboardRealtimeHandlers {
  onStatus: (status: DashboardReadStatus) => void;
  onChange: (change: DashboardRealtimeChange) => void;
}

export interface DashboardReadSource {
  readonly tables: readonly DashboardTableName[];
  readSnapshot(options?: DashboardReadOptions): Promise<DashboardRawSnapshot>;
  readTable(
    table: DashboardTableName,
    options?: DashboardTableReadOptions,
  ): Promise<unknown[]>;
  subscribe(handlers: DashboardRealtimeHandlers): () => void;
}

let productionReadSource: DashboardReadSource | null = null;

export function getDashboardReadSource(): DashboardReadSource {
  if (!productionReadSource) {
    productionReadSource = createSupabaseDashboardReadSource();
  }
  return productionReadSource;
}
