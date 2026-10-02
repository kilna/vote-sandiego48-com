import "./style.css";
import { startAdmin } from "./admin";
import { startClock } from "./countdown";
import { nextVotingCue, votingOpen } from "../functions/voting";
import { pickMessage, samePicks, shouldApplySelections } from "./sync";
import { bindPosterZoom, posterZoomButton } from "./zoom";

type Voting = "scheduled" | "open" | "closed";
type Poll = {
  id: string;
  title: string;
  instructions: string;
  minSelections: number;
  maxSelections: number;
  imageConfig?: { aspectRatio?: string; cycle?: number; zoomable?: boolean };
  startAt: string;
  stopAt: string;
  voting?: Voting;
  votingOpen?: boolean;
  options: { id: string; title: string; description?: string; images: string[] }[];
};
type Screening = { id: string; slug: string; title: string; venue?: string; bannerImage?: string; startAt: string; stopAt: string; polls: Poll[] };
type Entry = { code: string; slug: string; selections?: Record<string, string[]> };
type Entered = { slug: string; title: string; used: boolean; selections: Record<string, string[]> };

const app = document.querySelector<HTMLDivElement>("#app")!;
const slug = decodeURIComponent(location.pathname.match(/^\/s\/([^/]+)/)?.[1] || "");
const codePath = location.pathname.match(/^\/c\/([^/]+)/)?.[1] || "";
const entryKey = "sd48-vote-entry";
let current: Screening;
let activeCode = "";
let selections: Record<string, string[]> = {};
let saveFlight: Promise<void> | null = null;
let saveAgain = false;
let stateFlight: Promise<void> | null = null;
let stateAgain = false;
let edits = 0;
let writes = 0;
let skewMs = 0;
const corrected = new Set<string>();
const clockStops = new Map<string, () => void>();
const clockKeys = new Map<string, string>();
let watch = 0;
let stateTimer = 0;
let cycles: number[] = [];
const stateEveryMs = 3000;

type BallotSnapshot = {
  now: string;
  polls: { id: string; voting: Voting; votingOpen: boolean; startAt: string; stopAt: string }[];
  selections: Record<string, string[]>;
};

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[c] || c));

function loadEntry(): Entry | null {
  try {
    const parsed = JSON.parse(sessionStorage.getItem(entryKey) || "") as Entry;
    return parsed.code && parsed.slug ? parsed : null;
  } catch {
    return null;
  }
}
function saveEntry(entry: Entry) { sessionStorage.setItem(entryKey, JSON.stringify(entry)); }
function clearEntry() { sessionStorage.removeItem(entryKey); }
function brandHeader(hasHero = false) { return `<header class="masthead${hasHero ? " has-hero" : ""}"><a class="logo-link" href="/"><img class="logo" src="/logo-horiz-trans.png" alt="San Diego 48 Hour Film Project" width="2046" height="560"></a></header>`; }
function unavailable(message: string) { app.innerHTML = `${brandHeader()}<main class="home"><section class="intro"><h1>${esc(message)}</h1><p>Check the code on your screening ticket, then start again from the home page.</p><p><a class="change-code" href="/">Enter a vote code</a></p></section></main>`; }
function frameRatio(value?: string) { const match = /^(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)$/.exec(value || ""); return match ? `${match[1]} / ${match[2]}` : "16 / 9"; }
function cycleSeconds(value: unknown) { const seconds = typeof value === "number" ? value : Number(value); return Number.isInteger(seconds) && seconds >= 1 && seconds <= 60 ? seconds : 2; }
function pollOpen(poll: Poll) { return poll.votingOpen === true; }
function serverNow() { return Date.now() + skewMs; }

function notStarted(poll: Poll) {
  if (poll.voting === "open" || poll.voting === "closed") return false;
  const start = Date.parse(poll.startAt);
  return Number.isFinite(start) && serverNow() < start;
}

