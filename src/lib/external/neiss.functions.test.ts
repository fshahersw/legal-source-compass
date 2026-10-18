import { describe, expect, it, vi } from "vitest";

vi.mock("./rest.server", () => ({ restGet: vi.fn() }));
vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => ({
    handler: (handler: unknown) => handler,
    inputValidator: () => ({ handler: (handler: unknown) => handler }),
  }),
}));

import {
  parseDesignBreak,
  parseFigure,
  parseNeissInjuries,
  parseNeissMeta,
  parseNeissNational,
  parseNeissProducts,
  parseNeissThemes,
  parseNeissYears,
  parseTopProducts,
} from "./neiss.functions";

// Values copied from the published rows (neiss_national_years series, neiss_product_estimates 1233 / 102 / 1807,
// neiss_narrative_themes battery_fire, neiss_injury_dimensions body_part:75 / disposition:0).
const RELIABLE = {
  year: 2025,
  estimate: 118369,
  cv: 0.1082,
  ci95: [93275, 143463],
  cases: 4087,
  reliable: true,
};
const UNSTABLE = {
  year: 2025,
  estimate: null,
  cv: null,
  ci95: null,
  cases: 1,
  reliable: false,
  reasons: ["estimate below 1,200", "fewer than 20 cases", "CV above 33%"],
};
const NO_CASES = {
  year: 2025,
  estimate: null,
  cv: null,
  ci95: null,
  cases: 0,
  reliable: false,
  reasons: ["no sample cases"],
};

describe("parseFigure", () => {
  it("shows a reliable estimate with its CV in percent and its 95% interval", () => {
    expect(parseFigure(RELIABLE)).toEqual({
      state: "estimate",
      estimate: 118369,
      cvPct: 10.82,
      ci95: [93275, 143463],
      cases: 4087,
    });
  });

  it("withholds an unstable estimate and keeps only the unweighted sample count and the reasons", () => {
    expect(parseFigure(UNSTABLE)).toEqual({
      state: "withheld",
      cases: 1,
      reasons: ["estimate below 1,200", "fewer than 20 cases", "CV above 33%"],
    });
  });

  it("distinguishes no sample case from a withheld estimate", () => {
    expect(parseFigure(NO_CASES)).toEqual({ state: "none" });
  });

  it("never turns an unreliable record that happens to carry numbers into an estimate", () => {
    expect(parseFigure({ ...RELIABLE, reliable: false, reasons: ["CV above 33%"] })).toEqual({
      state: "withheld",
      cases: 4087,
      reasons: ["CV above 33%"],
    });
  });

  it("drops a record marked reliable that lacks a number, and records without a reliability flag", () => {
    expect(parseFigure({ ...RELIABLE, cv: null })).toBeNull();
    expect(parseFigure({ ...RELIABLE, ci95: [5, 1] })).toBeNull();
    expect(parseFigure({ ...RELIABLE, reliable: undefined })).toBeNull();
    expect(parseFigure({ ...UNSTABLE, cases: null })).toBeNull();
    expect(parseFigure(null)).toBeNull();
  });
});

describe("parseDesignBreak", () => {
  const raw = {
    hospitals_2023: 78,
    hospitals_2024: 77,
    in_both_years: 68,
    changed_stratum: 19,
    strata_2023: { C: 6, L: 9, M: 10, S: 33, V: 20 },
    strata_2024: { C: 8, L: 10, M: 18, S: 31, V: 10 },
  };

  it("derives the break year from the two hospital-count keys", () => {
    const b = parseDesignBreak(raw, "Sample design break in 2024: …");
    expect(b?.year).toBe(2024);
    expect(b).toMatchObject({
      hospitalsBefore: 78,
      hospitalsAfter: 77,
      inBothYears: 68,
      changedStratum: 19,
      text: "Sample design break in 2024: …",
    });
    expect(b?.strataBefore["V"]).toBe(20);
    expect(b?.strataAfter["M"]).toBe(18);
  });

  it("is null when the dataset records no pair of years", () => {
    expect(parseDesignBreak({ in_both_years: 68 }, null)).toBeNull();
    expect(parseDesignBreak(null, null)).toBeNull();
    expect(parseDesignBreak({ hospitals_2024: 77 }, null)).toBeNull();
  });
});

