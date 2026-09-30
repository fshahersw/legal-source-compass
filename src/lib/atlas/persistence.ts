import { parseBundle } from "./bundle";
import type { KeyValueStorage } from "./localState";
import type { Bundle } from "./types";

/**
 * Bundle loading & persistence.
 *
 * - The real supplied V2.2A file ships with the app at BUNDLED_DEFAULT_URL.
 * - A user-imported bundle is stored as its exact RAW BYTES in IndexedDB
 *   (never the adapted model, never localStorage).
 * - View models are always derived in memory from the raw bytes.
 */

export const BUNDLED_DEFAULT_URL = "/data/atlas-import-bundle.json";
export const BUNDLED_DEFAULT_FILENAME = "atlas-import-bundle.json";
/** SHA-256 of the bundled file, recorded at build time (see docs/verification-report.md). */
export const BUNDLED_DEFAULT_SHA256 = "acb1355f66463d76e865e582a2a3cc3e62a235fe0ffa19eb69ea80fb3e7b7b3e";
export const LEGACY_BUNDLE_KEY = "lsa.bundle.v1";

const DB_NAME = "legal-source-atlas";
const DB_STORE = "imports";
const RECORD_KEY = "current";

export type StoredImport = {
  bytes: ArrayBuffer;
  fileName: string;
  sizeBytes: number;
  sha256: string;
  savedAt: string;
  origin: "user-import" | "legacy-localStorage";
};

export interface ImportStore {
  load(): Promise<StoredImport | null>;
  save(record: StoredImport): Promise<void>;
  remove(): Promise<void>;
}

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((res, rej) => {
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error ?? new Error("IndexedDB request failed"));
  });
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((res, rej) => {
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error ?? new Error("IndexedDB transaction failed"));
    tx.onabort = () => rej(tx.error ?? new Error("IndexedDB transaction aborted"));
  });
}

export function createIdbImportStore(idb: IDBFactory | undefined = globalThis.indexedDB): ImportStore {
  let dbPromise: Promise<IDBDatabase> | null = null;
  const open = () => {
    if (!idb) return Promise.reject(new Error("IndexedDB is not available in this browser"));
    dbPromise ??= new Promise<IDBDatabase>((res, rej) => {
      const r = idb.open(DB_NAME, 1);
      r.onupgradeneeded = () => r.result.createObjectStore(DB_STORE);
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error ?? new Error("Could not open IndexedDB"));
      r.onblocked = () => rej(new Error("IndexedDB open was blocked by another tab"));
    }).catch((e) => {
      dbPromise = null;
      throw e;
    });
    return dbPromise;
  };
  return {
    async load() {
      const db = await open();
      const tx = db.transaction(DB_STORE, "readonly");
      const v = await req(tx.objectStore(DB_STORE).get(RECORD_KEY));
      return (v as StoredImport | undefined) ?? null;
    },
    async save(record) {
      const db = await open();
      const tx = db.transaction(DB_STORE, "readwrite");
      tx.objectStore(DB_STORE).put(record, RECORD_KEY);
      await txDone(tx);
    },
    async remove() {
      const db = await open();
      const tx = db.transaction(DB_STORE, "readwrite");
      tx.objectStore(DB_STORE).delete(RECORD_KEY);
      await txDone(tx);
    },
  };
}

export async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function deepFreeze<T>(v: T): T {
  if (v && typeof v === "object" && !Object.isFrozen(v)) {
    Object.freeze(v);
    for (const k of Object.keys(v)) deepFreeze((v as Record<string, unknown>)[k]);
  }
  return v;
}

export type ParsedBytes =
  | { ok: true; raw: unknown; bundle: Bundle; warnings: string[] }
  | { ok: false; errors: string[] };

/** Decode + parse raw bytes. The raw object is deep-frozen (immutable). */
export function parseBundleBytes(bytes: ArrayBuffer): ParsedBytes {
  let raw: unknown;
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    raw = JSON.parse(text);
  } catch (e) {
    return { ok: false, errors: [`File is not valid UTF-8 JSON: ${(e as Error).message}`] };
  }
  deepFreeze(raw);
  const r = parseBundle(raw);
  if (!r.ok) return { ok: false, errors: r.errors };
  return { ok: true, raw, bundle: r.bundle, warnings: r.warnings };
}

export type LoadedBundle = {
  origin: "user-import" | "migrated-legacy" | "bundled-default";
  bytes: ArrayBuffer;
  raw: unknown;
  bundle: Bundle;
  warnings: string[];
  info: { fileName: string; sizeBytes: number; sha256: string; savedAt?: string };
  /** Whether this bundle is saved in IndexedDB (bundled default: not applicable → true). */
  persisted: boolean;
  notices: string[];
};

