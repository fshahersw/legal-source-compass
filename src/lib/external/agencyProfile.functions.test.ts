import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getAgencyProfile,
  listAgencyDirectory,
  parseBudget,
  parseDirectory,
  parseOverview,
  parseProfile,
  parseSpending,
  parseTrends,
  webUrl,
  type AgencyDirectory,
  type AgencyProfileData,
} from "./agencyProfile.functions";

const rest = vi.hoisted(() => vi.fn());
vi.mock("./rest.server", () => ({ restGet: rest, rpcPost: vi.fn() }));
vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => ({
    handler: (handler: unknown) => handler,
    inputValidator: () => ({ handler: (handler: unknown) => handler }),
  }),
}));

const stats = {
  kind: "independent",
  parentId: null,
  childCount: 0,
  documentsSince1994: 59980,
  rulesLastYear: 281,
  proposedLastYear: 242,
  noticesLastYear: 369,
  rulesThisYear: 244,
  significantRules: 845,
  openComments: 43,
  agendaActions: 214,
  agendaEconomicallySignificant: 24,
  obligationsLatestFy: 34262577412.72,
  budgetaryResourcesLatestFy: null,
  lastActiveYear: "2026",
  lastFullYear: "2025",
  latestFy: 2025,
};

const profile = {
  id: 145,
  name: "Environmental Protection Agency",
  shortName: "EPA",
  slug: "environmental-protection-agency",
  frUrl: "https://www.federalregister.gov/agencies/environmental-protection-agency",
  agencyUrl: "javascript:alert(1)",
  parent: null,
  children: [
    { id: 1, name: "Child" },
    { id: "x", name: "Bad" },
  ],
  ecfr: {
    refs: [
      { title: 40, chapter: "I", url: "https://www.ecfr.gov/current/title-40/chapter-I" },
      { title: 40, chapter: "IV", url: "https://evil.example/title-40" },
    ],
  },
  cfrParts: {
    distinctParts: 2,
    distinctTitles: 1,
    top: [
      {
        title: 40,
        part: "52",
        docs: 24302,
        rules: 15000,
        first: "1994",
        last: "2026",
        url: "https://www.ecfr.gov/current/title-40/part-52",
      },
      { title: 40, part: "<script>", docs: 3, url: "https://www.ecfr.gov/current/title-40/part-x" },
    ],
    titles: [{ title: 40, titleName: "Protection of Environment", partCitations: 24305 }],
    corpusRange: ["1994-01-03", "2026-10-16"],
  },
  govman: {
    name: "Environmental Protection Agency",
    // Stored leadership tables (if any ever reappear) are ignored: names are not shown without a reliable as-of date.
    leadership: [{ header: "", url: null, rows: [{ name: "A Person", title: "ADMINISTRATOR" }] }],
    components: ["Office of Water", 7],
    legalAuthority: "Reorganization Plan No. 3 of 1970",
    edition: "2025-12-31",
    sourceUrl: "https://www.govinfo.gov/bulkdata/GOVMAN/2025/GOVMAN-2025-12-31.zip",
    pageUrl: "https://www.govinfo.gov/app/details/GOVMAN-2025-12-31",
  },
  usaspending: {
    toptierCode: "068",
    name: "Environmental Protection Agency",
    usaspendingUrl: "https://www.usaspending.gov/agency/environmental-protection-agency",
  },
  agenda: {
    total: 214,
    byStage: { "Final Rule Stage": 37, "Proposed Rule Stage": "x" },
    byPriority: { "Economically Significant": 24 },
    edition: "202510",
    items: [
      {
        rin: "2060-AX01",
        title: "T",
        url: "https://www.reginfo.gov/public/do/eAgendaViewRule?pubId=202510&RIN=2060-AX01",
        nextAction: { action: "NPRM", date: "11/00/2026", month: "2026-11", passed: false },
      },
      { rin: "bad", title: "T", url: "https://www.reginfo.gov/x" },
      { rin: "2060-AX02", title: "T", url: "https://example.com/x" },
    ],
  },
  enforcement: {
    page: { to: "/law/enforcement", search: { tab: "osha" } },
    datasets: [
      { id: "osha_employers", label: "OSHA employers", records: 1000 },
      { id: "Bad Id", records: 1 },
    ],
  },
  stats,
};

