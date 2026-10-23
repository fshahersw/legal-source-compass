import { describe, expect, it } from "vitest";
import {
  buildMdlFjcYears,
  buildMdlFyPending,
  buildMdlMonthlyPending,
  buildMdlRegistryYears,
  fiscalYearOf,
  monthAxis,
  sharePct,
} from "./mdl";

const values = (b: ReturnType<typeof buildMdlMonthlyPending>, i = 0) =>
  b!.series[i]!.points.map((p) => [p.x, p.value] as const);

describe("buildMdlMonthlyPending", () => {
  const reports = [
    { month: "2024-10", pending: 9896, total: 10185 },
    { month: "2024-11", pending: 10000, total: 10300 },
    // 2024-12 and 2025-01 have no report
    { month: "2025-02", pending: 10400, total: 10800 },
    { month: "2026-10", pending: 15264, total: 19840 },
  ];
  const block = buildMdlMonthlyPending({ mdl: 2873, reports, lastReportDate: "2026-10-01" });

  it("lists every calendar month in the range and leaves a month without a report as a gap, not zero", () => {
    const pending = values(block);
    expect(pending).toHaveLength(25);
    expect(pending.find(([x]) => x === "2024-12")![1]).toBeNull();
    expect(pending.find(([x]) => x === "2025-01")![1]).toBeNull();
    expect(pending.find(([x]) => x === "2025-02")![1]).toBe(10400);
    expect(block!.gaps).toBe((25 - 4) * 2); // 21 unreported months in each of the two series
  });

  it("uses a twelve-month comparison and the year-keyed month axis on a short span", () => {
    expect(block!.xKind).toBe("year");
    expect(block!.latest).toMatchObject({ value: 15264, period: "2026-10" });
    expect(block!.latest!.change).toBeNull(); // 2025-10 is a gap, so no change is invented
    expect(block!.latest!.changeNote).toMatch(/not recorded/i);
    expect(block!.asOf).toBe("2026-10-01");
    expect(block!.source.url).toBe("https://www.jpml.uscourts.gov/pending-mdl-reports-archive");
  });

  it("computes the change against the same month a year earlier when it is recorded", () => {
    const full = Array.from({ length: 25 }, (_, i) => {
      const y = 2024 + Math.floor((9 + i) / 12);
      const m = ((9 + i) % 12) + 1;
      return { month: `${y}-${String(m).padStart(2, "0")}`, pending: 100 + i, total: 200 + i };
    });
    const b = buildMdlMonthlyPending({ mdl: 1, reports: full, lastReportDate: null });
    expect(b!.latest!.change).toMatchObject({ comparedWith: "2025-10", absolute: 12 });
  });

  it("keeps the first report of a month, drops malformed months and returns null for no data", () => {
    const b = buildMdlMonthlyPending({
      mdl: 1,
      reports: [
        { month: "2025-01", pending: 5, total: 9 },
        { month: "2025-01", pending: 6, total: 9 },
        { month: "2025-13", pending: 7, total: 9 },
        { month: "garbage", pending: 8, total: 9 },
      ],
      lastReportDate: null,
    });
    expect(values(b)).toEqual([["2025-01", 5]]);
    expect(buildMdlMonthlyPending({ mdl: 1, reports: [], lastReportDate: null })).toBeNull();
    expect(
      buildMdlMonthlyPending({
        mdl: 1,
        reports: [{ month: "2025-01", pending: null, total: 4 }],
        lastReportDate: null,
      }),
    ).toBeNull();
  });

  it("leaves out the cumulative total when it would flatten the pending line", () => {
    const b = buildMdlMonthlyPending({
      mdl: 2197,
      reports: [
        { month: "2025-09", pending: 120, total: 10400 },
        { month: "2025-10", pending: 114, total: 10455 },
      ],
      lastReportDate: null,
    });
    expect(b!.series.map((s) => s.id)).toEqual(["pending"]);
    expect(b!.notes.join(" ")).toContain("it is not drawn");
    expect(
      buildMdlMonthlyPending({
        mdl: 1,
        reports: [
          { month: "2025-09", pending: 120, total: 300 },
          { month: "2025-10", pending: 114, total: 310 },
        ],
        lastReportDate: null,
      })!.series.map((s) => s.id),
    ).toEqual(["pending", "total"]);
  });

  it("switches to the plain month axis past three years", () => {
    expect(monthAxis("2020-01", "2023-01")).toBe("year");
    expect(monthAxis("2020-01", "2023-02")).toBe("month");
  });
});

