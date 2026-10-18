import { beforeEach, describe, expect, it, vi } from "vitest";

type Call = { path: string; opts: { range?: [number, number] } | undefined };
const calls: Call[] = [];
let respond: (path: string, opts?: { range?: [number, number] }) => unknown = () => [];

vi.mock("@/lib/external/rest.server", () => ({
  restGet: vi.fn(async (path: string, opts?: { range?: [number, number] }) => {
    calls.push({ path, opts });
    return { rows: respond(path, opts), total: null };
  }),
}));

beforeEach(() => {
  calls.length = 0;
  respond = () => [];
  vi.resetModules();
});

describe("judge parsers", () => {
  it("parses a scatter point and rejects one without a name or id", async () => {
    const { parsePoint, parseDistrict } = await import("./judge");
    expect(
      parsePoint({
        nid: "n1",
        name: "Judge A",
        court_id: "njd",
        party: "Democratic",
        pending_mdl_count: 2,
        pending_actions: 40,
        historical_mdl_count: 3,
        total_actions_handled: 90,
        pending_share_pct: 1.5,
        judge_profile_id: "p1",
      }),
    ).toEqual({
      nid: "n1",
      name: "Judge A",
      courtId: "njd",
      party: "Democratic",
      pendingMdls: 2,
      pendingActions: 40,
      historicalMdls: 3,
      totalActions: 90,
      sharePct: 1.5,
      profileId: "p1",
    });
    expect(parsePoint({ nid: "n1" })).toBeNull();
    expect(parsePoint({ name: "x" })).toBeNull();
    expect(parsePoint(null)).toBeNull();
    expect(parsePoint({ nid: "n", name: "J", pending_actions: "40" })!.pendingActions).toBe(0);
    expect(
      parseDistrict({
        court_id: "njd",
        name: "D.N.J.",
        pending_mdls: 12,
        pending_actions: 84_000,
        judgeships: 17,
        share_pending_pct: 41,
      }),
    ).toMatchObject({ courtId: "njd", pendingActions: 84_000, judgeships: 17 });
    expect(parseDistrict({ name: "x" })).toBeNull();
  });

  it("returns null for a summary without an as_of date or without any judge", async () => {
    const { parseJudgeInput } = await import("./judge");
    expect(parseJudgeInput({ scatter: [{ nid: "n", name: "J" }] }, null)).toBeNull();
    expect(parseJudgeInput({ as_of: "2026-10-01", scatter: [] }, null)).toBeNull();
    const ok = parseJudgeInput(
      {
        as_of: "2026-10-01",
        pending_mdls: 5,
        scatter: [{ nid: "n", name: "J", pending_actions: 3 }],
      },
      null,
    );
    expect(ok).toMatchObject({ asOf: "2026-10-01", national: null, pendingMdls: 5 });
    expect(ok!.points).toHaveLength(1);
  });

  it("reads the national block: circuits keyed 0 to 11 and district rows", async () => {
    const { parseJudgeInput } = await import("./judge");
    const d = parseJudgeInput(
      { as_of: "2026-10-01", scatter: [{ nid: "n", name: "J" }] },
      {
        as_of: "2026-10-01",
        districts: 91,
        sitting: 100,
        active: 60,
        senior: 40,
        party_active: { Democratic: 35, Republican: 25 },
        circuits: {
          "3": { active: 5, senior: 2, pending_mdls: 4, pending_actions: 90 },
          bogus: { active: 1 },
        },
        rows: [{ court_id: "njd", name: "D.N.J.", pending_actions: 10 }, { name: "no id" }],
      },
    )!;
    expect(Object.keys(d.national!.circuits)).toEqual(["3"]);
    expect(d.national!.circuits["3"]).toEqual({
      active: 5,
      senior: 2,
      pendingMdls: 4,
      pendingActions: 90,
    });
    expect(d.national!.rows).toHaveLength(1);
    expect(d.national!.partyActive).toEqual({ Democratic: 35, Republican: 25 });
  });
});

