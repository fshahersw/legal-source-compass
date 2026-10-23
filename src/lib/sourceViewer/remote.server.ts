/**
 * Server side of the in-page source viewer: an embeddability check, a guarded file relay and hosted interactive browser sessions.
 * Every outbound request goes only to a public http(s) address, re-checked at each redirect. The hosted browser's control endpoint
 * stays on the server; the panel only receives the session's live view address.
 *
 * Speed: checks and page texts are remembered briefly (public pages only, shared by everyone, concurrent asks share one request)
 * and every outbound request has a time budget that covers its redirects. None of this widens what is fetched.
 */
import { publicUrl } from "@/lib/net/publicUrl";
import { TtlCache } from "./ttlCache";

export type SourceCheck = {
  url: string;
  finalUrl: string;
  embeddable: boolean;
  reason: string | null;
  contentType: string | null;
  kind: "page" | "pdf" | "image" | "text" | "file";
  fileName: string | null;
  size: number | null;
  status: number;
};

const MAX_REDIRECTS = 5;
const UA = "Mozilla/5.0 (compatible; research-workspace source viewer)";
/** The embeddability check (HEAD, then a one-byte GET if the host refuses HEAD) must answer within this, redirects included. */
const CHECK_BUDGET_MS = 9000;

/** A plain sentence for a failed outbound request (the raw messages name internals). */
function friendlyFailure(error: unknown): Error {
  if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError"))
    return new Error("The site took too long to answer.");
  if (error instanceof TypeError && /fetch failed/i.test(error.message))
    return new Error("The site could not be reached.");
  return error instanceof Error ? error : new Error("The address could not be checked.");
}

/**
 * Follows redirects by hand so every hop is checked against the public-address rule. `timeoutMs` is one budget for the whole
 * chain, so a long redirect chain cannot multiply the wait.
 */
export async function guardedFetch(
  raw: string,
  init: RequestInit = {},
  timeoutMs = 20000,
): Promise<{ res: Response; url: URL }> {
  let url = publicUrl(raw);
  if (!url) throw new Error("Only public web addresses can be opened.");
  const signal = AbortSignal.timeout(timeoutMs);
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const res = await fetch(url, {
      ...init,
      redirect: "manual",
      headers: { "user-agent": UA, ...(init.headers ?? {}) },
      signal,
    });
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      const next = publicUrl(new URL(res.headers.get("location")!, url).toString());
      if (!next) throw new Error("The address redirects to a location that cannot be opened.");
      url = next;
      continue;
    }
    return { res, url };
  }
  throw new Error("Too many redirects.");
}

export function kindOf(contentType: string | null, url: URL): SourceCheck["kind"] {
  const ct = (contentType ?? "").toLowerCase();
  if (ct.includes("pdf") || /\.pdf$/i.test(url.pathname)) return "pdf";
  if (ct.startsWith("image/")) return "image";
  if (ct.startsWith("text/html") || ct.includes("xhtml")) return "page";
  if (ct.startsWith("text/") || ct.includes("json")) return "text";
  if (!ct) return /\.(docx?|xlsx?|pptx?|zip|csv)$/i.test(url.pathname) ? "file" : "page";
  return "file";
}

/** Whether the page's own headers let another site frame it (X-Frame-Options and CSP frame-ancestors). */
export function framingAllowed(
  headers: Headers,
  ownOrigin: string,
): { ok: boolean; reason: string | null } {
  const xfo = (headers.get("x-frame-options") ?? "").trim().toLowerCase();
  if (xfo === "deny" || xfo === "sameorigin" || xfo.startsWith("allow-from"))
    return {
      ok: false,
      reason: "The site does not allow its pages to be shown inside other sites.",
    };
  const csp = headers.get("content-security-policy") ?? "";
  const directive = csp
    .split(";")
    .map((d) => d.trim())
    .find((d) => d.toLowerCase().startsWith("frame-ancestors"));
  if (directive) {
    const sources = directive
      .split(/\s+/)
      .slice(1)
      .map((s) => s.toLowerCase());
    const allows =
      sources.includes("*") ||
      sources.some((s) => s.replace(/\/$/, "") === ownOrigin.toLowerCase());
    if (!allows)
      return { ok: false, reason: "The site only allows its pages inside its own pages." };
  }
  return { ok: true, reason: null };
}

function fileName(headers: Headers, url: URL): string | null {
  const cd = headers.get("content-disposition") ?? "";
  const m = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(cd);
  if (m) {
    try {
      return decodeURIComponent(m[1]!).slice(0, 180);
    } catch {
      return m[1]!.slice(0, 180);
    }
  }
  const last = url.pathname.split("/").pop();
  return last && /\.[a-z0-9]{2,5}$/i.test(last) ? decodeURIComponent(last).slice(0, 180) : null;
}

