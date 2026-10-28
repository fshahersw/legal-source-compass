/**
 * What the user sees of the navigator's hands: a pointer that glides to a control before it is pressed, and an
 * outline around whatever the navigator reads or points at. Plain DOM overlays with pointer-events off, removed when
 * the task ends; with reduced motion the pointer jumps instead of gliding.
 */
const POINTER_ID = "navigator-pointer";
const SPOT_ID = "navigator-spotlight";

const reduced = () =>
  typeof window !== "undefined" &&
  !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

function ensure(id: string, style: Partial<CSSStyleDeclaration>, html = ""): HTMLElement {
  let el = document.getElementById(id);
  if (!el) {
    el = document.createElement("div");
    el.id = id;
    el.setAttribute("aria-hidden", "true");
    el.innerHTML = html;
    Object.assign(el.style, style);
    document.body.appendChild(el);
  }
  return el;
}

const POINTER_SVG =
  '<svg width="22" height="22" viewBox="0 0 24 24" fill="none"><path d="M4 2.5 19.5 12 12.2 13.6 8.6 20.5Z" fill="var(--primary, #2a78d6)" stroke="white" stroke-width="1.6" stroke-linejoin="round"/></svg>';

/** Move the pointer to an element's centre (scrolling it into view), pulse, and resolve once it has arrived. */
export async function showPointer(target: Element, signal?: AbortSignal): Promise<void> {
  target.scrollIntoView({
    behavior: reduced() ? "auto" : "smooth",
    block: "center",
    inline: "nearest",
  });
  await new Promise((r) => setTimeout(r, reduced() ? 50 : 350));
  if (signal?.aborted) return;
  const p = ensure(
    POINTER_ID,
    {
      position: "fixed",
      left: "0px",
      top: "0px",
      zIndex: "2147483000",
      pointerEvents: "none",
      transition: reduced() ? "none" : "transform 520ms cubic-bezier(.2,.8,.2,1), opacity 200ms",
      transform: `translate(${window.innerWidth - 80}px, ${window.innerHeight - 120}px)`,
      filter: "drop-shadow(0 2px 4px rgba(0,0,0,.35))",
    },
    POINTER_SVG,
  );
  p.style.opacity = "1";
  const r = target.getBoundingClientRect();
  const x = r.left + Math.min(r.width / 2, 28);
  const y = r.top + r.height / 2;
  // force a frame so the transition runs from the last position
  void p.offsetWidth;
  p.style.transform = `translate(${x}px, ${y}px)`;
  await new Promise((resolve) => setTimeout(resolve, reduced() ? 30 : 560));
  spotlight(target, 900);
  if (!reduced()) {
    p.animate(
      [
        { transform: `translate(${x}px, ${y}px) scale(1)` },
        { transform: `translate(${x}px, ${y}px) scale(.82)` },
        { transform: `translate(${x}px, ${y}px) scale(1)` },
      ],
      { duration: 220 },
    );
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}

let spotTimer: ReturnType<typeof setTimeout> | null = null;
let spotScroll: (() => void) | null = null;

/** Outline an element for a moment (or until the next spotlight). */
export function spotlight(target: Element | null | undefined, ms = 1800): void {
  if (!target) return;
  const s = ensure(SPOT_ID, {
    position: "fixed",
    zIndex: "2147482999",
    pointerEvents: "none",
    borderRadius: "10px",
    boxShadow:
      "0 0 0 2px var(--primary, #2a78d6), 0 0 0 6px color-mix(in srgb, var(--primary, #2a78d6) 22%, transparent)",
    transition: reduced() ? "none" : "all 280ms ease",
    opacity: "0",
  });
  const place = () => {
    const r = target.getBoundingClientRect();
    Object.assign(s.style, {
      left: `${r.left - 4}px`,
      top: `${r.top - 4}px`,
      width: `${r.width + 8}px`,
      height: `${Math.min(r.height + 8, window.innerHeight)}px`,
      opacity: "1",
    });
  };
  place();
  if (spotScroll) window.removeEventListener("scroll", spotScroll, true);
  spotScroll = place;
  window.addEventListener("scroll", place, { passive: true, capture: true });
  if (spotTimer) clearTimeout(spotTimer);
  spotTimer = setTimeout(() => {
    s.style.opacity = "0";
    if (spotScroll) window.removeEventListener("scroll", spotScroll, true);
    spotScroll = null;
  }, ms);
}

/** Remove the overlays (task finished or stopped). */
export function clearOverlays(): void {
  if (spotScroll) window.removeEventListener("scroll", spotScroll, true);
  spotScroll = null;
  document.getElementById(POINTER_ID)?.remove();
  document.getElementById(SPOT_ID)?.remove();
}
