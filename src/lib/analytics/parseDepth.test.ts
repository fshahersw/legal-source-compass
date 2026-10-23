import { describe, expect, it } from "vitest";
import {
  divisionNames,
  dojAmountYears,
  parseEpaPenalties,
  parseSaferProductsYears,
  parseWindow,
  tallySecAmounts,
} from "./parseDepth";

describe("dojAmountYears", () => {
  it("reads the three size buckets, treats an absent bucket as no releases and sorts by year", () => {
    const years = dojAmountYears([
      { year: "2025", count: 5000, amount: { "10m_plus": 414, "100m_plus": 90, "1b_plus": 12 } },
      { year: "2024", count: 4800, amount: { "10m_plus": 497 } },
    ]);
    expect(years).toEqual([
      { year: 2024, total: 4800, bands: { tenM: 497, hundredM: 0, billion: 0 } },
      { year: 2025, total: 5000, bands: { tenM: 414, hundredM: 90, billion: 12 } },
    ]);
  });
  it("drops a year label that is not a year", () => {
    expect(dojAmountYears([{ year: "n/a", count: 1, amount: {} }])).toEqual([]);
    expect(dojAmountYears([{ year: "", count: 1, amount: {} }])).toEqual([]);
  });
});

describe("tallySecAmounts", () => {
  const row = (y: unknown, t: unknown, a: unknown) => ({ y, t, a });
  it("counts litigation releases per year and size bucket and ignores administrative proceedings", () => {
    const out = tallySecAmounts([
      row("2024", "litigation_release", "10m_plus"),
      row("2024", "litigation_release", "10m_plus"),
      row("2024", "litigation_release", "100m_plus"),
      row("2024", "litigation_release", "1b_plus"),
      row("2024", "administrative_proceeding", "1b_plus"),
      row("2023", "litigation_release", "10m_plus"),
    ]);
    expect(out).toEqual([
      { year: 2023, bands: { tenM: 1, hundredM: 0, billion: 0 } },
      { year: 2024, bands: { tenM: 2, hundredM: 1, billion: 1 } },
    ]);
  });
  it("keeps a year whose releases state no figure at zero in every band, not missing", () => {
    expect(tallySecAmounts([row("2022", "litigation_release", null)])).toEqual([
      { year: 2022, bands: { tenM: 0, hundredM: 0, billion: 0 } },
    ]);
  });
  it("ignores an unknown bucket and rows without a valid year or a type", () => {
    expect(
      tallySecAmounts([
        row("2024", "litigation_release", "under_1m"),
        row("not a year", "litigation_release", "10m_plus"),
        row("2024", null, "10m_plus"),
        null,
        "x",
      ]),
    ).toEqual([{ year: 2024, bands: { tenM: 0, hundredM: 0, billion: 0 } }]);
  });
});

describe("divisionNames", () => {
  const components = [
    { name: "USAO - Texas, Southern", count: 9000 },
    { name: "Criminal Division", count: 5000 },
    { name: "Civil Division", count: 3000 },
    { name: "Tax Division", count: 3000 },
    { name: "Office of Public Affairs", count: 4000 },
    { name: "National Security Division (NSD)", count: 2000 },
    { name: "Antitrust Division", count: 1000 },
  ];
  it("keeps only components that name a Division, largest first, ties by name", () => {
    expect(divisionNames(components, 10)).toEqual([
      "Criminal Division",
      "Civil Division",
      "Tax Division",
      "National Security Division (NSD)",
      "Antitrust Division",
    ]);
  });
  it("returns the four largest by default, the palette size", () => {
    expect(divisionNames(components)).toHaveLength(4);
    expect(divisionNames(components, 2)).toEqual(["Criminal Division", "Civil Division"]);
  });
  it("does not match a word that merely contains Division", () => {
    expect(divisionNames([{ name: "Subdivisional Review", count: 1 }])).toEqual([]);
  });
  it("does not change the order of its input", () => {
    const copy = components.map((c) => ({ ...c }));
    divisionNames(copy);
    expect(copy).toEqual(components);
  });
});

describe("parseEpaPenalties", () => {
  it("reads the federal penalty per fiscal year, sorted, first row of a year wins", () => {
    expect(
      parseEpaPenalties([
        { fy: 2016, fed_penalty: 5 },
        { fy: 2015, fed_penalty: 6_000_000_000 },
        { fy: 2016, fed_penalty: 999 },
      ]),
    ).toEqual([
      { fy: 2015, penalty: 6_000_000_000 },
      { fy: 2016, penalty: 5 },
    ]);
  });
  it("keeps an unrecorded penalty as null, never zero, and drops rows with no valid year", () => {
    expect(
      parseEpaPenalties([
        { fy: 2020, fed_penalty: null },
        { fy: 2021, fed_penalty: -5 },
        { fy: 2022, fed_penalty: "12" },
        { fy: "2023", fed_penalty: 1 },
        { fy: 12, fed_penalty: 1 },
        null,
      ]),
    ).toEqual([
      { fy: 2020, penalty: null },
      { fy: 2021, penalty: null },
      { fy: 2022, penalty: null },
    ]);
  });
});

describe("parseSaferProductsYears", () => {
  it("keeps the publication-year rows, sorted, with the partial flag", () => {
    expect(
      parseSaferProductsYears([
        { kind: "published", year: 2026, reports: 6000, partial: true },
        { kind: "published", year: 2025, reports: 4415 },
        { kind: "received", year: 2025, reports: 1 },
        { kind: "published", year: 2025, reports: 9 },
      ]),
    ).toEqual([
      { year: 2025, reports: 4415, partial: false },
      { year: 2026, reports: 6000, partial: true },
    ]);
  });
  it("drops rows without a valid year or a non-negative count", () => {
    expect(
      parseSaferProductsYears([
        { kind: "published", year: 2020, reports: -1 },
        { kind: "published", year: 2021 },
        { kind: "published", year: "2022", reports: 3 },
        undefined,
      ]),
    ).toEqual([]);
  });
});

describe("parseWindow", () => {
  it("reads first and last ISO dates", () => {
    expect(parseWindow({ first: "2011-03-11", last: "2026-10-16" })).toEqual({
      first: "2011-03-11",
      last: "2026-10-16",
    });
  });
  it("returns null for anything that is not an ISO date or not an object", () => {
    expect(parseWindow({ first: "March 2011", last: 5 })).toEqual({ first: null, last: null });
    expect(parseWindow("x")).toEqual({ first: null, last: null });
    expect(parseWindow(undefined)).toEqual({ first: null, last: null });
  });
});
