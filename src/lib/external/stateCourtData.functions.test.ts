import { describe, expect, it, vi } from "vitest";

vi.mock("./rest.server", () => ({ restGet: vi.fn() }));
vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => ({
    handler: (handler: unknown) => handler,
    inputValidator: () => ({ handler: (handler: unknown) => handler }),
  }),
}));

import {
  COURT_ID,
  buildStateCourtData,
  parseBenches,
  parseCivilCaseload,
  parseCourtListenerState,
  parseCourtSummaries,
  parseLargeCourts,
} from "./stateCourtData.functions";

const fy = (year: number, over: Record<string, unknown> = {}) => ({
  fy: year,
  filings: 1000 + year,
  terminations: 900 + year,
  pending_end: 500 + year,
  median_days: 200,
  partial: false,
  ...over,
});

// Shape of the fjc_civil_states row for Wyoming as selected by getStateCourtData.
const WY_CIVIL = {
  id: "WY",
  source_url:
    "https://www.fjc.gov/research/idb/civil-cases-filed-terminated-and-pending-sy-1988-present",
  cells: { class_action_pct: 2.2, pro_se_pct: 31.7, product_pct: 1, filings: 312 },
  latest: 2025,
  districts: ["wyd", "BAD/ID"],
  series: [
    fy(1988),
    fy(2004),
    fy(2005),
    fy(2024),
    fy(2025, { median_days: 217 }),
    fy(2026, { partial: true, median_days: 168 }),
  ],
  groups: [
    { label: "Contract", share_pct: 9, filings: 100 },
    { label: "Civil rights", share_pct: 22.6, filings: 300 },
    { label: "Broken", share_pct: 140, filings: 5 },
  ],
  from: 2021,
  to: 2025,
};

const WY_MASTER = {
  id: "state:WY",
  source_url: "https://example.com/dockets.csv.bz2",
  cells: { recap_pct: 88.7 },
  p: {
    state: "WY",
    courts: 3,
    dockets: 136018,
    clusters: 13414,
    civil: 11015,
    by_group: { State: 12437, Federal: 123581 },
    top_courts: [
      { court_id: "wyd", name: "District Court, D. Wyoming", dockets: 70066, link: "/courts/wyd" },
      { court_id: "wyb", name: "United States Bankruptcy Court, D. Wyoming", dockets: 53515 },
      { court_id: "WY/../x", name: "Injected", dockets: 1 },
      { court_id: "wyo", name: "Wyoming Supreme Court", dockets: 12437 },
    ],
  },
};

describe("parseCivilCaseload", () => {
  it("keeps FY2005 through the latest complete year and holds the partial year apart", () => {
    const c = parseCivilCaseload(WY_CIVIL, "WY")!;
    expect(c.latestFy).toBe(2025);
    expect(c.series.map((y) => y.fy)).toEqual([2005, 2024, 2025]);
    expect(c.partialYear?.fy).toBe(2026);
    expect(c.partialYear?.medianDays).toBe(168);
    expect(c.series.find((y) => y.fy === 2026)).toBeUndefined();
    expect(c.series[2]).toEqual({
      fy: 2025,
      filings: 3025,
      terminations: 2925,
      pending: 2525,
      medianDays: 217,
    });
  });

  it("drops invalid court ids and invalid case-type groups, and sorts groups by share", () => {
    const c = parseCivilCaseload(WY_CIVIL, "WY")!;
    expect(c.districts).toEqual(["wyd"]);
    expect(c.mix?.groups.map((g) => g.label)).toEqual(["Civil rights", "Contract"]);
    expect(c.mix?.fyFrom).toBe(2021);
    expect(c.shares).toEqual({ classActionPct: 2.2, proSePct: 31.7, productPct: 1 });
  });

  it("returns nothing for another state's row or a row with no usable series", () => {
    expect(parseCivilCaseload(WY_CIVIL, "CA")).toBeNull();
    expect(parseCivilCaseload({ ...WY_CIVIL, series: [] }, "WY")).toBeNull();
    expect(parseCivilCaseload(null, "WY")).toBeNull();
  });

  it("leaves an unpublished median null (Not recorded) and never turns it into zero", () => {
    const c = parseCivilCaseload({ ...WY_CIVIL, series: [fy(2025, { median_days: null })] }, "WY")!;
    expect(c.series[0]!.medianDays).toBeNull();
  });
});

