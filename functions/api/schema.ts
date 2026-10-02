import { imageCycleDefault, imageCycleMax, imageCycleMin } from "../admin/present";

const SLUG = "^[a-z0-9]+(?:-[a-z0-9]+)*$";
const SLUG_MESSAGE = "Use lowercase letters, numbers, and single hyphens.";
const TIMESTAMP = "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d+)?(?:Z|[+-]\\d{2}:\\d{2})$";
const TIMESTAMP_MESSAGE = "Use an ISO 8601 timestamp with seconds and a timezone, such as 2026-05-01T18:00:00-07:00.";
const RATIO = "^\\d+(?:\\.\\d+)?:\\d+(?:\\.\\d+)?$";

type StringField = {
  type: "string";
  required?: boolean;
  nullable?: boolean;
  description: string;
  example?: string | null;
  pattern?: string;
  patternMessage?: string;
  minLength?: number;
  maxLength?: number;
  format?: "date-time";
  enum?: readonly string[];
  default?: string | null;
};

type IntegerField = {
  type: "integer";
  required?: boolean;
  description: string;
  example?: number;
  minimum?: number;
  maximum?: number;
  default?: number;
};

type BooleanField = {
  type: "boolean";
  required?: boolean;
  description: string;
  example?: boolean;
  default?: boolean;
};

type StringArrayField = {
  type: "stringArray";
  required?: boolean;
  description: string;
  example?: string[];
  minItems?: number;
  maxItems?: number;
  itemMinLength?: number;
  itemMaxLength?: number;
  itemPattern?: string;
  itemPatternMessage?: string;
  default?: string[];
};

type ImageConfigField = {
  type: "imageConfig";
  required?: boolean;
  description: string;
  default?: { aspectRatio: string; cycle: number };
};

type Field = StringField | IntegerField | BooleanField | StringArrayField | ImageConfigField;

type ObjectSchema = {
  description: string;
  fields: Record<string, Field>;
  refine?: (value: Record<string, unknown>, mode: "create" | "patch") => Record<string, string>;
};

export type Validation =
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; fields: Record<string, string> };

const imageConfigDescription = "How the ballot frames and swaps stills. aspectRatio is width:height, such as 16:9 for film or 2:3 for a poster, and the public ballot uses it as the frame. cycle is how many seconds each still stays on screen before the next one. It is an integer from 1 to 60 and defaults to 2. An option shows every image uploaded for it, and more than one still crossfades. The API does not measure those files or check them against the aspect ratio.";

const votingField: StringField = {
  type: "string",
  description: "scheduled opens and closes at this poll's startAt and stopAt. open stores picks until you change it. closed leaves picks unchanged until you change it.",
  example: "scheduled",
  enum: ["scheduled", "open", "closed"],
  default: "scheduled",
};

export const screeningWrite: ObjectSchema = {
  description: "Fields required to create a screening. startAt and stopAt are the screening window. A new poll copies that window, then keeps its own voting schedule.",
  fields: {
    slug: { type: "string", required: true, description: "Public id used in /s/{slug} and /api/screenings/{slug}.", example: "spring-screening", pattern: SLUG, patternMessage: SLUG_MESSAGE, maxLength: 64 },
    title: { type: "string", required: true, description: "Name shown on the ballot.", example: "Spring Screening", minLength: 1, maxLength: 200 },
    venue: { type: "string", nullable: true, description: "Optional place name. Send null on update to clear it.", example: "Practice Theater", maxLength: 200, default: null },
    timezone: { type: "string", description: "IANA timezone label stored with the screening. Poll startAt and stopAt already include an offset.", example: "America/Los_Angeles", minLength: 1, maxLength: 64, default: "America/Los_Angeles" },
    startAt: { type: "string", required: true, description: TIMESTAMP_MESSAGE, example: "2026-05-01T18:00:00-07:00", pattern: TIMESTAMP, patternMessage: TIMESTAMP_MESSAGE, format: "date-time" },
    stopAt: { type: "string", required: true, description: TIMESTAMP_MESSAGE, example: "2026-05-01T23:00:00-07:00", pattern: TIMESTAMP, patternMessage: TIMESTAMP_MESSAGE, format: "date-time" },
  },
  refine: (value) => dateOrder(value),
};

export const screeningPatch: ObjectSchema = {
  description: "Any subset of screening fields. Send null for venue or bannerImageKey to clear it. At least one field is required.",
  fields: {
    slug: screeningWrite.fields.slug,
    title: screeningWrite.fields.title,
    venue: screeningWrite.fields.venue,
    timezone: screeningWrite.fields.timezone,
    startAt: screeningWrite.fields.startAt,
    stopAt: screeningWrite.fields.stopAt,
    bannerImageKey: { type: "string", nullable: true, description: "Key returned by uploadScreeningImage, or null to remove the banner. The key must be {screeningId}/{filename} for this screening.", example: null },
  },
  refine: (value) => dateOrder(value),
};

