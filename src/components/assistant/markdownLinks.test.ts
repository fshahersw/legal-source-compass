import { describe, expect, it } from "vitest";
import { safeHref } from "./markdownLinks";
import { suggestionsFor } from "./pageContext";

describe("assistant links", () => {
  it("allows in-app paths and http(s) only", () => {
    expect(safeHref("/records/recall_patterns/fda_food%3Aoverview")).toEqual({
      url: "/records/recall_patterns/fda_food%3Aoverview",
      internal: true,
    });
    expect(safeHref("https://www.fda.gov/")?.internal).toBe(false);
    expect(safeHref("javascript:alert(1)")).toBeNull();
    expect(safeHref("//evil.example/x")).toBeNull();
    expect(safeHref("data:text/html,x")).toBeNull();
  });

  it("suggests questions for the page in view", () => {
    expect(suggestionsFor("/law/monitoring")[0]).toMatch(/recall/i);
    expect(suggestionsFor("/courts/cand")[0]).toMatch(/court/i);
    expect(suggestionsFor("/anything").length).toBeGreaterThan(2);
  });
});
