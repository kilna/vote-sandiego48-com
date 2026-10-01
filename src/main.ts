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
let hasBallot = false;
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
  const anyOpen = s.polls.some(pollOpen);
  const hero = s.bannerImage ? `<div class="screening-banner" style="background-image:url('${esc(s.bannerImage)}')"></div>` : "";
  const buttonLabel = anyOpen ? `${hasBallot ? "Update votes" : "Submit votes"} <span>→</span>` : "Voting is closed";
  app.innerHTML = `${brandHeader(Boolean(s.bannerImage))}${hero}<main><section class="intro"><span class="kicker">Audience voting</span><h1>${esc(s.title)}</h1>${s.venue ? `<p class="venue">${esc(s.venue)}</p>` : ""}<p>Make your picks. Vote code <strong>${esc(activeCode)}</strong>.</p></section><form id="vote-form" autocomplete="off"><div id="polls">${s.polls.map(renderPoll).join("")}</div><button class="button primary" type="submit"${anyOpen ? "" : " disabled"}>${buttonLabel}</button><p class="message" role="status"></p></form></main><p id="selection-toast" class="selection-toast" role="status"></p>`;
  document.querySelector<HTMLFormElement>("#vote-form")!.addEventListener("submit", submitVotes);
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
    const required = open && type === "radio" ? " required" : "";
    const checked = chosen.has(option.id) ? " checked" : "";
    const disabled = open ? "" : " disabled";
    return `<label class="option"><input type="${type}" name="poll-${poll.id}" value="${esc(option.id)}"${required}${checked}${disabled}/><span class="option-image"${image}></span><span class="option-copy"><strong>${esc(option.title)}</strong>${option.description ? `<small>${esc(option.description)}</small>` : ""}</span></label>`;
  }).join("");
  const rule = poll.minSelections === poll.maxSelections ? `Select ${poll.minSelections}` : `Select ${poll.minSelections}–${poll.maxSelections}`;
  const status = statusText(poll);
  const ended = !open && !notStarted(poll);
  return `<fieldset class="poll${open ? "" : " is-closed"}"><legend><span class="poll-title">${esc(poll.title)}</span><span class="rule">${rule}</span></legend><div class="countdown" data-countdown="${esc(poll.id)}" hidden><span class="countdown-prefix"></span><span class="countdown-clock"></span></div>${status ? `<p class="window closed">${esc(status)}</p>` : ""}${poll.instructions ? `<p class="instructions">${esc(poll.instructions)}</p>` : ""}${ended ? `<p class="help">This poll is closed. The picks shown here stay as they are.</p>` : ""}<div class="options">${options}</div></fieldset>`;
}

function bindPoll(poll: Poll) {
  if (!pollOpen(poll)) return;
  const inputs = document.querySelectorAll<HTMLInputElement>(`input[name="poll-${poll.id}"]`);
  inputs.forEach((input) => input.addEventListener("change", () => onPollChange(poll, input)));
}

function onPollChange(poll: Poll, input: HTMLInputElement) {
  const boxes = Array.from(document.querySelectorAll<HTMLInputElement>(`input[name="poll-${poll.id}"]`));
  let checked = boxes.filter((box) => box.checked);
  if (input.checked && checked.length > poll.maxSelections) {
    input.checked = false;
    checked = boxes.filter((box) => box.checked);
    showToast(`You can select ${poll.maxSelections} for ${poll.title}`);
  }
  const remaining = poll.minSelections - checked.length;
  if (remaining > 0) showToast(remaining === 1 ? `Select 1 more for ${poll.title}` : `Select ${remaining} more for ${poll.title}`);
}

function showToast(text: string) {
  const el = document.querySelector<HTMLElement>("#selection-toast");
  if (!el) return;
  el.textContent = text;
  el.classList.add("is-on");
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => el.classList.remove("is-on"), 1400);
}

function chosenSelections(form: HTMLFormElement) {
  const next: Record<string, string[]> = {};
  current.polls.forEach((poll) => {
    next[poll.id] = Array.from(form.querySelectorAll<HTMLInputElement>(`input[name="poll-${poll.id}"]:checked`)).map((input) => input.value);
  });
  return next;
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
    hasBallot = entered.used;
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

async function submitVotes(event: SubmitEvent) {
  event.preventDefault();
  const form = event.currentTarget as HTMLFormElement;
  const button = form.querySelector<HTMLButtonElement>("button")!;
  const msg = form.querySelector<HTMLElement>(".message")!;
  const chosen = chosenSelections(form);
  const short = current.polls.find((poll) => pollOpen(poll) && (chosen[poll.id].length < poll.minSelections || chosen[poll.id].length > poll.maxSelections));
  if (short) {
    const remaining = short.minSelections - chosen[short.id].length;
    showToast(remaining > 0 ? (remaining === 1 ? `Select 1 more for ${short.title}` : `Select ${remaining} more for ${short.title}`) : `Select at most ${short.maxSelections} for ${short.title}`);
    return;
  }
  button.disabled = true;
  msg.className = "message";
  msg.textContent = "Submitting…";
  try {
    const response = await fetch("/api/vote", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ screeningId: current.id, code: activeCode, selections: chosen }) });
    const data = await response.json() as { error?: string };
    if (!response.ok) throw Error(data.error || "Vote could not be submitted");
    for (const poll of current.polls) if (pollOpen(poll)) selections[poll.id] = chosen[poll.id];
    hasBallot = true;
    saveEntry({ code: activeCode, slug, selections });
    msg.className = "message success";
    msg.textContent = "Your votes are recorded. You can change them while a poll is still open.";
    button.textContent = "Update votes →";
    button.disabled = !current.polls.some(pollOpen);
  } catch (err) {
    msg.className = "message error";
    msg.textContent = err instanceof Error ? err.message : "Vote could not be submitted";
    button.disabled = false;
    if (err instanceof Error && err.message === "Voting is not open") void refreshBallot();
  }
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
  app.innerHTML = `${brandHeader()}<main class="home"><section class="intro"><span class="kicker">Audience choice</span><h1>Enter your vote code.</h1><p>The code on your screening ticket opens the ballot for that screening.</p></section><form id="code-gate" class="gate"><div class="callout"><label class="code-label">Vote code<input id="code" required autocomplete="one-time-code" autocapitalize="characters" placeholder="ABC-123" value="${esc(code)}" autofocus /></label><button class="button primary" type="submit">Continue <span>→</span></button></div><p class="message${message ? " error" : ""}" role="status">${esc(message)}</p></form></main>`;
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
  hasBallot = Object.values(selections).some((ids) => ids.length > 0);
  try {
    const [screening, entered] = await Promise.all([loadScreening(slug), enter(entry.code)]);
    if (entered.slug !== slug) { clearEntry(); location.replace("/"); return; }
    selections = entered.selections;
    hasBallot = entered.used;
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
