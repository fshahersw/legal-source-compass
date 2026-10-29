/**
 * The navigator's hands: the browser tools it calls on the page the user is looking at. Each returns plain text for
 * the model (bounded) plus the path it ended on. Navigation stays on this site; downloads, sign-in, deleting and
 * external links are refused; the user sees a pointer move to every control before it is pressed, and every section
 * the navigator points at is outlined.
 */
import type { QueryClient } from "@tanstack/react-query";
import type { AnyRouter } from "@tanstack/react-router";
import { chartsOnPage } from "@/lib/navigator/chartRegistry";
import { guideFor, renderGuide } from "@/lib/navigator/pageGuides";
import {
  FORBIDDEN_LABEL,
  NAV_MAX_RESULT_CHARS,
  safeSitePath,
  type ClientCall,
} from "@/lib/navigator/protocol";
import { showPointer, spotlight } from "./pointer";
import { runPython, type PyChart } from "./python";
import { agentHeaders } from "./agentOwner";
import type { NavigatorFile } from "@/lib/navigator/protocol";

export type ExecContext = {
  router: AnyRouter;
  queryClient: QueryClient;
  /** The navigator panel's root: never read, clicked or typed into. */
  panel: HTMLElement | null;
  signal: AbortSignal;
};

export type ExecResult = {
  content: string;
  isError: boolean;
  path: string;
  label: string;
  detail: string;
  /** Files the call saved to the agent folder (figures from Python). */
  files?: NavigatorFile[];
};

/** Save one figure to the agent folder; null when the folder is unavailable. */
async function saveFigure(
  title: string,
  png: string,
  signal: AbortSignal,
): Promise<NavigatorFile | null> {
  try {
    const res = await fetch("/api/agent/files", {
      method: "POST",
      signal,
      headers: { "content-type": "application/json", ...agentHeaders() },
      body: JSON.stringify({
        kind: "figure",
        title,
        mime: "image/png",
        base64: png,
        source: "python",
      }),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { file?: NavigatorFile };
    return body.file ?? null;
  } catch {
    return null;
  }
}

const clip = (s: string, n = NAV_MAX_RESULT_CHARS) =>
  s.length > n ? `${s.slice(0, n)}\n…[truncated]` : s;
const squash = (s: string) =>
  s
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
const here = () => `${location.pathname}${location.search}`;
const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(t);
      resolve();
    });
  });

/** Wait for the route to finish loading, queries to settle and the page to stop changing (at most `max` ms). */
export async function settle(ctx: ExecContext, max = 14000): Promise<void> {
  const start = performance.now();
  let lastChange = performance.now();
  const main = document.querySelector("main") ?? document.body;
  const mo = new MutationObserver(() => {
    lastChange = performance.now();
  });
  mo.observe(main, { childList: true, subtree: true, characterData: true });
  try {
    await sleep(120, ctx.signal);
    while (performance.now() - start < max && !ctx.signal.aborted) {
      const routing = ctx.router.state.status !== "idle" || ctx.router.state.isLoading;
      const fetching = ctx.queryClient.isFetching() > 0;
      const quiet = performance.now() - lastChange > 450;
      if (!routing && !fetching && quiet) return;
      await sleep(120, ctx.signal);
    }
  } finally {
    mo.disconnect();
  }
}

const mainEl = () => (document.querySelector("main") as HTMLElement | null) ?? document.body;

function scopeFor(section: unknown): HTMLElement {
  if (typeof section === "string" && section) {
    const el = document.getElementById(section);
    if (el) return el;
  }
  return mainEl();
}

function isVisible(el: Element): boolean {
  const h = el as HTMLElement;
  if (h.closest("[hidden], [aria-hidden='true']") && !h.matches("[data-chart-anchor]"))
    return false;
  const r = h.getBoundingClientRect();
  return r.width > 0 || r.height > 0 || h.offsetParent !== null;
}

function sectionsOf(root: HTMLElement) {
  return [...root.querySelectorAll("section[id], div[id^='story-'], div[id^='watch-']")]
    .filter((el, i, all) => all.indexOf(el) === i && !el.closest("[data-navigator-panel]"))
    .filter((el) => !/-title$/.test(el.id))
    .map((el) => {
      const h = el.querySelector("h2, h3");
      return { id: el.id, title: squash((h as HTMLElement | null)?.innerText ?? "") };
    })
    .filter((s) => s.id)
    .slice(0, 40);
}

