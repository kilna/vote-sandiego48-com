type ImageConfig = { aspectRatio: string; min: number; max: number; cycle?: boolean };
type Option = { id: string; title: string; description: string | null; imageKeys: string[]; images: string[]; sortOrder: number };
type Poll = { id: string; slug: string; title: string; instructions: string | null; minSelections: number; maxSelections: number; imageConfig: ImageConfig; sortOrder: number; options: Option[] };
type Screening = {
  id: string;
  slug: string;
  title: string;
  venue: string | null;
  timezone: string;
  startAt: string;
  stopAt: string;
  bannerImageKey: string | null;
  bannerImage: string | null;
  polls: Poll[];
  links: { ballot: string };
};
type Summary = Omit<Screening, "polls" | "links"> & { links: { ballot: string } };
type CodeCounts = { total: number; used: number; unused: number };

const app = document.querySelector<HTMLDivElement>("#app")!;
const tokenKey = "sd48-admin-token";
const noticeKey = "sd48-admin-notice";
const imageAccept = "image/jpeg,image/png,image/webp,image/gif,image/svg+xml";
let message = "";
let messageError = false;
let generation = 0;

class ApiError extends Error {
  status: number;
  constructor(text: string, status: number) {
    super(text);
    this.status = status;
  }
}

const esc = (value: string) => value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[char] || char));

function formValues(form: HTMLFormElement) {
  const values: Record<string, string> = {};
  new FormData(form).forEach((value, key) => { if (typeof value === "string") values[key] = value; });
  return values;
}

export function startAdmin() {
  const stored = sessionStorage.getItem(noticeKey);
  sessionStorage.removeItem(noticeKey);
  if (stored) {
    const notice = JSON.parse(stored) as { text: string; error: boolean };
    message = notice.text;
    messageError = notice.error;
  }
  void render();
}

function note(text: string, error = false) {
  message = text;
  messageError = error;
}

function showMessage(text: string, error = false) {
  note(text, error);
  const el = document.querySelector<HTMLElement>("#admin-message");
  if (!el) return;
  el.className = `message${error ? " error" : text ? " success" : ""}`;
  el.textContent = text;
}

function fail(err: unknown) {
  if (err instanceof ApiError && err.status === 401) {
    sessionStorage.removeItem(tokenKey);
    note(err.message, true);
    tokenScreen();
    return;
  }
  showMessage(err instanceof Error ? err.message : "Something went wrong.", true);
}

async function render() {
  const gen = ++generation;
  if (!sessionStorage.getItem(tokenKey)) { tokenScreen(); return; }
  const path = location.pathname.replace(/\/$/, "") || "/admin";
  try {
    if (path === "/admin") await listScreen(gen);
    else if (path === "/admin/screenings/new") newScreen();
    else {
      const match = path.match(/^\/admin\/screenings\/([^/]+)$/);
      if (!match) missing();
      else await editScreen(gen, decodeURIComponent(match[1]));
    }
  } catch (err) {
    if (gen !== generation) return;
    fail(err);
    if (!(err instanceof ApiError && err.status === 401)) paint(shell("Admin", `<p><a class="button secondary" href="/admin">All screenings</a></p>`));
  }
}

function brandHeader() {
  return `<header class="masthead"><a class="logo-link" href="/"><img class="logo" src="/logo-horiz-trans.png" alt="San Diego 48 Hour Film Project" width="2046" height="560"></a></header>`;
}

function shell(title: string, body: string) {
  return `${brandHeader()}<main><section class="intro"><span class="kicker">Admin</span><h1>${esc(title)}</h1><p class="admin-links"><a href="/admin">All screenings</a> · <a href="/api/openapi.json">API reference</a> · <button type="button" class="text-button" id="forget-token">Forget token</button></p><p id="admin-message" class="message${messageError ? " error" : message ? " success" : ""}" role="status">${esc(message)}</p></section>${body}</main>`;
}

function paint(html: string) {
  app.innerHTML = html;
  document.querySelector("#forget-token")?.addEventListener("click", () => {
    sessionStorage.removeItem(tokenKey);
    note("");
    tokenScreen();
  });
}

