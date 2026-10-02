import { describe, expect, it } from "vitest";
import { foldBallot } from "../functions/ballot";
import { openapiDocument, publicIndex } from "../functions/api/schema";
import { pickMessage, samePicks, shouldApplySelections } from "../src/sync";

const now = Date.parse("2026-05-01T20:00:00Z");

describe("ballot sync", () => {
  it("folds one code's polls and stored picks", () => {
    const state = foldBallot([
      { screening_id: "s1", slug: "spring", title: "Spring", used_at: "2026-05-01T19:00:00Z", poll_id: "p1", voting: "scheduled", start_at: "2026-05-01T19:00:00Z", stop_at: "2026-05-01T21:00:00Z", option_id: "o1" },
      { screening_id: "s1", slug: "spring", title: "Spring", used_at: "2026-05-01T19:00:00Z", poll_id: "p1", voting: "scheduled", start_at: "2026-05-01T19:00:00Z", stop_at: "2026-05-01T21:00:00Z", option_id: "o2" },
      { screening_id: "s1", slug: "spring", title: "Spring", used_at: "2026-05-01T19:00:00Z", poll_id: "p2", voting: "closed", start_at: "2026-05-01T19:00:00Z", stop_at: "2026-05-01T21:00:00Z", option_id: null },
    ], now);
    expect(state?.slug).toBe("spring");
    expect(state?.used).toBe(true);
    expect(state?.polls.map((poll) => poll.votingOpen)).toEqual([true, false]);
    expect(state?.selections).toEqual({ p1: ["o1", "o2"] });
  });

  it("applies a snapshot only when the voter has not changed it since the request started", () => {
    expect(shouldApplySelections({ edits: 2, editsAtSend: 2, writes: 1, writesAtSend: 1, saveInFlight: false })).toBe(true);
    expect(shouldApplySelections({ edits: 3, editsAtSend: 2, writes: 1, writesAtSend: 1, saveInFlight: false })).toBe(false);
    expect(shouldApplySelections({ edits: 2, editsAtSend: 2, writes: 2, writesAtSend: 1, saveInFlight: false })).toBe(false);
    expect(shouldApplySelections({ edits: 2, editsAtSend: 2, writes: 1, writesAtSend: 1, saveInFlight: true })).toBe(false);
    expect(samePicks(["b", "a"], ["a", "b"])).toBe(true);
    expect(samePicks(["a"], ["a", "b"])).toBe(false);
  });

  it("tells the voter when a corrected or closed vote is outside the selection range", () => {
    const poll = { minSelections: 1, maxSelections: 2 };
    expect(pickMessage(poll, 0, { corrected: false, open: true }).text).toBe("Select 1");
    expect(pickMessage(poll, 0, { corrected: true, open: true }).text).toBe("Your saved vote doesn't count. Select 1.");
    expect(pickMessage({ minSelections: 3, maxSelections: 3 }, 0, { corrected: false, open: true }).text).toBe("Select 3");
    expect(pickMessage({ minSelections: 3, maxSelections: 3 }, 1, { corrected: false, open: true }).text).toBe("Select 2 more");
    expect(pickMessage(poll, 3, { corrected: true, open: true }).text).toBe("Your saved vote doesn't count. Select at most 2.");
    expect(pickMessage(poll, 0, { corrected: false, open: false }).text).toBe("No vote was cast");
    expect(pickMessage(poll, 3, { corrected: false, open: false }).text).toBe("Your saved vote doesn't count");
    expect(pickMessage(poll, 1, { corrected: true, open: true }).text).toBe("Your vote was submitted successfully");
  });

  it("publishes the public state poll", () => {
    expect(publicIndex().links.state).toEqual({ href: "/api/state", method: "POST" });
    const operation = openapiDocument().paths["/api/state"]?.post as { operationId?: string } | undefined;
    expect(operation?.operationId).toBe("readBallotState");
  });
});
