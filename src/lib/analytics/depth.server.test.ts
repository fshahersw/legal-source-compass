import { beforeEach, describe, expect, it, vi } from "vitest";

type Reply = { rows: unknown[]; total?: number | null };
type Opts = { count?: boolean; range?: [number, number] };
const restGet = vi.hoisted(() => vi.fn());
const readFaers = vi.hoisted(() => vi.fn());
const readCpsc = vi.hoisted(() => vi.fn());
vi.mock("@/lib/external/rest.server", () => ({ restGet }));
vi.mock("@/lib/insights/readers/safety", () => ({ readFaers, readCpsc }));

/** Answer a PostgREST path from the first matching rule; an unmatched path fails the test. */
function serve(rules: [string, Reply | ((path: string, opts: Opts) => Reply)][]) {
  restGet.mockImplementation(async (path: string, opts: Opts = {}) => {
    for (const [needle, reply] of rules)
      if (path.includes(needle)) {
        const r = typeof reply === "function" ? reply(path, opts) : reply;
        return { rows: r.rows, total: r.total ?? null };
      }
    throw new Error(`Unexpected read: ${path}`);
  });
}

/** The readers cache a successful read, so each test imports a fresh module instance. */
async function reader(id: string) {
  vi.resetModules();
  const { DEPTH_READERS } = await import("./depth.server");
  return DEPTH_READERS[id]!;
}

beforeEach(() => {
  restGet.mockReset();
  readFaers.mockReset();
  readCpsc.mockReset();
});

const DOJ_INDEX = {
  o: {
    partitions: [
      { dataset: "doj_press_releases_2012", year: "2012", records: 90 },
      { dataset: "doj_press_releases_2013", year: "2013", records: 900 },
      { dataset: "doj_press_releases_2014", year: "2014", records: 950 },
    ],
    components: [
      { name: "USAO - Texas", count: 9000 },
      { name: "Criminal Division", count: 700 },
      { name: "Tax Division", count: 300 },
    ],
    by_year: [
      { year: "2012", count: 90, amount: { "10m_plus": 5 } },
      {
        year: "2013",
        count: 900,
        amount: { "10m_plus": 300, "100m_plus": 80, "1b_plus": 50 },
      },
      { year: "2014", count: 950, amount: { "10m_plus": 380, "100m_plus": 90, "1b_plus": 60 } },
    ],
  },
};

describe("DOJ readers", () => {
  it("doj-amounts: sums the three size buckets from the index and flags the partial year", async () => {
    serve([
      ["doj-index:overview", { rows: [DOJ_INDEX] }],
      ["dataset=eq.doj_press_releases_2014", { rows: [{ d: "2014-06-30" }] }],
    ]);
    const block = (await (await reader("doj-amounts"))())!;
    expect(block.series.map((s) => s.points.at(-1)!.value)).toEqual([380, 90, 60]);
    expect(block.series[0]!.points.at(-1)!.partial).toBe(true);
    expect(block.latest?.period).toBe("2013");
    expect(block.markers).toEqual([{ x: "2013", label: "Coverage changes" }]);
    expect(block.asOf).toBe("2014-06-30");
  });

  it("doj-divisions: counts each named division in each partition from the coverage change, by containment", async () => {
    const counted: string[] = [];
    serve([
      ["doj-index:overview", { rows: [DOJ_INDEX] }],
      ["order=item->release->date.desc", { rows: [{ d: "2014-12-31" }] }],
      [
        "filters=cs.",
        (path) => {
          const decoded = decodeURIComponent(path);
          counted.push(decoded);
          const dataset = /dataset=eq\.(doj_press_releases_\d{4})/.exec(decoded)![1]!;
          const base = dataset.endsWith("2013") ? 200 : 250;
          return { rows: [{ id: "x" }], total: decoded.includes("Tax") ? base / 2 : base };
        },
      ],
    ]);
    const block = (await (await reader("doj-divisions"))())!;
    // Division names only: the US attorney's office component is not a division. The 2012 partition is before the
    // coverage change (2013) and is not read.
    expect(block.series.map((s) => s.label)).toEqual(["Criminal Division", "Tax Division"]);
    expect(counted).toHaveLength(4);
    expect(counted.some((p) => p.includes("2012"))).toBe(false);
    expect(counted.every((p) => p.includes('{"component":["'))).toBe(true);
    expect(block.series[0]!.points.map((p) => [p.x, p.value])).toEqual([
      ["2013", 200],
      ["2014", 250],
    ]);
    expect(block.series[1]!.points.map((p) => p.value)).toEqual([100, 125]);
    expect(block.asOf).toBe("2014-12-31");
  });

  it("is empty (null) when the index is missing or names no division", async () => {
    serve([["doj-index:overview", { rows: [] }]]);
    expect(await (await reader("doj-amounts"))()).toBeNull();
    expect(await (await reader("doj-divisions"))()).toBeNull();
  });
});