export async function checkSource(raw: string, ownOrigin: string): Promise<SourceCheck> {
  const deadline = Date.now() + CHECK_BUDGET_MS;
  let res: Response;
  let url: URL;
  try {
    ({ res, url } = await guardedFetch(raw, { method: "HEAD" }, CHECK_BUDGET_MS));
    if (res.status === 405 || res.status === 403 || res.status === 501) {
      // The host refuses HEAD: ask for one byte instead, within what is left of the same budget.
      ({ res, url } = await guardedFetch(
        raw,
        { method: "GET", headers: { range: "bytes=0-0" } },
        Math.max(1500, deadline - Date.now()),
      ));
      await res.body?.cancel();
    }
  } catch (error) {
    throw friendlyFailure(error);
  }
  const contentType = res.headers.get("content-type");
  const kind = kindOf(contentType, url);
  const frame = framingAllowed(res.headers, ownOrigin);
  const attachment = /attachment/i.test(res.headers.get("content-disposition") ?? "");
  const total = /\/(\d+)$/.exec(res.headers.get("content-range") ?? "")?.[1];
  const size =
    Number(total ?? (res.status === 206 ? "" : (res.headers.get("content-length") ?? ""))) || null;
  const answered = res.status < 400;
  return {
    url: raw,
    finalUrl: url.toString(),
    embeddable: answered && frame.ok && !attachment && kind !== "file" && url.protocol === "https:",
    reason: !answered
      ? "The site did not answer a direct request."
      : attachment
        ? "The address downloads a file."
        : url.protocol !== "https:"
          ? "The site is not served over a secure connection."
          : frame.reason,
    contentType,
    kind,
    fileName: fileName(res.headers, url),
    size,
    status: res.status,
  };
}

// Public pages only, whoever asks: nothing here depends on who the person is.
const checkCache = new TtlCache<SourceCheck>({ max: 300, ttlMs: 5 * 60_000, errorTtlMs: 15_000 });
const textCache = new TtlCache<SourceText>({ max: 24, ttlMs: 10 * 60_000, errorTtlMs: 10_000 });

/** Forgets every remembered check and page text (tests, and a way to drop them if a deployment ever needs to). */
export function clearSourceCaches(): void {
  checkCache.clear();
  textCache.clear();
}

/**
 * The check for an address, from memory when it is fresh and shared with a request already under way. `cached` says whether
 * the answer was already known; `fresh` asks again (the reload button).
 */
export async function checkSourceCached(
  raw: string,
  ownOrigin: string,
  options: { fresh?: boolean } = {},
): Promise<{ check: SourceCheck; cached: boolean; ms: number }> {
  const key = `${ownOrigin}\n${raw}`;
  if (options.fresh) checkCache.delete(key);
  const started = Date.now();
  const cached = !!checkCache.peek(key);
  const check = await checkCache.load(key, () => checkSource(raw, ownOrigin));
  return { check, cached, ms: Date.now() - started };
}

/** A Server-Timing header value, so the panel's waits can be read in the browser's network tools. */
export function serverTiming(parts: { name: string; dur?: number; desc?: string }[]): string {
  return parts
    .map((p) =>
      [
        p.name,
        p.dur !== undefined ? `dur=${Math.round(p.dur)}` : null,
        p.desc ? `desc="${p.desc.replace(/["\\]/g, "")}"` : null,
      ]
        .filter(Boolean)
        .join(";"),
    )
    .join(", ");
}

const RELAY_MAX = 60 * 1024 * 1024;
// SVG is safe inline here: the relay's CSP sandbox gives it an opaque origin with scripts off.
const INLINE = /^(application\/pdf|image\/(png|jpeg|gif|webp|svg\+xml)|text\/plain)/i;
// Text-like documents (JSON, CSV, XML, source text) are shown inline as plain text, so they open in the panel instead of
// downloading. HTML in any form never matches, and plain text cannot run anything.
const TEXT_LIKE =
  /^(?:text\/(?!x?html\b)[\w.+-]+|application\/(?!xhtml)(?:json|xml|[\w.+-]+\+(?:json|xml)))$/i;