describe("parseNeissYears and parseTopProducts", () => {
  const series = [
    {
      year: 2024,
      estimate: 15068979,
      cv: 0.0731,
      ci95: [12910850, 17227107],
      cases: 361672,
      hospitals: 77,
      admitted_share: { share: 0.107, cv: 0.0946, ci95: [0.08717, 0.12683], reliable: true },
      change_from_previous_year: {
        difference: 2328722,
        percent: 0.1828,
        exceeds_sampling_error: false,
      },
    },
    {
      year: 1997,
      estimate: 11100384,
      cv: 0.054,
      ci95: [9925253, 12275515],
      cases: 267573,
      hospitals: 101,
      change_from_previous_year: null,
    },
    { year: 2000, estimate: 1, cv: 0.1, ci95: null, cases: 5 },
    { year: "x", estimate: 1 },
  ];

  it("sorts by year, converts shares and changes to percent units and drops malformed years", () => {
    const years = parseNeissYears(series);
    expect(years.map((y) => y.year)).toEqual([1997, 2024]);
    expect(years[1]?.admittedPct?.pct).toBeCloseTo(10.7, 5);
    expect(years[1]?.change).toEqual({
      differenceFromPrevious: 2328722,
      pct: expect.closeTo(18.28, 5),
      exceedsSamplingError: false,
    });
    expect(years[0]?.change).toBeNull();
    expect(years[0]?.admittedPct).toBeNull();
  });

  it("keeps only reliable top products", () => {
    const top = parseTopProducts([
      {
        code: 1807,
        label: "Floors or flooring materials",
        estimate: 3079996,
        cv: 0.1306,
        ci95: [2291588, 3868405],
        cases: 70650,
        reliable: true,
        share: 0.18683,
      },
      { code: 1, label: "Unstable one", estimate: null, cv: null, reliable: false },
      { code: 2, label: "No reliability flag", estimate: 5, cv: 0.1 },
      { label: "No code", estimate: 5, cv: 0.1, reliable: true },
    ]);
    expect(top).toHaveLength(1);
    expect(top[0]).toMatchObject({
      code: "1807",
      cvPct: expect.closeTo(13.06, 5),
      sharePct: expect.closeTo(18.683, 5),
    });
  });
});

describe("parseNeissNational", () => {
  const meta = {
    design_break: "Sample design break in 2024: …",
    credit:
      "U.S. Consumer Product Safety Commission, NEISS public-use files; computed by this builder; not endorsed by CPSC",
    reliability_rule:
      "unstable when estimate < 1,200, or sample cases < 20, or CV > 33% (CPSC; estimate withheld)",
    source_urls: ["https://www.cpsc.gov/cgibin/NEISSQuery/home.aspx", "ftp://nope", 3],
  };
  const series = [
    {
      year: 2023,
      estimate: 12740256,
      cv: 0.0828,
      ci95: [10672770, 14807743],
      cases: 338262,
      hospitals: 78,
    },
    {
      year: 2024,
      estimate: 15068979,
      cv: 0.0731,
      ci95: [12910850, 17227107],
      cases: 361672,
      hospitals: 77,
    },
  ];
  const designBreak = {
    hospitals_2023: 78,
    hospitals_2024: 77,
    in_both_years: 68,
    changed_stratum: 19,
  };

  it("carries the design break, the reliability counts and the source links", () => {
    const n = parseNeissNational({
      series,
      designBreak,
      meta,
      topProducts: [],
      reliability: { reliable: 494, withheld: 279, noCases: 146 },
      total: 919,
    });
    expect(n?.latestYear).toBe(2024);
    expect(n?.designBreak?.year).toBe(2024);
    expect(n?.designBreak?.text).toContain("Sample design break in 2024");
    expect(n?.reliability).toEqual({ reliable: 494, withheld: 279, noCases: 146, total: 919 });
    expect(n?.sourceUrls).toEqual(["https://www.cpsc.gov/cgibin/NEISSQuery/home.aspx"]);
    expect(n?.reliabilityRule).toContain("CV > 33%");
  });

  it("leaves reliability counts unrecorded when any count is missing, and is null without years", () => {
    const n = parseNeissNational({
      series,
      designBreak,
      meta,
      topProducts: [],
      reliability: { reliable: 494, withheld: null, noCases: 146 },
      total: 919,
    });
    expect(n?.reliability).toBeNull();
    expect(
      parseNeissNational({
        series: [],
        designBreak,
        meta,
        topProducts: [],
        reliability: null,
        total: null,
      }),
    ).toBeNull();
  });

  it("reads the dataset meta", () => {
    expect(parseNeissMeta(meta).credit).toContain("not endorsed by CPSC");
    expect(parseNeissMeta(null).sourceUrls).toEqual([]);
  });
});