function tokenScreen() {
  app.innerHTML = `${brandHeader()}<main class="home"><section class="intro"><span class="kicker">Admin</span><h1>Admin token</h1><p>This editor creates and edits screenings through the admin API. The token is sent as <code>Authorization: Bearer</code>.</p></section><form id="token-form" class="token-form"><div class="callout"><label class="code-label">Admin token<input id="admin-token" type="password" autocomplete="off" required /></label><button class="button primary" type="submit">Continue <span>→</span></button></div><p id="admin-message" class="message${messageError ? " error" : ""}" role="status">${esc(message)}</p></form></main>`;
  document.querySelector<HTMLFormElement>("#token-form")!.addEventListener("submit", (event) => {
    event.preventDefault();
    const token = document.querySelector<HTMLInputElement>("#admin-token")!.value.trim();
    if (!token) return;
    sessionStorage.setItem(tokenKey, token);
    note("");
    void render();
  });
}

function missing() {
  paint(shell("Not found", `<p>That admin page does not exist.</p>`));
}

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${sessionStorage.getItem(tokenKey) || ""}`);
  if (typeof init.body === "string" && !headers.has("content-type")) headers.set("content-type", "application/json");
  const response = await fetch(path, { ...init, headers });
  const text = await response.text();
  let data: { error?: string; fields?: Record<string, string> } = {};
  if (text) {
    try { data = JSON.parse(text) as typeof data; } catch { data = { error: text }; }
  }
  if (!response.ok) {
    const fields = data.fields ? Object.entries(data.fields).map(([key, value]) => `${key}: ${value}`).join(" ") : "";
    throw new ApiError([data.error || `Request failed (${response.status})`, fields].filter(Boolean).join(" "), response.status);
  }
  return data as T;
}

async function listScreen(gen: number) {
  paint(shell("Screenings", "<p>Loading…</p>"));
  const data = await api<{ screenings: Summary[] }>("/api/admin/screenings");
  if (gen !== generation) return;
  const items = data.screenings.length ? data.screenings.map(summaryCard).join("") : "<p>No screenings yet.</p>";
  paint(shell("Screenings", `<p><a class="button primary" href="/admin/screenings/new">New screening</a></p><div class="stack">${items}</div>`));
  document.querySelectorAll<HTMLButtonElement>("[data-delete-screening]").forEach((button) => {
    button.addEventListener("click", () => void removeScreening(button.dataset.deleteScreening || ""));
  });
}

function summaryCard(item: Summary) {
  const href = `/admin/screenings/${encodeURIComponent(item.slug)}`;
  const when = `${new Date(item.startAt).toLocaleString()} – ${new Date(item.stopAt).toLocaleString()}`;
  return `<article class="editor"><h2><a href="${href}">${esc(item.title)}</a></h2><p>${esc(item.slug)}${item.venue ? ` · ${esc(item.venue)}` : ""}</p><p>${esc(when)}</p><div class="admin-actions"><a class="button secondary" href="${href}">Edit</a><button class="button danger" type="button" data-delete-screening="${esc(item.slug)}">Delete</button></div></article>`;
}

async function removeScreening(slug: string) {
  if (!confirm(`Delete ${slug}? This removes its polls, votes, codes, and images.`)) return;
  try {
    await api(`/api/admin/screenings/${encodeURIComponent(slug)}`, { method: "DELETE" });
    sessionStorage.setItem(noticeKey, JSON.stringify({ text: `Deleted ${slug}.`, error: false }));
    location.assign("/admin");
  } catch (err) { fail(err); }
}

function newScreen() {
  paint(shell("New screening", `<form id="screening-form" class="editor"><p class="help">After this, you can add a banner, polls, options, and vote codes.</p>${screeningFields(null)}<div class="admin-actions"><button class="button primary" type="submit">Create screening</button></div></form>`));
  bindScreeningForm(null);
}

function screeningFields(screening: Screening | null) {
  return `<div class="field-row"><label>Slug<input name="slug" required maxlength="64" pattern="[a-z0-9]+(?:-[a-z0-9]+)*" value="${esc(screening?.slug || "")}" /></label><label>Title<input name="title" required maxlength="200" value="${esc(screening?.title || "")}" /></label></div><label>Venue<input name="venue" maxlength="200" value="${esc(screening?.venue || "")}" /></label><label>Timezone<input name="timezone" maxlength="64" value="${esc(screening?.timezone || "America/Los_Angeles")}" /></label><div class="field-row"><label>Voting opens<input name="startAt" type="datetime-local" required value="${screening ? toLocalInput(screening.startAt) : ""}" /></label><label>Voting closes<input name="stopAt" type="datetime-local" required value="${screening ? toLocalInput(screening.stopAt) : ""}" /></label></div><p class="help">Times are read in your current timezone and stored as an exact instant. Changing the slug changes the public ballot URL.</p>`;
}

function bindScreeningForm(existing: Screening | null) {
  document.querySelector<HTMLFormElement>("#screening-form")!.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget as HTMLFormElement;
    const data = formValues(form);
    const body = {
      slug: String(data.slug || ""),
      title: String(data.title || ""),
      venue: String(data.venue || "") || null,
      timezone: String(data.timezone || "") || "America/Los_Angeles",
      startAt: fromLocalInput(String(data.startAt || "")),
      stopAt: fromLocalInput(String(data.stopAt || "")),
    };
    try {
      const saved = await api<Screening>(existing ? `/api/admin/screenings/${encodeURIComponent(existing.slug)}` : "/api/admin/screenings", { method: existing ? "PATCH" : "POST", body: JSON.stringify(body) });
      if (existing && saved.slug === existing.slug) {
        note("Screening saved.");
        await render();
        return;
      }
      sessionStorage.setItem(noticeKey, JSON.stringify({ text: existing ? "Screening saved." : "Screening created.", error: false }));
      location.assign(`/admin/screenings/${encodeURIComponent(saved.slug)}`);
    } catch (err) { fail(err); }
  });
}

async function editScreen(gen: number, slug: string) {
  paint(shell("Screening", "<p>Loading…</p>"));
  const [screening, counts] = await Promise.all([
    api<Screening>(`/api/admin/screenings/${encodeURIComponent(slug)}`),
    api<CodeCounts>(`/api/admin/screenings/${encodeURIComponent(slug)}/codes`),
  ]);
  if (gen !== generation) return;
  paint(shell(screening.title, editBody(screening, counts)));
  bindScreeningForm(screening);
  bindBanner(screening);
  bindDeleteScreening(screening);
  for (const poll of screening.polls) {
    bindPoll(screening, poll);
    for (const option of poll.options) bindOption(screening, poll, option);
    bindNewOption(screening, poll);
  }
  bindNewPoll(screening);
  bindCodes(screening);
}

function editBody(screening: Screening, counts: CodeCounts) {
  const polls = screening.polls.map((poll) => pollBlock(poll)).join("") || "<p>No polls yet.</p>";
  return `<p><a href="${esc(screening.links.ballot)}">Ballot page</a> · <a href="/api/screenings/${encodeURIComponent(screening.slug)}">Public JSON</a></p>
    <form id="screening-form" class="editor"><h2>Screening</h2>${screeningFields(screening)}<div class="admin-actions"><button class="button primary" type="submit">Save screening</button><button class="button danger" type="button" id="delete-screening">Delete screening</button></div></form>
    <section class="editor"><h2>Banner</h2>${screening.bannerImage ? `<img class="banner-preview" alt="" src="${esc(screening.bannerImage)}">` : "<p>No banner yet.</p>"}<label>Image file<input id="banner-file" type="file" accept="${imageAccept}"></label><div class="admin-actions"><button class="button secondary" type="button" id="upload-banner">Upload banner</button>${screening.bannerImageKey ? `<button class="button danger" type="button" id="clear-banner">Remove banner</button>` : ""}</div><p class="help">Filenames use letters, numbers, dots, hyphens, and underscores. Uploading the same name replaces that file.</p></section>
    <h2 class="section-title">Polls</h2>${polls}
    <form id="new-poll" class="editor"><h2>New poll</h2>${pollFields(null)}<div class="admin-actions"><button class="button primary" type="submit">Add poll</button></div></form>
    <section class="editor"><h2>Vote codes</h2><p>${counts.total} total · ${counts.unused} unused · ${counts.used} used</p><p class="help">Codes are stored as hashes and cannot be listed later. Add or remove the text printed on the ticket. Letters are not case-sensitive. A used code stays until its vote is no longer needed; removal does not delete votes.</p><form id="codes-form"><label>Codes, one per line<textarea name="codes" rows="6"></textarea></label><div class="admin-actions"><button class="button primary" type="submit">Add codes</button><button class="button danger" type="button" id="remove-codes">Remove codes</button></div></form></section>`;
}

function pollBlock(poll: Poll) {
  const options = poll.options.map((option) => optionForm(poll, option)).join("") || "<p>No options yet.</p>";
  return `<article class="poll-block"><form id="poll-${poll.id}" class="editor poll-form"><h2>${esc(poll.title)}</h2>${pollFields(poll)}<div class="admin-actions"><button class="button primary" type="submit">Save poll</button><button class="button danger" type="button" data-delete-poll="${esc(poll.slug)}">Delete poll</button></div></form><h3 class="section-title">Options</h3>${options}${optionForm(poll, null)}</article>`;
}

function pollFields(poll: Poll | null) {
  const config = poll?.imageConfig;
  return `<div class="field-row"><label>Slug<input name="slug" required maxlength="64" pattern="[a-z0-9]+(?:-[a-z0-9]+)*" value="${esc(poll?.slug || "")}"></label><label>Title<input name="title" required maxlength="200" value="${esc(poll?.title || "")}"></label></div><label>Instructions<textarea name="instructions" maxlength="2000" rows="3">${esc(poll?.instructions || "")}</textarea></label><div class="field-row"><label>Minimum selections<input name="minSelections" type="number" min="0" max="100" required value="${poll?.minSelections ?? 1}"></label><label>Maximum selections<input name="maxSelections" type="number" min="0" max="100" required value="${poll?.maxSelections ?? 1}"></label><label>Sort order<input name="sortOrder" type="number" min="0" value="${poll?.sortOrder ?? ""}"></label></div><div class="field-row"><label>Aspect ratio<input name="aspectRatio" required value="${esc(config?.aspectRatio || "16:9")}"></label><label>Minimum stills<input name="imageMin" type="number" min="0" required value="${config?.min ?? 1}"></label><label>Maximum stills<input name="imageMax" type="number" min="0" required value="${config?.max ?? 1}"></label></div><label class="check"><input name="cycle" type="checkbox"${config?.cycle ? " checked" : ""}> Cycle stills every four seconds</label>`;
}

function optionForm(poll: Poll, option: Option | null) {
  const id = option ? `option-${option.id}` : `new-option-${poll.id}`;
  const thumbs = option ? option.imageKeys.map((key, index) => `<figure data-image-key="${esc(key)}"><img alt="" src="${esc(option.images[index] || "")}"><button type="button" data-remove-image="${esc(key)}">Remove image</button></figure>`).join("") : "";
  return `<form id="${id}" class="editor option-editor" data-option-id="${esc(option?.id || "")}"><h3>${option ? esc(option.title) : "New option"}</h3><div class="field-row"><label>Title<input name="title" required maxlength="200" value="${esc(option?.title || "")}"></label><label>Sort order<input name="sortOrder" type="number" min="0" value="${option?.sortOrder ?? ""}"></label></div><label>Description<input name="description" maxlength="2000" value="${esc(option?.description || "")}"></label>${option ? `<div class="thumbs">${thumbs}</div>` : ""}<label>${option ? "Add an image" : "Image"}<input name="file" type="file" accept="${imageAccept}"></label><div class="admin-actions"><button class="button primary" type="submit">${option ? "Save option" : "Add option"}</button>${option ? `<button class="button danger" type="button" data-delete-option="${esc(option.id)}">Delete option</button>` : ""}</div></form>`;
}

function bindBanner(screening: Screening) {
  document.querySelector("#upload-banner")!.addEventListener("click", async () => {
    const file = document.querySelector<HTMLInputElement>("#banner-file")!.files?.[0];
    if (!file) { showMessage("Choose a banner image first.", true); return; }
    try {
      const key = await upload(screening.slug, file);
      await api(`/api/admin/screenings/${encodeURIComponent(screening.slug)}`, { method: "PATCH", body: JSON.stringify({ bannerImageKey: key }) });
      note("Banner saved.");
      await render();
    } catch (err) { fail(err); }
  });
  document.querySelector("#clear-banner")?.addEventListener("click", async () => {
    try {
      await api(`/api/admin/screenings/${encodeURIComponent(screening.slug)}`, { method: "PATCH", body: JSON.stringify({ bannerImageKey: null }) });
      note("Banner removed.");
      await render();
    } catch (err) { fail(err); }
  });
}

function bindDeleteScreening(screening: Screening) {
  document.querySelector("#delete-screening")!.addEventListener("click", () => void removeScreening(screening.slug));
}

function bindPoll(screening: Screening, poll: Poll) {
  const form = document.querySelector<HTMLFormElement>(`#poll-${poll.id}`)!;
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      await api(`/api/admin/screenings/${encodeURIComponent(screening.slug)}/polls/${encodeURIComponent(poll.slug)}`, { method: "PATCH", body: JSON.stringify(pollBody(form)) });
      note("Poll saved.");
      await render();
    } catch (err) { fail(err); }
  });
  form.querySelector<HTMLButtonElement>("[data-delete-poll]")!.addEventListener("click", async () => {
    if (!confirm(`Delete poll ${poll.title}?`)) return;
    try {
      await api(`/api/admin/screenings/${encodeURIComponent(screening.slug)}/polls/${encodeURIComponent(poll.slug)}`, { method: "DELETE" });
      note("Poll deleted.");
      await render();
    } catch (err) { fail(err); }
  });
}

