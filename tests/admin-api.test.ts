import { describe, expect, it } from "vitest";
import { keyBelongs, safeFilename } from "../functions/admin/images";
import { imageCycleSeconds, parseImageConfig, presentOption, presentPoll, presentScreening } from "../functions/admin/present";
import { normalizeCode, randomCode } from "../functions/codes";
import { adminIndex, adminPath, adminRoutes, examples, matchAdminRoute, openapiDocument, optionOrder, optionWrite, pollOrder, pollPatch, pollWrite, publicIndex, screeningPatch, screeningWrite, validateObject, voteCodeGenerate } from "../functions/api/schema";
import { countdownLabel, nextVotingCue, startNow, stopInMinutes, stopNow, votingOpen } from "../functions/voting";

describe("admin api contract", () => {
  it("publishes every admin route in the OpenAPI document", () => {
    const spec = openapiDocument();
    for (const route of adminRoutes) {
      const operation = spec.paths[adminPath(route)]?.[route.method.toLowerCase()] as { operationId?: string } | undefined;
      expect(operation?.operationId).toBe(route.operationId);
    }
  });

  it("points agents at the OpenAPI document and the create workflow", () => {
    expect(publicIndex().links.openapi.href).toBe("/api/openapi.json");
    const ids = new Set(adminRoutes.map((route) => route.operationId));
    const index = adminIndex();
    for (const step of [...index.workflows.createScreening, ...index.workflows.reorder]) expect(ids.has(step.operationId)).toBe(true);
  });

  it("accepts the documented create examples", () => {
    expect(validateObject(screeningWrite, examples.screeningCreate, "create").ok).toBe(true);
    expect(validateObject(pollWrite, examples.pollCreate, "create").ok).toBe(true);
    expect(validateObject(optionWrite, examples.optionCreate, "create").ok).toBe(true);
    expect(validateObject(voteCodeGenerate, examples.codes, "create").ok).toBe(true);
    expect(validateObject(pollOrder, examples.pollOrder, "create").ok).toBe(true);
    expect(validateObject(optionOrder, examples.optionOrder, "create").ok).toBe(true);
  });

  it("names invalid fields", () => {
    const missing = validateObject(screeningWrite, { slug: "spring-screening" }, "create");
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.fields.title).toBe("Required.");
    const slug = validateObject(screeningWrite, { ...examples.screeningCreate, slug: "Spring Screening" }, "create");
    expect(slug.ok).toBe(false);
    const order = validateObject(screeningWrite, { ...examples.screeningCreate, stopAt: "2026-05-01T12:00:00-07:00" }, "create");
    expect(order.ok).toBe(false);
    if (!order.ok) expect(order.fields.stopAt).toMatch(/after/);
    const unknown = validateObject(screeningPatch, { title: "Evening", extra: true }, "patch");
    expect(unknown.ok).toBe(false);
    const empty = validateObject(screeningPatch, {}, "patch");
    expect(empty.ok).toBe(false);
    const selections = validateObject(pollPatch, { minSelections: 3, maxSelections: 1 }, "patch");
    expect(selections.ok).toBe(false);
    const stills = validateObject(pollWrite, { ...examples.pollCreate, imageConfig: { aspectRatio: "16:9", min: 1, max: 2 } }, "create");
    expect(stills.ok).toBe(false);
    if (!stills.ok) expect(stills.fields.imageConfig).toMatch(/min/);
    const cycle = validateObject(pollWrite, { ...examples.pollCreate, imageConfig: { aspectRatio: "16:9", cycle: true } }, "create");
    expect(cycle.ok).toBe(false);
    const timed = validateObject(pollWrite, { slug: "best-film", title: "Best Film", imageConfig: { aspectRatio: "16:9" } }, "create");
    expect(timed.ok && timed.value.imageConfig).toEqual({ aspectRatio: "16:9", cycle: 2, zoomable: false });
    const zoomed = validateObject(pollWrite, { ...examples.pollCreate, imageConfig: { aspectRatio: "2:3", zoomable: true } }, "create");
    expect(zoomed.ok && zoomed.value.imageConfig).toEqual({ aspectRatio: "2:3", cycle: 2, zoomable: true });
    const zoomType = validateObject(pollWrite, { ...examples.pollCreate, imageConfig: { aspectRatio: "16:9", zoomable: "yes" } }, "create");
    expect(zoomType.ok).toBe(false);
    const count = validateObject(voteCodeGenerate, { count: 0 }, "create");
    expect(count.ok).toBe(false);
    const voting = validateObject(pollPatch, { voting: "open" }, "patch");
    expect(voting.ok).toBe(false);
    if (!voting.ok) expect(voting.fields.voting).toBe("Unknown field.");
    expect(validateObject(screeningPatch, { voting: "open" }, "patch").ok).toBe(false);
    expect(validateObject(pollWrite, examples.pollCreate, "create").ok).toBe(true);
    const windowOrder = validateObject(pollWrite, { ...examples.pollCreate, startAt: "2026-05-01T23:00:00Z", stopAt: "2026-05-01T18:00:00Z" }, "create");
    expect(windowOrder.ok).toBe(false);
    if (!windowOrder.ok) expect(windowOrder.fields.stopAt).toMatch(/after/);
    const pasted = validateObject(voteCodeGenerate, { codes: ["TEST-1001"] }, "create");
    expect(pasted.ok).toBe(false);
    const duplicatePolls = validateObject(pollOrder, { slugs: ["best-film", "best-film"] }, "create");
    expect(duplicatePolls.ok).toBe(false);
    if (!duplicatePolls.ok) expect(duplicatePolls.fields.slugs).toMatch(/more than once/);
    const duplicateOptions = validateObject(optionOrder, { ids: ["same", "same"] }, "create");
    expect(duplicateOptions.ok).toBe(false);
  });

  it("matches admin routes and rejects unknown methods", () => {
    const created = matchAdminRoute("POST", ["screenings"]);
    expect(created.ok && created.operationId).toBe("createScreening");
    const wrong = matchAdminRoute("PUT", ["screenings"]);
    expect(wrong.ok).toBe(false);
    if (!wrong.ok) expect(wrong.status).toBe(405);
    expect(matchAdminRoute("GET", ["missing"]).ok).toBe(false);
    const reorderPolls = matchAdminRoute("PUT", ["screenings", "spring", "polls", "order"]);
    expect(reorderPolls.ok && reorderPolls.operationId).toBe("reorderPolls");
    const namedPoll = matchAdminRoute("PATCH", ["screenings", "spring", "polls", "order"]);
    expect(namedPoll.ok && namedPoll.operationId).toBe("updatePoll");
    const reorderOptions = matchAdminRoute("PUT", ["screenings", "spring", "polls", "best-film", "options", "order"]);
    expect(reorderOptions.ok && reorderOptions.operationId).toBe("reorderOptions");
  });

  it("reads seconds per image and ignores stored still counts", () => {
    expect(imageCycleSeconds(true)).toBe(2);
    expect(imageCycleSeconds(0)).toBe(2);
    expect(imageCycleSeconds(1)).toBe(1);
    expect(parseImageConfig(JSON.stringify({ aspectRatio: "2:3", min: 1, max: 4, cycle: true }))).toEqual({ aspectRatio: "2:3", cycle: 2, zoomable: false });
    expect(parseImageConfig(JSON.stringify({ aspectRatio: "16:9", cycle: 5, zoomable: true }))).toEqual({ aspectRatio: "16:9", cycle: 5, zoomable: true });
    expect(parseImageConfig("{}")).toEqual({ aspectRatio: "16:9", cycle: 2, zoomable: false });
  });

  it("keeps presenter fields in the OpenAPI schemas", () => {
    const screening = presentScreening({
      id: "id",
      slug: "spring-screening",
      title: "Spring",
      venue: null,
      banner_image_key: null,
      timezone: "America/Los_Angeles",
      start_at: "2026-05-01T18:00:00-07:00",
      stop_at: "2026-05-01T23:00:00-07:00",
    }, [presentPoll("spring-screening", {
      id: "poll",
      screening_id: "id",
      slug: "best-film",
      title: "Best Film",
      instructions: null,
      min_selections: 1,
      max_selections: 1,
      image_config: "{}",
      sort_order: 0,
    }, [presentOption({ id: "opt", poll_id: "poll", title: "Orange Hour", description: null, image_keys: "[]", sort_order: 0 })])]);
    const schemas = openapiDocument().components.schemas as { Screening: { properties: Record<string, unknown> }; Poll: { properties: Record<string, unknown> }; Option: { properties: Record<string, unknown> } };
    for (const key of Object.keys(screening)) expect(schemas.Screening.properties).toHaveProperty(key);
    for (const key of Object.keys(screening.polls[0])) expect(schemas.Poll.properties).toHaveProperty(key);
    for (const key of Object.keys(screening.polls[0].options[0])) expect(schemas.Option.properties).toHaveProperty(key);
  });

  it("stops a poll in a number of minutes and counts down only near the boundary", () => {
    const now = Date.parse("2026-05-01T20:00:00Z");
    const kept = stopInMinutes("2026-05-01T18:00:00Z", 5, now);
    expect(kept).toEqual({ stopAt: new Date(now + 5 * 60 * 1000).toISOString() });
    const opened = stopInMinutes("2026-05-01T21:00:00Z", 10, now);
    expect(opened.startAt && Date.parse(opened.startAt)).toBe(now);
    expect(Date.parse(opened.stopAt) - now).toBe(10 * 60 * 1000);
    const polls = [
      { title: "Best Film", voting: "scheduled", startAt: "2026-05-01T20:00:00Z", stopAt: "2026-05-01T21:00:00Z" },
      { title: "Audience", voting: "scheduled", startAt: "2026-05-01T20:00:00Z", stopAt: "2026-05-01T21:00:00Z" },
    ];
    expect(nextVotingCue(polls, Date.parse("2026-05-01T19:50:00Z"))).toBeNull();
    const starting = nextVotingCue(polls, Date.parse("2026-05-01T19:56:00Z"));
    expect(starting?.kind).toBe("start");
    expect(starting && countdownLabel(starting, 2)).toBe("Voting starts in");
    expect(nextVotingCue(polls, Date.parse("2026-05-01T20:56:00Z"))?.kind).toBe("end");
    expect(nextVotingCue([{ ...polls[0], voting: "open" }], Date.parse("2026-05-01T20:56:00Z"))?.kind).toBe("end");
    expect(nextVotingCue([{ ...polls[0], voting: "closed" }], Date.parse("2026-05-01T19:56:00Z"))?.kind).toBe("start");
    expect(countdownLabel({ at: now, kind: "end", titles: ["Best Film"] }, 2)).toBe("Best Film voting ends in");
  });

  it("opens and closes a poll by its times", () => {
    const start = "2026-05-01T18:00:00-07:00";
    const stop = "2026-05-01T23:00:00-07:00";
    const during = Date.parse("2026-05-01T20:00:00-07:00");
    const before = Date.parse("2026-05-01T12:00:00-07:00");
    expect(votingOpen(start, stop, during)).toBe(true);
    expect(votingOpen(start, stop, before)).toBe(false);
    expect(votingOpen(start, stop, Date.parse(stop))).toBe(false);
    const started = startNow(before);
    expect(Date.parse(started.startAt)).toBe(before);
    expect(votingOpen(started.startAt, stop, before)).toBe(true);
    const ended = stopNow(start, during);
    expect(ended).toEqual({ stopAt: new Date(during).toISOString() });
    expect(votingOpen(start, ended.stopAt, during)).toBe(false);
    const held = stopNow("2026-05-01T23:00:00Z", Date.parse("2026-05-01T20:00:00Z"));
    expect(Date.parse(held.stopAt || "")).toBe(Date.parse("2026-05-01T20:00:00Z"));
    expect(Date.parse(held.startAt || "")).toBe(Date.parse("2026-05-01T20:00:00Z") - 1000);
  });

  it("rejects traversal in image keys and keeps only a safe basename", () => {
    expect(safeFilename("../banner.svg")).toBe("banner.svg");
    expect(safeFilename("..")).toBeNull();
    expect(keyBelongs("screening", "screening/banner.svg")).toBe(true);
    expect(keyBelongs("screening", "other/banner.svg")).toBe(false);
    expect(keyBelongs("screening", "screening/../other.svg")).toBe(false);
  });

  it("generates ticket codes that ignore spaces and hyphens when typed", () => {
    const codes = new Set<string>();
    for (let index = 0; index < 200; index += 1) codes.add(randomCode());
    expect(codes.size).toBe(200);
    for (const code of codes) expect(code).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{5}$/);
    expect(normalizeCode(" ab234 ")).toBe("AB234");
    expect(normalizeCode("AB234")).toBe(normalizeCode("AB-234"));
  });
});
