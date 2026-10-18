import { describe, expect, it } from "vitest";
import type {
  SaferProductsReports,
  SaferProductsSignals,
  SpCompany,
  SpGrowth,
  SpGrowthRow,
  SpYear,
} from "@/lib/external/saferProducts.functions";
import {
  companyCounts,
  decliningRows,
  filterByText,
  filterCompanies,
  matchLevelLabel,
  matchLevelShort,
  partialYearNote,
  pointsFromLargest,
  pointsText,
  precisionLabel,
  rankLabel,
  ratioLabel,
  recallMatchText,
  severitySegments,
  sortCompanies,
  sortGrowth,
  spSignalTakeaways,
  spTakeaways,
  themesByReports,
  UNVERIFIED,
  yearBars,
  yearLabel,
  yoyNote,
} from "./saferProductsView";

const year = (
  y: number,
  reports: number,
  partial = false,
  yoyPct: number | null = null,
): SpYear => ({
  year: y,
  reports,
  partial,
  yoyPct,
  yoyComparable: yoyPct != null,
});

const YEARS: SpYear[] = [
  year(2011, 4540, true),
  { ...year(2012, 6713), yoyComparable: false },
  year(2013, 5696, false, -15.15),
  year(2026, 6017, true),
];

const REPORTS: SaferProductsReports = {
  total: 70000,
  publicationWindow: { first: "2011-05-06", last: "2026-10-16" },
  reportWindow: null,
  retrieved: null,
  peak: { year: 2012, reports: 6713 },
  severity: {
    death: 355,
    injury: 22277,
    incidentNoInjury: 41594,
    noIncident: 4054,
    unspecified: 1720,
  },
  ageBands: [],
  ageNotRecorded: null,
  latestComplete: { year: 2025, reports: 4415, yoyPct: 9.17, changeVs2019Pct: 45.81 },
  latestPartial: {
    year: 2026,
    reports: 6017,
    ytd: {
      through: "10-16",
      reports: 6017,
      priorYearSameWindow: 3424,
      changePct: 75.73,
      baseYearSameWindow: 2499,
      changeVs2019Pct: 140.78,
      excludingLargest: {
        company: "Zuru Inc.",
        removedReports: 669,
        reports: 5348,
        priorYearSameWindow: 3421,
        changePct: 56.33,
      },
    },
  },
  lag: null,
  commentRatePct: null,
  yearlyPublished: YEARS,
  yearlyReported: [
    { year: 2025, reports: 4595, partial: false },
    { year: 2026, reports: 5533, partial: true },
  ],
  categories: [
    {
      id: "sp-cat-kitchen",
      name: "Kitchen",
      reports: 25144,
      sharePct: 35.92,
      deaths: 9,
      injuries: 4998,
      yearly: [],
      growth: null,
    },
    {
      id: "sp-cat-baby",
      name: "Baby",
      reports: 4767,
      sharePct: 6.8,
      deaths: 1,
      injuries: 1,
      yearly: [],
      growth: null,
    },
  ],
  caveats: [],
};

