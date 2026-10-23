import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/external/stateMetrics.functions", () => ({ getStateMetrics: vi.fn() }));
vi.mock("@/lib/external/mdlAnalytics.functions", () => ({ getMdlAnalytics: vi.fn() }));
vi.mock("@/lib/insights/insights.functions", () => ({ getDailyInsights: vi.fn() }));

import type { MdlAnalytics, MdlRow } from "@/lib/external/mdlAnalytics.functions";
import type { StateMetricsBundle, MetricDef as SmDef } from "@/lib/external/stateMetrics.functions";
import type { TrendBlockData } from "@/lib/analytics/trend";
import { kaplanMeier } from "@/components/charts/stats";
import {
  coCounselNetwork,
  daysBetween,
  mdlFacts,
  mdlGrowthAligned,
  mdlMetricDefs,
  mdlSurvival,
  monthOffset,
  originSankey,
} from "./bridge/mdl";
import {
  formatOf,
  latestCompleteYear,
  stateMetricDefs,
  stateMetricFacts,
} from "./bridge/stateMetrics";
import { isBridgeMetric, joinCross } from "./data";
import { fixtureCatalog, fixtureLayer } from "./fixtures";
import { INSIGHTS_FIXTURES } from "./fixtureMode";
import { kpiFromBlock, kpiFromFacts, notableMovements, type Kpi } from "./kpis";

const smDef = (over: Partial<SmDef>): SmDef => ({
  key: "overdose_rate",
  label: "Drug overdose deaths per 100,000",
  short: "Overdose rate",
  unit: "per 100k",
  format: "rate",
  group: "Health & injury",
  method: "CDC deaths / Census population × 100,000",
  denominator: "population",
  per: 100000,
  higher: "worse",
  selectable: true,
  caveats: ["Provisional counts."],
  years: [2021, 2023],
  rankYears: [2023],
  latestYear: 2023,
  partialYears: {},
  national: { "2021": 32.4, "2022": 32.6, "2023": 31.3 },
  nationalBasis: "computed from the national numerator and national population",
  distribution: {},
  sources: [
    {
      publisher: "CDC",
      name: "VSRR provisional drug overdose death counts",
      url: "https://data.cdc.gov/x.csv",
      page: "https://www.cdc.gov/nchs/nvss/vsrr/drug-overdose-data.htm",
      retrieved: "2026-10-01",
    },
  ],
  order: 3,
  provisional: "CDC provisional counts (VSRR)",
  ...over,
});

const bundle: StateMetricsBundle = {
  generatedAt: "2026-10-20T00:00:00Z",
  rankRule: null,
  outlierRule: null,
  metrics: [
    smDef({}),
    smDef({
      key: "population",
      label: "Resident population (July 1)",
      unit: "persons",
      format: "int",
      denominator: null,
      per: null,
      group: "Population & economy",
      order: 1,
      national: {},
    }),
    smDef({
      key: "gdp",
      label: "GDP, current dollars",
      unit: "$ millions",
      format: "money_m",
      denominator: null,
      per: null,
      order: 2,
      national: { "2023": 27_000_000 },
    }),
    smDef({ key: "hidden", selectable: false }),
    smDef({
      key: "fda_recalls",
      label: "FDA entries",
      format: "int",
      per: null,
      denominator: null,
      years: [2024, 2026],
      partialYears: { "2026": "Reports through 2026-09-09" },
      national: { "2024": 10, "2025": 12, "2026": 5 },
    }),
  ],
  states: [
    {
      usps: "CA",
      fips: "06",
      name: "California",
      series: {
        overdose_rate: { "2021": 27.6, "2023": 30.1 },
        gdp: { "2023": 3_900_000 },
        fda_recalls: { "2024": 3, "2025": 4, "2026": 2 },
      },
      latest: {},
      notes: { overdose_rate: { "2022": "Suppressed by CDC (fewer than 10 deaths)" } },
      overdose12mo: {},
    },
    {
      usps: "TX",
      fips: "48",
      name: "Texas",
      series: {
        overdose_rate: { "2021": 16.7, "2022": 17.0, "2023": 16.1 },
        fda_recalls: { "2024": 1, "2025": 2 },
      },
      latest: {},
      notes: {},
      overdose12mo: {},
    },
  ],
};

