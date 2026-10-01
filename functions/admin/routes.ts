import { assetUrl } from "../assets";
import { hashCode, normalizeCode } from "../codes";
import type { Env } from "../types";
import { error, json } from "../api/http";
import { imageContentType, imageKey, keyBelongs, MAX_IMAGE_BYTES, safeFilename } from "./images";
import { presentOption, presentPoll, presentScreening, presentScreeningSummary, type OptionRow, type PollRow, type ScreeningRow } from "./present";
import { adminIndex, matchAdminRoute, optionPatch, optionWrite, pollPatch, pollWrite, screeningPatch, screeningWrite, validateObject, voteCodesWrite } from "../api/schema";

type Media = Env["MEDIA"] & {
  delete(keys: string | string[]): Promise<void>;
  list(options?: { prefix?: string; cursor?: string }): Promise<{ objects: { key: string }[]; truncated: boolean; cursor?: string }>;
};

function authorized(request: Request, env: Env) {
  return !!env.ADMIN_TOKEN && request.headers.get("Authorization") === `Bearer ${env.ADMIN_TOKEN}`;
}

export async function handleAdmin(request: Request, env: Env, parts: string[]) {
  if (!authorized(request, env)) return error(401, "Unauthorized. Send Authorization: Bearer with the admin token.");
  const matched = matchAdminRoute(request.method, parts);
  if (!matched.ok) {
    if (matched.status === 405) return error(405, "Method not allowed.", { allow: matched.allow }, { Allow: matched.allow.join(", ") });
    return error(404, "No admin resource at this URL.");
  }
  const params = matched.params;
  switch (matched.operationId) {
    case "getAdminIndex": return json(adminIndex());
    case "listScreenings": return listScreenings(env);
    case "createScreening": return createScreening(request, env);
    case "getScreening": return readScreening(env, params.slug);
    case "updateScreening": return updateScreening(request, env, params.slug);
    case "deleteScreening": return deleteScreening(env, params.slug);
    case "listPolls": return listPolls(env, params.slug);
    case "createPoll": return createPoll(request, env, params.slug);
    case "getPoll": return readPoll(env, params.slug, params.pollSlug);
    case "updatePoll": return updatePoll(request, env, params.slug, params.pollSlug);
    case "deletePoll": return deletePoll(env, params.slug, params.pollSlug);
    case "listOptions": return listOptions(env, params.slug, params.pollSlug);
    case "createOption": return createOption(request, env, params.slug, params.pollSlug);
    case "getOption": return readOption(env, params.slug, params.pollSlug, params.optionId);
    case "updateOption": return updateOption(request, env, params.slug, params.pollSlug, params.optionId);
    case "deleteOption": return deleteOption(env, params.slug, params.pollSlug, params.optionId);
    case "uploadScreeningImage": return uploadImage(request, env, params.slug);
    case "getVoteCodes": return codeCounts(env, params.slug);
    case "addVoteCodes": return addCodes(request, env, params.slug);
    case "deleteVoteCodes": return deleteCodes(request, env, params.slug);
    default: return error(500, "This admin route is not implemented.");
  }
}

type Failure = { response: Response };

async function readBody(request: Request): Promise<{ value: unknown } | Failure> {
  const type = request.headers.get("content-type") || "";
  if (!type.toLowerCase().includes("application/json")) return { response: error(415, "Send Content-Type: application/json.") };
  try {
    return { value: await request.json() };
  } catch {
    return { response: error(400, "Request body must be JSON.", { fields: { body: "Request body must be JSON." } }) };
  }
}

function invalid(fields: Record<string, string>) {
  return error(400, "Request failed validation.", { fields });
}

function blankToNull(value: unknown) {
  if (value == null) return null;
  const text = String(value).trim();
  return text || null;
}

function isUnique(err: unknown) {
  return String(err).includes("UNIQUE");
}

