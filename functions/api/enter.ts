import { hashCode } from "../codes";
import type { Env } from "../types";

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const body = await request.json<{ code?: string }>().catch(() => null);
  const code = body?.code?.trim() || "";
  if (!code) return Response.json({ error: "Enter your vote code." }, { status: 400 });
  const row = await env.DB.prepare(
    "SELECT s.slug AS slug, s.title AS title, c.used_at AS used_at FROM vote_codes c JOIN screenings s ON s.id = c.screening_id WHERE c.code_hash = ?",
  ).bind(await hashCode(code)).first<{ slug: string; title: string; used_at: string | null }>();
  if (!row) return Response.json({ error: "That vote code isn't recognized. Check the code on your ticket and try again." }, { status: 403 });
  if (row.used_at) return Response.json({ error: "This vote code has already been used." }, { status: 409 });
  return Response.json({ slug: row.slug, title: row.title });
};
