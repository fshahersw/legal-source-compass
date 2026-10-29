/**
 * The agent's web browser: opens a public page in a remote headless browser, optionally performs a short sequence of
 * actions (click, type, press a key, wait, scroll) and returns the resulting page as text with its links, and a
 * screenshot when asked. Each call is one browser session; the agent chains calls to work through a site. Only public
 * http(s) addresses are opened; scripts cannot be injected. Server-only.
 */
import { publicUrl } from "@/lib/net/publicUrl";

export type BrowseAction =
  | { type: "click"; selector: string }
  | { type: "write"; text: string }
  | { type: "press"; key: string }
  | { type: "wait"; milliseconds?: number; selector?: string }
  | { type: "scroll"; direction: "up" | "down"; selector?: string };

const KEYS =
  /^(Enter|Tab|Escape|ArrowDown|ArrowUp|ArrowLeft|ArrowRight|PageDown|PageUp|Home|End|Space|Backspace)$/;

/** Validate and bound the actions the model asked for; anything unknown is dropped. */
export function cleanActions(raw: unknown): BrowseAction[] {
  if (!Array.isArray(raw)) return [];
  const out: BrowseAction[] = [];
  for (const a of raw.slice(0, 12)) {
    if (!a || typeof a !== "object") continue;
    const r = a as Record<string, unknown>;
    const sel = typeof r["selector"] === "string" ? r["selector"].slice(0, 300) : "";
    if (r["type"] === "click" && sel) out.push({ type: "click", selector: sel });
    else if (r["type"] === "write" && typeof r["text"] === "string")
      out.push({ type: "write", text: r["text"].slice(0, 500) });
    else if (r["type"] === "press" && typeof r["key"] === "string" && KEYS.test(r["key"]))
      out.push({ type: "press", key: r["key"] });
    else if (r["type"] === "wait")
      out.push(
        sel
          ? { type: "wait", selector: sel }
          : {
              type: "wait",
              milliseconds: Math.min(8000, Math.max(250, Number(r["milliseconds"]) || 1500)),
            },
      );
    else if (r["type"] === "scroll")
      out.push({
        type: "scroll",
        direction: r["direction"] === "up" ? "up" : "down",
        ...(sel ? { selector: sel } : {}),
      });
  }
  return out;
}

export type BrowseResult = {
  url: string;
  title: string;
  markdown: string;
  links: string[];
  screenshotUrl: string | null;
};

export function browseConfigured(): boolean {
  return !!process.env["FIRECRAWL_API_KEY"]?.trim();
}

export async function browse(
  rawUrl: string,
  actions: BrowseAction[],
  opts: { screenshot?: boolean; signal?: AbortSignal } = {},
): Promise<BrowseResult> {
  const key = process.env["FIRECRAWL_API_KEY"]?.trim();
  if (!key) throw new Error("The web browser is not configured on this server.");
  const url = publicUrl(rawUrl);
  if (!url) throw new Error("Only public http(s) addresses can be opened.");
  const formats: unknown[] = ["markdown", "links"];
  if (opts.screenshot) formats.push({ type: "screenshot", fullPage: false });
  const res = await fetch("https://api.firecrawl.dev/v2/scrape", {
    method: "POST",
    signal: opts.signal ?? null,
    headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
    body: JSON.stringify({
      url: url.toString(),
      formats,
      onlyMainContent: actions.length === 0,
      ...(actions.length ? { actions } : {}),
      maxAge: 0,
      timeout: 60000,
    }),
  });
  if (!res.ok) {
    let reason = "";
    try {
      const b = (await res.json()) as { error?: string };
      reason = typeof b.error === "string" ? b.error.slice(0, 200) : "";
    } catch {
      // no body
    }
    throw new Error(`The page could not be opened (${res.status})${reason ? `: ${reason}` : ""}.`);
  }
  const body = (await res.json()) as {
    data?: {
      markdown?: string;
      links?: string[];
      screenshot?: string;
      actions?: { screenshots?: string[] };
      metadata?: { title?: string; sourceURL?: string; url?: string };
    };
  };
  const d = body.data ?? {};
  const final = d.metadata?.url || d.metadata?.sourceURL || url.toString();
  const links = (d.links ?? []).filter((l) => typeof l === "string" && publicUrl(l)).slice(0, 80);
  const shot = d.screenshot || d.actions?.screenshots?.[0] || null;
  return {
    url: final,
    title: (d.metadata?.title ?? "").slice(0, 200) || url.hostname,
    markdown: (d.markdown ?? "").slice(0, 400_000),
    links,
    screenshotUrl: shot && publicUrl(shot) ? shot : null,
  };
}

/** Fetch a screenshot the browser produced (an image on the browser service's storage). */
export async function fetchScreenshot(
  shotUrl: string,
  signal?: AbortSignal,
): Promise<Uint8Array | null> {
  const u = publicUrl(shotUrl);
  if (!u) return null;
  try {
    const res = await fetch(u, { signal: signal ?? null });
    if (!res.ok) return null;
    const type = res.headers.get("content-type") ?? "";
    if (!/^image\//.test(type)) return null;
    const buf = new Uint8Array(await res.arrayBuffer());
    return buf.length > 10 * 1024 * 1024 ? null : buf;
  } catch {
    return null;
  }
}
