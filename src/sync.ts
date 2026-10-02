export function samePicks(left: readonly string[], right: readonly string[]) {
  if (left.length !== right.length) return false;
  const a = [...left].sort();
  const b = [...right].sort();
  return a.every((id, index) => id === b[index]);
}

export function shouldApplySelections(input: {
  edits: number;
  editsAtSend: number;
  writes: number;
  writesAtSend: number;
  saveInFlight: boolean;
}) {
  return !input.saveInFlight && input.edits === input.editsAtSend && input.writes === input.writesAtSend;
}

export type PickKind = "short" | "over" | "counted" | "none";

export function pickMessage(
  poll: { minSelections: number; maxSelections: number },
  count: number,
  options: { corrected: boolean; open: boolean },
) {
  const kind = count < poll.minSelections ? "short" : count > poll.maxSelections ? "over" : count === 0 ? "none" : "counted";
  if (!options.open && count === 0) return { text: "No vote was cast", className: " is-short", kind: "none" };
  if (kind === "short" || kind === "over") {
    if (!options.open) return { text: "Your saved vote doesn't count", className: kind === "over" ? " is-over" : " is-short", kind: kind as PickKind };
    const remaining = poll.minSelections - count;
    const need = kind === "short"
      ? (count === 0 ? `Select ${remaining}` : remaining === 1 ? "Select 1 more" : `Select ${remaining} more`)
      : `Select at most ${poll.maxSelections}`;
    const text = options.corrected ? `Your saved vote doesn't count. ${need}.` : need;
    return { text, className: kind === "short" ? " is-short" : " is-over", kind: kind as PickKind };
  }
  if (kind === "none") return { text: "", className: "", kind };
  return { text: "Your vote was submitted successfully", className: " is-counted", kind };
}
