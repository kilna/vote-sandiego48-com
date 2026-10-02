import { startClock } from "./countdown";
import { nextVotingCue, startNow, stopInMinutes, stopNow, votingOpen } from "../functions/voting";
import { voteCodeUrl } from "./vote-link";

type ImageConfig = { aspectRatio: string; cycle?: number; zoomable?: boolean };
type Option = { id: string; title: string; description: string | null; imageKeys: string[]; images: string[]; sortOrder: number };
type Voting = "scheduled" | "open" | "closed";
type Poll = { id: string; slug: string; title: string; instructions: string | null; minSelections: number; maxSelections: number; imageConfig: ImageConfig; sortOrder: number; startAt: string; stopAt: string; voting: Voting; votingOpen: boolean; options: Option[] };
type Event = {
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
type Summary = Omit<Event, "polls" | "links"> & { links: { ballot: string } };
type VoteCode = { code: string; used: boolean };
type CodeList = { total: number; used: number; unused: number; unlisted: number; codes: VoteCode[] };
type ResultOption = { id: string; title: string; votes: number };
type ResultPoll = { id: string; slug: string; title: string; votes: number; voting: Voting; votingOpen: boolean; startAt: string; stopAt: string; options: ResultOption[] };
type EventResults = { now: string; slug: string; title: string; ballots: number; polls: ResultPoll[] };

const app = document.querySelector<HTMLDivElement>("#app")!;
const noticeKey = "sd48-admin-notice";
const imageAccept = "image/jpeg,image/png,image/webp,image/gif,image/svg+xml";
let message = "";
let messageError = false;
let generation = 0;
let resultsTimer = 0;
let resultsWatch = 0;
let resultsSkew = 0;
let latestResults: EventResults | null = null;
const resultClocks = new Map<string, () => void>();
const resultClockKeys = new Map<string, string>();
const resultsEveryMs = 3000;
const saveDelayMs = 400;
const openPolls = new Set<string>();
const openOptions = new Set<string>();
const saveTails = new Map<string, Promise<void>>();
let expandPollId = "";
let expandOptionId = "";

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

function stopResultsLive() {
  window.clearInterval(resultsTimer);
  window.clearInterval(resultsWatch);
  resultsTimer = 0;
  resultsWatch = 0;
  latestResults = null;
  for (const stop of resultClocks.values()) stop();
  resultClocks.clear();
  resultClockKeys.clear();
}

async function render() {
  const gen = ++generation;
  stopResultsLive();
  const path = location.pathname.replace(/\/$/, "") || "/admin";
  try {
    if (path === "/admin") await listScreen(gen);
    else if (path === "/admin/events/new") newScreen();
    else {
      const results = path.match(/^\/admin\/events\/([^/]+)\/results$/);
      const edit = path.match(/^\/admin\/events\/([^/]+)$/);
      if (results) await resultsScreen(gen, decodeURIComponent(results[1]));
      else if (edit) await editScreen(gen, decodeURIComponent(edit[1]));
      else missing();
    }
  } catch (err) {
    if (gen !== generation) return;
    fail(err);
    if (!(err instanceof ApiError && err.status === 401)) paint(shell("Admin", `<p><a class="button primary" href="/admin">All events</a></p>`));
  }
}

function brandHeader() {
  return `<header class="masthead"><a class="logo-link" href="/"><img class="logo" src="/logo-horiz-trans.png" alt="San Diego 48 Hour Film Project" width="2046" height="560"></a></header>`;
}

function shell(title: string, body: string) {
  return `${brandHeader()}<main><section class="intro"><span class="kicker">Admin</span><h1>${esc(title)}</h1><p class="admin-links"><a href="/admin">All events</a> · <a href="/api/openapi.json">API reference</a></p><p id="admin-message" class="message${messageError ? " error" : message ? " success" : ""}" role="status">${esc(message)}</p></section>${body}</main>`;
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
  paint(shell("Events", "<p>Loading…</p>"));
  const data = await api<{ events: Summary[] }>("/api/admin/events");
  if (gen !== generation) return;
  const items = data.events.length ? data.events.map(summaryCard).join("") : "<p>No events yet.</p>";
  paint(shell("Events", `<p><a class="button primary" href="/admin/events/new">New event</a></p><div class="stack">${items}</div>`));
  document.querySelectorAll<HTMLButtonElement>("[data-delete-screening]").forEach((button) => {
    button.addEventListener("click", () => void removeEvent(button.dataset.deleteEvent || ""));
  });
}

function summaryCard(item: Summary) {
  const href = `/admin/events/${encodeURIComponent(item.slug)}`;
  const when = `${new Date(item.startAt).toLocaleString()} – ${new Date(item.stopAt).toLocaleString()}`;
  return `<article class="editor"><h2><a href="${href}">${esc(item.title)}</a></h2><p>${esc(item.slug)}${item.venue ? ` · ${esc(item.venue)}` : ""}</p><p>${esc(when)}</p><div class="admin-actions"><a class="button primary" href="${href}/results">Results</a><a class="button primary" href="${href}">Edit</a><button class="button danger" type="button" data-delete-screening="${esc(item.slug)}">Delete</button></div></article>`;
}

async function removeEvent(slug: string) {
  if (!confirm(`Delete ${slug}? This removes its polls, votes, codes, and images.`)) return;
  try {
    await api(`/api/admin/events/${encodeURIComponent(slug)}`, { method: "DELETE" });
    sessionStorage.setItem(noticeKey, JSON.stringify({ text: `Deleted ${slug}.`, error: false }));
    location.assign("/admin");
  } catch (err) { fail(err); }
}

async function resultsScreen(gen: number, slug: string) {
  paint(shell("Results", "<p>Loading…</p>"));
  const data = await api<EventResults>(resultsPath(slug));
  if (gen !== generation) return;
  latestResults = data;
  noteResultsSkew(data.now);
  paint(shell(data.title, resultsBody(data)));
  bindResultVoting(gen, slug);
  syncResultClocks();
  startResultsLive(gen, slug);
}

function resultsPath(slug: string) {
  return `/api/admin/events/${encodeURIComponent(slug)}/results`;
}

function ballotLabel(count: number) {
  return `${count} ${count === 1 ? "ballot" : "ballots"}`;
}

function voteLabel(count: number) {
  return `${count} ${count === 1 ? "vote" : "votes"}`;
}

function resultsBody(data: EventResults) {
  const polls = data.polls.map(resultPoll).join("") || "<p>No polls yet.</p>";
  return `<p><a href="/admin/events/${encodeURIComponent(data.slug)}">Edit event</a></p><p data-result-ballots>${ballotLabel(data.ballots)}</p><div id="results">${polls}</div>`;
}

function resultPoll(poll: ResultPoll) {
  const options = poll.options.length ? `<div data-result-options>${poll.options.map((option) => resultOption(poll, option)).join("")}</div>` : `<p class="help">No options yet.</p>`;
  return `<section class="editor result-poll" data-result-poll="${esc(poll.id)}"><h2>${esc(poll.title)}</h2><div class="countdown" data-countdown="${esc(poll.id)}" hidden><span class="countdown-prefix"></span><span class="countdown-clock"></span></div><p class="window" data-window="${esc(poll.id)}" hidden></p><p data-result-total>${voteLabel(poll.votes)}</p>${options}${votingControls()}</section>`;
}

function resultOption(poll: ResultPoll, option: ResultOption) {
  const share = poll.votes ? (option.votes / poll.votes) * 100 : 0;
  return `<div class="result-row" data-result-option="${esc(option.id)}"><div class="result-label"><span>${esc(option.title)}</span><span data-result-count>${option.votes} · ${Math.round(share)}%</span></div><div class="result-track" aria-hidden="true"><span class="result-fill" style="width:${share}%"></span></div></div>`;
}

function resultShape(data: EventResults) {
  return data.polls.map((poll) => `${poll.id}:${poll.options.map((option) => option.id).sort().join(",")}`).join("|");
}

function applyResults(data: EventResults) {
  latestResults = data;
  noteResultsSkew(data.now);
  const root = document.querySelector<HTMLElement>("#results");
  const ballots = document.querySelector<HTMLElement>("[data-result-ballots]");
  if (!root || !ballots || resultShape(data) !== resultNodesShape()) {
    if (root) {
      for (const stop of resultClocks.values()) stop();
      resultClocks.clear();
      resultClockKeys.clear();
      root.innerHTML = data.polls.map(resultPoll).join("") || "<p>No polls yet.</p>";
    }
  } else {
    ballots.textContent = ballotLabel(data.ballots);
    for (const poll of data.polls) {
      const section = document.querySelector<HTMLElement>(`[data-result-poll="${CSS.escape(poll.id)}"]`);
      const total = section?.querySelector<HTMLElement>("[data-result-total]");
      const list = section?.querySelector<HTMLElement>("[data-result-options]");
      if (total) total.textContent = voteLabel(poll.votes);
      if (!list) continue;
      for (const option of poll.options) {
        const row = list.querySelector<HTMLElement>(`[data-result-option="${CSS.escape(option.id)}"]`);
        if (!row) continue;
        list.appendChild(row);
        const share = poll.votes ? (option.votes / poll.votes) * 100 : 0;
        const count = row.querySelector<HTMLElement>("[data-result-count]");
        const fill = row.querySelector<HTMLElement>(".result-fill");
        if (count) count.textContent = `${option.votes} · ${Math.round(share)}%`;
        if (fill) fill.style.width = `${share}%`;
      }
    }
  }
  if (ballots) ballots.textContent = ballotLabel(data.ballots);
  bindResultVoting(generation, data.slug);
  syncResultClocks();
}

function bindResultVoting(gen: number, screeningSlug: string) {
  const data = latestResults;
  if (!data) return;
  for (const poll of data.polls) {
    const section = document.querySelector<HTMLElement>(`[data-result-poll="${CSS.escape(poll.id)}"]`);
    if (!section || section.dataset.votingBound === "1") continue;
    section.dataset.votingBound = "1";
    bindVoting(section, screeningSlug, () => latestResults?.polls.find((item) => item.id === poll.id) || poll, () => refreshResults(gen, screeningSlug));
  }
}

function resultNodesShape() {
  const sections = Array.from(document.querySelectorAll<HTMLElement>("[data-result-poll]"));
  return sections.map((section) => {
    const id = section.dataset.resultPoll || "";
    const options = Array.from(section.querySelectorAll<HTMLElement>("[data-result-option]")).map((row) => row.dataset.resultOption || "").sort().join(",");
    return `${id}:${options}`;
  }).join("|");
}

function noteResultsSkew(now: string) {
  const stamp = Date.parse(now);
  if (Number.isFinite(stamp)) resultsSkew = stamp - Date.now();
}

function resultsNow() {
  return Date.now() + resultsSkew;
}

function freshenResultPoll(poll: ResultPoll) {
  poll.votingOpen = votingOpen(poll.startAt, poll.stopAt, resultsNow());
}

function formatResultTime(iso: string) {
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return "";
  return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(new Date(at));
}

function syncResultClocks() {
  const data = latestResults;
  if (!data) return;
  const now = resultsNow();
  for (const poll of data.polls) {
    freshenResultPoll(poll);
    const cue = nextVotingCue([poll], now);
    const box = document.querySelector<HTMLElement>(`[data-countdown="${CSS.escape(poll.id)}"]`);
    const windowEl = document.querySelector<HTMLElement>(`[data-window="${CSS.escape(poll.id)}"]`);
    if (!box) continue;
    const showClock = Boolean(cue);
    if (!showClock) {
      box.hidden = true;
      resultClocks.get(poll.id)?.();
      resultClocks.delete(poll.id);
      resultClockKeys.delete(poll.id);
      if (windowEl) {
        windowEl.hidden = false;
        windowEl.className = poll.votingOpen ? "window" : "window closed";
        const when = formatResultTime(poll.stopAt);
        if (!poll.votingOpen) windowEl.textContent = Date.parse(poll.startAt) > now ? "Voting isn't open yet" : "Voting is closed";
        else if (when) windowEl.textContent = `Voting ends at ${when}`;
        else windowEl.textContent = "Voting is open";
      }
      continue;
    }
    if (windowEl) windowEl.hidden = true;
    box.hidden = false;
    const label = box.querySelector<HTMLElement>(".countdown-prefix");
    if (label) label.textContent = cue && cue.kind === "end" ? "Voting ends in" : "Voting starts in";
    const key = cue ? `${cue.kind}:${cue.at}` : "";
    if (resultClockKeys.get(poll.id) === key) continue;
    resultClockKeys.set(poll.id, key);
    resultClocks.get(poll.id)?.();
    const clock = box.querySelector<HTMLElement>(".countdown-clock");
    if (clock && cue) resultClocks.set(poll.id, startClock(clock, cue.at, resultsNow));
  }
}

function startResultsLive(gen: number, slug: string) {
  window.clearInterval(resultsTimer);
  window.clearInterval(resultsWatch);
  resultsWatch = window.setInterval(() => {
    if (gen !== generation) return;
    syncResultClocks();
  }, 250);
  resultsTimer = window.setInterval(() => {
    if (gen !== generation || document.visibilityState !== "visible") return;
    void refreshResults(gen, slug);
  }, resultsEveryMs);
}

async function refreshResults(gen: number, slug: string) {
  try {
    const data = await api<EventResults>(resultsPath(slug));
    if (gen !== generation) return;
    applyResults(data);
  } catch {
    /* The next poll retries. */
  }
}

function newScreen() {
  paint(shell("New event", `<form id="screening-form" class="editor"><p class="help">After this, you can add a banner, polls, options, and vote codes.</p>${screeningFields(null)}<div class="admin-actions"><button class="button primary" type="submit">Create event</button></div></form>`));
  bindEventForm(null);
}

function stopLabel(minutes: number) {
  if (minutes === 0) return "Stop voting now";
  return `Stop voting in ${minutes} ${minutes === 1 ? "minute" : "minutes"}`;
}

function votingControls() {
  return `<div class="vote-controls"><button class="button primary" type="button" data-start-now>Start voting</button><p class="stop-in"><button class="button primary count-button" type="button" data-stop-in>${stopLabel(5)}</button><input type="number" min="0" max="240" value="5" data-stop-minutes aria-label="Minutes"></p></div>`;
}

function votingStatus(poll: Poll) {
  const opens = formatResultTime(poll.startAt);
  const closes = formatResultTime(poll.stopAt);
  if (Date.parse(poll.startAt) > Date.now()) return `Voting isn't open yet · opens at ${opens}`;
  if (poll.votingOpen) return `Voting is open · closes at ${closes}`;
  return `Voting is closed · closed at ${closes}`;
}

function pollVoting(poll: Poll) {
  return `<section class="poll-voting"><p class="window ${poll.votingOpen ? "open" : "closed"}">${esc(votingStatus(poll))}</p><p class="help">Picks are saved from the open time until the close time. Start voting sets the open time to now. Stop voting in X minutes sets the close time that far ahead. Zero closes it now.</p>${votingControls()}</section>`;
}

type TimedPoll = { slug: string; title: string; startAt: string; stopAt: string };

async function startPollNow(screeningSlug: string, poll: TimedPoll, reload: () => Promise<void>) {
  if (Date.parse(poll.stopAt) <= Date.now()) {
    showMessage(`${poll.title} has already closed. Set a later close time first.`, true);
    return;
  }
  try {
    await api(`/api/admin/events/${encodeURIComponent(screeningSlug)}/polls/${encodeURIComponent(poll.slug)}`, { method: "PATCH", body: JSON.stringify(startNow()) });
    showMessage(`${poll.title} opens now.`);
    await reload();
  } catch (err) { fail(err); }
}

async function stopPoll(screeningSlug: string, poll: TimedPoll, minutes: number, reload: () => Promise<void>) {
  try {
    const body = minutes === 0 ? stopNow(poll.startAt) : stopInMinutes(poll.startAt, minutes);
    await api(`/api/admin/events/${encodeURIComponent(screeningSlug)}/polls/${encodeURIComponent(poll.slug)}`, { method: "PATCH", body: JSON.stringify(body) });
    showMessage(minutes === 0 ? `${poll.title} is closed.` : `${poll.title} stops in ${minutes} ${minutes === 1 ? "minute" : "minutes"}.`);
    await reload();
  } catch (err) { fail(err); }
}

function bindVoting(root: HTMLElement, screeningSlug: string, current: () => TimedPoll, reload: () => Promise<void>) {
  root.querySelector("[data-start-now]")?.addEventListener("click", () => void startPollNow(screeningSlug, current(), reload));
  const minutesInput = root.querySelector<HTMLInputElement>("[data-stop-minutes]");
  const stopButton = root.querySelector<HTMLButtonElement>("[data-stop-in]");
  const paintStop = () => { if (stopButton) stopButton.textContent = stopLabel(clampMinutes(minutesInput?.value || "")); };
  minutesInput?.addEventListener("input", paintStop);
  stopButton?.addEventListener("click", () => void stopPoll(screeningSlug, current(), clampMinutes(minutesInput?.value || ""), reload));
}

function screeningFields(screening: Event | null) {
  return `<div class="field-row"><label>Slug<input name="slug" required maxlength="64" pattern="[a-z0-9]+(?:-[a-z0-9]+)*" value="${esc(screening?.slug || "")}" /></label><label>Title<input name="title" required maxlength="200" value="${esc(screening?.title || "")}" /></label></div><label>Venue<input name="venue" maxlength="200" value="${esc(screening?.venue || "")}" /></label><label>Timezone<input name="timezone" maxlength="64" value="${esc(screening?.timezone || "America/Los_Angeles")}" /></label><div class="field-row"><label>Starts<input name="startAt" type="datetime-local" required value="${screening ? toLocalInput(screening.startAt) : ""}" /></label><label>Ends<input name="stopAt" type="datetime-local" required value="${screening ? toLocalInput(screening.stopAt) : ""}" /></label></div><p class="help">Times are read in your current timezone and stored as an exact instant. A new poll copies them, then keeps its own open and close times. Changing the slug changes the public ballot URL.</p>`;
}

function bindEventForm(existing: Event | null) {
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
      const saved = await api<Event>(existing ? `/api/admin/events/${encodeURIComponent(existing.slug)}` : "/api/admin/events", { method: existing ? "PATCH" : "POST", body: JSON.stringify(body) });
      if (existing && saved.slug === existing.slug) {
        note("Event saved.");
        await render();
        return;
      }
      sessionStorage.setItem(noticeKey, JSON.stringify({ text: existing ? "Event saved." : "Event created.", error: false }));
      location.assign(`/admin/events/${encodeURIComponent(saved.slug)}`);
    } catch (err) { fail(err); }
  });
}

