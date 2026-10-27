import { describe, expect, it } from "vitest";
import {
  alignWave,
  buildFilingWaves,
  cohortMedian,
  defaultSelection,
  fiscalYearOf,
  indexToPeak,
  parseMdlFyRow,
  partialFiscalYear,
  yearOneRatio,
  type MdlFyRow,
} from "./filingWaves";

// Shapes and figures as stored in fjc_civil_mdls (queried 2026-10-27).
const depo = {
  id: "mdl:3140",
  c: { cases: 6184, last_filed: "2026-06-30" },
  fy: [
    { fy: 2025, cases: 1285 },
    { fy: 2026, cases: 4899 },
  ],
  nos: [
    { nos: 367, cases: 6098 },
    { nos: 365, cases: 86 },
  ],
};
const talc = {
  id: "mdl:2738",
  c: { cases: 72892, last_filed: "2026-06-30" },
  fy: [
    { fy: 2015, cases: 1 },
    { fy: 2017, cases: 1369 },
    { fy: 2018, cases: 8353 },
    { fy: 2019, cases: 5152 },
  ],
  nos: [{ nos: 365, cases: 72000 }],
};
const securities = {
  id: "mdl:1000",
  c: { cases: 900, last_filed: "2020-01-02" },
  fy: [{ fy: 2019, cases: 900 }],
  nos: [{ nos: 850, cases: 900 }],
};

describe("parseMdlFyRow", () => {
  it("reads the MDL number, fiscal years and product-liability share", () => {
    const r = parseMdlFyRow(depo)!;
    expect(r.mdl).toBe(3140);
    expect(r.byFy).toEqual([
      { fy: 2025, cases: 1285 },
      { fy: 2026, cases: 4899 },
    ]);
    expect(r.productShare).toBe(1);
    expect(parseMdlFyRow(securities)!.productShare).toBe(0);
  });
  it("rejects records without an mdl id", () => {
    expect(parseMdlFyRow({ id: "x", c: {} })).toBeNull();
    expect(parseMdlFyRow(null)).toBeNull();
  });
  it("keeps the NOS share null when no mix is recorded", () => {
    expect(parseMdlFyRow({ ...depo, nos: [] })!.productShare).toBeNull();
  });
});

describe("fiscal years", () => {
  it("labels a fiscal year by its end and flags the one the file only partly covers", () => {
    expect(fiscalYearOf("2025-10-01")).toBe(2026);
    expect(fiscalYearOf("2026-06-30")).toBe(2026);
    expect(partialFiscalYear("2026-06-30")).toBe(2026);
    expect(partialFiscalYear("2025-09-30")).toBeNull();
    expect(partialFiscalYear(null)).toBeNull();
  });
});

describe("alignWave", () => {
  it("starts at the first year with 10+ filings and counts a gap year as a true zero", () => {
    const w = alignWave(parseMdlFyRow(talc)!, 2026, 2026)!;
    expect(w.startFy).toBe(2017); // the single FY2015 case does not set the start
    expect(w.points.slice(0, 3).map((p) => p.cases)).toEqual([1369, 8353, 5152]);
    expect(w.points.find((p) => p.fy === 2020)?.cases).toBe(0);
    expect(w.points.at(-1)).toMatchObject({ fy: 2026, partial: true });
    expect(w.peak).toEqual({ fy: 2018, cases: 8353 });
  });
  it("never takes the partial year as the peak", () => {
    const w = alignWave(parseMdlFyRow(depo)!, 2026, 2026)!;
    expect(w.points.map((p) => p.partial)).toEqual([false, true]);
    expect(w.peak).toEqual({ fy: 2025, cases: 1285 });
    expect(indexToPeak(w)[1]).toBeCloseTo((4899 / 1285) * 100);
    expect(yearOneRatio(w)).toBeNull(); // year 1 is partial
  });
});

describe("buildFilingWaves", () => {
  const rows = [depo, talc, securities].map((r) => parseMdlFyRow(r)!) as MdlFyRow[];
  const out = buildFilingWaves(rows);
  it("keeps product-liability MDLs only and flags FY2026", () => {
    expect(out.mdlsRead).toBe(3);
    expect(out.productMdls).toBe(2);
    expect(out.partialFy).toBe(2026);
    expect(out.waves.map((w) => w.mdl)).toEqual([3140, 2738]);
    expect(defaultSelection(out.waves, 1)).toEqual([3140]);
  });
  it("builds the cohort median from complete years only", () => {
    const med = cohortMedian(out.waves);
    expect(med[0]).toEqual({ offset: 0, median: (1285 + 1369) / 2, n: 2 });
    expect(med[1]).toEqual({ offset: 1, median: 8353, n: 1 }); // Depo-Provera year 1 is partial
  });
});
