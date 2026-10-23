import { describe, expect, it } from "vitest";
import { buildFirmLandscapeYears, buildFirmProfileYears } from "./firm";

describe("buildFirmLandscapeYears", () => {
  const mdls = [
    { year: 2017, plaintiff: 166, defense: 2348 },
    { year: 2022, plaintiff: 6280, defense: 1538 },
    { year: 2022, plaintiff: 100, defense: null },
    { year: null, plaintiff: 83, defense: 0 },
  ];
  const b = buildFirmLandscapeYears({ mdls });

  it("sums each side by the MDL's filing year and leaves a year with no MDL as a gap", () => {
    const pts = (id: string) =>
      b!.series.find((s) => s.id === id)!.points.map((p) => [p.x, p.value]);
    expect(pts("plaintiff")[0]).toEqual(["2017", 166]);
    expect(pts("plaintiff").find(([x]) => x === "2022")![1]).toBe(6380);
    expect(pts("plaintiff").find(([x]) => x === "2018")![1]).toBeNull();
    expect(pts("defense").find(([x]) => x === "2022")![1]).toBe(1538);
    expect(b!.stacked).toBe(true);
  });

  it("leads with the total over every plotted year, not the newest year and its change", () => {
    expect(b!.latest).toMatchObject({
      period: "2017–2022",
      value: 166 + 2348 + 6380 + 1538,
      seriesLabel: "All plotted master dockets",
    });
    expect(b!.latest!.change).toBeNull();
    expect(b!.gaps).toBe(4); // 2018 to 2021: no master docket in the registry was filed those years
  });

  it("leaves out an MDL with no filing year and says so", () => {
    expect(b!.notes.join(" ")).toContain(
      "3 master dockets with a recorded filing year are plotted",
    );
    expect(b!.notes.join(" ")).toContain("1 with no recorded filing year is left out");
  });

  it("states that the chart groups master dockets and is not firm activity over time", () => {
    expect(b!.notes.join(" ")).toContain("not how firm activity changed");
  });

  it("is null when no MDL has a year", () => {
    expect(
      buildFirmLandscapeYears({ mdls: [{ year: null, plaintiff: 1, defense: 1 }] }),
    ).toBeNull();
    expect(buildFirmLandscapeYears({ mdls: [] })).toBeNull();
  });
});

describe("buildFirmProfileYears", () => {
  it("groups a firm's appearances by MDL year and needs two distinct years", () => {
    const b = buildFirmProfileYears({
      id: "firm:frantz-law-group",
      rows: [
        { year: 2022, appearances: 1070 },
        { year: 2025, appearances: 45 },
        { year: 2025, appearances: 5 },
        { year: null, appearances: 9 },
      ],
    });
    expect(b!.series[0]!.points.map((p) => [p.x, p.value])).toEqual([
      ["2022", 1070],
      ["2023", null],
      ["2024", null],
      ["2025", 50],
    ]);
    expect(b!.notes.join(" ")).toContain("1 MDL has no recorded filing year");
    expect(b!.source.url).toBe("/records/firm_profiles/firm:frantz-law-group");
    expect(
      buildFirmProfileYears({
        id: "x",
        rows: [
          { year: 2022, appearances: 3 },
          { year: 2022, appearances: 4 },
        ],
      }),
    ).toBeNull();
  });
});