async function requireScreening(env: Env, slug: string): Promise<{ row: ScreeningRow } | Failure> {
  const row = await env.DB.prepare("SELECT * FROM screenings WHERE slug = ?").bind(slug).first<ScreeningRow>();
  return row ? { row } : { response: error(404, "Screening not found.") };
}

async function requirePoll(env: Env, screeningId: string, pollSlug: string): Promise<{ row: PollRow } | Failure> {
  const row = await env.DB.prepare("SELECT * FROM polls WHERE screening_id = ? AND slug = ?").bind(screeningId, pollSlug).first<PollRow>();
  return row ? { row } : { response: error(404, "Poll not found.") };
}

async function requireOption(env: Env, pollId: string, optionId: string): Promise<{ row: OptionRow } | Failure> {
  const row = await env.DB.prepare("SELECT * FROM options WHERE poll_id = ? AND id = ?").bind(pollId, optionId).first<OptionRow>();
  return row ? { row } : { response: error(404, "Option not found.") };
}

async function optionsFor(env: Env, pollId: string) {
  const result = await env.DB.prepare("SELECT * FROM options WHERE poll_id = ? ORDER BY sort_order, title").bind(pollId).all<OptionRow>();
  return result.results.map(presentOption);
}

async function pollsFor(env: Env, screening: ScreeningRow) {
  const result = await env.DB.prepare("SELECT * FROM polls WHERE screening_id = ? ORDER BY sort_order, title").bind(screening.id).all<PollRow>();
  const polls = [];
  for (const row of result.results) polls.push(presentPoll(screening.slug, row, await optionsFor(env, row.id)));
  return polls;
}

async function screeningResponse(env: Env, slug: string, status = 200, headers: Record<string, string> = {}) {
  const found = await requireScreening(env, slug);
  if ("response" in found) return found.response;
  return json(presentScreening(found.row, await pollsFor(env, found.row)), status, headers);
}

async function pollResponse(env: Env, screening: ScreeningRow, poll: PollRow, status = 200, headers: Record<string, string> = {}) {
  return json(presentPoll(screening.slug, poll, await optionsFor(env, poll.id)), status, headers);
}

async function assertKeys(env: Env, screeningId: string, keys: string[]) {
  const seen = new Set<string>();
  for (const key of keys) {
    if (seen.has(key)) return `"${key}" is listed more than once.`;
    seen.add(key);
    if (!keyBelongs(screeningId, key)) return `"${key}" is not an image of this screening. Upload it with uploadScreeningImage and use the returned key.`;
    if (!await env.MEDIA.get(key)) return `"${key}" is not in storage. Upload it before attaching it.`;
  }
  return null;
}

async function nextSort(env: Env, sql: string, id: string) {
  const row = await env.DB.prepare(sql).bind(id).first<{ next: number }>();
  return row?.next ?? 0;
}

async function listScreenings(env: Env) {
  const result = await env.DB.prepare("SELECT * FROM screenings ORDER BY start_at, slug").all<ScreeningRow>();
  return json({ screenings: result.results.map(presentScreeningSummary) });
}

async function createScreening(request: Request, env: Env) {
  const body = await readBody(request);
  if ("response" in body) return body.response;
  const parsed = validateObject(screeningWrite, body.value, "create");
  if (!parsed.ok) return invalid(parsed.fields);
  const value = parsed.value;
  const id = crypto.randomUUID();
  try {
    await env.DB.prepare("INSERT INTO screenings (id, slug, title, venue, banner_image_key, timezone, start_at, stop_at) VALUES (?, ?, ?, ?, NULL, ?, ?, ?)").bind(id, value.slug, value.title, blankToNull(value.venue), value.timezone, value.startAt, value.stopAt).run();
  } catch (err) {
    if (isUnique(err)) return error(409, "A screening with this slug already exists.", { field: "slug" });
    throw err;
  }
  return screeningResponse(env, String(value.slug), 201, { Location: `/api/admin/screenings/${encodeURIComponent(String(value.slug))}` });
}

async function readScreening(env: Env, slug: string) {
  return screeningResponse(env, slug);
}

