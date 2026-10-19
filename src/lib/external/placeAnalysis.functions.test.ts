import { describe, expect, it } from "vitest";
import { citiesInCounty, mergeCountyRows, parseAcs, parseLegal } from "./countyAnalysis.functions";
import { parseCity } from "./placeProfiles.functions";
import { parseCrossState, parseStateAnalysis } from "./stateAnalysis.functions";
import { parseDistrict, parseMetrics, parseStandouts, parseTests } from "./placeAnalysisParse";

describe("county rows", () => {
  it("merges demographic and legal metrics by FIPS and drops malformed rows", () => {
    const rows = mergeCountyRows(
      [
        {
          id: "48201",
          n: "Harris County",
          m: { population: 5045026, poverty_rate: 16.25, bad: "x" },
          c: "txsd",
        },
        { id: "4820", n: "Short", m: {}, c: "txsd" },
        { id: "48001", n: "Anderson County", m: { population: 59805 }, c: "javascript:" },
      ],
      [
        { id: "48201", m: { fjc_core_rate: 58.4, "drop me": 1 }, f: null, note: null },
        { id: "48001", m: { fjc_core_rate: null }, f: ["Only 32% ..."], note: null },
      ],
    );
    expect(rows.map((r) => r.id)).toEqual(["48001", "48201"]);
    const harris = rows[1]!;
    expect(harris.metrics).toEqual({
      population: 5045026,
      poverty_rate: 16.25,
      bad: null,
      fjc_core_rate: 58.4,
    });
    expect(harris.courtId).toBe("txsd");
    expect(rows[0]!.courtId).toBeNull();
    expect(rows[0]!.screened).toEqual(["Only 32% ..."]);
    expect(rows[0]!.metrics["fjc_core_rate"]).toBeNull();
  });
  it("parses ACS values with margins and legal blocks defensively", () => {
    expect(parseAcs({ poverty_rate: { v: 16.25, moe: 0.36 }, x: "y", "Bad Key": {} })).toEqual({
      poverty_rate: { v: 16.25, moe: 0.36 },
      x: { v: null, moe: null },
    });
    const l = parseLegal({
      fjc_fy: { "2024": 10, x: 3 },
      fjc_by_court: { txsd: 5, "evil.com": 9 },
      fjc_flag: ["r"],
      echo_facilities: 4,
    });
    expect(l?.fjcFy).toEqual({ "2024": 10 });
    expect(l?.byCourt).toEqual({ txsd: 5 });
    expect(l?.screened).toEqual(["r"]);
    expect(l?.echo["echo_facilities"]).toBe(4);
    expect(parseLegal(null)).toBeNull();
  });
  it("lists cities with a population part in the county, largest first", () => {
    const out = citiesInCounty(
      [
        {
          id: "4835000",
          p: {
            name: "Houston city",
            funcstat: "A",
            counties: [
              { fips: "48201", share: 92.1 },
              { fips: "48157", share: 7.9 },
            ],
          },
          pop: 2300000,
        },
        {
          id: "4865036",
          p: { name: "Spring CDP", funcstat: "S", counties: [{ fips: "48201", share: 100 }] },
          pop: 60000,
        },
        { id: "4800000", p: { name: "Elsewhere", counties: [{ fips: "48113" }] }, pop: 9 },
        { id: "bad", p: { name: "Bad", counties: [{ fips: "48201" }] }, pop: 1 },
      ],
      "48201",
    );
    expect(out.map((c) => [c.name, c.share, c.incorporated])).toEqual([
      ["Houston city", 92.1, true],
      ["Spring CDP", 100, false],
    ]);
  });
});