/** Streams a public file back. Inline only for PDFs, images and text; everything else (HTML included) is an attachment. */
export async function relayFile(raw: string, inline: boolean): Promise<Response> {
  const { res, url } = await guardedFetch(raw, { method: "GET" }, 45000);
  if (!res.ok || !res.body) return new Response("The file could not be fetched.", { status: 502 });
  const length = Number(res.headers.get("content-length") ?? "0");
  if (length > RELAY_MAX) {
    await res.body.cancel();
    return new Response("The file is too large to relay.", { status: 413 });
  }
  const encoding = (res.headers.get("content-encoding") ?? "").trim().toLowerCase();
  // A body the fetch has already decompressed no longer matches the length the host stated for the compressed one.
  const verbatim = !encoding || encoding === "identity";
  const upstream = (res.headers.get("content-type") ?? "application/octet-stream")
    .split(";")[0]!
    .trim();
  const asText = inline && TEXT_LIKE.test(upstream);
  const showInline = inline && (INLINE.test(upstream) || asText);
  const charset = /charset="?([\w-]{1,40})"?/i.exec(res.headers.get("content-type") ?? "")?.[1];
  const type = asText ? `text/plain; charset=${charset ?? "utf-8"}` : upstream;
  const name = (fileName(res.headers, url) ?? url.hostname).replace(/[^\w.\- ]+/g, "_");
  let seen = 0;
  const limited = res.body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        seen += chunk.byteLength;
        if (seen > RELAY_MAX) controller.error(new Error("too large"));
        else controller.enqueue(chunk);
      },
    }),
  );
  return new Response(limited, {
    headers: {
      "content-type": showInline ? type : "application/octet-stream",
      "content-disposition": `${showInline ? "inline" : "attachment"}; filename="${name}"`,
      "x-content-type-options": "nosniff",
      "content-security-policy":
        "sandbox; default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'",
      // A public document may be kept for a few minutes by this person's browser, so reopening it is quicker (a 3.5 MB PDF
      // reopened in about 0.7 s instead of 1.1 s); a download is not kept.
      "cache-control": showInline ? "private, max-age=300" : "private, no-store",
      ...(verbatim && length ? { "content-length": String(length) } : {}),
    },
  });
}

const READER_MAX = 200_000;

/** Drops embedded images and resolves relative link targets against the page, so links never point into this site. */
export function absolutizeLinks(markdown: string, base: URL): string {
  return markdown
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, (_whole, target: string) => {
      if (/^(mailto:|tel:)/i.test(target)) return `](${target})`;
      try {
        const resolved = new URL(target, base);
        return /^https?:$/.test(resolved.protocol)
          ? `](${resolved.toString()})`
          : `](${base.toString()})`;
      } catch {
        return `](${base.toString()})`;
      }
    })
    .replace(/\[\s*\]\([^)]*\)/g, "");
}

export function readerConfigured(): boolean {
  return !!process.env["FIRECRAWL_API_KEY"]?.trim();
}

export type SourceText = { url: string; title: string; markdown: string; truncated: boolean };

/** The main text of a public page or document as markdown, for the panel's text view. */
export async function readSourceText(raw: string): Promise<SourceText> {
  const key = process.env["FIRECRAWL_API_KEY"]?.trim();
  if (!key) throw new Error("The text view is not configured on this server.");
  const url = publicUrl(raw);
  if (!url) throw new Error("Only public web addresses can be opened.");
  const res = await fetch("https://api.firecrawl.dev/v2/scrape", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
    body: JSON.stringify({
      url: url.toString(),
      formats: ["markdown"],
      onlyMainContent: true,
      parsers: ["pdf"],
      timeout: 40000,
    }),
    signal: AbortSignal.timeout(50000),
  });
  if (!res.ok) throw new Error("The page text could not be read.");
  const body = (await res.json()) as {
    data?: { markdown?: string; metadata?: { title?: string } };
  };
  const markdown = absolutizeLinks(body.data?.markdown ?? "", url);
  if (!markdown.trim()) throw new Error("No readable text was found on the page.");
  const title = (body.data?.metadata?.title ?? "").toString().slice(0, 300) || url.hostname;
  return {
    url: url.toString(),
    title,
    markdown: markdown.slice(0, READER_MAX),
    truncated: markdown.length > READER_MAX,
  };
}

/** The page text, from memory when fresh and shared with a read already under way (a page is read once, not once per ask). */
export async function readSourceTextCached(
  raw: string,
  options: { fresh?: boolean } = {},
): Promise<SourceText> {
  const url = publicUrl(raw);
  if (!url) throw new Error("Only public web addresses can be opened.");
  const key = url.toString();
  if (options.fresh) textCache.delete(key);
  return textCache.load(key, () => readSourceText(raw));
}

