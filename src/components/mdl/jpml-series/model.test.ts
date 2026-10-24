import { describe, expect, it } from "vitest";
import {
  fmtInt,
  fmtPct,
  fmtSigned,
  longDate,
  longGaps,
  monthKeys,
  monthlyAxis,
  monthlySeries,
  parseCircuit,
  parseDatedValues,
  parseEntity,
  parseMdlSeries,
  parseNationalPoint,
  parseOverview,
  safeSourceUrl,
  topAtLatest,
} from "./model";

const point = (date: string, extra: Record<string, unknown> = {}) => ({
  date,
  mdls: 160,
  pending: 200000,
  total: 700000,
  districts: 50,
  judges: 140,
  top10_share_pct: 80.27,
  hhi_district: 2053,
  lead_district: "NJ",
  lead_district_share_pct: 41.4,
  continuing_total_change: 2549,
  entered: 1,
  left: 5,
  months_since_previous: 1,
  filters_standard: true,
  source_url:
    "https://www.jpml.uscourts.gov/sites/jpml/files/Pending_MDL_Dockets_By_Actions_Pending-October-1-2026.pdf",
  ...extra,
});

describe("safeSourceUrl", () => {
  it("passes official JPML files and in-app record paths only", () => {
    expect(safeSourceUrl("https://www.jpml.uscourts.gov/sites/jpml/files/x.pdf")).toBe(
      "https://www.jpml.uscourts.gov/sites/jpml/files/x.pdf",
    );
    expect(
      safeSourceUrl("/records/jpml_series_index/series:national.pending_actions.monthly"),
    ).toBe("/records/jpml_series_index/series:national.pending_actions.monthly");
    expect(safeSourceUrl("https://example.com/x.pdf")).toBeNull();
    expect(safeSourceUrl("javascript:alert(1)")).toBeNull();
    expect(safeSourceUrl(42)).toBeNull();
  });
});

describe("parseNationalPoint / parseOverview", () => {
  it("keeps printed values and drops malformed points", () => {
    const p = parseNationalPoint(point("2026-10-01"));
    expect(p).toMatchObject({
      date: "2026-10-01",
      mdls: 160,
      pending: 200000,
      addedContinuing: 2549,
      leadDistrict: "NJ",
    });
    expect(parseNationalPoint({ ...point("2026-10-01"), pending: "200000" })).toBeNull();
    expect(parseNationalPoint({ ...point("Oct 2026") })).toBeNull();
  });

  it("keeps a missing flow as Not recorded (null), never zero", () => {
    expect(
      parseNationalPoint(point("2024-10-01", { continuing_total_change: null }))?.addedContinuing,
    ).toBeNull();
  });

  it("sorts by date and counts held reports", () => {
    const o = parseOverview({
      monthly: [point("2026-10-01"), point("2012-07-10"), { date: "bad" }],
      quarter_end: [point("2026-09-30")],
      monthly_gaps: [
        { after: "2012-07-10", before: "2014-04-15", months_missing: 20 },
        { after: "x" },
      ],
      held_reports: [{}, {}],
    });
    expect(o?.monthly.map((p) => p.date)).toEqual(["2012-07-10", "2026-10-01"]);
    expect(o?.gaps).toEqual([{ after: "2012-07-10", before: "2014-04-15", monthsMissing: 20 }]);
    expect(o?.heldReports).toBe(2);
    expect(o?.quarterEnd).toHaveLength(1);
  });

  it("returns null without monthly points", () => {
    expect(parseOverview({ monthly: [] })).toBeNull();
    expect(parseOverview(null)).toBeNull();
  });
});

describe("parseDatedValues / parseCircuit / parseEntity", () => {
  it("parses fiscal-year points", () => {
    expect(
      parseDatedValues([
        { date: "2025-09-30", value: 197118 },
        { date: "1992-09-30", value: 37253 },
        { date: "x", value: 1 },
      ]),
    ).toEqual([
      { date: "1992-09-30", value: 37253 },
      { date: "2025-09-30", value: 197118 },
    ]);
  });

  it("parses a circuit row", () => {
    const c = parseCircuit({
      circuit: { slug: "3", name: "Third Circuit" },
      series: [
        {
          date: "2026-09-30",
          districts: 5,
          mdls: 24,
          pending: 90251,
          total: 112248,
          pending_share_pct: 44.03,
        },
        { date: "2026-06-30", mdls: 26 },
      ],
    });
    expect(c).toEqual({
      slug: "3",
      name: "Third Circuit",
      points: [
        {
          date: "2026-09-30",
          districts: 5,
          mdls: 24,
          pending: 90251,
          total: 112248,
          sharePct: 44.03,
        },
      ],
    });
  });

  it("parses districts with an exact court id and judges by printed name", () => {
    const d = parseEntity("district:NJ", {
      district: "NJ",
      court: { court_id: "njd", label: "D. New Jersey" },
      series: [{ date: "2026-10-01", mdls: 12, pending: 84916, total: 99000, share_pct: 41.4 }],
    });
    expect(d).toMatchObject({
      id: "district:NJ",
      name: "NJ",
      courtId: "njd",
      courtLabel: "D. New Jersey",
    });
    const bad = parseEntity("district:XX", {
      district: "XX",
      court: { court_id: "../etc" },
      series: [{ date: "2026-10-01", mdls: 1, pending: 1, total: 1 }],
    });
    expect(bad?.courtId).toBeNull();
    const j = parseEntity("judge:joseph-r-goodwin-1a2b3c4d", {
      judge: "Joseph R Goodwin",
      series: [{ date: "2014-04-15", mdls: 7, pending: 49531, total: 50419 }],
    });
    expect(j?.name).toBe("Joseph R Goodwin");
    expect(parseEntity("other:1", { series: [] })).toBeNull();
  });
});

