import { describe, expect, it } from "vitest";
import type { ExpertRuling } from "@/lib/external/judgeRulings.functions";
import {
  CHART_MIN_N,
  RULINGS_CAPTION,
  SHARE_MIN_N,
  rulingsMode,
  rulingsPeriod,
  rulingsTitle,
  rulingsView,
} from "./judgeRulingsView";

const ruling = (i: number, over: Partial<ExpertRuling> = {}): ExpertRuling => ({
  id: `govinfo:doc${i}:1`,
  date: `202${i % 5}-03-0${(i % 8) + 1}`,
  courtId: "laed",
  docket: "2:21-cv-00561",
  caption: "Doe v. Example Corp.",
  expert: "Dr. A. Expert",
  movant: "defendant",
  movantPrinted: "Defendants",
  outcome: "denied",
  basis: "court+docket→assigned judge",
  sourceUrl: "https://www.govinfo.gov/app/details/USCOURTS-laed-2_21-cv-00561",
  ...over,
});

describe("rulingsMode", () => {
  it("draws a chart only from 5 rulings and shares only from 20", () => {
    expect(rulingsMode(0)).toBe("none");
    expect(rulingsMode(CHART_MIN_N - 1)).toBe("list");
    expect(rulingsMode(CHART_MIN_N)).toBe("counts");
    expect(rulingsMode(SHARE_MIN_N - 1)).toBe("counts");
    expect(rulingsMode(SHARE_MIN_N)).toBe("shares");
    expect(rulingsMode(Number.NaN)).toBe("none");
  });
});

describe("rulingsView", () => {
  it("splits by movant in a fixed order and keeps not-determined outcomes", () => {
    const rows = [
      ruling(1, { movant: "plaintiff", outcome: "granted" }),
      ruling(2, { movant: "defendant", outcome: "not_determined" }),
      ruling(3),
      ruling(4),
      ruling(5, { movant: "plaintiff", outcome: "granted_in_part" }),
    ];
    const v = rulingsView(rows);
    expect(v.n).toBe(5);
    expect(v.mode).toBe("counts");
    expect(v.subjects.map((s) => s.movant)).toEqual(["plaintiff", "defendant"]);
    expect(v.subjects[1]!.counts.not_determined).toBe(1);
    expect(v.subjects[1]!.counts.denied).toBe(2);
  });

  it("falls back to counts when one movant side has fewer than 20 rulings", () => {
    const many = Array.from({ length: 25 }, (_, i) => ruling(i));
    expect(rulingsView(many).mode).toBe("shares");
    const mixed = [...many, ruling(99, { movant: "plaintiff" })];
    expect(rulingsView(mixed).mode).toBe("counts");
  });

  it("titles what was recorded, never a rate or forecast", () => {
    const v = rulingsView([ruling(1, { date: "2021-01-05" }), ruling(2, { date: "2024-06-01" })]);
    expect(rulingsPeriod(v)).toBe("2021–2024");
    expect(rulingsTitle(v)).toBe("2 recorded expert-admissibility rulings, 2021–2024");
    expect(rulingsTitle(rulingsView([]))).toBe("No recorded expert-admissibility rulings");
    for (const text of [rulingsTitle(v), RULINGS_CAPTION])
      expect(text).not.toMatch(/\brate\b|likely|will (grant|deny|rule)|predict/i);
  });
});
