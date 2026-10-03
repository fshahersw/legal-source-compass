import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it } from "vitest";

import { computeStats } from "./bundle";
import { loadLocalState, saveLocalState } from "./localState";
import {
  BUNDLED_DEFAULT_SHA256,
  LEGACY_BUNDLE_KEY,
  createIdbImportStore,
  parseBundleBytes,
  persistImport,
  resolveStartupBundle,
  sha256Hex,
  type ImportStore,
  type StoredImport,
} from "./persistence";

// The real supplied V2.2A file is bundled in the project, so these tests can
// never be silently skipped: a missing file is a hard failure.
const BUNDLED_PATH = resolve(__dirname, "../../../private/data/atlas-import-bundle.json");
const bytesBuf = readFileSync(BUNDLED_PATH);
const realBytes = bytesBuf.buffer.slice(bytesBuf.byteOffset, bytesBuf.byteOffset + bytesBuf.byteLength);
const realRaw = JSON.parse(bytesBuf.toString("utf8"));

const fetchReal = async () => realBytes.slice(0);
const enc = (s: string) => new TextEncoder().encode(s).buffer as ArrayBuffer;

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  const writes: string[] = [];
  return {
    data,
    writes,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => {
      writes.push(k);
      data.set(k, v);
    },
    removeItem: (k: string) => {
      data.delete(k);
    },
  };
}

function failingStore(base?: ImportStore): ImportStore {
  return {
    load: base ? () => base.load() : async () => null,
    save: async () => {
      throw new Error("QuotaExceededError: transaction aborted");
    },
    remove: async () => {
      throw new Error("transaction aborted");
    },
  };
}

describe("bundled real V2.2A file", () => {
  it("is the exact supplied file (fingerprint recorded in code)", () => {
    const hex = createHash("sha256").update(bytesBuf).digest("hex");
    expect(hex).toBe(BUNDLED_DEFAULT_SHA256);
    expect(bytesBuf.byteLength).toBe(6_539_722);
  });

  it("has the expected raw collection sizes", () => {
    expect(realRaw.directorySources).toHaveLength(4633);
    expect(realRaw.endpointCandidates).toHaveLength(258);
    expect(realRaw.familyManifest).toHaveLength(8);
    expect(realRaw.promotionLedger).toHaveLength(73);
    expect(realRaw.originalFiles).toHaveLength(4);
  });
});

describe("resolveStartupBundle", () => {
  it("loads the bundled default on a first visit (empty storage)", async () => {
    const store = createIdbImportStore(new IDBFactory());
    const legacy = memoryStorage();
    const res = await resolveStartupBundle({ store, legacy, fetchDefault: fetchReal });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.loaded.origin).toBe("bundled-default");
    const stats = computeStats(res.loaded.bundle);
    expect(stats.distinctSources).toBe(4633);
    expect(stats.totalOccurrences).toBe(6372);
    expect(stats.endpointCandidates).toBe(258);
    expect(stats.sourceFamilies).toBe(8);
    expect(stats.promotionRecords).toBe(73);
    // startup must not write anything to localStorage
    expect(legacy.writes).toEqual([]);
  });

  it("prefers a validated saved IndexedDB import and round-trips its exact bytes", async () => {
    const store = createIdbImportStore(new IDBFactory());
    const saved = await persistImport(store, realBytes.slice(0), "my-import.json");
    expect(saved.ok).toBe(true);
    let defaultFetched = false;
    const res = await resolveStartupBundle({
      store,
      legacy: memoryStorage(),
      fetchDefault: async () => {
        defaultFetched = true;
        return realBytes.slice(0);
      },
    });
    expect(res.ok && res.loaded.origin).toBe("user-import");
    expect(defaultFetched).toBe(false);
    if (!res.ok) return;
    expect(await sha256Hex(res.loaded.bytes)).toBe(BUNDLED_DEFAULT_SHA256);
    expect(res.loaded.info.fileName).toBe("my-import.json");
    // originalFiles text survives in the raw bundle
    const raw = res.loaded.raw as { originalFiles: { text: string }[] };
    expect(raw.originalFiles.map((f) => f.text.length)).toEqual(
      realRaw.originalFiles.map((f: { text: string }) => f.text.length),
    );
  });

  it("falls back to the default with a notice when the saved import is corrupt, without deleting it", async () => {
    const idb = new IDBFactory();
    const store = createIdbImportStore(idb);
    const bad: StoredImport = {
      bytes: enc("{not json"),
      fileName: "broken.json",
      sizeBytes: 9,
      sha256: "x",
      savedAt: new Date().toISOString(),
      origin: "user-import",
    };
    await store.save(bad);
    const res = await resolveStartupBundle({ store, legacy: memoryStorage(), fetchDefault: fetchReal });
    expect(res.ok && res.loaded.origin).toBe("bundled-default");
    expect(res.ok && res.loaded.notices.join(" ")).toMatch(/could not be used/);
    expect((await store.load())?.fileName).toBe("broken.json");
  });

  it("migrates a valid legacy localStorage import only after a successful IndexedDB write", async () => {
    const store = createIdbImportStore(new IDBFactory());
    const legacyBundle = {
      bundle_version: "legacy",
      sources: [{ id: "s1", url: "https://a.gov/p?x=1#/h", title: "A", domain: "a.gov" }],
    };
    const legacy = memoryStorage({ [LEGACY_BUNDLE_KEY]: JSON.stringify(legacyBundle) });
    const res = await resolveStartupBundle({ store, legacy, fetchDefault: fetchReal });
    expect(res.ok && res.loaded.origin).toBe("migrated-legacy");
    expect(res.ok && res.loaded.bundle.sources[0]!.url).toBe("https://a.gov/p?x=1#/h");
    expect((await store.load())?.origin).toBe("legacy-localStorage");
    expect(legacy.data.has(LEGACY_BUNDLE_KEY)).toBe(false);
  });

  it("keeps the legacy copy in place when the IndexedDB write is rejected", async () => {
    const legacyText = JSON.stringify({ sources: [{ id: "s1", url: "https://a.gov/?q=1" }] });
    const legacy = memoryStorage({ [LEGACY_BUNDLE_KEY]: legacyText });
    const res = await resolveStartupBundle({ store: failingStore(), legacy, fetchDefault: fetchReal });
    expect(res.ok && res.loaded.origin).toBe("migrated-legacy");
    expect(res.ok && res.loaded.persisted).toBe(false);
    expect(res.ok && res.loaded.notices.join(" ")).toMatch(/could not be moved/);
    expect(legacy.data.get(LEGACY_BUNDLE_KEY)).toBe(legacyText);
  });

  it("ignores an invalid legacy copy without deleting it", async () => {
    const legacy = memoryStorage({ [LEGACY_BUNDLE_KEY]: "{broken" });
    const res = await resolveStartupBundle({
      store: createIdbImportStore(new IDBFactory()),
      legacy,
      fetchDefault: fetchReal,
    });
    expect(res.ok && res.loaded.origin).toBe("bundled-default");
    expect(legacy.data.get(LEGACY_BUNDLE_KEY)).toBe("{broken");
  });

  it("returns an explicit error (never a silent empty library) when the default cannot load", async () => {
    const res = await resolveStartupBundle({
      store: createIdbImportStore(new IDBFactory()),
      legacy: memoryStorage(),
      fetchDefault: async () => {
        throw new Error("HTTP 404");
      },
    });
    expect(res.ok).toBe(false);
    expect(!res.ok && res.error).toMatch(/HTTP 404/);
  });
});

