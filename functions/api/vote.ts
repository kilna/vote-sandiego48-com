import { hashCode } from "../codes";
import type { Env } from "../types";
import { votingOpen } from "../voting";

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const body = await request.json<{ screeningId: string; code: string; selections: Record<string, string[]> }>().catch(() => null);
  if (!body?.screeningId || !body.code || !body.selections || typeof body.selections !== "object" || Array.isArray(body.selections)) {
    return Response.json({ error: "screeningId, code, and selections are required" }, { status: 400 });
  }
  const codeHash = await hashCode(body.code);
  const codeRow = await env.DB.prepare("SELECT code_hash FROM vote_codes WHERE code_hash = ? AND screening_id = ?").bind(codeHash, body.screeningId).first();
  if (!codeRow) return Response.json({ error: "Invalid vote code" }, { status: 403 });
  const polls = await env.DB.prepare("SELECT * FROM polls WHERE screening_id = ?").bind(body.screeningId).all<any>();
  const openPolls = polls.results.filter((poll) => votingOpen(poll.voting, poll.start_at, poll.stop_at));
  if (!openPolls.length) return Response.json({ error: "Voting is not open" }, { status: 403 });
  const statements: D1PreparedStatement[] = [];
  for (const poll of openPolls) {
    const raw = body.selections[poll.id];
    const selected = [...new Set(Array.isArray(raw) ? raw.filter((id): id is string => typeof id === "string") : [])];
    if (selected.length < poll.min_selections || selected.length > poll.max_selections) {
      const error = poll.min_selections === poll.max_selections
        ? `Select ${poll.min_selections} ${poll.title}`
        : `Select between ${poll.min_selections} and ${poll.max_selections} of ${poll.title}`;
      return Response.json({ error }, { status: 400 });
    }
    if (selected.length) {
      const valid = await env.DB.prepare(`SELECT id FROM options WHERE poll_id = ? AND id IN (${selected.map(() => "?").join(",")})`).bind(poll.id, ...selected).all<any>();
      if (valid.results.length !== selected.length) return Response.json({ error: `Invalid option in ${poll.title}` }, { status: 400 });
    }
    statements.push(env.DB.prepare("DELETE FROM votes WHERE code_hash = ? AND poll_id = ?").bind(codeHash, poll.id));
    for (const optionId of selected) {
      statements.push(env.DB.prepare("INSERT INTO votes (id, screening_id, poll_id, option_id, code_hash) VALUES (?, ?, ?, ?, ?)").bind(crypto.randomUUID(), body.screeningId, poll.id, optionId, codeHash));
    }
  }
  statements.push(env.DB.prepare("UPDATE vote_codes SET used_at = CURRENT_TIMESTAMP WHERE code_hash = ? AND used_at IS NULL").bind(codeHash));
  await env.DB.batch(statements);
  return Response.json({ ok: true });
};
