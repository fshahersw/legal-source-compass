import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ReviewChecklist } from "./ReviewChecklist";
import type { ReviewFactor } from "@/lib/limitations/reviewInventory";
const factor: ReviewFactor = {
  id: "screen:test",
  kind: "screen",
  group: "screening",
  label: "Synthetic protection",
  text: "Test screening only; not a legal provision",
  citation: null,
  origins: ["screen:test"],
  ruleSourceIds: [],
  instructionAllowed: true,
};
describe("compact review controls", () => {
  it("offers literal search, unresolved filtering and guided next-item navigation", () => {
    const html = renderToStaticMarkup(
      createElement(ReviewChecklist, {
        state: "CA",
        factors: [factor],
        decisions: {},
        onChange: () => {},
      }),
    );
    expect(html).toContain("Search factors and citations");
    expect(html).toContain("Needs attention");
    expect(html).toContain("Next unresolved factor");
  });
  it("offers an optional explicit suspension cap without inventing one", () => {
    const html = renderToStaticMarkup(
      createElement(ReviewChecklist, {
        state: "CA",
        factors: [factor],
        decisions: {
          "screen:test": {
            status: "instruction",
            instruction: {
              id: "test",
              kind: "pause",
              startDate: "2024-03-01",
              resumeDate: "2024-06-01",
              authority: "Synthetic fixture",
              explanation: "Test assumption only",
              reviewer: "Test",
              legalEffectConfirmed: false,
              boundariesConfirmed: false,
              interactionsConfirmed: false,
            },
          },
        },
        onChange: () => {},
      }),
    );
    expect(html).toContain("This authority limits the excluded interval");
    expect(html).not.toContain("Maximum period");
  });
});
