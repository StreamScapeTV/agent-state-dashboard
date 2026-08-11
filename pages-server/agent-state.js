import { createAgentStateClient } from "./config.js";

export const ACTOR_BATCH_SIZE = 28;
export const ALL_IDENTITIES = [
  "Orchestrator",
  ...Array.from({ length: 100 }, (_, index) => `Agent ${index + 1}`),
  ...Array.from({ length: 100 }, (_, index) => `Codex ${index + 1}`),
  "Dependabot",
];
export const ACTOR_BATCH_COUNT = Math.ceil(ALL_IDENTITIES.length / ACTOR_BATCH_SIZE);

export class AgentStateReadError extends Error {
  constructor(message) {
    super(message);
    this.name = "AgentStateReadError";
  }
}

function readError(error) {
  const code = error?.code ?? "";
  const message = error?.message?.toLowerCase() ?? "";
  if (code === "PGRST106" || message.includes("schema")) {
    return new AgentStateReadError(
      "The agent_api schema is not available through the configured Supabase Data API.",
    );
  }
  if (code === "42501" || message.includes("permission denied")) {
    return new AgentStateReadError("The configured Supabase credential cannot execute Agent State read RPCs.");
  }
  return new AgentStateReadError("Agent State is temporarily unavailable.");
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toJson(value) {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (Array.isArray(value)) return value.map(toJson);
  if (isRecord(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, toJson(child)]));
  }
  return String(value);
}

function toJsonArray(value) {
  return Array.isArray(value) ? value.map(toJson) : [];
}

function toStringArray(value) {
  return Array.isArray(value) ? value.filter((item) => typeof item === "string") : [];
}

function deriveStatus(state, work, resources, coordination) {
  if (isRecord(state)) {
    for (const key of ["status", "lifecycle", "phase"]) {
      const value = state[key];
      if (typeof value === "string" && value.trim()) return value;
    }
  }
  if (work.length > 0) return "working";
  if (coordination.length > 0) return "attention";
  if (resources.length > 0) return "active";
  return "assigned";
}

function hasState(state) {
  return isRecord(state) ? Object.keys(state).length > 0 : state !== null;
}

function normalizeActor(identity, raw) {
  if (!isRecord(raw)) return null;

  const prompt = raw.prompt;
  const promptAssigned = typeof prompt === "string";
  const promptLength = promptAssigned ? prompt.length : 0;
  const state = toJson(raw.state ?? {});
  const work = toJsonArray(raw.work);
  const resources = toStringArray(raw.resources);
  const coordination = toJsonArray(raw.coordination);

  if (!promptAssigned && !hasState(state) && work.length === 0 && resources.length === 0 && coordination.length === 0) {
    return null;
  }

  return {
    identity,
    status: deriveStatus(state, work, resources, coordination),
    promptAssigned,
    promptLength,
    state,
    work,
    resources,
    coordination,
  };
}

export async function readOverview(env, project) {
  const client = createAgentStateClient(env);
  const [projectResult, storageResult] = await Promise.all([
    client.rpc("get_project_state", { p_project_key: project }),
    client.rpc("get_storage_budget"),
  ]);

  if (projectResult.error) throw readError(projectResult.error);
  if (storageResult.error) throw readError(storageResult.error);

  return {
    project,
    projectState: toJson(projectResult.data ?? {}),
    storageBudget: toJson(storageResult.data ?? {}),
    actorBatchCount: ACTOR_BATCH_COUNT,
    actorCapacity: ALL_IDENTITIES.length,
    scannedAt: new Date().toISOString(),
  };
}

export async function readActorBatch(env, project, batch) {
  if (!Number.isInteger(batch) || batch < 0 || batch >= ACTOR_BATCH_COUNT) {
    throw new AgentStateReadError("Invalid actor batch.");
  }

  const start = batch * ACTOR_BATCH_SIZE;
  const identities = ALL_IDENTITIES.slice(start, start + ACTOR_BATCH_SIZE);
  const client = createAgentStateClient(env);
  const results = await Promise.all(
    identities.map(async (identity) => {
      const result = await client.rpc("get_agent_state", {
        p_project_key: project,
        p_agent: identity,
      });
      if (result.error) throw readError(result.error);
      return normalizeActor(identity, result.data);
    }),
  );

  return results.filter((actor) => actor !== null);
}