describe("parseNeissProducts", () => {
  const annual = (rows: [number, number | null][]) =>
    rows.map(([year, est]) =>
      est == null
        ? {
            year,
            estimate: null,
            cv: null,
            ci95: null,
            cases: 3,
            reliable: false,
            reasons: ["CV above 33%"],
          }
        : {
            year,
            estimate: est,
            cv: 0.1,
            ci95: [est * 0.8, est * 1.2],
            cases: 100,
            reliable: true,
          },
    );
  const cells = (code: number, product: string, latestYear = 2025) => ({
    code,
    product,
    latest_year: latestYear,
    first_year: 1997,
    last_year: 2025,
  });
  const lvp = { difference: 1223500, percent: 0.659, exceeds_sampling_error: true };
  const rows = [
    {
      id: "1807",
      cells: cells(1807, "Floors or flooring materials"),
      label: "Floors or flooring materials",
      status: "current",
      latest: { ...RELIABLE, estimate: 3079996 },
      pooled: RELIABLE,
      lvp,
    },
    {
      id: "5045",
      cells: cells(5045, "E-bikes"),
      label: "Electric power-assisted pedal bicycles",
      status: "current",
      latest: RELIABLE,
      pooled: RELIABLE,
      // the stored change is present but 2024 is unstable in the annual series
      lvp,
    },
    {
      id: "102",
      cells: cells(102, "Wringer washing machines"),
      label: "Wringer washing machines",
      status: "current",
      latest: UNSTABLE,
      pooled: UNSTABLE,
      lvp: null,
    },
    {
      id: "101",
      cells: cells(101, "Washers", 2025),
      label: "Washers",
      inUse: false,
      cmp: { deleted: true },
      latest: NO_CASES,
      pooled: null,
      lvp: null,
    },
    { id: "bad", cells: { code: 1 } },
  ];
  const annualRows = [
    {
      id: "1807",
      annual: annual([
        [2023, 1000000],
        [2024, 1856496],
        [2025, 3079996],
      ]),
    },
    {
      id: "5045",
      annual: annual([
        [2023, 50000],
        [2024, null],
        [2025, 102615],
      ]),
    },
  ];
  const data = parseNeissProducts({
    rows,
    annual: annualRows,
    designBreakYear: 2024,
    credit: "credit",
  });

  it("aligns reliable annual estimates to the years and leaves withheld years empty", () => {
    expect(data?.years).toEqual([2023, 2024, 2025]);
    expect(data?.rows.find((r) => r.code === "1807")?.spark).toEqual([1000000, 1856496, 3079996]);
    expect(data?.rows.find((r) => r.code === "5045")?.spark).toEqual([50000, null, 102615]);
    expect(data?.rows.find((r) => r.code === "102")?.spark).toEqual([null, null, null]);
  });

  it("keeps a change only when both years are reliable estimates", () => {
    expect(data?.rows.find((r) => r.code === "1807")?.change).toMatchObject({
      pct: expect.closeTo(65.9, 5),
      exceedsSamplingError: true,
    });
    // 2024 is withheld, so the stored change must not be shown
    expect(data?.rows.find((r) => r.code === "5045")?.change).toBeNull();
    expect(data?.rows.find((r) => r.code === "102")?.change).toBeNull();
  });

  it("shows a withheld product as the unweighted sample count only", () => {
    const r = data?.rows.find((x) => x.code === "102");
    expect(r?.latest).toEqual({
      state: "withheld",
      cases: 1,
      reasons: ["estimate below 1,200", "fewer than 20 cases", "CV above 33%"],
    });
    expect(r?.pooled?.state).toBe("withheld");
  });

  it("marks retired codes and keeps products without a sample case", () => {
    const r = data?.rows.find((x) => x.code === "101");
    expect(r?.status).toBe("retired");
    expect(r?.latest).toEqual({ state: "none" });
    expect(data?.rows).toHaveLength(4);
  });

  it("carries the design-break year and latest year, and is null without rows", () => {
    expect(data?.designBreakYear).toBe(2024);
    expect(data?.latestYear).toBe(2025);
    expect(
      parseNeissProducts({ rows: [], annual: [], designBreakYear: null, credit: null }),
    ).toBeNull();
  });
});

