import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { getSidebarCollapsed, setSidebarCollapsed } from "./ui";

describe("sidebar persistence", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    window.localStorage.clear();
  });

  it("defaults to expanded when nothing is stored", () => {
    expect(getSidebarCollapsed()).toBe(false);
  });

  it("remembers a collapsed choice", () => {
    setSidebarCollapsed(true);
    expect(getSidebarCollapsed()).toBe(true);
    expect(window.localStorage.getItem("atlas:sidebar-collapsed")).toBe("1");
  });

  it("clears the flag when expanded again", () => {
    setSidebarCollapsed(true);
    setSidebarCollapsed(false);
    expect(getSidebarCollapsed()).toBe(false);
    expect(window.localStorage.getItem("atlas:sidebar-collapsed")).toBeNull();
  });
});
