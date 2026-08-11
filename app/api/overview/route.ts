import { verifyCloudflareAccess } from "@/lib/access";
import { AgentStateReadError, readOverview } from "@/lib/agent-state";
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
  const projects = getConfiguredProjects();
  if (!projects.includes(project)) return json({ error: "Unknown project" }, 404);

  try {
    return json(await readOverview(project));
  } catch (error) {
    const message = error instanceof AgentStateReadError ? error.message : "Agent State read failed.";
    return json({ error: message }, 502);
  }
}