describe("years and partial years", () => {
  it("marks partial years with an asterisk", () => {
    expect(yearLabel({ year: 2026, partial: true })).toBe("2026*");
    expect(yearLabel({ year: 2025, partial: false })).toBe("2025");
  });

  it("states why a year-over-year change is withheld", () => {
    expect(yoyNote(YEARS[0]!)).toBe("Not compared: partial year");
    expect(yoyNote(YEARS[1]!)).toBe("Not compared: the year before is partial");
    expect(yoyNote(YEARS[2]!)).toBe("−15.2% on the year before");
  });

  it("builds publication bars with the YoY note and submission bars without one", () => {
    const published = yearBars(YEARS, [], "published");
    expect(published.map((b) => b.label)).toEqual(["2011*", "2012", "2013", "2026*"]);
    expect(published[2]?.yoy).toBe("−15.2% on the year before");
    const submitted = yearBars(YEARS, REPORTS.yearlyReported, "submitted");
    expect(submitted.map((b) => b.reports)).toEqual([4595, 5533]);
    expect(submitted[0]?.yoy).toMatch(/publication year only/);
  });

  it("describes the partial years from the publication window", () => {
    expect(partialYearNote(YEARS, REPORTS.publicationWindow)).toBe(
      "2011 and 2026 are partial: the first report was published 2011-05-06 and the latest 2026-10-16.",
    );
    expect(partialYearNote(YEARS.slice(1, 3), null)).toBeNull();
    expect(partialYearNote([YEARS[3]!], null)).toBe("2026 is partial.");
  });

  it("orders the severity groups and keeps every count", () => {
    const segs = severitySegments(REPORTS.severity!);
    expect(segs.map((s) => s.key)).toEqual([
      "death",
      "injury",
      "incidentNoInjury",
      "noIncident",
      "unspecified",
    ]);
    expect(segs.reduce((a, s) => a + s.value, 0)).toBe(70000);
  });
});

describe("year-to-date without the largest manufacturer string", () => {
  it("computes the percentage points that one string explains", () => {
    expect(pointsFromLargest(REPORTS.latestPartial!.ytd)).toBeCloseTo(19.4, 5);
    expect(pointsFromLargest(null)).toBeNull();
    expect(
      pointsFromLargest({ ...REPORTS.latestPartial!.ytd!, excludingLargest: null }),
    ).toBeNull();
  });
});

describe("pointsText", () => {
  it("always names the unit", () => {
    expect(pointsText(19.4)).toBe("19 percentage points");
    expect(pointsText(1.2)).toBe("1 percentage point");
  });
});

describe("spTakeaways", () => {
  const t = spTakeaways(REPORTS);
  const byId = new Map(t.map((x) => [x.id, x]));

  it("labels every report count as unverified or as not a finding", () => {
    expect(byId.get("scale")?.figure).toBe("70,000");
    expect(byId.get("scale")?.text).toContain(UNVERIFIED.toLowerCase());
    expect(byId.get("scale")?.text).toContain("not a finding");
    expect(byId.get("latest-year")?.text).toContain("unverified");
    expect(byId.get("ytd")?.text).toContain("unverified");
    expect(byId.get("severity")?.text).toContain("not persons");
  });

  it("shows the year-to-date change with and without the largest manufacturer string", () => {
    const ytd = byId.get("ytd");
    expect(ytd?.figure).toBe("+75.7%");
    expect(ytd?.text).toContain("+56.3% without Zuru Inc.");
    expect(ytd?.text).toContain("669 reports");
    expect(ytd?.text).toContain("about 19 percentage points of the change");
  });

  it("computes the category share from the loaded rows", () => {
    expect(byId.get("top-category")?.figure).toBe("35.9%");
    expect(byId.get("top-category")?.text).toContain("Kitchen category (25,144)");
    expect(byId.get("severity")?.figure).toBe("31.8%");
  });

  it("shows nothing when fewer than two statements can be computed", () => {
    expect(
      spTakeaways({
        ...REPORTS,
        total: 0,
        latestComplete: null,
        latestPartial: null,
        categories: [],
        severity: null,
        publicationWindow: null,
      }),
    ).toEqual([]);
  });
});

const growth = (
  change: number,
  recent: number,
  prior: number,
  rank: number | null = 1,
): SpGrowth => ({
  recentWindow: "2023–2025",
  priorWindow: "2020–2022",
  recent,
  prior,
  changePct: change,
  eligible: true,
  ratio: 1 + change / 100,
  ci95: [1.1, 2.4],
  rank,
  rankOf: 68,
});
const row = (id: string, name: string, change: number, recent = 100, prior = 50): SpGrowthRow => ({
  id,
  name,
  category: "Kitchen",
  subcategory: null,
  code: null,
  reports: recent + prior,
  growth: growth(change, recent, prior),
  yearly: [],
});

