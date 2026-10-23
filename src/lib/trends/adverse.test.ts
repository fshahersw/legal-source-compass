import { describe, expect, it } from "vitest";
import { buildMdlAdverseYears } from "./adverse";

const rows = [
  { year: 2012, reports: 18781, deaths: 40, partial: false, nationalReports: 600000 },
  { year: 2024, reports: 120, deaths: 0, partial: false, nationalReports: 2800000 },
  { year: 2025, reports: 153, deaths: 1, partial: false, nationalReports: 2888003 },
  { year: 2026, reports: 89, deaths: 0, partial: true, nationalReports: 2924614 },
];

describe("buildMdlAdverseYears", () => {
  const b = buildMdlAdverseYears({ mdl: 2197, system: "maude", rows, dataThrough: "2026-09-30" })!;

  it("draws reports and death-type reports by year received, with years between as gaps", () => {
    expect(b.series.map((s) => s.label)).toEqual(["Reports", "Reports with a death event type"]);
    const reports = b.series[0]!.points;
    expect(reports.find((p) => p.x === "2012")!.value).toBe(18781);
    expect(reports.find((p) => p.x === "2013")!.value).toBeNull();
    expect(reports.at(-1)).toMatchObject({ x: "2026", value: 89, partial: true });
    expect(b.latest).toMatchObject({ period: "2025", value: 153 });
    expect(b.latest!.change).toMatchObject({ comparedWith: "2024", absolute: 33 });
    expect(b.asOf).toBe("2026-09-30");
  });

  it("states the national total of the latest complete year as the baseline, and the reports-not-incidence caution", () => {
    const text = b.notes.join(" ");
    expect(text).toContain(
      "153 reports were 0.005% of the 2,888,003 MAUDE reports received that year",
    );
    expect(text).toContain("not that it caused it");
    expect(text).toContain("litigation");
    expect(text).toContain("through September 30, 2026");
  });

  it("uses the FAERS wording and source, and no partial note when every year is complete", () => {
    const f = buildMdlAdverseYears({
      mdl: 1871,
      system: "faers",
      rows: rows.map((r) => ({ ...r, partial: false })),
      dataThrough: "2026-06-30",
    })!;
    expect(f.series[1]!.label).toBe("Reports with a death outcome");
    expect(f.source.url).toBe("https://open.fda.gov/apis/drug/event/");
    expect(f.notes.join(" ")).not.toContain("holds reports only through");
  });

  it("returns null when no year has a report count", () => {
    expect(
      buildMdlAdverseYears({
        mdl: 1,
        system: "faers",
        rows: [{ year: 2020, reports: null, deaths: null, partial: false, nationalReports: null }],
        dataThrough: null,
      }),
    ).toBeNull();
  });
});