describe("buildMdlFyPending", () => {
  it("leaves a fiscal year whose edition was excluded as a gap and says why", () => {
    const b = buildMdlFyPending({
      mdl: 2873,
      rows: [
        { fy: 2021, pending: 1681 },
        { fy: 2022, pending: 3037 },
        { fy: 2024, pending: 9896 },
        { fy: 2025, pending: 13942 },
      ],
      leftCensored: false,
    });
    expect(b!.series[0]!.points.map((p) => p.value)).toEqual([1681, 3037, null, 9896, 13942]);
    expect(b!.gaps).toBe(1);
    expect(b!.latest).toMatchObject({ period: "FY2025", value: 13942 });
    // FY2024 is not recorded as a neighbour of FY2023, but FY2025 compares with FY2024
    expect(b!.latest!.change).toMatchObject({ comparedWith: "FY2024", absolute: 4046 });
    expect(b!.asOf).toBe("2025-09-30");
    expect(b!.notes.join(" ")).toContain("FY2023 is left blank");
  });

  it("names several blank years and notes a left-censored start", () => {
    const b = buildMdlFyPending({
      mdl: 2738,
      rows: [
        { fy: 2017, pending: 891 },
        { fy: 2018, pending: 9324 },
        { fy: 2021, pending: 36099 },
        { fy: 2022, pending: 37515 },
        { fy: 2024, pending: 58052 },
        { fy: 2025, pending: 67204 },
      ],
      leftCensored: true,
    });
    expect(b!.notes.join(" ")).toContain("FY2019, FY2020, FY2023 are left blank");
    expect(b!.notes.join(" ")).toContain("earliest edition held");
  });

  it("returns null when no year has a value", () => {
    expect(
      buildMdlFyPending({ mdl: 1, rows: [{ fy: 2020, pending: null }], leftCensored: false }),
    ).toBeNull();
    expect(buildMdlFyPending({ mdl: 1, rows: [], leftCensored: false })).toBeNull();
  });
});

describe("sharePct", () => {
  it("keeps enough decimals for a small share and never prints 0.0%", () => {
    expect(sharePct(33.333)).toBe("33.3%");
    expect(sharePct(0.456)).toBe("0.46%");
    expect(sharePct(0.004)).toBe("less than 0.01%");
  });
});

describe("fiscalYearOf", () => {
  it("rolls October to December into the next fiscal year", () => {
    expect(fiscalYearOf("2025-09-30")).toBe(2025);
    expect(fiscalYearOf("2025-10-01")).toBe(2026);
    expect(fiscalYearOf("2026-06-30")).toBe(2026);
    expect(fiscalYearOf("nope")).toBeNull();
  });
});

