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
  getDistrictCjra,
  latestWithPrevious,
  parseDistrictCjraRow,
  reportPagesFromRows,
} from "./courtCjra.functions";

const PERIODS = ["2025-03-31", "2025-09-30", "2026-03-31"];
// Shape of court_cjra_districts row nysd, trimmed to the last three reports.
const row = (item: Record<string, unknown> = {}, over: Record<string, unknown> = {}) => ({
  id: "nysd",
  source_url: "https://www.uscourts.gov/sites/default/files/document/cjra_na_0331.2026.pdf",
  ...over,
  item: {
    id: "nysd",
    court_id: "nysd",
    cells: { court: "U.S. District Court, S.D. New York", circuit: "Second Circuit" },
    periods: PERIODS,
    series: {
      civil_3y: [1338, 1364, 1331],
      motions_6m: [365, 343, 366],
      ss_appeals_6m: [1, 2, 3],
      bench_trials_6m: [4, 6, 5],
      bankruptcy_appeals_6m: [5, 5, 5],
    },
    sources: ["printed_total", "printed_total", "printed_total"],
    district_judges_listed: [50, 49, 47],
    civil_3y_per_listed_district_judge: [26.8, 27.8, 28.3],
    share_civil_3y_pct: [1.5, 1.57, 1.56],
    ranks: { of: 94, period: "2026-03-31", civil_3y: 10, motions_6m: 6 },
    peak_civil_3y: { value: 1364, period: "2025-09-30" },
    badges: ["Multidistrict litigation noted", "Source discrepancy"],
    reconciliation: { "2025-03-31": { status: "judge_rows_differ", difference: { civil_3y: 1 } } },
    not_recorded: {},
    notes: [
      { row: "SMITH, A.", page: 11, text: "Mostly multidistrict cases. Except for", marker: 1, period: "2025-03-31", measure: "civil_3y" },
      { row: "SMITH, A.", page: 13, text: "Mostly multidistrict cases. Except for one, settled.", marker: 1, period: "2025-09-30", measure: "civil_3y" },
      { row: "JONES, B.", page: 14, text: "Complex patent matters.", marker: 2, period: "2026-03-31", measure: "motions_6m" },
      { row: "JONES, B.", page: 14, text: "Outside the report dates.", marker: 2, period: "2019-03-31", measure: "civil_3y" },
    ],
    ...item,
  },
});

