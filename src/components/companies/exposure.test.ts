import { describe, expect, it } from "vitest";
import type { CompanyMdl, CompanySummary, CoverageRow } from "./companyData";
import {
  accrualDumbbell,
  applyUiExposure,
  countsInUi,
  coverageGroup,
  coverageMap,
  coverageTotals,
  dataFlags,
  exposureSentence,
  reportAfterQuarter,
  reserveDocketSeries,
  sumSeries,
  uiExposure,
} from "./exposure";

const mdl = (p: Partial<CompanyMdl> & { mdl: number }): CompanyMdl => ({
  title: `IN RE: Litigation ${p.mdl}`,
  status: "pending",
  type: "Products Liability",
  pending: 1000,
  change12m: 10,
  tier: "A",
  role: "defendant",
  verifiedCount: 1,
  firstVerified: null,
  lastVerified: null,
  countsTowardExposure: true,
  district: null,
  judge: null,
  dismissed: false,
  review: false,
  titleTruncated: false,
  ...p,
});

describe("countsInUi and uiExposure", () => {
  it("never counts a tier C link, even when the stored record counts it", () => {
    // Clearwater Paper to MDL 2873: tier C, stored counts_toward_exposure=true, review=false
    expect(countsInUi(mdl({ mdl: 2873, tier: "C" }))).toBe(false);
    expect(countsInUi(mdl({ mdl: 2873, tier: "A" }))).toBe(true);
    expect(countsInUi(mdl({ mdl: 1, role: "unclear" }))).toBe(false);
    expect(countsInUi(mdl({ mdl: 1, review: true }))).toBe(false);
    expect(countsInUi(mdl({ mdl: 1, countsTowardExposure: false }))).toBe(false);
  });

  it("sums only counted MDLs (MDL-wide) and reports tier C separately", () => {
    const e = uiExposure([
      mdl({ mdl: 2873, pending: 15264, change12m: 1322, tier: "B" }),
      mdl({ mdl: 2846, pending: 23324, tier: "C" }),
      mdl({ mdl: 9, pending: 50, status: "terminated" }),
    ]);
    expect(e).toMatchObject({
      namedPendingMdls: 1,
      namedPendingActions: 15264,
      change12m: 1322,
      strongestTier: "B",
      tierCPendingMdls: 1,
      tierCPendingActions: 23324,
    });
    expect(exposureSentence(e)).toBe("Named in 1 pending MDL with 15,264 pending actions (MDL-wide)");
  });

  it("says when nothing is counted and tier C links need review", () => {
    const e = uiExposure([mdl({ mdl: 2846, tier: "C" })]);
    expect(e.namedPendingActions).toBeNull();
    expect(exposureSentence(e)).toBe("No counted pending MDL; 1 tier C link requires review");
  });
});

describe("applyUiExposure", () => {
  it("drops the stored share of all pending and docket flags when nothing counts", () => {
    const c = {
      profile: { cik: "0000000001", name: "X" },
      mdls: [mdl({ mdl: 2846, tier: "C" })],
      exposure: { sharePct: 4.3, pendingMdls: 1, pendingActions: 23324 },
      flags: ["multi_mdl", "accrual_heavy"],
    } as unknown as CompanySummary;
    const out = applyUiExposure(c);
    expect(out.exposure.sharePct).toBeNull();
    expect(out.exposure.pendingMdls).toBe(0);
    expect(out.exposure.pendingActions).toBeNull();
    expect(out.flags).toEqual(["accrual_heavy"]);
    expect(out.mdls[0]!.countsTowardExposure).toBe(false);
  });
});

describe("dataFlags", () => {
  it("flags stale XBRL (FY2023 or earlier), missing XBRL and co-registrant filers", () => {
    // EIDP: latest FY2016 while it files as a Corteva co-registrant (co_registrant_of empty in the record)
    expect(dataFlags({ latestFy: 2016, coRegistrantOf: [], hasFinancials: true }, ["Corteva, Inc."]).map((f) => f.id)).toEqual([
      "stale",
      "co_registrant",
    ]);
    expect(dataFlags({ latestFy: 2024, coRegistrantOf: [], hasFinancials: true })).toEqual([]);
    expect(dataFlags({ latestFy: 2023, coRegistrantOf: [], hasFinancials: true })[0]!.label).toBe(
      "Latest XBRL FY2023",
    );
    expect(dataFlags({ latestFy: null, coRegistrantOf: [], hasFinancials: false })[0]!.id).toBe("no_xbrl");
  });
});

