import { hashCode } from "../codes";
import type { Env } from "../types";

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const body = await request.json<{ code?: string }>().catch(() => null);
  const code = body?.code?.trim() || "";
  if (!code) return Response.json({ error: "Enter your vote code." }, { status: 400 });
  const codeHash = await hashCode(code);
  const row = await env.DB.prepare(
    "SELECT s.slug AS slug, s.title AS title, c.used_at AS used_at FROM vote_codes c JOIN events s ON s.id = c.event_id WHERE c.code_hash = ?",
  ).bind(codeHash).first<{ slug: string; title: string; used_at: string | null }>();
  if (!row) return Response.json({ error: "That vote code isn't recognized. Check the code on your ticket and try again." }, { status: 403 });
  const votes = await env.DB.prepare("SELECT poll_id, option_id FROM votes WHERE code_hash = ?").bind(codeHash).all<{ poll_id: string; option_id: string }>();
  const selections: Record<string, string[]> = {};
  for (const vote of votes.results || []) {
    const chosen = selections[vote.poll_id] || [];
    chosen.push(vote.option_id);
    selections[vote.poll_id] = chosen;
  }
  return Response.json({ slug: row.slug, title: row.title, used: row.used_at !== null, selections });
};