beforeEach(() => vi.clearAllMocks());

describe("agency profile parsing", () => {
  it("keeps only official links and well-formed rows", () => {
    const p = parseProfile(profile)!;
    expect(p.agencyUrl).toBeNull();
    expect(p.children).toEqual([{ id: 1, name: "Child" }]);
    expect(p.ecfr?.refs.map((r) => r.chapter)).toEqual(["I"]);
    expect(p.cfrParts?.top.map((r) => r.part)).toEqual(["52"]);
    expect(p.govman).not.toHaveProperty("leadership");
    expect(p.govman?.components).toEqual(["Office of Water"]);
    expect(p.govman?.legalAuthority).toBe("Reorganization Plan No. 3 of 1970");
    expect(p.agenda?.byStage).toEqual({ "Final Rule Stage": 37 });
    expect(p.agenda?.items.map((i) => i.rin)).toEqual(["2060-AX01"]);
    expect(p.enforcement?.datasets.map((d) => d.id)).toEqual(["osha_employers"]);
    expect(p.enforcement?.page).toEqual({ to: "/law/enforcement", search: { tab: "osha" } });
  });

  it("drops a profile without its identity, official page or statistics", () => {
    expect(parseProfile({ ...profile, frUrl: "https://example.com" })).toBeNull();
    expect(parseProfile({ ...profile, stats: { ...stats, kind: "agency" } })).toBeNull();
    expect(parseProfile(null)).toBeNull();
  });

  it("keeps an unknown budget value distinct from zero", () => {
    const p = parseProfile(profile)!;
    expect(p.stats.budgetaryResourcesLatestFy).toBeNull();
    expect(p.stats.obligationsLatestFy).toBe(34262577412.72);
  });

  it("rejects in-app targets outside the known routes", () => {
    const p = parseProfile({
      ...profile,
      enforcement: { page: { to: "/admin", search: {} }, datasets: [] },
    })!;
    expect(p.enforcement?.page).toBeNull();
  });

  it("accepts plain web addresses only", () => {
    expect(webUrl("http://www.epa.gov/")).toBe("http://www.epa.gov/");
    expect(webUrl("https://www.fda.gov/about")).toBe("https://www.fda.gov/about");
    expect(webUrl("ftp://x.gov")).toBeNull();
    expect(webUrl("https://user@evil")).toBeNull();
  });
});

