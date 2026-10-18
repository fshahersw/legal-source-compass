import { describe, expect, it, vi } from "vitest";

vi.mock("./rest.server", () => ({ restGet: vi.fn() }));
vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => ({
    handler: (handler: unknown) => handler,
    inputValidator: () => ({ handler: (handler: unknown) => handler }),
  }),
}));

import {
  parseCategory,
  parseCompany,
  parseGrowth,
  parseGrowthRows,
  parseRecallCheck,
  parseSaferProductsCompanies,
  parseSaferProductsReports,
  parseSaferProductsSignals,
  parseSeverity,
  parseSpMeta,
  parseThemes,
  parseYearPoints,
} from "./saferProducts.functions";

// Values copied from the published rows (saferproducts-summary, sp-cat-personal-care, sp-type-278, sp-mfr-*, sp-xc-summary).
const SUMMARY = {
  reports: 70000,
  peak_year: { year: 2012, reports: 6713 },
  severity: {
    death: 355,
    injury: 22277,
    incident_no_injury: 41594,
    no_incident: 4054,
    unspecified: 1720,
  },
  age_bands: {
    under_1: 3057,
    "1_4": 5533,
    "5_12": 2952,
    "13_17": 1053,
    "18_64": 25132,
    "65_plus": 6068,
  },
  age_not_recorded: 26205,
  manufacturer_comment_rate_pct: 35.08,
  lag: { report_to_publication_days: { n: 70000, median: 25, p90: 60, within_30_days_pct: 64.21 } },
  latest_complete_year: { year: 2025, reports: 4415, yoy_pct: 9.17, change_vs_2019_pct: 45.81 },
  latest_partial_year: {
    year: 2026,
    reports: 6017,
    ytd: {
      through: "10-16",
      reports: 6017,
      prior_year_same_window: 3424,
      change_vs_prior_year_pct: 75.73,
      base_year_same_window: 2499,
      change_vs_2019_pct: 140.78,
      excluding_largest_company: {
        company: "Zuru Inc.",
        removed_reports: 669,
        reports: 5348,
        prior_year_same_window: 3421,
        change_vs_prior_year_pct: 56.33,
      },
    },
  },
  yearly_published: [
    { year: 2011, reports: 4540, partial: true, yoy_pct: null },
    { year: 2012, reports: 6713, partial: false, yoy_pct: 47.86 },
    { year: 2013, reports: 5696, partial: false, yoy_pct: -15.15 },
    { year: 2026, reports: 6017, partial: true, yoy_pct: 36.29 },
    { year: "bad", reports: 1 },
  ],
  yearly_reported: [
    { year: 2026, reports: 5533, partial: true },
    { year: 2025, reports: 4595, partial: false },
  ],
};
const META = {
  pw: { first: "2011-05-06", last: "2026-10-16" },
  rw: { first: "2011-03-11", last: "2026-09-28" },
  retrieved: "2026-10-18T15:14:34Z",
  caveats: ["Reports are unverified consumer submissions.", 7, ""],
};
const CATEGORY = {
  id: "sp-cat-personal-care",
  cells: {
    name: "Personal Care",
    reports: 1197,
    share_pct: 1.71,
    deaths: 0,
    injuries: 559,
    change_pct: 74.11,
    growth_rank: 1,
  },
  yearly: [
    { year: 2011, reports: 64, partial: true },
    { year: 2012, reports: 90, partial: false },
  ],
  growth: {
    recent_window: "2023–2025",
    recent_reports: 195,
    prior_window: "2020–2022",
    prior_reports: 112,
    change_pct: 74.11,
    eligible: true,
    ratio: 1.7411,
    ratio_ci95: [1.3801, 2.1966],
    rank: 1,
    rank_of: 13,
  },
};