function render(s: Screening) {
  window.clearInterval(watch);
  cycles.forEach((id) => window.clearInterval(id));
  cycles = [];
  clearClocks();
  current = s;
  const hero = s.bannerImage ? `<div class="screening-banner" style="background-image:url('${esc(s.bannerImage)}')"></div>` : "";
  app.innerHTML = `${brandHeader(Boolean(s.bannerImage))}${hero}<main><section class="intro"><span class="kicker">Audience voting</span><h1>${esc(s.title)}</h1>${s.venue ? `<p class="venue">${esc(s.venue)}</p>` : ""}<p>Make your picks. Vote code <strong>${esc(activeCode)}</strong>.</p></section><div id="ballot"><div id="polls">${s.polls.map(renderPoll).join("")}</div></div></main>`;
  document.querySelectorAll<HTMLElement>("[data-cycle]").forEach(startCycle);
  for (const poll of s.polls) {
    bindPoll(poll);
    paintWindow(poll);
  }
  syncCountdowns();
  watchVoting();
}

function renderPoll(poll: Poll) {
  const open = pollOpen(poll);
  const ratio = frameRatio(poll.imageConfig?.aspectRatio);
  const seconds = cycleSeconds(poll.imageConfig?.cycle);
  const chosen = new Set(selections[poll.id] || []);
  const type = poll.maxSelections === 1 && poll.minSelections > 0 ? "radio" : "checkbox";
  const options = poll.options.map((option) => {
    const image = option.images.length ? ` data-cycle='${esc(JSON.stringify(option.images))}' data-seconds="${seconds}" style="aspect-ratio:${ratio}"` : ` style="aspect-ratio:${ratio}"`;
    const checked = chosen.has(option.id) ? " checked" : "";
    const disabled = open ? "" : " disabled";
    const zoom = poll.imageConfig?.zoomable && option.images.length ? posterZoomButton(esc(option.title)) : "";
    return `<label class="option"><input type="${type}" name="poll-${poll.id}" value="${esc(option.id)}"${checked}${disabled}/><span class="option-image"${image}></span>${zoom}<span class="option-copy"><strong>${esc(option.title)}</strong>${option.description ? `<small>${esc(option.description)}</small>` : ""}</span></label>`;
  }).join("");
  const rule = poll.minSelections === poll.maxSelections ? `Select ${poll.minSelections}` : `Select ${poll.minSelections}–${poll.maxSelections}`;
  const titleId = `poll-${poll.id}-title`;
  return `<fieldset class="poll${open ? "" : " is-closed"}" data-poll="${esc(poll.id)}" aria-labelledby="${esc(titleId)}"><div class="poll-pin"><div class="poll-heading"><h2 class="poll-title" id="${esc(titleId)}">${esc(poll.title)}</h2><span class="rule">${rule}</span></div><div class="countdown" data-countdown="${esc(poll.id)}" hidden><span class="countdown-prefix"></span><span class="countdown-clock"></span></div><p class="window" data-window="${esc(poll.id)}" hidden></p><p class="pick-status" data-pick-status="${esc(poll.id)}" role="status"></p></div>${poll.instructions ? `<p class="instructions">${esc(poll.instructions)}</p>` : ""}<div class="options">${options}</div></fieldset>`;
}

function bindPoll(poll: Poll) {
  const inputs = document.querySelectorAll<HTMLInputElement>(`input[name="poll-${CSS.escape(poll.id)}"]`);
  inputs.forEach((input) => input.addEventListener("change", () => onPollChange(poll)));
}

function onPollChange(poll: Poll) {
  if (!pollOpen(poll)) return;
  edits += 1;
  corrected.delete(poll.id);
  const checked = Array.from(document.querySelectorAll<HTMLInputElement>(`input[name="poll-${CSS.escape(poll.id)}"]:checked`));
  selections[poll.id] = checked.map((input) => input.value);
  paintPick(poll);
  scheduleSave();
}

function scheduleSave() {
  if (saveFlight) {
    saveAgain = true;
    return;
  }
  saveFlight = saveSelections().finally(() => {
    saveFlight = null;
    if (saveAgain) {
      saveAgain = false;
      scheduleSave();
    }
  });
}

function openSelections() {
  const next: Record<string, string[]> = {};
  for (const poll of current.polls) {
    if (!pollOpen(poll)) continue;
    next[poll.id] = Array.from(document.querySelectorAll<HTMLInputElement>(`input[name="poll-${CSS.escape(poll.id)}"]:checked`)).map((input) => input.value);
  }
  return next;
}