export const pollWrite: ObjectSchema = {
  description: "A poll belongs to one screening and has its own voting window. Saved picks are stored as the voter changes them. minSelections and maxSelections decide which of those picks are included in results. Omitting startAt or stopAt copies the screening window.",
  fields: {
    slug: { type: "string", required: true, description: "Stable id for this poll within the screening.", example: "best-film", pattern: SLUG, patternMessage: SLUG_MESSAGE, maxLength: 64 },
    title: { type: "string", required: true, description: "Heading shown for this poll.", example: "Best Film", minLength: 1, maxLength: 200 },
    instructions: { type: "string", nullable: true, description: "Optional text under the heading. Send null to clear it.", example: "One vote for the film you want to win.", maxLength: 2000, default: null },
    minSelections: { type: "integer", description: "Fewest options a counted ballot includes. Defaults to 1. Picks below this are stored and omitted from results. When omitted and maxSelections is set, maxSelections must still be at least this value. Zero counts a blank poll.", example: 1, minimum: 0, maximum: 100, default: 1 },
    maxSelections: { type: "integer", description: "Most options a counted ballot includes. Defaults to minSelections. Picks above this are stored and omitted from results.", example: 1, minimum: 0, maximum: 100 },
    imageConfig: { type: "imageConfig", description: imageConfigDescription, default: { aspectRatio: "16:9", cycle: imageCycleDefault } },
    sortOrder: { type: "integer", description: "Position among this screening's polls. Lower numbers come first. Defaults to the next position.", example: 0, minimum: 0, maximum: 10000 },
    startAt: { type: "string", description: "When this poll opens if voting is scheduled. Defaults to the screening startAt.", example: "2026-05-01T18:00:00-07:00", pattern: TIMESTAMP, patternMessage: TIMESTAMP_MESSAGE, format: "date-time" },
    stopAt: { type: "string", description: "When this poll closes if voting is scheduled. Defaults to the screening stopAt. To stop in a number of minutes, set voting to scheduled, set startAt to now if it is still in the future, and set stopAt to that many minutes from now.", example: "2026-05-01T23:00:00-07:00", pattern: TIMESTAMP, patternMessage: TIMESTAMP_MESSAGE, format: "date-time" },
    voting: votingField,
  },
  refine: (value, mode) => ({ ...selectionOrder(value, mode), ...dateOrder(value) }),
};

export const pollPatch: ObjectSchema = {
  description: "Any subset of poll fields. At least one field is required.",
  fields: {
    slug: pollWrite.fields.slug,
    title: pollWrite.fields.title,
    instructions: pollWrite.fields.instructions,
    minSelections: pollWrite.fields.minSelections,
    maxSelections: pollWrite.fields.maxSelections,
    imageConfig: { type: "imageConfig", description: imageConfigDescription },
    sortOrder: pollWrite.fields.sortOrder,
    startAt: pollWrite.fields.startAt,
    stopAt: pollWrite.fields.stopAt,
    voting: votingField,
  },
  refine: (value, mode) => ({ ...selectionOrder(value, mode), ...dateOrder(value) }),
};

export const optionWrite: ObjectSchema = {
  description: "An option on a poll. Upload images first, then store the returned keys here.",
  fields: {
    title: { type: "string", required: true, description: "Name shown on the ballot.", example: "Orange Hour", minLength: 1, maxLength: 200 },
    description: { type: "string", nullable: true, description: "Optional supporting text. Send null to clear it.", example: "Team Halftone.", maxLength: 2000, default: null },
    imageKeys: { type: "stringArray", description: "Keys returned by uploadScreeningImage, in display order. Sending this list replaces the option's images. The same key may be reused by more than one option.", example: ["00000000-0000-4000-8000-000000000000/orange-hour-1.jpg"], maxItems: 12, itemMinLength: 1, itemMaxLength: 300, default: [] },
    sortOrder: { type: "integer", description: "Position among this poll's options. Lower numbers come first. Defaults to the next position.", example: 0, minimum: 0, maximum: 10000 },
  },
};

export const optionPatch: ObjectSchema = {
  description: "Any subset of option fields. imageKeys, when present, replaces the whole list. At least one field is required.",
  fields: {
    title: optionWrite.fields.title,
    description: optionWrite.fields.description,
    imageKeys: optionWrite.fields.imageKeys,
    sortOrder: optionWrite.fields.sortOrder,
  },
};

export const voteCodeGenerate: ObjectSchema = {
  description: "How many vote codes to create. The server chooses the codes. Each code is stored so it can be downloaded, and hashed for voting.",
  fields: {
    count: { type: "integer", required: true, description: "Number of new codes, from 1 to 500. Each code is five letters or digits. The alphabet omits 0, O, 1, I, and L. Spaces and hyphens are ignored when a voter types the code.", example: 25, minimum: 1, maximum: 500 },
  },
};

export const examples = {
  screeningCreate: {
    slug: "spring-screening",
    title: "Spring Screening",
    venue: "Practice Theater",
    timezone: "America/Los_Angeles",
    startAt: "2026-05-01T18:00:00-07:00",
    stopAt: "2026-05-01T23:00:00-07:00",
  },
  pollCreate: {
    slug: "best-film",
    title: "Best Film",
    instructions: "One vote for the film you want to win.",
    minSelections: 1,
    maxSelections: 1,
    imageConfig: { aspectRatio: "16:9", cycle: 2 },
    sortOrder: 0,
  },
  optionCreate: {
    title: "Orange Hour",
    description: "Team Halftone.",
    imageKeys: ["00000000-0000-4000-8000-000000000000/orange-hour-1.jpg"],
    sortOrder: 0,
  },
  codes: { count: 25 },
};

function dateOrder(value: Record<string, unknown>): Record<string, string> {
  if (typeof value.startAt !== "string" || typeof value.stopAt !== "string") return {};
  if (Date.parse(value.stopAt) <= Date.parse(value.startAt)) return { stopAt: "Must be after startAt." };
  return {};
}

function selectionOrder(value: Record<string, unknown>, mode: "create" | "patch"): Record<string, string> {
  if (mode === "create" && typeof value.maxSelections !== "number" && typeof value.minSelections === "number") value.maxSelections = value.minSelections;
  if (typeof value.minSelections === "number" && typeof value.maxSelections === "number" && value.maxSelections < value.minSelections) {
    return { maxSelections: "Must be greater than or equal to minSelections." };
  }
  return {};
}