async function updateScreening(request: Request, env: Env, slug: string) {
  const found = await requireScreening(env, slug);
  if ("response" in found) return found.response;
  const body = await readBody(request);
  if ("response" in body) return body.response;
  const parsed = validateObject(screeningPatch, body.value, "patch");
  if (!parsed.ok) return invalid(parsed.fields);
  const value = parsed.value;
  const startAt = typeof value.startAt === "string" ? value.startAt : found.row.start_at;
  const stopAt = typeof value.stopAt === "string" ? value.stopAt : found.row.stop_at;
  if (Date.parse(stopAt) <= Date.parse(startAt)) return invalid({ stopAt: "Must be after startAt." });
  if ("bannerImageKey" in value && value.bannerImageKey != null) {
    const key = String(value.bannerImageKey);
    if (!keyBelongs(found.row.id, key) || !await env.MEDIA.get(key)) return invalid({ bannerImageKey: "Upload the banner to this screening first and use the returned key." });
  }
  const columns: Record<string, string> = { slug: "slug", title: "title", venue: "venue", timezone: "timezone", startAt: "start_at", stopAt: "stop_at", bannerImageKey: "banner_image_key" };
  const keys = Object.keys(value).filter((key) => columns[key]);
  const stored = keys.map((key) => key === "venue" ? blankToNull(value[key]) : value[key]);
  try {
    await env.DB.prepare(`UPDATE screenings SET ${keys.map((key) => `${columns[key]} = ?`).join(", ")} WHERE id = ?`).bind(...stored, found.row.id).run();
  } catch (err) {
    if (isUnique(err)) return error(409, "A screening with this slug already exists.", { field: "slug" });
    throw err;
  }
  const nextSlug = typeof value.slug === "string" ? value.slug : slug;
  return screeningResponse(env, nextSlug);
}

async function deleteScreening(env: Env, slug: string) {
  const found = await requireScreening(env, slug);
  if ("response" in found) return found.response;
  const id = found.row.id;
  await env.DB.batch([
    env.DB.prepare("DELETE FROM votes WHERE screening_id = ?").bind(id),
    env.DB.prepare("DELETE FROM options WHERE poll_id IN (SELECT id FROM polls WHERE screening_id = ?)").bind(id),
    env.DB.prepare("DELETE FROM polls WHERE screening_id = ?").bind(id),
    env.DB.prepare("DELETE FROM vote_codes WHERE screening_id = ?").bind(id),
    env.DB.prepare("DELETE FROM screenings WHERE id = ?").bind(id),
  ]);
  try {
    await removeImages(env, id);
  } catch {
    return error(500, "The screening was deleted, but its images could not be removed.");
  }
  return json({ deleted: true, slug });
}

async function removeImages(env: Env, screeningId: string) {
  const media = env.MEDIA as Media;
  const keys: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await media.list({ prefix: `${screeningId}/`, cursor });
    keys.push(...page.objects.map((object) => object.key));
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  if (keys.length) await media.delete(keys);
}

async function listPolls(env: Env, slug: string) {
  const found = await requireScreening(env, slug);
  if ("response" in found) return found.response;
  return json({ polls: await pollsFor(env, found.row) });
}

