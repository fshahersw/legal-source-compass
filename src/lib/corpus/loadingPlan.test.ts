import { describe, expect, it } from "vitest";
import { needsCaseCatalog } from "./loadingPlan";
describe("state-first loading boundaries", () => {
  it.each([
    "/",
    "/places",
    "/places/NE",
    "/places/NE/31055",
    "/law",
    "/law/codes/NE",
    "/agencies",
    "/limitations",
    "/sources/library",
  ])("does not download the external litigation catalog for %s", (path) =>
    expect(needsCaseCatalog(path)).toBe(false),
  );
  it.each(["/matters", "/matters/cases", "/insights", "/overview", "/courts/ned", "/judges/123"])(
    "preserves the legacy catalog for direct route %s",
    (path) => expect(needsCaseCatalog(path)).toBe(true),
  );
});