/** Save raw bytes to IndexedDB and verify by reading them back. */
export async function persistImport(
  store: ImportStore,
  bytes: ArrayBuffer,
  fileName: string,
  origin: StoredImport["origin"] = "user-import",
): Promise<{ ok: true; record: StoredImport } | { ok: false; error: string }> {
  try {
    const sha256 = await sha256Hex(bytes);
    const record: StoredImport = {
      bytes,
      fileName,
      sizeBytes: bytes.byteLength,
      sha256,
      savedAt: new Date().toISOString(),
      origin,
    };
    await store.save(record);
    const back = await store.load();
    if (!back || back.sha256 !== sha256 || back.sizeBytes !== bytes.byteLength) {
      return { ok: false, error: "Saved copy could not be read back identically." };
    }
    return { ok: true, record };
  } catch (e) {
    return { ok: false, error: (e as Error)?.message || String(e) };
  }
}

export async function resolveStartupBundle(deps: {
  store: ImportStore;
  legacy: KeyValueStorage | null;
  fetchDefault: () => Promise<ArrayBuffer>;
}): Promise<{ ok: true; loaded: LoadedBundle } | { ok: false; error: string; notices: string[] }> {
  const notices: string[] = [];

  // 1. Saved IndexedDB import (raw bytes).
  try {
    const rec = await deps.store.load();
    if (rec) {
      const p = parseBundleBytes(rec.bytes);
      if (p.ok) {
        return {
          ok: true,
          loaded: {
            origin: "user-import",
            bytes: rec.bytes,
            raw: p.raw,
            bundle: p.bundle,
            warnings: p.warnings,
            info: { fileName: rec.fileName, sizeBytes: rec.sizeBytes, sha256: rec.sha256, savedAt: rec.savedAt },
            persisted: true,
            notices,
          },
        };
      }
      notices.push(
        `Your saved import "${rec.fileName}" could not be used (${p.errors[0]}). It was left in browser storage; the bundled directory is shown instead.`,
      );
    }
  } catch (e) {
    notices.push(`Saved imports could not be read from browser storage: ${(e as Error).message}. Showing the bundled directory.`);
  }

  // 2. Legacy localStorage import → migrate to IndexedDB, remove only after verified write.
  let legacyText: string | null = null;
  try {
    legacyText = deps.legacy?.getItem(LEGACY_BUNDLE_KEY) ?? null;
  } catch {
    legacyText = null;
  }
  if (legacyText) {
    const bytes = new TextEncoder().encode(legacyText).buffer as ArrayBuffer;
    const p = parseBundleBytes(bytes);
    if (p.ok) {
      const saved = await persistImport(deps.store, bytes, "legacy-browser-import.json", "legacy-localStorage");
      if (saved.ok) {
        try {
          deps.legacy?.removeItem(LEGACY_BUNDLE_KEY);
        } catch {
          /* leaving the old copy is harmless */
        }
        notices.push("An older browser import was moved to the new storage.");
      } else {
        notices.push(
          `An older browser import was loaded but could not be moved to the new storage (${saved.error}). The old copy was left in place.`,
        );
      }
      return {
        ok: true,
        loaded: {
          origin: "migrated-legacy",
          bytes,
          raw: p.raw,
          bundle: p.bundle,
          warnings: p.warnings,
          info: saved.ok
            ? { fileName: saved.record.fileName, sizeBytes: saved.record.sizeBytes, sha256: saved.record.sha256, savedAt: saved.record.savedAt }
            : { fileName: "legacy-browser-import.json", sizeBytes: bytes.byteLength, sha256: await sha256Hex(bytes) },
          persisted: saved.ok,
          notices,
        },
      };
    }
    notices.push("An older browser import was found but is not a valid bundle; it was ignored and left in place.");
  }

  // 3. Bundled default (real supplied V2.2A file shipped with the app).
  let bytes: ArrayBuffer;
  try {
    bytes = await deps.fetchDefault();
  } catch (e) {
    return { ok: false, error: `The bundled directory could not be loaded: ${(e as Error).message}`, notices };
  }
  const p = parseBundleBytes(bytes);
  if (!p.ok) return { ok: false, error: `The bundled directory is invalid: ${p.errors[0]}`, notices };
  return {
    ok: true,
    loaded: {
      origin: "bundled-default",
      bytes,
      raw: p.raw,
      bundle: p.bundle,
      warnings: p.warnings,
      info: { fileName: BUNDLED_DEFAULT_FILENAME, sizeBytes: bytes.byteLength, sha256: await sha256Hex(bytes) },
      persisted: true,
      notices,
    },
  };
}

export async function fetchBundledDefault(): Promise<ArrayBuffer> {
  const res = await fetch(BUNDLED_DEFAULT_URL, { cache: "no-cache" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.arrayBuffer();
}
