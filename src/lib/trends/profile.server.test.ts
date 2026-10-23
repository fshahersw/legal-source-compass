import { beforeEach, describe, expect, it, vi } from "vitest";

type Reply = { rows: unknown[]; total?: number | null };
type Opts = { count?: boolean; range?: [number, number] };
const restGet = vi.hoisted(() => vi.fn());
vi.mock("@/lib/external/rest.server", () => ({ restGet }));

/** Answer a PostgREST path from the first matching rule; an unmatched path fails the test. */
function serve(rules: [string, Reply | ((path: string, opts: Opts) => Reply)][]) {
  restGet.mockImplementation(async (path: string, opts: Opts = {}) => {
    const decoded = decodeURIComponent(path);
    for (const [needle, reply] of rules)
      if (decoded.includes(needle)) {
        const r = typeof reply === "function" ? reply(decoded, opts) : reply;
        return { rows: r.rows, total: r.total ?? null };
      }
    throw new Error(`Unexpected read: ${decoded}`);
  });
}

/** Readers cache a successful read, so each test imports a fresh module instance. */
async function reader() {
  vi.resetModules();
  const mod = await import("./profile.server");
  return mod.readProfileTrend;
}

beforeEach(() => {
  restGet.mockReset();
});

describe("mdl-monthly-pending", () => {
  const history = {
    mdl: 2873,
    last_report: "2026-10-01",
    series: [
      { month: "2024-10", pending: 9896, total: 10185 },
      { month: "2024-11", pending: 10000, total: 10300 },
      { month: "bad", pending: 1, total: 1 },
    ],
  };

  it("builds the series from the record of exactly that MDL", async () => {
    serve([["dataset=eq.jpml_pending_history_mdls&id=eq.2873", { rows: [{ h: history }] }]]);
    const block = (await (await reader())("mdl-monthly-pending", "2873"))!;
    expect(block.series[0]!.points.map((p) => p.value)).toEqual([9896, 10000]);
    expect(block.asOf).toBe("2026-10-01");
  });

  it("never uses a record that carries a different MDL number", async () => {
    serve([["jpml_pending_history_mdls", { rows: [{ h: { ...history, mdl: 9999 } }] }]]);
    expect(await (await reader())("mdl-monthly-pending", "2873")).toBeNull();
  });

  it("returns null when the MDL has no record", async () => {
    serve([["jpml_pending_history_mdls", { rows: [] }]]);
    expect(await (await reader())("mdl-monthly-pending", "2873")).toBeNull();
  });
});

describe("mdl-fy-pending", () => {
  it("keeps fiscal years that are absent from the series as gaps", async () => {
    serve([
      [
        "dataset=eq.jpml_statistics_extra&id=eq.mdl:2873",
        {
          rows: [
            {
              h: {
                mdl: 2873,
                left_censored: false,
                series: [
                  { fy: 2021, pending: 1681 },
                  { fy: 2022, pending: 3037 },
                  { fy: 2024, pending: 9896 },
                  { fy: 2025, pending: 13942 },
                ],
              },
            },
          ],
        },
      ],
    ]);
    const block = (await (await reader())("mdl-fy-pending", "2873"))!;
    expect(block.series[0]!.points.map((p) => [p.x, p.value])).toEqual([
      ["2021", 1681],
      ["2022", 3037],
      ["2023", null],
      ["2024", 9896],
      ["2025", 13942],
    ]);
  });
});

describe("mdl-fjc-years", () => {
  it("reads the case counts and the file's through date", async () => {
    serve([
      [
        "dataset=eq.fjc_civil_mdls&id=eq.mdl:2885",
        {
          rows: [
            {
              p: {
                mdl: 2885,
                by_fy: [
                  { fy: 2019, cases: 5 },
                  { fy: 2021, cases: 7 },
                  { fy: "x", cases: 1 },
                ],
              },
            },
          ],
        },
      ],
      [
        "dataset=eq.fjc_civil_national",
        {
          rows: [
            {
              p: {
                latest_fy: 2025,
                series: [
                  { fy: 2019, filings: 500 },
                  { fy: 2021, filings: 200 },
                ],
              },
            },
          ],
        },
      ],
      [
        "corpus_datasets?select=s:metadata->summary->>snapshot",
        {
          rows: [
            {
              s: "cv88on.zip, last modified 2026-08-26 on fjc.gov; filing dates through 2026-06-30",
            },
          ],
        },
      ],
    ]);
    const block = (await (await reader())("mdl-fjc-years", "2885"))!;
    expect(block.series[0]!.points.map((p) => p.value)).toEqual([5, 0, 7]);
    expect(block.asOf).toBe("2026-06-30");
    expect(block.notes.join(" ")).toContain(
      "In FY2021 these 7 cases were 3.5% of the 200 civil cases filed",
    );
  });
});