describe("parseCourtListenerState", () => {
  it("reads the state record, its group split and only valid top-court ids", () => {
    const cl = parseCourtListenerState(WY_MASTER, "WY")!;
    expect(cl.dockets).toBe(136018);
    expect(cl.recapPct).toBe(88.7);
    expect(cl.byGroup.map((g) => g.label)).toEqual(["Federal", "State"]);
    expect(cl.topCourts.map((c) => c.courtId)).toEqual(["wyd", "wyb", "wyo"]);
  });

  it("rejects a record keyed to a different state or without a docket count", () => {
    expect(parseCourtListenerState(WY_MASTER, "CA")).toBeNull();
    expect(
      parseCourtListenerState({ ...WY_MASTER, p: { ...WY_MASTER.p, dockets: null } }, "WY"),
    ).toBeNull();
    expect(
      parseCourtListenerState({ ...WY_MASTER, p: { ...WY_MASTER.p, state: "CA" } }, "WY"),
    ).toBeNull();
  });
});

describe("parseLargeCourts", () => {
  const top = [
    { courtId: "wyd", name: "District Court, D. Wyoming", dockets: 70066 },
    { courtId: "wyb", name: "United States Bankruptcy Court, D. Wyoming", dockets: 53515 },
  ];
  const profile = (id: string, state: string, over: Record<string, unknown> = {}) => ({
    id,
    cells: {
      state,
      level: "Federal district",
      clusters: 873,
      recap_pct: 95.9,
      first_year: 1971,
      median_civil_days: 262,
      ...over,
    },
  });

  it("joins profiles by exact court id inside the state and links only courts on the spine", () => {
    const rows = parseLargeCourts(top, [profile("wyd", "WY")], new Set(["wyd"]), "WY");
    expect(rows[0]).toMatchObject({
      courtId: "wyd",
      clusters: 873,
      medianCivilDays: 262,
      linked: true,
    });
    // wyb has no profile row: its figures stay Not recorded and it is not linked.
    expect(rows[1]).toMatchObject({
      courtId: "wyb",
      level: null,
      clusters: null,
      medianCivilDays: null,
      linked: false,
      dockets: 53515,
    });
  });

  it("ignores a profile row recorded for another state, even with the same court id", () => {
    const rows = parseLargeCourts(top, [profile("wyd", "CO", { clusters: 1 })], new Set(), "WY");
    expect(rows[0]!.clusters).toBeNull();
    expect(rows[0]!.level).toBeNull();
  });
});

