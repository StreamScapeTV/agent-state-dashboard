import "server-only";

import { createRemoteJWKSet, jwtVerify } from "jose";
import { getAccessConfig } from "@/lib/runtime-env";
import type { ViewerIdentity } from "@/types/dashboard";

interface HeaderReader {
  get(name: string): string | null;
}

type AccessResult =
  | { ok: true; viewer: ViewerIdentity }
  | { ok: false; reason: string };

export async function verifyCloudflareAccess(headers: HeaderReader): Promise<AccessResult> {
  const assertion = headers.get("cf-access-jwt-assertion");
  if (!assertion) {
    return { ok: false, reason: "Sign in through Cloudflare Access to continue." };
  }

  try {
    const { teamDomain, policyAudience } = getAccessConfig();
    const issuer = new URL(teamDomain).origin;
    const jwks = createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`));
    const { payload } = await jwtVerify(assertion, jwks, {
      issuer,
      audience: policyAudience,
    });

    const subject = typeof payload.sub === "string" ? payload.sub : "access-user";
    const email = typeof payload.email === "string" ? payload.email : subject;
    return { ok: true, viewer: { email, subject } };
  } catch {
    return { ok: false, reason: "Cloudflare Access could not verify this request." };
  }
}