describe("parseNeissThemes", () => {
  const theme = (id: string, latest: object) => ({
    id,
    cells: { theme: id },
    label: id === "battery_fire" ? "Battery fire, explosion or overheating" : "Electric scooters",
    description: "Narrative names…",
    annual: [
      { ...NO_CASES, year: 2019, cases: 4 },
      { ...latest, year: 2025 },
    ],
    pooled: { estimate: 4665, cv: 0.2332, ci95: [2533, 6798], cases: 108, reliable: true },
    comparable: 2019,
    related: [{ code: 5022, label: "Scooters, powered", in_dataset: true }, { label: "no code" }],
  });

  it("shows a theme whose latest year is unstable as withheld while keeping the pooled estimate", () => {
    const t = parseNeissThemes({
      rows: [
        theme("battery_fire", { ...UNSTABLE, cases: 22, reasons: ["estimate below 1,200"] }),
        theme("escooter", RELIABLE),
      ],
      meta: { classification: "A narrative keyword theme is …", credit: "c" },
    });
    const battery = t?.themes.find((x) => x.id === "battery_fire");
    expect(battery?.latest).toEqual({
      state: "withheld",
      cases: 22,
      reasons: ["estimate below 1,200"],
    });
    expect(battery?.pooled?.state).toBe("estimate");
    expect(battery?.comparableFrom).toBe(2019);
    expect(battery?.years).toEqual([2019, 2025]);
    expect(battery?.relatedCodes).toEqual([{ code: "5022", label: "Scooters, powered" }]);
    expect(t?.classification).toContain("keyword theme");
  });

  it("is null without themes", () => {
    expect(parseNeissThemes({ rows: [], meta: null })).toBeNull();
  });
});

describe("parseNeissInjuries", () => {
  const pooled = {
    total: {
      estimate: 12259219,
      cv: 0.0991,
      ci95: [9877233, 14641205],
      cases: 333755,
      reliable: true,
    },
    share_of_all: 0.17846,
    admitted_to_hospital: { share: 0.13235, cv: 0.0813, ci95: [0.10488, 0.15981], reliable: true },
  };
  const rows = [
    {
      id: "body_part:75",
      dimension: "body_part",
      code: 75,
      label: "Head",
      annual: [{ ...RELIABLE, year: 2025, estimate: 3061872 }],
      pooled,
      top: [{ code: 1807, label: "Floors", estimate: 3438730, cv: 0.14, reliable: true }],
    },
    {
      id: "disposition:0",
      dimension: "disposition",
      code: 0,
      label: "Not recorded (code 0 has no label in the CPSC data dictionary)",
      // the series stops in 1999: no sample case in the latest year
      annual: [{ ...UNSTABLE, year: 1999, cases: 2 }],
      pooled: null,
      top: [],
    },
    {
      id: "mystery:1",
      dimension: "mystery",
      code: 1,
      label: "Unknown dimension",
      annual: [],
      pooled: null,
    },
  ];
  const data = parseNeissInjuries({ rows, meta: { credit: "c" } });

  it("anchors every value to the latest year instead of borrowing an older year", () => {
    expect(data?.latestYear).toBe(2025);
    expect(data?.rows.find((r) => r.id === "disposition:0")?.latest).toEqual({ state: "none" });
    expect(data?.rows.find((r) => r.id === "body_part:75")?.latest?.state).toBe("estimate");
  });

  it("converts the pooled shares to percent and marks the disposition share not applicable", () => {
    const head = data?.rows.find((r) => r.id === "body_part:75");
    expect(head?.pooledSharePct).toBeCloseTo(17.846, 5);
    expect(head?.admittedPct).toMatchObject({ pct: expect.closeTo(13.235, 5) });
    expect(data?.rows.find((r) => r.id === "disposition:0")?.admittedPct).toBe("na");
    expect(head?.topProducts).toHaveLength(1);
  });

  it("drops values of an unknown dimension", () => {
    expect(data?.rows.map((r) => r.id)).toEqual(["body_part:75", "disposition:0"]);
    expect(parseNeissInjuries({ rows: [], meta: null })).toBeNull();
  });
});
