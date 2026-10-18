import { describe, expect, it } from "vitest";
import type {
  ClbBench,
  ClbDocketYear,
  ClbDockets,
  GlanceMeasure,
} from "@/lib/external/clbCourt.functions";
import {
  NOT_RECORDED,
  benchPhrases,
  docketRange,
  docketYearRows,
  durationBar,
  fmtDec,
  fmtInt,
  fmtPct,
  glanceFiscalYear,
  isPartialYear,
  lastVoteYear,
  measureValue,
  nosCoverage,
  rankText,
  rhoText,
  shareOf,
  shareText,
  sourceMixLabel,
  tick,
  transcriptShare,
  voteDecades,
} from "./clbFormat";

const year = (yr: number, dockets: number, civil = 0, criminal = 0): ClbDocketYear => ({
  yr,
  dockets,
  civil,
  criminal,
  recap: dockets,
  terminated: 0,
});

describe("number formatting", () => {
  it("never turns a missing value into a number", () => {
    expect(fmtInt(null)).toBe(NOT_RECORDED);
    expect(fmtInt(undefined)).toBe(NOT_RECORDED);
    expect(fmtInt(Number.NaN)).toBe(NOT_RECORDED);
    expect(fmtPct(null)).toBe(NOT_RECORDED);
    expect(fmtDec(null)).toBe(NOT_RECORDED);
    expect(fmtInt(416771)).toBe("416,771");
    expect(fmtPct(86.94)).toBe("86.9%");
    expect(fmtInt(0)).toBe("0");
  });

  it("never shows a positive share as zero", () => {
    expect(fmtPct(0.03)).toBe("<0.1%");
    expect(fmtPct(0.05)).toBe("0.1%");
    expect(fmtPct(0)).toBe("0.0%");
    expect(fmtPct(0.4, 0)).toBe("<1%");
    expect(fmtPct(0.004, 2)).toBe("<0.01%");
  });

  it("reads a stored zero share beside a positive count as under 0.1%", () => {
    expect(shareText({ count: 71, sharePct: 0 })).toBe("<0.1%");
    expect(shareText({ count: 0, sharePct: 0 })).toBe("0.0%");
    expect(shareText({ count: 9, sharePct: 4.2 })).toBe("4.2%");
    expect(shareText({ count: 9, sharePct: null })).toBe("Not recorded");
  });

  it("computes a share only from two known counts and a non-zero whole", () => {
    expect(shareOf(1, 4)).toBe(25);
    expect(shareOf(null, 4)).toBeNull();
    expect(shareOf(1, null)).toBeNull();
    expect(shareOf(1, 0)).toBeNull();
  });

  it("abbreviates axis ticks from 10,000", () => {
    expect(tick(950)).toBe("950");
    expect(tick(12_345)).toBe("12.3K");
    expect(tick(1_500_000)).toBe("1.5M");
  });
});