describe("state metrics bridge", () => {
  it("maps formats and scales $ millions to dollars", () => {
    expect(formatOf({ format: "money_m", per: null })).toEqual({
      format: "currency_usd",
      factor: 1_000_000,
    });
    expect(formatOf({ format: "rate", per: 1_000_000 }).format).toBe("ratio");
    expect(formatOf({ format: "pct", per: null }).format).toBe("percent");
  });

  it("defines contract metrics for the selectable series only, with sources, denominator and caveats", () => {
    const defs = stateMetricDefs(bundle);
    expect(defs.map((d) => d.id)).toEqual([
      "sm.population",
      "sm.gdp",
      "sm.overdose_rate",
      "sm.fda_recalls",
    ]);
    const od = defs.find((d) => d.id === "sm.overdose_rate")!;
    expect(od.format).toBe("rate_per_100k");
    expect(od.denominator).toBe("Resident population (July 1), same year (per 100,000)");
    expect(od.sourceLinks[0]).toEqual({
      label: "CDC: VSRR provisional drug overdose death counts",
      url: "https://www.cdc.gov/nchs/nvss/vsrr/drug-overdose-data.htm",
    });
    expect(od.caveats).toContain("Provisional: CDC provisional counts (VSRR).");
    expect(defs.find((d) => d.id === "sm.fda_recalls")!.caveats).toContain(
      "2026 is a partial year: Reports through 2026-09-09.",
    );
  });

  it("writes an explicit null fact (with the source's note) for a year a state does not record", () => {
    const facts = stateMetricFacts(bundle, "sm.overdose_rate", "state", { entityIds: ["CA"] });
    expect(facts.map((f) => [f.period, f.value])).toEqual([
      ["2021", 27.6],
      ["2022", null],
      ["2023", 30.1],
    ]);
    expect(facts[1]!.notRecordedReason).toBe("Suppressed by CDC (fewer than 10 deaths)");
    expect(
      stateMetricFacts(bundle, "sm.gdp", "state", { entityIds: ["CA"], period: "2023" })[0]!.value,
    ).toBe(3_900_000_000_000);
  });

  it("marks partial years and reads the nation's series", () => {
    const nation = stateMetricFacts(bundle, "sm.fda_recalls", "nation");
    expect(nation.map((f) => [f.period, f.value, f.partial])).toEqual([
      ["2024", 10, false],
      ["2025", 12, false],
      ["2026", 5, true],
    ]);
    expect(latestCompleteYear(bundle, "sm.fda_recalls", 2)).toBe("2025");
    expect(latestCompleteYear(bundle, "sm.overdose_rate", 2)).toBe("2023");
  });
});

const row = (over: Partial<MdlRow>): MdlRow => ({
  mdl: 1,
  title: "In re Example",
  type: "Products Liability",
  massTort: false,
  status: "pending",
  district: "N.D. Cal.",
  judge: null,
  pending: 0,
  total: 0,
  change1m: null,
  change3m: null,
  change12m: null,
  new12m: null,
  resolved12m: null,
  ageYears: null,
  growth: "steady",
  dateTransferred: "2020-01-01",
  dateClosed: null,
  rank: null,
  sharePct: null,
  series: [],
  ...over,
});

const mdl: MdlAnalytics = {
  overview: {
    as_of: "2025-01-01",
    reports: 4,
    first_report: "2024-10-01",
    pending_mdls: 2,
    pending_actions: 0,
    mass_tort_mdls: 1,
    mass_tort_actions: 0,
    median_age_years: null,
    top10_share_pct: 0,
    new_mdls_in_series: 1,
    left_series: 1,
    portfolio: [],
    by_type: [],
    by_district: [],
    by_judge: [],
  },
  mdls: [
    row({
      mdl: 3001,
      title: "In re Old",
      dateTransferred: "2014-10-01",
      series: [
        { date: "2024-10-01", pending: 50, total: 900 },
        { date: "2024-11-01", pending: 45, total: 900 },
      ],
    }),
    row({
      mdl: 3002,
      title: "In re New",
      massTort: true,
      dateTransferred: "2024-11-12",
      series: [
        { date: "2024-11-01", pending: 3, total: 3 },
        { date: "2024-12-01", pending: 9, total: 9 },
        { date: "2025-01-01", pending: 20, total: 20 },
      ],
    }),
    row({
      mdl: 3003,
      status: "terminated",
      dateTransferred: "2019-10-01",
      dateClosed: "2024-12-15",
      series: [{ date: "2024-10-01", pending: 2, total: 400 }],
    }),
    row({ mdl: 3004, dateTransferred: null }),
  ],
  terminated: {
    rows: 0,
    byDecade: [],
    byCircuit: [],
    largest: [],
    totals: { actions: 0, closed: 0, remanded: 0, remandPct: null },
  },
};

