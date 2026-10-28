import { describe, expect, it } from "vitest";
import type { CaseloadYear, DistrictRow } from "@/lib/external/courtCaseload.functions";
import type { MdlRow } from "@/lib/external/mdlAnalytics.functions";
import {
  clearanceRate,
  completeYears,
  districtHealth,
  latestPair,
  largestMdls,
  massTortShare,
  mdlMovers,
  mdlNumberShare,
  median,
  pctChange,
  pendingYears,
  portfolioChange,
} from "./docketModel";

const year = (fy: number, over: Partial<CaseloadYear> = {}): CaseloadYear =>
  ({
    fy,
    partial: false,
    filings: 100,
    terminations: 90,
    pendingEnd: 300,
    medianDays: 200,
    classActionPct: null,
    proSePct: null,
    productPct: null,
    juryDemandedPct: null,
    settledPct: null,
    trialPct: null,
    withMdlNumber: 10,
    mdlTransferIn: null,
    mdlOriginating: null,
    ...over,
  }) as CaseloadYear;

const mdl = (n: number, over: Partial<MdlRow> = {}): MdlRow => ({
  mdl: n,
  title: `MDL ${n}`,
  type: null,
  massTort: true,
  status: "pending",
  district: null,
  judge: null,
  pending: 100,
  total: null,
  change1m: null,
  change3m: null,
  change12m: null,
  new12m: null,
  resolved12m: null,
  ageYears: null,
  growth: "",
  dateTransferred: null,
  dateClosed: null,
  rank: null,
  sharePct: null,
  series: [],
  ...over,
});

describe("docket model", () => {
  it("takes the median of finite values only", () => {
    expect(median([3, null, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([null, undefined])).toBeNull();
  });

  it("computes percent change and refuses a zero or missing base", () => {
    expect(pctChange(100, 110)).toBeCloseTo(10);
    expect(pctChange(0, 5)).toBeNull();
    expect(pctChange(null, 5)).toBeNull();
  });

  it("drops the partial year and sorts ascending", () => {
    const n = {
      latestFy: 2025,
      partialFy: 2026,
      years: [year(2026, { partial: true }), year(2024), year(2025)],
      window: null,
    } as never;
    expect(completeYears(n).map((y) => y.fy)).toEqual([2024, 2025]);
  });

  it("reads clearance only for matched counts", () => {
    expect(clearanceRate({ filings: 200, terminations: 150 })).toBe(75);
    expect(clearanceRate({ filings: null, terminations: 150 })).toBeNull();
    expect(clearanceRate({ filings: 0, terminations: 150 })).toBeNull();
    expect(mdlNumberShare({ filings: 200, withMdlNumber: 20 })).toBe(10);
  });

  it("pairs the latest year with the year before only when it exists", () => {
    expect(latestPair([year(2023), year(2025)])?.prior).toBeNull();
    expect(latestPair([year(2024), year(2025)])?.prior?.fy).toBe(2024);
    expect(latestPair([])).toBeNull();
  });

  it("computes pending years and district health", () => {
    expect(pendingYears({ pending: 300, terminations: 100 })).toBe(3);
    expect(pendingYears({ pending: 300, terminations: 0 })).toBeNull();
    const rows = districtHealth([
      { pending: 50, terminations: 25, filings: 50 } as unknown as DistrictRow,
    ]);
    expect(rows[0]!.clearance).toBe(50);
    expect(rows[0]!.pendingYears).toBe(2);
  });

  it("ranks movers and largest MDLs from pending rows with figures", () => {
    const rows = [
      mdl(1, { change12m: 500, pending: 900 }),
      mdl(2, { change12m: -300, pending: 400 }),
      mdl(3, { change12m: null, pending: 2000 }),
      mdl(4, { status: "terminated", change12m: 900, pending: 5000 }),
      mdl(5, { pending: null }),
    ];
    const m = mdlMovers(rows);
    expect(m.up.map((r) => r.mdl)).toEqual([1]);
    expect(m.down.map((r) => r.mdl)).toEqual([2]);
    expect(largestMdls(rows).map((r) => r.mdl)).toEqual([3, 1, 2]);
  });

  it("matches the exact calendar month a year earlier", () => {
    const overview = {
      portfolio: [
        { date: "2025-10-01", pending: 200, mdls: 10, mass_tort_pending: 150, mass_tort_mdls: 5 },
        { date: "2026-10-01", pending: 220, mdls: 11, mass_tort_pending: 170, mass_tort_mdls: 6 },
      ],
    };
    const c = portfolioChange(overview);
    expect(c?.prior?.date).toBe("2025-10-01");
    expect(massTortShare(c!.last)).toBeCloseTo((170 / 220) * 100);
    expect(portfolioChange({ portfolio: [overview.portfolio[1]!] })?.prior).toBeNull();
  });
});

describe("quoteText", () => {
  it("keeps the litigation paragraphs of an excerpt and never rewrites words", async () => {
    const { quoteText } = await import("@/components/companies/DefendantDossier");
    expect(
      quoteText(
        "JNJ44 ¶ New York Stock Exchange ¶ Plaintiffs filed claims in the MDL. ¶ Item 7.01",
      ),
    ).toBe("Plaintiffs filed claims in the MDL.");
    expect(quoteText("No paragraph marks here.")).toBe("No paragraph marks here.");
  });
});
