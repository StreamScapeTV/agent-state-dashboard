import { verifyCloudflareAccess } from "@/lib/access";
import {
  ACTOR_BATCH_COUNT,
  ACTOR_BATCH_SIZE,
  ALL_IDENTITIES,
  AgentStateReadError,
  readActorBatch,
} from "@/lib/agent-state";
import { getConfiguredProjects } from "@/lib/runtime-env";

export const dynamic = "force-dynamic";

function json(body: unknown, status = 200) {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store, max-age=0",
    },
  });
}

export async function GET(request: Request) {
  const access = await verifyCloudflareAccess(request.headers);
  if (!access.ok) return json({ error: "Unauthorized" }, 403);

  const url = new URL(request.url);
  const project = url.searchParams.get("project") ?? "";
  const batch = Number(url.searchParams.get("batch"));
  if (!getConfiguredProjects().includes(project)) return json({ error: "Unknown project" }, 404);
  if (!Number.isInteger(batch) || batch < 0 || batch >= ACTOR_BATCH_COUNT) {
    return json({ error: "Invalid actor batch" }, 400);
  }

  try {
    const actors = await readActorBatch(project, batch);
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