describe("trends, budget and spending parsing", () => {
  const trends = {
    asOf: "2026-10-19",
    partialYear: "2026",
    partialMonth: "2026-10",
    yearly: {
      ALL: { "2025": 900, bogus: 1 },
      RULE: { "2025": 281 },
      PRORULE: {},
      NOTICE: {},
      PRESDOCU: {},
    },
    monthly: { RULE: { "2026-09": 20, "2026": 3 }, PRORULE: {}, NOTICE: {} },
    byAdministration: [
      {
        key: "biden",
        label: "Biden",
        start: "2021-01-20",
        end: "2025-01-19",
        days: 1461,
        RULE: 1554,
        significantRules: 78,
      },
      { key: "broken", start: "2021", end: "2025-01-19", days: 1, RULE: 1 },
    ],
    significantYearly: { RULE: { "2025": 30 }, PRORULE: {} },
    significantTotals: { RULE: 845, PRORULE: 1184 },
    latestSignificantRules: [
      { title: "A", url: "https://www.federalregister.gov/d/1" },
      { title: "B", url: "https://x.com" },
    ],
    openComments: { asOf: "2026-10-19", count: 43, closingWithin30Days: 40, items: [] },
    shareOfFinalRules: { "2025": 11.5, "2024": 140 },
  };

  it("validates series keys, administrations and document links", () => {
    const t = parseTrends(trends)!;
    expect(t.yearly.ALL).toEqual({ "2025": 900 });
    expect(t.monthly.RULE).toEqual({ "2026-09": 20 });
    expect(t.byAdministration.map((a) => a.key)).toEqual(["biden"]);
    expect(t.latestSignificantRules.map((d) => d.title)).toEqual(["A"]);
    expect(t.shareOfFinalRules).toEqual({ "2025": 11.5 });
    expect(parseTrends({ ...trends, asOf: "today" })).toBeNull();
  });

  it("reads the Federal Register overview extras", () => {
    const o = parseOverview({
      ...trends,
      presidentialYearly: { executive_order: { "2025": 225 }, "Bad Key": {} },
      executiveOrders: {
        total: 1571,
        yearly: { "2025": 225 },
        latest: [
          {
            number: "14435",
            title: "T",
            signed: "2026-10-05",
            url: "https://www.federalregister.gov/d/2026-20855",
          },
          { number: "1", title: "T", signed: "2026-10-05", url: "https://example.com" },
        ],
      },
      topAgenciesByRules: {
        year: "2025",
        rows: [
          { agencyId: 492, name: "Transportation Department", kind: "department", rules: 703 },
        ],
      },
      agenda: { total: 3954, byStage: {}, byPriority: {}, edition: "202510", items: [] },
    })!;
    expect(Object.keys(o.presidentialYearly)).toEqual(["executive_order"]);
    expect(o.executiveOrders.latest.map((e) => e.number)).toEqual(["14435"]);
    expect(o.topAgencies.rows[0]?.kind).toBe("department");
    expect(o.agenda?.total).toBe(3954);
  });

  it("parses budget years in order and keeps partial years flagged", () => {
    const b = parseBudget({
      toptierCode: "068",
      name: "EPA",
      years: [
        { fy: 2026, budgetaryResources: 1, obligated: null, partial: true, latestPeriod: 11 },
        { fy: 2025, budgetaryResources: 2, obligated: 3 },
        { fy: "2024" },
      ],
      subAgencies: [
        { name: "EPA", obligations: 5 },
        { name: "", obligations: 1 },
      ],
    })!;
    expect(b.years.map((y) => y.fy)).toEqual([2025, 2026]);
    expect(b.years[1]?.partial).toBe(true);
    expect(b.years[1]?.obligated).toBeNull();
    expect(b.subAgencies).toHaveLength(1);
    expect(parseBudget({ toptierCode: "abc" })).toBeNull();
  });

  it("keeps negative obligations and an unknown per-resident value", () => {
    const s = parseSpending({
      toptierCode: "068",
      total: 10,
      states: [
        { code: "VA", name: "Virginia", fy2025: -5, perResident: null },
        { code: "virginia", fy2025: 1 },
      ],
      denominator: { measure: "m", source: "https://www2.census.gov/x.csv", year: 2025 },
    })!;
    expect(s.states).toEqual([
      expect.objectContaining({ code: "VA", fy2025: -5, perResident: null }),
    ]);
    expect(s.denominator?.year).toBe(2025);
    expect(
      parseSpending({ ...s, denominator: { source: "https://example.com" } })?.denominator,
    ).toBeNull();
  });

  it("builds directory rows only from valid ids and statistics", () => {
    expect(
      parseDirectory([
        { id: "145", title: "EPA", sub: "EPA", stats },
        { id: "x", title: "Bad", stats },
        { id: "1", title: "No stats" },
      ]).map((r) => r.id),
    ).toEqual([145]);
  });
});

describe("agency profile reads", () => {
  it("reads budget and spending only for an agency with a USAspending match", async () => {
    rest.mockImplementation(async (path: string) => {
      if (path.includes("fr_agency_profiles")) return { rows: [{ v: profile }], total: null };
      if (path.includes("fr_agency_trends")) return { rows: [], total: null };
      if (path.includes("agency_budget_trends"))
        return { rows: [{ v: { toptierCode: "068", years: [] } }], total: null };
      if (path.includes("agency_spending_by_state")) return { rows: [], total: null };
      return { rows: [], total: null };
    });
    const read = getAgencyProfile as unknown as (i: {
      data: { id: string };
    }) => Promise<AgencyProfileData>;
    const out = await read({ data: { id: "145" } });
    expect(out.profile?.id).toBe(145);
    expect(out.trends).toBeNull();
    expect(out.budget?.toptierCode).toBe("068");
    expect(out.spending).toBeNull();
    expect(rest).toHaveBeenCalledWith(
      expect.stringContaining("dataset=eq.agency_budget_trends&id=eq.068"),
    );
  });

  it("surfaces a failed directory read instead of an empty directory", async () => {
    rest.mockRejectedValue(new Error("External corpus read failed (500)."));
    const read = listAgencyDirectory as unknown as () => Promise<AgencyDirectory>;
    await expect(read()).rejects.toThrow("read failed");
  });
});
