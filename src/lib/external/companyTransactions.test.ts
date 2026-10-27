import { describe, expect, it } from "vitest";
import {
  dealsByYear,
  matchTransactions,
  parseNotice,
  suspensionYears,
  uniqueKey,
} from "./companyTransactions";

// Mirrors the exact-key normaliser of regulatoryRecords.functions.ts for these names.
const keyOf = (n: string) =>
  n
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean)
    .filter(
      (w, i, a) => !(i === a.length - 1 && ["inc", "corporation", "company", "co"].includes(w)),
    )
    .join(" ");

const notice = (tx: string, date: string, acquiring: string, acquired: string) =>
  parseNotice({
    c: { transaction_number: tx, date, acquiring_party: acquiring, acquired_party: acquired },
    source_url: `https://api.ftc.gov/v0/hsr-early-termination-notices?id=${tx}`,
  })!;

describe("parseNotice", () => {
  it("keeps parties as published and drops rows without them", () => {
    const n = notice("19991703", "1999-03-09", "Pfizer, Inc.", "Cardinal Health, Inc.");
    expect(n).toMatchObject({ transaction: "19991703", acquiring: "Pfizer, Inc." });
    expect(
      parseNotice({ c: { transaction_number: "1", acquiring_party: "", acquired_party: "x" } }),
    ).toBeNull();
  });
});

describe("matchTransactions", () => {
  const rows = [
    notice("19991703", "1999-03-09", "Pfizer, Inc.", "Cardinal Health, Inc."),
    notice("19994212", "1999-09-10", "Schering-Plough Corporation", "Pfizer Inc."),
    notice("20002276", "2000-06-19", "Pfizer Inc.", "Warner-Lambert Company"),
    notice("20002276", "2000-06-19", "Pfizer Inc.", "Warner-Lambert Company"),
    notice("20009999", "2000-07-01", "Pfizer Animal Health Holdings", "Some Vet Co"),
  ];
  it("matches the exact key as acquirer or target, once per transaction", () => {
    const out = matchTransactions(rows, "pfizer", keyOf);
    expect(out.map((r) => [r.transaction, r.role])).toEqual([
      ["20002276", "acquirer"],
      ["19994212", "target"],
      ["19991703", "acquirer"],
    ]);
  });
  it("never matches a longer name that only starts with the key", () => {
    expect(matchTransactions(rows, "pfizer", keyOf).some((r) => r.transaction === "20009999")).toBe(
      false,
    );
  });
  it("counts deals per year by role with empty years kept", () => {
    const years = dealsByYear(matchTransactions(rows, "pfizer", keyOf));
    expect(years).toEqual([
      { year: "1999", acquirer: 1, target: 1 },
      { year: "2000", acquirer: 1, target: 0 },
    ]);
  });
});

describe("uniqueKey", () => {
  it("refuses a key shared by two profiled companies", () => {
    expect(uniqueKey("pfizer", ["PFIZER INC", "Merck & Co., Inc."], keyOf)).toBe(true);
    expect(uniqueKey("abbott", ["Abbott Inc", "Abbott Corporation"], keyOf)).toBe(false);
    expect(uniqueKey("", ["x"], keyOf)).toBe(false);
  });
});

describe("suspensionYears", () => {
  it("finds the 2021–2024 early termination suspension in the FTC series", () => {
    const counts: [number, number][] = [
      [2015, 900],
      [2016, 950],
      [2017, 1000],
      [2018, 1100],
      [2019, 1050],
      [2020, 987],
      [2021, 71],
      [2022, 0],
      [2023, 0],
      [2024, 6],
      [2025, 381],
    ];
    expect(suspensionYears(counts.map(([year, count]) => ({ year, count })))).toEqual([
      2021, 2022, 2023, 2024,
    ]);
    expect(suspensionYears([{ year: 2020, count: 1 }])).toEqual([]);
  });
});
