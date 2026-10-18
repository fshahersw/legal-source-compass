import { describe, expect, it } from "vitest";
import type {
  ClbBench,
  ClbCitations,
  ClbCitedCourt,
  ClbDocketYear,
  ClbDockets,
  ClbOpinions,
  GlanceMeasure,
} from "@/lib/external/clbCourt.functions";
import {
  CITATION_AGE_DEFINITION,
  CITATION_LINK_DEFINITION,
  CITATION_NOT_QUALITY,
  NOT_RECORDED,
  ageBasisNote,
  ageYearsText,
  authorPctText,
  authorshipNote,
  benchPhrases,
  citationsSummary,
  citedCourtRows,
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
  noCourtsText,
  nosCoverage,
  opinionsSummary,
  rankText,
  rhoText,
  shareOf,
  shareText,
  shownCourtsNote,
  sourceMixLabel,
  tick,
  transcriptShare,
  typeRows,
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

describe("opinions on file and citations", () => {
  const opinions = (over: Partial<ClbOpinions> = {}): ClbOpinions => ({
    total: 230917,
    types: [],
    withAuthorPct: 0.3,
    perCuriam: 7171,
    ocrPct: 29.6,
    withJoinedByPct: 0,
    topAuthors: [{ personId: 1817, name: "Alex Kozinski", opinions: 103, record: null }],
    parentheticals: null,
    ...over,
  });
  const court = (over: Partial<ClbCitedCourt> = {}): ClbCitedCourt => ({
    courtId: "scotus",
    name: "Supreme Court of the United States",
    n: 534711,
    sharePct: 26.9,
    isSelf: false,
    link: "/courts/scotus",
    ...over,
  });

  it("turns labelled opinion types into bar rows without changing the stored shares", () => {
    const rows = typeRows([
      { value: "010combined", label: "Combined opinion", count: 148214, sharePct: 64.2 },
      { value: "070rehearing", label: "Rehearing", count: 184, sharePct: 0.1 },
    ]);
    expect(rows.map((r) => [r.key, r.label, r.count, r.sharePct, r.courtId])).toEqual([
      ["010combined", "Combined opinion", 148214, 64.2, undefined],
      ["070rehearing", "Rehearing", 184, 0.1, undefined],
    ]);
  });

  it("links a cited court's label only for a verified link, and never the profiled court itself", () => {
    const rows = citedCourtRows([
      court(),
      court({ courtId: "ca2", name: "Second Circuit", link: null }),
      court({ courtId: "ca9", name: "Ninth Circuit", isSelf: true, link: "/courts/ca9" }),
    ]);
    expect(rows.map((r) => r.courtId)).toEqual(["scotus", undefined, undefined]);
    expect(rows[2]?.label).toBe("Ninth Circuit (this court)");
    expect(rows[1]?.label).toBe("Second Circuit");
    expect(rows[0]).toMatchObject({ count: 534711, sharePct: 26.9, key: "scotus" });
  });

  it("writes a stored 0% author share beside listed authors as under 0.1%, never 0.0%", () => {
    expect(authorPctText(opinions({ withAuthorPct: 0 }))).toBe("<0.1%");
    expect(authorPctText(opinions({ withAuthorPct: 0, topAuthors: [] }))).toBe("0.0%");
    expect(authorPctText(opinions({ withAuthorPct: 33.5 }))).toBe("33.5%");
    expect(authorPctText(opinions({ withAuthorPct: null }))).toBe(NOT_RECORDED);
  });

  it("says what the author counts cover and calls them a floor when few opinions have an author", () => {
    expect(authorshipNote(opinions())).toBe(
      "Only 0.3% of the 230,917 opinions have a recorded author, so the author counts are a floor: they cover the opinions where CourtListener recorded an author and say nothing about who wrote the rest.",
    );
    expect(authorshipNote(opinions({ withAuthorPct: 93.1, total: 5000 }))).toBe(
      "93.1% of the 5,000 opinions have a recorded author; author counts cover those opinions only.",
    );
    expect(authorshipNote(opinions({ withAuthorPct: null }))).toContain(NOT_RECORDED);
    expect(authorshipNote(opinions({ withAuthorPct: 49.9 }))).toMatch(/^Only /);
    expect(authorshipNote(opinions({ withAuthorPct: 50 }))).not.toMatch(/^Only /);
  });

  it("summarises the opinion and citation sections from stored figures only", () => {
    expect(opinionsSummary(opinions())).toBe(
      "230,917 opinions · 0.3% with a recorded author · 7,171 per curiam",
    );
    expect(opinionsSummary(opinions({ withAuthorPct: null, perCuriam: null }))).toBe(
      "230,917 opinions",
    );
    const cit: ClbCitations = {
      made: 1987369,
      received: 2916836,
      madeTo: [],
      citedBy: [],
      selfCitationPct: 49.9,
      medianAgeYears: 8,
      p90AgeYears: 31.3,
      ageBasisLinks: 1983523,
    };
    expect(citationsSummary(cit)).toBe(
      "1,987,369 links made · 2,916,836 received · 49.9% to its own opinions",
    );
    expect(citationsSummary({ ...cit, made: null, selfCitationPct: null })).toBe(
      "2,916,836 received",
    );
  });

  it("writes citation ages in years with one decimal, and Not recorded when unknown", () => {
    expect(ageYearsText(8)).toBe("8.0 years");
    expect(ageYearsText(31.3)).toBe("31.3 years");
    expect(ageYearsText(null)).toBe(NOT_RECORDED);
    expect(ageYearsText(undefined)).toBe(NOT_RECORDED);
  });

  it("states the age definition and its link basis, or that the age is not recorded", () => {
    const note = ageBasisNote({ medianAgeYears: 8, ageBasisLinks: 1983523 });
    expect(note).toContain(CITATION_AGE_DEFINITION);
    expect(note).toContain("1,983,523 links");
    expect(note).toContain("not whether what they cite is still good law");
    expect(ageBasisNote({ medianAgeYears: null, ageBasisLinks: null })).toBe(
      `The age of cited opinions is ${NOT_RECORDED} for this court.`,
    );
    expect(CITATION_AGE_DEFINITION).toBe(
      "years between the cited opinion's filing and the citing opinion's",
    );
  });

  it("keeps the citation caveats: an extraction with a court on both sides, not a census or a quality measure", () => {
    expect(CITATION_LINK_DEFINITION).toContain("one row of CourtListener's citation map");
    expect(CITATION_LINK_DEFINITION).toContain("a court on both sides");
    expect(CITATION_LINK_DEFINITION).toContain("extraction from opinion text, not a census");
    expect(CITATION_NOT_QUALITY).toContain(
      "do not measure the quality, authority or current status",
    );
  });
});

describe("court lists and author coverage", () => {
  it("describes how much of the whole a court list covers from the stored link counts", () => {
    expect(shownCourtsNote([{ n: 600 }, { n: 300 }], 1000)).toBe(
      "the 2 largest courts, together 90.0% of the links",
    );
    expect(shownCourtsNote([{ n: 600 }], 1000)).toBe(
      "the largest court, together 60.0% of the links",
    );
    expect(shownCourtsNote([{ n: 2 }], 2)).toBe("the only court with links");
    expect(shownCourtsNote([{ n: 5 }, { n: 5 }], 10)).toBe("all 2 courts with links");
    expect(shownCourtsNote([], 10)).toBeUndefined();
    expect(shownCourtsNote([{ n: 1 }], null)).toBeUndefined();
    expect(shownCourtsNote([{ n: 1 }], 0)).toBeUndefined();
  });

  it("says what an empty court list means", () => {
    expect(noCourtsText(0)).toBe("No links are recorded in this direction.");
    expect(noCourtsText(null)).toBe(NOT_RECORDED);
    expect(noCourtsText(12)).toBe(`The courts behind these 12 links are ${NOT_RECORDED}.`);
  });

  it("says no author is recorded when the share is zero and none is listed", () => {
    const o = { total: 2367, withAuthorPct: 0, topAuthors: [] };
    expect(authorshipNote(o)).toBe(
      "None of the 2,367 opinions has a recorded author in the collection, so no author is listed.",
    );
    // a zero share beside listed authors is a rounded share, not "none"
    expect(
      authorshipNote({
        ...o,
        topAuthors: [{ personId: 1, name: "A", opinions: 3, record: null }],
      }),
    ).toMatch(/^Only <0\.1% of the 2,367 opinions have a recorded author/);
  });
});
