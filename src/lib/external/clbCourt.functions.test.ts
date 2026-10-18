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
  parseAppealOrigins,
  parseClbCourtProfile,
  parseClbMethod,
  parseCourtPageUrl,
  parseCoverage,
  parseDistrictGlance,
  parseDocketYears,
  parseDuration,
  parseGlanceAgreement,
  parseGlanceMeasures,
  parseJudges,
  parseOral,
  parseScotusYears,
  parseTopCited,
  withJudgeStats,
} from "./clbCourt.functions";

// Values copied from the published rows (clb_court_profiles: cand, cal, scotus; clb_district_crossview: cand).
const CAND = {
  court_id: "cand",
  name: "District Court, N.D. California",
  short_name: "N.D. California",
  level: "Federal district",
  state: "CA",
  opinion_source_dockets: false,
  opinions: null,
  citations: null,
  bench: {
    active: 38,
    persons: 88,
    positions: 89,
    women_active_pct: 42.1,
    median_tenure_years_ended: 15.67,
  },
  dockets: {
    total: 416771,
    dated: 406908,
    no_filed_date: 9863,
    implausible_filed: 0,
    first_filed: "1956-12-22",
    last_filed: "2026-09-30",
    terminated: 353683,
    terminated_pct: 86.9,
    recap: 384240,
    recap_pct: 92.2,
    with_assigned_judge: 238311,
    with_assigned_pct: 57.2,
    with_appeal_from: 0,
    nos_recorded: 259230,
    with_cause: 133010,
    by_year: [
      { yr: 2025, dockets: 13873, civil: 10941, criminal: 794, recap: 13873, terminated: 2895 },
      { yr: 1956, dockets: 2, civil: 0, criminal: 0, recap: 2, terminated: 2 },
      // not a valid row: civil + criminal exceed the year's dockets
      { yr: 1999, dockets: 10, civil: 9, criminal: 5, recap: 0, terminated: 1 },
      { yr: "2000", dockets: 3, civil: 1, criminal: 1, recap: 0, terminated: 0 },
      { yr: 2001, dockets: 4, civil: null, criminal: 0, recap: 0, terminated: 0 },
    ],
    sources: [
      { value: 9, label: "9", count: 195897, share_pct: 47, flags: ["RECAP", "FJC IDB"] },
      { value: 1, label: "1", count: 100, share_pct: 0.1, flags: [] },
      { value: "x", count: 5, share_pct: 1, flags: [] },
    ],
    nos_groups: [
      { value: "contract", label: "Contract", count: 32610, share_pct: 12.6 },
      { value: "bad", label: "Bad", count: -1, share_pct: 1 },
    ],
    top_nos: [
      {
        value: "530 Prisoner petitions - habeas",
        label: "530 Prisoner petitions - habeas",
        count: 10482,
        share_pct: 4,
      },
    ],
    top_causes: [
      {
        value: "42:1983 Prisoner Civil Rights",
        label: "42:1983 Prisoner Civil Rights",
        count: 13181,
        share_pct: 9.9,
      },
    ],
    duration: {
      all: { n: 353196, p25_days: 64, median_days: 186, p75_days: 458, p90_days: 939 },
      civil: { n: 224727, p25_days: 94, median_days: 225, p75_days: 511, p90_days: 974 },
    },
    judges_assigned: [
      {
        person_id: 383,
        name: "Charles R. Breyer",
        dockets: 16643,
        terminated: 12671,
        first_filed: "1973-04-23",
        last_filed: "2026-09-23",
        record: "/records/cl_people/cl:people:383",
      },
      // the stored record names a different person id: no internal link
      {
        person_id: 2474,
        name: "William Horsley Orrick III",
        dockets: 10401,
        record: "/records/cl_people/cl:people:604",
      },
      { person_id: 0, name: "Zero", dockets: 1 },
      { person_id: 7, name: "", dockets: 1 },
    ],
    judges_referred: [
      {
        person_id: 10004,
        name: "Howard R Lloyd",
        dockets: 4435,
        terminated: 99,
        record: "/records/cl_people/cl:people:10004",
      },
    ],
    appeal_from: [
      {
        court_id: "cacd",
        name: "District Court, C.D. California",
        dockets: 1366,
        share_pct: 25.1,
        link: "/courts/cacd",
      },
      {
        court_id: "cand",
        name: "District Court, N.D. California",
        dockets: 1148,
        share_pct: 21.1,
        link: "/courts/azd",
      },
      {
        court_id: "azd",
        name: "District Court, D. Arizona",
        dockets: 428,
        share_pct: 7.9,
        link: null,
      },
    ],
  },
  clusters: {
    total: 36171,
    dated: 36171,
    first_filed: "1851-07-09",
    last_filed: "2026-09-28",
    cited: 8052,
    cited_pct: 22.3,
    cite_total: 87804,
    cite_max: 1075,
    cite_median_among_cited: 6,
    cite_p90_among_cited: 24,
    with_reporter_cite: 9341,
    with_reporter_cite_pct: 25.8,
    with_scdb: 0,
    by_year: [
      { yr: 2026, clusters: 3171, cited: 0, cite_total: 0 },
      { yr: 2025, clusters: 3926, cited: 0, cite_total: 0 },
      { yr: 2024, clusters: 5, cited: 9, cite_total: 0 },
    ],
    precedential: [
      { value: "Unknown", label: "Unknown", count: 26830, share_pct: 74.2 },
      { value: "Published", label: "Published", count: 9341, share_pct: 25.8 },
    ],
    reporters: [{ value: "WL", label: "WL", count: 4547, share_pct: 18.4 }],
    top_cited: [
      {
        cluster_id: 8750326,
        case_name: "Semitool, Inc. v. Tokyo Electron America, Inc.",
        date_filed: "2002-04-19",
        docket_id: 66016324,
        times_cited: 1075,
        url: "https://www.courtlistener.com/opinion/8750326/",
      },
      {
        cluster_id: 9046840,
        case_name: null,
        date_filed: "1995-07-17",
        times_cited: 909,
        url: "https://example.com/opinion/9046840/",
      },
    ],
  },
  oral_arguments: null,
  fjc_coverage: {
    by_fy: [
      { fy: 2001, cl_civil_dockets: 5882, fjc_filings: 5910, cl_to_fjc_ratio: 0.995 },
      { fy: 2000, cl_civil_dockets: 5637, fjc_filings: 5666, cl_to_fjc_ratio: 0.995 },
      // the stored ratio is not the stored quotient
      { fy: 2002, cl_civil_dockets: 6875, fjc_filings: 6949, cl_to_fjc_ratio: 1.5 },
      { fy: 2003, cl_civil_dockets: 10, fjc_filings: 0, cl_to_fjc_ratio: 0 },
    ],
    latest_complete_fy: 2025,
    latest_ratio: 1.004,
    median_ratio_last_10_fy: 0.99,
  },
};

