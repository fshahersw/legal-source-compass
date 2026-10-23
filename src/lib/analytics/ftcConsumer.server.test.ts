import { beforeEach, describe, expect, it, vi } from "vitest";

type Reply = { rows: unknown[]; total?: number | null };
const restGet = vi.hoisted(() => vi.fn());
vi.mock("@/lib/external/rest.server", () => ({ restGet }));

/** A fresh module per test: the reader memoises its result for ten minutes. */
async function reader() {
  vi.resetModules();
  return (await import("./ftcConsumer.server")).readFtcConsumerOverview;
}

/** Answer a PostgREST path from the first matching rule (an Error rule makes that read fail); an unmatched path fails the test. */
function serve(rules: [string, Reply | Error][]) {
  restGet.mockImplementation(async (path: string) => {
    for (const [needle, reply] of rules)
      if (path.includes(needle)) {
        if (reply instanceof Error) throw reply;
        return { rows: reply.rows, total: reply.total ?? null };
      }
    throw new Error(`Unexpected read: ${path}`);
  });
}

const national = {
  id: "US-2026-09",
  month: "2026-09",
  complete: false,
  method: "records",
  first: "2026-09-16",
  last: "2026-09-30",
  days: 15,
  dim: 30,
  m: { calls: 1000, robocalls: 700, not_robocalls: 250, no_flag: 50 },
  a: { robocall_share_pct: 73.68 },
  subj: { Other: 500, Charities: 100, "No Subject Provided": 150, "Medical & prescriptions": 250 },
  source_url: "https://www.ftc.gov/policy-notices/open-government/data-sets/do-not-call-data",
};
const seriesRow = {
  id: "series-by-year",
  s: {
    calendar_year: { "2025": 5 },
    fiscal_year: { "2025": 5, "2026": 7 },
    undated: 0,
    notices: 12,
  },
  cells: { period: "2025-01-02 to 2026-03-04" },
};
const post = {
  id: "spotlight-a",
  title: "A post",
  published: "April 27, 2026",
  iso: "2026-04-27",
  summary: "s",
  url: "https://www.ftc.gov/a",
  files: [],
};

const base = (): [string, Reply | Error][] => [
  ["%22national%22", { rows: [national] }],
  ["%22official%22", { rows: [] }],
  ["corpus_datasets", { rows: [{ terms: "Public domain." }] }],
  ["id=eq.series-by-year", { rows: [seriesRow] }],
  ["id=like.fy-*", { rows: [{ id: "fy-2025", partial: false, m: { et_granted: 265 } }] }],
  ["dataset=eq.ftc_publications_index", { rows: [post] }],
];

beforeEach(() => {
  restGet.mockReset();
});

describe("readFtcConsumerOverview", () => {
  it("builds the monthly and share blocks, the subject shares of the months read in full, the HSR block and the posts", async () => {
    serve(base());
    const r = await (await reader())();
    expect(r.unavailable).toEqual([]);
    expect(r.monthly?.series[0]!.points.at(-1)).toMatchObject({
      x: "2026-09",
      value: 1000,
      partial: true,
    });
    expect(r.share?.format).toBe("pct");
    expect(r.subjects?.window).toBe("complaints created September 16 to September 30, 2026");
    expect(r.subjects?.total).toBe(1000);
    expect(r.subjects?.named.map((s) => s.subject)).toEqual([
      "Medical & prescriptions",
      "Charities",
    ]);
    expect(r.subjects?.catchAll.map((s) => s.subject)).toEqual(["Other", "No Subject Provided"]);
    expect(r.hsr?.series.map((s) => s.id)).toEqual(["notices", "table"]);
    expect(r.spotlight.map((p) => p.title)).toEqual(["A post"]);
    expect(r.terms).toBe("Public domain.");
  });

  it("keeps the other parts when one dataset cannot be read, and says which part failed", async () => {
    serve([["%22national%22", new Error("boom")], ...base()]);
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const r = await (await reader())();
    spy.mockRestore();
    expect(r.unavailable).toEqual(["dnc"]);
    expect(r.monthly).toBeNull();
    expect(r.hsr).not.toBeNull();
    expect(r.spotlight).toHaveLength(1);
  });

  it("throws only when every part fails", async () => {
    serve([["dataset=eq.", new Error("down")]]);
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await expect((await reader())()).rejects.toThrow("could not be read");
    spy.mockRestore();
  });

  it("shows no subject card when no month was read record by record", async () => {
    serve([
      [
        "%22national%22",
        {
          rows: [
            {
              ...national,
              id: "US-2026-08",
              month: "2026-08",
              method: "count",
              complete: true,
              subj: {},
            },
          ],
        },
      ],
      ...base(),
    ]);
    const r = await (await reader())();
    expect(r.subjects).toBeNull();
    expect(r.monthly?.series[0]!.points.at(-1)!.value).toBe(1000);
  });
});
