import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
const read = (file: string) => readFileSync(new URL(file, import.meta.url), "utf8");
describe("reader-first legal tools", () => {
  it("keeps JSON exports out of the primary calculator controls", () => {
    const text = read("./ReviewedCalculator.tsx");
    expect(text).not.toContain("Export full assessment");
    expect(text).not.toContain("Export review");
    expect(text).toContain("Print assessment");
    expect(text).toContain(
      "assessDeadline(snapshot, input, currentReview, { sourceRefreshFailed })",
    );
  });
  it("does not show bulk technical exports while browsing a state's authorities", () => {
    expect(read("./LimitationsWorkbench.tsx")).not.toContain("Export coverage");
    expect(read("./StateStatutePanel.tsx")).not.toContain("Export this state");
  });
});
