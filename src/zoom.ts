const minScale = 1;
const maxScale = 4;

export function stepIndex(index: number, delta: number, count: number) {
  if (count <= 0) return 0;
  return (index + delta + count) % count;
}

export function nextZoomScale(scale: number, factor: number) {
  if (!Number.isFinite(scale) || !Number.isFinite(factor) || factor <= 0) return minScale;
  return Math.min(maxScale, Math.max(minScale, scale * factor));
}

const magnifier = `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="10" cy="10" r="6.25" fill="none" stroke="currentColor" stroke-width="2.5"/><path d="M14.8 14.8 20.5 20.5" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/></svg>`;

export function posterZoomButton(title: string) {
  return `<button type="button" class="zoom" data-zoom-title="${title}" aria-label="Look closer at ${title}">${magnifier}</button>`;
}

export function bindPosterZoom(root: HTMLElement) {
  root.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const button = target.closest<HTMLButtonElement>(".zoom");
    if (!button || !root.contains(button)) return;
    event.preventDefault();
    event.stopPropagation();
    const option = button.closest(".option");
    const frame = option?.querySelector<HTMLElement>(".option-image");
    if (!frame) return;
    let images: string[] = [];
    try {
      const parsed = JSON.parse(frame.dataset.cycle || "[]") as unknown;
      images = Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string" && item.length > 0) : [];
    } catch {
      images = [];
    }
    if (!images.length) return;
    const shown = Array.from(frame.querySelectorAll(".still")).findIndex((layer) => layer.classList.contains("is-shown"));
    openZoom(images, shown < 0 ? 0 : shown, button.dataset.zoomTitle || "Image", button);
  });
}

let zoomReturn: HTMLElement | null = null;
let onKey: ((event: KeyboardEvent) => void) | null = null;

function openZoom(images: string[], index: number, title: string, returnTo: HTMLElement) {
  closeZoom();
  zoomReturn = returnTo;
  let cursor = stepIndex(index, 0, images.length);
  let scale = 1;
  let panX = 0;
  let panY = 0;
  let gestureScale = 1;
  let gesturePanX = 0;
  let gesturePanY = 0;
  let gestureDistance = 0;
  let gestureMid = { x: 0, y: 0 };
  let dragStart = { x: 0, y: 0 };
  const pointers = new Map<number, { x: number; y: number }>();

  const view = document.createElement("div");
  view.className = "zoom-view";
  view.setAttribute("role", "dialog");
  view.setAttribute("aria-modal", "true");
  view.setAttribute("aria-label", title);

  const heading = document.createElement("p");
  heading.className = "zoom-title";
  heading.id = "zoom-title";
  heading.textContent = title;
  view.setAttribute("aria-labelledby", "zoom-title");

  const stage = document.createElement("div");
  stage.className = "zoom-stage";
  const img = document.createElement("img");
  img.alt = title;
  img.draggable = false;
  stage.appendChild(img);

  const nav = document.createElement("div");
  nav.className = "zoom-nav";
  const previous = document.createElement("button");
  previous.type = "button";
  previous.className = "button secondary zoom-step";
  previous.textContent = "Previous";
  const count = document.createElement("span");
  count.className = "zoom-count";
  const next = document.createElement("button");
  next.type = "button";
  next.className = "button secondary zoom-step";
  next.textContent = "Next";
  nav.appendChild(previous);
  nav.appendChild(count);
  nav.appendChild(next);
  nav.hidden = images.length < 2;

  const back = document.createElement("button");
  back.type = "button";
  back.className = "button primary zoom-back";
  back.textContent = "Back";

  view.appendChild(heading);
  view.appendChild(stage);
  view.appendChild(nav);
  view.appendChild(back);
  document.body.appendChild(view);
  document.body.classList.add("is-zoomed");

  const paint = () => {
    img.style.transform = scale === 1 ? "" : `translate(${panX}px, ${panY}px) scale(${scale})`;
  };
  const show = () => {
    cursor = stepIndex(cursor, 0, images.length);
    img.src = images[cursor] || "";
    count.textContent = `${cursor + 1} of ${images.length}`;
    scale = 1;
    panX = 0;
    panY = 0;
    paint();
  };
  const rememberGesture = () => {
    gestureScale = scale;
    gesturePanX = panX;
    gesturePanY = panY;
    const points = [...pointers.values()];
    if (points.length >= 2) {
      gestureDistance = Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y) || 1;
      gestureMid = { x: (points[0].x + points[1].x) / 2, y: (points[0].y + points[1].y) / 2 };
    } else if (points.length === 1) {
      dragStart = { x: points[0].x, y: points[0].y };
    }
  };

  previous.addEventListener("click", () => { cursor = stepIndex(cursor, -1, images.length); show(); });
  next.addEventListener("click", () => { cursor = stepIndex(cursor, 1, images.length); show(); });
  back.addEventListener("click", () => closeZoom());

  stage.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    stage.setPointerCapture(event.pointerId);
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    rememberGesture();
  });
  stage.addEventListener("pointermove", (event) => {
    if (!pointers.has(event.pointerId)) return;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const points = [...pointers.values()];
    if (points.length >= 2) {
      const distance = Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y) || 1;
      const mid = { x: (points[0].x + points[1].x) / 2, y: (points[0].y + points[1].y) / 2 };
      scale = nextZoomScale(gestureScale, distance / gestureDistance);
      panX = gesturePanX + (mid.x - gestureMid.x);
      panY = gesturePanY + (mid.y - gestureMid.y);
      if (scale === 1) { panX = 0; panY = 0; }
      paint();
      event.preventDefault();
    } else if (points.length === 1 && scale > 1) {
      panX = gesturePanX + (points[0].x - dragStart.x);
      panY = gesturePanY + (points[0].y - dragStart.y);
      paint();
      event.preventDefault();
    }
  });
  const release = (event: PointerEvent) => {
    pointers.delete(event.pointerId);
    rememberGesture();
  };
  stage.addEventListener("pointerup", release);
  stage.addEventListener("pointercancel", release);
  stage.addEventListener("wheel", (event) => {
    event.preventDefault();
    scale = nextZoomScale(scale, event.deltaY < 0 ? 1.12 : 1 / 1.12);
    if (scale === 1) { panX = 0; panY = 0; }
    paint();
  }, { passive: false });
  stage.addEventListener("dblclick", () => {
    scale = scale > 1 ? 1 : 2;
    panX = 0;
    panY = 0;
    paint();
  });

  onKey = (event) => {
    if (event.key === "Escape") { event.preventDefault(); closeZoom(); }
    else if (event.key === "ArrowLeft" && images.length > 1) { cursor = stepIndex(cursor, -1, images.length); show(); }
    else if (event.key === "ArrowRight" && images.length > 1) { cursor = stepIndex(cursor, 1, images.length); show(); }
  };
  document.addEventListener("keydown", onKey);
  show();
  back.focus();
}

export function closeZoom() {
  document.querySelector(".zoom-view")?.remove();
  document.body.classList.remove("is-zoomed");
  if (onKey) document.removeEventListener("keydown", onKey);
  onKey = null;
  const backTo = zoomReturn;
  zoomReturn = null;
  if (backTo?.isConnected) backTo.focus();
}
