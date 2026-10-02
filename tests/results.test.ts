import { describe, expect, it } from "vitest";
import { rankResults, resultsDue } from "../functions/results";

const stop = "2026-05-01T20:00:00Z";
const ended = Date.parse(stop);

describe("audience results", () => {
  it("waits until the delay after voting ends", () => {
    expect(resultsDue(false, stop, 0, ended + 60_000)).toBe(false);
    expect(resultsDue(true, stop, 0, ended - 1)).toBe(false);
    expect(resultsDue(true, stop, 0, ended)).toBe(true);
    expect(resultsDue(true, stop, 5, ended + 4 * 60_000)).toBe(false);
    expect(resultsDue(true, stop, 5, ended + 5 * 60_000)).toBe(true);
    expect(resultsDue(true, "later", 0, ended)).toBe(false);
  });

  it("breaks a tie toward the option that received a counted vote first", () => {
    const options = [
      { id: "a", title: "Navy", votes: 2, earliest: "2026-05-01T20:05:00Z", sortOrder: 0 },
      { id: "b", title: "Orange", votes: 4, earliest: "2026-05-01T20:10:00Z", sortOrder: 1 },
      { id: "c", title: "Pink", votes: 2, earliest: "2026-05-01T20:01:00Z", sortOrder: 2 },
      { id: "d", title: "Gold", votes: 0, earliest: null, sortOrder: 1 },
      { id: "e", title: "Silver", votes: 0, earliest: null, sortOrder: 0 },
    ];
    expect(rankResults(options, 3).map((item) => item.id)).toEqual(["b", "c", "a"]);
    expect(rankResults(options, 5).map((item) => item.id)).toEqual(["b", "c", "a", "e", "d"]);
  });
});
