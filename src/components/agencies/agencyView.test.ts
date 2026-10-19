import { describe, expect, it } from "vitest";
import type {
  AdminRow,
  AgencyProfileData,
  AgencyTrends,
  DirectoryRow,
} from "@/lib/external/agencyProfile.functions";
import {
  adminBands,
  adminForYear,
  agencyTakeaways,
  buildTree,
  filterDirectory,
  lastYearVsAverage,
  perResidentByFips,
  spendingConcentration,
  sortDirectory,
  yearRows,
  yearToDate,
} from "./agencyView";

const admin = (
  key: string,
  start: string,
  end: string,
  extra: Partial<AdminRow> = {},
): AdminRow => ({
  key,
  label: key,
  president: key,
  start,
  end,
  days: 1461,
  current: false,
  ALL: null,
  RULE: 0,
  PRORULE: 0,
  NOTICE: 0,
  PRESDOCU: null,
  executiveOrders: null,
  significantRules: 0,
  rulesPerYear: null,
  significantRulesPerYear: null,
  executiveOrdersPerYear: null,
  ...extra,
});

const admins = [
  admin("biden", "2021-01-20", "2025-01-19", {
    significantRules: 78,
    significantRulesPerYear: 19.5,
  }),
  admin("trump2", "2025-01-20", "2026-10-19", {
    current: true,
    days: 638,
    significantRules: 22,
    significantRulesPerYear: 12.6,
  }),
];

const trends: AgencyTrends = {
  asOf: "2026-10-19",
  partialYear: "2026",
  partialMonth: "2026-10",
  yearly: {
    ALL: {},
    RULE: {
      "2020": 400,
      "2021": 400,
      "2022": 400,
      "2023": 400,
      "2024": 400,
      "2025": 600,
      "2026": 10,
    },
    PRORULE: {},
    NOTICE: {},
    PRESDOCU: {},
  },
  monthly: {
    RULE: Object.fromEntries(
      Array.from({ length: 9 }, (_, i) => [
        [`2025-0${i + 1}`, 10],
        [`2026-0${i + 1}`, 12],
      ]).flat(),
    ),
    PRORULE: {},
    NOTICE: {},
  },
  byAdministration: admins,
  significantYearly: { RULE: {}, PRORULE: {} },
  significantTotals: { RULE: 100, PRORULE: 50 },
  latestSignificantRules: [],
  latestSignificantProposed: [],
  openComments: { asOf: "2026-10-19", count: 5, closingWithin30Days: 2, byType: {}, items: [] },
  shareOfFinalRules: { "2025": 7.5 },
};

const row = (id: number, name: string, extra: Partial<DirectoryRow> = {}): DirectoryRow => ({
  id,
  name,
  shortName: null,
  kind: "independent",
  parentId: null,
  childCount: 0,
  documentsSince1994: 0,
  rulesLastYear: 0,
  proposedLastYear: 0,
  noticesLastYear: 0,
  rulesThisYear: 0,
  significantRules: 0,
  openComments: 0,
  agendaActions: 0,
  agendaEconomicallySignificant: 0,
  obligationsLatestFy: null,
  budgetaryResourcesLatestFy: null,
  lastActiveYear: "2026",
  lastFullYear: "2025",
  latestFy: 2025,
  ...extra,
});

describe("activity rows and administration bands", () => {
  it("assigns a year to the administration in office on July 1", () => {
    expect(adminForYear("2025", admins)?.key).toBe("trump2");
    expect(adminForYear("2024", admins)?.key).toBe("biden");
    expect(adminForYear("2019", admins)).toBeNull();
  });

  it("marks the current year partial and groups contiguous years into bands", () => {
    const rows = yearRows(trends, 2021);
    expect(rows.map((r) => r.year)).toEqual(["2021", "2022", "2023", "2024", "2025", "2026"]);
    expect(rows.at(-1)?.partial).toBe(true);
    expect(adminBands(rows, admins)).toEqual([
      { key: "biden", label: "biden", x1: "2021", x2: "2024", index: 0 },
      { key: "trump2", label: "trump2", x1: "2025", x2: "2026", index: 1 },
    ]);
  });

  it("compares the last complete year with the five years before it", () => {
    expect(lastYearVsAverage(trends.yearly.RULE, "2026")).toEqual({
      year: "2025",
      from: "2020",
      to: "2024",
      value: 600,
      avg5: 400,
      ratio: 1.5,
    });
  });

  it("compares complete months only and refuses a gap", () => {
    expect(yearToDate(trends.monthly.RULE, "2026-10")).toEqual({
      through: "2026-09",
      months: 9,
      current: 108,
      previous: 90,
      changePct: 20,
    });
    expect(yearToDate({ "2026-01": 1 }, "2026-03")).toBeNull();
    expect(yearToDate({}, "2026-01")).toBeNull();
  });
});