describe("parsers", () => {
  it("parses a district profile and ignores the unfilled opinions and citations sections", () => {
    const p = parseClbCourtProfile(CAND)!;
    expect(p.courtId).toBe("cand");
    expect(p.opinionSourceDockets).toBe(false);
    expect(p.dockets?.total).toBe(416771);
    expect(p.dockets?.noFiledDate).toBe(9863);
    expect(p.clusters?.total).toBe(36171);
    expect(p.oral).toBeNull();
    expect(p.bench?.positions).toBe(89);
    expect(p).not.toHaveProperty("opinions");
    expect(p).not.toHaveProperty("citations");
  });

  it("drops filing-year rows that are malformed or inconsistent and sorts the rest", () => {
    const years = parseDocketYears(CAND.dockets.by_year);
    expect(years.map((y) => y.yr)).toEqual([1956, 2025]);
  });

  it("keeps CourtListener source masks and flags, and drops rows without a numeric mask", () => {
    const d = parseClbCourtProfile(CAND)!.dockets!;
    expect(d.sources.map((s) => s.mask)).toEqual([9, 1]);
    expect(d.sources[0]?.flags).toEqual(["RECAP", "FJC IDB"]);
    expect(d.sources[1]?.flags).toEqual([]);
  });

  it("drops shares with a negative count", () => {
    const d = parseClbCourtProfile(CAND)!.dockets!;
    expect(d.nosGroups.map((g) => g.value)).toEqual(["contract"]);
  });

  it("links a judge to cl_people only when the record names exactly that person id", () => {
    const judges = parseClbCourtProfile(CAND)!.dockets!.judgesAssigned;
    expect(judges.map((j) => j.personId)).toEqual([383, 2474]);
    expect(judges[0]?.record).toBe("/records/cl_people/cl:people:383");
    expect(judges[1]?.record).toBeNull();
    expect(judges.every((j) => j.statsRecord === null)).toBe(true);
  });

  it("does not carry assigned-docket fields onto referred judges", () => {
    const referred = parseJudges(CAND.dockets.judges_referred, false);
    expect(referred[0]).toMatchObject({ personId: 10004, dockets: 4435, terminated: null });
    expect(referred[0]?.firstFiled).toBeNull();
  });

  it("links a court of origin only when the stored link names exactly that court", () => {
    const origins = parseAppealOrigins(CAND.dockets.appeal_from);
    expect(origins.map((o) => o.link)).toEqual(["/courts/cacd", null, null]);
  });

  it("publishes a duration only from 30 dockets and with ordered percentiles", () => {
    expect(
      parseDuration({ n: 29, p25_days: 1, median_days: 2, p75_days: 3, p90_days: 4 }),
    ).toBeNull();
    expect(
      parseDuration({ n: 30, p25_days: 5, median_days: 2, p75_days: 3, p90_days: 4 }),
    ).toBeNull();
    expect(parseDuration({ n: 30, p25_days: 1, median_days: 2, p75_days: 3, p90_days: 4 })).toEqual(
      {
        n: 30,
        p25: 1,
        median: 2,
        p75: 3,
        p90: 4,
      },
    );
    expect(parseDuration({})).toBeNull();
    const d = parseClbCourtProfile(CAND)!.dockets!;
    expect(d.durationCivil?.median).toBe(225);
    expect(d.durationAll?.n).toBe(353196);
  });

  it("reads a duration block that is empty (a court with no dated terminations) as no duration", () => {
    const p = parseClbCourtProfile({ ...CAND, dockets: { ...CAND.dockets, duration: {} } })!;
    expect(p.dockets?.durationCivil).toBeNull();
    expect(p.dockets?.durationAll).toBeNull();
  });

  it("keeps a top-cited row without a verified URL or case name, unlinked", () => {
    const rows = parseTopCited(CAND.clusters.top_cited);
    expect(rows).toHaveLength(2);
    expect(rows[0]?.url).toBe("https://www.courtlistener.com/opinion/8750326/");
    expect(rows[1]?.url).toBeNull();
    expect(rows[1]?.caseName).toBeNull();
  });

  it("drops cluster years where more clusters are cited than exist", () => {
    const k = parseClbCourtProfile(CAND)!.clusters!;
    expect(k.byYear.map((y) => y.yr)).toEqual([2025, 2026]);
  });

  it("keeps the district coverage ratio only where it is the stored quotient", () => {
    const cov = parseCoverage(CAND.fjc_coverage)!;
    expect(cov.byFy.map((y) => y.fy)).toEqual([2000, 2001]);
    expect(cov.latestRatio).toBe(1.004);
    expect(cov.medianRatioLast10Fy).toBe(0.99);
    expect(
      parseCoverage({
        by_fy: [{ fy: 2003, cl_civil_dockets: 1, fjc_filings: 0, cl_to_fjc_ratio: 0 }],
      }),
    ).toBeNull();
    expect(parseCoverage(null)).toBeNull();
  });

  it("flags docket rows created from opinions", () => {
    const p = parseClbCourtProfile({
      ...CAND,
      court_id: "cal",
      opinion_source_dockets: true,
      dockets: { ...CAND.dockets, by_year: [], dated: 0, no_filed_date: 44650, total: 44650 },
    })!;
    expect(p.opinionSourceDockets).toBe(true);
    expect(p.dockets?.byYear).toEqual([]);
    expect(p.dockets?.noFiledDate).toBe(44650);
  });

  it("renders no section for null sections", () => {
    const p = parseClbCourtProfile({
      court_id: "arizsuper",
      name: "Arizona Superior Court",
      level: "State trial",
      dockets: null,
      clusters: null,
      oral_arguments: null,
      fjc_coverage: null,
      bench: {
        positions: 3,
        active: 1,
        persons: 3,
        women_active_pct: null,
        median_tenure_years_ended: null,
      },
    })!;
    expect(p.dockets).toBeNull();
    expect(p.clusters).toBeNull();
    expect(p.oral).toBeNull();
    expect(p.coverage).toBeNull();
    expect(p.bench).toMatchObject({
      positions: 3,
      womenActivePct: null,
      medianTenureYearsEnded: null,
    });
  });

  it("returns null for a payload without a court id or name", () => {
    expect(parseClbCourtProfile(null)).toBeNull();
    expect(parseClbCourtProfile({ name: "x" })).toBeNull();
    expect(parseClbCourtProfile({ court_id: "x" })).toBeNull();
    expect(parseClbCourtProfile([])).toBeNull();
  });

  it("validates Supreme Court vote rows", () => {
    const rows = parseScotusYears([
      { yr: 2018, clusters: 3942, scdb: 72, with_votes: 72, unanimous: 30, five_four: 17 },
      { yr: 2019, clusters: 10, scdb: 72, with_votes: 72, unanimous: 30, five_four: 17 },
      { yr: 2010, clusters: 100, scdb: 87, with_votes: 87, unanimous: 80, five_four: 17 },
      { yr: 1759, clusters: 1, scdb: 0, with_votes: 0, unanimous: 0, five_four: 0 },
    ]);
    expect(rows.map((r) => r.yr)).toEqual([1759, 2018]);
  });

  it("reads oral arguments and drops an impossible transcript count", () => {
    const o = parseOral({
      total: 1030,
      dockets: 1029,
      first_created: "2014-11-04",
      last_created: "2026-04-29",
      median_minutes: 61.2,
      total_hours: 1181,
      with_transcript: 2000,
      by_year: [
        { yr: 2015, n: 5 },
        { yr: 2014, n: 101 },
        { yr: 2016, n: -2 },
      ],
    })!;
    expect(o.withTranscript).toBeNull();
    expect(o.byYear.map((y) => y.yr)).toEqual([2014, 2015]);
    expect(o.medianMinutes).toBe(61.2);
    expect(parseOral({ total: "many" })).toBeNull();
  });

  it("attaches a judge-statistics link only for the ids that were found", () => {
    const p = withJudgeStats(parseClbCourtProfile(CAND)!, new Set([383, 10004]));
    expect(p.dockets?.judgesAssigned[0]?.statsRecord).toBe("/records/clb_judge_dockets/383");
    expect(p.dockets?.judgesAssigned[1]?.statsRecord).toBeNull();
    expect(p.dockets?.judgesReferred[0]?.statsRecord).toBe("/records/clb_judge_dockets/10004");
    const same = parseClbCourtProfile(CAND)!;
    expect(withJudgeStats(same, new Set())).toBe(same);
  });

  it("reads CourtListener's own court page only when it names this court", () => {
    const links = [
      { label: "Court profile", url: "/courts/cand" },
      { label: "CourtListener court page", url: "https://www.courtlistener.com/court/cand/" },
    ];
    expect(parseCourtPageUrl(links, "cand")).toBe("https://www.courtlistener.com/court/cand/");
    expect(parseCourtPageUrl(links, "cacd")).toBeNull();
    expect(parseCourtPageUrl(null, "cand")).toBeNull();
  });

  it("accepts the court ids used in the corpus, including mixed case", () => {
    for (const id of ["cand", "ca9", "scotus", "txctapp13A", "nyappdiv"])
      expect(COURT_ID.test(id)).toBe(true);
    for (const id of ["", "a", "ca9;drop", "cl:people:1", "../x", "ca 9"])
      expect(COURT_ID.test(id)).toBe(false);
  });
});

