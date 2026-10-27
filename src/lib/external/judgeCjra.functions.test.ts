import { describe, expect, it, vi } from "vitest";

vi.mock("./rest.server", () => ({ restGet: vi.fn() }));
vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => ({
    handler: (handler: unknown) => handler,
    inputValidator: () => ({ handler: (handler: unknown) => handler }),
  }),
}));

import { restGet } from "./rest.server";
import {
  benchFromCjraRows,
  getCourtBench,
  getJudgeCjra,
  lastPoint,
  parseCjraRow,
} from "./judgeCjra.functions";

const SHIPP = "2bd1f904b1639f16cc7e65e218c52997";
const PERIODS = ["2025-03-31", "2025-09-30", "2026-03-31"];
// Shape of court_cjra_judges row njd-shipp-michael-a, trimmed to the last three reports.
const row = (over: Record<string, unknown> = {}, item: Record<string, unknown> = {}) => ({
  id: "njd-shipp-michael-a",
  title: "Michael Andre Shipp",
  source_url: "https://www.uscourts.gov/sites/default/files/document/cjra_na_0331.2026.pdf",
  ...over,
  item: {
    id: "njd-shipp-michael-a",
    kind: "judge",
    cells: { court: "U.S. District Court, D. New Jersey", judge: "Michael Andre Shipp" },
    match: { status: "unique", profile: SHIPP },
    notes: [
      {
        text: "Three-year-old caseload consists mostly of cases related to multidistrict litigation.",
        column: "civil_3y",
        marker: 1,
        period: "2026-03-31",
      },
    ],
    roles: ["district", "magistrate"],
    periods: PERIODS,
    court_id: "njd",
    printed_names: ["SHIPP, MICHAEL A."],
    series: {
      civil_3y: [34000, null, 35696],
      motions_6m: [0, null, 0],
      ss_appeals_6m: [0, null, 0],
      bench_trials_6m: [0, null, 0],
      bankruptcy_appeals_6m: [0, null, 0],
    },
    ...item,
  },
});

describe("parseCjraRow", () => {
  it("keeps null report points null and finds the last listed value", () => {
    const c = parseCjraRow(row(), SHIPP)!;
    expect(c.series.civil_3y).toEqual([34000, null, 35696]);
    expect(lastPoint(c, "civil_3y")).toEqual({ period: "2026-03-31", value: 35696 });
    expect(c.latestPeriod).toBe("2026-03-31");
    expect(c.notes[0]?.column).toBe("civil_3y");
    expect(c.sourceUrl).toMatch(/^https:\/\/www\.uscourts\.gov\//);
  });

  it("links only a unique match naming exactly this judge", () => {
    expect(parseCjraRow(row(), "ffffffffffffffffffffffffffffffff")).toBeNull();
    expect(parseCjraRow(row({}, { match: { status: "none", profile: null } }), SHIPP)).toBeNull();
  });

  it("does not draw a series that does not line up with the report dates", () => {
    const c = parseCjraRow(
      row({}, { series: { civil_3y: [1, 2], motions_6m: [0, 1, 2] } }),
      SHIPP,
    )!;
    expect(c.series.civil_3y).toEqual([null, null, null]);
    expect(c.series.motions_6m).toEqual([0, 1, 2]);
    expect(lastPoint(c, "civil_3y")).toBeNull();
  });

  it("rejects unordered periods and keeps only official source links", () => {
    expect(
      parseCjraRow(row({}, { periods: ["2026-03-31", "2025-09-30", "2025-03-31"] }), SHIPP),
    ).toBeNull();
    expect(
      parseCjraRow(row({ source_url: "https://example.com/x.pdf" }), SHIPP)!.sourceUrl,
    ).toBeNull();
  });
});

describe("getJudgeCjra", () => {
  const handler = getJudgeCjra as unknown as (a: { data: { id: string } }) => Promise<unknown>;

  it("falls back to the match profile when the filter key is absent, and returns null for two rows", async () => {
    const mocked = vi.mocked(restGet);
    mocked.mockReset();
    mocked
      .mockResolvedValueOnce({ rows: [], total: null })
      .mockResolvedValueOnce({ rows: [row()], total: null });
    const c = (await handler({ data: { id: SHIPP } })) as { recordId: string };
    expect(c.recordId).toBe("njd-shipp-michael-a");
    expect(mocked.mock.calls[0]![0]).toContain("dataset=eq.court_cjra_judges&filters=cs.");
    expect(mocked.mock.calls[1]![0]).toContain(`item->match->>profile=eq.${SHIPP}`);

    mocked.mockReset();
    mocked.mockResolvedValueOnce({ rows: [row(), row({ id: "njd-shipp-2" })], total: null });
    expect(await handler({ data: { id: SHIPP } })).toBeNull();
  });
});

describe("benchFromCjraRows", () => {
  it("takes the latest report values and never links a profile claimed twice", () => {
    const a = row({ id: "njd-a", title: "Judge A" }, { printed_names: ["ALPHA, A."] });
    const b = row(
      { id: "njd-b", title: "Judge B" },
      {
        printed_names: ["BETA, B."],
        match: { status: "unique", profile: "11111111111111111111111111111111" },
      },
    );
    const b2 = row(
      { id: "njd-b2", title: "Judge B (second row)" },
      {
        printed_names: ["BETA, B. II"],
        match: { status: "unique", profile: "11111111111111111111111111111111" },
      },
    );
    const bench = benchFromCjraRows("njd", [b, a, b2]);
    expect(bench.period).toBe("2026-03-31");
    expect(bench.judges.map((j) => j.recordId)).toEqual(["njd-a", "njd-b", "njd-b2"]);
    expect(bench.judges[0]!.profileId).toBe(SHIPP);
    expect(bench.judges[1]!.profileId).toBeNull();
    expect(bench.judges[0]!.civil3y).toBe(35696);
    expect(bench.judges[0]!.medianDaysCivil).toBeNull();
  });
});

describe("getCourtBench", () => {
  it("adds collection measures only through an exactly linked person", async () => {
    const mocked = vi.mocked(restGet);
    mocked.mockReset();
    mocked
      .mockResolvedValueOnce({ rows: [row()], total: null })
      .mockResolvedValueOnce({
        rows: [
          {
            id: SHIPP,
            p: {
              judges_id: SHIPP,
              tier: "exact_id",
              cl_person_id: 2001,
              cl_dockets_record: "/records/clb_judge_dockets/2001",
            },
          },
        ],
        total: null,
      })
      .mockResolvedValueOnce({
        rows: [
          {
            id: "2001",
            p: {
              person_id: 2001,
              dockets: {
                assigned: 50,
                duration_civil: { median_days: 300, n: 40 },
                nos_recorded: 10,
                nos_groups: [
                  { value: "product", label: "Product", count: 4 },
                  { value: "contract", label: "Contract", count: 6 },
                ],
              },
            },
          },
        ],
        total: null,
      });
    const handler = getCourtBench as unknown as (a: { data: { court: string } }) => Promise<{
      judges: { medianDaysCivil: number | null; productShare: number | null; clLinked: boolean }[];
    }>;
    const b = await handler({ data: { court: "njd" } });
    expect(b.judges[0]).toMatchObject({ medianDaysCivil: 300, productShare: 40, clLinked: true });
    expect(mocked.mock.calls[0]![0]).toContain("dataset=eq.court_cjra_judges");
    expect(mocked.mock.calls[1]![0]).toContain(`id=in.(${SHIPP})`);
  });
});
