import { renderSVG } from "uqr";
import { stopInMinutes } from "../functions/voting";
import { voteCodeUrl } from "./vote-link";

type ImageConfig = { aspectRatio: string; cycle?: number };
type Option = { id: string; title: string; description: string | null; imageKeys: string[]; images: string[]; sortOrder: number };
type Voting = "scheduled" | "open" | "closed";
type Poll = { id: string; slug: string; title: string; instructions: string | null; minSelections: number; maxSelections: number; imageConfig: ImageConfig; sortOrder: number; startAt: string; stopAt: string; voting: Voting; votingOpen: boolean; options: Option[] };
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
type VoteCode = { code: string; used: boolean };
type CodeList = { total: number; used: number; unused: number; unlisted: number; codes: VoteCode[] };
type ScreeningResults = { slug: string; title: string; ballots: number; polls: { id: string; slug: string; title: string; votes: number; options: { id: string; title: string; votes: number }[] }[] };

const app = document.querySelector<HTMLDivElement>("#app")!;
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
function frameParts(value?: string) {
  const match = /^(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)$/.exec((value || "").trim());
  if (!match) return null;
  const w = Number(match[1]);
  const h = Number(match[2]);
  return w > 0 && h > 0 ? { w, h } : null;
}
function frameStyle(value?: string) {
  const frame = frameParts(value) || { w: 16, h: 9 };
  return `--frame-w:${frame.w};--frame-h:${frame.h}`;
}

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
    note(err.message, true);
    accessScreen();
    return;
  }
  showMessage(err instanceof Error ? err.message : "Something went wrong.", true);
}

