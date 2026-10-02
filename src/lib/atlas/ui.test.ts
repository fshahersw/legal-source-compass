import { describe, expect, it } from "vitest";

import { getSidebarCollapsed, setSidebarCollapsed } from "./ui";

function memoryStorage() {
  const map = new Map<string, string>();
  const throws = { current: false };
  return {
    throws,
    getItem: (key: string) => {
      if (throws.current) throw new Error("unavailable");
      return map.get(key) ?? null;
    },
    setItem: (key: string, value: string) => {
      if (throws.current) throw new Error("unavailable");
      map.set(key, value);
    },
    removeItem: (key: string) => {
      if (throws.current) throw new Error("unavailable");
      map.delete(key);
    },
  };
}

describe("sidebar persistence", () => {
  it("defaults to expanded when nothing is stored", () => {
    expect(getSidebarCollapsed(memoryStorage())).toBe(false);
  });

  it("defaults to expanded when storage is unavailable", () => {
    expect(getSidebarCollapsed(undefined)).toBe(false);
  });

  it("remembers a collapsed choice", () => {
    const storage = memoryStorage();
    setSidebarCollapsed(true, storage);
    expect(getSidebarCollapsed(storage)).toBe(true);
    expect(storage.getItem("atlas:sidebar-collapsed")).toBe("1");
  });

  it("clears the flag when expanded again", () => {
    const storage = memoryStorage();
    setSidebarCollapsed(true, storage);
    setSidebarCollapsed(false, storage);
    expect(getSidebarCollapsed(storage)).toBe(false);
    expect(storage.getItem("atlas:sidebar-collapsed")).toBeNull();
  });

  it("survives storage failures without throwing", () => {
    const storage = memoryStorage();
    storage.throws.current = true;
    expect(() => setSidebarCollapsed(true, storage)).not.toThrow();
    expect(getSidebarCollapsed(storage)).toBe(false);
  });
});
