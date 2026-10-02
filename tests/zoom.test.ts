import { describe, expect, it } from "vitest";
import { nextZoomScale, stepIndex } from "../src/zoom";

describe("poster zoom", () => {
  it("wraps stills and keeps the scale inside the closer range", () => {
    expect(stepIndex(0, -1, 3)).toBe(2);
    expect(stepIndex(2, 1, 3)).toBe(0);
    expect(stepIndex(0, 0, 0)).toBe(0);
    expect(nextZoomScale(1, 1.12)).toBeCloseTo(1.12);
    expect(nextZoomScale(3.8, 1.12)).toBe(4);
    expect(nextZoomScale(1.1, 0.5)).toBe(1);
  });
});