export function validateObject(spec: ObjectSchema, input: unknown, mode: "create" | "patch"): Validation {
  if (input === null || typeof input !== "object" || Array.isArray(input)) return { ok: false, fields: { body: "Send a JSON object." } };
  const source = input as Record<string, unknown>;
  const fields: Record<string, string> = {};
  for (const key of Object.keys(source)) if (!spec.fields[key]) fields[key] = "Unknown field.";
  const value: Record<string, unknown> = {};
  for (const [name, field] of Object.entries(spec.fields)) {
    if (!Object.prototype.hasOwnProperty.call(source, name)) {
      if (mode === "create" && field.required) fields[name] = "Required.";
      else if (mode === "create" && "default" in field && field.default !== undefined) value[name] = field.default;
      continue;
    }
    const result = validateField(field, source[name]);
    if ("error" in result) fields[name] = result.error;
    else value[name] = result.value;
  }
  if (mode === "patch" && Object.keys(value).length === 0 && Object.keys(fields).length === 0) fields.body = "Provide at least one field.";
  if (Object.keys(fields).length === 0 && spec.refine) Object.assign(fields, spec.refine(value, mode));
  return Object.keys(fields).length ? { ok: false, fields } : { ok: true, value };
}

function validateField(field: Field, input: unknown): { value: unknown } | { error: string } {
  if (input === null && field.type === "string" && field.nullable) return { value: null };
  if (field.type === "string") return validateString(field, input);
  if (field.type === "integer") return validateInteger(field, input);
  if (field.type === "boolean") return typeof input === "boolean" ? { value: input } : { error: "Send true or false." };
  if (field.type === "stringArray") return validateStringArray(field, input);
  return validateImageConfig(input);
}

function validateString(field: StringField, input: unknown): { value: unknown } | { error: string } {
  if (typeof input !== "string") return { error: "Send a string." };
  const value = input.trim();
  if (field.nullable && value === "") return { value: null };
  if (field.minLength !== undefined && value.length < field.minLength) return { error: "Required." };
  if (field.maxLength !== undefined && value.length > field.maxLength) return { error: `Use at most ${field.maxLength} characters.` };
  if (field.enum && !field.enum.includes(value)) return { error: `Use ${field.enum.join(", ")}.` };
  if (field.pattern && !new RegExp(field.pattern).test(value)) return { error: field.patternMessage || "Does not match the required pattern." };
  if (field.format === "date-time" && Number.isNaN(Date.parse(value))) return { error: field.patternMessage || TIMESTAMP_MESSAGE };
  return { value };
}

function validateInteger(field: IntegerField, input: unknown): { value: unknown } | { error: string } {
  if (typeof input !== "number" || !Number.isInteger(input)) return { error: "Send an integer." };
  if (field.minimum !== undefined && input < field.minimum) return { error: `Must be at least ${field.minimum}.` };
  if (field.maximum !== undefined && input > field.maximum) return { error: `Must be at most ${field.maximum}.` };
  return { value: input };
}

function validateStringArray(field: StringArrayField, input: unknown): { value: unknown } | { error: string } {
  if (!Array.isArray(input) || input.some((item) => typeof item !== "string")) return { error: "Send an array of strings." };
  if (field.minItems !== undefined && input.length < field.minItems) return { error: `Provide at least ${field.minItems}.` };
  if (field.maxItems !== undefined && input.length > field.maxItems) return { error: `Provide at most ${field.maxItems}.` };
  const values: string[] = [];
  for (const item of input) {
    const value = item.trim();
    if (field.itemMinLength !== undefined && value.length < field.itemMinLength) return { error: "Items must not be empty." };
    if (field.itemMaxLength !== undefined && value.length > field.itemMaxLength) return { error: `Use at most ${field.itemMaxLength} characters in each item.` };
    if (field.itemPattern && !new RegExp(field.itemPattern).test(value)) return { error: field.itemPatternMessage || "An item does not match the required pattern." };
    values.push(value);
  }
  return { value: values };
}

function validateImageConfig(input: unknown): { value: unknown } | { error: string } {
  if (input === null || typeof input !== "object" || Array.isArray(input)) return { error: "Send an object with aspectRatio and cycle." };
  const source = input as Record<string, unknown>;
  const unknown = Object.keys(source).filter((key) => !["aspectRatio", "cycle"].includes(key));
  if (unknown.length) return { error: `Unknown field ${unknown[0]}.` };
  if (typeof source.aspectRatio !== "string" || !new RegExp(RATIO).test(source.aspectRatio.trim())) return { error: "aspectRatio must look like 16:9 or 2:3." };
  if (source.cycle !== undefined && (typeof source.cycle !== "number" || !Number.isInteger(source.cycle) || source.cycle < imageCycleMin || source.cycle > imageCycleMax)) return { error: `cycle must be an integer from ${imageCycleMin} to ${imageCycleMax}.` };
  return { value: { aspectRatio: source.aspectRatio.trim(), cycle: source.cycle === undefined ? imageCycleDefault : source.cycle } };
}

export type AdminRoute = {
  method: "GET" | "POST" | "PATCH" | "DELETE";
  parts: string[];
  operationId: string;
  summary: string;
  description: string;
  body?: keyof typeof requestSchemas;
  response: string;
  status: number;
};

const requestSchemas = {
  ScreeningWrite: screeningWrite,
  ScreeningPatch: screeningPatch,
  PollWrite: pollWrite,
  PollPatch: pollPatch,
  OptionWrite: optionWrite,
  OptionPatch: optionPatch,
  VoteCodeGenerate: voteCodeGenerate,
};