describe("mdl parsers", () => {
  it("parses the overview and sorts the portfolio by date", async () => {
    const { parseOverview } = await import("./mdl");
    const o = parseOverview({
      as_of: "2026-10-01",
      pending_actions: 200,
      pending_mdls: 50,
      portfolio: [
        { date: "2026-10-01", pending: 200 },
        { date: "2024-10-01", pending: 400, mdls: 70 },
        { date: "bad", pending: 1 },
        { date: "2025-10-01" },
      ],
      fastest_growing: [{ mdl: 3140, title: "T", pending: 10, change_12m: 5 }, { mdl: "x" }],
      by_type: [{ key: "Products Liability", pending: 9 }],
    })!;
    expect(o.portfolio.map((p) => p.date)).toEqual(["2024-10-01", "2026-10-01"]);
    expect(o.firstReport).toBe("2024-10-01");
    expect(o.fastestGrowing).toEqual([{ mdl: 3140, title: "T", pending: 10, change12m: 5 }]);
    expect(o.byType).toEqual([
      { key: "Products Liability", mdls: 0, pending: 9, total: 0, change12m: 0 },
    ]);
    expect(parseOverview({ as_of: "2026-10-01" })).toBeNull();
    expect(parseOverview(null)).toBeNull();
  });

  it("parses rows and terminated-history records and rejects incomplete ones", async () => {
    const { parseRow, parseTerminated } = await import("./mdl");
    expect(
      parseRow({
        mdl: 2738,
        title: "T",
        type: "Products Liability",
        status: "terminated",
        pending: 0,
        total: 5,
        change12: -1,
        age: 7.5,
        rank: 3,
        share: 2,
      }),
    ).toMatchObject({ mdl: 2738, status: "terminated", change12m: -1, ageYears: 7.5 });
    expect(parseRow({ mdl: 1, status: "weird" })!.status).toBe("pending");
    expect(parseRow({ title: "no number" })).toBeNull();
    expect(
      parseTerminated({
        mdl: 100,
        caption: "IN RE X",
        district_name: "D. X",
        termination_year: 1999,
        actions_closed: 10,
        actions_remanded: 2,
      }),
    ).toEqual({
      mdl: 100,
      caption: "IN RE X",
      district: "D. X",
      year: 1999,
      closed: 10,
      remanded: 2,
    });
    expect(parseTerminated({ mdl: 100, termination_year: 1999, actions_closed: 10 })).toBeNull();
  });

  it("pages through the terminated history until a short page and uses the Range header", async () => {
    const page = (n: number) =>
      Array.from({ length: n }, (_, i) => ({
        h: {
          mdl: i,
          caption: "c",
          district_name: "d",
          termination_year: 2000,
          actions_closed: 1,
          actions_remanded: 0,
        },
      }));
    respond = (path, opts) => {
      if (path.includes("mdl_terminated_history"))
        return opts?.range?.[0] === 0 ? page(1000) : page(40);
      if (path.includes("summary:overview"))
        return [{ o: { as_of: "2026-10-01", pending_actions: 1, pending_mdls: 1 } }];
      return [];
    };
    const { readMdl } = await import("./mdl");
    const mdl = await readMdl();
    expect(mdl!.terminated).toHaveLength(1040);
    const ranges = calls
      .filter((c) => c.path.includes("mdl_terminated_history"))
      .map((c) => c.opts?.range);
    expect(ranges).toEqual([
      [0, 999],
      [1000, 1999],
    ]);
  });

  it("is null when the overview record is not published", async () => {
    const { readMdl } = await import("./mdl");
    expect(await readMdl()).toBeNull();
  });
});

describe("safety parsers", () => {
  it("keeps only whole years with a report count and carries the partial flag", async () => {
    const { parseYears, parseMaudeYears } = await import("./safety");
    expect(
      parseYears([
        { year: 2025, reports: 10, deaths: 1 },
        { year: 2026, reports: 3, partial: true },
        { year: 2025.5, reports: 1 },
        { year: 2024 },
        null,
      ]),
    ).toEqual([
      { year: 2025, reports: 10, partial: false, deaths: 1, serious: null, lawyer: null },
      { year: 2026, reports: 3, partial: true, deaths: null, serious: null, lawyer: null },
    ]);
    expect(
      parseMaudeYears([
        { year: 2025, reports: 10, death: 1, injury: 3, malfunction: 6 },
        { year: 2024, reports: 5 },
      ]),
    ).toHaveLength(1);
  });
});