function bindNewPoll(screening: Screening) {
  document.querySelector<HTMLFormElement>("#new-poll")!.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget as HTMLFormElement;
    try {
      await api(`/api/admin/screenings/${encodeURIComponent(screening.slug)}/polls`, { method: "POST", body: JSON.stringify(pollBody(form)) });
      note("Poll added.");
      await render();
    } catch (err) { fail(err); }
  });
}

function pollBody(form: HTMLFormElement) {
  const data = formValues(form);
  const body: Record<string, unknown> = {
    slug: String(data.slug || ""),
    title: String(data.title || ""),
    instructions: String(data.instructions || "") || null,
    minSelections: Number(data.minSelections),
    maxSelections: Number(data.maxSelections),
    imageConfig: {
      aspectRatio: String(data.aspectRatio || ""),
      min: Number(data.imageMin),
      max: Number(data.imageMax),
      cycle: form.querySelector<HTMLInputElement>("[name=cycle]")!.checked,
    },
  };
  if (String(data.sortOrder || "").trim() !== "") body.sortOrder = Number(data.sortOrder);
  return body;
}

function bindOption(screening: Screening, poll: Poll, option: Option) {
  const form = document.querySelector<HTMLFormElement>(`#option-${option.id}`)!;
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      await saveOption(screening, poll, option, form);
      note("Option saved.");
      await render();
    } catch (err) { fail(err); }
  });
  form.querySelectorAll<HTMLButtonElement>("[data-remove-image]").forEach((button) => {
    button.addEventListener("click", async () => {
      try {
        const imageKeys = option.imageKeys.filter((key) => key !== button.dataset.removeImage);
        await api(optionPath(screening, poll, option.id), { method: "PATCH", body: JSON.stringify({ imageKeys }) });
        note("Image removed.");
        await render();
      } catch (err) { fail(err); }
    });
  });
  form.querySelector<HTMLButtonElement>("[data-delete-option]")!.addEventListener("click", async () => {
    if (!confirm(`Delete option ${option.title}?`)) return;
    try {
      await api(optionPath(screening, poll, option.id), { method: "DELETE" });
      note("Option deleted.");
      await render();
    } catch (err) { fail(err); }
  });
}

