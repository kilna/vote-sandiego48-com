import { describe, expect, it } from "vitest";
import { keyBelongs, safeFilename } from "../functions/admin/images";
import { presentOption, presentPoll, presentScreening } from "../functions/admin/present";
import { normalizeCode, randomCode } from "../functions/codes";
import { adminIndex, adminPath, adminRoutes, examples, matchAdminRoute, openapiDocument, optionWrite, pollPatch, pollWrite, publicIndex, screeningPatch, screeningWrite, validateObject, voteCodeGenerate } from "../functions/api/schema";

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
    for (const step of adminIndex().workflows.createScreening) expect(ids.has(step.operationId)).toBe(true);
  });

  it("accepts the documented create examples", () => {
    expect(validateObject(screeningWrite, examples.screeningCreate, "create").ok).toBe(true);
    expect(validateObject(pollWrite, examples.pollCreate, "create").ok).toBe(true);
    expect(validateObject(optionWrite, examples.optionCreate, "create").ok).toBe(true);
    expect(validateObject(voteCodeGenerate, examples.codes, "create").ok).toBe(true);
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
    const stills = validateObject(pollWrite, { ...examples.pollCreate, imageConfig: { aspectRatio: "16:9", min: 3, max: 1 } }, "create");
    expect(stills.ok).toBe(false);
    const count = validateObject(voteCodeGenerate, { count: 0 }, "create");
    expect(count.ok).toBe(false);
    const pasted = validateObject(voteCodeGenerate, { codes: ["TEST-1001"] }, "create");
    expect(pasted.ok).toBe(false);
  });

  it("matches admin routes and rejects unknown methods", () => {
    const created = matchAdminRoute("POST", ["screenings"]);
    expect(created.ok && created.operationId).toBe("createScreening");
    const wrong = matchAdminRoute("PUT", ["screenings"]);
    expect(wrong.ok).toBe(false);
    if (!wrong.ok) expect(wrong.status).toBe(405);
    expect(matchAdminRoute("GET", ["missing"]).ok).toBe(false);
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
    for (const code of codes) expect(code).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}$/);
    expect(normalizeCode(" k7np-4qwm ")).toBe("K7NP4QWM");
    expect(normalizeCode("K7NP4QWM")).toBe(normalizeCode("K7NP-4QWM"));
  });
});