describe("dockets by filing year", () => {
  it("marks the year the data ends in, and no other", () => {
    expect(isPartialYear(2026, "2026-09-30")).toBe(true);
    expect(isPartialYear(2025, "2026-09-30")).toBe(false);
    expect(isPartialYear(2026, "2026-12-31")).toBe(false);
    expect(isPartialYear(2026, null)).toBe(false);
    expect(isPartialYear(2026, "not a date")).toBe(false);
  });

  it("splits civil-numbered, criminal-numbered and other, with other as the remainder", () => {
    const { rows, split, partialYear } = docketYearRows(
      [year(2025, 100, 60, 10), year(2026, 40, 20, 5)],
      "2026-09-30",
    );
    expect(split).toBe(true);
    expect(rows[0]).toMatchObject({
      civil: 60,
      criminal: 10,
      other: 30,
      label: "2025",
      partial: false,
    });
    expect(rows[1]).toMatchObject({
      civil: 20,
      criminal: 5,
      other: 15,
      label: "2026*",
      partial: true,
    });
    expect(partialYear).toBe(2026);
    for (const r of rows) expect(r.civil + r.criminal + r.other).toBe(r.dockets);
  });

  it("is one series when no year has a civil or criminal docket number", () => {
    const { rows, split, partialYear } = docketYearRows([year(1999, 7), year(2000, 9)], null);
    expect(split).toBe(false);
    expect(rows.map((r) => [r.civil, r.criminal, r.other])).toEqual([
      [0, 0, 7],
      [0, 0, 9],
    ]);
    expect(partialYear).toBeNull();
  });

  it("names the filing-year range from the stored dates", () => {
    const d = { firstFiled: "1956-12-22", lastFiled: "2026-09-30" } as ClbDockets;
    expect(docketRange(d)).toBe("1956–2026");
    expect(docketRange({ firstFiled: "2026-01-02", lastFiled: "2026-09-30" } as ClbDockets)).toBe(
      "2026",
    );
    expect(docketRange({ firstFiled: null, lastFiled: null } as ClbDockets)).toBeNull();
  });

  it("labels a source by its stored flags, or by its code when it has none", () => {
    expect(sourceMixLabel({ mask: 9, flags: ["RECAP", "FJC IDB"] })).toBe("RECAP + FJC IDB");
    expect(sourceMixLabel({ mask: 0, flags: ["Default"] })).toBe("Default");
    expect(sourceMixLabel({ mask: 64, flags: [] })).toBe("Source code 64");
  });

  it("states how many dockets carry a nature-of-suit entry", () => {
    expect(nosCoverage({ nosRecorded: 259230, total: 416771 } as ClbDockets).sharePct).toBeCloseTo(
      62.2,
      1,
    );
    expect(nosCoverage({ nosRecorded: null, total: 5 } as ClbDockets).sharePct).toBeNull();
  });
});

describe("duration bar", () => {
  it("places the box and the median on a 0 to p90 scale", () => {
    const bar = durationBar({ n: 224727, p25: 94, median: 225, p75: 511, p90: 974 })!;
    expect(bar.boxLeft).toBeCloseTo((94 / 974) * 100, 6);
    expect(bar.boxWidth).toBeCloseTo(((511 - 94) / 974) * 100, 6);
    expect(bar.medianAt).toBeCloseTo((225 / 974) * 100, 6);
    expect(durationBar({ n: 30, p25: 0, median: 0, p75: 0, p90: 0 })).toBeNull();
  });
});

describe("Supreme Court votes", () => {
  const y = (yr: number, withVotes: number, unanimous: number, fiveFour: number) => ({
    yr,
    clusters: withVotes + 5,
    scdb: withVotes,
    withVotes,
    unanimous,
    fiveFour,
  });

  it("groups the vote classes by decade and the three classes add up to the decisions with votes", () => {
    const rows = voteDecades([
      y(2018, 72, 30, 17),
      y(2019, 70, 26, 18),
      y(2020, 0, 0, 0),
      y(1792, 2, 1, 0),
    ]);
    expect(rows.map((r) => r.label)).toEqual(["1790s", "2010s"]);
    const d = rows[1]!;
    expect(d).toMatchObject({ withVotes: 142, unanimous: 56, fiveFour: 35, other: 51 });
    expect(d.unanimousPct + d.fiveFourPct + d.otherPct).toBeCloseTo(100, 9);
  });

  it("reports where the vote data stops", () => {
    expect(lastVoteYear([y(2018, 72, 30, 17), y(2019, 70, 26, 18), y(2020, 0, 0, 0)])).toBe(2019);
    expect(lastVoteYear([y(2020, 0, 0, 0)])).toBeNull();
    expect(voteDecades([])).toEqual([]);
  });
});

