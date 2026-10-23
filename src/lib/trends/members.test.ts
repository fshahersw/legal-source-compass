import { describe, expect, it } from "vitest";
import { buildMemberMonths } from "./members";

const base = {
  mdl: 2804,
  publishedMonth: "2026-10",
  sourceUrl: "/records/sw_matters_v1/sw-matter:2804",
} as const;

describe("buildMemberMonths", () => {
  const dates = ["2017-12-05", "2017-12-20", "2018-03-02", null, "bad", "2026-10-01"];
  const b = buildMemberMonths({ ...base, dates })!;

  it("counts member actions by month filed and leaves a month with none as a gap, not zero", () => {
    const pts = b.series[0]!.points;
    expect(pts[0]).toMatchObject({ x: "2017-12", value: 2 });
    expect(pts.find((p) => p.x === "2018-01")!.value).toBeNull();
    expect(pts.find((p) => p.x === "2018-03")!.value).toBe(1);
    expect(b.xKind).toBe("month");
    expect(b.unit).toBe("actions");
  });

  it("marks the month the registry was published in as partial and says so", () => {
    expect(b.series[0]!.points.at(-1)).toMatchObject({ x: "2026-10", value: 1, partial: true });
    expect(b.notes.join(" ")).toContain(
      "October 2026* is the month the registry was last published",
    );
  });

  it("says the registry is a partial count and names the undated dockets", () => {
    const text = b.notes.join(" ");
    expect(text).toContain("not the size of the MDL");
    expect(text).toContain("2 member actions have no filing date and are not plotted");
  });

  it("returns null when no docket has a usable date", () => {
    expect(buildMemberMonths({ ...base, dates: [null, "x"] })).toBeNull();
    expect(buildMemberMonths({ ...base, dates: [] })).toBeNull();
  });
});
