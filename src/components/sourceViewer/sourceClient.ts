/**
 * The panel's requests, made once and remembered: the embeddability check and the page text are cached per address (a link
 * the pointer rests on is checked before it is clicked), concurrent callers share one request, and the short-lived
 * same-site session cookie is refreshed only when it is about to lapse. The server still decides everything that matters;
 * nothing here widens what it will fetch.
 */
import { TtlCache } from "@/lib/sourceViewer/ttlCache";
import type { CheckResult } from "./sourceLinks";

export type CheckFailure = {
  ok: false;
  message: string;
  code: string;
  remoteBrowser: boolean;
  reader: boolean;
};
export type CheckOutcome = { ok: true; data: CheckResult } | CheckFailure;

export type ReaderData = { title: string; markdown: string; truncated: boolean };
export type ReaderOutcome = { ok: true; data: ReaderData } | { ok: false; message: string };

export type SourceClientDeps = {
  fetch: typeof fetch;
  /** Request headers carrying the signed-in session, if any. */
  headers: () => Promise<Record<string, string>>;
  now?: () => number;
};

export const CHECK_TTL_MS = 5 * 60_000;
/** A failed check is retried soon: a host that was down a moment ago may be up now. */
export const CHECK_FAILURE_TTL_MS = 15_000;
export const READER_TTL_MS = 10 * 60_000;

/** Failures that will not change by asking again soon stay remembered as long as a success. */
const STABLE_FAILURES = new Set(["not_public"]);

export function createSourceClient(deps: SourceClientDeps) {
  const now = deps.now ?? Date.now;
  const checks = new TtlCache<CheckOutcome>({
    max: 120,
    ttlMs: CHECK_TTL_MS,
    ttlFor: (v) => {
      if (v.ok || STABLE_FAILURES.has(v.code)) return CHECK_TTL_MS;
      // Sign-in problems must be retried immediately once the person signs in.
      return v.code === "access" ? 0 : CHECK_FAILURE_TTL_MS;
    },
    now,
  });
  const readers = new TtlCache<ReaderOutcome>({
    max: 24,
    ttlMs: READER_TTL_MS,
    ttlFor: (v) => (v.ok ? READER_TTL_MS : CHECK_FAILURE_TTL_MS),
    now,
  });

  // A reload asks the server again (`fresh`) and skips the browser's own copy of the answer.
  const request = (path: string, url: string, fresh: boolean) =>
    `${path}?url=${encodeURIComponent(url)}${fresh ? "&fresh=1" : ""}`;

  async function fetchCheck(url: string, fresh = false): Promise<CheckOutcome> {
    try {
      const res = await deps.fetch(request("/api/source-check", url, fresh), {
        headers: await deps.headers(),
        ...(fresh ? { cache: "reload" as const } : {}),
      });
      const data = (await res.json().catch(() => null)) as
        (CheckResult & { error?: string; code?: string }) | null;
      if (res.ok && data && !data.error) return { ok: true, data };
      return {
        ok: false,
        message: data?.error ?? "The address could not be checked.",
        code: data?.code ?? (res.status === 401 || res.status === 403 ? "access" : "unreachable"),
        remoteBrowser: !!data?.remoteBrowser,
        reader: !!data?.reader,
      };
    } catch {
      return {
        ok: false,
        message: "The address could not be checked.",
        code: "unreachable",
        remoteBrowser: false,
        reader: false,
      };
    }
  }

  async function fetchReader(url: string, fresh = false): Promise<ReaderOutcome> {
    try {
      const res = await deps.fetch(request("/api/source-text", url, fresh), {
        headers: await deps.headers(),
        ...(fresh ? { cache: "reload" as const } : {}),
      });
      const data = (await res.json().catch(() => null)) as
        (Partial<ReaderData> & { error?: string }) | null;
      if (!res.ok || !data?.markdown)
        return { ok: false, message: data?.error ?? "The page text could not be read." };
      return {
        ok: true,
        data: { title: data.title ?? "", markdown: data.markdown, truncated: !!data.truncated },
      };
    } catch {
      return { ok: false, message: "The page text could not be read." };
    }
  }

  // Hover prefetches are budgeted so moving the pointer across a table of links cannot use up the server's rate limit.
  const PREFETCH_BURST = 6;
  const PREFETCH_REFILL_MS = 6_000;
  let tokens = PREFETCH_BURST;
  let refilledAt = now();
  function takeToken(): boolean {
    const t = now();
    const gained = Math.floor((t - refilledAt) / PREFETCH_REFILL_MS);
    if (gained > 0) {
      tokens = Math.min(PREFETCH_BURST, tokens + gained);
      refilledAt += gained * PREFETCH_REFILL_MS;
    }
    if (tokens <= 0) return false;
    tokens -= 1;
    return true;
  }

  return {
    /** The check for an address: from memory when fresh, or the request already under way, or a new one. */
    check(url: string, options: { fresh?: boolean } = {}): Promise<CheckOutcome> {
      if (options.fresh) checks.delete(url);
      return checks.load(url, () => fetchCheck(url, options.fresh));
    },
    /** Starts the check ahead of a click if it is not known yet and the budget allows. Never throws. */
    prefetchCheck(url: string): boolean {
      if (checks.peek(url)) return false;
      if (!takeToken()) return false;
      void checks.load(url, () => fetchCheck(url));
      return true;
    },
    /** The page text for an address, from memory when fresh; `fresh` reads it again (the reload button). */
    reader(url: string, options: { fresh?: boolean } = {}): Promise<ReaderOutcome> {
      if (options.fresh) readers.delete(url);
      return readers.load(url, () => fetchReader(url, options.fresh));
    },
  };
}

export type SourceClient = ReturnType<typeof createSourceClient>;

/**
 * Keeps the same-site session cookie fresh without a round trip per click: no refresh at all while the server reports that
 * sign-in is not enforced, otherwise one refresh per `everyMs` (the cookie lives five minutes).
 */
export function createSessionRefresher(
  refresh: () => Promise<{ required?: boolean } | null | undefined>,
  options: { everyMs?: number; now?: () => number } = {},
) {
  const everyMs = options.everyMs ?? 4 * 60_000;
  const now = options.now ?? Date.now;
  let notRequired = false;
  let lastOk = Number.NEGATIVE_INFINITY;
  let inflight: Promise<void> | null = null;
  return (): Promise<void> => {
    if (notRequired || now() - lastOk < everyMs) return Promise.resolve();
    if (inflight) return inflight;
    inflight = refresh()
      .then((result) => {
        if (result && result.required === false) notRequired = true;
        else if (result) lastOk = now();
      })
      .catch(() => undefined)
      .finally(() => {
        inflight = null;
      });
    return inflight;
  };
}