describe("registry years", () => {
  const hierarchy = {
    mdl: 2873,
    m: [
      { year: 2025, actions: 135 },
      { year: 2026, actions: 1 },
    ],
    o: [{ year: 2024, dockets: 24 }],
    a: 1616,
    od: 26,
  };
  const rules: [string, Reply][] = [
    ["dataset=eq.mdl_hierarchy&id=eq.mdl:2873", { rows: [hierarchy] }],
    [
      "corpus_datasets?select=u:updated_at&id=eq.mdl_hierarchy",
      { rows: [{ u: "2026-10-19 03:04:35.846075+00" }] },
    ],
  ];

  it("members: marks the year the registry was published in as partial", async () => {
    serve(rules);
    const block = (await (await reader())("mdl-members-years", "2873"))!;
    expect(block.series[0]!.points.map((p) => [p.x, p.value, p.partial ?? false])).toEqual([
      ["2025", 135, false],
      ["2026", 1, true],
    ]);
    expect(block.unit).toBe("actions");
    expect(block.notes.join(" ")).toContain("136 of 1,616 member actions have a filing year");
  });

  it("transferred-in dockets: reads the origin series and shares the one hierarchy read", async () => {
    serve(rules);
    const read = await reader();
    const a = (await read("mdl-transferred-years", "2873"))!;
    await read("mdl-members-years", "2873");
    expect(a.series[0]!.points.map((p) => p.value)).toEqual([24]);
    expect(a.notes.join(" ")).toContain("24 of 26 originating dockets have a filing year");
    expect(restGet.mock.calls.filter(([p]) => String(p).includes("mdl_hierarchy&id")).length).toBe(
      1,
    );
  });

  it("is null for an MDL the registry does not hold", async () => {
    serve([
      ["dataset=eq.mdl_hierarchy", { rows: [] }],
      ["corpus_datasets", { rows: [{ u: "2026-10-19" }] }],
    ]);
    expect(await (await reader())("mdl-members-years", "2873")).toBeNull();
  });
});

describe("adverse-event series", () => {
  const series = [
    { year: 2024, reports: 100, deaths: 2, partial: false, national_reports: 2000000 },
    { year: 2026, reports: 40, deaths: 0, partial: true, national_reports: 900000 },
  ];

  it("faers: reads the product series of exactly that MDL and its death-outcome counts", async () => {
    serve([
      [
        "dataset=eq.fda_faers_product_series&id=eq.1871",
        { rows: [{ m: 1871, s: series, d: "2026-06-30" }] },
      ],
    ]);
    const block = (await (await reader())("mdl-faers-years", "1871"))!;
    expect(block.series[0]!.points.map((p) => [p.x, p.value])).toEqual([
      ["2024", 100],
      ["2025", null],
      ["2026", 40],
    ]);
    expect(block.series[1]!.points[0]!.value).toBe(2);
    expect(block.asOf).toBe("2026-06-30");
  });

  it("maude: reads the death key of the device series", async () => {
    serve([
      [
        "dataset=eq.fda_device_event_series&id=eq.2197",
        {
          rows: [
            {
              m: 2197,
              s: [{ year: 2012, reports: 18781, death: 9, partial: false, national_reports: 1 }],
              d: "2026-09-30",
            },
          ],
        },
      ],
    ]);
    const block = (await (await reader())("mdl-maude-years", "2197"))!;
    expect(block.series[1]!.points[0]!.value).toBe(9);
  });

  it("never uses a record of a different MDL and is null when none is held", async () => {
    serve([["fda_faers_product_series", { rows: [{ m: 9999, s: series, d: null }] }]]);
    expect(await (await reader())("mdl-faers-years", "1871")).toBeNull();
    serve([["fda_faers_product_series", { rows: [] }]]);
    expect(await (await reader())("mdl-faers-years", "1871")).toBeNull();
  });
});

describe("matter-docket-entries", () => {
  const matter = { c: { mdl_number: 2804, entries_total: 5 } };
  const dates = ["2017-12-05", "2017-12-20", "2018-03-02", null, "2026-10-02"].map((d) => ({ d }));

  it("pages the entry dates and compares them with the provider total", async () => {
    serve([
      ["dataset=eq.sw_matters_v1&id=eq.sw-matter:2804", { rows: [matter] }],
      [
        "corpus_datasets?select=u:updated_at&id=eq.sw_docket_entries_v1",
        { rows: [{ u: "2026-10-07 00:59:32+00" }] },
      ],
      ["dataset=eq.sw_docket_entries_v1", { rows: dates, total: dates.length }],
    ]);
    const block = (await (await reader())("matter-docket-entries", "2804"))!;
    const pts = block.series[0]!.points;
    expect(pts[0]).toMatchObject({ x: "2017-12", value: 2 });
    expect(pts.find((p) => p.x === "2018-01")!.value).toBe(0); // 5 captured of 5 reported: complete
    expect(pts.at(-1)).toMatchObject({ x: "2026-10", value: 1, partial: true });
    const entryReads = restGet.mock.calls.map(([p]) => decodeURIComponent(String(p)));
    expect(entryReads.some((p) => p.includes('filters=cs.{"mdl":"2804"}'))).toBe(true);
  });

  it("is null when the matter record is missing or names another MDL, or holds no entry", async () => {
    serve([
      ["sw_matters_v1", { rows: [{ c: { mdl_number: 1, entries_total: 5 } }] }],
      ["corpus_datasets", { rows: [{ u: "2026-10-07" }] }],
      ["sw_docket_entries_v1", { rows: dates, total: dates.length }],
    ]);
    expect(await (await reader())("matter-docket-entries", "2804")).toBeNull();
    serve([
      ["sw_matters_v1", { rows: [matter] }],
      ["corpus_datasets", { rows: [{ u: "2026-10-07" }] }],
      ["sw_docket_entries_v1", { rows: [], total: 0 }],
    ]);
    expect(await (await reader())("matter-docket-entries", "2804")).toBeNull();
  });

  it("lets a failed read throw so the card shows its error state", async () => {
    restGet.mockRejectedValue(new Error("External corpus read failed (500)."));
    await expect((await reader())("matter-docket-entries", "2804")).rejects.toThrow("failed");
  });
});