async function saveSelections() {
  const chosen = openSelections();
  if (!Object.keys(chosen).length) return;
  const editsAtSend = edits;
  const writesAtSend = writes;
  let applied = false;
  try {
    const response = await fetch("/api/vote", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ screeningId: current.id, code: activeCode, selections: chosen }) });
    const data = await response.json().catch(() => null) as (BallotSnapshot & { error?: string }) | null;
    if (data && isSnapshot(data)) {
      applyWindows(data);
      if (shouldApplySelections({ edits, editsAtSend, writes, writesAtSend, saveInFlight: false })) {
        applySelections(data);
        applied = true;
      }
    }
    if (!response.ok) throw Error(data?.error || "That pick could not be saved");
    writes += 1;
    if (!applied) {
      for (const [id, ids] of Object.entries(chosen)) selections[id] = ids;
      saveEntry({ code: activeCode, slug, selections });
    }
  } catch {
    if (!applied) {
      saveAgain = false;
      for (const poll of current.polls) markUnsaved(poll);
      requestState();
    }
  }
}

function markUnsaved(poll: Poll) {
  if (!pollOpen(poll)) return;
  const status = document.querySelector<HTMLElement>(`[data-pick-status="${CSS.escape(poll.id)}"]`);
  if (!status) return;
  status.textContent = "That change was not saved";
  status.className = "pick-status is-short";
}

function watchVoting() {
  const tick = () => {
    let flipped = false;
    for (const poll of current.polls) {
      const before = poll.votingOpen === true;
      freshenScheduled(poll);
      if ((poll.votingOpen === true) !== before) flipped = true;
    }
    if (flipped) {
      for (const poll of current.polls) paintWindow(poll);
      requestState();
    }
    syncCountdowns();
  };
  tick();
  watch = window.setInterval(tick, 250);
}

function freshenScheduled(poll: Poll) {
  if (poll.voting === "open") poll.votingOpen = true;
  else if (poll.voting === "closed") poll.votingOpen = false;
  else poll.votingOpen = votingOpen(poll.voting, poll.startAt, poll.stopAt, serverNow());
}

function paintWindow(poll: Poll) {
  const field = document.querySelector<HTMLElement>(`[data-poll="${CSS.escape(poll.id)}"]`);
  if (!field) return;
  const open = pollOpen(poll);
  field.classList.toggle("is-closed", !open);
  field.querySelectorAll<HTMLInputElement>("input").forEach((input) => { input.disabled = !open; });
  const windowEl = field.querySelector<HTMLElement>("[data-window]");
  if (windowEl && !open) {
    windowEl.hidden = false;
    windowEl.className = "window closed";
    windowEl.textContent = notStarted(poll) ? "Voting isn't open yet" : "Voting is closed. These picks stay as they are.";
  } else if (windowEl) {
    windowEl.hidden = true;
    windowEl.textContent = "";
  }
  paintPick(poll);
}

function paintPick(poll: Poll) {
  const status = document.querySelector<HTMLElement>(`[data-pick-status="${CSS.escape(poll.id)}"]`);
  if (!status) return;
  const count = document.querySelectorAll<HTMLInputElement>(`input[name="poll-${CSS.escape(poll.id)}"]:checked`).length;
  const copy = pickMessage(poll, count, { corrected: corrected.has(poll.id), open: pollOpen(poll) });
  status.textContent = copy.text;
  status.className = `pick-status${copy.className}`;
}

function clearClocks() {
  for (const stop of clockStops.values()) stop();
  clockStops.clear();
  clockKeys.clear();
}

function formatTime(iso: string) {
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return "";
  return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(new Date(at));
}

