import { describe, expect, it } from "vitest";
import { buildClYears, buildDisclosureItems, CL_SNAPSHOT } from "./judge";

const base = {
  id: "judge-dockets-years-604",
  unit: "dockets",
  seriesLabel: "Assigned dockets",
  totalLabel: "assigned dockets",
  counts: "Counts dockets CourtListener lists as assigned to this person.",
  personId: 604,
} as const;

describe("buildClYears", () => {
  const rows = [
    { yr: 2017, n: 100 },
    { yr: 2019, n: 2039 },
    { yr: 2025, n: 800 },
    { yr: 2026, n: 400 },
  ];

  it("leaves a year with no record as a gap and marks the snapshot year partial", () => {
    const b = buildClYears({ ...base, rows, total: 3339 });
    const pts = b!.series[0]!.points;
    expect(pts.map((p) => p.x)).toEqual([
      "2017",
      "2018",
      "2019",
      "2020",
      "2021",
      "2022",
      "2023",
      "2024",
      "2025",
      "2026",
    ]);
    expect(pts.find((p) => p.x === "2018")!.value).toBeNull();
    expect(pts.find((p) => p.x === "2019")!.value).toBe(2039);
    expect(pts.at(-1)).toMatchObject({ x: "2026", value: 400, partial: true });
    expect(b!.latest).toMatchObject({ period: "2025", value: 800 });
    expect(b!.asOf).toBe(CL_SNAPSHOT);
    expect(b!.notes.join(" ")).toContain("2026* holds records only through September 30, 2026");
  });

  it("says how many records carry no year, and nothing when all do", () => {
    const withGap = buildClYears({ ...base, rows, total: 3500 });
    expect(withGap!.notes.join(" ")).toContain("3,339 of 3,500 assigned dockets carry a year");
    expect(withGap!.notes.join(" ")).toContain("the other 161 are not plotted");
    const all = buildClYears({ ...base, rows, total: 3339 });
    expect(all!.notes.join(" ")).not.toContain("not plotted");
  });

  it("marks no year partial when the snapshot is the last day of the year, and returns null for no rows", () => {
    const b = buildClYears({ ...base, rows, total: null, snapshot: "2026-12-31" });
    expect(b!.series[0]!.points.some((p) => p.partial)).toBe(false);
    expect(buildClYears({ ...base, rows: [], total: null })).toBeNull();
  });

  it("links to the person's CourtListener page", () => {
    expect(buildClYears({ ...base, rows, total: null })!.source.url).toBe(
      "https://www.courtlistener.com/person/604/",
    );
  });
});

describe("buildDisclosureItems", () => {
  const year = (y: number, reports: number, inv: number, gifts = 0, reimb = 0, agr = 0) => ({
    year: y,
    reports,
    items: { investments: inv, gifts, reimbursements: reimb, agreements: agr },
  });

  it("draws a year with a report and no item as zero, and a year with no report as a gap", () => {
    const b = buildDisclosureItems({
      personId: 604,
      years: [
        year(2012, 1, 0),
        year(2014, 1, 6, 0, 1),
        year(2015, 0, 0),
        year(2016, 2, 6, 0, 3, 1),
      ],
    });
    const inv = b!.series.find((s) => s.id === "investments")!.points;
    expect(inv.map((p) => [p.x, p.value])).toEqual([
      ["2012", 0],
      ["2013", null],
      ["2014", 6],
      ["2015", null],
      ["2016", 6],
    ]);
    expect(b!.series.map((s) => s.label)).toEqual([
      "Investments",
      "Gifts",
      "Reimbursements",
      "Agreements",
    ]);
  });

  it("needs two report years to draw a trend", () => {
    expect(buildDisclosureItems({ personId: 1, years: [year(2012, 1, 3)] })).toBeNull();
    expect(
      buildDisclosureItems({ personId: 1, years: [year(2012, 0, 0), year(2013, 0, 0)] }),
    ).toBeNull();
  });
});
