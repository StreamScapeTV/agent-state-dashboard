import { createClient } from "@supabase/supabase-js";

export const PROJECTS = [
  "agent-state-supabase",
  "ci-workflows",
  "iptv-backend",
  "iptv-android",
  "iptv-apple",
  "StreamScapeWeb",
  "streamscape-media",
  "flux",
];

const SUPABASE_URL = "https://fvbaxyklaclgdzyhybbr.supabase.co";

export function requiredEnv(env, name) {
  const value = env?.[name];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Missing required Pages secret: ${name}`);
  }
  return value.trim();
}

export function isConfiguredProject(project) {
  return PROJECTS.includes(project);
}

export function createAgentStateClient(env) {
  const secretKey = requiredEnv(env, "AGENT_STATE_SUPABASE_SECRET_KEY");
  return createClient(SUPABASE_URL, secretKey, {
    db: { schema: "agent_api" },
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: {
      headers: {
        "X-Client-Info": "streamscapetv-agent-state-dashboard-pages",
      },
    },
  });
}
