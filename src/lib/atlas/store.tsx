import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { computeStats, type BundleStats } from "./bundle";
import { downloadBytes } from "./exports";
import { defaultFilters, type LibraryFilters } from "./filters";
import { loadLocalState, saveLocalState, type LocalState } from "./localState";
import {
  createIdbImportStore,
  fetchBundledDefault,
  parseBundleBytes,
  persistImport,
  resolveStartupBundle,
  sha256Hex,
  type ImportStore,
  type LoadedBundle,
} from "./persistence";
import { applyReview, undoReview } from "./review";
import type { Bookmark, Bundle, ReviewAction, ReviewOverlay } from "./types";

type LastReview = { sourceId: string; previous: ReviewOverlay | null } | null;

export type LoadStatus = "loading" | "ready" | "error";

export type ImportResult =
  | { ok: true; persisted: true; warnings: string[] }
  | { ok: true; persisted: false; warnings: string[]; error: string }
  | { ok: false; errors: string[] };

type AtlasState = {
  status: LoadStatus;
  /** True once the startup load has finished (ready or error). */
  ready: boolean;
  loadError: string | null;
  notices: string[];
  loaded: LoadedBundle | null;
  bundle: Bundle | null;
  stats: BundleStats | null;
  /** Set when the currently shown user import is NOT saved in browser storage. */
  persistWarning: string | null;
  /** Set when reviews/bookmarks could not be saved or read. */
  localStateWarning: string | null;
  overlays: Record<string, ReviewOverlay>;
  bookmarks: Record<string, true>;
  filters: LibraryFilters;
  setFilters: (next: Partial<LibraryFilters>) => void;
  resetFilters: () => void;
  retryLoad: () => void;
  importBundleFile: (file: File) => Promise<ImportResult>;
  restoreBundledDefault: () => Promise<{ ok: true } | { ok: false; error: string }>;
  downloadRawBundle: () => void;
  review: (input: { sourceId: string; action: ReviewAction; reason: string }) =>
    | { ok: true }
    | { ok: false; error: string };
  lastReview: LastReview;
  undoLastReview: () => void;
  toggleBookmark: (sourceId: string) => boolean;
  clearLocalState: () => void;
};

const AtlasContext = createContext<AtlasState | null>(null);

