import type { Env } from "../../types";
export const onRequestGet: PagesFunction<Env> = async ({ env, params }) => { const object = await env.ASSETS.get(String(params.key)); if (!object) return new Response("Not found", { status: 404 }); return new Response(object.body, { headers: { "Content-Type": object.httpMetadata?.contentType || "image/jpeg", "Cache-Control": "public, max-age=3600" } }); };