export const adminRoutes: AdminRoute[] = [
  { method: "GET", parts: [], operationId: "getAdminIndex", summary: "Discover admin operations", description: "Start here after authenticating. Follow workflows.createScreening in order to publish a ballot without guessing field names.", response: "AdminIndex", status: 200 },
  { method: "GET", parts: ["screenings"], operationId: "listScreenings", summary: "List screenings", description: "Each item links to the screening, its polls, image upload, vote codes, and results.", response: "ScreeningList", status: 200 },
  { method: "POST", parts: ["screenings"], operationId: "createScreening", summary: "Create a screening", description: "Create the screening, then upload images, add polls and options, and generate vote codes. A duplicate slug returns 409.", body: "ScreeningWrite", response: "Screening", status: 201 },
  { method: "GET", parts: ["screenings", ":slug"], operationId: "getScreening", summary: "Read a screening", description: "Returns the screening with its polls and options.", response: "Screening", status: 200 },
  { method: "PATCH", parts: ["screenings", ":slug"], operationId: "updateScreening", summary: "Update a screening", description: "Changes only the fields you send. Set bannerImageKey to a key from uploadScreeningImage, or null to remove the banner. Voting is controlled on each poll.", body: "ScreeningPatch", response: "Screening", status: 200 },
  { method: "DELETE", parts: ["screenings", ":slug"], operationId: "deleteScreening", summary: "Delete a screening", description: "Deletes the screening, its polls, options, vote codes, and votes, then deletes images stored for that screening.", response: "Deleted", status: 200 },
  { method: "GET", parts: ["screenings", ":slug", "results"], operationId: "getScreeningResults", summary: "Read vote results", description: "Totals selections for each option. A vote code counts for a poll only when its saved pick count is between that poll's minSelections and maxSelections. Polls stay in ballot order. Options within a poll are ordered by vote count, then ballot order. ballots is the number of distinct vote codes that count for at least one poll. A poll's votes can exceed ballots when that poll allows more than one selection. Options with no votes are included. now is the server time. Each poll includes its voting window. The results page requests this about every 3 seconds while it is open.", response: "ScreeningResults", status: 200 },
  { method: "GET", parts: ["screenings", ":slug", "polls"], operationId: "listPolls", summary: "List polls", description: "Polls are ordered by sortOrder, then title. Each poll includes its options.", response: "PollList", status: 200 },
  { method: "POST", parts: ["screenings", ":slug", "polls"], operationId: "createPoll", summary: "Create a poll", description: "Add a poll to a screening. A duplicate poll slug within the screening returns 409.", body: "PollWrite", response: "Poll", status: 201 },
  { method: "GET", parts: ["screenings", ":slug", "polls", ":pollSlug"], operationId: "getPoll", summary: "Read a poll", description: "Returns one poll and its options.", response: "Poll", status: 200 },
  { method: "PATCH", parts: ["screenings", ":slug", "polls", ":pollSlug"], operationId: "updatePoll", summary: "Update a poll", description: "Changes only the fields you send. When both selection bounds are present, maxSelections must be at least minSelections. When only one is sent, it is checked against the stored value of the other. Set voting to open or closed to start or stop this poll immediately, or scheduled to follow its startAt and stopAt. To stop in a number of minutes, set voting to scheduled and stopAt to that time. If startAt is still in the future, set it to now so the poll stays open until the new stopAt.", body: "PollPatch", response: "Poll", status: 200 },
  { method: "DELETE", parts: ["screenings", ":slug", "polls", ":pollSlug"], operationId: "deletePoll", summary: "Delete a poll", description: "Deletes the poll, its options, and votes cast in that poll. Uploaded images stay in storage so other options can keep using them.", response: "Deleted", status: 200 },
  { method: "GET", parts: ["screenings", ":slug", "polls", ":pollSlug", "options"], operationId: "listOptions", summary: "List options", description: "Options are ordered by sortOrder, then title.", response: "OptionList", status: 200 },
  { method: "POST", parts: ["screenings", ":slug", "polls", ":pollSlug", "options"], operationId: "createOption", summary: "Create an option", description: "imageKeys must already have been uploaded to this screening. The response id is what voters save.", body: "OptionWrite", response: "Option", status: 201 },
  { method: "GET", parts: ["screenings", ":slug", "polls", ":pollSlug", "options", ":optionId"], operationId: "getOption", summary: "Read an option", description: "Returns one option.", response: "Option", status: 200 },
  { method: "PATCH", parts: ["screenings", ":slug", "polls", ":pollSlug", "options", ":optionId"], operationId: "updateOption", summary: "Update an option", description: "Changes only the fields you send. imageKeys replaces the entire still list.", body: "OptionPatch", response: "Option", status: 200 },
  { method: "DELETE", parts: ["screenings", ":slug", "polls", ":pollSlug", "options", ":optionId"], operationId: "deleteOption", summary: "Delete an option", description: "Deletes the option and votes for it. Uploaded images stay in storage.", response: "Deleted", status: 200 },
  { method: "POST", parts: ["screenings", ":slug", "images"], operationId: "uploadScreeningImage", summary: "Upload an image", description: "Send the raw image bytes. Set Content-Type to an allowed image type and X-Filename to the basename. The response key is what you store as bannerImageKey or in imageKeys. Uploading the same filename again replaces the object.", response: "ImageCreated", status: 201 },
  { method: "GET", parts: ["screenings", ":slug", "codes"], operationId: "getVoteCodes", summary: "List vote codes", description: "Returns every code whose text was stored, in code order, plus counts. used on a code is true after that code has saved a pick. The same code can change polls that are still open. unlisted counts older rows that still work but have no saved text, so they are omitted from codes. Each code's public entry URL is https://vote.sandiego48.com/c/{code}.", response: "CodeList", status: 200 },
  { method: "POST", parts: ["screenings", ":slug", "codes"], operationId: "generateVoteCodes", summary: "Generate vote codes", description: "Creates count new codes and returns them in created. A code is unique across the site. The text is stored for download. Voting compares a SHA-256 hash, and spaces and hyphens in what the voter types are ignored.", body: "VoteCodeGenerate", response: "CodeGenerateResult", status: 200 },
  { method: "DELETE", parts: ["screenings", ":slug", "codes"], operationId: "deleteVoteCodes", summary: "Delete unused vote codes", description: "Removes every unused code for this screening. Send no body. Used codes stay, and votes are not deleted. deleted is how many rows were removed.", response: "CodeDeleteResult", status: 200 },
  { method: "POST", parts: ["screenings", ":slug", "reset"], operationId: "resetVoting", summary: "Reset voting", description: "Deletes every vote and every vote code for this screening. Polls, options, images, and the voting schedule stay. Send no body. codes is how many vote codes were removed. votes is how many stored picks were removed.", response: "VotingReset", status: 200 },
];

