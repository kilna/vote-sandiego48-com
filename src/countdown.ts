export function formatClock(minutes: number, seconds: number) {
  const text = [minutes, seconds].map((part) => String(part).padStart(2, "0")).join(":");
  return `<span class="clock"><span class="off">88:88</span><span class="on">${text}</span></span>`;
}

export function clockParts(target: number, now = Date.now()) {
  const elapsed = Math.max(0, target - now);
  const minutes = Math.floor(elapsed / 60_000);
  const seconds = Math.floor((elapsed % 60_000) / 1000);
  return { minutes, seconds, elapsed };
}

export function startClock(element: HTMLElement, target: number) {
  const handle = { id: 0 };
  const stop = () => window.clearInterval(handle.id);
  const paint = (minutes: number, seconds: number) => {
    element.innerHTML = formatClock(minutes, seconds);
  };
  const paintRemaining = () => {
    const parts = clockParts(target);
    paint(parts.minutes, parts.seconds);
  };
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    paintRemaining();
    handle.id = window.setInterval(paintRemaining, 1000);
    return stop;
  }
  const animationStart = Date.now();
  handle.id = window.setInterval(() => {
    if (Date.now() - animationStart > 500) {
      stop();
      paintRemaining();
      handle.id = window.setInterval(paintRemaining, 1000);
      return;
    }
    paint(Math.floor(Math.random() * 60), Math.floor(Math.random() * 60));
  }, 10);
  return stop;
}
