import { describe, expect, it } from "vitest";
import { researchNavigation, type ResearchNavigation } from "./researchNavigation";

describe("calculator evidence navigation", () => {
  it("keeps an intake mounted across sources and coverage without changing its route", () => {
    // The route may still be blank or name another state; intake dates never enter that route.
    const source: ResearchNavigation = { state: "CA", claim: "personal_injury", view: "sources" };
    const opened = researchNavigation(null, source, true);
    expect(opened.session?.state).toBe("CA");
    expect(opened.route).toBeNull();
    expect(opened.resetCalculator).toBe(false);
    const coverage = researchNavigation(opened.session, { ...source, view: "coverage" });
    const returned = researchNavigation(coverage.session, { ...source, view: "calculator" });
    expect(coverage.route).toBeNull();
    expect(returned.route).toBeNull();
    expect(returned.resetCalculator).toBe(false);
  });
  it("resets a genuinely different case even when its route equals the original URL", () => {
    const session: ResearchNavigation = { state: "TX", claim: "personal_injury", view: "sources" };
    const next: ResearchNavigation = { state: "CA", view: "calculator" };
    expect(researchNavigation(session, next)).toEqual({
      session: null,
      route: next,
      resetCalculator: true,
    });
  });
  it("does not reset when opening the same claim from its source panel", () => {
    const session: ResearchNavigation = { state: "CA", claim: "personal_injury", view: "sources" };
    expect(researchNavigation(session, { ...session, view: "calculator" }).resetCalculator).toBe(
      false,
    );
    expect(
      researchNavigation(session, { ...session, claim: "fraud", view: "calculator" })
        .resetCalculator,
    ).toBe(true);
  });
});