function syncCountdowns() {
  const now = serverNow();
  for (const poll of current.polls) {
    const cue = nextVotingCue([poll], now);
    const box = document.querySelector<HTMLElement>(`[data-countdown="${CSS.escape(poll.id)}"]`);
    const windowEl = document.querySelector<HTMLElement>(`[data-window="${CSS.escape(poll.id)}"]`);
    if (!box) continue;
    if (!cue) {
      box.hidden = true;
      clockStops.get(poll.id)?.();
      clockStops.delete(poll.id);
      clockKeys.delete(poll.id);
      const when = formatTime(poll.stopAt);
      if (windowEl && pollOpen(poll) && poll.voting === "scheduled" && when) {
        windowEl.hidden = false;
        windowEl.className = "window";
        windowEl.textContent = `Voting ends at ${when}`;
      }
      continue;
    }
    if (windowEl) windowEl.hidden = true;
    box.hidden = false;
    const label = box.querySelector<HTMLElement>(".countdown-prefix");
    if (label) label.textContent = cue.kind === "end" ? "Voting ends in" : "Voting starts in";
    const key = `${cue.kind}:${cue.at}`;
    if (clockKeys.get(poll.id) === key) continue;
    clockKeys.set(poll.id, key);
    clockStops.get(poll.id)?.();
    const clock = box.querySelector<HTMLElement>(".countdown-clock");
    if (clock) clockStops.set(poll.id, startClock(clock, cue.at, serverNow));
  }
}

function isSnapshot(data: BallotSnapshot) {
  return typeof data.now === "string" && Array.isArray(data.polls) && !!data.selections && typeof data.selections === "object" && !Array.isArray(data.selections);
}

function noteSkew(now: string) {
  const stamp = Date.parse(now);
  if (Number.isFinite(stamp)) skewMs = stamp - Date.now();
}

function applyWindows(snapshot: BallotSnapshot) {
  noteSkew(snapshot.now);
  const byId = new Map(snapshot.polls.map((poll) => [poll.id, poll]));
  for (const poll of current.polls) {
    const next = byId.get(poll.id);
    if (!next) continue;
    poll.voting = next.voting;
    poll.votingOpen = next.votingOpen;
    poll.startAt = next.startAt;
    poll.stopAt = next.stopAt;
  }
  for (const poll of current.polls) paintWindow(poll);
  syncCountdowns();
}

function applySelections(snapshot: BallotSnapshot) {
  for (const poll of current.polls) {
    const stored = snapshot.selections[poll.id] || [];
    const inputs = Array.from(document.querySelectorAll<HTMLInputElement>(`input[name="poll-${CSS.escape(poll.id)}"]`));
    const local = inputs.filter((input) => input.checked).map((input) => input.value);
    const outside = stored.length < poll.minSelections || stored.length > poll.maxSelections;
    if (!samePicks(local, stored)) corrected.add(poll.id);
    else if (!outside) corrected.delete(poll.id);
    const storedSet = new Set(stored);
    for (const input of inputs) input.checked = storedSet.has(input.value);
    selections[poll.id] = stored;
    paintPick(poll);
  }
  saveEntry({ code: activeCode, slug, selections });
}

function requestState() {
  if (!activeCode || !current) return;
  if (stateFlight) {
    stateAgain = true;
    return;
  }
  const editsAtSend = edits;
  const writesAtSend = writes;
  stateFlight = pullState(editsAtSend, writesAtSend).finally(() => {
    stateFlight = null;
    if (stateAgain) {
      stateAgain = false;
      requestState();
    }
  });
}

async function pullState(editsAtSend: number, writesAtSend: number) {
  try {
    const response = await fetch("/api/state", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code: activeCode }) });
    const data = await response.json() as BallotSnapshot & { error?: string };
    if (!response.ok || !isSnapshot(data)) return;
    applyWindows(data);
    if (shouldApplySelections({ edits, editsAtSend, writes, writesAtSend, saveInFlight: Boolean(saveFlight) })) applySelections(data);
  } catch {
    /* The next poll retries. */
  }
}

function startStatePoll() {
  window.clearInterval(stateTimer);
  stateTimer = window.setInterval(() => {
    if (document.visibilityState === "visible") requestState();
  }, stateEveryMs);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") requestState();
  });
  requestState();
}

