/**
 * The browser-side cache of generated summaries, keyed by the hash of the section context: a repeat visit or a second
 * "Summarize" on the same figures costs nothing. Memory first, sessionStorage behind it (so a reload keeps the result
 * for the tab); a different figure produces a different key, so a stale summary can never be shown for new data.
 * Storage is optional: every read and write is guarded, and the cache works without it.
 */

export type CachedSummary = {
  bullets: string[];
  omitted: number;
  /** ISO time the server generated it. */
  generatedAt: string;
};

type Entry = CachedSummary & { at: number };

export const SUMMARY_STORE_KEY = "lsc:ai-summary:v1";
export const CLIENT_TTL_MS = 6 * 60 * 60 * 1000;
export const CLIENT_MAX_ENTRIES = 40;

export type StorageLike = Pick<Storage, "getItem" | "setItem">;

export class SummaryCache {
  private readonly memory = new Map<string, Entry>();
  private loaded = false;

  constructor(
    private readonly storage: () => StorageLike | null = defaultStorage,
    private readonly now: () => number = Date.now,
  ) {}

  private load() {
    if (this.loaded) return;
    this.loaded = true;
    try {
      const raw = this.storage()?.getItem(SUMMARY_STORE_KEY);
      const parsed = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
      for (const [key, value] of Object.entries(parsed)) {
        const entry = readEntry(value);
        if (entry) this.memory.set(key, entry);
      }
    } catch {
      // storage unavailable or damaged: start empty
    }
  }

  private save() {
    try {
      this.storage()?.setItem(SUMMARY_STORE_KEY, JSON.stringify(Object.fromEntries(this.memory)));
    } catch {
      // storage full or blocked: memory still holds the result for this page
    }
  }

  get(key: string): CachedSummary | null {
    this.load();
    const entry = this.memory.get(key);
    if (!entry) return null;
    if (this.now() - entry.at > CLIENT_TTL_MS) {
      this.memory.delete(key);
      return null;
    }
    return { bullets: entry.bullets, omitted: entry.omitted, generatedAt: entry.generatedAt };
  }

  set(key: string, value: CachedSummary): void {
    this.load();
    this.memory.delete(key);
    this.memory.set(key, { ...value, at: this.now() });
    while (this.memory.size > CLIENT_MAX_ENTRIES) {
      const oldest = this.memory.keys().next().value;
      if (oldest === undefined) break;
      this.memory.delete(oldest);
    }
    this.save();
  }

  clear(): void {
    this.memory.clear();
    this.save();
  }
}

function readEntry(value: unknown): Entry | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  if (
    !Array.isArray(v["bullets"]) ||
    !v["bullets"].every((b) => typeof b === "string") ||
    typeof v["at"] !== "number" ||
    typeof v["omitted"] !== "number" ||
    typeof v["generatedAt"] !== "string"
  )
    return null;
  return {
    bullets: (v["bullets"] as string[]).slice(0, 6),
    omitted: v["omitted"],
    generatedAt: v["generatedAt"],
    at: v["at"],
  };
}

function defaultStorage(): StorageLike | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

/** The one cache the kit's components share. */
export const summaryCache = new SummaryCache();