const BROWSER_API = "https://api.browser-use.com/api/v3/browsers";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Sends one Page.navigate over the tab's DevTools socket and waits for the browser to accept it. */
function cdpNavigate(wsUrl: string, url: string): Promise<void> {
  const Socket = (globalThis as { WebSocket?: typeof WebSocket }).WebSocket;
  if (!Socket) return Promise.reject(new Error("no socket support"));
  return new Promise<void>((resolve, reject) => {
    const ws = new Socket(wsUrl);
    const finish = (error?: Error) => {
      clearTimeout(timer);
      try {
        ws.close();
      } catch {
        // already closed
      }
      if (error) reject(error);
      else resolve();
    };
    const timer = setTimeout(() => finish(new Error("navigation timed out")), 15000);
    ws.addEventListener("open", () =>
      ws.send(JSON.stringify({ id: 1, method: "Page.navigate", params: { url } })),
    );
    ws.addEventListener("message", (event) => {
      let message: { id?: number; error?: unknown };
      try {
        message = JSON.parse(String(event.data)) as typeof message;
      } catch {
        return;
      }
      if (message.id === 1) finish(message.error ? new Error("navigation refused") : undefined);
    });
    ws.addEventListener("error", () => finish(new Error("socket error")));
  });
}

export function remoteBrowserConfigured(): boolean {
  return !!process.env["BROWSER_USE_API_KEY"]?.trim();
}

/** Starts a disposable hosted browser on the address and returns its live view (the control endpoint stays here). */
export async function startRemoteBrowser(
  raw: string,
  width: number,
  height: number,
): Promise<{ id: string; liveUrl: string }> {
  const key = process.env["BROWSER_USE_API_KEY"]?.trim();
  if (!key) throw new Error("The in-page browser is not configured on this server.");
  const target = publicUrl(raw);
  if (!target) throw new Error("Only public web addresses can be opened.");
  const res = await fetch(BROWSER_API, {
    method: "POST",
    headers: { "content-type": "application/json", "x-browser-use-api-key": key },
    body: JSON.stringify({
      timeout: 30,
      proxyCountryCode: "us",
      browserScreenWidth: Math.min(1600, Math.max(800, Math.round(width))),
      browserScreenHeight: Math.min(1400, Math.max(600, Math.round(height))),
      pdfRendererEnabled: true,
    }),
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok)
    throw new Error(
      res.status === 429
        ? "Too many browsers are open. Close one and try again."
        : "The in-page browser could not start.",
    );
  const session = (await res.json()) as { id?: string; liveUrl?: string; cdpUrl?: string };
  if (!session.id || !UUID.test(session.id) || !session.liveUrl || !session.cdpUrl)
    throw new Error("The in-page browser could not start.");
  const cdp = session.cdpUrl.replace(/^wss:/, "https:").replace(/\/$/, "");
  try {
    const targets = (await (
      await fetch(`${cdp}/json/list`, { signal: AbortSignal.timeout(15000) })
    ).json()) as {
      id: string;
      type?: string;
      webSocketDebuggerUrl?: string;
    }[];
    // The live view follows the browser's first tab, so that tab is navigated in place.
    const first = targets.find((t) => t.type === "page" && t.webSocketDebuggerUrl);
    let navigated = false;
    if (
      first?.webSocketDebuggerUrl &&
      new URL(first.webSocketDebuggerUrl).host === new URL(cdp).host
    ) {
      navigated = await cdpNavigate(first.webSocketDebuggerUrl, target.toString()).then(
        () => true,
        () => false,
      );
    }
    if (!navigated) {
      const opened = await fetch(`${cdp}/json/new?${encodeURIComponent(target.toString())}`, {
        method: "PUT",
        signal: AbortSignal.timeout(15000),
      });
      const tab = (await opened.json()) as { id?: string };
      for (const t of targets)
        if (t.id !== tab.id)
          await fetch(`${cdp}/json/close/${t.id}`, { signal: AbortSignal.timeout(10000) }).catch(
            () => null,
          );
      if (tab.id)
        await fetch(`${cdp}/json/activate/${tab.id}`, { signal: AbortSignal.timeout(10000) }).catch(
          () => null,
        );
    }
  } catch {
    await stopRemoteBrowser(session.id).catch(() => null);
    throw new Error("The in-page browser could not open the address.");
  }
  const live = new URL(session.liveUrl);
  if (live.protocol !== "https:") throw new Error("The in-page browser could not start.");
  return { id: session.id, liveUrl: live.toString() };
}

export async function stopRemoteBrowser(id: string): Promise<void> {
  const key = process.env["BROWSER_USE_API_KEY"]?.trim();
  if (!key || !UUID.test(id)) return;
  await fetch(`${BROWSER_API}/${id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json", "x-browser-use-api-key": key },
    body: JSON.stringify({ action: "stop" }),
    signal: AbortSignal.timeout(15000),
  });
}
