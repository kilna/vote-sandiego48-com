import { describe, expect, it } from "vitest";
import yaml from "js-yaml";

describe("poll package shape", () => {
  it("supports multiple polls and per-poll image constraints", () => {
    const packageData = yaml.load(`
screening:
  slug: test-screening
  title: Test screening
  start_at: 2026-05-01T18:00:00-07:00
  stop_at: 2026-05-01T23:00:00-07:00
polls:
  - slug: poster
    min_selections: 1
    max_selections: 1
    image_config: { aspectRatio: "2:3", min: 1, max: 1 }
  - slug: film
    min_selections: 3
    max_selections: 5
    image_config: { aspectRatio: "16:9", min: 1, max: 6, cycle: true }
`) as { polls: { slug: string; image_config: { aspectRatio: string } }[] };
    expect(packageData.polls).toHaveLength(2);
    expect(packageData.polls[0].image_config.aspectRatio).toBe("2:3");
    expect(packageData.polls[1].image_config.aspectRatio).toBe("16:9");
  });
});