describe("parseSeverity", () => {
  it("requires all five groups", () => {
    expect(parseSeverity(SUMMARY.severity)).toEqual({
      death: 355,
      injury: 22277,
      incidentNoInjury: 41594,
      noIncident: 4054,
      unspecified: 1720,
    });
    expect(parseSeverity({ ...SUMMARY.severity, death: undefined })).toBeNull();
    expect(parseSeverity({ ...SUMMARY.severity, injury: -1 })).toBeNull();
    expect(parseSeverity(null)).toBeNull();
  });
});

describe("parseYearPoints", () => {
  it("drops malformed years, sorts and keeps the partial flag", () => {
    const pts = parseYearPoints([
      { year: 2026, reports: 5, partial: true },
      { year: 2025, reports: 4 },
      { year: 2024.5, reports: 3 },
      { year: 2023, reports: null },
      "x",
    ]);
    expect(pts).toEqual([
      { year: 2025, reports: 4, partial: false },
      { year: 2026, reports: 5, partial: true },
    ]);
  });
});

describe("parseGrowth", () => {
  it("parses windows, counts, interval and rank", () => {
    const g = parseGrowth(CATEGORY.growth);
    expect(g).toMatchObject({
      recent: 195,
      prior: 112,
      changePct: 74.11,
      eligible: true,
      ci95: [1.3801, 2.1966],
      rank: 1,
      rankOf: 13,
    });
  });
  it("is null without both windows, and keeps a missing interval as null", () => {
    expect(parseGrowth({ ...CATEGORY.growth, prior_reports: null })).toBeNull();
    expect(parseGrowth({ ...CATEGORY.growth, ratio_ci95: [2, 1] })?.ci95).toBeNull();
    expect(parseGrowth({ ...CATEGORY.growth, eligible: undefined })?.eligible).toBe(false);
  });
});

describe("parseCategory", () => {
  it("reads cells, the yearly series and growth", () => {
    const c = parseCategory(CATEGORY);
    expect(c?.name).toBe("Personal Care");
    expect(c?.yearly).toHaveLength(2);
    expect(c?.growth?.rankOf).toBe(13);
  });
  it("drops rows without a name or a report count", () => {
    expect(parseCategory({ ...CATEGORY, cells: { reports: 5 } })).toBeNull();
    expect(parseCategory({ ...CATEGORY, cells: { name: "X", reports: "5" } })).toBeNull();
    expect(parseCategory({ id: "", cells: CATEGORY.cells })).toBeNull();
  });
});

