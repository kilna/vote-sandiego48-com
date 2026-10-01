import { error } from "./api/http";
import type { Env } from "./types";

export const ACCESS_ISSUER = "https://kilna.cloudflareaccess.com";

/** Audience tags for the Access apps on vote.sandiego48.com and the Pages hostname. */
export const ACCESS_AUDIENCES = [
  "cb94a9f99e4d085bf79b0d2a56060f395d56c56cf264eebc8182f5cc42b22b11",
  "0eb602488e9900b4a156d005eb7145653a1a6c9ddf9c04fdf16e046db2965d5a",
];

const CLOCK_SKEW_SECONDS = 60;
const KEY_CACHE_MS = 60 * 60 * 1000;

export type AccessClaims = {
  iss?: string;
  aud?: string | string[];
  exp?: number;
  nbf?: number;
  email?: string;
  type?: string;
  common_name?: string;
};

type KeyCache = { url: string; keys: Map<string, CryptoKey>; expires: number };
let keyCache: KeyCache | null = null;

export function clearAccessKeyCache() {
  keyCache = null;
}

export function identityAllowed(claims: AccessClaims) {
  const email = typeof claims.email === "string" ? claims.email.trim().toLowerCase() : "";
  if (email) return emailAllowed(email);
  return claims.type === "app" && typeof claims.common_name === "string" && claims.common_name.trim().length > 0;
}

function emailAllowed(email: string) {
  if (email === "sandiego@48hourfilm.com") return true;
  const at = email.lastIndexOf("@");
  return at > 0 && email.slice(at + 1) === "kilna.com";
}

export async function authorizeAdmin(request: Request, env: Env) {
  if (localBypass(request, env)) return null;
  const token = request.headers.get("Cf-Access-Jwt-Assertion");
  if (!token) return error(401, "Unauthorized. Cloudflare Access did not authorize this request.");
  try {
    const claims = await verifyAccessJwt(token, {
      issuer: issuerFor(env),
      audiences: audiencesFor(env),
    });
    if (!identityAllowed(claims)) return error(401, "Unauthorized. This Cloudflare Access identity cannot administer voting.");
    return null;
  } catch {
    return error(401, "Unauthorized. Cloudflare Access did not authorize this request.");
  }
}

function localBypass(request: Request, env: Env) {
  if (env.ACCESS_DEV_BYPASS !== "1") return false;
  const host = new URL(request.url).hostname;
  return host === "localhost" || host === "127.0.0.1" || host === "[::1]";
}

function issuerFor(env: Env) {
  return (env.ACCESS_TEAM_DOMAIN || ACCESS_ISSUER).replace(/\/$/, "");
}

function audiencesFor(env: Env) {
  const configured = (env.ACCESS_AUD || "").split(",").map((item) => item.trim()).filter(Boolean);
  return configured.length ? configured : ACCESS_AUDIENCES;
}

export async function verifyAccessJwt(token: string, options: { issuer: string; audiences: string[]; now?: number }) {
  const parts = token.split(".");
  if (parts.length !== 3 || parts.some((part) => !part)) throw new Error("Malformed Access JWT.");
  const header = decodeJson(parts[0]) as { alg?: string; kid?: string };
  if (header.alg !== "RS256" || !header.kid) throw new Error("Access JWT must use RS256.");
  const keys = await accessKeys(options.issuer);
  const key = keys.get(header.kid);
  if (!key) throw new Error("Access JWT key is not published by this team.");
  const signed = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
  const valid = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, base64UrlBytes(parts[2]), signed);
  if (!valid) throw new Error("Access JWT signature was rejected.");
  const claims = decodeJson(parts[1]) as AccessClaims;
  const now = options.now ?? Math.floor(Date.now() / 1000);
  if (claims.iss !== options.issuer) throw new Error("Access JWT issuer was rejected.");
  if (!audienceMatches(claims.aud, options.audiences)) throw new Error("Access JWT audience was rejected.");
  if (typeof claims.exp !== "number" || claims.exp <= now - CLOCK_SKEW_SECONDS) throw new Error("Access JWT is expired.");
  if (typeof claims.nbf === "number" && claims.nbf > now + CLOCK_SKEW_SECONDS) throw new Error("Access JWT is not active yet.");
  return claims;
}

function audienceMatches(aud: AccessClaims["aud"], expected: string[]) {
  const values = Array.isArray(aud) ? aud : aud ? [aud] : [];
  return values.some((value) => expected.includes(value));
}

async function accessKeys(issuer: string) {
  const url = `${issuer}/cdn-cgi/access/certs`;
  if (keyCache && keyCache.url === url && keyCache.expires > Date.now()) return keyCache.keys;
  const response = await fetch(url);
  if (!response.ok) throw new Error("Could not load Cloudflare Access certificates.");
  const body = await response.json() as { keys?: JsonWebKey[] };
  const keys = new Map<string, CryptoKey>();
  for (const jwk of body.keys || []) {
    const kid = "kid" in jwk && typeof jwk.kid === "string" ? jwk.kid : "";
    if (!kid || jwk.kty !== "RSA" || !jwk.n || !jwk.e) continue;
    const key = await crypto.subtle.importKey(
      "jwk",
      { kty: "RSA", n: jwk.n, e: jwk.e, alg: "RS256", ext: true },
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"],
    );
    keys.set(kid, key);
  }
  if (!keys.size) throw new Error("Cloudflare Access published no verification keys.");
  keyCache = { url, keys, expires: Date.now() + KEY_CACHE_MS };
  return keys;
}

function decodeJson(segment: string) {
  const text = new TextDecoder().decode(base64UrlBytes(segment));
  return JSON.parse(text) as unknown;
}

function base64UrlBytes(segment: string) {
  const normalized = segment.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}