describe("SEC amounts reader", () => {
  it("pages the filters of every release and tallies litigation releases by year and size bucket", async () => {
    const rows = [
      ...Array.from({ length: 1200 }, () => ({
        y: "2024",
        t: "litigation_release",
        a: "10m_plus",
      })),
      ...Array.from({ length: 5 }, () => ({ y: "2024", t: "litigation_release", a: "1b_plus" })),
      ...Array.from({ length: 30 }, () => ({
        y: "2024",
        t: "administrative_proceeding",
        a: "1b_plus",
      })),
      ...Array.from({ length: 800 }, () => ({
        y: "2023",
        t: "litigation_release",
        a: "100m_plus",
      })),
    ];
    restGet.mockImplementation(async (path: string, opts: Opts = {}) => {
      if (path.includes("item->sec_action->>date"))
        return { rows: [{ d: "2025-01-05" }], total: null };
      expect(path).toContain(
        "select=y:filters->year->>0,t:filters->type->>0,a:filters->amount->>0",
      );
      const [a, b] = opts.range ?? [0, 999];
      return { rows: rows.slice(a, b + 1), total: opts.count ? rows.length : null };
    });
    const block = (await (await reader("sec-amounts"))())!;
    expect(block.series.map((s) => s.points.map((p) => p.value))).toEqual([
      [0, 1200],
      [800, 0],
      [0, 5],
    ]);
    expect(block.latest?.period).toBe("2024");
    expect(block.latest?.value).toBe(1205);
  });

  it("fails, never truncates, when the corpus reports no row total", async () => {
    restGet.mockResolvedValue({ rows: [], total: null });
    await expect((await reader("sec-amounts"))()).rejects.toThrow("row total");
  });
});

describe("EPA and OSHA readers", () => {
  it("epa-penalties: skips the all-years row and later-than-complete years and states the file date", async () => {
    serve([
      [
        "dataset=eq.epa_echo_case_series",
        {
          rows: [
            { cells: { fy: "All", fed_penalty: 9 } },
            { cells: { fy: 2024, fed_penalty: 700 } },
            { cells: { fy: 2025, fed_penalty: 654_800_000 } },
            { cells: { fy: 2026, fed_penalty: 194_300_000 } },
            { cells: { fy: 2027, fed_penalty: 5 } },
          ],
        },
      ],
      ["corpus_datasets?select=fileDate", { rows: [{ fileDate: "2026-10-17", latestFy: "2026" }] }],
    ]);
    const block = (await (await reader("epa-penalties"))())!;
    expect(block.series[0]!.points.map((p) => [p.x, p.value])).toEqual([
      ["2024", 700],
      ["2025", 654_800_000],
      ["2026", 194_300_000],
    ]);
    expect(block.asOf).toBe("2026-10-17");
    expect(block.latest?.period).toBe("FY2026");
  });

  it("osha-penalties: marks fiscal years after the complete one as partial", async () => {
    serve([
      [
        "dataset=eq.osha_inspections_national",
        {
          rows: [
            {
              p: {
                rate_fy: 2025,
                series: [
                  { fy: 2024, inspections: 10, current_penalty: 343_600_000 },
                  { fy: 2025, inspections: 10, current_penalty: 330_800_000 },
                  { fy: 2026, inspections: 4, current_penalty: 200_000_000 },
                ],
              },
            },
          ],
        },
      ],
      ["corpus_datasets?select=snapshot", { rows: [{ snapshot: "2026-10-17" }] }],
    ]);
    const block = (await (await reader("osha-penalties"))())!;
    expect(block.series[0]!.points.map((p) => p.value)).toEqual([
      343_600_000, 330_800_000, 200_000_000,
    ]);
    expect(block.series[0]!.points.at(-1)!.partial).toBe(true);
    expect(block.latest?.period).toBe("FY2025");
    expect(block.asOf).toBe("2026-10-17");
  });

  it("osha-penalties: is empty when the profile has no series", async () => {
    serve([
      ["dataset=eq.osha_inspections_national", { rows: [{ p: { rate_fy: 2025 } }] }],
      ["corpus_datasets?select=snapshot", { rows: [{}] }],
    ]);
    expect(await (await reader("osha-penalties"))()).toBeNull();
  });
});