describe("parseSaferProductsReports", () => {
  const data = parseSaferProductsReports({
    summary: SUMMARY,
    meta: META,
    categories: [
      { ...CATEGORY, id: "a", cells: { name: "Small", reports: 5 } },
      CATEGORY,
      { id: "bad", cells: {} },
    ],
  });

  it("reads the headline numbers", () => {
    expect(data?.total).toBe(70000);
    expect(data?.publicationWindow).toEqual({ first: "2011-05-06", last: "2026-10-16" });
    expect(data?.peak).toEqual({ year: 2012, reports: 6713 });
    expect(data?.latestComplete).toEqual({
      year: 2025,
      reports: 4415,
      yoyPct: 9.17,
      changeVs2019Pct: 45.81,
    });
    expect(data?.lag).toEqual({ median: 25, p90: 60, within30Pct: 64.21 });
    expect(data?.ageBands.map((b) => b.label)).toEqual([
      "Under 1",
      "1–4",
      "5–12",
      "13–17",
      "18–64",
      "65 and over",
    ]);
  });

  it("keeps the year-to-date figure with and without the largest manufacturer string", () => {
    const ytd = data?.latestPartial?.ytd;
    expect(ytd).toMatchObject({ through: "10-16", reports: 6017, priorYearSameWindow: 3424 });
    expect(ytd?.changePct).toBe(75.73);
    expect(ytd?.excludingLargest).toEqual({
      company: "Zuru Inc.",
      removedReports: 669,
      reports: 5348,
      priorYearSameWindow: 3421,
      changePct: 56.33,
    });
  });

  it("compares a year with the year before only when neither is partial", () => {
    const by = new Map(data?.yearlyPublished.map((y) => [y.year, y]));
    expect(by.get(2011)).toMatchObject({ partial: true, yoyPct: null, yoyComparable: false });
    // 2012 is compared with the partial 2011, so the dataset's own YoY is withheld
    expect(by.get(2012)).toMatchObject({ partial: false, yoyPct: null, yoyComparable: false });
    expect(by.get(2013)).toMatchObject({ yoyPct: -15.15, yoyComparable: true });
    expect(by.get(2026)).toMatchObject({ partial: true, yoyPct: null, yoyComparable: false });
    expect(data?.yearlyPublished).toHaveLength(4);
  });

  it("sorts categories by reports and drops malformed ones", () => {
    expect(data?.categories.map((c) => c.name)).toEqual(["Personal Care", "Small"]);
  });

  it("keeps only string caveats", () => {
    expect(data?.caveats).toEqual(["Reports are unverified consumer submissions."]);
  });

  it("is null without a report total or any published year", () => {
    expect(
      parseSaferProductsReports({
        summary: { ...SUMMARY, reports: null },
        meta: META,
        categories: [],
      }),
    ).toBeNull();
    expect(
      parseSaferProductsReports({
        summary: { ...SUMMARY, yearly_published: [] },
        meta: META,
        categories: [],
      }),
    ).toBeNull();
    expect(
      parseSaferProductsReports({ summary: undefined, meta: META, categories: [] }),
    ).toBeNull();
  });

  it("omits the excluding-largest block unless every figure is present", () => {
    const d = parseSaferProductsReports({
      summary: {
        ...SUMMARY,
        latest_partial_year: {
          year: 2026,
          reports: 6017,
          ytd: {
            ...SUMMARY.latest_partial_year.ytd,
            excluding_largest_company: { company: "Zuru Inc.", reports: 1 },
          },
        },
      },
      meta: META,
      categories: [],
    });
    expect(d?.latestPartial?.ytd?.excludingLargest).toBeNull();
  });
});

describe("hazard themes and measured precision", () => {
  const meta = parseSpMeta({
    defs: [
      {
        theme: "fire",
        label: "Fire",
        precision: {
          sample_size: 20,
          correct: 17,
          precision_pct: 85,
          wilson95_pct: [64, 94.8],
          round: "fin1",
        },
      },
      {
        theme: "burn",
        label: "Burn or scald",
        precision: { sample_size: 20, correct: 25, precision_pct: 100, wilson95_pct: [83.9, 100] },
      },
      { theme: "battery", label: "Battery" },
    ],
  });
  const themes = parseThemes(
    [
      { theme: "fire", label: "Fire", reports: 19195, share_pct: 27.42, precision_pct: 85 },
      {
        theme: "burn",
        label: "Burn or scald",
        reports: 15388,
        share_pct: 21.98,
        precision_pct: 100,
      },
      { theme: "battery", label: "Battery", reports: 3738, share_pct: 5.34, precision_pct: 80 },
      { theme: "ghost", label: "Ghost", reports: 1 },
      { theme: "x", reports: "n" },
    ],
    meta.themeDefs,
  );

  it("carries the sample, the correct count and the interval with the precision", () => {
    expect(themes[0]).toEqual({
      theme: "fire",
      label: "Fire",
      reports: 19195,
      sharePct: 27.42,
      precision: {
        sampleSize: 20,
        correct: 17,
        precisionPct: 85,
        wilson95: [64, 94.8],
        round: "fin1",
      },
    });
  });

  it("never shows a bare precision: an impossible sample or a missing definition gives none", () => {
    expect(themes.find((t) => t.theme === "burn")?.precision).toBeNull();
    expect(themes.find((t) => t.theme === "battery")?.precision).toBeNull();
    expect(themes.find((t) => t.theme === "ghost")?.precision).toBeNull();
  });

  it("drops malformed theme rows", () => {
    expect(themes.map((t) => t.theme)).toEqual(["fire", "burn", "battery", "ghost"]);
  });
});