export function adminPath(route: AdminRoute) {
  const segments = route.parts.map((part) => (part.startsWith(":") ? `{${part.slice(1)}}` : part));
  return "/api/admin" + (segments.length ? `/${segments.join("/")}` : "");
}

export function matchAdminRoute(method: string, parts: string[]) {
  const samePath = adminRoutes.filter((route) => route.parts.length === parts.length && route.parts.every((part, index) => part.startsWith(":") || part === parts[index]));
  if (!samePath.length) return { ok: false as const, status: 404 as const };
  const found = samePath.find((route) => route.method === method);
  if (!found) return { ok: false as const, status: 405 as const, allow: [...new Set(samePath.map((route) => route.method))] };
  const params: Record<string, string> = {};
  found.parts.forEach((part, index) => { if (part.startsWith(":")) params[part.slice(1)] = parts[index]; });
  return { ok: true as const, operationId: found.operationId, params };
}

export function publicIndex() {
  return {
    title: "San Diego 48 voting API",
    openapi: "/api/openapi.json",
    links: {
      openapi: { href: "/api/openapi.json", method: "GET" },
      enter: { href: "/api/enter", method: "POST" },
      vote: { href: "/api/vote", method: "POST" },
      state: { href: "/api/state", method: "POST" },
      screening: { href: "/api/screenings/{slug}", method: "GET" },
      admin: { href: "/api/admin", method: "GET" },
    },
  };
}

export function adminIndex() {
  return {
    title: "San Diego 48 admin API",
    openapi: "/api/openapi.json",
    authentication: {
      type: "cloudflare-access",
      browser: "Open /admin after Cloudflare Access signs you in. Allowed emails are any @kilna.com address and sandiego@48hourfilm.com.",
      serviceToken: {
        headers: ["CF-Access-Client-Id", "CF-Access-Client-Secret"],
        description: "Agents send the Access service token pair. Access checks it and adds Cf-Access-Jwt-Assertion before this API runs.",
      },
    },
    links: {
      screenings: { href: "/api/admin/screenings", method: "GET" },
      openapi: { href: "/api/openapi.json", method: "GET" },
    },
    workflows: {
      createScreening: [
        { step: "Create the screening.", method: "POST", href: "/api/admin/screenings", operationId: "createScreening" },
        { step: "Upload each still and the banner. Keep the key from each response.", method: "POST", href: "/api/admin/screenings/{slug}/images", operationId: "uploadScreeningImage" },
        { step: "Attach the banner by patching bannerImageKey.", method: "PATCH", href: "/api/admin/screenings/{slug}", operationId: "updateScreening" },
        { step: "Add each poll.", method: "POST", href: "/api/admin/screenings/{slug}/polls", operationId: "createPoll" },
        { step: "Add each option. imageKeys are upload keys, not public URLs.", method: "POST", href: "/api/admin/screenings/{slug}/polls/{pollSlug}/options", operationId: "createOption" },
        { step: "Generate vote codes. Send count. created lists the new codes.", method: "POST", href: "/api/admin/screenings/{slug}/codes", operationId: "generateVoteCodes" },
        { step: "Download every stored code, including ones generated earlier.", method: "GET", href: "/api/admin/screenings/{slug}/codes", operationId: "getVoteCodes" },
      ],
    },
  };
}

function fieldSchema(field: Field): Record<string, unknown> {
  if (field.type === "string") {
    return compact({ type: field.nullable ? ["string", "null"] : "string", description: field.description, enum: field.enum, pattern: field.pattern, minLength: field.minLength, maxLength: field.maxLength, format: field.format, examples: field.example !== undefined ? [field.example] : undefined });
  }
  if (field.type === "integer") return compact({ type: "integer", description: field.description, minimum: field.minimum, maximum: field.maximum, examples: field.example !== undefined ? [field.example] : undefined });
  if (field.type === "boolean") return compact({ type: "boolean", description: field.description, examples: field.example !== undefined ? [field.example] : undefined });
  if (field.type === "stringArray") {
    return compact({
      type: "array",
      description: field.description,
      minItems: field.minItems,
      maxItems: field.maxItems,
      items: compact({ type: "string", minLength: field.itemMinLength, maxLength: field.itemMaxLength, pattern: field.itemPattern }),
      examples: field.example ? [field.example] : undefined,
    });
  }
  return { $ref: "#/components/schemas/ImageConfig", description: field.description };
}

function objectSchema(spec: ObjectSchema, mode: "create" | "patch") {
  const required = mode === "create" ? Object.entries(spec.fields).filter(([, field]) => field.required).map(([name]) => name) : [];
  return compact({
    type: "object",
    description: spec.description,
    additionalProperties: false,
    required: required.length ? required : undefined,
    properties: Object.fromEntries(Object.entries(spec.fields).map(([name, field]) => [name, fieldSchema(field)])),
  });
}

function compact(value: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined));
}

const imageConfigSchema = {
  type: "object",
  description: imageConfigDescription,
  additionalProperties: false,
  required: ["aspectRatio"],
  properties: {
    aspectRatio: { type: "string", pattern: RATIO, description: "Width:height, such as 16:9 or 2:3.", examples: ["16:9"] },
    cycle: { type: "integer", minimum: imageCycleMin, maximum: imageCycleMax, description: "Seconds each still stays on screen. The ballot crossfades to the next uploaded image after this many seconds when an option has more than one.", default: imageCycleDefault },
  },
};

