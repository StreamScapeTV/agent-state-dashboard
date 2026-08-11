export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export interface ViewerIdentity {
  email: string;
  subject: string;
}

export interface ActorSnapshot {
  identity: string;
  status: string;
  promptAssigned: boolean;
  promptLength: number;
  state: JsonValue;
  work: JsonValue[];
  resources: string[];
  coordination: JsonValue[];
}

export interface OverviewPayload {
  project: string;
  projectState: JsonValue;
  storageBudget: JsonValue;
  actorBatchCount: number;
  actorCapacity: number;
  scannedAt: string;
  viewer: ViewerIdentity;
}

export interface ActorsBatchPayload {
  project: string;
  batch: number;
  actors: ActorSnapshot[];
  scannedIdentities: number;
}