function chartLines(root: HTMLElement, rowsEach: number): string[] {
  const lines: string[] = [];
  chartsOnPage(root).forEach((c, i) => {
    if (!isVisible(c.el.parentElement ?? c.el)) return;
    const s = c.read();
    const section = c.el.closest("section[id]")?.id;
    lines.push(`Chart ${i}${section ? ` [section ${section}]` : ""}: ${s.title || "(untitled)"}`);
    if (s.subtitle) lines.push(`  Subtitle: ${s.subtitle}`);
    if (s.sources.length)
      lines.push(`  Sources: ${s.sources.join("; ")}${s.period ? ` · ${s.period}` : ""}`);
    if (s.columns.length) {
      lines.push(`  Table: ${s.caption} (${s.rows.length} rows)`);
      lines.push(`  ${s.columns.join("\t")}`);
      for (const r of s.rows.slice(0, rowsEach)) lines.push(`  ${r.join("\t")}`);
      if (s.rows.length > rowsEach)
        lines.push(`  … ${s.rows.length - rowsEach} more rows (read_chart ${i})`);
    }
  });
  return lines;
}

/** The page as the model reads it: path, title, guide, sections, charts with their first rows, visible text. */
export function describePage(
  opts: { section?: unknown; rowsEach?: number; textChars?: number } = {},
): string {
  const root = scopeFor(opts.section);
  const guide = guideFor(location.pathname);
  const headings = [...root.querySelectorAll("h1, h2, h3")]
    .filter((h) => !h.closest("[data-navigator-panel]"))
    .map((h) => squash((h as HTMLElement).innerText))
    .filter(Boolean)
    .slice(0, 30);
  const sections = sectionsOf(mainEl());
  const charts = chartLines(root, opts.rowsEach ?? 12);
  const text = squash(root.innerText ?? "").slice(0, opts.textChars ?? 4000);
  return clip(
    [
      `Path: ${here()}`,
      `Title: ${document.title}`,
      guide ? `Guide: ${renderGuide(guide)}` : "",
      headings.length ? `Headings: ${headings.join(" | ")}` : "",
      sections.length
        ? `Sections: ${sections.map((s) => `${s.id}${s.title ? ` (${s.title})` : ""}`).join(", ")}`
        : "",
      charts.length ? ["Charts:", ...charts].join("\n") : "Charts: none registered on this view",
      "Visible text (truncated):",
      text,
    ]
      .filter(Boolean)
      .join("\n"),
  );
}

function accessibleName(el: HTMLElement): string {
  const aria = el.getAttribute("aria-label");
  if (aria) return squash(aria);
  if (el instanceof HTMLInputElement && (el.type === "checkbox" || el.type === "radio")) {
    const lab =
      el.closest("label") ?? (el.id ? document.querySelector(`label[for="${el.id}"]`) : null);
    if (lab) return squash((lab as HTMLElement).innerText);
  }
  return squash(el.innerText || el.getAttribute("title") || "");
}

function clickable(root: HTMLElement): HTMLElement[] {
  const header = document.querySelector("header");
  const pool = [root, ...(header && root === mainEl() ? [header as HTMLElement] : [])];
  const out: HTMLElement[] = [];
  for (const r of pool)
    for (const el of r.querySelectorAll<HTMLElement>(
      "button, a[href], [role='tab'], [role='button'], [role='menuitem'], [role='option'], summary, input[type='checkbox'], input[type='radio']",
    ))
      if (
        !el.closest("[data-navigator-panel]") &&
        isVisible(el) &&
        !(el as HTMLButtonElement).disabled
      )
        out.push(el);
  return out;
}

function pick<T extends HTMLElement>(els: T[], label: string, name: (el: T) => string): T | null {
  const want = squash(label).toLowerCase();
  if (!want) return null;
  const named = els.map((el) => ({ el, n: name(el).toLowerCase() })).filter((x) => x.n);
  return (
    named.find((x) => x.n === want)?.el ??
    named.find((x) => x.n.startsWith(want))?.el ??
    named.find((x) => x.n.includes(want))?.el ??
    null
  );
}