async function editScreen(gen: number, slug: string) {
  rememberSheets();
  if (expandPollId) openPolls.add(expandPollId);
  if (expandOptionId) openOptions.add(expandOptionId);
  expandPollId = "";
  expandOptionId = "";
  paint(shell("Event", "<p>Loading…</p>"));
  const [screening, counts] = await Promise.all([
    api<Event>(`/api/admin/events/${encodeURIComponent(slug)}`),
    api<CodeList>(`/api/admin/events/${encodeURIComponent(slug)}/codes`),
  ]);
  if (gen !== generation) return;
  paint(shell(screening.title, editBody(screening, counts)));
  bindEventForm(screening);
  bindBanner(screening);
  bindDeleteEvent(screening);
  for (const poll of screening.polls) {
    bindPoll(screening, poll);
    for (const option of poll.options) bindOption(screening, poll, option);
    bindNewOption(screening, poll);
  }
  bindNewPoll(screening);
  bindReveals();
  bindSheets();
  bindPollDrag(screening);
  bindCodes(screening);
}

function editBody(screening: Event, counts: CodeList) {
  const hasPolls = screening.polls.length > 0;
  const polls = hasPolls ? `<div id="poll-list" class="sheet-list">${screening.polls.map((poll) => pollBlock(screening, poll)).join("")}</div>` : "<p>No polls yet.</p>";
  return `<p><a href="${esc(screening.links.ballot)}">Ballot page</a> · <a href="/api/events/${encodeURIComponent(screening.slug)}">Public JSON</a></p>
    <form id="screening-form" class="editor"><h2>Event</h2>${screeningFields(screening)}<div class="admin-actions"><button class="button primary" type="submit">Save event</button><button class="button danger" type="button" id="delete-screening">Delete event</button></div></form>
    <section class="editor" id="banner-section"><h2>Banner</h2>${screening.bannerImage ? `<img class="banner-preview" alt="" src="${esc(screening.bannerImage)}">` : "<p>No banner yet.</p>"}<label>Image file<input id="banner-file" type="file" accept="${imageAccept}"></label><div class="admin-actions"><button class="button primary" type="button" id="upload-banner">Upload banner</button>${screening.bannerImageKey ? `<button class="button danger" type="button" id="clear-banner">Remove banner</button>` : ""}</div><p class="help">Filenames use letters, numbers, dots, hyphens, and underscores. Uploading the same name replaces that file.</p></section>
    <h2 class="section-title">Polls</h2>${polls}
    ${hasPolls ? revealButton("new-poll", "Add poll", true) : ""}
    ${newPollForm(screening, !hasPolls)}
    <section class="editor codes-sheet"><h2>Vote codes</h2><p>${counts.total} total · ${counts.unused} unused · ${counts.used} used</p><p class="help">Each code's URL is https://vote.sandiego48.com/c/CODE, which enters that code. A code can update any poll that is still open. The download lists every code, whether it has been used, and its URL. Typing ignores spaces and hyphens.</p><p class="help">Reset voting deletes every code and every cast vote. Polls, films, and images stay.</p>${counts.unlisted ? `<p class="help">${counts.unlisted} older ${counts.unlisted === 1 ? "code was" : "codes were"} saved before downloads existed. ${counts.unlisted === 1 ? "It still works" : "They still work"} and ${counts.unlisted === 1 ? "is" : "are"} not in the file.</p>` : ""}<form id="codes-form"><div class="admin-actions"><button class="button primary" type="button" id="use-code">Create and use vote code</button><p class="generate-count"><button class="button primary count-button" type="submit" id="generate-codes">${generateLabel(1)}</button><input type="number" min="1" max="500" value="1" name="count" data-code-count aria-label="How many"></p><button class="button primary" type="button" id="download-codes">Download codes</button><button class="button danger" type="button" id="reset-voting">Reset voting</button></div></form></section>`;
}

