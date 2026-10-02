import { readBallot } from "../ballot";
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
  const pollIds = Object.keys(body.selections);
  if (!pollIds.length) return Response.json({ error: "selections are required" }, { status: 400 });
  const polls = await env.DB.prepare("SELECT * FROM polls WHERE screening_id = ?").bind(body.screeningId).all<any>();
  const byId = new Map(polls.results.map((poll) => [poll.id, poll]));
  const statements: D1PreparedStatement[] = [];
  let updated = 0;
  for (const pollId of pollIds) {
    const poll = byId.get(pollId);
    if (!poll) return Response.json({ error: "Invalid poll" }, { status: 400 });
    if (!votingOpen(poll.start_at, poll.stop_at)) continue;
    const raw = body.selections[pollId];
    if (!Array.isArray(raw)) return Response.json({ error: `Invalid selection for ${poll.title}` }, { status: 400 });
    const selected = [...new Set(raw.filter((id): id is string => typeof id === "string"))];
    if (selected.length) {
      const valid = await env.DB.prepare(`SELECT id FROM options WHERE poll_id = ? AND id IN (${selected.map(() => "?").join(",")})`).bind(poll.id, ...selected).all<any>();
      if (valid.results.length !== selected.length) return Response.json({ error: `Invalid option in ${poll.title}` }, { status: 400 });
    }
    statements.push(env.DB.prepare("DELETE FROM votes WHERE code_hash = ? AND poll_id = ?").bind(codeHash, poll.id));
    for (const optionId of selected) {
      statements.push(env.DB.prepare("INSERT INTO votes (id, screening_id, poll_id, option_id, code_hash) VALUES (?, ?, ?, ?, ?)").bind(crypto.randomUUID(), body.screeningId, poll.id, optionId, codeHash));
    }
    updated += 1;
  }
  if (!updated) return jsonState(env, codeHash, { error: "Voting is not open" }, 403);
  statements.push(env.DB.prepare("UPDATE vote_codes SET used_at = CURRENT_TIMESTAMP WHERE code_hash = ? AND used_at IS NULL").bind(codeHash));
  await env.DB.batch(statements);
  return jsonState(env, codeHash, { ok: true }, 200);
};

async function jsonState(env: Env, codeHash: string, body: Record<string, unknown>, status: number) {
  const state = await readBallot(env, codeHash);
  const payload = state ? { ...body, now: state.now, polls: state.polls, selections: state.selections } : body;
  return Response.json(payload, { status, headers: { "Cache-Control": "no-store" } });
}