const errorSchema = {
  type: "object",
  required: ["error"],
  properties: {
    error: { type: "string" },
    documentation: { type: "string", description: "OpenAPI document for this API." },
    field: { type: "string" },
    fields: { type: "object", additionalProperties: { type: "string" }, description: "Validation messages keyed by request field." },
    conflicts: { type: "array", items: { type: "string" } },
  },
};

const votingFields = {
  startAt: { type: "string", format: "date-time", description: "When this poll opens if voting is scheduled." },
  stopAt: { type: "string", format: "date-time", description: "When this poll closes if voting is scheduled." },
  voting: { type: "string", enum: ["scheduled", "open", "closed"], description: "scheduled follows this poll's startAt and stopAt. open stores picks until changed. closed leaves picks unchanged until changed." },
  votingOpen: { type: "boolean", description: "Whether a pick saved at this response would be stored." },
};

export function openapiDocument() {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const route of adminRoutes) addPath(paths, adminPath(route), route.method, adminOperation(route));
  addPath(paths, "/api", "GET", publicOperation("getApiIndex", "Discover the API", "Public entry point. Follow links.openapi, then links.admin for screening setup.", "PublicIndex", { "405": "Use GET." }));
  addPath(paths, "/api/openapi.json", "GET", publicOperation("getOpenApi", "OpenAPI document", "Machine-readable contract for the public and admin APIs.", "OpenApiDocument", { "405": "Use GET." }));
  addPath(paths, "/api/enter", "POST", {
    ...publicOperation("enterWithCode", "Open a ballot with a vote code", "Trims and uppercases the code, hashes it, and returns the screening slug when that code exists. A code that already voted still enters, and selections lists its current option ids by poll id. Does not check whether polls are open. The same entry is what /c/{code} performs. The response is an error string, not field names.", "EnterResult", {
      "400": "The body is not JSON or the code is empty.",
      "403": "No vote code matches.",
    }),
    requestBody: jsonBody("EnterRequest", false),
  });
  addPath(paths, "/api/vote", "POST", {
    ...publicOperation("castVote", "Save picks", "One code covers every poll in the screening. selections maps each poll id being saved to its current option ids. Only those polls are replaced. Each poll stores picks on its own: voting open always stores them, voting closed leaves them unchanged, and voting scheduled stores them only while the request time is within that poll's startAt and stopAt. Minimum and maximum selections are not checked here. Results include a code's picks for a poll only when the saved count is inside that range. The code is marked used on the first saved change. Overlapping saves of the same code can both be recorded. A successful save, and a save rejected because voting is not open, includes now, polls, and selections for the code after the write. Other errors are a single error string.", "VoteResult", {
      "400": "screeningId, code, or selections is missing, a poll id is not on this screening, or an option id is not on that poll.",
      "403": "The code is not on this screening, or none of the polls being saved are open.",
    }),
    requestBody: jsonBody("VoteRequest", false),
  });
  addPath(paths, "/api/state", "POST", {
    ...publicOperation("readBallotState", "Read the stored ballot", "Returns this code's stored picks and each poll's voting window at the server's current time. The ballot posts here about every 3 seconds while the tab is visible, and again after a save that does not return this snapshot. It does not change votes. A saved count outside minSelections and maxSelections is still returned; the ballot tells the voter that vote does not count.", "BallotState", {
      "400": "The body is not JSON or the code is empty.",
      "403": "No vote code matches.",
    }),
    requestBody: jsonBody("EnterRequest", false),
  });
  addPath(paths, "/api/screenings/{slug}", "GET", {
    ...publicOperation("getPublicScreening", "Read a public ballot", "Returns the screening voters see. No vote code is required. Image fields are public asset URLs. The HTML page at /s/{slug} is a separate gate and sends the browser back to / unless this session entered a code for that slug.", "PublicScreening", { "404": "No screening uses this slug." }),
    parameters: [pathParam("slug", "Screening slug.")],
  });
  addPath(paths, "/api/assets/{path}", "GET", publicOperation("getAsset", "Read an uploaded image", "path is the storage key with each segment encoded. The response Content-Type is the stored image type. SVG responses include a sandbox Content-Security-Policy. Cache-Control is public, max-age=3600, so replacing a file can stay cached for an hour. Admin resources return a ready-to-use url, so callers do not need to build this path.", "Asset", { "404": "No object is stored at this key." }));

  return {
    openapi: "3.1.0",
    info: {
      title: "San Diego 48 voting API",
      version: "0.1.0",
      description: "Start at GET /api. To create a screening and its polls, authenticate and follow the workflow on GET /api/admin. Field names, required values, and errors are defined by this document. The admin UI at /admin calls these same routes.",
    },
    servers: [{ url: "/" }],
    tags: [
      { name: "Discovery" },
      { name: "Voting" },
      { name: "Admin" },
    ],
    paths,
    components: {
      securitySchemes: {
        cfAccessClientId: {
          type: "apiKey",
          in: "header",
          name: "CF-Access-Client-Id",
          description: "Cloudflare Access service token client id. Send it with CF-Access-Client-Secret. Browsers sign in through Access instead of these headers.",
        },
        cfAccessClientSecret: {
          type: "apiKey",
          in: "header",
          name: "CF-Access-Client-Secret",
          description: "Cloudflare Access service token client secret. Pair it with CF-Access-Client-Id.",
        },
      },
      schemas: {
        ...Object.fromEntries(Object.entries(requestSchemas).map(([name, spec]) => [name, objectSchema(spec, name.endsWith("Patch") ? "patch" : "create")])),
        ImageConfig: imageConfigSchema,
        Error: errorSchema,
        PublicIndex: { type: "object", description: "Public discovery document returned by GET /api." },
        AdminIndex: { type: "object", description: "Admin discovery document. workflows.createScreening is the supported order of calls." },
        OpenApiDocument: { type: "object" },
        ScreeningList: { type: "object", required: ["screenings"], properties: { screenings: { type: "array", items: { $ref: "#/components/schemas/ScreeningSummary" } } } },
        ScreeningSummary: resourceSchema(["id", "slug", "title", "venue", "timezone", "startAt", "stopAt", "bannerImageKey", "bannerImage", "links"]),
        Screening: resourceSchema(["id", "slug", "title", "venue", "timezone", "startAt", "stopAt", "bannerImageKey", "bannerImage", "polls", "links"], { polls: { type: "array", items: { $ref: "#/components/schemas/Poll" } } }),
        PollList: { type: "object", required: ["polls"], properties: { polls: { type: "array", items: { $ref: "#/components/schemas/Poll" } } } },
        Poll: resourceSchema(["id", "slug", "title", "instructions", "minSelections", "maxSelections", "imageConfig", "sortOrder", "startAt", "stopAt", "voting", "votingOpen", "options", "links"], {
          imageConfig: { $ref: "#/components/schemas/ImageConfig" },
          options: { type: "array", items: { $ref: "#/components/schemas/Option" } },
          ...votingFields,
        }),
        OptionList: { type: "object", required: ["options"], properties: { options: { type: "array", items: { $ref: "#/components/schemas/Option" } } } },
        Option: resourceSchema(["id", "pollId", "title", "description", "imageKeys", "images", "sortOrder"]),
        ImageCreated: resourceSchema(["key", "contentType", "url", "links"]),
        ScreeningResults: {
          type: "object",
          required: ["now", "slug", "title", "ballots", "polls"],
          properties: {
            now: { type: "string", format: "date-time", description: "Server time when these totals were read." },
            slug: { type: "string" },
            title: { type: "string" },
            ballots: { type: "integer", description: "Distinct vote codes whose saved picks fall inside minSelections and maxSelections for at least one poll." },
            polls: { type: "array", items: { $ref: "#/components/schemas/PollResults" } },
          },
        },
        PollResults: {
          type: "object",
          required: ["id", "slug", "title", "votes", "voting", "votingOpen", "startAt", "stopAt", "options"],
          properties: {
            id: { type: "string" },
            slug: { type: "string" },
            title: { type: "string" },
            votes: { type: "integer", description: "Selections in this poll from ballots inside its minimum and maximum." },
            voting: { type: "string", enum: ["scheduled", "open", "closed"] },
            votingOpen: { type: "boolean", description: "Whether a pick saved at this response would be stored." },
            startAt: { type: "string", format: "date-time" },
            stopAt: { type: "string", format: "date-time" },
            options: { type: "array", items: { $ref: "#/components/schemas/OptionResults" } },
          },
        },
        OptionResults: {
          type: "object",
          required: ["id", "title", "votes"],
          properties: {
            id: { type: "string" },
            title: { type: "string" },
            votes: { type: "integer" },
          },
        },
        CodeList: {
          type: "object",
          required: ["total", "used", "unused", "unlisted", "codes"],
          properties: {
            total: { type: "integer", description: "Codes on this screening, including ones with no saved text." },
            used: { type: "integer", description: "Codes that have already voted." },
            unused: { type: "integer", description: "Codes that have not voted." },
            unlisted: { type: "integer", description: "Older codes with no saved text. They still work and are omitted from codes." },
            codes: { type: "array", items: { $ref: "#/components/schemas/VoteCode" } },
          },
        },
        VoteCode: {
          type: "object",
          required: ["code", "used"],
          properties: {
            code: { type: "string", description: "Five-character code to print on the ticket.", examples: ["K7NP4"] },
            used: { type: "boolean", description: "True after this code has saved a pick. The code can still change polls that are open." },
          },
        },
        CodeGenerateResult: {
          type: "object",
          required: ["created", "total", "used", "unused"],
          properties: {
            created: { type: "array", items: { type: "string" }, description: "Codes created by this request." },
            total: { type: "integer" },
            used: { type: "integer" },
            unused: { type: "integer" },
          },
        },
        CodeDeleteResult: {
          type: "object",
          required: ["deleted", "used"],
          properties: {
            deleted: { type: "integer", description: "Unused codes removed." },
            used: { type: "integer", description: "Used codes left in place." },
          },
        },
        VotingReset: {
          type: "object",
          required: ["codes", "votes"],
          properties: {
            codes: { type: "integer", description: "Vote codes removed, used and unused." },
            votes: { type: "integer", description: "Stored picks removed." },
          },
        },
        Deleted: { type: "object", required: ["deleted"], properties: { deleted: { type: "boolean" }, slug: { type: "string" }, id: { type: "string" } } },
        EnterRequest: { type: "object", required: ["code"], additionalProperties: false, properties: { code: { type: "string", description: "Vote code printed on the ticket. Leading and trailing spaces are ignored and letters are compared in uppercase.", examples: ["TEST-1001"] } } },
        EnterResult: { type: "object", required: ["slug", "title", "used", "selections"], properties: { slug: { type: "string" }, title: { type: "string" }, used: { type: "boolean", description: "True after this code has saved a pick." }, selections: { type: "object", additionalProperties: { type: "array", items: { type: "string" } }, description: "Current option ids by poll id, including picks outside the minimum and maximum. Empty when the code has not voted." }, error: { type: "string" } } },
        VoteRequest: { type: "object", required: ["screeningId", "code", "selections"], additionalProperties: false, properties: { screeningId: { type: "string", description: "Screening id from GET /api/screenings/{slug}." }, code: { type: "string" }, selections: { type: "object", additionalProperties: { type: "array", items: { type: "string" } }, description: "Map of poll id to chosen option ids." } } },
        VoteResult: { type: "object", properties: { ok: { type: "boolean" }, error: { type: "string" }, now: { type: "string", format: "date-time" }, polls: { type: "array", items: { $ref: "#/components/schemas/BallotPoll" } }, selections: { type: "object", additionalProperties: { type: "array", items: { type: "string" } } } } },
        BallotState: { type: "object", required: ["now", "slug", "title", "screeningId", "used", "polls", "selections"], properties: { now: { type: "string", format: "date-time", description: "Server time when this snapshot was read." }, slug: { type: "string" }, title: { type: "string" }, screeningId: { type: "string" }, used: { type: "boolean" }, polls: { type: "array", items: { $ref: "#/components/schemas/BallotPoll" } }, selections: { type: "object", additionalProperties: { type: "array", items: { type: "string" } }, description: "Stored option ids by poll id, including a count outside the minimum and maximum." } } },
        BallotPoll: { type: "object", required: ["id", "voting", "votingOpen", "startAt", "stopAt"], properties: { id: { type: "string" }, voting: { type: "string", enum: ["scheduled", "open", "closed"] }, votingOpen: { type: "boolean", description: "Whether a pick saved at this response would be stored." }, startAt: { type: "string", format: "date-time" }, stopAt: { type: "string", format: "date-time" } } },
        PublicScreening: { type: "object", description: "Ballot payload. Poll and option fields use camelCase. images and bannerImage are asset URLs." },
        Asset: { type: "string", format: "binary" },
      },
    },
  };
}

