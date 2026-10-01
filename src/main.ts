import "./style.css";
import { startAdmin } from "./admin";

type Poll = { id: string; title: string; instructions: string; minSelections: number; maxSelections: number; imageConfig?: { aspectRatio?: string }; options: { id: string; title: string; description?: string; images: string[] }[] };
type Screening = { id: string; slug: string; title: string; venue?: string; bannerImage?: string; startAt: string; stopAt: string; polls: Poll[] };
const app = document.querySelector<HTMLDivElement>("#app")!;
const slug = location.pathname.match(/\/s\/([^/]+)/)?.[1] || "";
const entryKey = "sd48-vote-entry";
type Entry = { code: string; slug: string };
function loadEntry(): Entry | null { try { const parsed = JSON.parse(sessionStorage.getItem(entryKey) || "") as Entry; return parsed.code && parsed.slug ? parsed : null; } catch { return null; } }
function saveEntry(entry: Entry) { sessionStorage.setItem(entryKey, JSON.stringify(entry)); }
function clearEntry() { sessionStorage.removeItem(entryKey); }
function brandHeader(hasHero = false) { return `<header class="masthead${hasHero ? " has-hero" : ""}"><a class="logo-link" href="/"><img class="logo" src="/logo-horiz-trans.png" alt="San Diego 48 Hour Film Project" width="2046" height="560"></a></header>`; }
function unavailable(message: string) { app.innerHTML = `${brandHeader()}<main class="home"><section class="intro"><h1>${esc(message)}</h1><p>Check the code on your screening ticket, then start again from the home page.</p><p><a class="change-code" href="/">Enter a vote code</a></p></section></main>`; }
let current: Screening;
let activeCode = "";
const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[c] || c));
const isOpen = (s: Screening) => { const n = Date.now(); return n >= Date.parse(s.startAt) && n <= Date.parse(s.stopAt); };
function frameRatio(value?: string) { const match = /^(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)$/.exec(value || ""); return match ? `${match[1]} / ${match[2]}` : "16 / 9"; }
function windowText(s: Screening) { const start = new Date(s.startAt), stop = new Date(s.stopAt); const full: Intl.DateTimeFormatOptions = { dateStyle: "medium", timeStyle: "short" }; const startText = start.toLocaleString([], full); const stopText = start.toDateString() === stop.toDateString() ? stop.toLocaleTimeString([], { timeStyle: "short" }) : stop.toLocaleString([], full); return `${startText}–${stopText}`; }
function render(s: Screening) {
  current = s;
  const hero = s.bannerImage ? `<div class="screening-banner" style="background-image:url('${esc(s.bannerImage)}')"></div>` : "";
  app.innerHTML = `${brandHeader(Boolean(s.bannerImage))}${hero}<main><section class="intro"><span class="kicker">Audience voting</span><h1>${esc(s.title)}</h1>${s.venue ? `<p class="venue">${esc(s.venue)}</p>` : ""}<p>Make your picks. Vote code <strong>${esc(activeCode)}</strong>. One code covers every poll in this screening. <a class="change-code" id="change-code" href="/">Use a different code</a></p><p class="window ${isOpen(s) ? "open" : "closed"}">${isOpen(s) ? "Voting is open" : "Voting is closed"} · ${windowText(s)}</p></section><form id="vote-form"><div id="polls">${s.polls.map(renderPoll).join("")}</div><button class="button primary" type="submit">Submit votes <span>→</span></button><p class="message" role="status"></p></form></main>`;
  document.querySelector<HTMLAnchorElement>("#change-code")!.addEventListener("click", () => clearEntry());
  document.querySelector<HTMLFormElement>("#vote-form")!.addEventListener("submit", submitVotes);
  document.querySelectorAll<HTMLElement>("[data-cycle]").forEach(startCycle);
}
function renderPoll(p: Poll) {
  const ratio = frameRatio(p.imageConfig?.aspectRatio);
  const options = p.options.map(o => { const type = p.maxSelections === 1 ? "radio" : "checkbox"; const image = o.images.length ? ` data-cycle='${esc(JSON.stringify(o.images))}' style="aspect-ratio:${ratio};background-image:url('${esc(o.images[0])}')"` : ` style="aspect-ratio:${ratio}"`; return `<label class="option"><input type="${type}" name="poll-${p.id}" value="${esc(o.id)}" ${type === "radio" ? "required" : ""}/><span class="option-image"${image}></span><span class="option-copy"><strong>${esc(o.title)}</strong>${o.description ? `<small>${esc(o.description)}</small>` : ""}</span></label>`; }).join("");
  return `<fieldset class="poll"><legend><span>${esc(p.title)}</span><span class="rule">${p.minSelections === p.maxSelections ? `Select ${p.minSelections}` : `Select ${p.minSelections}–${p.maxSelections}`}</span></legend>${p.instructions ? `<p class="instructions">${esc(p.instructions)}</p>` : ""}<div class="options">${options}</div></fieldset>`;
}
function startCycle(el: HTMLElement) { const imgs = JSON.parse(el.dataset.cycle || "[]") as string[]; let i = 0; if (imgs.length > 1) setInterval(() => { i = (i + 1) % imgs.length; el.style.backgroundImage = `url('${imgs[i]}')`; }, 4000); }
async function submitVotes(e: SubmitEvent) {
  e.preventDefault(); const form = e.currentTarget as HTMLFormElement; const button = form.querySelector<HTMLButtonElement>("button")!; const msg = form.querySelector<HTMLElement>(".message")!;
  const selections: Record<string, string[]> = {};
  current.polls.forEach(p => { selections[p.id] = Array.from(form.querySelectorAll<HTMLInputElement>(`input[name="poll-${p.id}"]:checked`)).map(x => x.value); });
  button.disabled = true; msg.textContent = "Submitting…";
  try { const r = await fetch("/api/vote", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ screeningId: current.id, code: activeCode, selections }) }); const data = await r.json() as { error?: string }; if (!r.ok) throw Error(data.error || "Vote could not be submitted"); clearEntry(); msg.className = "message success"; msg.textContent = "Your votes are recorded. Thank you!"; form.reset(); form.querySelectorAll<HTMLInputElement | HTMLButtonElement>("input, button").forEach((el) => { el.disabled = true; }); } catch (err) { msg.className = "message error"; msg.textContent = err instanceof Error ? err.message : "Vote could not be submitted"; button.disabled = false; }
}
function renderGate(message = "") {
  app.innerHTML = `${brandHeader()}<main class="home"><section class="intro"><span class="kicker">Audience choice</span><h1>Enter your vote code.</h1><p>The code on your screening ticket opens the ballot for that screening.</p></section><form id="code-gate" class="gate"><div class="callout"><label class="code-label">Vote code<input id="code" required autocomplete="one-time-code" autocapitalize="characters" placeholder="ABC-123" autofocus /></label><button class="button primary" type="submit">Continue <span>→</span></button></div><p class="message${message ? " error" : ""}" role="status">${esc(message)}</p></form></main>`;
  const form = document.querySelector<HTMLFormElement>("#code-gate")!;
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const button = form.querySelector<HTMLButtonElement>("button")!;
    const msg = form.querySelector<HTMLElement>(".message")!;
    const code = form.querySelector<HTMLInputElement>("#code")!.value.trim();
    button.disabled = true; msg.className = "message"; msg.textContent = "Checking your code…";
    try {
      const r = await fetch("/api/enter", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code }) });
      const data = await r.json() as { error?: string; slug?: string };
      if (!r.ok || !data.slug) throw Error(data.error || "That vote code could not be checked.");
      saveEntry({ code: code.toUpperCase(), slug: data.slug });
      location.assign("/s/" + encodeURIComponent(data.slug));
    } catch (err) {
      msg.className = "message error";
      msg.textContent = err instanceof Error ? err.message : "That vote code could not be checked.";
      button.disabled = false;
    }
  });
}
function openScreening() {
  const entry = loadEntry();
  if (!entry || entry.slug !== slug) { clearEntry(); location.replace("/"); return; }
  activeCode = entry.code;
  fetch("/api/screenings/" + encodeURIComponent(slug)).then(r => r.ok ? r.json() as Promise<Screening> : Promise.reject()).then(render).catch(() => unavailable("Screening not found"));
}
if (location.pathname === "/admin" || location.pathname.startsWith("/admin/")) startAdmin(); else if (slug) openScreening(); else renderGate();