describe("persistImport", () => {
  it("reports failure honestly when the transaction is rejected", async () => {
    const r = await persistImport(failingStore(), realBytes.slice(0), "x.json");
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toMatch(/Quota/);
  });

  it("verifies the write by reading it back", async () => {
    const store = createIdbImportStore(new IDBFactory());
    const r = await persistImport(store, realBytes.slice(0), "x.json");
    expect(r.ok).toBe(true);
    expect((await store.load())?.sizeBytes).toBe(6_539_722);
  });
});

describe("parseBundleBytes on the real file", () => {
  const res = parseBundleBytes(realBytes.slice(0));

  it("keeps raw records immutable and intact", () => {
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const raw = res.raw as typeof realRaw;
    expect(Object.isFrozen(raw.directorySources[0])).toBe(true);
    expect(raw).toEqual(realRaw);
    res.bundle.sources.forEach((s, i) => {
      const rec = (s as Record<string, unknown>)["imported_raw_record"];
      expect(rec).toEqual(realRaw.directorySources[i]);
      expect(s.url).toBe(realRaw.directorySources[i].url);
    });
  });

  it("preserves URLs with query strings and hash routes byte-for-byte", () => {
    if (!res.ok) throw new Error("parse failed");
    const withQuery = realRaw.directorySources.filter((s: { url: string }) => s.url.includes("?"));
    const withHash = realRaw.directorySources.filter((s: { url: string }) => s.url.includes("#"));
    expect(withQuery.length).toBeGreaterThan(0);
    expect(withHash.length).toBeGreaterThan(0);
    const urls = new Set(res.bundle.sources.map((s) => s.url));
    for (const s of [...withQuery, ...withHash]) expect(urls.has(s.url)).toBe(true);
  });

  it("rejects non-JSON bytes with an error", () => {
    const r = parseBundleBytes(enc("nope"));
    expect(r.ok).toBe(false);
  });
});

describe("browser-local overlay state", () => {
  it("loading never writes (no overwrite of stored overlays with empty defaults)", () => {
    const store = memoryStorage({
      "lsa.review-overlays.v1": JSON.stringify({ s1: { source_id: "s1", action: "accepted", reason: "long enough", at: "t" } }),
      "lsa.bookmarks.v1": JSON.stringify({ s2: true }),
    });
    const state = loadLocalState(store);
    expect(Object.keys(state.overlays)).toEqual(["s1"]);
    expect(state.bookmarks).toEqual({ s2: true });
    expect(store.writes).toEqual([]);
  });

  it("reports a rejected save instead of claiming success", () => {
    const store = {
      getItem: () => null,
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
      removeItem: () => {},
    };
    const r = saveLocalState(store, { overlays: {}, bookmarks: { s1: true } });
    expect(r.ok).toBe(false);
  });

  it("tolerates corrupt stored JSON without discarding the other key", () => {
    const store = memoryStorage({ "lsa.review-overlays.v1": "{bad", "lsa.bookmarks.v1": '{"a":true}' });
    const state = loadLocalState(store);
    expect(state.overlays).toEqual({});
    expect(state.bookmarks).toEqual({ a: true });
    expect(state.errors.length).toBe(1);
  });
});
