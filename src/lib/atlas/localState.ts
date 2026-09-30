import type { ReviewOverlay } from "./types";

/** Small browser-local personal state (reviews + bookmarks) kept in localStorage. */
export const KEY_OVERLAYS = "lsa.review-overlays.v1";
export const KEY_BOOKMARKS = "lsa.bookmarks.v1";

export type KeyValueStorage = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

export type LocalState = {
  overlays: Record<string, ReviewOverlay>;
  bookmarks: Record<string, true>;
};

function readObject(storage: KeyValueStorage, key: string, errors: string[]): Record<string, never> {
  try {
    const raw = storage.getItem(key);
    if (!raw) return {};
    const v = JSON.parse(raw);
    if (v && typeof v === "object" && !Array.isArray(v)) return v;
    errors.push(`${key} did not contain an object; ignored (left in storage).`);
  } catch (e) {
    errors.push(`${key} could not be read: ${(e as Error).message}`);
  }
  return {};
}

/** Read-only: never writes, so startup can't overwrite stored state with defaults. */
export function loadLocalState(storage: KeyValueStorage): LocalState & { errors: string[] } {
  const errors: string[] = [];
  return {
    overlays: readObject(storage, KEY_OVERLAYS, errors),
    bookmarks: readObject(storage, KEY_BOOKMARKS, errors),
    errors,
  };
}

export function saveLocalState(
  storage: KeyValueStorage,
  state: LocalState,
): { ok: true } | { ok: false; error: string } {
  try {
    storage.setItem(KEY_OVERLAYS, JSON.stringify(state.overlays));
    storage.setItem(KEY_BOOKMARKS, JSON.stringify(state.bookmarks));
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message || String(e) };
  }
}
