/**
 * Polite fetching for the source APIs: one request at a time per host with a minimum spacing, a request budget per run,
 * 429/503 handling with Retry-After (a wait longer than `maxRetryWaitMs` stops the run as partial instead of hammering),
 * bounded retries with backoff for network errors and 5xx, a timeout and a response-size bound. Every request is
 * recorded (URL without any key, status, bytes, sha256, time) for the run ledger. Keys travel only in headers.
 */
import type { RequestRecord, SourceHttp } from "./types.ts";

export const USER_AGENT =
  "LegalSourceAtlas/1.0 (scheduled public-data refresh; contact: notreelai@gmail.com)";

export class BudgetExhausted extends Error {
  constructor() {
    super("request budget for this run is used up");
    this.name = "BudgetExhausted";
  }
}

export class RateLimited extends Error {
  readonly waitMs: number;
  constructor(waitMs: number) {
    super(
      `the source asked to wait ${Math.round(waitMs / 1000)} s (rate limit); the next run continues`,
    );
    this.name = "RateLimited";
    this.waitMs = waitMs;
  }
}

export class SourceError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "SourceError";
    this.status = status;
  }
}

const KEY_PARAMS = /^(api[_-]?key|apikey|access_token|token|key)$/i;

/** The URL as recorded: query parameters that could carry a credential are removed. */
export function recordableUrl(url: string): string {
  const u = new URL(url);
  for (const k of [...u.searchParams.keys()]) if (KEY_PARAMS.test(k)) u.searchParams.delete(k);
  return u.href;
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as unknown as ArrayBuffer);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Retry-After as milliseconds (seconds or an HTTP date); null when absent or unreadable. */
export function retryAfterMs(value: string | null, now: number): number | null {
  if (!value) return null;
  if (/^\d+$/.test(value.trim())) return Number(value.trim()) * 1000;
  const at = Date.parse(value);
  return Number.isNaN(at) ? null : Math.max(0, at - now);
}

export type HttpOptions = {
  maxRequests: number;
  minIntervalMs: number;
  maxRetryWaitMs?: number;
  timeoutMs?: number;
  maxBytes?: number;
  attempts?: number;
  fetch?: typeof fetch | undefined;
  sleep?: (ms: number) => Promise<void>;
  clock?: () => number;
};

export function politeHttp(opts: HttpOptions): SourceHttp {
  const doFetch = opts.fetch ?? fetch;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const clock = opts.clock ?? (() => Date.now());
  const maxRetryWait = opts.maxRetryWaitMs ?? 60_000;
  const timeout = opts.timeoutMs ?? 45_000;
  const maxBytes = opts.maxBytes ?? 25_000_000;
  const attempts = opts.attempts ?? 3;
  const lastAt = new Map<string, number>();
  const requests: RequestRecord[] = [];
  let used = 0;

  async function spaced(host: string) {
    const prev = lastAt.get(host);
    if (prev !== undefined) {
      const wait = prev + opts.minIntervalMs - clock();
      if (wait > 0) await sleep(wait);
    }
    lastAt.set(host, clock());
  }

  async function getText(
    url: string,
    init: { headers?: Record<string, string>; recordUrl?: string } = {},
  ) {
    return send(url, { ...init, method: "GET" });
  }

  type Init = {
    method?: "GET" | "POST";
    headers?: Record<string, string>;
    body?: string;
    recordUrl?: string;
  };

  async function send(url: string, init: Init = {}) {
    const r = await request(url, init);
    return { status: r.status, text: new TextDecoder("utf-8").decode(r.bytes), record: r.record };
  }

  async function getBytes(
    url: string,
    init: { headers?: Record<string, string>; recordUrl?: string } = {},
  ) {
    return request(url, { ...init, method: "GET" });
  }

  async function request(url: string, init: Init) {
    const host = new URL(url).host;
    // A write is never repeated blindly: POST gets one attempt (a 429/503 still reports the wait to the run).
    const tries = (init.method ?? "GET") === "GET" ? attempts : 1;
    for (let attempt = 1; ; attempt++) {
      if (used >= opts.maxRequests) throw new BudgetExhausted();
      used++;
      await spaced(host);
      let res: Response;
      try {
        res = await doFetch(url, {
          method: init.method ?? "GET",
          headers: {
            "User-Agent": USER_AGENT,
            Accept: "application/json",
            ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}),
            ...(init.headers ?? {}),
          },
          ...(init.body !== undefined ? { body: init.body } : {}),
          redirect: "follow",
          signal: AbortSignal.timeout(timeout),
        });
      } catch (error) {
        if (attempt >= tries)
          throw new SourceError(
            `network error after ${attempt} attempts (${error instanceof Error ? error.name : "error"})`,
            0,
          );
        await sleep(2000 * 2 ** (attempt - 1));
        continue;
      }
      if (res.status === 429 || res.status === 503) {
        const wait =
          retryAfterMs(res.headers.get("retry-after"), clock()) ?? 5000 * 2 ** (attempt - 1);
        await res.body?.cancel();
        if (wait > maxRetryWait || attempt >= tries) throw new RateLimited(wait);
        await sleep(wait);
        continue;
      }
      if (res.status >= 500 && attempt < tries) {
        await res.body?.cancel();
        await sleep(2000 * 2 ** (attempt - 1));
        continue;
      }
      const buf = new Uint8Array(await res.arrayBuffer());
      if (buf.length > maxBytes)
        throw new SourceError(`response larger than ${maxBytes} bytes`, res.status);
      const record: RequestRecord = {
        url: recordableUrl(init.recordUrl ?? url),
        status: res.status,
        bytes: buf.length,
        sha256: await sha256Hex(buf),
        retrieved_at: new Date(clock()).toISOString().replace(/\.\d{3}Z$/, "Z"),
      };
      requests.push(record);
      return { status: res.status, bytes: buf, record };
    }
  }

  return {
    getText,
    send,
    getBytes,
    requests,
    get remaining() {
      return Math.max(0, opts.maxRequests - used);
    },
  };
}
