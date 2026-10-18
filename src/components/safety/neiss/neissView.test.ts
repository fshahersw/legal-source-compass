import { describe, expect, it } from "vitest";
import type {
  NeissFigure,
  NeissInjuryRow,
  NeissNational,
  NeissProduct,
  NeissTheme,
  NeissYear,
} from "@/lib/external/neiss.functions";
import {
  changeNote,
  figureNote,
  figureText,
  filterProducts,
  modeOf,
  nationalRows,
  neissSignalTakeaways,
  neissTakeaways,
  NEISS_CREDIT,
  orderInjuryRows,
  productChange,
  productCounts,
  sameDesign,
  sortProducts,
  themeSpark,
  withheldReasons,
} from "./neissView";

const est = (estimate: number, cvPct = 10, cases = 100): NeissFigure => ({
  state: "estimate",
  estimate,
  cvPct,
  ci95: [estimate * 0.8, estimate * 1.2],
  cases,
});
const withheld = (cases: number, reasons: string[] = []): NeissFigure => ({
  state: "withheld",
  cases,
  reasons,
});
const none: NeissFigure = { state: "none" };

describe("figures", () => {
  it("shows an estimate, with its interval and CV underneath", () => {
    expect(figureText(est(118369))).toBe("118,369");
    expect(figureNote(est(1000, 12.5))).toBe("95% interval 800 to 1,200; CV 12.5%");
    expect(figureNote(est(1000, 12.5), { cv: false })).toBe("95% interval 800 to 1,200");
    expect(figureNote(est(1000, 12.5), { label: false })).toBe("800 to 1,200; CV 12.5%");
  });

  it("never shows an estimate for a withheld cell and labels its count as unweighted", () => {
    expect(figureText(withheld(22))).toBe("Withheld (unstable)");
    expect(figureNote(withheld(22))).toBe("22 sample cases (unweighted count, not an estimate)");
    expect(figureNote(withheld(1))).toBe("1 sample case (unweighted count, not an estimate)");
    expect(withheldReasons(withheld(1, ["estimate below 1,200", "CV above 33%"]))).toBe(
      "estimate below 1,200; CV above 33%",
    );
    expect(withheldReasons(est(5))).toBeNull();
  });

  it("separates no sample case from a withheld estimate, and unknown from both", () => {
    expect(figureText(none)).toBe("No sample cases");
    expect(figureNote(none)).toBeNull();
    expect(figureText(null)).toBe("Not recorded");
  });
});

const yearRow = (year: number, estimate: number, over: Partial<NeissYear> = {}): NeissYear => ({
  year,
  estimate,
  cvPct: 8,
  ci95: [estimate * 0.85, estimate * 1.15],
  cases: 300000 + year,
  hospitals: 77,
  admittedPct: null,
  change: { differenceFromPrevious: 1, pct: 5, exceedsSamplingError: false },
  ...over,
});
const YEARS: NeissYear[] = [
  yearRow(2022, 12662500),
  yearRow(2023, 12740256),
  yearRow(2024, 15068979, {
    change: { differenceFromPrevious: 2328722, pct: 18.28, exceedsSamplingError: false },
  }),
  yearRow(2025, 16485413, {
    cvPct: 7.94,
    admittedPct: { pct: 12.4, ciLow: 10.1, ciHigh: 14.8 },
    change: { differenceFromPrevious: 1416434, pct: 9.4, exceedsSamplingError: false },
  }),
];

describe("national chart rows and the 2024 design break", () => {
  const rows = nationalRows(YEARS, 2024);

  it("splits the line and the band at the break so the two designs never join", () => {
    expect(rows.map((r) => [r.year, r.preEstimate != null, r.postEstimate != null])).toEqual([
      [2022, true, false],
      [2023, true, false],
      [2024, false, true],
      [2025, false, true],
    ]);
    expect(rows[1]?.preBand).toEqual(YEARS[1]?.ci95);
    expect(rows[2]?.postBand).toEqual(YEARS[2]?.ci95);
    expect(rows[1]?.postBand).toBeNull();
    expect(rows.map((r) => r.afterBreak)).toEqual([false, false, true, true]);
  });

  it("draws one continuous series when no break is recorded", () => {
    const flat = nationalRows(YEARS, null);
    expect(flat.every((r) => r.preEstimate != null && r.postEstimate == null)).toBe(true);
  });

  it("does not compare 2024 with 2023", () => {
    expect(changeNote(YEARS[2]!, 2024)).toBe(
      "Not compared with 2023: the sample was re-stratified",
    );
    expect(changeNote(YEARS[3]!, 2024)).toBe("+9.4% on 2024, within the sampling error");
    expect(
      changeNote(
        {
          ...YEARS[3]!,
          change: { differenceFromPrevious: 5, pct: 30, exceedsSamplingError: true },
        },
        2024,
      ),
    ).toBe("+30.0% on 2024, exceeds the sampling error");
    expect(changeNote({ ...YEARS[0]!, change: null }, 2024)).toBe("No previous year");
  });

  it("knows when two years share a sample design", () => {
    expect(sameDesign(2025, 2024, 2024)).toBe(true);
    expect(sameDesign(2023, 2022, 2024)).toBe(true);
    expect(sameDesign(2024, 2023, 2024)).toBe(false);
    expect(sameDesign(2025, 2023, 2024)).toBe(false);
    expect(sameDesign(2025, 2023, null)).toBe(true);
  });
});

