import type { Env } from "./types";
import { votingMode, votingOpen, type VotingMode } from "./voting";

export type BallotPollState = {
  id: string;
  voting: VotingMode;
  votingOpen: boolean;
  startAt: string;
  stopAt: string;
};

export type BallotState = {
  now: string;
  slug: string;
  title: string;
  eventId: string;
  used: boolean;
  polls: BallotPollState[];
  selections: Record<string, string[]>;
};

type BallotRow = {
  event_id: string;
  slug: string;
  title: string;
  used_at: string | null;
  poll_id: string | null;
  voting: string | null;
  start_at: string | null;
  stop_at: string | null;
  option_id: string | null;
};

const ballotSql = `SELECT s.id AS event_id, s.slug AS slug, s.title AS title, c.used_at AS used_at,
  p.id AS poll_id, p.voting AS voting, p.start_at AS start_at, p.stop_at AS stop_at, v.option_id AS option_id
  FROM vote_codes c
  JOIN events s ON s.id = c.event_id
  LEFT JOIN polls p ON p.event_id = s.id
  LEFT JOIN votes v ON v.poll_id = p.id AND v.code_hash = c.code_hash
  WHERE c.code_hash = ?
  ORDER BY p.sort_order, p.title, v.option_id`;

export function foldBallot(rows: BallotRow[], now = Date.now()): BallotState | null {
  const first = rows[0];
  if (!first) return null;
  const polls: BallotPollState[] = [];
  const selections: Record<string, string[]> = {};
  const seen = new Set<string>();
  for (const row of rows) {
    if (!row.poll_id) continue;
    if (!seen.has(row.poll_id)) {
      seen.add(row.poll_id);
      const startAt = row.start_at || "";
      const stopAt = row.stop_at || "";
      polls.push({
        id: row.poll_id,
        voting: votingMode(row.voting),
        votingOpen: Boolean(startAt && stopAt && votingOpen(startAt, stopAt, now)),
        startAt,
        stopAt,
      });
    }
    if (!row.option_id) continue;
    const chosen = selections[row.poll_id] || [];
    if (!chosen.includes(row.option_id)) chosen.push(row.option_id);
    selections[row.poll_id] = chosen;
  }
  return {
    now: new Date(now).toISOString(),
    slug: first.slug,
    title: first.title,
    eventId: first.event_id,
    used: first.used_at !== null,
    polls,
    selections,
  };
}

export async function readBallot(env: Env, codeHash: string, now = Date.now()) {
  const listed = await env.DB.prepare(ballotSql).bind(codeHash).all<BallotRow>();
  return foldBallot(listed.results || [], now);
}