describe("MDL bridge", () => {
  it("does date arithmetic exactly", () => {
    expect(daysBetween("2024-01-01", "2025-01-01")).toBe(366);
    expect(daysBetween("2024-01-01", null)).toBeNull();
    expect(monthOffset("2024-11-12", "2024-11-01")).toBe(0);
    expect(monthOffset("2024-11-12", "2025-01-01")).toBe(2);
  });

  it("builds survival subjects with delayed entry and drops what it cannot date", () => {
    const s = mdlSurvival(mdl);
    const by = new Map(s.subjects.map((x) => [x.id, x]));
    expect(by.get("3001")!.entry).toBeCloseTo(daysBetween("2014-10-01", "2024-10-01")! / 365.25, 9);
    expect(by.get("3001")!.event).toBe(false);
    expect(by.get("3002")!.entry).toBe(0);
    expect(by.get("3003")!.event).toBe(true);
    expect(by.get("3003")!.exit).toBeCloseTo(daysBetween("2019-10-01", "2024-12-15")! / 365.25, 9);
    expect(s.dropped).toEqual([{ mdl: 3004, reason: "transfer date not recorded" }]);
    expect(s.massTort.has("3002")).toBe(true);
    const km = kaplanMeier(s.subjects);
    expect(km.events).toBe(1);
  });

  it("aligns growth on the transfer month, only for MDLs created inside the report window", () => {
    const g = mdlGrowthAligned(mdl);
    expect(g.rows).toEqual([
      { mdl: 3002, offset: 0, pending: 3 },
      { mdl: 3002, offset: 1, pending: 9 },
      { mdl: 3002, offset: 2, pending: 20 },
    ]);
    expect(g.cases).toEqual([
      {
        mdl: 3002,
        label: "MDL 3002: In re New",
        transferred: "2024-11-12",
        months: 2,
        massTort: true,
        latestPending: 20,
      },
    ]);
  });

  it("defines snapshot facts per report", () => {
    expect(mdlMetricDefs(mdl).map((d) => d.id)).toEqual([
      "mdl.pending_actions",
      "mdl.total_actions",
    ]);
    const facts = mdlFacts(mdl, "mdl.pending_actions", { period: "2024-10-01" });
    expect(facts.map((f) => [f.entityId, f.value])).toEqual([
      ["3001", 50],
      ["3003", 2],
    ]);
  });

  it("builds the origin sankey from listed courts plus the remainder of the record's total", () => {
    const s = originSankey(
      [
        {
          mdl: 2738,
          title: "Talc",
          actions: 100,
          records: null,
          jpmlTotal: null,
          jpmlPending: null,
          registrySharePct: null,
          masterDocket: null,
          transfereeCourt: { id: "njd", name: "D.N.J." },
          transfereeJudge: null,
          judgeAsPrinted: null,
          memberJudges: { joined: null, top: [] },
          byBasis: [],
          membersByYear: [],
          origin: {
            dockets: 50,
            courts: 3,
            states: 2,
            medianDaysToClose: null,
            daysN: null,
            byYear: [],
            byCourt: [
              { courtId: "cand", court: "N.D. Cal.", state: "CA", dockets: 30, link: null },
              { courtId: "ilnd", court: "N.D. Ill.", state: "IL", dockets: 12, link: null },
            ],
            byState: [],
          },
        },
      ],
      1,
    );
    expect(s.links).toEqual([
      { source: "court:cand", target: "mdl:2738", value: 30 },
      { source: "court:other", target: "mdl:2738", value: 20 },
    ]);
    expect(s.total).toBe(50);
  });

  it("turns co-counsel pairs into a network", () => {
    const n = coCounselNetwork({
      cocounsel: [
        { a: { firm: "A", href: null }, b: { firm: "B", href: null }, weight: 5, mdls: [] },
        { a: { firm: "B", href: null }, b: { firm: "C", href: null }, weight: 3, mdls: [] },
      ],
      opposing: [],
      dropped: 0,
    });
    expect(n.nodes.find((x) => x.id === "B")!.weight).toBe(2);
    expect(n.edges).toHaveLength(2);
  });
});

