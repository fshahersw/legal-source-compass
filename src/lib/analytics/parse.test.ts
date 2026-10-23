import { describe, expect, it } from "vitest";
import {
  billsFromParts,
  introducedByCongress,
  parseCriminalSeries,
  parseEpaYears,
  parseFsisByYear,
  parseMdlMonthly,
  parseMdlYears,
  parseSecuritiesYears,
  parseSentinelYears,
  parseTypeYears,
  parseVacancyMonths,
  tallyFtc,
  tallyNominations,
  tallySec,
  tallyYears,
} from "./parse";

describe("parseCriminalSeries", () => {
  it("keeps year, filed, terminated and the stored partial flag, sorted and unique", () => {
    const rows = parseCriminalSeries([
      { fy: 2026, filed: 78253, terminated: 61348, partial: true },
      { fy: 2025, filed: 79129, terminated: 82135, partial: false },
      { fy: 2025, filed: 1, terminated: 1 },
      { fy: "x", filed: 3 },
      null,
      { fy: 2024, filed: -4, terminated: "n/a" },
    ]);
    expect(rows).toEqual([
      { fy: 2024, partial: false, filed: null, terminated: null },
      { fy: 2025, partial: false, filed: 79129, terminated: 82135 },
      { fy: 2026, partial: true, filed: 78253, terminated: 61348 },
    ]);
  });
  it("returns nothing for something that is not a list", () => {
    expect(parseCriminalSeries(undefined)).toEqual([]);
    expect(parseCriminalSeries({ fy: 2020 })).toEqual([]);
  });
});

describe("JPML series", () => {
  it("reads fiscal-year pending and the printed period length", () => {
    expect(
      parseMdlYears([
        { fy: 1993, pending: 37002, period_months: 12 },
        { fy: 1992, pending: 37253, period_months: 15 },
        { fy: 2015, pending: null, period_months: 12 },
      ]),
    ).toEqual([
      { fy: 1992, pending: 37253, periodMonths: 15 },
      { fy: 1993, pending: 37002, periodMonths: 12 },
      { fy: 2015, pending: null, periodMonths: 12 },
    ]);
  });
  it("drops a monthly report without a valid date or counts", () => {
    expect(
      parseMdlMonthly([
        { date: "2024-10-01", pending: 402473, mdls: 170 },
        { date: "October 2024", pending: 1, mdls: 1 },
        { date: "2024-11-01", pending: "many", mdls: 1 },
      ]),
    ).toEqual([{ date: "2024-10-01", pending: 402473, mdls: 170 }]);
  });
});

describe("parseSecuritiesYears", () => {
  it("reads year records only", () => {
    expect(
      parseSecuritiesYears([
        { kind: "year", year: 2025, filings: 129, partial: true },
        { kind: "year", year: 2024, filings: 222, partial: false },
        { kind: "overview", filings: 6879 },
        { kind: "year", year: 2024, filings: 1 },
      ]),
    ).toEqual([
      { year: 2024, filings: 222, partial: false },
      { year: 2025, filings: 129, partial: true },
    ]);
  });
});

describe("parseVacancyMonths", () => {
  it("keeps a count only when the whole monthly list was read", () => {
    const months = parseVacancyMonths([
      { month: "2026-10", reports: { vacancies: "parsed" }, vacancies_listed: 28 },
      { month: "2026-09", reports: { vacancies: "parsed" }, vacancies_listed: 25 },
      {
        month: "1995-04",
        reports: { vacancies: "not parsed: scanned image without a text layer" },
        vacancies_listed: 12,
      },
      {
        month: "2003-01",
        reports: { vacancies: "partial: 15 rows parsed, the report prints a total of 18" },
        vacancies_listed: 15,
      },
      { month: "2001-13", reports: { vacancies: "parsed" }, vacancies_listed: 3 },
      { month: "2000-05", vacancies_listed: 9 },
    ]);
    expect(months).toEqual([
      { month: "1995-04", vacanciesListed: null },
      { month: "2000-05", vacanciesListed: null },
      { month: "2003-01", vacanciesListed: null },
      { month: "2026-09", vacanciesListed: 25 },
      { month: "2026-10", vacanciesListed: 28 },
    ]);
  });
});

