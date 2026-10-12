import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { LimitationsSnapshot } from "@/lib/limitations/types";
import { CalculatorCoverage } from "./CalculatorCoverage";

describe("calculator coverage disclosure", () => {
  it("counts supplied rules separately from jurisdictions and general claim gaps", () => {
    const snapshot = {
      ruleVersion: "test.1",
      rules: [{ jurisdiction: "CA" }, { jurisdiction: "CA" }, { jurisdiction: "NY" }],
      coverage: [
        {
          claimCoverage: [
            { status: "not_recorded" },
            { status: "baseline" },
            { status: "flagged" },
          ],
        },
      ],
    } as unknown as LimitationsSnapshot;
    const html = renderToStaticMarkup(
      createElement(CalculatorCoverage, { snapshot, onOpen: () => {} }),
    );
    expect(html).toContain("3 recorded rules");
    expect(html).toContain("2 jurisdictions with rules");
    expect(html).toContain(
      "1 listed state/claim combinations have no general rule recorded; 1 are flagged or research-only",
    );
    expect(html).toContain("not complete coverage");
    expect(html).toContain("test.1");
  });
  it("keeps missing coverage counts unknown", () => {
    const snapshot = {
      ruleVersion: "test.2",
      rules: [],
      coverage: [],
    } as unknown as LimitationsSnapshot;
    const html = renderToStaticMarkup(
      createElement(CalculatorCoverage, { snapshot, onOpen: () => {} }),
    );
    expect(html).toContain("coverage counts are not recorded");
    expect(html).not.toContain("0 listed state/claim combinations");
  });
});