function bindNewOption(screening: Screening, poll: Poll) {
  document.querySelector<HTMLFormElement>(`#new-option-${poll.id}`)!.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget as HTMLFormElement;
    try {
      const file = form.querySelector<HTMLInputElement>("[name=file]")!.files?.[0];
      const imageKeys = file ? [await upload(screening.slug, file)] : [];
      const data = formValues(form);
      const body: Record<string, unknown> = { title: String(data.title || ""), description: String(data.description || "") || null, imageKeys };
      if (String(data.sortOrder || "").trim() !== "") body.sortOrder = Number(data.sortOrder);
      await api(`/api/admin/screenings/${encodeURIComponent(screening.slug)}/polls/${encodeURIComponent(poll.slug)}/options`, { method: "POST", body: JSON.stringify(body) });
      note("Option added.");
      await render();
    } catch (err) { fail(err); }
  });
}

async function saveOption(screening: Screening, poll: Poll, option: Option, form: HTMLFormElement) {
  const data = formValues(form);
  const imageKeys = option.imageKeys.slice();
  const file = form.querySelector<HTMLInputElement>("[name=file]")!.files?.[0];
  if (file) imageKeys.push(await upload(screening.slug, file));
  const body: Record<string, unknown> = { title: String(data.title || ""), description: String(data.description || "") || null, imageKeys };
  if (String(data.sortOrder || "").trim() !== "") body.sortOrder = Number(data.sortOrder);
  await api(optionPath(screening, poll, option.id), { method: "PATCH", body: JSON.stringify(body) });
}