const DEFS = [
  {
    key: "fjc_filings",
    label: "Civil filings",
    unit: "cases",
    source: "FJC IDB",
    period: "FY2025",
  },
  {
    key: "fcms_weighted_per_judgeship",
    label: "Weighted filings per judgeship",
    unit: "per judgeship",
    source: "FCMS",
    period: "12 months ending Sept 30, 2025",
  },
  {
    key: "cl_coverage_ratio",
    label: "CourtListener civil-numbered dockets / FJC civil filings",
    unit: "ratio",
    source: "CourtListener and FJC IDB",
    period: "FY2025",
  },
];

const METRICS = [
  {
    key: "cl_coverage_ratio",
    label: "CourtListener civil-numbered dockets / FJC civil filings",
    period: "FY2025",
    rank: [24, 94],
    source: "CourtListener and FJC IDB",
    unit: "ratio",
    value: 1.004,
  },
  {
    key: "fjc_filings",
    label: "Civil filings",
    period: "FY2025",
    rank: [6, 94],
    source: "FJC IDB",
    unit: "cases",
    value: 10708,
  },
  {
    key: "extra_measure",
    label: "Extra",
    period: "FY2025",
    rank: [7, 3],
    source: "Other",
    unit: "cases",
    value: 5,
  },
  { key: "bad", label: "No unit", period: "FY2025", source: "Other", value: 5 },
];