describe("parseBenches", () => {
  const bench = (
    id: string,
    state: string,
    positions: number | null,
    over: Record<string, unknown> = {},
  ) => ({
    id,
    cells: {
      court: `Court ${id}`,
      level: "Federal district",
      state,
      active: 8,
      persons: 14,
      positions,
      women_active_pct: 25,
      median_tenure_years: 34.01,
      ...over,
    },
  });

  it("sums positions on record and lists the largest benches first", () => {
    const b = parseBenches(
      [bench("wyb", "WY", 2), bench("wyd", "WY", 14), bench("wyo", "WY", 28)],
      "WY",
      new Set(["wyd"]),
    )!;
    expect(b.courts).toBe(3);
    expect(b.positions).toBe(44);
    expect(b.noEndRecorded).toBe(24);
    expect(b.rows.map((r) => r.courtId)).toEqual(["wyo", "wyd", "wyb"]);
    expect(b.rows.find((r) => r.courtId === "wyd")?.linked).toBe(true);
    expect(b.rows.find((r) => r.courtId === "wyo")?.linked).toBe(false);
  });

  it("drops other states' benches, rows with no count, bad ids and duplicates", () => {
    const b = parseBenches(
      [
        bench("wyd", "WY", 14),
        bench("cod", "CO", 99),
        bench("wyb", "WY", null),
        bench("BAD ID", "WY", 5),
        bench("wyd", "WY", 77),
      ],
      "WY",
    )!;
    expect(b.positions).toBe(14);
    expect(b.rows).toHaveLength(1);
  });

  it("keeps an unknown women share and tenure null and is null for no rows", () => {
    const b = parseBenches(
      [bench("wyb", "WY", 2, { women_active_pct: null, median_tenure_years: null })],
      "WY",
    )!;
    expect(b.rows[0]!.womenPct).toBeNull();
    expect(b.rows[0]!.medianYearsServed).toBeNull();
    expect(parseBenches([], "WY")).toBeNull();
  });

  it("limits the listed benches to the largest eight but counts all", () => {
    const rows = Array.from({ length: 12 }, (_, i) => bench(`c${i}`, "WY", i + 1));
    const b = parseBenches(rows, "WY")!;
    expect(b.courts).toBe(12);
    expect(b.rows).toHaveLength(8);
    expect(b.rows[0]!.positions).toBe(12);
  });
});

describe("parseCourtSummaries", () => {
  it("reads the FJC and CourtListener source notes and the collection caveats", () => {
    const s = parseCourtSummaries([
      {
        id: "fjc_civil_states",
        source: "FJC IDB",
        snapshot: "cv88on.zip; filing dates through 2026-06-30",
        terms: "Public data",
      },
      {
        id: "clb_docket_master",
        snapshot: "2026-09-30",
        terms: "Bulk files",
        caveats: ["The collection is not a census.", ""],
      },
    ]);
    expect(s.fjc.source).toBe("FJC IDB");
    expect(s.courtListener).toEqual({
      snapshot: "2026-09-30",
      terms: "Bulk files",
      caveats: ["The collection is not a census."],
    });
  });

  it("returns nulls and no caveats when the summaries did not load", () => {
    expect(parseCourtSummaries([]).courtListener.caveats).toEqual([]);
    expect(parseCourtSummaries([]).fjc.snapshot).toBeNull();
  });
});

describe("buildStateCourtData", () => {
  it("assembles each block from the state's own rows and lists unloaded sections", () => {
    const v = buildStateCourtData("WY", {
      civil: WY_CIVIL,
      master: WY_MASTER,
      profiles: [{ id: "wyd", cells: { state: "WY", level: "Federal district", clusters: 873 } }],
      benches: [],
      spine: new Set(["wyd", "wyo"]),
      summaries: [],
      unavailable: ["benches"],
    });
    expect(v.civil?.latestFy).toBe(2025);
    expect(v.courtListener?.dockets).toBe(136018);
    expect(v.courts.map((c) => [c.courtId, c.linked])).toEqual([
      ["wyd", true],
      ["wyb", false],
      ["wyo", true],
    ]);
    expect(v.benches).toBeNull();
    expect(v.unavailable).toEqual(["benches"]);
  });

  it("builds no court rows when the state has no CourtListener record", () => {
    const v = buildStateCourtData("WY", {
      civil: null,
      master: null,
      profiles: [],
      benches: [],
      spine: new Set(),
      summaries: [],
    });
    expect(v.courts).toEqual([]);
    expect(v.courtListener).toBeNull();
    expect(v.civil).toBeNull();
  });
});

describe("COURT_ID", () => {
  it("accepts CourtListener ids and rejects anything that could alter a query", () => {
    expect(COURT_ID.test("calctapp5d")).toBe(true);
    expect(COURT_ID.test("wyd),state=eq.CA")).toBe(false);
    expect(COURT_ID.test("")).toBe(false);
    expect(COURT_ID.test("WYD")).toBe(false);
  });
});