describe("topAtLatest", () => {
  const e = (name: string, pending: number, date = "2026-10-01") => ({
    id: name,
    name,
    courtId: null,
    courtLabel: null,
    points: [{ date, mdls: 1, pending, total: pending, sharePct: null }],
  });
  it("ranks by pending at the latest report, ties by name, skips entities not in it", () => {
    const out = topAtLatest(
      [e("B", 5), e("A", 5), e("C", 9), e("D", 100, "2021-03-15")],
      "2026-10-01",
      2,
    );
    expect(out.map((x) => x.name)).toEqual(["C", "A"]);
  });
});

describe("parseMdlSeries", () => {
  const item = {
    series: {
      mdl: 2738,
      status: "in_latest_monthly_report",
      latest_monthly_report: "2026-10-01",
      titles: [
        "IN RE: Johnson & Johnson Talcum Powder Products Marketing, Sales Practices and Products Liability Litigation",
      ],
      points: [
        {
          date: "2026-10-01",
          pending: 69340,
          total: 72024,
          district: "NJ",
          judges: ["Michael A. Shipp"],
          t: 0,
        },
        {
          date: "2026-09-01",
          pending: 69250,
          total: 71935,
          district: "NJ",
          judges: ["Michael A. Shipp"],
          t: 0,
        },
        { date: "bad", pending: 1, total: 1 },
      ],
      quarter_end_points: [
        {
          date: "2026-09-30",
          pending: 69340,
          total: 72024,
          district: "NJ",
          circuit: "Third",
          judges: [],
          t: 0,
        },
      ],
      title_runs: [{ value: "IN RE: x", from: "2026-09-01", to: "2026-10-01", reports: 2 }],
      district_runs: [],
      judge_runs: [],
      first_listed: "2026-09-01",
      last_listed: "2026-10-01",
      reports_listed: 2,
      reports_in_span: 2,
      absent_reports_in_span: [],
      peak: { value: 69340, date: "2026-10-01", points: 2 },
      actions_added: { added: 89, intervals: 1, decreases: 0, decrease_sum: 0 },
      changes: [
        {
          from: "2026-09-01",
          to: "2026-10-01",
          months_apart: 1,
          pending_change: 90,
          total_change: 89,
        },
      ],
      date_transferred: "2016-10-04",
      months_since_transfer_at_latest_point: 119,
    },
  };
  it("parses points in date order with titles resolved", () => {
    const s = parseMdlSeries(2738, item, "https://www.jpml.uscourts.gov/sites/jpml/files/a.pdf");
    expect(s?.points.map((p) => p.date)).toEqual(["2026-09-01", "2026-10-01"]);
    expect(s?.points[0]?.title).toMatch(/^IN RE: Johnson/);
    expect(s?.quarterEnd[0]?.circuit).toBe("Third");
    expect(s?.added).toEqual({ added: 89, intervals: 1, decreases: 0, decreaseSum: 0 });
    expect(s?.monthsSinceTransfer).toBe(119);
    expect(s?.sourceUrl).toBe("https://www.jpml.uscourts.gov/sites/jpml/files/a.pdf");
  });
  it("refuses a row for another MDL number (exact number only)", () => {
    expect(parseMdlSeries(2739, item, null)).toBeNull();
  });
  it("keeps a missing transfer date as Not recorded", () => {
    const s = parseMdlSeries(
      2738,
      {
        series: {
          ...item.series,
          date_transferred: null,
          months_since_transfer_at_latest_point: null,
        },
      },
      null,
    );
    expect(s?.dateTransferred).toBeNull();
    expect(s?.monthsSinceTransfer).toBeNull();
  });
});

describe("chart helpers", () => {
  it("lists every month including gaps", () => {
    expect(monthKeys("2012-11-15", "2013-02-01")).toEqual([
      "2012-11",
      "2012-12",
      "2013-01",
      "2013-02",
    ]);
  });
  it("keys one datum per report month and leaves gap months absent", () => {
    const s = monthlySeries(
      "p",
      "Pending",
      [
        { date: "2014-04-15", v: 1 },
        { date: "2014-07-15", v: 2 },
      ],
      (x) => x.v,
    );
    expect(s.points).toEqual([
      { key: "2014-04", value: 1 },
      { key: "2014-07", value: 2 },
    ]);
  });
  it("ticks January on a regular step over a long axis", () => {
    const keys = monthKeys("2012-07-10", "2026-10-01");
    const axis = monthlyAxis(keys);
    const ticks = keys.filter((k, i) => axis.showTick?.(k, i));
    expect(ticks.every((k) => k.endsWith("-01"))).toBe(true);
    expect(ticks.length).toBeLessThanOrEqual(8);
    expect(axis.label("2026-10")).toBe("October 2026");
    const small = monthlyAxis(keys, 4);
    expect(keys.filter((k, i) => small.showTick?.(k, i))).toEqual([
      "2016-01",
      "2020-01",
      "2024-01",
    ]);
  });
  it("formats without inventing values", () => {
    expect(fmtInt(null)).toBe("Not recorded");
    expect(fmtInt(204977)).toBe("204,977");
    expect(fmtPct(41.4)).toBe("41.4%");
    expect(fmtSigned(-12)).toBe("−12");
    expect(fmtSigned(0)).toBe("0");
    expect(longDate("2026-10-01")).toBe("October 1, 2026");
    expect(
      longGaps(
        [
          { after: "a", before: "b", monthsMissing: 20 },
          { after: "c", before: "d", monthsMissing: 1 },
        ],
        5,
      ),
    ).toHaveLength(1);
  });
});
