import { verifyCloudflareAccess } from "../../pages-server/access.js";
import { AgentStateReadError, readOverview } from "../../pages-server/agent-state.js";
import { isConfiguredProject } from "../../pages-server/config.js";

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
  if (!isConfiguredProject(project)) return json({ error: "Unknown project" }, 404);

  try {
    return json(await readOverview(context.env, project));
  } catch (error) {
    const message = error instanceof AgentStateReadError ? error.message : "Agent State read failed.";
    return json({ error: message }, 502);
  }
}