function resourceSchema(required: string[], extra: Record<string, unknown> = {}) {
  const properties: Record<string, unknown> = {};
  for (const name of required) properties[name] = extra[name] || { description: name };
  return { type: "object", required, properties };
}

function addPath(paths: Record<string, Record<string, unknown>>, path: string, method: string, operation: Record<string, unknown>) {
  paths[path] ||= {};
  paths[path][method.toLowerCase()] = operation;
}

function adminOperation(route: AdminRoute) {
  const parameters = route.parts.filter((part) => part.startsWith(":")).map((part) => pathParam(part.slice(1), `${part.slice(1)} path segment.`));
  const operation: Record<string, unknown> = {
    tags: ["Admin"],
    operationId: route.operationId,
    summary: route.summary,
    description: route.description,
    security: [{ cfAccessClientId: [], cfAccessClientSecret: [] }],
    parameters: parameters.length ? parameters : undefined,
    responses: responses(route.status, route.response),
  };
  if (route.body) operation.requestBody = jsonBody(route.body, true);
  if (route.operationId === "uploadScreeningImage") {
    operation.parameters = [...parameters, { name: "X-Filename", in: "header", required: true, schema: { type: "string", pattern: "^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$" }, description: "Basename to store. Letters, numbers, dots, hyphens, and underscores. The same filename replaces the previous object." }];
    operation.requestBody = {
      required: true,
      content: Object.fromEntries(["image/jpeg", "image/png", "image/webp", "image/gif", "image/svg+xml"].map((type) => [type, { schema: { type: "string", format: "binary" } }])),
    };
  }
  if (route.status === 201 && route.operationId !== "uploadScreeningImage") {
    const created = operation.responses as Record<string, { headers?: unknown }>;
    created[String(route.status)].headers = { Location: { schema: { type: "string" }, description: "URL of the created resource." } };
  }
  if (route.operationId === "uploadScreeningImage") {
    const uploadResponses = operation.responses as Record<string, unknown>;
    uploadResponses["413"] = errorResponse("The image is larger than 8 MiB.");
    uploadResponses["415"] = errorResponse("Content-Type is not an allowed image type.");
  }
  return compact(operation);
}

