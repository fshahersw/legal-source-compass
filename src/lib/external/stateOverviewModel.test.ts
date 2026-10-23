import { describe, expect, it } from "vitest";
import {
  filingsSeries,
  parseDistrict,
  parsePendingMdls,
  summarizeDistricts,
  type DistrictBench,
} from "./stateOverviewModel";

const series = (rows: [number, number, boolean?][]) =>
  rows.map(([fy, filings, partial]) => ({
    fy,
    filings,
    terminations: filings - 10,
    pending_end: filings * 2,
    median_days: 200,
    partial: partial ?? false,
  }));

const bench = (id: string, over: Partial<DistrictBench> = {}): DistrictBench => ({
  id,
  a: "2",
  sn: "5",
  jg: "3",
  pm: "1",
  pa: "120",
  asof: "2026-10-01",
  ...over,
});

describe("filingsSeries", () => {
  it("keeps complete years only, oldest first, capped to the last years", () => {
    const raw = series([
      [2023, 10],
      [2024, 20],
      [2025, 30],
      [2026, 5, true],
    ]);
    expect(filingsSeries(raw, 2)).toEqual([
      { fy: 2024, filings: 20 },
      { fy: 2025, filings: 30 },
    ]);
  });
  it("drops malformed entries without turning them into zeros", () => {
    expect(
      filingsSeries([
        { fy: 2024 },
        { fy: "x", filings: 5 },
        { fy: 2023, filings: -1 },
        null,
        { fy: 2022, filings: 0 },
      ]),
    ).toEqual([{ fy: 2022, filings: 0 }]);
    expect(filingsSeries("nope")).toEqual([]);
  });
});

describe("parseDistrict", () => {
  const base = {
    id: "wyd",
    c: { court: "District Court, D. Wyoming", circuit: "Tenth Circuit" },
    s: series([
      [2024, 300],
      [2025, 312],
      [2026, 276, true],
    ]),
  };
  it("joins caseload and bench by exact court id", () => {
    const d = parseDistrict(base, bench("wyd"))!;
    expect(d.name).toBe("District Court, D. Wyoming");
    expect(d.circuit).toBe("Tenth Circuit");
    expect(d.latest).toEqual({
      fy: 2025,
      filings: 312,
      terminations: 302,
      pending: 624,
      medianDays: 200,
    });
    expect(d.bench).toEqual({ active: 2, senior: 5, judgeships: 3, asOf: "2026-10-01" });
    expect(d.mdl).toEqual({ pendingMdls: 1, pendingActions: 120 });
  });
  it("shows the bench as missing, not zero, when there is no bench row", () => {
    const d = parseDistrict(base, undefined)!;
    expect(d.bench).toBeNull();
    expect(d.mdl).toBeNull();
  });
  it("rejects a malformed id or a district without a name", () => {
    expect(parseDistrict({ ...base, id: "../x" }, undefined)).toBeNull();
    expect(parseDistrict({ ...base, c: {} }, undefined)).toBeNull();
  });
  it("has no latest year without a complete year", () => {
    expect(parseDistrict({ ...base, s: series([[2026, 5, true]]) }, undefined)!.latest).toBeNull();
  });
});

describe("pending MDLs", () => {
  const mdls = [
    {
      mdl: 2741,
      type: "Products Liability",
      judge: "Vince Chhabria",
      title: "IN RE: Roundup Products Liability Litigation",
      pending: 1104,
    },
    {
      mdl: 3084,
      type: "Miscellaneous",
      judge: "Charles R. Breyer",
      title: "IN RE: Uber Technologies, Inc., Passenger Sexual Assault Litigation",
      pending: 4916,
    },
    { mdl: 0, title: "no number", pending: 5 },
    { mdl: 9, title: "", pending: 5 },
    { mdl: 10, title: "no count", pending: "x" },
  ];
  it("lists valid MDLs by pending actions and drops malformed entries", () => {
    const list = parsePendingMdls(mdls, "cand");
    expect(list.map((m) => m.mdl)).toEqual([3084, 2741]);
    expect(list[0]).toMatchObject({ courtId: "cand", judge: "Charles R. Breyer", pending: 4916 });
    expect(parsePendingMdls("nope", "cand")).toEqual([]);
  });
  it("combines the districts' MDLs in the state summary", () => {
    const a = parseDistrict(
      { id: "cand", c: { court: "N.D. Cal." }, s: series([[2025, 5]]) },
      bench("cand", { m: mdls }),
    )!;
    const b = parseDistrict(
      { id: "cacd", c: { court: "C.D. Cal." }, s: series([[2025, 5]]) },
      bench("cacd", { m: [{ mdl: 1, title: "A", pending: 10 }] }),
    )!;
    expect(summarizeDistricts([a, b]).mdls.map((m) => [m.courtId, m.mdl])).toEqual([
      ["cand", 3084],
      ["cand", 2741],
      ["cacd", 1],
    ]);
  });
});

describe("summarizeDistricts", () => {
  const a = parseDistrict(
    {
      id: "cand",
      c: { court: "N.D. Cal." },
      s: series([
        [2024, 100],
        [2025, 120],
      ]),
    },
    bench("cand", { a: "10", pm: "2", pa: "5000" }),
  )!;
  const b = parseDistrict(
    {
      id: "cacd",
      c: { court: "C.D. Cal." },
      s: series([
        [2024, 200],
        [2025, 230],
      ]),
    },
    bench("cacd", { a: "20", pm: "0", pa: "7" }),
  )!;
  it("sums judges, MDL actions and filings over the districts", () => {
    const s = summarizeDistricts([a, b]);
    expect(s).toMatchObject({
      districts: 2,
      activeJudges: 30,
      pendingMdls: 2,
      pendingActions: 5007,
      asOf: "2026-10-01",
    });
    expect(s.filings).toEqual({ fy: 2025, value: 350, previous: 300 });
  });
  it("never shows a partial sum as a total when one district has no bench row", () => {
    const noBench = parseDistrict(
      {
        id: "caed",
        c: { court: "E.D. Cal." },
        s: series([
          [2024, 1],
          [2025, 2],
        ]),
      },
      undefined,
    )!;
    const s = summarizeDistricts([a, noBench]);
    expect(s.activeJudges).toBeNull();
    expect(s.pendingActions).toBeNull();
    expect(s.filings?.value).toBe(122);
  });
  it("is empty for a state without districts", () => {
    expect(summarizeDistricts([])).toMatchObject({
      districts: 0,
      activeJudges: null,
      filings: null,
    });
  });
});