describe("buildMdlFjcYears", () => {
  const rows = [
    { fy: 2019, cases: 4 },
    { fy: 2021, cases: 9 },
    { fy: 2026, cases: 3 },
  ];
  const b = buildMdlFjcYears({ mdl: 2885, rows, through: "2026-06-30" });

  it("draws a year with no case in the complete file as a counted zero", () => {
    expect(b!.series[0]!.points.map((p) => [p.x, p.value])).toEqual([
      ["2019", 4],
      ["2020", 0],
      ["2021", 9],
      ["2022", 0],
      ["2023", 0],
      ["2024", 0],
      ["2025", 0],
      ["2026", 3],
    ]);
    expect(b!.gaps).toBe(0);
  });

  it("marks the fiscal year the file stops in as partial and keeps it out of the latest value", () => {
    expect(b!.series[0]!.points.at(-1)!.partial).toBe(true);
    expect(b!.latest).toMatchObject({ period: "FY2025", value: 0 });
    expect(b!.notes.join(" ")).toContain("FY2026* holds filings only through June 30, 2026");
    expect(b!.asOf).toBe("2026-06-30");
  });

  it("states the MDL's share of all civil filings for its peak and its latest complete year", () => {
    const national = new Map([
      [2019, 300000],
      [2021, 200000],
      [2025, 300000],
    ]);
    const withBase = buildMdlFjcYears({
      mdl: 2885,
      rows: [
        { fy: 2019, cases: 60000 },
        { fy: 2021, cases: 10 },
        { fy: 2025, cases: 3 },
      ],
      through: "2026-06-30",
      national,
    })!;
    const text = withBase.notes.join(" ");
    expect(text).toContain(
      "In FY2019 these 60,000 cases were 20.0% of the 300,000 civil cases filed",
    );
    expect(text).toContain("In FY2025 these 3 cases were less than 0.01% of the 300,000");
    expect(text).not.toContain("In FY2021");
  });

  it("does not mark a year partial when the file runs through its last day", () => {
    const done = buildMdlFjcYears({ mdl: 1, rows, through: "2026-09-30" });
    expect(done!.series[0]!.points.at(-1)!.partial).toBeUndefined();
  });

  it("ignores duplicate years and negative counts, and returns null for no rows", () => {
    const d = buildMdlFjcYears({
      mdl: 1,
      rows: [
        { fy: 2020, cases: 5 },
        { fy: 2020, cases: 99 },
        { fy: 2021, cases: -1 },
      ],
      through: null,
    });
    expect(d!.series[0]!.points.map((p) => p.value)).toEqual([5]);
    expect(buildMdlFjcYears({ mdl: 1, rows: [], through: null })).toBeNull();
  });
});

describe("buildMdlRegistryYears", () => {
  const base = {
    id: "mdl-members-years",
    mdl: 2873,
    unit: "actions",
    seriesLabel: "Member actions",
    publishedYear: 2026,
    publishedOn: "2026-10-19",
    sourcePath: "/records/mdl_hierarchy/mdl:2873",
    total: 1616,
    totalLabel: "member actions",
  } as const;

  it("leaves a year without a registry docket as a gap and marks the publication year partial", () => {
    const b = buildMdlRegistryYears({
      ...base,
      rows: [
        { year: 2018, n: 84 },
        { year: 2020, n: 802 },
        { year: 2026, n: 1 },
      ],
    });
    const pts = b!.series[0]!.points;
    expect(pts.map((p) => p.value)).toEqual([84, null, 802, null, null, null, null, null, 1]);
    expect(pts.at(-1)!.partial).toBe(true);
    expect(b!.latest).toMatchObject({ period: "2020", value: 802 });
    expect(b!.notes.join(" ")).toContain("2026* is the year the registry was last published");
    expect(b!.source.url).toBe("/records/mdl_hierarchy/mdl:2873");
    // 84 + 802 + 1 of 1,616 member actions have a filing year; the rest are said to be unplotted
    expect(b!.notes.join(" ")).toContain("887 of 1,616 member actions have a filing year");
    expect(b!.notes.join(" ")).toContain("the other 729 are not plotted");
  });

  it("says nothing about unplotted dockets when every one has a filing year or the total is unknown", () => {
    const rows = [{ year: 2024, n: 5 }];
    expect(buildMdlRegistryYears({ ...base, rows, total: 5 })!.notes.join(" ")).not.toContain(
      "not plotted",
    );
    expect(buildMdlRegistryYears({ ...base, rows, total: null })!.notes.join(" ")).not.toContain(
      "not plotted",
    );
  });

  it("marks nothing partial when the data ends before the publication year", () => {
    const b = buildMdlRegistryYears({ ...base, rows: [{ year: 2024, n: 5 }] });
    expect(b!.series[0]!.points[0]!.partial).toBeUndefined();
    expect(buildMdlRegistryYears({ ...base, rows: [] })).toBeNull();
  });
});
