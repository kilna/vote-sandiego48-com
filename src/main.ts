import "./style.css";
import { startAdmin } from "./admin";
import { startClock } from "./countdown";
import { nextVotingCue } from "../functions/voting";

type Voting = "scheduled" | "open" | "closed";
type Poll = {
  id: string;
  title: string;
  instructions: string;
  minSelections: number;
  maxSelections: number;
  imageConfig?: { aspectRatio?: string; cycle?: number };
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
const clockStops = new Map<string, () => void>();
const clockKeys = new Map<string, string>();
let armed: { at: number; kind: "start" | "end" } | null = null;
let watch = 0;
let toastTimer = 0;
let cycles: number[] = [];

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

function notStarted(poll: Poll) {
  if (poll.voting === "open" || poll.voting === "closed") return false;
  const start = Date.parse(poll.startAt);
  return Number.isFinite(start) && Date.now() < start;
}

function statusText(poll: Poll) {
  if (pollOpen(poll)) return "";
  return notStarted(poll) ? "Voting isn't open yet" : "Voting is closed";
}

function render(s: Screening) {
  window.clearInterval(watch);
  cycles.forEach((id) => window.clearInterval(id));
  cycles = [];
  window.clearTimeout(toastTimer);
  clearClocks();
  armed = null;
  current = s;
  const hero = s.bannerImage ? `<div class="screening-banner" style="background-image:url('${esc(s.bannerImage)}')"></div>` : "";
  app.innerHTML = `${brandHeader(Boolean(s.bannerImage))}${hero}<main><section class="intro"><span class="kicker">Audience voting</span><h1>${esc(s.title)}</h1>${s.venue ? `<p class="venue">${esc(s.venue)}</p>` : ""}<p>Make your picks. Vote code <strong>${esc(activeCode)}</strong>.</p></section><div id="ballot"><div id="polls">${s.polls.map(renderPoll).join("")}</div></div></main><p id="selection-toast" class="selection-toast" role="status"></p>`;
  document.querySelectorAll<HTMLElement>("[data-cycle]").forEach(startCycle);
  for (const poll of s.polls) bindPoll(poll);
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
    return `<label class="option"><input type="${type}" name="poll-${poll.id}" value="${esc(option.id)}"${checked}${disabled}/><span class="option-image"${image}></span><span class="option-copy"><strong>${esc(option.title)}</strong>${option.description ? `<small>${esc(option.description)}</small>` : ""}</span></label>`;
  }).join("");
  const rule = poll.minSelections === poll.maxSelections ? `Select ${poll.minSelections}` : `Select ${poll.minSelections}–${poll.maxSelections}`;
  const titleId = `poll-${poll.id}-title`;
  const status = statusText(poll);
  const ended = !open && !notStarted(poll);
  const statusLine = status ? `<p class="window closed">${esc(status)}</p>` : "";
  const pick = pickCopy(poll, chosen.size);
  const pickLine = open ? `<p class="pick-status${pick.className}" data-pick-status="${esc(poll.id)}">${esc(pick.text)}</p>` : "";
  return `<fieldset class="poll${open ? "" : " is-closed"}" aria-labelledby="${esc(titleId)}"><div class="poll-pin"><div class="poll-heading"><h2 class="poll-title" id="${esc(titleId)}">${esc(poll.title)}</h2><span class="rule">${rule}</span></div><div class="countdown" data-countdown="${esc(poll.id)}" hidden><span class="countdown-prefix"></span><span class="countdown-clock"></span></div>${statusLine}${pickLine}</div>${poll.instructions ? `<p class="instructions">${esc(poll.instructions)}</p>` : ""}${ended ? `<p class="help">This poll is closed. The picks shown here stay as they are.</p>` : ""}<div class="options">${options}</div></fieldset>`;
}

function pickCopy(poll: Poll, count: number) {
  if (count < poll.minSelections) {
    const remaining = poll.minSelections - count;
    const text = remaining === 1 ? "Select 1 more" : `Select ${remaining} more`;
    return { text, className: " is-short", toast: `${text} for ${poll.title}` };
  }
  if (count > poll.maxSelections) {
    const text = `Select at most ${poll.maxSelections}`;
    return { text, className: " is-over", toast: `${text} for ${poll.title}` };
  }
  if (count === 0) return { text: "", className: "", toast: "" };
  return { text: "Your vote counts", className: " is-counted", toast: `Your vote counts for ${poll.title}` };
}