describe("readers", () => {
  it("reads state metrics and series with only the selected paths, dropping malformed states", async () => {
    respond = (path) =>
      path.includes("state_metrics_national")
        ? [
            {
              metric: {
                key: "overdose_rate",
                label: "Overdose death rate",
                format: "rate",
                latestYear: 2025,
              },
            },
            { metric: { key: "BAD KEY", label: "x", format: "rate" } },
          ]
        : [
            {
              usps: "TX",
              name: "Texas",
              s_overdose_rate: { "2025": 12.5, bad: 1 },
              s_population: { "2025": 30_000_000 },
            },
            { usps: "tx", name: "lower", s_overdose_rate: { "2025": 1 } },
            { usps: "OK", name: "", s_overdose_rate: { "2025": 1 } },
          ];
    const { readStateMetrics } = await import("./state");
    const d = await readStateMetrics();
    expect(d!.metrics.map((m) => m.key)).toEqual(["overdose_rate"]);
    expect(d!.states).toEqual([
      {
        usps: "TX",
        name: "Texas",
        series: { overdose_rate: { "2025": 12.5 }, population: { "2025": 30_000_000 } },
      },
    ]);
    const profileCall = calls.find((c) => c.path.includes("state_metrics_profiles"))!;
    expect(profileCall.path).toContain("s_overdose_rate:item->profile->series->overdose_rate");
    expect(profileCall.path).not.toContain("select=*");
  });

  it("is null when metrics or states are missing", async () => {
    const { readStateMetrics } = await import("./state");
    expect(await readStateMetrics()).toBeNull();
  });

  it("takes the NHTSA latest complete year as the year before the newest one in the file", async () => {
    respond = () => [
      { make: "FORD", component: "BRAKES", total: 10, years: { "2024": 4, "2025": 5, "2026": 1 } },
      { make: "KIA", component: "AIR BAGS", total: 3, years: { "2025": 3, junk: 9 } },
      { make: "", component: "x", total: 1, years: { "2025": 1 } },
      { make: "GMC", component: "x", total: 1, years: null },
    ];
    const { readNhtsa } = await import("./safety");
    const d = await readNhtsa();
    expect(d!.latestCompleteYear).toBe(2025);
    expect(d!.rows.map((r) => r.make)).toEqual(["FORD", "KIA"]);
    expect(d!.rows[1]!.years).toEqual({ "2025": 3 });
  });

  it("returns null for FAERS, MAUDE and CAERS when no usable year is stored", async () => {
    const { readFaers, readMaude, readCaers, readNhtsa } = await import("./safety");
    expect(await readFaers()).toBeNull();
    expect(await readMaude()).toBeNull();
    expect(await readCaers()).toBeNull();
    expect(await readNhtsa()).toBeNull();
  });

  it("reads the CAERS year, total and industry rows by record kind", async () => {
    respond = () => [
      { id: "all_years", kind: "caers_total", total: 151_589, dt: "2026-03-31" },
      { id: "y2025", kind: "caers_year", point: { year: 2025, reports: 6308 } },
      { id: "i1", kind: "caers_industry", name: "Cosmetics", reports: 52_219 },
      { id: "i2", kind: "caers_industry", name: "", reports: 5 },
    ];
    const { readCaers } = await import("./safety");
    const d = await readCaers();
    expect(d).toMatchObject({ total: 151_589, dataThrough: "2026-03-31" });
    expect(d!.years.map((y) => y.year)).toEqual([2025]);
    expect(d!.industries).toEqual([{ name: "Cosmetics", reports: 52_219 }]);
  });

  it("rejects when the corpus read itself fails, so the pipeline can drop only that source", async () => {
    vi.doMock("@/lib/external/rest.server", () => ({
      restGet: vi.fn(async () => {
        throw new Error("External corpus read failed (500).");
      }),
    }));
    const { readJudges } = await import("./judge");
    await expect(readJudges()).rejects.toThrow("External corpus read failed (500).");
    vi.doUnmock("@/lib/external/rest.server");
  });
});
