import type { Env } from "../types";
const encoder = new TextEncoder();
async function hash(value: string) { const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value.trim().toUpperCase())); return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, "0")).join(""); }
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const body = await request.json<{ screeningId: string; code: string; selections: Record<string, string[]> }>().catch(() => null);
  if (!body?.screeningId || !body.code || !body.selections) return Response.json({ error: "screeningId, code, and selections are required" }, { status: 400 });
  const codeHash = await hash(body.code);
  const codeRow = await env.DB.prepare("SELECT * FROM vote_codes WHERE code_hash = ? AND screening_id = ?").bind(codeHash, body.screeningId).first<any>();
  if (!codeRow) return Response.json({ error: "Invalid vote code" }, { status: 403 });
  if (codeRow.used_at) return Response.json({ error: "This vote code has already been used" }, { status: 409 });
  const screening = await env.DB.prepare("SELECT start_at, stop_at FROM screenings WHERE id = ?").bind(body.screeningId).first<any>();
  const now = Date.now(); if (!screening || now < Date.parse(screening.start_at) || now > Date.parse(screening.stop_at)) return Response.json({ error: "Voting is not open" }, { status: 403 });
  const polls = await env.DB.prepare("SELECT * FROM polls WHERE screening_id = ?").bind(body.screeningId).all<any>();
  const statements: D1PreparedStatement[] = [];
  for (const poll of polls.results) {
    const selected = [...new Set(body.selections[poll.id] || [])];
    if (selected.length < poll.min_selections || selected.length > poll.max_selections) return Response.json({ error: `${poll.title}: select between ${poll.min_selections} and ${poll.max_selections} options` }, { status: 400 });
    const valid = await env.DB.prepare(`SELECT id FROM options WHERE poll_id = ? AND id IN (${selected.map(() => "?").join(",")})`).bind(poll.id, ...selected).all<any>();
    if (valid.results.length !== selected.length) return Response.json({ error: `Invalid option in ${poll.title}` }, { status: 400 });
    for (const optionId of selected) statements.push(env.DB.prepare("INSERT INTO votes (id, screening_id, poll_id, option_id, code_hash) VALUES (?, ?, ?, ?, ?)").bind(crypto.randomUUID(), body.screeningId, poll.id, optionId, codeHash));
  }
  statements.push(env.DB.prepare("UPDATE vote_codes SET used_at = CURRENT_TIMESTAMP WHERE code_hash = ? AND used_at IS NULL").bind(codeHash));
  await env.DB.batch(statements);
  return Response.json({ ok: true });
};