function bindPoll(poll: Poll) {
  if (!pollOpen(poll)) return;
  const inputs = document.querySelectorAll<HTMLInputElement>(`input[name="poll-${CSS.escape(poll.id)}"]`);
  inputs.forEach((input) => input.addEventListener("change", () => onPollChange(poll)));
}

function onPollChange(poll: Poll) {
  const checked = Array.from(document.querySelectorAll<HTMLInputElement>(`input[name="poll-${CSS.escape(poll.id)}"]:checked`));
  const copy = pickCopy(poll, checked.length);
  const status = document.querySelector<HTMLElement>(`[data-pick-status="${CSS.escape(poll.id)}"]`);
  if (status) {
    status.textContent = copy.text;
    status.className = `pick-status${copy.className}`;
  }
  if (copy.toast) showToast(copy.toast);
  selections[poll.id] = checked.map((input) => input.value);
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
  try {
    const response = await fetch("/api/vote", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ screeningId: current.id, code: activeCode, selections: chosen }) });
    const data = await response.json() as { error?: string };
    if (!response.ok) throw Error(data.error || "That pick could not be saved");
    for (const [id, ids] of Object.entries(chosen)) selections[id] = ids;
    saveEntry({ code: activeCode, slug, selections });
  } catch (err) {
    const message = err instanceof Error ? err.message : "That pick could not be saved";
    showToast(message);
    if (message === "Voting is not open") {
      saveAgain = false;
      void refreshBallot();
    }
  }
}

function showToast(text: string) {
  const el = document.querySelector<HTMLElement>("#selection-toast");
  if (!el) return;
  el.textContent = text;
  el.classList.add("is-on");
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => el.classList.remove("is-on"), 1400);
}

function watchVoting() {
  const tick = () => {
    const hold = armed?.kind === "end" ? 1000 : 0;
    if (armed && Date.now() >= armed.at + hold) {
      armed = null;
      window.clearInterval(watch);
      void refreshBallot();
      return;
    }
    syncCountdowns();
  };
  tick();
  watch = window.setInterval(tick, 250);
}

function clearClocks() {
  for (const stop of clockStops.values()) stop();
  clockStops.clear();
  clockKeys.clear();
}

function syncCountdowns() {
  let soonest: { at: number; kind: "start" | "end" } | null = null;
  for (const poll of current.polls) {
    const cue = nextVotingCue([poll]);
    const box = document.querySelector<HTMLElement>(`[data-countdown="${CSS.escape(poll.id)}"]`);
    if (!box) continue;
    if (cue && (!soonest || cue.at < soonest.at)) soonest = { at: cue.at, kind: cue.kind };
    if (!cue || cue.kind === "start") {
      box.hidden = true;
      clockStops.get(poll.id)?.();
      clockStops.delete(poll.id);
      clockKeys.delete(poll.id);
      continue;
    }
    box.hidden = false;
    const label = box.querySelector<HTMLElement>(".countdown-prefix");
    if (label) label.textContent = "Voting ends in";
    const key = `${cue.kind}:${cue.at}`;
    if (clockKeys.get(poll.id) === key) continue;
    clockKeys.set(poll.id, key);
    clockStops.get(poll.id)?.();
    const clock = box.querySelector<HTMLElement>(".countdown-clock");
    if (clock) clockStops.set(poll.id, startClock(clock, cue.at));
  }
  if (soonest) armed = soonest;
}

async function refreshBallot() {
  try {
    const screening = await loadScreening(slug);
    const entered = await enter(activeCode);
    selections = entered.selections;
    saveEntry({ code: activeCode, slug, selections });
    render(screening);
  } catch {
    /* Keep the ballot on screen if the refresh fails. */
  }
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
  } catch (err) {
    if (err instanceof Error && /recognized|could not be checked/i.test(err.message)) renderGate(err.message, entry.code);
    else unavailable("Screening not found");
  }
}

if (location.pathname === "/admin" || location.pathname.startsWith("/admin/")) startAdmin();
else if (codePath) void openCode(codePath);
else if (slug) void openScreening();
else renderGate();
