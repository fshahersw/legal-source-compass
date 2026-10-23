import { describe, expect, it } from "vitest";
import { buildDocketEntriesMonthly, captureState } from "./entries";

const base = {
  mdl: 2804,
  publishedMonth: "2026-10",
  sourceUrl: "/records/sw_matters_v1/sw-matter:2804",
} as const;

describe("captureState", () => {
  it("is complete only when the provider total is known and met", () => {
    expect(captureState({ captured: 10, providerTotal: 10 })).toBe("complete");
    expect(captureState({ captured: 40, providerTotal: 5836 })).toBe("partial");
    expect(captureState({ captured: 40, providerTotal: null })).toBe("unknown");
  });
});

describe("buildDocketEntriesMonthly", () => {
  const dates = ["2017-12-05", "2017-12-20", "2018-03-02", null, "not a date", "2026-10-02"];

  it("counts entries by month, and draws a month with none as zero when the capture is complete", () => {
    const b = buildDocketEntriesMonthly({
      ...base,
      dates,
      coverage: { captured: 6, providerTotal: 6 },
    });
    const pts = b!.series[0]!.points;
    expect(pts[0]).toMatchObject({ x: "2017-12", value: 2 });
    expect(pts.find((p) => p.x === "2018-01")!.value).toBe(0);
    expect(pts.find((p) => p.x === "2018-03")!.value).toBe(1);
    expect(pts.at(-1)).toMatchObject({ x: "2026-10", value: 1, partial: true });
    expect(b!.xKind).toBe("month");
    expect(b!.gaps).toBe(0);
    expect(b!.notes.join(" ")).toContain("holds all 6 entries");
    expect(b!.notes.join(" ")).toContain("2 captured entries have no filing date");
  });

  it("leaves a month with no captured entry as a gap when the capture is partial or unknown", () => {
    const partial = buildDocketEntriesMonthly({
      ...base,
      dates,
      coverage: { captured: 4, providerTotal: 5836 },
    });
    expect(partial!.series[0]!.points.find((p) => p.x === "2018-01")!.value).toBeNull();
    expect(partial!.notes.join(" ")).toContain("lower bound");
    expect(partial!.notes.join(" ")).toContain("4 of the 5,836 entries");
    const unknown = buildDocketEntriesMonthly({
      ...base,
      dates,
      coverage: { captured: 4, providerTotal: null },
    });
    expect(unknown!.series[0]!.points.find((p) => p.x === "2018-01")!.value).toBeNull();
    expect(unknown!.notes.join(" ")).toContain("provider's total is not recorded");
  });

  it("keeps the partial last month out of the latest value", () => {
    const b = buildDocketEntriesMonthly({
      ...base,
      dates: ["2026-08-01", "2026-09-01", "2026-09-02", "2026-10-02"],
      coverage: { captured: 4, providerTotal: 4 },
    });
    expect(b!.latest).toMatchObject({ period: "2026-09", value: 2 });
    expect(b!.latest!.change).toMatchObject({ comparedWith: "2026-08", absolute: 1 });
    expect(b!.xKind).toBe("year");
  });

  it("returns null when no entry has a usable date", () => {
    expect(
      buildDocketEntriesMonthly({
        ...base,
        dates: [null, "x"],
        coverage: { captured: 2, providerTotal: 2 },
      }),
    ).toBeNull();
    expect(
      buildDocketEntriesMonthly({
        ...base,
        dates: [],
        coverage: { captured: 0, providerTotal: 0 },
      }),
    ).toBeNull();
  });
});
