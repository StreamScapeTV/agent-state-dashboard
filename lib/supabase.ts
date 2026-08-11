import "server-only";

import { createClient } from "@supabase/supabase-js";
import { getSupabaseConfig } from "@/lib/runtime-env";

export function createAgentStateClient() {
  const { url, secretKey } = getSupabaseConfig();
  return createClient(url, secretKey, {
    db: { schema: "agent_api" },
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: {
      headers: {
        "X-Client-Info": "streamscapetv-agent-state-dashboard",
      },
    },
  });
}