describe("court_cjra_districts parsing", () => {
  it("reads the district row for its own court id only", () => {
    const d = parseDistrictCjraRow(row(), "nysd")!;
    expect(d.series.civil_3y).toEqual([1338, 1364, 1331]);
    expect(d.rank).toEqual({ of: 94, period: "2026-03-31", civil3y: 10, motions6m: 6 });
    expect(d.peak).toEqual({ value: 1364, period: "2025-09-30" });
    expect(d.mdlNoted).toBe(true);
    expect(d.circuit).toBe("Second Circuit");
    expect(parseDistrictCjraRow(row(), "nyed")).toBeNull();
    expect(parseDistrictCjraRow(row({ court_id: "nyed" }), "nysd")).toBeNull();
  });

  it("keeps an unrecorded period null with its reason, never 0", () => {
    const d = parseDistrictCjraRow(
      row({
        series: {
          civil_3y: [1338, null, 1331],
          motions_6m: [365, null, 366],
          ss_appeals_6m: [1, null, 3],
          bench_trials_6m: [4, null, 5],
          bankruptcy_appeals_6m: [5, null, 5],
        },
        sources: ["printed_total", "not_recorded", "printed_total"],
        not_recorded: { "2025-09-30": "exempted by the Administrative Office from this report" },
      }),
      "nysd",
    )!;
    expect(d.series.civil_3y[1]).toBeNull();
    expect(d.basis[1]).toBe("not_recorded");
    expect(d.notRecorded["2025-09-30"]).toBe("exempted by the Administrative Office from this report");
    expect(latestWithPrevious(d, "civil_3y")).toEqual({ period: "2026-03-31", value: 1331, previous: null });
  });

  it("does not draw a series that does not line up with the report dates", () => {
    const d = parseDistrictCjraRow(
      row({ series: { civil_3y: [1, 2], motions_6m: [1, 2, 3] } }),
      "nysd",
    )!;
    expect(d.series.civil_3y).toEqual([null, null, null]);
    expect(d.series.motions_6m).toEqual([1, 2, 3]);
    expect(parseDistrictCjraRow(row({ periods: ["2026-03-31", "2025-09-30"] }), "nysd")).toBeNull();
  });

  it("merges a note printed in several reports and drops notes outside the report dates", () => {
    const d = parseDistrictCjraRow(row(), "nysd")!;
    expect(d.notes).toEqual([
      { row: "JONES, B.", text: "Complex patent matters.", measure: "motions_6m", periods: ["2026-03-31"], page: 14 },
      {
        row: "SMITH, A.",
        text: "Mostly multidistrict cases. Except for one, settled.",
        measure: "civil_3y",
        periods: ["2025-03-31", "2025-09-30"],
        page: 13,
      },
    ]);
  });

  it("lists printed-total differences as recorded", () => {
    const d = parseDistrictCjraRow(row(), "nysd")!;
    expect(d.differences).toEqual([
      { period: "2025-03-31", status: "judge_rows_differ", difference: { civil_3y: 1 } },
    ]);
  });

  it("takes the latest value with the report before it", () => {
    const d = parseDistrictCjraRow(row(), "nysd")!;
    expect(latestWithPrevious(d, "civil_3y")).toEqual({
      period: "2026-03-31",
      value: 1331,
      previous: { period: "2025-09-30", value: 1364 },
    });
  });

  it("links each period to its official report page only", () => {
    expect(
      reportPagesFromRows([
        {
          id: "2026-03-31",
          links: [
            { url: "https://www.uscourts.gov/data-news/reports/statistical-reports/civil-justice-reform-act-report/march-2026-civil-justice-reform-act" },
            { url: "https://www.uscourts.gov/sites/default/files/document/cjra_na_0331.2026.pdf" },
          ],
        },
        { id: "2025-09-30", links: [{ url: "https://example.com/civil-justice-reform-act" }] },
      ]),
    ).toEqual({
      "2026-03-31":
        "https://www.uscourts.gov/data-news/reports/statistical-reports/civil-justice-reform-act-report/march-2026-civil-justice-reform-act",
    });
  });
});

describe("getDistrictCjra", () => {
  const handler = getDistrictCjra as unknown as (a: { data: { id: string } }) => Promise<unknown>;
  const mocked = vi.mocked(restGet);

  it("returns null when the court has no district row", async () => {
    mocked.mockReset();
    mocked.mockResolvedValueOnce({ rows: [], total: null });
    mocked.mockResolvedValueOnce({ rows: [], total: null });
    expect(await handler({ data: { id: "nysd" } })).toBeNull();
    expect(mocked.mock.calls[0]![0]).toContain("dataset=eq.court_cjra_districts&id=eq.nysd");
  });

  it("joins the report pages to the district row", async () => {
    mocked.mockReset();
    mocked.mockResolvedValueOnce({ rows: [row()], total: null });
    mocked.mockResolvedValueOnce({
      rows: [
        {
          id: "2026-03-31",
          links: [
            { url: "https://www.uscourts.gov/data-news/reports/statistical-reports/civil-justice-reform-act-report/march-2026-civil-justice-reform-act" },
          ],
        },
      ],
      total: null,
    });
    const d = (await handler({ data: { id: "nysd" } })) as { reportPages: Record<string, string> };
    expect(Object.keys(d.reportPages)).toEqual(["2026-03-31"]);
  });
});
