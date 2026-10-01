export const votingModes = ["scheduled", "open", "closed"] as const;

export type VotingMode = (typeof votingModes)[number];

const countdownWindowMs = 5 * 60 * 1000;

export type VotingCue = {
  at: number;
  kind: "start" | "end";
  titles: string[];
};

export type VotingPoll = {
  title: string;
  voting?: string | null;
  startAt: string;
  stopAt: string;
};

export function votingMode(value: string | null | undefined): VotingMode {
  return value === "open" || value === "closed" ? value : "scheduled";
}

export function votingOpen(mode: string | null | undefined, startAt: string, stopAt: string, now = Date.now()) {
  const voting = votingMode(mode);
  if (voting === "open") return true;
  if (voting === "closed") return false;
  const start = Date.parse(startAt);
  const stop = Date.parse(stopAt);
  return now >= start && now <= stop;
}

export function stopInMinutes(startAt: string, minutes: number, now = Date.now()) {
  const stopAt = new Date(now + minutes * 60_000).toISOString();
  const startMs = Date.parse(startAt);
  const start = Number.isFinite(startMs) && startMs < now ? new Date(startMs).toISOString() : new Date(now).toISOString();
  return { voting: "scheduled" as const, startAt: start, stopAt };
}

export function nextVotingCue(polls: VotingPoll[], now = Date.now()): VotingCue | null {
  let best: VotingCue | null = null;
  const groups = new Map<string, VotingCue>();
  for (const poll of polls) {
    if (votingMode(poll.voting) !== "scheduled") continue;
    const start = Date.parse(poll.startAt);
    const stop = Date.parse(poll.stopAt);
    if (!Number.isFinite(start) || !Number.isFinite(stop)) continue;
    let kind: VotingCue["kind"] | null = null;
    let at = 0;
    if (now < start && start - now <= countdownWindowMs) {
      kind = "start";
      at = start;
    } else if (now >= start && now < stop && stop - now <= countdownWindowMs) {
      kind = "end";
      at = stop;
    }
    if (!kind) continue;
    const key = `${kind}:${at}`;
    const cue = groups.get(key) || { at, kind, titles: [] };
    cue.titles.push(poll.title);
    groups.set(key, cue);
    if (!best || at < best.at) best = cue;
  }
  return best;
}

export function countdownLabel(cue: VotingCue, pollCount: number) {
  if (cue.kind === "end") {
    if (pollCount > 1 && cue.titles.length === pollCount) return "Voting ends in";
    if (cue.titles.length === 1) return `${cue.titles[0]} voting ends in`;
    if (cue.titles.length === 2) return `${cue.titles[0]} and ${cue.titles[1]} voting ends in`;
    return `${cue.titles.length} polls voting ends in`;
  }
  if (pollCount > 1 && cue.titles.length === pollCount) return "Voting starts in";
  if (cue.titles.length === 1) return `${cue.titles[0]} starts in`;
  if (cue.titles.length === 2) return `${cue.titles[0]} and ${cue.titles[1]} start in`;
  return `${cue.titles.length} polls start in`;
}