describe("oral arguments and bench", () => {
  it("computes the transcript share from stored counts only", () => {
    expect(transcriptShare({ total: 1030, withTranscript: 1001 } as never)).toBeCloseTo(97.18, 1);
    expect(transcriptShare({ total: 1030, withTranscript: null } as never)).toBeNull();
  });

  it("describes positions on record and says what each count covers", () => {
    const bench: ClbBench = {
      positions: 89,
      active: 38,
      persons: 88,
      womenActivePct: 42.1,
      medianTenureYearsEnded: 15.67,
    };
    const text = benchPhrases(bench).join(" | ");
    expect(text).toContain("89 judicial positions on record");
    expect(text).toContain("38 with no recorded end or death date");
    expect(text).toContain("held by 88 people");
    expect(text).toContain("42.1% women among those positions with a recorded gender");
    expect(text).toContain("median 15.7 years served in positions that have ended");
  });

  it("says Not recorded where a bench figure is missing", () => {
    const text = benchPhrases({
      positions: 1,
      active: null,
      persons: 1,
      womenActivePct: null,
      medianTenureYearsEnded: null,
    }).join(" | ");
    expect(text).toContain("1 judicial position on record");
    expect(text).toContain("held by 1 person");
    expect(text).toContain("Share of women: Not recorded");
    expect(text).toContain("Median years served: Not recorded");
    expect(text).not.toContain("with no recorded end or death date |");
  });
});

describe("district measures", () => {
  const m = (over: Partial<GlanceMeasure>): GlanceMeasure => ({
    key: "k",
    label: "L",
    unit: "cases",
    source: "FJC IDB",
    period: "FY2025",
    value: 10708,
    rank: { position: 6, of: 94 },
    ...over,
  });

  it("formats each unit and keeps the unit apart from the number", () => {
    expect(measureValue(m({}))).toEqual({ text: "10,708", unit: "cases" });
    expect(measureValue(m({ unit: "percent", value: 20.4 }))).toEqual({
      text: "20.4%",
      unit: null,
    });
    expect(measureValue(m({ unit: "percent", value: 0.46 }))).toEqual({
      text: "0.46%",
      unit: null,
    });
    expect(measureValue(m({ unit: "ratio", value: 1.004 }))).toEqual({ text: "1.00×", unit: null });
    expect(measureValue(m({ unit: "days", value: 200 }))).toEqual({ text: "200", unit: "days" });
    expect(measureValue(m({ unit: "months", value: 7.7 }))).toEqual({
      text: "7.7",
      unit: "months",
    });
    expect(measureValue(m({ unit: "per judgeship", value: 699 }))).toEqual({
      text: "699",
      unit: "per judgeship",
    });
  });

  it("uses the singular unit for one", () => {
    expect(measureValue(m({ value: 1 })).unit).toBe("case");
    expect(measureValue(m({ unit: "months", value: 1 })).unit).toBe("month");
    expect(measureValue(m({ unit: "judgeships", value: 1 })).unit).toBe("judgeship");
    expect(measureValue(m({ unit: "per judgeship", value: 1 })).unit).toBe("per judgeship");
  });

  it("shows a measure the record lacks as Not recorded, with no unit and no rank", () => {
    const missing = m({ value: null, rank: null });
    expect(measureValue(missing)).toEqual({ text: NOT_RECORDED, unit: null });
    expect(rankText(missing)).toBe("—");
  });

  it("ranks as position of count, and says so when a value has no rank", () => {
    expect(rankText(m({}))).toBe("6 of 94");
    expect(rankText(m({ rank: null }))).toBe("Not ranked");
  });

  it("takes the fiscal year from the stored periods", () => {
    expect(
      glanceFiscalYear([
        { period: "FY2025" },
        { period: "FY2025" },
        { period: "Sept 30, 2025" },
        { period: "snapshot 2026-09-30" },
        { period: "FY2024" },
      ]),
    ).toBe("FY2025");
    expect(glanceFiscalYear([{ period: "Sept 30, 2025" }])).toBeNull();
    expect(glanceFiscalYear([])).toBeNull();
  });

  it("writes a correlation with a true minus sign", () => {
    expect(rhoText(0.969)).toBe("0.97");
    expect(rhoText(-0.056)).toBe("−0.06");
    expect(rhoText(-0.001)).toBe("0.00");
    expect(rhoText(1)).toBe("1.00");
  });
});
