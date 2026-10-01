export const votingModes = ["scheduled", "open", "closed"] as const;

export type VotingMode = (typeof votingModes)[number];

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