function optionPath(screening: Screening, poll: Poll, optionId: string) {
  return `/api/admin/screenings/${encodeURIComponent(screening.slug)}/polls/${encodeURIComponent(poll.slug)}/options/${encodeURIComponent(optionId)}`;
}

function bindCodes(screening: Screening) {
  const form = document.querySelector<HTMLFormElement>("#codes-form")!;
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    await sendCodes(screening, form, "POST");
  });
  document.querySelector("#remove-codes")!.addEventListener("click", () => void sendCodes(screening, form, "DELETE"));
}

async function sendCodes(screening: Screening, form: HTMLFormElement, method: "POST" | "DELETE") {
  const codes = String(new FormData(form).get("codes") || "").split(/\s+/).map((code) => code.trim()).filter(Boolean);
  if (!codes.length) { showMessage("Enter at least one code.", true); return; }
  try {
    const result = await api<{ created?: string[]; alreadyPresent?: string[]; deleted?: string[]; used?: string[]; missing?: string[] }>(`/api/admin/screenings/${encodeURIComponent(screening.slug)}/codes`, { method, body: JSON.stringify({ codes }) });
    const text = method === "POST"
      ? `Added ${result.created?.length || 0}. Already on this screening: ${result.alreadyPresent?.length || 0}.`
      : `Removed ${result.deleted?.length || 0}. Used and kept: ${result.used?.length || 0}. Not on this screening: ${result.missing?.length || 0}.`;
    note(text);
    await render();
  } catch (err) { fail(err); }
}

async function upload(slug: string, file: File) {
  const filename = uploadName(file);
  const type = fileType(file);
  if (!filename || !type) throw new ApiError("Use a jpeg, png, webp, gif, or svg whose name is letters, numbers, dots, hyphens, and underscores.", 400);
  const result = await api<{ key: string }>(`/api/admin/screenings/${encodeURIComponent(slug)}/images`, { method: "POST", headers: { "content-type": type, "x-filename": filename }, body: file });
  return result.key;
}

function uploadName(file: File) {
  const base = (file.name.split(/[/\\]/).pop() || "image").replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+/, "");
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(base) ? base : "";
}

function fileType(file: File) {
  if (file.type) return file.type;
  const name = file.name.toLowerCase();
  if (name.endsWith(".svg")) return "image/svg+xml";
  if (name.endsWith(".png")) return "image/png";
  if (name.endsWith(".webp")) return "image/webp";
  if (name.endsWith(".gif")) return "image/gif";
  if (name.endsWith(".jpg") || name.endsWith(".jpeg")) return "image/jpeg";
  return "";
}

function toLocalInput(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function fromLocalInput(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new ApiError("Enter both voting times.", 400);
  return date.toISOString();
}