describe("neissTakeaways", () => {
  const national: NeissNational = {
    years: YEARS,
    latestYear: 2025,
    designBreak: {
      year: 2024,
      hospitalsBefore: 78,
      hospitalsAfter: 77,
      inBothYears: 68,
      changedStratum: 19,
      strataBefore: {},
      strataAfter: {},
      text: null,
    },
    topProducts: [
      {
        code: "1807",
        label: "Floors or flooring materials",
        estimate: 3079996,
        cvPct: 13.06,
        ci95: null,
        cases: 70650,
        sharePct: 18.683,
      },
    ],
    reliability: { reliable: 494, withheld: 279, noCases: 146, total: 919 },
    credit: null,
    caveats: null,
    reliabilityRule: null,
    sourceUrls: [],
  };
  const byId = new Map(neissTakeaways(national).map((t) => [t.id, t]));

  it("states the national figure as an estimate with its interval, not a case count", () => {
    expect(byId.get("national")?.figure).toBe("16.5M");
    expect(byId.get("national")?.text).toContain("weighted national estimate");
    expect(byId.get("national")?.text).toContain("95% interval 14M to 19M");
    expect(byId.get("national")?.text).toContain("Not a count of cases or people");
  });

  it("compares the latest year with the year before only inside one sample design", () => {
    expect(byId.get("latest-change")?.figure).toBe("+9.4%");
    expect(byId.get("latest-change")?.text).toContain("within the sampling error");
    expect(byId.get("latest-change")?.text).toContain("2024 sample design");
    const crossing = neissTakeaways({ ...national, years: YEARS.slice(0, 3), latestYear: 2024 });
    expect(crossing.find((t) => t.id === "latest-change")).toBeUndefined();
  });

  it("explains the design break instead of calling 2023 to 2024 a trend", () => {
    expect(byId.get("design-break")?.figure).toBe("19 of 68");
    expect(byId.get("design-break")?.text).toContain("12.7M to 15.1M is not a trend");
    expect(byId.get("design-break")?.text).toContain("mix two designs");
  });

  it("warns that product estimates overlap and counts the reliable codes", () => {
    expect(byId.get("top-product")?.text).toContain("cannot be added");
    expect(byId.get("reliability")?.figure).toBe("494 of 919");
    expect(byId.get("reliability")?.text).toContain("279 are withheld as unstable");
  });
});

const product = (
  code: string,
  label: string,
  latest: NeissFigure | null,
  over: Partial<NeissProduct> = {},
): NeissProduct => ({
  code,
  label,
  status: "current",
  latest,
  pooled: null,
  change: null,
  spark: [],
  firstYear: 1997,
  lastYear: 2025,
  ...over,
});
const flagged = { differenceFromPrevious: 1223500, pct: 65.9, exceedsSamplingError: true };
const within = { differenceFromPrevious: 190, pct: 0.16, exceedsSamplingError: false };
const PRODUCTS = [
  product("1807", "Floors or flooring materials", est(3079996), {
    change: flagged,
    spark: [1856496, 3079996],
  }),
  product("1233", "Trampolines", est(118369, 10.8), {
    change: within,
    pooled: est(588266),
    spark: [111212, 118179],
  }),
  product("102", "Wringer washing machines", withheld(1)),
  product("114", "Rare thing", withheld(15)),
  product("101", "Washers", none, { status: "retired" }),
  product("897", "Power grinders", est(18792, 20), {
    change: { differenceFromPrevious: 8616, pct: 84.7, exceedsSamplingError: true },
  }),
];

