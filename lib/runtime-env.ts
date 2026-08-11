import "server-only";

import { getCloudflareContext } from "@opennextjs/cloudflare";

const PROJECT_KEY = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

function required(name: string, value: string | undefined): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Missing required runtime binding: ${name}`);
  }
  return value;
}

function env(): CloudflareEnv {
  return getCloudflareContext().env;
}

export function getAccessConfig() {
  const bindings = env();
  return {
    teamDomain: required("TEAM_DOMAIN", bindings.TEAM_DOMAIN).replace(/\/$/, ""),
    policyAudience: required("POLICY_AUD", bindings.POLICY_AUD),
  };
}

export function getSupabaseConfig() {
  const bindings = env();
  return {
    url: required("AGENT_STATE_SUPABASE_URL", bindings.AGENT_STATE_SUPABASE_URL),
    secretKey: required("AGENT_STATE_SUPABASE_SECRET_KEY", bindings.AGENT_STATE_SUPABASE_SECRET_KEY),
  };
}

export function getConfiguredProjects(): string[] {
  const configured = required("AGENT_STATE_PROJECTS", env().AGENT_STATE_PROJECTS)
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  const projects = Array.from(new Set(configured));
  if (projects.length === 0 || projects.some((project) => !PROJECT_KEY.test(project))) {
    throw new Error("AGENT_STATE_PROJECTS contains an invalid project key");
  }
  return projects;
}