function publicOperation(operationId: string, summary: string, description: string, response: string, errors: Record<string, string> = {}) {
  const tag = operationId === "getApiIndex" || operationId === "getOpenApi" ? "Discovery" : "Voting";
  const success = operationId === "getAsset"
    ? { description: "Image bytes with the stored Content-Type.", content: { "application/octet-stream": { schema: { type: "string", format: "binary" } } } }
    : { description: "Success.", content: { "application/json": { schema: { $ref: `#/components/schemas/${response}` } } } };
  return compact({
    tags: [tag],
    operationId,
    summary,
    description,
    responses: {
      "200": success,
      ...Object.fromEntries(Object.entries(errors).map(([status, text]) => [status, operationId === "getAsset"
        ? { description: text, content: { "text/plain": { schema: { type: "string" } } } }
        : errorResponse(text)])),
    },
  });
}

function errorResponse(description: string) {
  return { description, content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } };
}

function responses(status: number, schema: string) {
  return {
    [String(status)]: { description: "Success.", content: { "application/json": { schema: { $ref: `#/components/schemas/${schema}` } } } },
    "400": errorResponse("The request is invalid. fields names each problem."),
    "401": errorResponse("Cloudflare Access did not authorize this request."),
    "404": errorResponse("No resource at this URL."),
    "405": errorResponse("This method is not allowed on this path."),
    "409": errorResponse("The slug or vote code conflicts with an existing record."),
  };
}

function jsonBody(schema: string, admin: boolean) {
  const example = schema === "ScreeningWrite" ? examples.screeningCreate : schema === "PollWrite" ? examples.pollCreate : schema === "OptionWrite" ? examples.optionCreate : schema === "VoteCodeGenerate" ? examples.codes : undefined;
  return {
    required: true,
    content: { "application/json": compact({ schema: { $ref: `#/components/schemas/${schema}` }, example: admin ? example : undefined }) },
  };
}

function pathParam(name: string, description: string) {
  return { name, in: "path", required: true, schema: { type: "string" }, description };
}
