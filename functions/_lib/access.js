import { createRemoteJWKSet, jwtVerify } from "jose";
import { requiredEnv } from "./config.js";

const jwksCache = new Map();

function getJwks(issuer) {
  let jwks = jwksCache.get(issuer);
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`));
    jwksCache.set(issuer, jwks);
  }
  return jwks;
}

export async function verifyCloudflareAccess(headers, env) {
  const assertion = headers.get("cf-access-jwt-assertion");
  if (!assertion) {
    return { ok: false, reason: "Sign in through Cloudflare Access to continue." };
  }

  try {
    const teamDomain = requiredEnv(env, "TEAM_DOMAIN").replace(/\/$/, "");
    const policyAudience = requiredEnv(env, "POLICY_AUD");
    const issuer = new URL(teamDomain).origin;
    const { payload } = await jwtVerify(assertion, getJwks(issuer), {
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
