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

import { computeStats, parseBundle, type BundleStats } from "./bundle";
import { defaultFilters, type LibraryFilters } from "./filters";
import { applyReview, undoReview } from "./review";
import type { Bookmark, Bundle, ReviewAction, ReviewOverlay } from "./types";

const KEY_BUNDLE = "lsa.bundle.v1";
const KEY_OVERLAYS = "lsa.review-overlays.v1";
const KEY_BOOKMARKS = "lsa.bookmarks.v1";

type LastReview = { sourceId: string; previous: ReviewOverlay | null } | null;

type AtlasState = {
  ready: boolean;
  bundle: Bundle | null;
  stats: BundleStats | null;
  storageWarning: string | null;
  overlays: Record<string, ReviewOverlay>;
  bookmarks: Record<string, true>;
  filters: LibraryFilters;
  setFilters: (next: Partial<LibraryFilters>) => void;
  resetFilters: () => void;
  importBundleText: (text: string) => { ok: true; warnings: string[] } | { ok: false; errors: string[] };
  clearBundle: () => void;
  review: (input: { sourceId: string; action: ReviewAction; reason: string }) =>
    | { ok: true }
    | { ok: false; error: string };
  lastReview: LastReview;
  undoLastReview: () => void;
  toggleBookmark: (sourceId: string) => boolean;
  clearLocalState: () => void;
};

const AtlasContext = createContext<AtlasState | null>(null);

function readJson<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function AtlasProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [bundle, setBundle] = useState<Bundle | null>(null);
  const [overlays, setOverlays] = useState<Record<string, ReviewOverlay>>({});
  const [bookmarks, setBookmarks] = useState<Record<string, true>>({});
  const [filters, setFiltersState] = useState<LibraryFilters>(defaultFilters);
  const [storageWarning, setStorageWarning] = useState<string | null>(null);
  const [lastReview, setLastReview] = useState<LastReview>(null);
  const hydrated = useRef(false);

  useEffect(() => {
    setBundle(readJson<Bundle | null>(KEY_BUNDLE, null));
    setOverlays(readJson<Record<string, ReviewOverlay>>(KEY_OVERLAYS, {}));
    setBookmarks(readJson<Record<string, true>>(KEY_BOOKMARKS, {}));
    hydrated.current = true;
    setReady(true);
  }, []);

  useEffect(() => {
    if (!hydrated.current) return;
    try {
      window.localStorage.setItem(KEY_OVERLAYS, JSON.stringify(overlays));
      window.localStorage.setItem(KEY_BOOKMARKS, JSON.stringify(bookmarks));
    } catch {
      setStorageWarning("This browser refused to save review/bookmark state (storage full).");
    }
  }, [overlays, bookmarks]);

  const stats = useMemo(() => (bundle ? computeStats(bundle) : null), [bundle]);

  const setFilters = useCallback((next: Partial<LibraryFilters>) => {
    setFiltersState((prev) => {
      const merged = { ...prev, ...next };
      const onlyPageChanged = Object.keys(next).length === 1 && "page" in next;
      return onlyPageChanged ? merged : { ...merged, page: next.page ?? 1 };
    });
  }, []);

  const resetFilters = useCallback(() => setFiltersState(defaultFilters), []);

  const importBundleText = useCallback((text: string) => {
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch (e) {
      return { ok: false as const, errors: [`File is not valid JSON: ${(e as Error).message}`] };
    }
    const result = parseBundle(raw);
    if (!result.ok) return { ok: false as const, errors: result.errors };
    setBundle(result.bundle);
    setFiltersState(defaultFilters);
    try {
      window.localStorage.setItem(KEY_BUNDLE, JSON.stringify(result.bundle));
      setStorageWarning(null);
    } catch {
      setStorageWarning(
        "The bundle is loaded for this session but was too large for browser storage, so it will not survive a reload. Re-import the file after refreshing.",
      );
    }
    return { ok: true as const, warnings: result.warnings };
  }, []);

  const clearBundle = useCallback(() => {
    setBundle(null);
    setFiltersState(defaultFilters);
    try {
      window.localStorage.removeItem(KEY_BUNDLE);
    } catch {
      /* ignore */
    }
  }, []);

  const review = useCallback<AtlasState["review"]>((input) => {
    let outcome: { ok: true } | { ok: false; error: string } = { ok: true };
    setOverlays((prev) => {
      const result = applyReview(prev, input);
      if (!result.ok) {
        outcome = { ok: false, error: result.error };
        return prev;
      }
      setLastReview({ sourceId: input.sourceId, previous: result.previous });
      return result.overlays;
    });
    const check = applyReview(overlays, input);
    if (!check.ok) return { ok: false, error: check.error };
    return outcome;
  }, [overlays]);

  const undoLastReview = useCallback(() => {
    setLastReview((last) => {
      if (!last) return null;
      setOverlays((prev) => undoReview(prev, last.sourceId, last.previous));
      return null;
    });
  }, []);

  const toggleBookmark = useCallback((sourceId: string) => {
    let nowBookmarked = false;
    setBookmarks((prev) => {
      const next = { ...prev };
      if (next[sourceId]) {
        delete next[sourceId];
        nowBookmarked = false;
      } else {
        next[sourceId] = true;
        nowBookmarked = true;
      }
      return next;
    });
    return !bookmarks[sourceId];
  }, [bookmarks]);

  const clearLocalState = useCallback(() => {
    setOverlays({});
    setBookmarks({});
    setLastReview(null);
  }, []);

  const value = useMemo<AtlasState>(
    () => ({
      ready,
      bundle,
      stats,
      storageWarning,
      overlays,
      bookmarks,
      filters,
      setFilters,
      resetFilters,
      importBundleText,
      clearBundle,
      review,
      lastReview,
      undoLastReview,
      toggleBookmark,
      clearLocalState,
    }),
    [
      ready,
      bundle,
      stats,
      storageWarning,
      overlays,
      bookmarks,
      filters,
      setFilters,
      resetFilters,
      importBundleText,
      clearBundle,
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
