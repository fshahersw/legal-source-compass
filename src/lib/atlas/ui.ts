const STORAGE_KEY = "atlas:sidebar-collapsed";

export function getSidebarCollapsed(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function setSidebarCollapsed(collapsed: boolean): void {
  try {
    if (collapsed) {
      window.localStorage.setItem(STORAGE_KEY, "1");
    } else {
      window.localStorage.removeItem(STORAGE_KEY);
    }
  } catch {
    // Storage unavailable (private mode, quota) — the choice just isn't remembered.
  }
}