describe("adapter helpers", () => {
  it("tells bridged ids from data-layer ids", () => {
    expect(isBridgeMetric("sm.population")).toBe(true);
    expect(isBridgeMetric("fjc_civil_filed")).toBe(false);
  });

  it("joins two metrics on the exact entity id only", () => {
    const f = (id: string, v: number | null) => ({
      metricId: "m",
      entityType: "state" as const,
      entityId: id,
      period: "2023",
      periodStart: "2023-01-01",
      periodEnd: "2023-12-31",
      value: v,
      moe: null,
      partial: false,
      n: null,
      notRecordedReason: null,
    });
    const pts = joinCross(
      [f("CA", 1), f("TX", 2), f("NY", null)],
      [f("CA", 10), f("tx", 20), f("NY", 5)],
      "2023",
      "2023",
    );
    expect(pts.map((p) => [p.entityId, p.x, p.y])).toEqual([["CA", 1, 10]]);
  });
});

describe("fixtures (dev only)", () => {
  it("are off in tests and production builds unless the dev flag is set", () => {
    expect(INSIGHTS_FIXTURES).toBe(false);
  });

  it("follow the contract shapes and label themselves as fixtures", async () => {
    expect(fixtureCatalog.every((m) => m.label.startsWith("[Fixture]"))).toBe(true);
    const def = fixtureCatalog[0]!;
    const snap = await fixtureLayer.snapshot({
      metric: def.id,
      entityType: "state",
      period: "FY2024",
    });
    expect(snap.length).toBe(51);
    expect(snap.some((f) => f.value === null && f.notRecordedReason)).toBe(true);
    const latest = await fixtureLayer.latest({ metric: def.id, entityType: "state" });
    expect(latest.every((f) => !f.partial)).toBe(true);
    const study = await fixtureLayer.eventStudy!();
    expect(study.cases.length).toBeGreaterThan(5);
  });
});

describe("KPI board model", () => {
  const block: TrendBlockData = {
    id: "federal-civil",
    xKind: "fy",
    chart: "line",
    stacked: false,
    format: "count",
    unit: "cases",
    series: [
      {
        id: "filed",
        label: "Filed",
        points: [
          { x: "2021", value: 100 },
          { x: "2022", value: 110 },
          { x: "2023", value: 121 },
          { x: "2024", value: 133 },
          { x: "2025", value: 150 },
          { x: "2026", value: 30, partial: true },
        ],
      },
    ],
    primary: 0,
    latest: {
      period: "FY2025",
      seriesLabel: "Filed",
      value: 150,
      change: {
        comparedWith: "FY2024",
        previousValue: 133,
        absolute: 17,
        percent: (17 / 133) * 100,
      },
      changeNote: null,
    },
    period: "FY2021–FY2026*",
    source: { label: "FJC", url: "https://www.fjc.gov/research/idb" },
    asOf: null,
    notes: [],
    gaps: 0,
    markers: [],
  };

  it("builds a tile from a hub block with its change and partial note", () => {
    const k = kpiFromBlock(block, "Federal civil cases filed", "courts");
    expect(k.value).toBe("150");
    expect(k.changeText).toBe("+17 (+12.8%) vs FY2024");
    expect(k.completePeriods).toBe(5);
    expect(k.partialNote).toContain("FY2026 is a partial period");
    expect(k.href).toEqual({
      to: "/insights/trends",
      hash: "block-federal-civil",
      search: { view: "national" },
    });
  });

  it("builds a tile from nation facts and withholds a change across a gap", async () => {
    const def = fixtureCatalog.find((m) => m.id === "fixture_cfpb_per_100k")!;
    const facts = await fixtureLayer.series({
      metric: def.id,
      entityType: "nation",
      entityIds: ["US"],
    });
    const k = kpiFromFacts(def, facts, { to: "/insights/trends" });
    expect(k.value).not.toBeNull();
    expect(k.periodText).toBe("2025");
    const gapped = facts.map((f) => (f.period === "2024" ? { ...f, value: null } : f));
    const g = kpiFromFacts(def, gapped, { to: "/insights/trends" });
    expect(g.changeText).toBeNull();
    expect(g.changeNote).toContain("2024 is not recorded");
  });

  it("ranks notable movements by absolute percent among tiles with enough history", () => {
    const base = kpiFromBlock(block, "A", "courts");
    const tiles: Kpi[] = [
      { ...base, id: "a", title: "A", changePercent: 5 },
      { ...base, id: "b", title: "B", changePercent: -40 },
      { ...base, id: "c", title: "C", changePercent: 90, completePeriods: 3 },
      { ...base, id: "d", title: "D", changePercent: null },
    ];
    expect(notableMovements(tiles).map((t) => t.id)).toEqual(["b", "a"]);
  });
});
