import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ACCESS_AUDIENCES, ACCESS_ISSUER, clearAccessKeyCache, identityAllowed, verifyAccessJwt } from "../functions/access";
import { handleAdmin } from "../functions/admin/routes";
import { openapiDocument } from "../functions/api/schema";
import type { Env } from "../functions/types";

let privateKey: CryptoKey;
let publicJwk: JsonWebKey;

const env = {} as Env;

beforeAll(async () => {
  const pair = await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"],
  );
  privateKey = pair.privateKey;
  publicJwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
});

beforeEach(() => {
  clearAccessKeyCache();
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    if (String(input) === `${ACCESS_ISSUER}/cdn-cgi/access/certs`) {
      return new Response(JSON.stringify({ keys: [{ kty: publicJwk.kty, n: publicJwk.n, e: publicJwk.e, kid: "test" }] }), { status: 200 });
    }
    return new Response("missing", { status: 404 });
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
  clearAccessKeyCache();
});

describe("cloudflare access", () => {
  it("allows kilna.com addresses, one 48 Hour Film address, and service tokens", () => {
    expect(identityAllowed({ email: "kilna@kilna.com" })).toBe(true);
    expect(identityAllowed({ email: "Person@Kilna.com" })).toBe(true);
    expect(identityAllowed({ email: "sandiego@48hourfilm.com" })).toBe(true);
    expect(identityAllowed({ email: "other@48hourfilm.com" })).toBe(false);
    expect(identityAllowed({ email: "kilna@notkilna.com" })).toBe(false);
    expect(identityAllowed({ email: "kilna@kilna.com.evil.com" })).toBe(false);
    expect(identityAllowed({ type: "app", common_name: "agent.access" })).toBe(true);
    expect(identityAllowed({ type: "app" })).toBe(false);
    expect(identityAllowed({})).toBe(false);
  });

  it("rejects admin calls that Cloudflare Access did not sign", async () => {
    const response = await handleAdmin(new Request("https://vote.sandiego48.com/api/admin"), env, []);
    expect(response.status).toBe(401);
    const body = await response.json() as { error: string };
    expect(body.error).toMatch(/Cloudflare Access/);
  });

  it("accepts a signed JWT for an allowed email and for a service token", async () => {
    const person = await handleAdmin(requestWith(await sign(claims())), env, []);
    expect(person.status).toBe(200);
    const service = await handleAdmin(requestWith(await sign(claims({ email: undefined, type: "app", common_name: "agent.access" }))), env, []);
    expect(service.status).toBe(200);
    const pages = await handleAdmin(requestWith(await sign(claims({ aud: ACCESS_AUDIENCES[1] }))), env, []);
    expect(pages.status).toBe(200);
  });

  it("rejects a valid signature for the wrong email, audience, or key", async () => {
    const other = await handleAdmin(requestWith(await sign(claims({ email: "guest@example.com" }))), env, []);
    expect(other.status).toBe(401);
    const audience = await verifyAccessJwt(await sign(claims({ aud: "other-app" })), { issuer: ACCESS_ISSUER, audiences: ACCESS_AUDIENCES }).catch((err: Error) => err);
    expect(audience).toBeInstanceOf(Error);
    const forged = await sign(claims());
    const [header, payload, signature] = forged.split(".");
    const broken = `${header}.${payload}.${signature.slice(0, -2)}aa`;
    const bad = await handleAdmin(requestWith(broken), env, []);
    expect(bad.status).toBe(401);
  });

  it("skips the JWT check on localhost only when local dev bypass is set", async () => {
    const local = await handleAdmin(new Request("http://localhost:8788/api/admin"), { ACCESS_DEV_BYPASS: "1" } as Env, []);
    expect(local.status).toBe(200);
    const production = await handleAdmin(new Request("https://vote.sandiego48.com/api/admin"), { ACCESS_DEV_BYPASS: "1" } as Env, []);
    expect(production.status).toBe(401);
  });

  it("documents Access service-token headers instead of a bearer token", () => {
    const spec = openapiDocument() as { components: { securitySchemes: Record<string, unknown> } };
    expect(spec.components.securitySchemes).toHaveProperty("cfAccessClientId");
    expect(spec.components.securitySchemes).not.toHaveProperty("bearerAuth");
    expect(JSON.stringify(spec)).not.toContain("ADMIN_TOKEN");
  });
});

function claims(extra: Record<string, unknown> = {}) {
  const now = Math.floor(Date.now() / 1000);
  return { iss: ACCESS_ISSUER, aud: ACCESS_AUDIENCES[0], iat: now, exp: now + 3600, email: "kilna@kilna.com", ...extra };
}

function requestWith(token: string) {
  return new Request("https://vote.sandiego48.com/api/admin", { headers: { "Cf-Access-Jwt-Assertion": token } });
}

async function sign(payload: Record<string, unknown>) {
  const header = base64Url(new TextEncoder().encode(JSON.stringify({ alg: "RS256", kid: "test", typ: "JWT" })));
  const body = base64Url(new TextEncoder().encode(JSON.stringify(payload)));
  const signature = new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", privateKey, new TextEncoder().encode(`${header}.${body}`)));
  return `${header}.${body}.${base64Url(signature)}`;
}

function base64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "");
}