describe("product signal table helpers", () => {
  it("groups products by the status of their latest estimate", () => {
    expect(PRODUCTS.map(modeOf)).toEqual([
      "reliable",
      "reliable",
      "withheld",
      "withheld",
      "none",
      "reliable",
    ]);
    expect(productCounts(PRODUCTS)).toEqual({
      reliable: 3,
      withheld: 2,
      none: 1,
      flagged: 2,
      retired: 1,
    });
  });

  it("filters by status, flagged changes and every word of the query", () => {
    const base = { mode: "reliable" as const, flaggedOnly: false, query: "" };
    expect(filterProducts(PRODUCTS, base).map((p) => p.code)).toEqual(["1807", "1233", "897"]);
    expect(filterProducts(PRODUCTS, { ...base, flaggedOnly: true }).map((p) => p.code)).toEqual([
      "1807",
      "897",
    ]);
    expect(filterProducts(PRODUCTS, { ...base, query: "tramp" }).map((p) => p.code)).toEqual([
      "1233",
    ]);
    expect(filterProducts(PRODUCTS, { ...base, query: "1807" }).map((p) => p.code)).toEqual([
      "1807",
    ]);
    expect(filterProducts(PRODUCTS, { ...base, mode: "withheld" }).map((p) => p.code)).toEqual([
      "102",
      "114",
    ]);
  });

  it("sorts by estimate, by change (unknown last) and orders withheld rows by sample count", () => {
    expect(
      sortProducts(PRODUCTS, "estimate", true)
        .map((p) => p.code)
        .slice(0, 3),
    ).toEqual(["1807", "1233", "897"]);
    expect(
      sortProducts(PRODUCTS, "change", true)
        .map((p) => p.code)
        .slice(0, 3),
    ).toEqual(["897", "1807", "1233"]);
    expect(
      sortProducts(PRODUCTS, "change", false)
        .map((p) => p.code)
        .slice(0, 3),
    ).toEqual(["1233", "1807", "897"]);
    const w = sortProducts(
      filterProducts(PRODUCTS, { mode: "withheld", flaggedOnly: false, query: "" }),
      "estimate",
      true,
    );
    expect(w.map((p) => p.code)).toEqual(["114", "102"]);
    expect(sortProducts(PRODUCTS, "name", false)[0]?.label).toBe("Floors or flooring materials");
  });

  it("flags a change only when it exceeds the sampling error", () => {
    expect(productChange(PRODUCTS[0]!)).toMatchObject({ text: "+65.9%", flagged: true });
    expect(productChange(PRODUCTS[1]!)).toMatchObject({
      text: "Within sampling error",
      flagged: false,
    });
    expect(productChange(PRODUCTS[2]!)).toMatchObject({ text: "Not compared", flagged: false });
    expect(productChange(PRODUCTS[0]!).title).toMatch(/1\.96 times its standard error/);
  });

  it("builds signal takeaways from the rows only", () => {
    const t = new Map(neissSignalTakeaways(PRODUCTS, 2025).map((x) => [x.id, x]));
    expect(t.get("flagged")?.figure).toBe("2 of 3");
    expect(t.get("largest-rise")?.figure).toBe("+84.7%");
    expect(t.get("largest-rise")?.text).toContain("Power grinders");
    expect(t.get("largest-fall")).toBeUndefined();
    expect(t.get("withheld")?.figure).toBe("2 of 6");
    expect(t.get("withheld")?.text).toContain("unweighted sample count");
    expect(neissSignalTakeaways([], 2025)).toEqual([]);
  });
});

describe("narrative themes", () => {
  const theme: NeissTheme = {
    id: "escooter",
    label: "Electric scooters",
    description: null,
    latest: est(151602),
    latestYear: 2025,
    pooled: null,
    comparableFrom: 2019,
    years: [2017, 2018, 2019, 2020],
    spark: [10, 20, 30, 40],
    relatedCodes: [],
  };

  it("leaves out years before narratives became comparable", () => {
    expect(themeSpark(theme)).toEqual([
      { value: null },
      { value: null },
      { value: 30 },
      { value: 40 },
    ]);
    expect(themeSpark({ ...theme, comparableFrom: null }).map((p) => p.value)).toEqual([
      10, 20, 30, 40,
    ]);
  });
});

describe("injury explorer ordering", () => {
  const row = (
    dimension: NeissInjuryRow["dimension"],
    code: string,
    label: string,
    pooled: NeissFigure | null,
  ): NeissInjuryRow => ({
    id: `${dimension}:${code}`,
    dimension,
    code,
    label,
    latest: null,
    latestYear: 2025,
    pooled,
    pooledSharePct: null,
    admittedPct: null,
    topProducts: [],
  });

  it("keeps months in calendar order and age groups in age order", () => {
    const months = orderInjuryRows([
      row("month", "10", "October", est(5)),
      row("month", "2", "February", est(9)),
      row("month", "1", "January", est(1)),
    ]);
    expect(months.map((r) => r.label)).toEqual(["January", "February", "October"]);
    const ages = orderInjuryRows([
      row("age_group", "65+", "65+", est(1)),
      row("age_group", "5-14", "5-14", est(1)),
      row("age_group", "Not recorded", "NR", null),
      row("age_group", "0-4", "0-4", est(1)),
    ]);
    expect(ages.map((r) => r.code)).toEqual(["0-4", "5-14", "65+", "Not recorded"]);
  });

  it("ranks other dimensions by the pooled estimate with withheld values last", () => {
    const parts = orderInjuryRows([
      row("body_part", "1", "Hand", est(100)),
      row("body_part", "2", "Unstable", withheld(3)),
      row("body_part", "3", "Head", est(900)),
      row("body_part", "4", "None", null),
    ]);
    expect(parts.map((r) => r.label)).toEqual(["Head", "Hand", "None", "Unstable"]);
  });
});

describe("credit", () => {
  it("names CPSC and says the analysis is not endorsed", () => {
    expect(NEISS_CREDIT).toBe(
      "U.S. Consumer Product Safety Commission NEISS; analysis by this project; not endorsed by CPSC",
    );
  });
});
