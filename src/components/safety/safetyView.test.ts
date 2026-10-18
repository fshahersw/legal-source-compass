import { describe, expect, it } from "vitest";
import { safetyViewOf } from "./safetyView";

describe("safetyViewOf", () => {
  it("names only the two data views and falls back to the overview for anything else", () => {
    expect(safetyViewOf("reports")).toBe("reports");
    expect(safetyViewOf("neiss")).toBe("neiss");
    expect(safetyViewOf("list")).toBe("overview");
    expect(safetyViewOf(undefined)).toBe("overview");
    expect(safetyViewOf(7)).toBe("overview");
    expect(safetyViewOf("REPORTS")).toBe("overview");
  });
});