function pollBlock(screening: Event, poll: Poll) {
  const hasOptions = poll.options.length > 0;
  const options = poll.options.map((option) => optionSheet(poll, option)).join("");
  const empty = hasOptions ? "" : `<p class="help">No options yet.</p>`;
  const formId = `new-option-${poll.id}`;
  const toggle = hasOptions ? revealButton(formId, "Add option") : "";
  const panelId = `poll-panel-${poll.id}`;
  return `<article class="editor poll-block" data-poll-id="${esc(poll.id)}">${sheetBar(`Drag ${poll.title}`, poll.title, panelId)}<div class="sheet-panel" id="${esc(panelId)}" hidden><form id="poll-${poll.id}" class="poll-form">${pollFields(screening, poll)}<div class="admin-actions"><button class="button danger" type="button" data-delete-poll="${esc(poll.slug)}">Delete poll</button></div></form>${pollVoting(poll)}<section class="poll-options"><h3>Options</h3>${empty}<div class="option-list sheet-list">${options}</div>${toggle}${optionForm(poll, null, !hasOptions)}</section></div></article>`;
}

function optionSheet(poll: Poll, option: Option) {
  const panelId = `option-panel-${option.id}`;
  return `<article class="option-sheet" data-option-id="${esc(option.id)}">${sheetBar(`Drag ${option.title}`, option.title, panelId)}<div class="sheet-panel" id="${esc(panelId)}" hidden>${optionForm(poll, option)}</div></article>`;
}

