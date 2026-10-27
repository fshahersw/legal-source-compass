import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ExpertRuling } from "@/lib/external/judgeRulings.functions";
import { JudgeExpertRulingsCard } from "./JudgeExpertRulingsCard";

const ruling = (i: number, movant: ExpertRuling["movant"] = "defendant"): ExpertRuling => ({
  id: `r${i}`,
  date: "2024-01-0" + ((i % 9) + 1),
  courtId: "ohsd",
  docket: "2:18-md-02846",
  caption: "In re Davol",
  expert: null,
  movant,
  movantPrinted: null,
  outcome: i % 2 ? "denied" : "not_determined",
  basis: null,
  sourceUrl: null,
});
const render = (rulings: ExpertRuling[] | null) =>
  renderToStaticMarkup(
    createElement(JudgeExpertRulingsCard, {
      data: rulings ? { label: "Judge expert rulings", rulings, precision: null } : null,
    }),
  );

describe("JudgeExpertRulingsCard", () => {
  it("renders nothing while the dataset is absent or the judge has no ruling", () => {
    expect(render(null)).toBe("");
    expect(render([])).toBe("");
  });

  it("shows counts, not shares, below 20 rulings and keeps Not determined", () => {
    const html = render(Array.from({ length: 6 }, (_, i) => ruling(i)));
    expect(html).toContain("6 recorded expert-admissibility rulings");
    expect(html).toContain("Not determined");
    // visible text only (styles carry widths in %)
    expect(html.replace(/<[^>]*>/g, " ")).not.toMatch(/\d+%/);
  });
});
