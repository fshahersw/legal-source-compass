import { createElement } from "react";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it, expect } from "vitest";
import { GuidedCalculator } from "./GuidedCalculator";
import { validateLimitationsSnapshot } from "@/lib/limitations/validation";
const dir = process.env["LIM_BUNDLE_DIR"] ?? "private/data/limitations";
const load = (name: string) => JSON.parse(readFileSync(`${dir}/${name}.json`, "utf8"));
const snapshot = validateLimitationsSnapshot({
  rules: load("rules"),
  sources: load("sources"),
  coverage: load("coverage"),
  cases: load("case-references"),
});
const props = {
  snapshot,
  state: "CA",
  claim: "personal_injury" as const,
  onNavigate: () => {},
  renderEvidence: () => null,
  patternLabel: (s: string) => s,
};
describe("progressively disclosed calculator interface", () => {
  it("starts with case facts, not a wall of exceptions", () => {
    const html = renderToStaticMarkup(createElement(GuidedCalculator, props));
    expect(html).toContain("Case facts");
    expect(html).toContain("Exceptions");
    expect(html).toContain("Assessment");
    expect(html).toContain("Review exceptions");
    expect(html).not.toContain("Was the claimant a minor when the claim accrued?");
  });
  it("keeps claim selection labelled and blank states explicit", () => {
    const html = renderToStaticMarkup(
      createElement(GuidedCalculator, { ...props, state: "", claim: undefined }),
    );
    expect(html).toContain("Choose governing state");
    expect(html).toContain("Choose claim type");
    expect(html).toContain("Choose a state");
  });
  it("never brands a conditional result as a verified filing deadline", () => {
    const html = renderToStaticMarkup(createElement(GuidedCalculator, props));
    expect(html).toContain("Filing calendars and service rules");
    expect(html).not.toContain("100%");
    expect(html).not.toContain("All laws verified");
  });
});