function sheetBar(label: string, title: string, panelId: string) {
  return `<div class="sheet-bar"><button type="button" class="drag" aria-label="${esc(label)}"><span class="grip" aria-hidden="true"></span></button><button type="button" class="sheet-toggle" aria-expanded="false" aria-controls="${esc(panelId)}"><span class="sheet-name">${esc(title)}</span></button></div>`;
}

function newPollForm(screening: Event, open: boolean) {
  return `<form id="new-poll" class="editor"${open ? "" : " hidden"}><h2>New poll</h2>${pollFields(screening, null)}<div class="admin-actions"><button class="button primary" type="submit">Add poll</button>${collapseButton(open)}</div></form>`;
}

function revealButton(id: string, label: string, centered = false) {
  return `<div class="admin-actions add-toggle-row${centered ? " is-centered" : ""}"><button class="button primary add-toggle" type="button" data-reveal="${esc(id)}" aria-expanded="false" aria-controls="${esc(id)}">${esc(label)}</button></div>`;
}

function collapseButton(open: boolean) {
  return open ? "" : `<button class="button primary" type="button" data-collapse>Cancel</button>`;
}

function pollFields(screening: Event, poll: Poll | null) {
  const config = poll?.imageConfig;
  const start = toLocalInput(poll?.startAt || screening.startAt);
  const stop = toLocalInput(poll?.stopAt || screening.stopAt);
  const help = poll ? "Changes save as you edit. " : "";
  return `<div class="field-row"><label>Slug<input name="slug" required maxlength="64" pattern="[a-z0-9]+(?:-[a-z0-9]+)*" value="${esc(poll?.slug || "")}"></label><label>Title<input name="title" required maxlength="200" value="${esc(poll?.title || "")}"></label></div><label>Instructions<textarea name="instructions" maxlength="2000" rows="3">${esc(poll?.instructions || "")}</textarea></label><div class="field-row"><label>Minimum selections<input name="minSelections" type="number" min="0" max="100" required value="${poll?.minSelections ?? 1}"></label><label>Maximum selections<input name="maxSelections" type="number" min="0" max="100" required value="${poll?.maxSelections ?? 1}"></label></div><div class="field-row"><label>Voting opens<input name="startAt" type="datetime-local" required value="${start}"></label><label>Voting closes<input name="stopAt" type="datetime-local" required value="${stop}"></label></div><div class="field-row"><label>Aspect ratio<input name="aspectRatio" required value="${esc(config?.aspectRatio || "16:9")}"></label><label>Seconds per image<input name="cycle" type="number" min="1" max="60" required value="${config?.cycle ?? 2}"></label><label class="check">Zoomable<input name="zoomable" type="checkbox"${config?.zoomable ? " checked" : ""}></label></div><p class="help">${help}Zoomable adds a magnifier on each image so a voter can look closer. This poll opens at its open time and closes at its close time. Start voting and Stop voting in X minutes change those times.</p>`;
}

