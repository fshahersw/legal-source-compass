import { beforeEach, describe, expect, it, vi } from "vitest";

type Reply = { rows: unknown[]; total?: number | null };
const restGet = vi.hoisted(() => vi.fn());
vi.mock("@/lib/external/rest.server", () => ({ restGet }));

import { readBlock } from "./overview.server";

/** Answer a PostgREST path from the first matching rule; an unmatched path fails the test. */
function serve(rules: [string, Reply | ((path: string) => Reply)][]) {
  restGet.mockImplementation(async (path: string) => {
    for (const [needle, reply] of rules)
      if (path.includes(needle)) {
        const r = typeof reply === "function" ? reply(path) : reply;
        return { rows: r.rows, total: r.total ?? null };
      }
    throw new Error(`Unexpected read: ${path}`);
  });
}

beforeEach(() => {
  restGet.mockReset();
});

describe("readBlock", () => {
  it("rejects an unknown block id", async () => {
    await expect(readBlock("nope")).rejects.toThrow("Unknown analytics block");
  });

  it("federal-civil: parses the national profile and quotes the through-date of the snapshot", async () => {
    serve([
      [
        "dataset=eq.fjc_civil_national",
        {
          rows: [
            {
              p: {
                latest_fy: 2025,
                partial_fy: 2026,
                series: [
                  { fy: 2024, filings: 291016, terminations: 396635, pending_end: 1 },
                  { fy: 2025, filings: 303716, terminations: 407539, pending_end: 2 },
                  {
                    fy: 2026,
                    filings: 276610,
                    terminations: 229735,
                    pending_end: 3,
                    partial: true,
                  },
                ],
              },
            },
          ],
        },
      ],
      [
        "corpus_datasets?select=snapshot:metadata->summary->>snapshot",
        { rows: [{ snapshot: "cv88on.zip; filing dates through 2026-06-30" }] },
      ],
    ]);
    const block = (await readBlock("federal-civil"))!;
    expect(block.series[0]!.points.map((p) => p.value)).toEqual([291016, 303716, 276610]);
    expect(block.series[0]!.points.at(-1)!.partial).toBe(true);
    expect(block.asOf).toBe("2026-06-30");
    expect(block.latest?.value).toBe(303716);
  });

  it("judicial-nominations: pages the filters of every nomination and counts per Congress", async () => {
    const rows = [
      ...Array.from({ length: 1200 }, (_, i) => ({
        c: "118",
        s: i < 900 ? "confirmed" : "returned",
      })),
      ...Array.from({ length: 300 }, () => ({ c: "119", s: "pending" })),
    ];
    serve([
      [
        "dataset=eq.judicial_nominations",
        (path) => {
          expect(path).toContain("select=c:filters->congress->>0,s:filters->status->>0");
          expect(path).toContain("order=ordinal.asc,id.asc");
          return { rows: [], total: 1500 };
        },
      ],
      ["metadata->summary->>as_of", { rows: [{ asOf: "2026-10-22" }] }],
    ]);
    restGet.mockImplementation(
      async (path: string, opts: { count?: boolean; range?: [number, number] }) => {
        if (path.startsWith("corpus_datasets"))
          return { rows: [{ asOf: "2026-10-22" }], total: null };
        const [a, b] = opts.range ?? [0, 999];
        return { rows: rows.slice(a, b + 1), total: opts.count ? rows.length : null };
      },
    );
    const block = (await readBlock("judicial-nominations"))!;
    expect(block.series[0]!.points).toEqual([
      { x: "118", value: 1200 },
      { x: "119", value: 300, partial: true },
    ]);
    expect(block.series[1]!.points[0]!.value).toBe(900);
    expect(block.latest?.period).toBe("118th Congress (2023–2024)");
  });

  it("judicial-nominations: fails when the dataset states no as-of date", async () => {
    restGet.mockImplementation(async (path: string, opts: { count?: boolean }) =>
      path.startsWith("corpus_datasets")
        ? { rows: [{}], total: null }
        : { rows: [{ c: "118", s: "confirmed" }], total: opts.count ? 1 : null },
    );
    // Fresh module instance: the readers cache a successful read, and the previous test read this block.
    vi.resetModules();
    const fresh = await import("./overview.server");
    await expect(fresh.readBlock("judicial-nominations")).rejects.toThrow("no as-of date");
  });

  it("congress-bills: introduced from the summary, became-law counted per Congress by exact filter", async () => {
    const seen: string[] = [];
    serve([
      [
        "corpus_datasets?select=perCongressType",
        {
          rows: [
            {
              perCongressType: {
                "118-hr": 10564,
                "118-s": 5649,
                "118-hjres": 230,
                "118-sjres": 122,
                "118-hres": 1627,
                "119-hr": 10848,
              },
              retrieved: "2026-10-23",
            },
          ],
        },
      ],
      [
        "dataset=eq.congress_bills",
        (path) => {
          seen.push(decodeURIComponent(path));
          return { rows: [{ id: "x" }], total: path.includes("118") ? 274 : 136 };
        },
      ],
    ]);
    const block = (await readBlock("congress-bills"))!;
    expect(seen).toHaveLength(2);
    expect(seen.every((p) => p.includes('"status":["became_law"]'))).toBe(true);
    expect(block.series[0]!.points.map((p) => p.value)).toEqual([16565, 10848]);
    expect(block.series[1]!.points.map((p) => p.value)).toEqual([274, 136]);
    expect(block.series[0]!.points[1]!.partial).toBe(true);
  });

  it("judicial-vacancies: keeps only fully read monthly lists", async () => {
    serve([
      [
        "dataset=eq.judicial_vacancies",
        {
          rows: [
            {
              s: [
                { month: "2026-08", reports: { vacancies: "parsed" }, vacancies_listed: 26 },
                {
                  month: "2026-09",
                  reports: {
                    vacancies: "partial: 15 rows parsed, the report prints a total of 18",
                  },
                  vacancies_listed: 15,
                },
                { month: "2026-10", reports: { vacancies: "parsed" }, vacancies_listed: 28 },
              ],
            },
          ],
        },
      ],
      ["metadata->summary->>as_of", { rows: [{ asOf: "2026-10-22" }] }],
    ]);
    const block = (await readBlock("judicial-vacancies"))!;
    expect(block.series[0]!.points.map((p) => p.value)).toEqual([26, null, 28]);
    expect(block.gaps).toBe(1);
  });

  it("fda-recalls: counts each year of each endpoint by exact report-date range", async () => {
    const countPaths: string[] = [];
    restGet.mockImplementation(
      async (path: string, opts: { count?: boolean; range?: [number, number] }) => {
        if (path.includes("order=filters->report_date.asc"))
          return { rows: [{ d: "2025-01-03" }], total: null };
        if (path.includes("order=filters->report_date.desc"))
          return { rows: [{ d: "2026-09-09" }], total: null };
        countPaths.push(path);
        const year = /gte\.(\d{4})/.exec(path)![1]!;
        const dataset = /dataset=eq\.([a-z_]+)/.exec(path)![1]!;
        const base = dataset.includes("drug") ? 100 : dataset.includes("device") ? 200 : 300;
        return { rows: [], total: base + Number(year) - 2000 };
      },
    );
    const block = (await readBlock("fda-recalls"))!;
    expect(countPaths).toHaveLength(6);
    expect(countPaths[0]).toContain("filters-%3E%3Ereport_date=gte.2025-01-01");
    expect(countPaths[0]).toContain("filters-%3E%3Ereport_date=lt.2026-01-01");
    expect(block.series.map((s) => s.points.map((p) => p.value))).toEqual([
      [125, 126],
      [225, 226],
      [325, 326],
    ]);
    expect(block.latest?.value).toBe(675);
    expect(block.series[0]!.points[1]!.partial).toBe(true);
  });

  it("doj-press: reads the index and the latest release date of the last partition", async () => {
    serve([
      [
        "dataset=eq.doj_press_releases&id=eq.doj-index:overview",
        {
          rows: [
            {
              o: {
                partitions: [
                  { dataset: "doj_press_releases_2025", year: "2025", records: 19449 },
                  { dataset: "doj_press_releases_2026", year: "2026", records: 16682 },
                ],
                by_year: [
                  { year: "2025", count: 19449 },
                  { year: "2026", count: 16682 },
                ],
              },
            },
          ],
        },
      ],
      [
        "dataset=eq.doj_press_releases_2026&order=item->release->date.desc.nullslast",
        { rows: [{ d: "2026-10-22" }] },
      ],
    ]);
    const block = (await readBlock("doj-press"))!;
    expect(block.series[0]!.points.map((p) => p.value)).toEqual([19449, 16682]);
    expect(block.series[0]!.points[1]!.partial).toBe(true);
    expect(block.asOf).toBe("2026-10-22");
  });

  it("epa-cases: skips the all-years row and uses the dataset's latest complete fiscal year", async () => {
    serve([
      [
        "dataset=eq.epa_echo_case_series",
        {
          rows: [
            { cells: { fy: "All", opened: 137026 } },
            { cells: { fy: 2025, opened: 3027, judicial: 22 } },
            { cells: { fy: 2026, opened: 4021, judicial: 13 } },
            { cells: { fy: 2027, opened: 12, judicial: 0 } },
          ],
        },
      ],
      ["corpus_datasets?select=fileDate", { rows: [{ fileDate: "2026-10-17", latestFy: "2026" }] }],
    ]);
    const block = (await readBlock("epa-cases"))!;
    expect(block.series[0]!.points.map((p) => p.value)).toEqual([3027, 4021]);
    expect(block.latest?.change?.absolute).toBe(994);
  });

  it("ftc-sentinel: reads the US-<year> records and links the newest data book", async () => {
    serve([
      [
        "dataset=eq.ftc_sentinel_national",
        {
          rows: [
            {
              id: "US-2023",
              reports: { total: 5392028, fraud: 2566261 },
              source_url: "https://www.ftc.gov/a.pdf",
            },
            {
              id: "US-2024",
              reports: { total: 6471708, fraud: 2600678 },
              source_url: "https://www.ftc.gov/b.pdf",
            },
          ],
        },
      ],
    ]);
    const block = (await readBlock("ftc-sentinel"))!;
    expect(block.source.url).toBe("https://www.ftc.gov/b.pdf");
    expect(block.latest?.change?.absolute).toBe(1079680);
  });

  it("is an error, not an empty block, when a read fails, and a later call reads again", async () => {
    restGet.mockRejectedValue(new Error("External corpus read failed (503)."));
    await expect(readBlock("fsis-recalls")).rejects.toThrow("503");
    serve([
      [
        "corpus_datasets?select=byYear",
        { rows: [{ byYear: { "2025": { I: 39, II: 2, III: 2, PHA: 24 } } }] },
      ],
      ["dataset=eq.fsis_recalls", { rows: [{ d: "2025-12-30" }] }],
    ]);
    const block = (await readBlock("fsis-recalls"))!;
    expect(block.series[0]!.points[0]!.value).toBe(43);
    expect(block.series[1]!.points[0]!.value).toBe(24);
  });

  it("is empty (null) when the dataset holds nothing usable", async () => {
    serve([["dataset=eq.fr_agency_trends", { rows: [] }]]);
    expect(await readBlock("federal-register")).toBeNull();
  });
});