function startCycle(el: HTMLElement) {
  const imgs = JSON.parse(el.dataset.cycle || "[]") as string[];
  if (!imgs.length) return;
  const layers = imgs.map((src, index) => {
    const layer = document.createElement("span");
    layer.className = index === 0 ? "still is-shown" : "still";
    layer.style.backgroundImage = `url('${src.replace(/'/g, "%27")}')`;
    el.appendChild(layer);
    return layer;
  });
  if (layers.length < 2) return;
  const fadeMs = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 500;
  let shown = 0;
  let z = 1;
  cycles.push(window.setInterval(() => {
    const outgoing = layers[shown];
    shown = (shown + 1) % layers.length;
    const incoming = layers[shown];
    incoming.style.zIndex = String(++z);
    incoming.classList.add("is-shown");
    window.setTimeout(() => outgoing.classList.remove("is-shown"), fadeMs);
  }, cycleSeconds(el.dataset.seconds) * 1000));
}

async function enter(code: string) {
  const response = await fetch("/api/enter", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code }) });
  const data = await response.json() as { error?: string; slug?: string; title?: string; used?: boolean; selections?: Record<string, string[]> };
  if (!response.ok || !data.slug) throw Error(data.error || "That vote code could not be checked.");
  return { slug: data.slug, title: data.title || "", used: Boolean(data.used), selections: data.selections || {} } satisfies Entered;
}

async function loadScreening(screeningSlug: string) {
  const response = await fetch("/api/screenings/" + encodeURIComponent(screeningSlug));
  if (!response.ok) throw Error("Screening not found");
  return response.json() as Promise<Screening>;
}

function renderGate(message = "", code = "") {
  app.innerHTML = `${brandHeader()}<main class="home"><section class="intro"><span class="kicker">Audience choice</span><h1>Enter your vote code.</h1><p>The code on your screening ticket opens the ballot for that screening.</p></section><form id="code-gate" class="gate"><div class="callout"><label class="code-label">Vote code<input id="code" required autocomplete="one-time-code" autocapitalize="characters" placeholder="AB234" value="${esc(code)}" autofocus /></label><button class="button primary" type="submit">Continue <span>→</span></button></div><p class="message${message ? " error" : ""}" role="status">${esc(message)}</p></form></main>`;
  const form = document.querySelector<HTMLFormElement>("#code-gate")!;
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = form.querySelector<HTMLButtonElement>("button")!;
    const msg = form.querySelector<HTMLElement>(".message")!;
    const typed = form.querySelector<HTMLInputElement>("#code")!.value.trim();
    button.disabled = true;
    msg.className = "message";
    msg.textContent = "Checking your code…";
    try {
      const data = await enter(typed);
      saveEntry({ code: typed.toUpperCase(), slug: data.slug, selections: data.selections });
      location.assign("/s/" + encodeURIComponent(data.slug));
    } catch (err) {
      msg.className = "message error";
      msg.textContent = err instanceof Error ? err.message : "That vote code could not be checked.";
      button.disabled = false;
    }
  });
}

async function openCode(raw: string) {
  const code = decodeURIComponent(raw).trim();
  app.innerHTML = `${brandHeader()}<main class="home"><section class="intro"><h1>Checking your code…</h1></section></main>`;
  try {
    const data = await enter(code);
    saveEntry({ code: code.toUpperCase(), slug: data.slug, selections: data.selections });
    location.replace("/s/" + encodeURIComponent(data.slug));
  } catch (err) {
    renderGate(err instanceof Error ? err.message : "That vote code could not be checked.", code);
  }
}

async function openScreening() {
  const entry = loadEntry();
  if (!entry || entry.slug !== slug) { clearEntry(); location.replace("/"); return; }
  activeCode = entry.code;
  selections = entry.selections || {};
  try {
    const [screening, entered] = await Promise.all([loadScreening(slug), enter(entry.code)]);
    if (entered.slug !== slug) { clearEntry(); location.replace("/"); return; }
    selections = entered.selections;
    saveEntry({ code: entry.code, slug: entered.slug, selections });
    render(screening);
    startStatePoll();
  } catch (err) {
    if (err instanceof Error && /recognized|could not be checked/i.test(err.message)) renderGate(err.message, entry.code);
    else unavailable("Screening not found");
  }
}

bindPosterZoom(app);

if (location.pathname === "/admin" || location.pathname.startsWith("/admin/")) startAdmin();
else if (codePath) void openCode(codePath);
else if (slug) void openScreening();
else renderGate();