async function createPoll(request: Request, env: Env, slug: string) {
  const found = await requireScreening(env, slug);
  if ("response" in found) return found.response;
  const body = await readBody(request);
  if ("response" in body) return body.response;
  const parsed = validateObject(pollWrite, body.value, "create");
  if (!parsed.ok) return invalid(parsed.fields);
  const value = parsed.value;
  const sortOrder = typeof value.sortOrder === "number" ? value.sortOrder : await nextSort(env, "SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM polls WHERE screening_id = ?", found.row.id);
  const id = crypto.randomUUID();
  try {
    await env.DB.prepare("INSERT INTO polls (id, screening_id, slug, title, instructions, min_selections, max_selections, image_config, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(id, found.row.id, value.slug, value.title, blankToNull(value.instructions), value.minSelections, value.maxSelections, JSON.stringify(value.imageConfig), sortOrder).run();
  } catch (err) {
    if (isUnique(err)) return error(409, "A poll with this slug already exists on the screening.", { field: "slug" });
    throw err;
  }
  const poll = await requirePoll(env, found.row.id, String(value.slug));
  if ("response" in poll) return poll.response;
  return pollResponse(env, found.row, poll.row, 201, { Location: `/api/admin/screenings/${encodeURIComponent(slug)}/polls/${encodeURIComponent(String(value.slug))}` });
}

async function readPoll(env: Env, slug: string, pollSlug: string) {
  const found = await requireScreening(env, slug);
  if ("response" in found) return found.response;
  const poll = await requirePoll(env, found.row.id, pollSlug);
  if ("response" in poll) return poll.response;
  return pollResponse(env, found.row, poll.row);
}

async function updatePoll(request: Request, env: Env, slug: string, pollSlug: string) {
  const found = await requireScreening(env, slug);
  if ("response" in found) return found.response;
  const poll = await requirePoll(env, found.row.id, pollSlug);
  if ("response" in poll) return poll.response;
  const body = await readBody(request);
  if ("response" in body) return body.response;
  const parsed = validateObject(pollPatch, body.value, "patch");
  if (!parsed.ok) return invalid(parsed.fields);
  const value = parsed.value;
  const min = typeof value.minSelections === "number" ? value.minSelections : poll.row.min_selections;
  const max = typeof value.maxSelections === "number" ? value.maxSelections : poll.row.max_selections;
  if (max < min) return invalid({ maxSelections: "Must be greater than or equal to minSelections." });
  const columns: Record<string, string> = { slug: "slug", title: "title", instructions: "instructions", minSelections: "min_selections", maxSelections: "max_selections", imageConfig: "image_config", sortOrder: "sort_order" };
  const keys = Object.keys(value).filter((key) => columns[key]);
  const stored = keys.map((key) => {
    if (key === "instructions") return blankToNull(value[key]);
    if (key === "imageConfig") return JSON.stringify(value[key]);
    return value[key];
  });
  try {
    await env.DB.prepare(`UPDATE polls SET ${keys.map((key) => `${columns[key]} = ?`).join(", ")} WHERE id = ?`).bind(...stored, poll.row.id).run();
  } catch (err) {
    if (isUnique(err)) return error(409, "A poll with this slug already exists on the screening.", { field: "slug" });
    throw err;
  }
  const next = await requirePoll(env, found.row.id, typeof value.slug === "string" ? value.slug : pollSlug);
  if ("response" in next) return next.response;
  return pollResponse(env, found.row, next.row);
}

async function deletePoll(env: Env, slug: string, pollSlug: string) {
  const found = await requireScreening(env, slug);
  if ("response" in found) return found.response;
  const poll = await requirePoll(env, found.row.id, pollSlug);
  if ("response" in poll) return poll.response;
  await env.DB.batch([
    env.DB.prepare("DELETE FROM votes WHERE poll_id = ?").bind(poll.row.id),
    env.DB.prepare("DELETE FROM options WHERE poll_id = ?").bind(poll.row.id),
    env.DB.prepare("DELETE FROM polls WHERE id = ?").bind(poll.row.id),
  ]);
  return json({ deleted: true, slug: pollSlug });
}

async function listOptions(env: Env, slug: string, pollSlug: string) {
  const found = await requireScreening(env, slug);
  if ("response" in found) return found.response;
  const poll = await requirePoll(env, found.row.id, pollSlug);
  if ("response" in poll) return poll.response;
  return json({ options: await optionsFor(env, poll.row.id) });
}

async function createOption(request: Request, env: Env, slug: string, pollSlug: string) {
  const found = await requireScreening(env, slug);
  if ("response" in found) return found.response;
  const poll = await requirePoll(env, found.row.id, pollSlug);
  if ("response" in poll) return poll.response;
  const body = await readBody(request);
  if ("response" in body) return body.response;
  const parsed = validateObject(optionWrite, body.value, "create");
  if (!parsed.ok) return invalid(parsed.fields);
  const value = parsed.value;
  const keys = value.imageKeys as string[];
  const keyError = await assertKeys(env, found.row.id, keys);
  if (keyError) return invalid({ imageKeys: keyError });
  const sortOrder = typeof value.sortOrder === "number" ? value.sortOrder : await nextSort(env, "SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM options WHERE poll_id = ?", poll.row.id);
  const id = crypto.randomUUID();
  await env.DB.prepare("INSERT INTO options (id, poll_id, title, description, image_keys, sort_order) VALUES (?, ?, ?, ?, ?, ?)").bind(id, poll.row.id, value.title, blankToNull(value.description), JSON.stringify(keys), sortOrder).run();
  const option = await requireOption(env, poll.row.id, id);
  if ("response" in option) return option.response;
  return json(presentOption(option.row), 201, { Location: `/api/admin/screenings/${encodeURIComponent(slug)}/polls/${encodeURIComponent(pollSlug)}/options/${encodeURIComponent(id)}` });
}

async function readOption(env: Env, slug: string, pollSlug: string, optionId: string) {
  const located = await locateOption(env, slug, pollSlug, optionId);
  if ("response" in located) return located.response;
  return json(presentOption(located.option));
}

async function updateOption(request: Request, env: Env, slug: string, pollSlug: string, optionId: string) {
  const located = await locateOption(env, slug, pollSlug, optionId);
  if ("response" in located) return located.response;
  const body = await readBody(request);
  if ("response" in body) return body.response;
  const parsed = validateObject(optionPatch, body.value, "patch");
  if (!parsed.ok) return invalid(parsed.fields);
  const value = parsed.value;
  if (Array.isArray(value.imageKeys)) {
    const keyError = await assertKeys(env, located.screening.id, value.imageKeys as string[]);
    if (keyError) return invalid({ imageKeys: keyError });
  }
  const columns: Record<string, string> = { title: "title", description: "description", imageKeys: "image_keys", sortOrder: "sort_order" };
  const keys = Object.keys(value).filter((key) => columns[key]);
  const stored = keys.map((key) => {
    if (key === "description") return blankToNull(value[key]);
    if (key === "imageKeys") return JSON.stringify(value[key]);
    return value[key];
  });
  await env.DB.prepare(`UPDATE options SET ${keys.map((key) => `${columns[key]} = ?`).join(", ")} WHERE id = ?`).bind(...stored, optionId).run();
  const option = await requireOption(env, located.poll.id, optionId);
  if ("response" in option) return option.response;
  return json(presentOption(option.row));
}

async function deleteOption(env: Env, slug: string, pollSlug: string, optionId: string) {
  const located = await locateOption(env, slug, pollSlug, optionId);
  if ("response" in located) return located.response;
  await env.DB.batch([
    env.DB.prepare("DELETE FROM votes WHERE option_id = ?").bind(optionId),
    env.DB.prepare("DELETE FROM options WHERE id = ?").bind(optionId),
  ]);
  return json({ deleted: true, id: optionId });
}

async function locateOption(env: Env, slug: string, pollSlug: string, optionId: string): Promise<Failure | { screening: ScreeningRow; poll: PollRow; option: OptionRow }> {
  const found = await requireScreening(env, slug);
  if ("response" in found) return found;
  const poll = await requirePoll(env, found.row.id, pollSlug);
  if ("response" in poll) return poll;
  const option = await requireOption(env, poll.row.id, optionId);
  if ("response" in option) return option;
  return { screening: found.row, poll: poll.row, option: option.row };
}

async function uploadImage(request: Request, env: Env, slug: string) {
  const found = await requireScreening(env, slug);
  if ("response" in found) return found.response;
  const contentType = imageContentType(request.headers.get("content-type"));
  if (!contentType) return error(415, "Send an image Content-Type: image/jpeg, image/png, image/webp, image/gif, or image/svg+xml.");
  const filename = safeFilename(request.headers.get("X-Filename") || "");
  if (!filename) return invalid({ "X-Filename": "Send a basename of letters, numbers, dots, hyphens, and underscores." });
  const declared = Number(request.headers.get("content-length") || 0);
  if (declared > MAX_IMAGE_BYTES) return error(413, "Images must be 8 MiB or smaller.");
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (!bytes.byteLength) return error(400, "Image body is empty.");
  if (bytes.byteLength > MAX_IMAGE_BYTES) return error(413, "Images must be 8 MiB or smaller.");
  const key = imageKey(found.row.id, filename);
  await env.MEDIA.put(key, bytes, { httpMetadata: { contentType } });
  const summary = presentScreeningSummary(found.row);
  return json({ key, contentType, url: assetUrl(key), links: { screening: summary.links.self } }, 201);
}

async function codeCounts(env: Env, slug: string) {
  const found = await requireScreening(env, slug);
  if ("response" in found) return found.response;
  const row = await env.DB.prepare("SELECT COUNT(*) AS total, COALESCE(SUM(CASE WHEN used_at IS NOT NULL THEN 1 ELSE 0 END), 0) AS used FROM vote_codes WHERE screening_id = ?").bind(found.row.id).first<{ total: number; used: number }>();
  const total = Number(row?.total || 0);
  const used = Number(row?.used || 0);
  return json({ total, used, unused: total - used });
}

async function addCodes(request: Request, env: Env, slug: string) {
  const found = await requireScreening(env, slug);
  if ("response" in found) return found.response;
  const parsed = await readCodes(request);
  if ("response" in parsed) return parsed.response;
  const created: string[] = [];
  const alreadyPresent: string[] = [];
  const conflicts: string[] = [];
  const pending: { code: string; hash: string }[] = [];
  for (const code of parsed.codes) {
    const hash = await hashCode(code);
    const existing = await env.DB.prepare("SELECT screening_id FROM vote_codes WHERE code_hash = ?").bind(hash).first<{ screening_id: string }>();
    if (!existing) pending.push({ code, hash });
    else if (existing.screening_id === found.row.id) alreadyPresent.push(code);
    else conflicts.push(code);
  }
  if (conflicts.length) return error(409, "Some codes already belong to another screening. Nothing was stored.", { conflicts });
  if (pending.length) {
    await env.DB.batch(pending.map((item) => env.DB.prepare("INSERT OR IGNORE INTO vote_codes (code_hash, screening_id) VALUES (?, ?)").bind(item.hash, found.row.id)));
    created.push(...pending.map((item) => item.code));
  }
  return json({ created, alreadyPresent });
}

async function deleteCodes(request: Request, env: Env, slug: string) {
  const found = await requireScreening(env, slug);
  if ("response" in found) return found.response;
  const parsed = await readCodes(request);
  if ("response" in parsed) return parsed.response;
  const deleted: string[] = [];
  const used: string[] = [];
  const missing: string[] = [];
  for (const code of parsed.codes) {
    const hash = await hashCode(code);
    const existing = await env.DB.prepare("SELECT screening_id, used_at FROM vote_codes WHERE code_hash = ?").bind(hash).first<{ screening_id: string; used_at: string | null }>();
    if (!existing || existing.screening_id !== found.row.id) missing.push(code);
    else if (existing.used_at) used.push(code);
    else {
      await env.DB.prepare("DELETE FROM vote_codes WHERE code_hash = ? AND screening_id = ? AND used_at IS NULL").bind(hash, found.row.id).run();
      deleted.push(code);
    }
  }
  return json({ deleted, used, missing });
}

async function readCodes(request: Request): Promise<Failure | { codes: string[] }> {
  const body = await readBody(request);
  if ("response" in body) return body;
  const parsed = validateObject(voteCodesWrite, body.value, "create");
  if (!parsed.ok) return { response: invalid(parsed.fields) };
  const codes = [...new Set((parsed.value.codes as string[]).map((code) => normalizeCode(code)))];
  return { codes };
}