describe("parseGrowthRows and parseSaferProductsSignals", () => {
  const TYPE = {
    id: "sp-type-278",
    name: "Electric Ranges or Ovens (Excl Counter-top Ovens) (278)",
    category: "Kitchen",
    subcategory: "Appliances",
    code: 278,
    reports: 5612,
    growth: {
      ...CATEGORY.growth,
      recent_reports: 1019,
      prior_reports: 467,
      change_pct: 118.2,
      rank: 4,
      rank_of: 68,
    },
    yearly: CATEGORY.yearly,
  };
  const NOT_RANKED = {
    ...TYPE,
    id: "sp-type-1512",
    name: "Diapers (1512)",
    growth: { ...TYPE.growth, eligible: false, rank: null, rank_of: null },
  };

  it("keeps only rows the dataset ranked", () => {
    const rows = parseGrowthRows([TYPE, NOT_RANKED, { ...TYPE, id: "x", name: null }]);
    expect(rows.map((r) => r.id)).toEqual(["sp-type-278"]);
    expect(rows[0]?.code).toBe("278");
    expect(rows[0]?.growth.rank).toBe(4);
  });

  it("builds the three levels, the windows and the counts of ranked rows", () => {
    const s = parseSaferProductsSignals({
      summaryThemes: [{ theme: "fire", label: "Fire", reports: 10, share_pct: 1 }],
      meta: META,
      leaders: { type: { eligible: 68, total: 702 }, category: { eligible: 13, total: 15 } },
      thresholds: {
        growth_min_reports_per_window: 30,
        growth_windows: { recent: "2023–2025", prior: "2020–2022" },
      },
      levels: {
        type: [TYPE, { ...TYPE, id: "sp-sub-wrong-prefix" }],
        subcategory: [],
        category: [{ ...TYPE, id: "sp-cat-kitchen", name: "Kitchen" }],
      },
    });
    expect(s?.windows).toEqual({
      recent: "2023–2025",
      prior: "2020–2022",
      minReportsPerWindow: 30,
    });
    expect(s?.levels.type.rows.map((r) => r.id)).toEqual(["sp-type-278"]);
    expect(s?.levels.type.eligible).toBe(68);
    expect(s?.levels.type.total).toBe(702);
    expect(s?.levels.subcategory.eligible).toBeNull();
    expect(s?.levels.category.rows).toHaveLength(1);
    expect(s?.themes).toHaveLength(1);
  });

  it("is null when there is nothing to show", () => {
    expect(
      parseSaferProductsSignals({
        summaryThemes: [],
        meta: META,
        leaders: null,
        thresholds: null,
        levels: { type: [], subcategory: [], category: [] },
      }),
    ).toBeNull();
  });
});

const MFR = {
  id: "sp-mfr-sears-holdings-management-corporation-6fd44f7f",
  cells: {
    rank: 1,
    name: "Sears Holdings Management Corporation",
    role: "Manufacturer",
    reports: 4473,
    share_pct: 6.39,
    deaths: 1,
    injuries: 602,
    comment_rate_pct: 90.7,
  },
  sec: { status: "unmatched" },
  recall: {
    record_id: "sp-xc-co-sears-holdings-management-corporation-3fa01fb8",
    level: "normalised_after_location_strip",
    recalls: 2,
    first_recall: "2019-11-14",
    last_recall: "2020-08-11",
    reports_before_first_recall: 4085,
  },
  variants: { names: [], count: 0, reports_not_included: 0 },
  first: "2011-05-10",
  last: "2026-09-17",
  yearly: CATEGORY.yearly,
};
const RETAILER = {
  id: "sp-ret-walmart-ab06dc1c",
  cells: {
    rank: 3,
    name: "Walmart",
    role: "Retailer",
    reports: 2835,
    share_pct: 4.05,
    deaths: 10,
    injuries: 900,
    comment_rate_pct: "n/a",
  },
  sec: { status: "matched", cik: "0000104169", title: "WALMART INC." },
  variants: {
    names: [
      { name: "walmart", reports: 400 },
      { name: "WalMart", reports: 12 },
      { name: "", reports: 1 },
    ],
    count: 31,
  },
};