async function render() {
  const gen = ++generation;
  const path = location.pathname.replace(/\/$/, "") || "/admin";
  try {
    if (path === "/admin") await listScreen(gen);
    else if (path === "/admin/screenings/new") newScreen();
    else {
      const results = path.match(/^\/admin\/screenings\/([^/]+)\/results$/);
      const edit = path.match(/^\/admin\/screenings\/([^/]+)$/);
      if (results) await resultsScreen(gen, decodeURIComponent(results[1]));
      else if (edit) await editScreen(gen, decodeURIComponent(edit[1]));
      else missing();
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
  return `${brandHeader()}<main><section class="intro"><span class="kicker">Admin</span><h1>${esc(title)}</h1><p class="admin-links"><a href="/admin">All screenings</a> · <a href="/api/openapi.json">API reference</a></p><p id="admin-message" class="message${messageError ? " error" : message ? " success" : ""}" role="status">${esc(message)}</p></section>${body}</main>`;
}

function paint(html: string) {
  app.innerHTML = html;
}

function accessScreen() {
  app.innerHTML = `${brandHeader()}<main class="home"><section class="intro"><span class="kicker">Admin</span><h1>Cloudflare Access</h1><p>Sign in with a @kilna.com address or sandiego@48hourfilm.com.</p><p><a class="button primary" href="/admin">Try again</a></p><p id="admin-message" class="message${messageError ? " error" : ""}" role="status">${esc(message)}</p></section></main>`;
}

function missing() {
  paint(shell("Not found", `<p>That admin page does not exist.</p>`));
}

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (typeof init.body === "string" && !headers.has("content-type")) headers.set("content-type", "application/json");
  const response = await fetch(path, { ...init, headers, credentials: "same-origin" });
  const text = await response.text();
  let data: { error?: string; fields?: Record<string, string> } = {};
  if (text) {
    try { data = JSON.parse(text) as typeof data; }
    catch { throw new ApiError("The admin API did not return JSON.", response.status); }
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
  return `<article class="editor"><h2><a href="${href}">${esc(item.title)}</a></h2><p>${esc(item.slug)}${item.venue ? ` · ${esc(item.venue)}` : ""}</p><p>${esc(when)}</p><div class="admin-actions"><a class="button secondary" href="${href}/results">Results</a><a class="button secondary" href="${href}">Edit</a><button class="button danger" type="button" data-delete-screening="${esc(item.slug)}">Delete</button></div></article>`;
}

async function removeScreening(slug: string) {
  if (!confirm(`Delete ${slug}? This removes its polls, votes, codes, and images.`)) return;
  try {
    await api(`/api/admin/screenings/${encodeURIComponent(slug)}`, { method: "DELETE" });
    sessionStorage.setItem(noticeKey, JSON.stringify({ text: `Deleted ${slug}.`, error: false }));
    location.assign("/admin");
  } catch (err) { fail(err); }
}

async function resultsScreen(gen: number, slug: string) {
  paint(shell("Results", "<p>Loading…</p>"));
  const data = await api<ScreeningResults>(`/api/admin/screenings/${encodeURIComponent(slug)}/results`);
  if (gen !== generation) return;
  paint(shell(data.title, resultsBody(data)));
}

function resultsBody(data: ScreeningResults) {
  const polls = data.polls.map((poll) => {
    const options = poll.options.length ? poll.options.map((option) => {
      const share = poll.votes ? (option.votes / poll.votes) * 100 : 0;
      return `<div class="result-row"><div class="result-label"><span>${esc(option.title)}</span><span>${option.votes} · ${Math.round(share)}%</span></div><div class="result-track" aria-hidden="true"><span class="result-fill" style="width:${share}%"></span></div></div>`;
    }).join("") : `<p class="help">No options yet.</p>`;
    const votes = `${poll.votes} ${poll.votes === 1 ? "vote" : "votes"}`;
    return `<section class="editor"><h2>${esc(poll.title)}</h2><p>${votes}</p>${options}</section>`;
  }).join("") || "<p>No polls yet.</p>";
  const ballots = `${data.ballots} ${data.ballots === 1 ? "ballot" : "ballots"}`;
  return `<p><a href="/admin/screenings/${encodeURIComponent(data.slug)}">Edit screening</a></p><p>${ballots}</p>${polls}`;
}

function newScreen() {
  paint(shell("New screening", `<form id="screening-form" class="editor"><p class="help">After this, you can add a banner, polls, options, and vote codes.</p>${screeningFields(null)}<div class="admin-actions"><button class="button primary" type="submit">Create screening</button></div></form>`));
  bindScreeningForm(null);
}

function votingStatus(item: { voting: Voting; votingOpen: boolean }) {
  const state = item.votingOpen ? "Voting is open" : "Voting is closed";
  if (item.voting === "open") return `${state} · started manually`;
  if (item.voting === "closed") return `${state} · stopped manually`;
  return `${state} · following the schedule`;
}

function votingDetail(item: { voting: Voting }) {
  if (item.voting === "open") return "Ballots are accepted until you stop voting or return to the schedule.";
  if (item.voting === "closed") return "Ballots are rejected until you start voting or return to the schedule.";
  return "Ballots are accepted only between this poll's open and close times.";
}

function pollVoting(poll: Poll) {
  const button = (mode: Voting, label: string, className: string) => `<button class="button ${className}" type="button" data-voting="${mode}" aria-pressed="${poll.voting === mode}">${label}</button>`;
  return `<section class="poll-voting"><p class="window ${poll.votingOpen ? "open" : "closed"}">${esc(votingStatus(poll))}</p><p class="help">${esc(votingDetail(poll))}</p><div class="admin-actions">${button("open", "Start voting", "primary")}${button("closed", "Stop voting", "danger")}${button("scheduled", "Follow schedule", "secondary")}</div><div class="stop-in"><label>Minutes<input type="number" min="1" max="240" value="5" data-stop-minutes></label><button class="button secondary" type="button" data-stop-in>Stop voting in 5 minutes</button></div></section>`;
}

async function setPollVoting(screeningSlug: string, poll: Poll, voting: Voting) {
  try {
    await api(`/api/admin/screenings/${encodeURIComponent(screeningSlug)}/polls/${encodeURIComponent(poll.slug)}`, { method: "PATCH", body: JSON.stringify({ voting }) });
    note(voting === "open" ? `${poll.title} is open.` : voting === "closed" ? `${poll.title} is closed.` : `${poll.title} follows its schedule.`);
    await render();
  } catch (err) { fail(err); }
}

async function stopPoll(screeningSlug: string, poll: Poll, minutes: number) {
  try {
    await api(`/api/admin/screenings/${encodeURIComponent(screeningSlug)}/polls/${encodeURIComponent(poll.slug)}`, { method: "PATCH", body: JSON.stringify(stopInMinutes(poll.startAt, minutes)) });
    note(`${poll.title} stops in ${minutes} ${minutes === 1 ? "minute" : "minutes"}.`);
    await render();
  } catch (err) { fail(err); }
}

function screeningFields(screening: Screening | null) {
  return `<div class="field-row"><label>Slug<input name="slug" required maxlength="64" pattern="[a-z0-9]+(?:-[a-z0-9]+)*" value="${esc(screening?.slug || "")}" /></label><label>Title<input name="title" required maxlength="200" value="${esc(screening?.title || "")}" /></label></div><label>Venue<input name="venue" maxlength="200" value="${esc(screening?.venue || "")}" /></label><label>Timezone<input name="timezone" maxlength="64" value="${esc(screening?.timezone || "America/Los_Angeles")}" /></label><div class="field-row"><label>Starts<input name="startAt" type="datetime-local" required value="${screening ? toLocalInput(screening.startAt) : ""}" /></label><label>Ends<input name="stopAt" type="datetime-local" required value="${screening ? toLocalInput(screening.stopAt) : ""}" /></label></div><p class="help">Times are read in your current timezone and stored as an exact instant. A new poll copies them, then keeps its own open and close times. Changing the slug changes the public ballot URL.</p>`;
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
    api<CodeList>(`/api/admin/screenings/${encodeURIComponent(slug)}/codes`),
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
  bindReveals();
  bindCodes(screening);
}

function editBody(screening: Screening, counts: CodeList) {
  const hasPolls = screening.polls.length > 0;
  const polls = hasPolls ? screening.polls.map((poll) => pollBlock(screening, poll)).join("") : "<p>No polls yet.</p>";
  return `<p><a href="${esc(screening.links.ballot)}">Ballot page</a> · <a href="/api/screenings/${encodeURIComponent(screening.slug)}">Public JSON</a></p>
    <form id="screening-form" class="editor"><h2>Screening</h2>${screeningFields(screening)}<div class="admin-actions"><button class="button primary" type="submit">Save screening</button><button class="button danger" type="button" id="delete-screening">Delete screening</button></div></form>
    <section class="editor" id="banner-section"><h2>Banner</h2>${screening.bannerImage ? `<img class="banner-preview" alt="" src="${esc(screening.bannerImage)}">` : "<p>No banner yet.</p>"}<label>Image file<input id="banner-file" type="file" accept="${imageAccept}"></label><div class="admin-actions"><button class="button secondary" type="button" id="upload-banner">Upload banner</button>${screening.bannerImageKey ? `<button class="button danger" type="button" id="clear-banner">Remove banner</button>` : ""}</div><p class="help">Filenames use letters, numbers, dots, hyphens, and underscores. Uploading the same name replaces that file.</p></section>
    <h2 class="section-title">Polls</h2>${polls}
    ${hasPolls ? revealButton("new-poll", "Add poll") : ""}
    ${newPollForm(screening, !hasPolls)}
    <section class="editor codes-sheet"><h2 class="print-only">${esc(screening.title)} vote codes</h2><h2>Vote codes</h2><p>${counts.total} total · ${counts.unused} unused · ${counts.used} used</p><p class="help">Each QR code opens vote.sandiego48.com/c/CODE, which enters that code. A code can update any poll that is still open. The download lists every code, whether it has been used, and its URL. Typing ignores spaces and hyphens.</p>${counts.unlisted ? `<p class="help">${counts.unlisted} older ${counts.unlisted === 1 ? "code was" : "codes were"} saved before downloads existed. ${counts.unlisted === 1 ? "It still works" : "They still work"} and ${counts.unlisted === 1 ? "is" : "are"} not in the file.</p>` : ""}<form id="codes-form"><label class="codes-count">How many<input name="count" type="number" min="1" max="500" required></label><div class="admin-actions"><button class="button primary" type="submit">Generate codes</button><button class="button secondary" type="button" id="download-codes">Download codes</button>${counts.codes.length ? `<button class="button secondary" type="button" id="print-codes">Print QR codes</button>` : ""}${counts.unused ? `<button class="button danger" type="button" id="remove-codes">Remove unused codes</button>` : ""}</div></form>${codeCards(counts.codes)}</section>`;
}

function pollBlock(screening: Screening, poll: Poll) {
  const hasOptions = poll.options.length > 0;
  const options = poll.options.map((option) => optionForm(poll, option)).join("");
  const empty = hasOptions ? "" : `<p class="help">No options yet.</p>`;
  const formId = `new-option-${poll.id}`;
  const toggle = hasOptions ? revealButton(formId, "Add option") : "";
  return `<article class="editor poll-block"><form id="poll-${poll.id}" class="poll-form"><h2>${esc(poll.title)}</h2>${pollFields(screening, poll)}<div class="admin-actions"><button class="button primary" type="submit">Save poll</button><button class="button danger" type="button" data-delete-poll="${esc(poll.slug)}">Delete poll</button></div></form>${pollVoting(poll)}<section class="poll-options"><h3>Options</h3>${empty}${options}${toggle}${optionForm(poll, null, !hasOptions)}</section></article>`;
}

function newPollForm(screening: Screening, open: boolean) {
  return `<form id="new-poll" class="editor"${open ? "" : " hidden"}><h2>New poll</h2>${pollFields(screening, null)}<div class="admin-actions"><button class="button primary" type="submit">Add poll</button>${collapseButton(open)}</div></form>`;
}

function revealButton(id: string, label: string) {
  return `<div class="admin-actions add-toggle-row"><button class="button secondary add-toggle" type="button" data-reveal="${esc(id)}" aria-expanded="false" aria-controls="${esc(id)}">${esc(label)}</button></div>`;
}

function collapseButton(open: boolean) {
  return open ? "" : `<button class="button secondary" type="button" data-collapse>Cancel</button>`;
}

function pollFields(screening: Screening, poll: Poll | null) {
  const config = poll?.imageConfig;
  const start = toLocalInput(poll?.startAt || screening.startAt);
  const stop = toLocalInput(poll?.stopAt || screening.stopAt);
  return `<div class="field-row"><label>Slug<input name="slug" required maxlength="64" pattern="[a-z0-9]+(?:-[a-z0-9]+)*" value="${esc(poll?.slug || "")}"></label><label>Title<input name="title" required maxlength="200" value="${esc(poll?.title || "")}"></label></div><label>Instructions<textarea name="instructions" maxlength="2000" rows="3">${esc(poll?.instructions || "")}</textarea></label><div class="field-row"><label>Minimum selections<input name="minSelections" type="number" min="0" max="100" required value="${poll?.minSelections ?? 1}"></label><label>Maximum selections<input name="maxSelections" type="number" min="0" max="100" required value="${poll?.maxSelections ?? 1}"></label><label>Sort order<input name="sortOrder" type="number" min="0" value="${poll?.sortOrder ?? ""}"></label></div><div class="field-row"><label>Voting opens<input name="startAt" type="datetime-local" required value="${start}"></label><label>Voting closes<input name="stopAt" type="datetime-local" required value="${stop}"></label></div><div class="field-row"><label>Aspect ratio<input name="aspectRatio" required value="${esc(config?.aspectRatio || "16:9")}"></label><label>Seconds per image<input name="cycle" type="number" min="1" max="60" required value="${config?.cycle ?? 2}"></label></div><p class="help">This poll opens and closes on its own schedule. Start, stop, and the minute timer take effect immediately and do not wait for Save poll.</p>`;
}

function optionForm(poll: Poll, option: Option | null, open = true) {
  const id = option ? `option-${option.id}` : `new-option-${poll.id}`;
  const thumbs = option ? option.imageKeys.map((key, index) => `<figure data-image-key="${esc(key)}"><img alt="" src="${esc(option.images[index] || "")}"><button type="button" data-remove-image="${esc(key)}">Remove image</button></figure>`).join("") : "";
  return `<form id="${id}" class="option-editor"${open ? "" : " hidden"} data-option-id="${esc(option?.id || "")}"><h3>${option ? esc(option.title) : "New option"}</h3><div class="field-row"><label>Title<input name="title" required maxlength="200" value="${esc(option?.title || "")}"></label><label>Sort order<input name="sortOrder" type="number" min="0" value="${option?.sortOrder ?? ""}"></label></div><label>Description<textarea name="description" maxlength="2000" rows="2">${esc(option?.description || "")}</textarea></label>${option ? `<div class="thumbs" style="${frameStyle(poll.imageConfig?.aspectRatio)}">${thumbs}</div>` : ""}<label>${option ? "Add an image" : "Image"}<input name="file" type="file" accept="${imageAccept}"></label><div class="admin-actions"><button class="button primary" type="submit">${option ? "Save option" : "Add option"}</button>${option ? `<button class="button danger" type="button" data-delete-option="${esc(option.id)}">Delete option</button>` : collapseButton(open)}</div></form>`;
}

function bindReveals() {
  document.querySelectorAll<HTMLButtonElement>("[data-reveal]").forEach((button) => {
    const form = document.getElementById(button.dataset.reveal || "");
    const row = button.closest<HTMLElement>(".add-toggle-row");
    if (!(form instanceof HTMLFormElement) || !row) return;
    button.addEventListener("click", () => {
      form.hidden = false;
      row.hidden = true;
      button.setAttribute("aria-expanded", "true");
      form.querySelector<HTMLElement>("input, textarea")?.focus();
    });
  });
  document.querySelectorAll<HTMLButtonElement>("[data-collapse]").forEach((button) => {
    button.addEventListener("click", () => {
      const form = button.closest("form");
      if (!form) return;
      form.reset();
      form.hidden = true;
      const reveal = Array.from(document.querySelectorAll<HTMLButtonElement>("[data-reveal]")).find((item) => item.dataset.reveal === form.id);
      const row = reveal?.closest<HTMLElement>(".add-toggle-row");
      if (!reveal || !row) return;
      row.hidden = false;
      reveal.setAttribute("aria-expanded", "false");
      reveal.focus();
    });
  });
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
  const ratio = form.querySelector<HTMLInputElement>("[name=aspectRatio]");
  ratio?.addEventListener("input", () => {
    const frame = frameParts(ratio.value);
    if (!frame) return;
    form.closest(".poll-block")?.querySelectorAll<HTMLElement>(".thumbs").forEach((thumbs) => {
      thumbs.style.setProperty("--frame-w", String(frame.w));
      thumbs.style.setProperty("--frame-h", String(frame.h));
    });
  });
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
  const block = form.closest(".poll-block");
  block?.querySelectorAll<HTMLButtonElement>("[data-voting]").forEach((button) => {
    button.addEventListener("click", () => {
      const voting = button.dataset.voting as Voting;
      if (voting === poll.voting) return;
      void setPollVoting(screening.slug, poll, voting);
    });
  });
  const minutesInput = block?.querySelector<HTMLInputElement>("[data-stop-minutes]");
  const stopButton = block?.querySelector<HTMLButtonElement>("[data-stop-in]");
  const labelMinutes = () => {
    const minutes = clampMinutes(minutesInput?.value || "");
    if (stopButton) stopButton.textContent = `Stop voting in ${minutes} ${minutes === 1 ? "minute" : "minutes"}`;
    return minutes;
  };
  minutesInput?.addEventListener("input", labelMinutes);
  stopButton?.addEventListener("click", () => void stopPoll(screening.slug, poll, labelMinutes()));
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
      cycle: Number(data.cycle),
    },
    startAt: fromLocalInput(String(data.startAt || "")),
    stopAt: fromLocalInput(String(data.stopAt || "")),
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
    const count = Number(formValues(form).count);
    try {
      const result = await api<{ created: string[] }>(`/api/admin/screenings/${encodeURIComponent(screening.slug)}/codes`, { method: "POST", body: JSON.stringify({ count }) });
      note(`Generated ${result.created.length} codes.`);
      await render();
    } catch (err) { fail(err); }
  });
  document.querySelector("#download-codes")!.addEventListener("click", () => void downloadCodes(screening));
  document.querySelector("#print-codes")?.addEventListener("click", () => window.print());
  document.querySelector("#remove-codes")?.addEventListener("click", () => void removeUnusedCodes(screening));
}

