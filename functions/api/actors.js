import { verifyCloudflareAccess } from "../_lib/access.js";
import {
  ACTOR_BATCH_COUNT,
  ACTOR_BATCH_SIZE,
  ALL_IDENTITIES,
  AgentStateReadError,
  readActorBatch,
} from "../_lib/agent-state.js";
import { isConfiguredProject } from "../_lib/config.js";

function json(body, status = 200) {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store, max-age=0",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export async function onRequestGet(context) {
  const access = await verifyCloudflareAccess(context.request.headers, context.env);
  if (!access.ok) return json({ error: access.reason }, 403);

  const url = new URL(context.request.url);
  const project = url.searchParams.get("project") ?? "";
  const batch = Number(url.searchParams.get("batch"));
  if (!isConfiguredProject(project)) return json({ error: "Unknown project" }, 404);
  if (!Number.isInteger(batch) || batch < 0 || batch >= ACTOR_BATCH_COUNT) {
    return json({ error: "Invalid actor batch" }, 400);
  }

  try {
    const actors = await readActorBatch(context.env, project, batch);
    const start = batch * ACTOR_BATCH_SIZE;
    return json({
      project,
      batch,
      actors,
      scannedIdentities: ALL_IDENTITIES.slice(start, start + ACTOR_BATCH_SIZE).length,
    });
  } catch (error) {
    const message = error instanceof AgentStateReadError ? error.message : "Agent State read failed.";
    return json({ error: message }, 502);
  }
}