describe("parseCompany", () => {
  it("reads a manufacturer with its company-name match to a recall firm", () => {
    const c = parseCompany(MFR);
    expect(c).toMatchObject({
      name: "Sears Holdings Management Corporation",
      role: "manufacturer",
      commentRatePct: 90.7,
      cik: null,
    });
    expect(c?.recallMatch).toEqual({
      recordId: "sp-xc-co-sears-holdings-management-corporation-3fa01fb8",
      level: "normalised_after_location_strip",
      recalls: 2,
      firstRecall: "2019-11-14",
      lastRecall: "2020-08-11",
      reportsBeforeFirstRecall: 4085,
    });
  });

  it("keeps a retailer's comment rate unrecorded and links a SEC profile only on a unique exact match", () => {
    const c = parseCompany(RETAILER);
    expect(c?.commentRatePct).toBeNull();
    expect(c?.cik).toBe("0000104169");
    expect(c?.recallMatch).toBeNull();
    expect(
      parseCompany({ ...RETAILER, sec: { status: "ambiguous", cik: "0000104169" } })?.cik,
    ).toBeNull();
    expect(
      parseCompany({ ...RETAILER, sec: { status: "matched", cik: "104169" } })?.cik,
    ).toBeNull();
  });

  it("lists spelling variants separately and counts all of them", () => {
    const c = parseCompany(RETAILER);
    expect(c?.variants).toEqual([
      { name: "walmart", reports: 400 },
      { name: "WalMart", reports: 12 },
    ]);
    expect(c?.variantCount).toBe(31);
  });

  it("drops rows with an unknown role or no report count", () => {
    expect(parseCompany({ ...MFR, cells: { ...MFR.cells, role: "Distributor" } })).toBeNull();
    expect(parseCompany({ ...MFR, cells: { ...MFR.cells, reports: "x" } })).toBeNull();
  });
});

describe("parseRecallCheck and parseSaferProductsCompanies", () => {
  const SUMMARY_XC = {
    comparison: { export_recalls: 10053, matched: 10053, export_only: ["15190"] },
    levels: {
      report_name_strings: {
        none: 9006,
        normalised: 230,
        normalised_after_location_strip: 1202,
        exact_string: 31,
      },
      reports: {
        none: 30808,
        normalised: 9173,
        normalised_after_location_strip: 28925,
        exact_string: 1094,
      },
    },
    product_pairs: {
      report_recall_pairs: 44,
      recalls_with_pairs: 34,
      recalls_where_a_paired_report_came_first: 3,
    },
  };

  it("reads the match tiers by reports and the exact product-text pairs", () => {
    const rc = parseRecallCheck(SUMMARY_XC);
    expect(rc?.reportsByLevel).toEqual({
      exact: 1094,
      normalised: 9173,
      locationStripped: 28925,
      none: 30808,
    });
    expect(rc?.productPairs).toEqual({ pairs: 44, recalls: 34, pairedReportFirst: 3 });
    expect(rc?.exportOnly).toEqual(["15190"]);
    expect(parseRecallCheck(null)).toBeNull();
    expect(parseRecallCheck({})).toBeNull();
  });

  it("sorts companies by reports and is null when none parse", () => {
    const r = parseSaferProductsCompanies({
      rows: [RETAILER, MFR, { id: "bad" }],
      meta: META,
      threshold: 25,
      recallSummary: SUMMARY_XC,
    });
    expect(r?.companies.map((c) => c.name)).toEqual([
      "Sears Holdings Management Corporation",
      "Walmart",
    ]);
    expect(r?.threshold).toBe(25);
    expect(r?.recallCheck?.productPairs?.pairs).toBe(44);
    expect(
      parseSaferProductsCompanies({
        rows: [{ id: "bad" }],
        meta: META,
        threshold: 25,
        recallSummary: null,
      }),
    ).toBeNull();
  });
});