describe("tallies", () => {
  it("counts nominations received and confirmed per Congress", () => {
    expect(
      tallyNominations([
        { c: "118", s: "confirmed" },
        { c: "118", s: "returned" },
        { c: "118", s: "confirmed" },
        { c: "97", s: "withdrawn" },
        { c: null, s: "confirmed" },
        { c: "abc", s: "confirmed" },
        { c: "0", s: "confirmed" },
      ]),
    ).toEqual([
      { congress: 97, received: 1, confirmed: 0 },
      { congress: 118, received: 3, confirmed: 2 },
    ]);
  });
  it("counts SEC releases per year and type and ignores unknown types", () => {
    expect(
      tallySec([
        { y: "2024", t: "litigation_release" },
        { y: "2024", t: "administrative_proceeding" },
        { y: "2024", t: "administrative_proceeding" },
        { y: "2023", t: "litigation_release" },
        { y: "2024", t: "other" },
        { y: null, t: "litigation_release" },
      ]),
    ).toEqual([
      { year: 2023, litigation: 1, administrative: 0 },
      { year: 2024, litigation: 1, administrative: 2 },
    ]);
  });
  it("counts FTC actions per year and kind and reports the undated ones apart", () => {
    const { years, undated } = tallyFtc(
      [
        { y: "2000", k: "bcp_penalty" },
        { y: "2000", k: "bcp_penalty" },
        { y: "2000", k: "merger" },
        { y: null, k: "merger" },
        { y: "", k: "merger" },
        { y: "2001", k: "unknown" },
      ],
      ["merger", "nonmerger", "bc_penalty", "bcp_penalty"],
    );
    expect(years).toEqual([{ year: 2000, counts: { bcp_penalty: 2, merger: 1 } }]);
    expect(undated).toBe(2);
  });
  it("counts rows per year", () => {
    expect(tallyYears([{ y: "2010" }, { y: "2011" }, { y: "2010" }, { y: "x" }, {}])).toEqual([
      { year: 2010, count: 2 },
      { year: 2011, count: 1 },
    ]);
  });
});

describe("parseEpaYears", () => {
  it("skips the all-years row whose fiscal year is not a number", () => {
    expect(
      parseEpaYears([
        { fy: "All", opened: 137026 },
        { fy: 2025, opened: 3027, judicial: 22 },
        { fy: 2027, opened: 12, judicial: 0 },
      ]),
    ).toEqual([
      { fy: 2025, opened: 3027, judicial: 22 },
      { fy: 2027, opened: 12, judicial: 0 },
    ]);
  });
});

describe("parseFsisByYear", () => {
  it("adds classes I to III as recalls and keeps public health alerts apart", () => {
    expect(
      parseFsisByYear({
        "2025": { I: 39, II: 2, III: 2, PHA: 24 },
        "2020": { I: 30, II: 4, PHA: 18 },
        "20x": { I: 1 },
      }),
    ).toEqual([
      { year: 2020, recalls: 34, alerts: 18 },
      { year: 2025, recalls: 43, alerts: 24 },
    ]);
    expect(parseFsisByYear(null)).toEqual([]);
  });
});

describe("parseSentinelYears", () => {
  it("reads printed totals and the data book URL of each US-<year> record", () => {
    expect(
      parseSentinelYears([
        {
          id: "US-2024",
          reports: { total: 6471708, fraud: 2600678 },
          source_url: "https://www.ftc.gov/system/files/ftc_gov/pdf/csn-annual-data-book-2024.pdf",
        },
        { id: "US-2023", reports: { total: 5392028 }, source_url: "javascript:alert(1)" },
        { id: "CA-2023", reports: { total: 1 } },
      ]),
    ).toEqual([
      { year: 2023, total: 5392028, fraud: null, sourceUrl: null },
      {
        year: 2024,
        total: 6471708,
        fraud: 2600678,
        sourceUrl: "https://www.ftc.gov/system/files/ftc_gov/pdf/csn-annual-data-book-2024.pdf",
      },
    ]);
  });
});

describe("Federal Register and bills", () => {
  it("keeps four-digit years with counts", () => {
    expect(parseTypeYears({ "1995": 4747, x: 1, "2025": 2441, "2026": "n" })).toEqual({
      "1995": 4747,
      "2025": 2441,
    });
    expect(parseTypeYears(undefined)).toEqual({});
  });
  it("adds bills and joint resolutions per Congress and leaves simple and concurrent resolutions out", () => {
    const introduced = introducedByCongress({
      "118-s": 5649,
      "118-hr": 10564,
      "118-hjres": 230,
      "118-sjres": 122,
      "118-hres": 1627,
      "118-sres": 942,
      "118-hconres": 135,
      "119-hr": 10848,
      "bad-hr": 5,
    });
    expect([...introduced]).toEqual([
      [118, 16565],
      [119, 10848],
    ]);
  });
  it("pairs introduced counts with became-law counts and leaves an unread count as null", () => {
    const introduced = new Map([
      [119, 100],
      [118, 200],
    ]);
    expect(billsFromParts(introduced, new Map([[118, 7]]))).toEqual([
      { congress: 118, introduced: 200, becameLaw: 7 },
      { congress: 119, introduced: 100, becameLaw: null },
    ]);
  });
});