describe("growth table helpers", () => {
  const rows = [
    row("a", "Alpha", 10),
    row("b", "Beta", -20),
    row("c", "Gamma", 120),
    row("d", "Delta", -1.5),
  ];

  it("sorts by change in either direction, ties by name", () => {
    expect(sortGrowth(rows, "change", true).map((r) => r.id)).toEqual(["c", "a", "d", "b"]);
    expect(sortGrowth(rows, "change", false).map((r) => r.id)).toEqual(["b", "d", "a", "c"]);
    expect(sortGrowth(rows, "name", false).map((r) => r.name)).toEqual([
      "Alpha",
      "Beta",
      "Delta",
      "Gamma",
    ]);
  });

  it("lists only genuinely declining rows, not the lowest-growth positive ones", () => {
    expect(decliningRows(rows).map((r) => r.id)).toEqual(["b", "d"]);
    expect(decliningRows([row("p", "Positive", 3)])).toEqual([]);
  });

  it("filters by every word of the query across name and category", () => {
    const hit = filterByText(rows, "kitchen alp", (r) => `${r.name} ${r.category}`);
    expect(hit.map((r) => r.id)).toEqual(["a"]);
    expect(filterByText(rows, "  ", (r) => r.name)).toHaveLength(4);
    expect(filterByText(rows, "zzz", (r) => r.name)).toEqual([]);
  });

  it("formats the rate ratio with its interval and the rank among ranked rows", () => {
    expect(ratioLabel(growth(118.2, 1019, 467, 4))).toBe("2.18× (1.10 to 2.40)");
    expect(ratioLabel({ ...growth(10, 1, 1), ratio: null })).toBe("Not recorded");
    expect(ratioLabel({ ...growth(10, 1, 1), ci95: null })).toBe("1.10×");
    expect(rankLabel(growth(1, 1, 1, 4))).toBe("4 of 68");
    expect(rankLabel(growth(1, 1, 1, null))).toBe("Not ranked");
  });
});

describe("spSignalTakeaways", () => {
  const signals: SaferProductsSignals = {
    windows: { recent: "2023–2025", prior: "2020–2022", minReportsPerWindow: 30 },
    levels: {
      type: {
        rows: [
          row("a", "Scooters", 161.11, 94, 36),
          row("b", "Computers", -51.16, 148, 303),
          row("c", "Ovens", 5, 105, 100),
        ],
        eligible: 68,
        total: 702,
      },
      subcategory: { rows: [], eligible: null, total: null },
      category: { rows: [], eligible: null, total: null },
    },
    themes: [
      {
        theme: "fire",
        label: "Fire",
        reports: 19195,
        sharePct: 27.42,
        precision: {
          sampleSize: 20,
          correct: 17,
          precisionPct: 85,
          wilson95: [64, 94.8],
          round: null,
        },
      },
    ],
    caveats: [],
  };
  const byId = new Map(spSignalTakeaways(signals).map((x) => [x.id, x]));

  it("names the fastest rise and the largest fall with both counts and windows", () => {
    expect(byId.get("fastest")?.figure).toBe("+161.1%");
    expect(byId.get("fastest")?.text).toContain(
      "94 unverified reports in 2023–2025 against 36 in 2020–2022",
    );
    expect(byId.get("falling")?.figure).toBe("−51.2%");
  });

  it("says how many product types are ranked and why the rest are not", () => {
    expect(byId.get("eligible")?.figure).toBe("68 of 702");
    expect(byId.get("eligible")?.text).toContain("at least 30 unverified reports in both windows");
  });

  it("never states a hazard count without its measured precision and interval", () => {
    const text = byId.get("hazard")?.text ?? "";
    expect(text).toContain("measured precision 85%");
    expect(text).toContain("95% interval 64% to 95%");
    expect(text).toContain("17 of 20 sampled matches");
  });
});