describe("district cross-source view", () => {
  it("orders measures by the dataset definitions and lists a defined measure the record lacks as not recorded", () => {
    const m = parseGlanceMeasures(METRICS, DEFS);
    expect(m.map((x) => x.key)).toEqual([
      "fjc_filings",
      "fcms_weighted_per_judgeship",
      "cl_coverage_ratio",
      "extra_measure",
    ]);
    expect(m[1]).toMatchObject({
      value: null,
      rank: null,
      source: "FCMS",
      period: "12 months ending Sept 30, 2025",
    });
    expect(m[0]).toMatchObject({ value: 10708, rank: { position: 6, of: 94 } });
  });

  it("drops a rank that does not fit its own count", () => {
    const m = parseGlanceMeasures(METRICS, DEFS);
    expect(m.find((x) => x.key === "extra_measure")?.rank).toBeNull();
    expect(parseGlanceMeasures([{ ...METRICS[1], rank: [0, 94] }], DEFS)[0]?.rank).toBeNull();
    expect(parseGlanceMeasures([{ ...METRICS[1], rank: "6 of 94" }], DEFS)[0]?.rank).toBeNull();
  });

  it("keeps the record's own order when the dataset definitions are unavailable", () => {
    expect(parseGlanceMeasures(METRICS, []).map((x) => x.key)).toEqual([
      "cl_coverage_ratio",
      "fjc_filings",
      "extra_measure",
    ]);
  });

  const CORR = (over: Record<string, unknown> = {}, id = "corr:fjc_filings|fcms_filings") => ({
    id,
    c: {
      a: "fjc_filings",
      b: "fcms_filings",
      n: 94,
      rho: 0.969,
      ci_low: 0.953,
      ci_high: 0.979,
      role: "validity",
      strength: "very strong",
      why: "Two official sources count the same court's workload.",
      ...over,
    },
    a: {
      key: "fjc_filings",
      label: "Civil filings",
      period: "FY2025",
      source: "FJC IDB",
      unit: "cases",
    },
    b: {
      key: "fcms_filings",
      label: "Total filings (civil and criminal)",
      period: "12 months ending Sept 30, 2025",
      source: "FCMS",
      unit: "cases",
    },
  });

  it("keeps validity pairs whose interval contains the estimate and whose id names the pair", () => {
    expect(parseGlanceAgreement([CORR()])).toHaveLength(1);
    expect(parseGlanceAgreement([CORR({ role: "context" })])).toHaveLength(0);
    expect(parseGlanceAgreement([CORR({ ci_low: 0.97 })])).toHaveLength(0);
    expect(parseGlanceAgreement([CORR({ rho: 1.2, ci_high: 1.3 })])).toHaveLength(0);
    expect(parseGlanceAgreement([CORR({ n: 3 })])).toHaveLength(0);
    expect(parseGlanceAgreement([CORR({}, "corr:other|pair")])).toHaveLength(0);
    // a perfect rank correlation has an interval that collapses onto the estimate
    expect(parseGlanceAgreement([CORR({ rho: 1, ci_low: 1, ci_high: 1 })])).toHaveLength(1);
  });

  it("shows nothing when the record carries no measure value", () => {
    const method = parseClbMethod({ snapshot: "2026-09-30", metrics: DEFS, caveats: ["a"] });
    expect(
      parseDistrictGlance({
        courtId: "cand",
        name: "x",
        metrics: [],
        method: { ...method!, metrics: [] },
        agreement: [],
      }),
    ).toBeNull();
    const g = parseDistrictGlance({
      courtId: "cand",
      name: "N.D. Cal.",
      metrics: METRICS,
      method,
      agreement: [],
    })!;
    expect(g.measures).toHaveLength(4);
    expect(g.snapshot).toBe("2026-09-30");
    expect(g.caveats).toEqual(["a"]);
  });

  it("reads a method block's definitions, caveats and measure definitions", () => {
    const m = parseClbMethod({
      snapshot: "2026-09-30",
      caveats: ["one", "", 3],
      definitions: { docket: "one row", bad: 4 },
      metrics: [...DEFS, { key: "x" }],
    })!;
    expect(m.caveats).toEqual(["one"]);
    expect(m.definitions).toEqual([{ term: "docket", text: "one row" }]);
    expect(m.metrics).toHaveLength(3);
    expect(parseClbMethod(null)).toBeNull();
  });
});