function optionForm(poll: Poll, option: Option | null, open = true) {
  const id = option ? `option-${option.id}` : `new-option-${poll.id}`;
  const thumbs = option ? option.imageKeys.map((key, index) => `<figure data-image-key="${esc(key)}"><img alt="" src="${esc(option.images[index] || "")}"><button type="button" data-remove-image="${esc(key)}">Remove image</button></figure>`).join("") : "";
  const heading = option ? "" : `<h3>New option</h3>`;
  const actions = option
    ? `<div class="admin-actions"><button class="button danger" type="button" data-delete-option="${esc(option.id)}">Delete option</button></div>`
    : `<div class="admin-actions"><button class="button primary" type="submit">Add option</button>${collapseButton(open)}</div>`;
  return `<form id="${id}" class="option-editor"${option || open ? "" : " hidden"} data-option-id="${esc(option?.id || "")}">${heading}<label>Title<input name="title" required maxlength="200" value="${esc(option?.title || "")}"></label><label>Description<textarea name="description" maxlength="2000" rows="2">${esc(option?.description || "")}</textarea></label>${option ? `<div class="thumbs" style="${frameStyle(poll.imageConfig?.aspectRatio)}">${thumbs}</div>` : ""}<label>${option ? "Add an image" : "Image"}<input name="file" type="file" accept="${imageAccept}"></label>${actions}</form>`;
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

function bindBanner(screening: Event) {
  document.querySelector("#upload-banner")!.addEventListener("click", async () => {
    const file = document.querySelector<HTMLInputElement>("#banner-file")!.files?.[0];
    if (!file) { showMessage("Choose a banner image first.", true); return; }
    try {
      const key = await upload(screening.slug, file);
      await api(`/api/admin/events/${encodeURIComponent(screening.slug)}`, { method: "PATCH", body: JSON.stringify({ bannerImageKey: key }) });
      note("Banner saved.");
      await render();
    } catch (err) { fail(err); }
  });
  document.querySelector("#clear-banner")?.addEventListener("click", async () => {
    try {
      await api(`/api/admin/events/${encodeURIComponent(screening.slug)}`, { method: "PATCH", body: JSON.stringify({ bannerImageKey: null }) });
      note("Banner removed.");
      await render();
    } catch (err) { fail(err); }
  });
}

function bindDeleteEvent(screening: Event) {
  document.querySelector("#delete-screening")!.addEventListener("click", () => void removeEvent(screening.slug));
}

function bindPoll(screening: Event, poll: Poll) {
  const form = document.querySelector<HTMLFormElement>(`#poll-${poll.id}`)!;
  const ratio = form.querySelector<HTMLInputElement>("[name=aspectRatio]");
  let timer = 0;
  const schedule = () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => void persistPoll(), saveDelayMs);
  };
  const persistPoll = () => enqueue(`poll:${poll.id}`, async () => {
    if (!form.isConnected || !form.checkValidity()) return;
    const saved = await api<Poll>(`/api/admin/events/${encodeURIComponent(screening.slug)}/polls/${encodeURIComponent(poll.slug)}`, { method: "PATCH", body: JSON.stringify(pollBody(form)) });
    poll.slug = saved.slug;
    poll.title = saved.title;
    showMessage("Saved.");
  });
  ratio?.addEventListener("input", () => {
    const frame = frameParts(ratio.value);
    if (!frame) return;
    form.closest(".poll-block")?.querySelectorAll<HTMLElement>(".thumbs").forEach((thumbs) => {
      thumbs.style.setProperty("--frame-w", String(frame.w));
      thumbs.style.setProperty("--frame-h", String(frame.h));
    });
  });
  form.addEventListener("input", (event) => {
    const target = event.target;
    if (target instanceof HTMLInputElement && target.name === "title") {
      const name = form.closest(".poll-block")?.querySelector(".sheet-name");
      if (name) name.textContent = target.value || "Untitled poll";
    }
    schedule();
  });
  form.addEventListener("change", schedule);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    window.clearTimeout(timer);
    void persistPoll();
  });
  form.querySelector<HTMLButtonElement>("[data-delete-poll]")!.addEventListener("click", async () => {
    if (!confirm(`Delete poll ${poll.title}?`)) return;
    try {
      await api(`/api/admin/events/${encodeURIComponent(screening.slug)}/polls/${encodeURIComponent(poll.slug)}`, { method: "DELETE" });
      note("Poll deleted.");
      await render();
    } catch (err) { fail(err); }
  });
  const block = form.closest<HTMLElement>(".poll-block");
  if (block) bindVoting(block, screening.slug, () => poll, () => render());
  const list = block?.querySelector<HTMLElement>(".option-list");
  if (list) bindReorder(list, ".option-sheet", () => void persistOptionOrder(screening, poll, list));
}