describe("safety readers", () => {
  it("faers-outcomes: passes the national series through with unrecorded counts as gaps", async () => {
    readFaers.mockResolvedValue({
      dataThrough: "2026-06-30",
      national: [
        { year: 2025, reports: 1, partial: false, serious: 711_668, deaths: 95_000 },
        { year: 2026, reports: 1, partial: true, serious: 360_000, deaths: null, lawyer: 2_000 },
      ],
      products: [],
    });
    const block = (await (await reader("faers-outcomes"))())!;
    expect(block.series.map((s) => s.points.map((p) => p.value))).toEqual([
      [711_668, 360_000],
      [95_000, null],
      [null, 2_000],
    ]);
    expect(block.asOf).toBe("2026-06-30");
    expect(block.latest?.value).toBe(711_668);
  });

  it("faers-outcomes and cpsc blocks are empty when their source holds nothing", async () => {
    readFaers.mockResolvedValue(null);
    readCpsc.mockResolvedValue(null);
    expect(await (await reader("faers-outcomes"))()).toBeNull();
    expect(await (await reader("cpsc-hazards"))()).toBeNull();
    expect(await (await reader("cpsc-deaths"))()).toBeNull();
  });

  it("faers-outcomes: a failed read is an error, not an empty block", async () => {
    readFaers.mockRejectedValue(new Error("External corpus read failed (503)."));
    await expect((await reader("faers-outcomes"))()).rejects.toThrow("503");
  });

  it("cpsc: draws the most common hazards and starts the death chart where injury statements exist", async () => {
    readCpsc.mockResolvedValue({
      asOf: "2026-10-15",
      hazardLabels: { fire_burn: "Fire, burn and overheating", fall: "Fall" },
      years: [
        { year: 1999, partial: false, hazards: { fire_burn: 51, fall: 19 }, deathMentions: 2 },
        { year: 2000, partial: false, hazards: { fire_burn: 63, fall: 31 }, deathMentions: 8 },
        { year: 2026, partial: true, hazards: { fire_burn: 20, fall: 10 }, deathMentions: 3 },
      ],
    });
    const hazards = (await (await reader("cpsc-hazards"))())!;
    expect(hazards.series.map((s) => s.label)).toEqual(["Fire, burn and overheating", "Fall"]);
    expect(hazards.series[0]!.points.map((p) => p.x)).toContain("1999");
    const deaths = (await (await reader("cpsc-deaths"))())!;
    expect(deaths.series[0]!.points[0]).toEqual({ x: "2000", value: 8 });
    expect(deaths.series[0]!.points.some((p) => p.x === "1999")).toBe(false);
    expect(deaths.asOf).toBe("2026-10-15");
  });

  it("saferproducts-reports: reads the publication-year rows and the export's publication window", async () => {
    serve([
      [
        "dataset=eq.saferproducts_reports_series",
        {
          rows: [
            { s: { kind: "published", year: 2011, reports: 4600, partial: true } },
            { s: { kind: "published", year: 2012, reports: 6700, partial: false } },
            { s: { kind: "received", year: 2012, reports: 1, partial: false } },
          ],
        },
      ],
      [
        "corpus_datasets?select=window",
        { rows: [{ window: { first: "2011-03-11", last: "2012-12-31" } }] },
      ],
    ]);
    const block = (await (await reader("saferproducts-reports"))())!;
    expect(block.series[0]!.points.map((p) => p.value)).toEqual([4600, 6700]);
    expect(block.series[0]!.points[0]!.partial).toBe(true);
    expect(block.asOf).toBe("2012-12-31");
    expect(block.notes.some((n) => n.includes("March 11, 2011"))).toBe(true);
  });

  it("fda-class-i: counts Class I entries per product type and report year by exact filter", async () => {
    const countPaths: string[] = [];
    restGet.mockImplementation(async (path: string) => {
      if (path.includes("order=filters->report_date.asc"))
        return { rows: [{ d: "2025-01-03" }], total: null };
      if (path.includes("order=filters->report_date.desc"))
        return { rows: [{ d: "2026-09-09" }], total: null };
      countPaths.push(decodeURIComponent(path));
      const year = Number(/gte\.(\d{4})/.exec(path)![1]);
      const dataset = /dataset=eq\.([a-z_]+)/.exec(path)![1]!;
      const base = dataset.includes("drug") ? 10 : dataset.includes("device") ? 20 : 30;
      return { rows: [], total: base + (year - 2000), count: true };
    });
    const block = (await (await reader("fda-class-i"))())!;
    expect(countPaths).toHaveLength(6);
    expect(countPaths.every((p) => p.includes('{"classification":["class i"]}'))).toBe(true);
    expect(block.series.map((s) => s.points.map((p) => p.value))).toEqual([
      [35, 36],
      [45, 46],
      [55, 56],
    ]);
    expect(block.latest?.value).toBe(135);
    expect(block.series[0]!.points[1]!.partial).toBe(true);
  });

  it("fda-class-i: is empty when no enforcement dataset holds a report date", async () => {
    serve([["order=filters->report_date", { rows: [] }]]);
    expect(await (await reader("fda-class-i"))()).toBeNull();
  });
});