describe("server reads", () => {
  // Each test loads a fresh copy of the module: the reads are memoized for ten minutes per process.
  async function load() {
    vi.resetModules();
    const rest = await import("./rest.server");
    const mod = await import("./clbCourt.functions");
    const get = vi.mocked(rest.restGet);
    const route = (table: Record<string, unknown>) =>
      get.mockImplementation(async (path: string) => {
        for (const [needle, rows] of Object.entries(table)) {
          if (path.includes(needle)) {
            if (rows instanceof Error) throw rows;
            return { rows, total: null } as never;
          }
        }
        throw new Error(`unexpected read: ${path}`);
      });
    return { get, route, mod };
  }

  it("reads one profile by exact id, adds judge-statistics links for found ids and memoizes", async () => {
    const { get, route, mod } = await load();
    route({
      "dataset=eq.clb_court_profiles&id=eq.cand&": [
        { p: CAND, l: [{ url: "https://www.courtlistener.com/court/cand/" }] },
      ],
      corpus_datasets: [{ s: { snapshot: "2026-09-30", caveats: ["c"], definitions: {} } }],
      "dataset=eq.clb_judge_dockets": [{ id: "383" }, { id: "99999" }],
    });
    const out = await mod.getClbCourtCollection({ data: { id: "cand" } } as never);
    expect(out?.profile.courtId).toBe("cand");
    expect(out?.courtPageUrl).toBe("https://www.courtlistener.com/court/cand/");
    expect(out?.method?.snapshot).toBe("2026-09-30");
    expect(out?.profile.dockets?.judgesAssigned[0]?.statsRecord).toBe(
      "/records/clb_judge_dockets/383",
    );
    expect(out?.profile.dockets?.judgesAssigned[1]?.statsRecord).toBeNull();
    expect(get.mock.calls.some(([p]) => String(p).includes("id=in.(383,2474,10004)"))).toBe(true);
    const calls = get.mock.calls.length;
    await mod.getClbCourtCollection({ data: { id: "cand" } } as never);
    expect(get.mock.calls.length).toBe(calls);
  });

  it("returns null for a court with no record and for a record whose profile names another court", async () => {
    const { route, mod } = await load();
    route({
      "id=eq.nosuch&": [],
      "id=eq.swap&": [{ p: { ...CAND, court_id: "cacd" }, l: [] }],
      corpus_datasets: [],
    });
    expect(await mod.getClbCourtCollection({ data: { id: "nosuch" } } as never)).toBeNull();
    expect(await mod.getClbCourtCollection({ data: { id: "swap" } } as never)).toBeNull();
  });

  it("shows the profile without the method block or judge links when those auxiliary reads fail", async () => {
    const { route, mod } = await load();
    route({
      "dataset=eq.clb_court_profiles&id=eq.cand&": [{ p: CAND, l: [] }],
      corpus_datasets: new Error("down"),
      "dataset=eq.clb_judge_dockets": new Error("down"),
    });
    const out = await mod.getClbCourtCollection({ data: { id: "cand" } } as never);
    expect(out?.method).toBeNull();
    expect(out?.profile.dockets?.total).toBe(416771);
    expect(out?.profile.dockets?.judgesAssigned.every((j) => j.statsRecord === null)).toBe(true);
  });

  it("surfaces a failed profile read instead of caching it as empty", async () => {
    const { route, mod } = await load();
    route({ "id=eq.cand&": new Error("down"), corpus_datasets: [] });
    await expect(mod.getClbCourtCollection({ data: { id: "cand" } } as never)).rejects.toThrow(
      "down",
    );
  });

  it("reads a district record by exact id and reads nothing else for a court without one", async () => {
    const { get, route, mod } = await load();
    route({ "id=eq.ald&": [] });
    expect(await mod.getClbDistrictGlance({ data: { id: "ald" } } as never)).toBeNull();
    expect(get).toHaveBeenCalledTimes(1);
  });

  it("combines the district record with the dataset definitions and the validity pairs", async () => {
    const { route, mod } = await load();
    route({
      "id=eq.cand&": [
        { p: { court_id: "cand", name: "District Court, N.D. California", metrics: METRICS } },
      ],
      corpus_datasets: [
        { s: { snapshot: "2026-09-30", caveats: ["scope differs"], metrics: DEFS } },
      ],
      "id=like.corr": [
        {
          id: "corr:fjc_filings|fcms_filings",
          c: {
            n: 94,
            rho: 0.969,
            ci_low: 0.953,
            ci_high: 0.979,
            role: "validity",
            strength: "very strong",
            why: "w",
          },
          a: { key: "fjc_filings", label: "Civil filings", period: "FY2025", source: "FJC IDB" },
          b: { key: "fcms_filings", label: "Total filings", period: "FY2025", source: "FCMS" },
        },
        {
          id: "corr:cl_cited_pct|fjc_filings",
          c: { n: 94, rho: -0.056, ci_low: -0.256, ci_high: 0.148, role: "context" },
          a: { key: "cl_cited_pct", label: "Cited", period: "snapshot", source: "CourtListener" },
          b: { key: "fjc_filings", label: "Civil filings", period: "FY2025", source: "FJC IDB" },
        },
      ],
    });
    const g = await mod.getClbDistrictGlance({ data: { id: "cand" } } as never);
    expect(g?.courtId).toBe("cand");
    expect(g?.measures.map((m) => m.key)).toEqual([
      "fjc_filings",
      "fcms_weighted_per_judgeship",
      "cl_coverage_ratio",
      "extra_measure",
    ]);
    expect(g?.agreement.map((a) => a.id)).toEqual(["corr:fjc_filings|fcms_filings"]);
    expect(g?.caveats).toEqual(["scope differs"]);
  });

  it("does not show a district record whose profile names another court", async () => {
    const { route, mod } = await load();
    route({
      "id=eq.cand&": [{ p: { court_id: "cacd", name: "x", metrics: METRICS } }],
      corpus_datasets: [],
      "id=like.corr": [],
    });
    expect(await mod.getClbDistrictGlance({ data: { id: "cand" } } as never)).toBeNull();
  });
});