function bindNewPoll(screening: Event) {
  document.querySelector<HTMLFormElement>("#new-poll")!.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget as HTMLFormElement;
    try {
      const saved = await api<Poll>(`/api/admin/events/${encodeURIComponent(screening.slug)}/polls`, { method: "POST", body: JSON.stringify(pollBody(form)) });
      expandPollId = saved.id;
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
      zoomable: form.querySelector<HTMLInputElement>("[name=zoomable]")?.checked === true,
    },
    startAt: fromLocalInput(String(data.startAt || "")),
    stopAt: fromLocalInput(String(data.stopAt || "")),
  };
  return body;
}

function bindOption(screening: Event, poll: Poll, option: Option) {
  const form = document.querySelector<HTMLFormElement>(`#option-${option.id}`)!;
  let timer = 0;
  const schedule = () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => void persist(false), saveDelayMs);
  };
  const persist = (withFile: boolean) => enqueue(`option:${option.id}`, async () => {
    if (!form.isConnected || !form.checkValidity()) return;
    const file = form.querySelector<HTMLInputElement>("[name=file]")?.files?.[0];
    if (withFile && !file) return;
    const saved = await saveOption(screening, poll, option, form, withFile);
    option.title = saved.title;
    option.description = saved.description;
    option.imageKeys = saved.imageKeys;
    option.images = saved.images;
    const input = form.querySelector<HTMLInputElement>("[name=file]");
    if (input) input.value = "";
    if (withFile) {
      expandOptionId = option.id;
      note("Saved.");
      await render();
      return;
    }
    showMessage("Saved.");
  });
  form.addEventListener("input", (event) => {
    const target = event.target;
    if (target instanceof HTMLInputElement && target.type === "file") return;
    if (target instanceof HTMLInputElement && target.name === "title") {
      const name = form.closest(".option-sheet")?.querySelector(".sheet-name");
      if (name) name.textContent = target.value || "Untitled option";
    }
    schedule();
  });
  form.addEventListener("change", (event) => {
    const target = event.target;
    if (target instanceof HTMLInputElement && target.type === "file") {
      window.clearTimeout(timer);
      void persist(true);
      return;
    }
    schedule();
  });
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    window.clearTimeout(timer);
    void persist(false);
  });
  form.querySelectorAll<HTMLButtonElement>("[data-remove-image]").forEach((button) => {
    button.addEventListener("click", async () => {
      try {
        const imageKeys = option.imageKeys.filter((key) => key !== button.dataset.removeImage);
        await api(optionPath(screening, poll, option.id), { method: "PATCH", body: JSON.stringify({ imageKeys }) });
        expandOptionId = option.id;
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

function bindNewOption(screening: Event, poll: Poll) {
  document.querySelector<HTMLFormElement>(`#new-option-${poll.id}`)!.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget as HTMLFormElement;
    try {
      const file = form.querySelector<HTMLInputElement>("[name=file]")!.files?.[0];
      const imageKeys = file ? [await upload(screening.slug, file)] : [];
      const data = formValues(form);
      const body = { title: String(data.title || ""), description: String(data.description || "") || null, imageKeys };
      const saved = await api<Option>(`/api/admin/events/${encodeURIComponent(screening.slug)}/polls/${encodeURIComponent(poll.slug)}/options`, { method: "POST", body: JSON.stringify(body) });
      expandPollId = poll.id;
      expandOptionId = saved.id;
      note("Option added.");
      await render();
    } catch (err) { fail(err); }
  });
}

async function saveOption(screening: Event, poll: Poll, option: Option, form: HTMLFormElement, withFile: boolean) {
  const data = formValues(form);
  const body: Record<string, unknown> = { title: String(data.title || ""), description: String(data.description || "") || null };
  if (withFile) {
    const file = form.querySelector<HTMLInputElement>("[name=file]")?.files?.[0];
    const imageKeys = option.imageKeys.slice();
    if (file) imageKeys.push(await upload(screening.slug, file));
    body.imageKeys = imageKeys;
  }
  return api<Option>(optionPath(screening, poll, option.id), { method: "PATCH", body: JSON.stringify(body) });
}

function optionPath(screening: Event, poll: Poll, optionId: string) {
  return `/api/admin/events/${encodeURIComponent(screening.slug)}/polls/${encodeURIComponent(poll.slug)}/options/${encodeURIComponent(optionId)}`;
}

function rememberSheets() {
  openPolls.clear();
  openOptions.clear();
  document.querySelectorAll<HTMLElement>(".poll-block").forEach((block) => {
    const panel = block.querySelector<HTMLElement>(":scope > .sheet-panel");
    if (panel && !panel.hidden && block.dataset.pollId) openPolls.add(block.dataset.pollId);
  });
  document.querySelectorAll<HTMLElement>(".option-sheet").forEach((sheet) => {
    const panel = sheet.querySelector<HTMLElement>(":scope > .sheet-panel");
    if (panel && !panel.hidden && sheet.dataset.optionId) openOptions.add(sheet.dataset.optionId);
  });
}

function bindSheets() {
  document.querySelectorAll<HTMLButtonElement>(".sheet-toggle").forEach((button) => {
    button.addEventListener("click", () => {
      const panel = document.getElementById(button.getAttribute("aria-controls") || "");
      if (!(panel instanceof HTMLElement)) return;
      const open = panel.hidden;
      panel.hidden = !open;
      button.setAttribute("aria-expanded", open ? "true" : "false");
    });
  });
  document.querySelectorAll<HTMLElement>(".poll-block").forEach((block) => {
    if (block.dataset.pollId && openPolls.has(block.dataset.pollId)) setSheetOpen(block, true);
  });
  document.querySelectorAll<HTMLElement>(".option-sheet").forEach((sheet) => {
    if (sheet.dataset.optionId && openOptions.has(sheet.dataset.optionId)) setSheetOpen(sheet, true);
  });
}

function setSheetOpen(root: HTMLElement, open: boolean) {
  const panel = root.querySelector<HTMLElement>(":scope > .sheet-panel");
  const toggle = root.querySelector<HTMLButtonElement>(":scope > .sheet-bar .sheet-toggle");
  if (!panel || !toggle) return;
  panel.hidden = !open;
  toggle.setAttribute("aria-expanded", open ? "true" : "false");
}

function enqueue(key: string, job: () => Promise<void>) {
  const previous = saveTails.get(key) || Promise.resolve();
  const next = previous.catch(() => undefined).then(async () => {
    try { await job(); }
    catch (err) { fail(err); }
  });
  saveTails.set(key, next);
  return next;
}

function bindPollDrag(screening: Event) {
  const list = document.querySelector<HTMLElement>("#poll-list");
  if (!list) return;
  bindReorder(list, ".poll-block", () => void persistPollOrder(screening, list));
}

async function persistPollOrder(screening: Event, list: HTMLElement) {
  const slugs = Array.from(list.querySelectorAll<HTMLElement>(":scope > .poll-block")).map((block) => screening.polls.find((item) => item.id === block.dataset.pollId)?.slug || "");
  if (slugs.some((slug) => !slug)) return;
  if (slugs.every((slug, index) => screening.polls[index]?.slug === slug)) return;
  try {
    await api(`/api/admin/events/${encodeURIComponent(screening.slug)}/polls/order`, { method: "PUT", body: JSON.stringify({ slugs }) });
    const bySlug = new Map(screening.polls.map((poll) => [poll.slug, poll]));
    screening.polls = slugs.map((slug, index) => {
      const poll = bySlug.get(slug)!;
      poll.sortOrder = index;
      return poll;
    });
    showMessage("Saved.");
  } catch (err) { fail(err); }
}

async function persistOptionOrder(screening: Event, poll: Poll, list: HTMLElement) {
  const ids = Array.from(list.querySelectorAll<HTMLElement>(":scope > .option-sheet")).map((sheet) => sheet.dataset.optionId || "");
  if (ids.some((id) => !id)) return;
  if (ids.every((id, index) => poll.options[index]?.id === id)) return;
  try {
    await api(`/api/admin/events/${encodeURIComponent(screening.slug)}/polls/${encodeURIComponent(poll.slug)}/options/order`, { method: "PUT", body: JSON.stringify({ ids }) });
    const byId = new Map(poll.options.map((option) => [option.id, option]));
    poll.options = ids.map((id, index) => {
      const option = byId.get(id)!;
      option.sortOrder = index;
      return option;
    });
    showMessage("Saved.");
  } catch (err) { fail(err); }
}

function bindReorder(list: HTMLElement, itemSelector: string, onDrop: () => void) {
  list.querySelectorAll<HTMLElement>(itemSelector).forEach((item) => {
    const handle = item.querySelector<HTMLElement>(":scope > .sheet-bar .drag");
    if (!handle) return;
    handle.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      handle.setPointerCapture(event.pointerId);
      item.classList.add("is-dragging");
      const move = (ev: PointerEvent) => {
        if (ev.clientY < 72) window.scrollBy(0, -14);
        else if (ev.clientY > window.innerHeight - 72) window.scrollBy(0, 14);
        const target = Array.from(list.querySelectorAll<HTMLElement>(`:scope > ${itemSelector}`)).find((other) => {
          if (other === item) return false;
          const rect = other.getBoundingClientRect();
          return ev.clientY >= rect.top && ev.clientY <= rect.bottom;
        });
        if (!target) return;
        const rect = target.getBoundingClientRect();
        const next = ev.clientY > rect.top + rect.height / 2 ? target.nextElementSibling : target;
        if (next !== item) list.insertBefore(item, next);
      };
      const finish = () => {
        handle.removeEventListener("pointermove", move);
        handle.removeEventListener("pointerup", finish);
        handle.removeEventListener("pointercancel", finish);
        item.classList.remove("is-dragging");
        onDrop();
      };
      handle.addEventListener("pointermove", move);
      handle.addEventListener("pointerup", finish);
      handle.addEventListener("pointercancel", finish);
    });
    handle.addEventListener("keydown", (event) => {
      if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
      const sibling = event.key === "ArrowUp" ? item.previousElementSibling : item.nextElementSibling;
      if (!(sibling instanceof HTMLElement) || !sibling.matches(itemSelector)) return;
      event.preventDefault();
      if (event.key === "ArrowUp") list.insertBefore(item, sibling);
      else list.insertBefore(item, sibling.nextSibling);
      onDrop();
      handle.focus();
    });
  });
}

function generateLabel(count: number) {
  return `Generate ${count} ${count === 1 ? "code" : "codes"}`;
}

function clampCodeCount(value: string) {
  const count = Math.round(Number(value));
  if (!Number.isFinite(count)) return 1;
  return Math.min(500, Math.max(1, count));
}

function bindCodes(screening: Event) {
  const form = document.querySelector<HTMLFormElement>("#codes-form")!;
  const countInput = form.querySelector<HTMLInputElement>("[data-code-count]");
  const generateButton = form.querySelector<HTMLButtonElement>("#generate-codes");
  const paintCount = () => { if (generateButton) generateButton.textContent = generateLabel(clampCodeCount(countInput?.value || "")); };
  countInput?.addEventListener("input", paintCount);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const count = clampCodeCount(countInput?.value || "");
    try {
      const result = await api<{ created: string[] }>(`/api/admin/events/${encodeURIComponent(screening.slug)}/codes`, { method: "POST", body: JSON.stringify({ count }) });
      note(`Generated ${result.created.length} codes.`);
      await render();
    } catch (err) { fail(err); }
  });
  document.querySelector("#use-code")!.addEventListener("click", () => void createAndUse(screening));
  document.querySelector("#download-codes")!.addEventListener("click", () => void downloadCodes(screening));
  document.querySelector("#reset-voting")!.addEventListener("click", () => void resetVoting(screening));
}

