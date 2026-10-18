import { describe, expect, it } from "vitest";
import type {
  BenchCourt,
  CivilCaseload,
  CivilYear,
  CourtListenerState,
  StateCourtData,
} from "@/lib/external/stateCourtData.functions";
import {
  civilChange,
  civilPoints,
  courtTakeaways,
  courtsPlural,
  daysText,
  docketSplit,
  lastTwo,
  percentText,
  snapshotThrough,
  yearsText,
} from "./courtDataView";

const cy = (fy: number, over: Partial<CivilYear> = {}): CivilYear => ({
  fy,
  filings: 1000,
  terminations: 900,
  pending: 500,
  medianDays: 200,
  ...over,
});
const civil = (over: Partial<CivilCaseload> = {}): CivilCaseload => ({
  recordId: "CA",
  sourceUrl: null,
  latestFy: 2025,
  districts: ["cacd", "caed", "cand", "casd"],
  series: [
    cy(2024, { filings: 32102, medianDays: 197 }),
    cy(2025, { filings: 37443, medianDays: 147 }),
  ],
  partialYear: cy(2026, { filings: 39926 }),
  mix: null,
  shares: { classActionPct: null, proSePct: null, productPct: null },
  ...over,
});
const cl = (over: Partial<CourtListenerState> = {}): CourtListenerState => ({
  recordId: "state:CA",
  sourceUrl: null,
  courts: 32,
  dockets: 6500483,
  clusters: 378666,
  civilDockets: 1020567,
  recapPct: 94.6,
  byGroup: [
    { label: "Federal", dockets: 6275150 },
    { label: "State", dockets: 225333 },
  ],
  topCourts: [],
  ...over,
});
const bench = (over: Partial<BenchCourt> = {}): BenchCourt => ({
  courtId: "cacd",
  name: "Superior Court of California, County of Los Angeles",
  level: "State trial",
  positions: 1394,
  persons: 1300,
  noEndRecorded: 456,
  womenPct: 42.2,
  medianYearsServed: 10.6,
  linked: false,
  ...over,
});
const data = (over: Partial<StateCourtData> = {}): StateCourtData => ({
  usps: "CA",
  civil: civil(),
  courtListener: cl(),
  courts: [],
  benches: { courts: 138, positions: 7613, noEndRecorded: 1668, rows: [bench()] },
  sources: {
    fjc: { source: null, snapshot: null, terms: null },
    courtListener: { snapshot: "2026-09-30", terms: null, caveats: [] },
  },
  unavailable: [],
  ...over,
});

describe("text helpers", () => {
  it("shows Not recorded for unknown values and units for known ones", () => {
    expect(percentText(94.6)).toBe("94.6%");
    expect(percentText(100)).toBe("100%");
    expect(percentText(null)).toBe("Not recorded");
    expect(daysText(147)).toBe("147 days");
    expect(daysText(null)).toBe("Not recorded");
    expect(yearsText(10.64)).toBe("10.6 yrs");
    expect(yearsText(null)).toBe("Not recorded");
    expect(courtsPlural(1)).toBe("1 federal district court");
    expect(courtsPlural(4)).toBe("4 federal district courts");
  });

  it("reads the date a snapshot's filings run through, and nothing when it names none", () => {
    expect(
      snapshotThrough(
        "cv88on.zip, last modified 2026-08-26 on fjc.gov; filing dates through 2026-06-30",
      ),
    ).toBe("2026-06-30");
    expect(snapshotThrough("2026-09-30")).toBeNull();
    expect(snapshotThrough(null)).toBeNull();
  });
});

describe("civil caseload helpers", () => {
  it("compares the latest complete year with the one before it and ignores the partial year", () => {
    const c = civil();
    expect(lastTwo(c)?.last.fy).toBe(2025);
    expect(lastTwo(c)?.previous?.fy).toBe(2024);
    const change = civilChange(c, "filings")!;
    expect(change.previousFy).toBe(2024);
    expect(change.pct).toBeCloseTo(16.64, 1);
  });

  it("gives no change when the prior year is not loaded or its count is unknown", () => {
    expect(civilChange(civil({ series: [cy(2025)] }), "filings")).toBeNull();
    expect(
      civilChange(civil({ series: [cy(2024, { filings: null }), cy(2025)] }), "filings"),
    ).toBeNull();
    expect(
      civilChange(civil({ series: [cy(2024, { filings: 0 }), cy(2025)] }), "filings"),
    ).toBeNull();
  });

  it("charts a second series and leaves a missing value as a gap, not a zero", () => {
    const pts = civilPoints([cy(2024), cy(2025, { medianDays: null })], "medianDays");
    expect(pts.map((p) => p.y)).toEqual([200, null]);
    const two = civilPoints([cy(2024)], "filings", "terminations");
    expect(two[0]).toMatchObject({ x: 2024, label: "2024", y: 1000, y2: 900 });
  });
});

describe("docketSplit", () => {
  it("gives each group its share of the state's dockets and skips empty groups", () => {
    const split = docketSplit(cl({ byGroup: [...cl().byGroup, { label: "Other", dockets: 0 }] }));
    expect(split.map((s) => s.label)).toEqual(["Federal", "State"]);
    expect(split[0]!.sharePct).toBeCloseTo(96.53, 1);
  });

  it("returns nothing when the docket total is zero", () => {
    expect(docketSplit(cl({ dockets: 0 }))).toEqual([]);
  });
});

describe("courtTakeaways", () => {
  it("builds four takeaways that name their dataset and say collection, not court totals", () => {
    const items = courtTakeaways(data());
    expect(items.map((i) => i.id)).toEqual(["filings", "median", "dockets", "bench"]);
    expect(items[0]!.figure).toBe("37,443");
    expect(items[0]!.text).toContain("4 federal district courts");
    expect(items[0]!.text).toContain("+16.6% from FY2024");
    expect(items[0]!.text).toContain("FY2026 is partial and is not compared");
    expect(items[1]!.figure).toBe("147 days");
    expect(items[1]!.text).toContain("against 197 days in FY2024");
    expect(items[2]!.figure).toBe("6.5M");
    expect(items[2]!.text).toContain("97% in federal courts");
    expect(items[2]!.text).toContain("a collection, not complete court totals");
    expect(items[3]!.text).toContain("not a count of sitting judges");
  });

  it("leaves out a takeaway whose rows did not load", () => {
    const items = courtTakeaways(data({ civil: null, benches: null }));
    expect(items.map((i) => i.id)).toEqual([]);
    const some = courtTakeaways(data({ benches: null }));
    expect(some.map((i) => i.id)).toEqual(["filings", "median", "dockets"]);
  });

  it("does not compare to a prior year that is not loaded and skips an unpublished median", () => {
    const items = courtTakeaways(
      data({ civil: civil({ series: [cy(2025, { medianDays: null })], partialYear: null }) }),
    );
    expect(items.map((i) => i.id)).toEqual(["filings", "dockets", "bench"]);
    expect(items[0]!.text).not.toContain("from FY");
    expect(items[0]!.text).not.toContain("partial");
  });
});
