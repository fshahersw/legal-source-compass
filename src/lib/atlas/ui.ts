type MinimalStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

const STORAGE_KEY = "atlas:sidebar-collapsed";

/** Browser localStorage, or undefined when storage is unavailable (SSR, private mode). */
function defaultStorage(): MinimalStorage | undefined {
  try {
    if (typeof globalThis.localStorage !== "undefined") return globalThis.localStorage;
  } catch {
    // Access can throw in hardened environments — treat as unavailable.
  }
  return undefined;
}

export function getSidebarCollapsed(storage: MinimalStorage | undefined = defaultStorage()): boolean {
  try {
    return storage?.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function setSidebarCollapsed(collapsed: boolean, storage: MinimalStorage | undefined = defaultStorage()): void {
  try {
    if (!storage) return;
    if (collapsed) {
      storage.setItem(STORAGE_KEY, "1");
    } else {
      storage.removeItem(STORAGE_KEY);
    }
  } catch {
    // Storage unavailable (private mode, quota) — the choice just isn't remembered.
  }
}