describe("state and cross-state analysis", () => {
  const tests = [
    {
      x: "fjc_core_rate",
      y: "density",
      label: "Residents per square mile",
      rho: 0.5,
      n: 254,
      ci: [0.4, 0.6],
      p: 0.0001,
      p_bh: 0.001,
      holds: true,
      strength: "moderate",
    },
    { x: "osha_rate", y: "poverty_rate", label: "Poverty rate", rho: null, n: 4, holds: true },
    { x: "BAD KEY", y: "density" },
  ];
  it("parses tests: an untested pair never holds", () => {
    const t = parseTests(tests);
    expect(t).toHaveLength(2);
    expect(t[0]).toMatchObject({ rho: 0.5, pBh: 0.001, holds: true, ci: [0.4, 0.6] });
    expect(t[1]).toMatchObject({ rho: null, holds: false });
  });
  it("keeps only known link targets in stand-out items", () => {
    const s = parseStandouts([
      { kind: "high", text: "Harris County: ...", county: "48201", metric: "fjc_core_rate" },
      { kind: "district", text: "S.D. Tex.", court_id: "txsd" },
      { kind: "x", text: "", county: "48201" },
      { kind: "y", text: "bad links", county: "../../etc", court_id: "https://evil" },
    ]);
    expect(s).toHaveLength(3);
    expect(s[0]!.county).toBe("48201");
    expect(s[1]!.courtId).toBe("txsd");
    expect(s[2]).toMatchObject({ county: null, courtId: null });
  });
  it("assembles a state with its districts", () => {
    const district = {
      court_id: "txsd",
      name: "Southern District of Texas",
      usps: "TX",
      population: 10,
      filed_by_residence: { own_counties: 8, out_of_state: 2 },
      counties: [
        { fips: "48201", name: "Harris County" },
        { fips: "bad", name: "x" },
      ],
      divisions: [{ name: "Houston Division", held_at: ["Houston"], counties: ["48201", "zz"] }],
      basis: ["https://www.govinfo.gov/x", "javascript:alert(1)"],
    };
    const st = parseStateAnalysis(
      [
        { id: "district:txsd", p: district },
        { id: "district:okwd", p: { ...district, court_id: "okwd", usps: "OK" } },
        {
          id: "state:TX",
          p: {
            name: "Texas",
            counties: 254,
            tests,
            standouts: [],
            fjc_core_fy: { "2025": 100 },
            values: { fjc_core_rate: 30 },
          },
        },
      ],
      "TX",
    );
    expect(st?.name).toBe("Texas");
    expect(st?.districts.map((d) => d.courtId)).toEqual(["txsd"]);
    expect(st?.districts[0]!.counties).toEqual([{ fips: "48201", name: "Harris County" }]);
    expect(st?.districts[0]!.divisions[0]!.counties).toEqual(["48201"]);
    expect(st?.districts[0]!.basis).toEqual(["https://www.govinfo.gov/x"]);
    expect(st?.fjcCoreFy).toEqual({ "2025": 100 });
    expect(parseStateAnalysis([], "TX")).toBeNull();
  });
  it("parses the cross-state overview", () => {
    const x = parseCrossState(
      {
        tests,
        tests_run: 1,
        tests_hold: 1,
        states: { TX: { fjc_core_rate: 30 }, tx: { a: 1 } },
        us: { fjc_core_rate: 40 },
      },
      [
        {
          st: "TX",
          d: { fjc_core_rate: { n: 3, min: 1, p25: 2, median: 3, p75: 4, max: 5 } },
          h: 2,
          r: 84,
          c: 254,
        },
        { st: "", d: {}, h: 0, r: 0, c: 0 },
      ],
    );
    expect(Object.keys(x!.states)).toEqual(["TX"]);
    expect(x!.dispersion["TX"]!.distributions["fjc_core_rate"]!.median).toBe(3);
    expect(Object.keys(x!.dispersion)).toEqual(["TX"]);
    expect(parseCrossState(null, [])).toBeNull();
  });
  it("parses districts and metrics defensively", () => {
    expect(parseDistrict({ court_id: "TXSD", usps: "TX" })).toBeNull();
    expect(parseMetrics({ a: 1, b: "2", c: Number.POSITIVE_INFINITY })).toEqual({
      a: 1,
      b: null,
      c: null,
    });
  });
});

describe("cities", () => {
  it("parses a place and its county shares", () => {
    const c = parseCity({
      id: "4835000",
      p: {
        name: "Houston city",
        funcstat: "A",
        counties: [{ fips: "48201", name: "Harris County", share: 92.1 }],
      },
      m: { pop_acs: 2300000 },
    });
    expect(c).toMatchObject({
      name: "Houston city",
      incorporated: true,
      counties: [{ fips: "48201", share: 92.1 }],
    });
    expect(parseCity({ id: "x", p: {}, m: {} })).toBeNull();
    expect(parseCity({ id: "4800001", p: { name: "" }, m: {} })).toBeNull();
  });
});