describe("coverage map", () => {
  const co = (p: Partial<CoverageRow["companies"][number]>) => ({
    cik: "0000000001",
    name: "A",
    tier: "A" as const,
    role: "defendant" as const,
    counted: true,
    dismissed: false,
    review: false,
    ...p,
  });
  const row = (mdlNo: number, pending: number | null, companies: CoverageRow["companies"], extra: Partial<CoverageRow> = {}): CoverageRow => ({
    mdl: mdlNo,
    title: `IN RE: ${mdlNo}`,
    status: "pending",
    type: "Products Liability",
    pending,
    titleTruncated: false,
    companies,
    ...extra,
  });

  it("puts each MDL in the group of its strongest evidence", () => {
    expect(coverageGroup([])).toBe("none");
    expect(coverageGroup([co({ tier: "C" })])).toBe("c");
    expect(coverageGroup([co({ tier: "C" }), co({ tier: "B" })])).toBe("ab");
    expect(coverageGroup([co({ role: "unclear", counted: false })])).toBe("unclear");
  });

  it("counts each pending products-liability MDL once and partitions the actions exactly", () => {
    const { rows, noCount } = coverageMap(
      [
        row(2738, 69340, [co({ tier: "C" }), co({ tier: "A", role: "unclear", counted: false })]),
        row(2873, 15264, [co({}), co({ cik: "0000000002" })]),
        row(2873, 15264, [co({})]),
        row(3060, 12381, []),
        row(1, 5, [], { type: "Antitrust" }),
        row(2, null, []),
        row(3, 10, [], { status: "terminated" }),
      ],
      new Map([[3060, 1829]]),
    );
    expect(noCount).toBe(1);
    expect(rows.map((r) => [r.mdl, r.group])).toEqual([
      [2738, "c"],
      [2873, "ab"],
      [3060, "none"],
    ]);
    expect(rows.find((r) => r.mdl === 3060)!.change12m).toBe(1829);
    const t = coverageTotals(rows);
    expect(t.pending).toBe(69340 + 15264 + 12381);
    expect(Object.values(t.groups).reduce((a, g) => a + g.pending, 0)).toBe(t.pending);
  });
});

describe("reserve vs docket", () => {
  it("takes the JPML report in the first week after a quarter end, never a nearer guess", () => {
    const reports = new Map([
      ["2024-10-01", 100],
      ["2025-01-02", 120],
      ["2025-04-09", 999],
    ]);
    expect(reportAfterQuarter("2024-09-30", reports)).toBe(100);
    expect(reportAfterQuarter("2024-12-31", reports)).toBe(120);
    expect(reportAfterQuarter("2025-03-31", reports)).toBeNull();
  });

  it("aligns accrual balances and docket counts on quarter ends with gaps kept null", () => {
    const acc = [
      { end: "2024-09-30", value: 1.6e9, unit: "USD", concept: "LossContingencyAccrualAtCarryingValue" },
      { end: "2025-09-30", value: 1.8e9, unit: "USD", concept: "LossContingencyAccrualAtCarryingValue" },
    ];
    const series = [
      { date: "2024-10-01", pending: 521 },
      { date: "2025-01-02", pending: 891 },
      { date: "2025-10-01", pending: 1973 },
    ];
    const out = reserveDocketSeries(acc, series);
    const dates = out.series[0]!.points.map((p) => p.date);
    expect(dates[0]).toBe("2024-09-30");
    expect(dates.at(-1)).toBe("2025-09-30");
    expect(out.series[0]!.points.find((p) => p.date === "2024-12-31")!.value).toBeNull();
    expect(out.series[1]!.points.map((p) => p.value)).toEqual([521, 891, null, null, 1973]);
  });

  it("refuses an accrual that mixes XBRL concepts", () => {
    const out = reserveDocketSeries(
      [
        { end: "2024-09-30", value: 1, unit: "USD", concept: "A" },
        { end: "2024-12-31", value: 2, unit: "USD", concept: "B" },
      ],
      [{ date: "2024-10-01", pending: 1 }],
    );
    expect(out.series).toEqual([]);
  });

  it("sums link series by report date", () => {
    expect(
      sumSeries([
        [{ date: "2024-10-01", pending: 2 }],
        [
          { date: "2024-10-01", pending: 3 },
          { date: "2024-11-01", pending: 4 },
        ],
      ]),
    ).toEqual([
      { date: "2024-10-01", pending: 5 },
      { date: "2024-11-01", pending: 4 },
    ]);
  });
});

describe("accrualDumbbell", () => {
  it("keeps current filers with two consecutive fiscal years and leaves stale ones out", () => {
    const c = (cik: string, latestFy: number, series: { fy: number; pct: number }[]) =>
      ({
        profile: { cik, name: cik },
        latestFy,
        accrualCurrent: true,
        accrualPctSeries: series,
      }) as unknown as CompanySummary;
    const out = accrualDumbbell([
      c("bd", 2025, [
        { fy: 2024, pct: 7.1 },
        { fy: 2025, pct: 8.24 },
      ]),
      c("eidp", 2016, [
        { fy: 2015, pct: 1 },
        { fy: 2016, pct: 2 },
      ]),
      c("gap", 2025, [
        { fy: 2022, pct: 1 },
        { fy: 2025, pct: 2 },
      ]),
    ]);
    expect(out).toEqual([{ id: "bd", label: "bd", a: 7.1, b: 8.24, note: "FY2024 → FY2025" }]);
  });
});