describe("takeaways", () => {
  it("states each comparison with its base and skips unknown figures", () => {
    const data: AgencyProfileData = { profile: null, trends, budget: null, spending: null };
    const t = agencyTakeaways(data);
    expect(t.map((x) => x.id)).toEqual([
      "rules-vs-average",
      "rules-ytd",
      "significant-pace",
      "share-of-rules",
      "open-comments",
    ]);
    expect(t[0]?.figure).toBe("1.5×");
    expect(t[0]?.text).toContain("2020–2024 average (400");
    expect(t[1]?.figure).toBe("+20.0%");
    expect(t[2]?.text).toContain("under biden");
  });

  it("shows nothing rather than a lone line", () => {
    const sparse: AgencyTrends = {
      ...trends,
      yearly: { ...trends.yearly, RULE: {} },
      monthly: { RULE: {}, PRORULE: {}, NOTICE: {} },
      byAdministration: [],
      shareOfFinalRules: {},
      openComments: { ...trends.openComments, count: 0 },
    };
    expect(
      agencyTakeaways({ profile: null, trends: sparse, budget: null, spending: null }),
    ).toEqual([]);
  });
});

describe("directory", () => {
  const rows = [
    row(1, "Health and Human Services Department", { kind: "department", rulesLastYear: 125 }),
    row(2, "Food and Drug Administration", {
      kind: "component",
      parentId: 1,
      rulesLastYear: 74,
      shortName: "FDA",
    }),
    row(3, "ACTION", { lastActiveYear: "1995", obligationsLatestFy: null }),
    row(4, "Environmental Protection Agency", { rulesLastYear: 281, obligationsLatestFy: 3e10 }),
  ];

  it("sorts unknown values last in either direction", () => {
    // Recorded value first; unknowns follow in name order.
    expect(sortDirectory(rows, "obligationsLatestFy", true).map((r) => r.id)).toEqual([4, 3, 2, 1]);
    expect(sortDirectory(rows, "obligationsLatestFy", false)[0]?.id).toBe(4);
    expect(sortDirectory(rows, "rulesLastYear", true).map((r) => r.id)).toEqual([4, 1, 2, 3]);
  });

  it("filters by name, short name, kind and recent activity", () => {
    expect(filterDirectory(rows, "fda", "all", false).map((r) => r.id)).toEqual([2]);
    expect(filterDirectory(rows, "", "department", false).map((r) => r.id)).toEqual([1]);
    expect(filterDirectory(rows, "", "all", true).map((r) => r.id)).toEqual([1, 2, 4]);
  });

  it("nests components under their parent and keeps orphans as roots", () => {
    const tree = buildTree([...rows, row(5, "Orphan", { parentId: 999 })]);
    const hhs = tree.find((n) => n.row.id === 1);
    expect(hhs?.children.map((c) => c.row.id)).toEqual([2]);
    expect(tree.map((n) => n.row.id)).toContain(5);
    expect(tree.map((n) => n.row.id)).not.toContain(2);
  });

  it("measures concentration against the 50-state median, excluding DC", () => {
    const state = (code: string, perResident: number | null) => ({
      code,
      name: code,
      fy2025: 1,
      fy2024: null,
      changePct: null,
      population2025: 1,
      perResident,
      perResidentRank: null,
      sharePct: null,
    });
    const base = {
      toptierCode: "075",
      name: "HHS",
      fiscalYear: 2025,
      total: 1,
      total2024: null,
      statesWithSpending: 3,
      denominator: null,
    };
    const c = spendingConcentration({
      ...base,
      medianPerResidentStates: 100,
      states: [state("ND", 112000), state("DC", 999999), state("VA", 90)],
    });
    expect(c?.top.code).toBe("ND");
    expect(c?.ratio).toBe(1120);
    expect(
      spendingConcentration({ ...base, medianPerResidentStates: null, states: [] }),
    ).toBeNull();
  });

  it("maps per-resident amounts to FIPS and omits states without a population", () => {
    const m = perResidentByFips({
      toptierCode: "068",
      name: "EPA",
      fiscalYear: 2025,
      total: 1,
      total2024: null,
      statesWithSpending: 2,
      medianPerResidentStates: null,
      denominator: null,
      states: [
        {
          code: "VA",
          name: "Virginia",
          fy2025: 1,
          fy2024: null,
          changePct: null,
          population2025: 1,
          perResident: 1,
          perResidentRank: 1,
          sharePct: null,
        },
        {
          code: "GU",
          name: "Guam",
          fy2025: 1,
          fy2024: null,
          changePct: null,
          population2025: null,
          perResident: null,
          perResidentRank: null,
          sharePct: null,
        },
      ],
    });
    expect([...m.entries()]).toEqual([["51", 1]]);
  });
});