function refusal(el: HTMLElement, name: string): string | null {
  if (FORBIDDEN_LABEL.test(name))
    return `Refused: "${name}" is a control the navigator does not press.`;
  if (el instanceof HTMLAnchorElement) {
    if (el.hasAttribute("download")) return "Refused: that link downloads a file.";
    const href = el.getAttribute("href") ?? "";
    if (/^(https?:)?\/\//i.test(href) && new URL(href, location.href).origin !== location.origin)
      return "Refused: that link leaves this site.";
    if (/^(mailto|tel|javascript):/i.test(href))
      return "Refused: that link is not a page of this site.";
    if (href.startsWith("/") && !safeSitePath(href))
      return "Refused: that page is not open to the navigator.";
  }
  if (
    el.closest("form") &&
    el instanceof HTMLButtonElement &&
    el.type === "submit" &&
    !el.closest("[role='search']")
  )
    return "Refused: that button submits a form.";
  return null;
}

async function summaryAfter(ctx: ExecContext, before: string): Promise<string> {
  await settle(ctx);
  const after = here();
  return [
    after !== before ? `Now on ${after} (was ${before}).` : `Still on ${after}.`,
    describePage({ rowsEach: 8, textChars: 2500 }),
  ].join("\n");
}

export async function execute(call: ClientCall, ctx: ExecContext): Promise<ExecResult> {
  const input = call.input;
  const done = (content: string, label: string, detail = ""): ExecResult => ({
    content: clip(content),
    isError: false,
    path: here(),
    label,
    detail,
  });
  const fail = (content: string, label: string): ExecResult => ({
    content,
    isError: true,
    path: here(),
    label,
    detail: content.slice(0, 120),
  });
  try {
    switch (call.name) {
      case "go_to": {
        const path = safeSitePath(input["path"]);
        if (!path)
          return fail("Refused: give a path of this site that starts with /.", "Opening a page");
        if (path !== here()) {
          ctx.router.history.push(path);
          window.scrollTo({ top: 0 });
        }
        await settle(ctx);
        return done(describePage(), "Opened", here());
      }
      case "read_page": {
        await settle(ctx, 6000);
        const section = typeof input["section"] === "string" ? input["section"] : undefined;
        if (section) spotlight(document.getElementById(section));
        return done(
          describePage({ section, rowsEach: 15 }),
          "Read the page",
          section ? `section ${section}` : here(),
        );
      }
      case "read_chart": {
        const i = Number(input["chart"]);
        const charts = chartsOnPage(mainEl());
        const c = Number.isInteger(i) ? charts[i] : undefined;
        if (!c)
          return fail(
            `No chart ${String(input["chart"])} on this page (there are ${charts.length}).`,
            "Reading a chart",
          );
        const s = c.read();
        const offset = Math.max(0, Number(input["offset"]) || 0);
        const limit = Math.min(200, Math.max(1, Number(input["limit"]) || 60));
        spotlight(c.el.closest("section") ?? c.el.parentElement);
        return done(
          [
            `Chart ${i}: ${s.title}`,
            s.subtitle ? `Subtitle: ${s.subtitle}` : "",
            `Table: ${s.caption} (${s.rows.length} rows; showing ${offset + 1}-${Math.min(s.rows.length, offset + limit)})`,
            s.columns.join("\t"),
            ...s.rows.slice(offset, offset + limit).map((r) => r.join("\t")),
            s.sources.length ? `Sources: ${s.sources.join("; ")}` : "",
          ]
            .filter(Boolean)
            .join("\n"),
          "Read a chart's data",
          s.title.slice(0, 80),
        );
      }
      case "find_links": {
        const root = scopeFor(input["section"]);
        const want =
          typeof input["contains"] === "string" ? input["contains"].toLowerCase().trim() : "";
        const seen = new Set<string>();
        const links: string[] = [];
        for (const a of root.querySelectorAll<HTMLAnchorElement>("a[href^='/']")) {
          if (a.closest("[data-navigator-panel]")) continue;
          const href = a.getAttribute("href") ?? "";
          if (!safeSitePath(href) || seen.has(href)) continue;
          const text = squash(a.innerText || a.getAttribute("aria-label") || "");
          if (want && !`${text} ${href}`.toLowerCase().includes(want)) continue;
          seen.add(href);
          links.push(`- ${text || "(no text)"} → ${href}`);
          if (links.length >= 80) break;
        }
        return done(
          links.length ? links.join("\n") : "No matching links on this page.",
          "Looked for links",
          want,
        );
      }
      case "click": {
        const label = String(input["label"] ?? "").slice(0, 120);
        const el = pick(clickable(scopeFor(input["section"])), label, accessibleName);
        if (!el)
          return fail(
            `No button, tab or link labelled "${label}" is visible on this page.`,
            `Clicking “${label}”`,
          );
        const name = accessibleName(el);
        const refused = refusal(el, name);
        if (refused) return fail(refused, `Clicking “${name}”`);
        const before = here();
        await showPointer(el, ctx.signal);
        if (el instanceof HTMLAnchorElement && el.getAttribute("href")?.startsWith("/")) {
          ctx.router.history.push(el.getAttribute("href")!);
        } else el.click();
        return done(await summaryAfter(ctx, before), `Clicked “${name.slice(0, 60)}”`, "");
      }
      case "type_into": {
        const label = String(input["label"] ?? "").slice(0, 120);
        const text = String(input["text"] ?? "").slice(0, 200);
        const fields = [
          ...mainEl().querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("input, textarea"),
        ].filter(
          (f) =>
            !f.closest("[data-navigator-panel]") &&
            isVisible(f) &&
            !["password", "file", "hidden", "checkbox", "radio", "submit", "email", "tel"].includes(
              (f as HTMLInputElement).type,
            ),
        );
        const field = pick(fields, label, (f) =>
          squash(
            f.getAttribute("aria-label") ||
              f.getAttribute("placeholder") ||
              (f.id
                ? ((document.querySelector(`label[for="${f.id}"]`) as HTMLElement | null)
                    ?.innerText ?? "")
                : ""),
          ),
        );
        if (!field)
          return fail(
            `No search or filter box labelled "${label}" on this page.`,
            `Typing into “${label}”`,
          );
        const before = here();
        await showPointer(field, ctx.signal);
        field.focus();
        const proto =
          field instanceof HTMLTextAreaElement
            ? HTMLTextAreaElement.prototype
            : HTMLInputElement.prototype;
        const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
        setter?.call(field, text);
        field.dispatchEvent(new Event("input", { bubbles: true }));
        field.dispatchEvent(new Event("change", { bubbles: true }));
        return done(await summaryAfter(ctx, before), `Typed “${text.slice(0, 40)}”`, label);
      }
      case "scroll_to": {
        let target: Element | null = null;
        if (typeof input["section"] === "string")
          target = document.getElementById(input["section"]);
        if (!target && typeof input["text"] === "string" && input["text"].trim()) {
          const want = input["text"].trim().toLowerCase();
          const walker = document.createTreeWalker(mainEl(), NodeFilter.SHOW_TEXT);
          for (let n = walker.nextNode(); n; n = walker.nextNode())
            if (
              (n.textContent ?? "").toLowerCase().includes(want) &&
              !n.parentElement?.closest("[data-navigator-panel]")
            ) {
              target = n.parentElement;
              break;
            }
        }
        if (!target)
          return fail("Nothing on this page matches that section or text.", "Pointing at the page");
        target.scrollIntoView({ behavior: "smooth", block: "start" });
        await sleep(450, ctx.signal);
        spotlight(target);
        return done(
          `Scrolled to and highlighted ${target.id ? `section ${target.id}` : "the matching text"}.`,
          "Pointed you to",
          target.id || "",
        );
      }
      case "run_python": {
        const code = typeof input["code"] === "string" ? input["code"].slice(0, 20000) : "";
        if (!code.trim()) return fail("No code was given.", "Running Python");
        const data =
          typeof input["data"] === "string" ? input["data"].slice(0, 400_000) : undefined;
        const charts: PyChart[] = chartsOnPage(document)
          .slice(0, 30)
          .map((c) => {
            const s = c.read();
            return {
              title: s.title,
              subtitle: s.subtitle,
              columns: s.columns,
              rows: s.rows.slice(0, 5000),
              sources: s.sources,
              period: s.period,
            };
          });
        const out = await runPython(code, charts, data, ctx.signal);
        const base =
          typeof input["figure_title"] === "string"
            ? input["figure_title"].slice(0, 200).trim()
            : "";
        const files: NavigatorFile[] = [];
        for (const [k, fig] of out.figures.entries()) {
          const title =
            (base
              ? out.figures.length > 1
                ? `${base} (${k + 1})`
                : base
              : fig.title || `Figure ${k + 1}`) || "Figure";
          const f = await saveFigure(title, fig.png, ctx.signal);
          if (f) files.push(f);
        }
        const unsaved = out.figures.length - files.length;
        const body = JSON.stringify({
          stdout: out.stdout,
          result: out.result,
          error: out.error,
          figures: files.map((f) => ({ id: f.id, title: f.title, folder_link: f.href })),
          ...(unsaved > 0 ? { figures_not_saved: unsaved } : {}),
          charts_loaded: charts.map((c, i) => `${i}: ${c.title} (${c.rows.length} rows)`),
        });
        const res: ExecResult = {
          content: clip(body),
          isError: !!out.error,
          path: here(),
          label: out.error ? "Python raised an error" : "Ran Python",
          detail: files.length ? `${files.length} figure${files.length > 1 ? "s" : ""} saved` : "",
          ...(files.length ? { files } : {}),
        };
        return res;
      }
    }
  } catch (error) {
    return fail(
      `The page action failed: ${error instanceof Error ? error.message : "unknown error"}`,
      "Working",
    );
  }
  return fail("Unknown browser tool.", "Working");
}

/** The label shown while a browser call runs. */
export function runningLabel(call: ClientCall): string {
  const i = call.input;
  switch (call.name) {
    case "go_to":
      return `Opening ${String(i["path"] ?? "")}`;
    case "read_page":
      return "Reading the page";
    case "read_chart":
      return "Reading a chart's data";
    case "find_links":
      return "Looking for links";
    case "click":
      return `Clicking “${String(i["label"] ?? "")}”`;
    case "type_into":
      return `Typing “${String(i["text"] ?? "")}”`;
    case "scroll_to":
      return "Pointing at the page";
    case "run_python":
      return "Running Python";
  }
}