describe("hazard-term precision", () => {
  it("states the sample and the interval, or Not recorded", () => {
    expect(
      precisionLabel({
        sampleSize: 20,
        correct: 17,
        precisionPct: 85,
        wilson95: [64, 94.8],
        round: "fin1",
      }),
    ).toBe("85% precision (95% interval 64% to 95%; 17 of 20 sampled matches)");
    expect(precisionLabel(null)).toBe("Precision Not recorded");
  });

  it("orders themes by report count", () => {
    const themes = [
      { theme: "a", label: "A", reports: 5, sharePct: null, precision: null },
      { theme: "b", label: "B", reports: 50, sharePct: null, precision: null },
    ];
    expect(themesByReports(themes).map((t) => t.theme)).toEqual(["b", "a"]);
  });
});

const company = (p: Partial<SpCompany> & { name: string }): SpCompany => ({
  id: p.name,
  role: "manufacturer",
  rank: 1,
  reports: 100,
  sharePct: 1,
  deaths: 0,
  injuries: 0,
  commentRatePct: null,
  variants: [],
  variantCount: 0,
  yearly: [],
  firstPublished: null,
  lastPublished: null,
  cik: null,
  secTitle: null,
  recallMatch: null,
  ...p,
});

describe("company helpers", () => {
  const companies = [
    company({
      name: "Whirlpool",
      reports: 3693,
      deaths: 4,
      commentRatePct: 80,
      recallMatch: {
        recordId: "x",
        level: "exact_string",
        recalls: 1,
        firstRecall: "2020-01-02",
        lastRecall: null,
        reportsBeforeFirstRecall: 12,
      },
    }),
    company({ name: "Zuru Inc.", reports: 700, deaths: 0, commentRatePct: null }),
    company({ name: "Skechers", reports: 685, deaths: 0, commentRatePct: 99.7, cik: "0001065837" }),
    company({ name: "Walmart", role: "retailer", reports: 2835, deaths: 10 }),
  ];

  it("filters by role and name without merging spellings", () => {
    expect(filterCompanies(companies, "manufacturer", "").map((c) => c.name)).toEqual([
      "Whirlpool",
      "Zuru Inc.",
      "Skechers",
    ]);
    expect(filterCompanies(companies, "retailer", "wal").map((c) => c.name)).toEqual(["Walmart"]);
    expect(filterCompanies(companies, "retailer", "whirl")).toEqual([]);
  });

  it("sorts unknown values last in either direction", () => {
    const mf = companies.filter((c) => c.role === "manufacturer");
    expect(sortCompanies(mf, "comment", true).map((c) => c.name)).toEqual([
      "Skechers",
      "Whirlpool",
      "Zuru Inc.",
    ]);
    expect(sortCompanies(mf, "comment", false).map((c) => c.name)).toEqual([
      "Whirlpool",
      "Skechers",
      "Zuru Inc.",
    ]);
    expect(sortCompanies(mf, "reports", true)[0]?.name).toBe("Whirlpool");
    expect(sortCompanies(mf, "name", false).map((c) => c.name)).toEqual([
      "Skechers",
      "Whirlpool",
      "Zuru Inc.",
    ]);
  });

  it("calls a recall link a company-name match and never the recalled product", () => {
    const m = recallMatchText(companies[0]!);
    expect(m.text).toBe("1 recall");
    expect(m.detail).toContain("Company-name match (exact name)");
    expect(m.detail).toContain("12 unverified reports published before it");
    expect(recallMatchText(companies[1]!).text).toBe("No name match");
    expect(recallMatchText(companies[3]!).text).toBe("Not checked");
  });

  it("labels the match tiers", () => {
    expect(matchLevelLabel("normalised_after_location_strip")).toMatch(
      /dropping the recall firm's location/,
    );
    expect(matchLevelLabel("something_new")).toBe("something new");
    expect(matchLevelShort("normalised_after_location_strip")).toBe("location dropped");
    expect(matchLevelShort("exact_string")).toBe("exact name");
  });

  it("counts roles, recall matches and linked profiles", () => {
    expect(companyCounts(companies)).toEqual({
      manufacturers: 3,
      retailers: 1,
      withRecallMatch: 1,
      withProfile: 1,
    });
  });
});