function clampMinutes(value: string) {
  const minutes = Math.round(Number(value));
  if (!Number.isFinite(minutes)) return 5;
  return Math.min(240, Math.max(0, minutes));
}

async function createAndUse(screening: Event) {
  const popup = window.open("", "_blank");
  if (!popup) {
    showMessage("Allow pop-ups to open the new vote code.", true);
    return;
  }
  try {
    const result = await api<{ created: string[] }>(`/api/admin/events/${encodeURIComponent(screening.slug)}/codes`, { method: "POST", body: JSON.stringify({ count: 1 }) });
    const code = result.created[0];
    if (!code) throw new ApiError("No vote code was created.", 500);
    popup.location.href = `${location.origin}/c/${encodeURIComponent(code)}`;
    note(`Opened ${code}.`);
    await render();
  } catch (err) {
    popup.close();
    fail(err);
  }
}

async function downloadCodes(screening: Event) {
  try {
    const list = await api<CodeList>(`/api/admin/events/${encodeURIComponent(screening.slug)}/codes`);
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

async function resetVoting(screening: Event) {
  if (!confirm(`Reset voting for ${screening.title}? This deletes every vote code and every cast vote. Polls, films, and images stay.`)) return;
  try {
    const result = await api<{ codes: number; votes: number }>(`/api/admin/events/${encodeURIComponent(screening.slug)}/reset`, { method: "POST" });
    const codes = `${result.codes} ${result.codes === 1 ? "code" : "codes"}`;
    const votes = `${result.votes} ${result.votes === 1 ? "vote" : "votes"}`;
    note(`Reset voting. Removed ${codes} and ${votes}.`);
    await render();
  } catch (err) { fail(err); }
}

async function upload(slug: string, file: File) {
  const filename = uploadName(file);
  const type = fileType(file);
  if (!filename || !type) throw new ApiError("Use a jpeg, png, webp, gif, or svg whose name is letters, numbers, dots, hyphens, and underscores.", 400);
  const result = await api<{ key: string }>(`/api/admin/events/${encodeURIComponent(slug)}/images`, { method: "POST", headers: { "content-type": type, "x-filename": filename }, body: file });
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
