import type { Env } from "../../types";

export const onRequestGet: PagesFunction<Env> = async ({ env, params }) => {
  const raw = (params as { path?: string | string[] }).path;
  const parts = Array.isArray(raw) ? raw : [String(raw || "")];
  const key = parts.map((part) => decodeURIComponent(part)).filter(Boolean).join("/");
  if (!key) return new Response("Not found", { status: 404 });
  const object = await env.MEDIA.get(key);
  if (!object) return new Response("Not found", { status: 404 });
  const contentType = object.httpMetadata?.contentType || "image/jpeg";
  const headers: Record<string, string> = {
    "Content-Type": contentType,
    "Cache-Control": "public, max-age=3600",
    "X-Content-Type-Options": "nosniff",
  };
  if (contentType === "image/svg+xml") headers["Content-Security-Policy"] = "default-src 'none'; style-src 'unsafe-inline'; sandbox";
  return new Response(object.body, { headers });
};
