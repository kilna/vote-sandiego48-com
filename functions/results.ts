import type { Env } from "./types";

export type AudienceResult = { id: string; title: string; votes: number };

export function resultsDue(showResults: boolean, stopAt: string, delayMinutes: number, now: number) {
  if (!showResults) return false;
  const stop = Date.parse(stopAt);
  if (!Number.isFinite(stop)) return false;
  const delay = Number.isFinite(delayMinutes) ? delayMinutes : 0;
  return now >= stop + delay * 60_000;
}

function voteInstant(value?: string | null) {
  if (!value) return Number.POSITIVE_INFINITY;
  const stamped = /[zZ]|[+-]\d\d:?\d\d$/.test(value) ? value : `${value.includes("T") ? value : value.replace(" ", "T")}Z`;
  const at = Date.parse(stamped);
  return Number.isFinite(at) ? at : Number.POSITIVE_INFINITY;
}

export function rankResults<T extends { votes: number; earliest?: string | null; sortOrder: number; title: string }>(options: T[], limit: number) {
  return [...options].sort((a, b) => b.votes - a.votes || voteInstant(a.earliest) - voteInstant(b.earliest) || a.sortOrder - b.sortOrder || a.title.localeCompare(b.title)).slice(0, Math.max(0, limit));
}

type PollSetting = {
  id: string;
  stop_at: string | null;
  show_results: number | null;
  results_limit: number | null;
  results_delay_minutes: number | null;
};

type TallyRow = {
  poll_id: string;
  option_id: string | null;
  option_title: string | null;
  sort_order: number | null;
  votes: number | null;
  earliest: string | null;
};

export async function revealedByPoll(env: Env, eventId: string, now = Date.now()) {
  const listed = await env.DB.prepare("SELECT id, stop_at, show_results, results_limit, results_delay_minutes FROM polls WHERE event_id = ?").bind(eventId).all<PollSetting>();
  const due = (listed.results || []).filter((poll) => resultsDue(Boolean(poll.show_results), poll.stop_at || "", Number(poll.results_delay_minutes || 0), now));
  const map = new Map<string, AudienceResult[]>();
  if (!due.length) return map;
  const ids = due.map((poll) => poll.id);
  const placeholders = ids.map(() => "?").join(",");
  const counted = `WITH counted AS (
      SELECT v.poll_id, v.code_hash
      FROM votes v
      JOIN polls p ON p.id = v.poll_id
      WHERE p.id IN (${placeholders})
      GROUP BY v.poll_id, v.code_hash
      HAVING COUNT(*) BETWEEN MIN(p.min_selections) AND MAX(p.max_selections)
    )`;
  const rows = await env.DB.prepare(`${counted}
    SELECT p.id AS poll_id, o.id AS option_id, o.title AS option_title, o.sort_order AS sort_order, COUNT(c.code_hash) AS votes, MIN(CASE WHEN c.code_hash IS NOT NULL THEN v.created_at END) AS earliest
    FROM polls p
    LEFT JOIN options o ON o.poll_id = p.id
    LEFT JOIN votes v ON v.option_id = o.id
    LEFT JOIN counted c ON c.poll_id = p.id AND c.code_hash = v.code_hash
    WHERE p.id IN (${placeholders})
    GROUP BY p.id, o.id, o.title, o.sort_order`).bind(...ids, ...ids).all<TallyRow>();
  const grouped = new Map<string, { id: string; title: string; votes: number; earliest: string | null; sortOrder: number }[]>();
  for (const row of rows.results || []) {
    if (!row.option_id || !row.option_title) continue;
    const list = grouped.get(row.poll_id) || [];
    list.push({ id: row.option_id, title: row.option_title, votes: Number(row.votes || 0), earliest: row.earliest, sortOrder: Number(row.sort_order || 0) });
    grouped.set(row.poll_id, list);
  }
  for (const poll of due) {
    const ranked = rankResults(grouped.get(poll.id) || [], Number(poll.results_limit ?? 3));
    map.set(poll.id, ranked.map(({ id, title, votes }) => ({ id, title, votes })));
  }
  return map;
}

export function assignResults<T extends { id: string }>(polls: T[], revealed: Map<string, AudienceResult[]>) {
  return polls.map((poll) => ({ ...poll, results: revealed.get(poll.id) ?? null }));
}