function safeLocalStorage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function AtlasProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<LoadStatus>("loading");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notices, setNotices] = useState<string[]>([]);
  const [loaded, setLoaded] = useState<LoadedBundle | null>(null);
  const [persistWarning, setPersistWarning] = useState<string | null>(null);
  const [localStateWarning, setLocalStateWarning] = useState<string | null>(null);
  const [overlays, setOverlays] = useState<Record<string, ReviewOverlay>>({});
  const [bookmarks, setBookmarks] = useState<Record<string, true>>({});
  const [filters, setFiltersState] = useState<LibraryFilters>(defaultFilters);
  const [lastReview, setLastReview] = useState<LastReview>(null);

  const localRef = useRef<LocalState>({ overlays: {}, bookmarks: {} });
  const localHydrated = useRef(false);
  /** Monotonic load generation: stale async results are discarded. */
  const seq = useRef(0);
  const storeRef = useRef<ImportStore | null>(null);
  const getStore = () => (storeRef.current ??= createIdbImportStore());

  // Personal state: read once, never written by startup.
  useEffect(() => {
    const ls = safeLocalStorage();
    if (!ls) {
      setLocalStateWarning("Browser storage is unavailable; reviews and bookmarks will not be saved.");
    } else {
      const s = loadLocalState(ls);
      localRef.current = { overlays: s.overlays, bookmarks: s.bookmarks };
      setOverlays(s.overlays);
      setBookmarks(s.bookmarks);
      if (s.errors.length) setLocalStateWarning(s.errors.join(" "));
    }
    localHydrated.current = true;
  }, []);

  const commitLocal = useCallback((next: LocalState) => {
    localRef.current = next;
    setOverlays(next.overlays);
    setBookmarks(next.bookmarks);
    const ls = safeLocalStorage();
    if (!localHydrated.current || !ls) {
      setLocalStateWarning("Reviews and bookmarks could not be saved in this browser.");
      return;
    }
    const r = saveLocalState(ls, next);
    setLocalStateWarning(r.ok ? null : `Reviews and bookmarks were NOT saved: ${r.error}`);
  }, []);

  const runStartup = useCallback(async () => {
    const my = ++seq.current;
    setStatus("loading");
    setLoadError(null);
    const res = await resolveStartupBundle({
      store: getStore(),
      legacy: safeLocalStorage(),
      fetchDefault: fetchBundledDefault,
    }).catch((e: unknown) => ({ ok: false as const, error: String((e as Error)?.message ?? e), notices: [] }));
    if (my !== seq.current) return; // a newer import/restore superseded this load
    if (res.ok) {
      setLoaded(res.loaded);
      setNotices(res.loaded.notices);
      setPersistWarning(
        res.loaded.persisted ? null : "This bundle is loaded for this session only — saving it to browser storage failed.",
      );
      setStatus("ready");
    } else {
      setNotices(res.notices);
      setLoadError(res.error);
      setStatus("error");
    }
  }, []);

  useEffect(() => {
    void runStartup();
  }, [runStartup]);

  const stats = useMemo(() => (loaded ? computeStats(loaded.bundle) : null), [loaded]);

  const setFilters = useCallback((next: Partial<LibraryFilters>) => {
    setFiltersState((prev) => {
      const merged = { ...prev, ...next };
      const onlyPageChanged = Object.keys(next).length === 1 && "page" in next;
      return onlyPageChanged ? merged : { ...merged, page: next.page ?? 1 };
    });
  }, []);

  const resetFilters = useCallback(() => setFiltersState(defaultFilters), []);

  const importBundleFile = useCallback(async (file: File): Promise<ImportResult> => {
    let bytes: ArrayBuffer;
    try {
      bytes = await file.arrayBuffer();
    } catch (e) {
      return { ok: false, errors: [`File could not be read: ${(e as Error).message}`] };
    }
    const p = parseBundleBytes(bytes);
    if (!p.ok) return { ok: false, errors: p.errors };
    const my = ++seq.current;
    const sha = await sha256Hex(bytes);
    const next: LoadedBundle = {
      origin: "user-import",
      bytes,
      raw: p.raw,
      bundle: p.bundle,
      warnings: p.warnings,
      info: { fileName: file.name, sizeBytes: bytes.byteLength, sha256: sha },
      persisted: false,
      notices: [],
    };
    setLoaded(next);
    setNotices([]);
    setLoadError(null);
    setStatus("ready");
    setFiltersState(defaultFilters);
    setPersistWarning("Saving to browser storage…");
    const saved = await persistImport(getStore(), bytes.slice(0), file.name);
    if (my !== seq.current) {
      return saved.ok
        ? { ok: true, persisted: true, warnings: p.warnings }
        : { ok: true, persisted: false, warnings: p.warnings, error: saved.error };
    }
    if (saved.ok) {
      setLoaded({ ...next, persisted: true, info: { ...next.info, savedAt: saved.record.savedAt } });
      setPersistWarning(null);
      return { ok: true, persisted: true, warnings: p.warnings };
    }
    setPersistWarning(
      `This import is loaded for this session only — saving it to browser storage failed (${saved.error}). After a reload the previously saved data will be shown.`,
    );
    return { ok: true, persisted: false, warnings: p.warnings, error: saved.error };
  }, []);

  const restoreBundledDefault = useCallback(async () => {
    const my = ++seq.current;
    try {
      await getStore().remove();
    } catch (e) {
      return { ok: false as const, error: `Your saved import could not be removed: ${(e as Error).message}` };
    }
    try {
      const bytes = await fetchBundledDefault();
      const p = parseBundleBytes(bytes);
      if (!p.ok) throw new Error(p.errors[0]);
      if (my !== seq.current) return { ok: true as const };
      setLoaded({
        origin: "bundled-default",
        bytes,
        raw: p.raw,
        bundle: p.bundle,
        warnings: p.warnings,
        info: { fileName: "atlas-import-bundle.json", sizeBytes: bytes.byteLength, sha256: await sha256Hex(bytes) },
        persisted: true,
        notices: [],
      });
      setNotices([]);
      setPersistWarning(null);
      setLoadError(null);
      setStatus("ready");
      setFiltersState(defaultFilters);
      return { ok: true as const };
    } catch (e) {
      if (my === seq.current) {
        setLoaded(null);
        setLoadError(`Your import was removed, but the bundled directory could not be loaded: ${(e as Error).message}`);
        setStatus("error");
      }
      return { ok: false as const, error: (e as Error).message };
    }
  }, []);

  const retryLoad = useCallback(() => void runStartup(), [runStartup]);

  const downloadRawBundle = useCallback(() => {
    if (!loaded) return;
    downloadBytes(loaded.info.fileName, "application/json", loaded.bytes);
  }, [loaded]);

  const review = useCallback<AtlasState["review"]>(
    (input) => {
      const result = applyReview(localRef.current.overlays, input);
      if (!result.ok) return { ok: false, error: result.error };
      commitLocal({ ...localRef.current, overlays: result.overlays });
      setLastReview({ sourceId: input.sourceId, previous: result.previous });
      return { ok: true };
    },
    [commitLocal],
  );

  const undoLastReview = useCallback(() => {
    if (!lastReview) return;
    commitLocal({
      ...localRef.current,
      overlays: undoReview(localRef.current.overlays, lastReview.sourceId, lastReview.previous),
    });
    setLastReview(null);
  }, [lastReview, commitLocal]);

  const toggleBookmark = useCallback(
    (sourceId: string) => {
      const next = { ...localRef.current.bookmarks };
      const nowBookmarked = !next[sourceId];
      if (nowBookmarked) next[sourceId] = true;
      else delete next[sourceId];
      commitLocal({ ...localRef.current, bookmarks: next });
      return nowBookmarked;
    },
    [commitLocal],
  );

  const clearLocalState = useCallback(() => {
    commitLocal({ overlays: {}, bookmarks: {} });
    setLastReview(null);
  }, [commitLocal]);

  const value = useMemo<AtlasState>(
    () => ({
      status,
      ready: status !== "loading",
      loadError,
      notices,
      loaded,
      bundle: loaded?.bundle ?? null,
      stats,
      persistWarning,
      localStateWarning,
      overlays,
      bookmarks,
      filters,
      setFilters,
      resetFilters,
      retryLoad,
      importBundleFile,
      restoreBundledDefault,
      downloadRawBundle,
      review,
      lastReview,
      undoLastReview,
      toggleBookmark,
      clearLocalState,
    }),
    [
      status,
      loadError,
      notices,
      loaded,
      stats,
      persistWarning,
      localStateWarning,
      overlays,
      bookmarks,
      filters,
      setFilters,
      resetFilters,
      retryLoad,
      importBundleFile,
      restoreBundledDefault,
      downloadRawBundle,
      review,
      lastReview,
      undoLastReview,
      toggleBookmark,
      clearLocalState,
    ],
  );

  return <AtlasContext.Provider value={value}>{children}</AtlasContext.Provider>;
}

export function useAtlas(): AtlasState {
  const ctx = useContext(AtlasContext);
  if (!ctx) throw new Error("useAtlas must be used inside <AtlasProvider>");
  return ctx;
}

export type { Bookmark };
