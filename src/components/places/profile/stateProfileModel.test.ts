import { describe, expect, it } from "vitest";
import {
  currentCounties,
  districtOutreach,
  exposureScreen,
  parseCbp,
  parseLatest,
  type CountyAcs,
} from "./stateProfileModel";

describe("parseLatest", () => {
  it("reads the published shares with MOE and derives no-broadband from the broadband share", () => {
    // New Jersey, census_acs_states latest (2020-2024)
    const nj = parseLatest({
      pop: [9343809, null, 2024, "c"],
      age_65plus: [17.185, 0.089, 2024],
      disability: [10.806, 0.089, 2024],
      broadband: [92.805, 0.162, 2024],
    });
    expect(nj.year).toBe(2024);
    expect(nj.pop).toBe(9343809);
    expect(nj.shares.age_65plus).toEqual({ v: 17.185, moe: 0.089 });
    expect(nj.shares.no_broadband?.v).toBeCloseTo(7.195);
    expect(nj.shares.veterans).toBeUndefined(); // not recorded, never 0
  });
});

const county = (fips: string, year: number, pop: number, age: number, vet?: number): CountyAcs => ({
  fips,
  name: fips,
  year,
  pop,
  shares: {
    age_65plus: { v: age, moe: 0.1 },
    ...(vet != null ? { veterans: { v: vet, moe: 0.1 } } : {}),
  },
});

describe("district outreach", () => {
  it("drops retired geographies (Connecticut's former counties end in 2021)", () => {
    const rows = [county("09001", 2021, 956446, 18), county("09110", 2024, 977290, 17)];
    expect(currentCounties(rows).map((c) => c.fips)).toEqual(["09110"]);
  });
  it("weights shares by population, exact only for total-population universes", () => {
    const rows = [county("34023", 2024, 800000, 16, 3), county("34025", 2024, 200000, 21)];
    const d = districtOutreach(
      rows,
      new Map([
        ["34023", "njd"],
        ["34025", "njd"],
      ]),
    );
    expect(d).toHaveLength(1);
    expect(d[0]!.shares.age_65plus).toEqual({ v: 17, exact: true, covered: 2 });
    expect(d[0]!.shares.veterans).toEqual({ v: 3, exact: false, covered: 1 });
    expect(districtOutreach(rows, new Map())).toEqual([]);
  });
});

describe("exposure screen", () => {
  // Autauga AL (01001), CBP 2023: 12,749 employees, 1,484 in manufacturing
  const a = parseCbp(
    "01001",
    "Autauga County",
    { "00": { "2023": [968, 12749, 527009] }, "31-33": { "2023": [28, 1484, 121140] } },
    "2023",
  );
  const b = parseCbp(
    "01003",
    "Baldwin County",
    { "00": { "2023": [6000, 80000, 1] }, "31-33": { "2023": [1, 4000, 1] } },
    "2023",
  );
  const c = parseCbp("01005", "Barbour County", { "00": { "2023": [300, 5000, 1] } }, "2023"); // suppressed sector
  const d = parseCbp(
    "01007",
    "Bibb County",
    { "00": { "2023": [200, 2000, 1] }, "31-33": { "2023": [1, 600, 1] } },
    "2023",
  );
  it("joins sector share and OSHA rate on exact FIPS and leaves out suppressed cells", () => {
    const osha = new Map([
      ["01001", { rate: 40, base: 20 }],
      ["01003", { rate: 10, base: 50 }],
      ["01005", { rate: 99, base: 5 }],
      ["01007", { rate: 60, base: 6 }],
    ]);
    const out = exposureScreen([a, b, c, d], osha, "31-33");
    expect(out.leftOut).toBe(1);
    expect(out.points.find((p) => p.fips === "01001")?.share).toBeCloseTo((1484 / 12749) * 100);
    expect(out.medianOsha).toBe(40);
    expect(out.above.map((p) => p.fips)).toEqual(["01007"]); // 30% share and 60 per 100k, both above the medians
  });
});
