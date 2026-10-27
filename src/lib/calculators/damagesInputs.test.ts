import { describe, expect, it } from "vitest";
import {
  compoundGrowth,
  cpiChange,
  daysToEnd,
  metroStates,
  parseAwi,
  parseCpiArea,
  parseOccupationCodes,
  parseOewsArea,
  parseOewsCell,
  rateStatus,
  rebase,
  socLabel,
} from "./damagesInputs";

describe("OEWS", () => {
  it("reads a stored wage cell (construction laborers, New Jersey, May 2025)", () => {
    const w = parseOewsCell(["23590", "33.84", "70400", "30.80", "37980", "46710", "64060", "94510", "106140", ""])!;
    expect(w).toMatchObject({ employment: 23590, median: 64060, p10: 37980, p90: 106140, hourlyMedian: 30.8 });
    expect(w.flags).toEqual([]);
  });
  it("keeps BLS special codes as Not recorded, never 0", () => {
    const w = parseOewsCell(["1200", "-", "-", "-", "-", "50000", "#", "#", "#", "4"])!;
    expect(w.median).toBeNull();
    expect(w.p90).toBeNull();
    expect(w.p25).toBe(50000);
    expect(w.flags.sort()).toEqual(["#", "-"]);
    expect(w.footnotes).toEqual(["4"]);
    expect(parseOewsCell(null)).toBeNull();
  });
  it("reads occupation codes and areas", () => {
    const codes = parseOccupationCodes({ "472061": ["Construction Laborers", "3"], bad: ["x", "1"] });
    expect(codes).toEqual([{ soc: "472061", title: "Construction Laborers", level: 3 }]);
    expect(socLabel("472061")).toBe("47-2061");
    expect(parseOewsArea({ id: "oews:S3400000", a: "New Jersey", t: "S", u: "NJ" })).toEqual({
      id: "oews:S3400000",
      area: "New Jersey",
      type: "S",
      usps: "NJ",
    });
    expect(parseOewsArea({ id: "oews:occupations", a: "x", t: "S" })).toBeNull();
    expect(metroStates("New York-Newark-Jersey City, NY-NJ")).toEqual(["NY", "NJ"]);
    expect(metroStates("National")).toEqual([]);
  });
});

describe("SSA AWI", () => {
  const pts = [
    parseAwi({ awi: { year: 2023, value: "66,621.80", citation: "89 FR 85276" }, source_url: "https://www.govinfo.gov/a" })!,
    parseAwi({ awi: { year: 2024, value: "69,846.57", citation: "90 FR 49047", publication_date: "2025-11-03" } })!,
  ];
  it("reads the stated amount and its Federal Register citation", () => {
    expect(pts[1]).toMatchObject({ year: 2024, value: 69846.57, citation: "90 FR 49047", publicationDate: "2025-11-03" });
    expect(pts[0]!.sourceUrl).toBe("https://www.govinfo.gov/a");
  });
  it("computes compound growth only between recorded years", () => {
    expect(compoundGrowth(pts, 2023, 2024)).toBeCloseTo((69846.57 / 66621.8 - 1) * 100);
    expect(compoundGrowth(pts, 2010, 2024)).toBeNull();
  });
});

describe("CPI by area", () => {
  const raw = {
    cpi: {
      series_id: "CUURS12ASA0",
      area: "New York-Newark-Jersey City, NY-NJ-PA",
      base_period: "1982-84=100",
      obs: [
        ["2024", "M12", "300", ""],
        ["2024", "M13", "320.0", ""],
        ["2025", "M13", "329.6", ""],
        ["2023", "M13", "310.0", ""],
      ],
    },
    source_url: "https://data.bls.gov/timeseries/CUURS12ASA0",
  };
  it("keeps annual averages (M13) of not seasonally adjusted all-items series only", () => {
    const a = parseCpiArea(raw)!;
    expect(a.annual.map((p) => p.year)).toEqual([2023, 2024, 2025]);
    expect(parseCpiArea({ cpi: { ...raw.cpi, series_id: "CUSR0000SA0" } })).toBeNull();
    expect(cpiChange(a, 2024, 2025)).toBeCloseTo(3);
    expect(cpiChange(a, 2000, 2025)).toBeNull();
    expect(rebase(a, 2024).map((p) => Math.round(p.value * 10) / 10)).toEqual([100, 103]);
  });
});

describe("state rate periods", () => {
  const tx = { effectiveFrom: "2026-10-01", effectiveTo: "2026-10-31" };
  it("reads a rate whose period has ended as ended (shown Not recorded)", () => {
    expect(rateStatus(tx, "2026-10-27")).toBe("in_force");
    expect(rateStatus(tx, "2026-10-31")).toBe("in_force");
    expect(rateStatus(tx, "2026-11-01")).toBe("ended");
    expect(rateStatus(tx, "2026-09-30")).toBe("not_started");
    expect(rateStatus({ effectiveFrom: null, effectiveTo: null }, "2026-11-01")).toBe("undated");
  });
  it("counts days to the end of the period", () => {
    expect(daysToEnd(tx, "2026-10-27")).toBe(4);
    expect(daysToEnd(tx, "2026-11-01")).toBeNull();
  });
});
