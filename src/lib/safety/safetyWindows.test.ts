import { describe, expect, it } from "vitest";
import {
  nhtsaCampaigns,
  pctChange,
  radarRows,
  recallQuarterRows,
  shortMaker,
  silicaYears,
  type ComplaintWindows,
  type RecallComplaints,
} from "./safetyWindows";

describe("nhtsaCampaigns", () => {
  it("keeps exact NHTSA campaign numbers only, once each", () => {
    expect(
      nhtsaCampaigns(["25V437000", "Z-0119-2027", " 25V437000", "25V43700", "24E001000"]),
    ).toEqual(["25V437000", "24E001000"]);
  });
});

const pair = (manufacturer: string, component: string, current: number, prior: number) => ({
  manufacturer,
  component,
  current,
  prior,
  injured: 0,
  deaths: 0,
  crashes: 0,
  fires: 0,
});

describe("pctChange", () => {
  it("is null without a prior base", () => {
    expect(pctChange(10, 0)).toBeNull();
    expect(pctChange(223, 37)).toBe(502.7);
  });
});

describe("radarRows", () => {
  it("keeps pairs with enough complaints, ranked by change, prior-less pairs last", () => {
    const w: ComplaintWindows = {
      as_of: "2026-10-21",
      coverage_from: "2020-01-01",
      coverage_to: "2026-10-21",
      totals: null,
      manufacturers: [],
      pairs: [
        pair("Mazda Motor Corp.", "STEERING", 223, 37),
        pair("Ford Motor Company", "BACK OVER PREVENTION", 1397, 684),
        pair("New Maker LLC", "SEATS", 150, 0),
        pair("Tiny Co", "SEATS", 20, 1),
      ],
    };
    const rows = radarRows(w, 100);
    expect(rows.map((r) => r.manufacturer)).toEqual([
      "Mazda Motor Corp.",
      "Ford Motor Company",
      "New Maker LLC",
    ]);
    expect(rows[0]!.label).toBe("Mazda Motor · Steering");
    expect(rows[2]!.change).toBeNull();
    expect(radarRows(null)).toEqual([]);
  });
});

describe("shortMaker", () => {
  it("drops corporate suffixes for labels only", () => {
    expect(shortMaker("Nissan North America, Inc.")).toBe("Nissan");
    expect(shortMaker("Honda (American Honda Motor Co.)")).toBe("Honda");
  });
});

describe("recallQuarterRows", () => {
  it("fills every quarter of the coverage with 0 and marks the recall quarter and the unfinished last quarter", () => {
    const r: RecallComplaints = {
      campaign: "25V437000",
      recall_date: "2025-06-27",
      vehicles: [],
      unparsed: [],
      components: ["ENGINE AND ENGINE COOLING"],
      coverage_from: "2025-01-01",
      coverage_to: "2025-10-21",
      quarters: [
        {
          quarter: "2025-Q3",
          complaints: 88,
          vehicle_complaints: 120,
          injured: 0,
          crashes: 0,
          fires: 0,
          deaths: 0,
        },
      ],
      before: null,
      after: null,
    };
    const rows = recallQuarterRows(r);
    expect(rows.map((q) => q.quarter)).toEqual(["2025-Q1", "2025-Q2", "2025-Q3", "2025-Q4"]);
    expect(rows[1]!.recall).toBe(true);
    expect(rows[2]).toMatchObject({ complaints: 88, vehicle: 120 });
    expect(rows[3]!.partial).toBe(true);
    expect(rows[0]!.complaints).toBe(0);
  });
});

describe("silicaYears", () => {
  it("marks the first and last years partial when the data start and end mid-year", () => {
    const ys = silicaYears({
      from: "2017-09-22",
      to: "2026-09-17",
      years: [
        { year: 2017, fabricator_general: 0, other_general: 0, construction: 26, penalties: 1 },
        {
          year: 2024,
          fabricator_general: 508,
          other_general: 499,
          construction: 1118,
          penalties: 1,
        },
        {
          year: 2026,
          fabricator_general: 163,
          other_general: 180,
          construction: 709,
          penalties: 1,
        },
      ],
      last12: null,
      states: [],
      establishments: [],
    });
    expect(ys.map((y) => y.partial)).toEqual([true, false, true]);
  });
});