function clampMinutes(value: string) {
  const minutes = Math.round(Number(value));
  if (!Number.isFinite(minutes)) return 5;
  return Math.min(240, Math.max(1, minutes));
}

function codeCards(codes: VoteCode[]) {
  if (!codes.length) return "";
  return `<div class="code-grid">${codes.map((item) => {
    const svg = renderSVG(voteCodeUrl(item.code), { ecc: "M", border: 2, pixelSize: 6 });
    return `<figure class="code-card">${svg}<figcaption><strong>${esc(item.code)}</strong><span>${item.used ? "Used" : "Ready"}</span></figcaption></figure>`;
  }).join("")}</div>`;
}

async function downloadCodes(screening: Screening) {
  try {
    const list = await api<CodeList>(`/api/admin/screenings/${encodeURIComponent(screening.slug)}/codes`);
    if (!list.codes.length) { showMessage("There are no codes to download.", true); return; }
    const lines = ["code,used,url", ...list.codes.map((item) => `${item.code},${item.used ? "yes" : "no"},${voteCodeUrl(item.code)}`)];
    const url = URL.createObjectURL(new Blob([`${lines.join("\n")}\n`], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `${screening.slug}-vote-codes.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    const older = list.unlisted ? ` ${list.unlisted} older ${list.unlisted === 1 ? "code is" : "codes are"} not in the file.` : "";
    showMessage(`Downloaded ${list.codes.length} codes.${older}`);
  } catch (err) { fail(err); }
}

async function removeUnusedCodes(screening: Screening) {
  if (!confirm("Remove every unused code? Used codes stay, and votes are not deleted.")) return;
  try {
    const result = await api<{ deleted: number }>(`/api/admin/screenings/${encodeURIComponent(screening.slug)}/codes`, { method: "DELETE" });
    note(`Removed ${result.deleted} unused codes.`);
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
