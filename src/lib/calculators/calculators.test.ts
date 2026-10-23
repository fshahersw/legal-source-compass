import { describe, expect, it } from "vitest";
import { anniversary, daysBetween, isIsoDate, weekday } from "./dates";
import { computeInflation, inflationInputProblem } from "./inflation";
import { lifeExpectancy, oneDecimal, rowForAge, type LifeTable } from "./lifeExpectancy";
import { computePji, findRate, pjiInputProblem, rateWeekFor, roundCents } from "./postJudgment";
import { annualRateOf, computePv, pvInputProblem } from "./presentValue";
import type { SeriesObservations, SourceObservation } from "./types";

const WGS1YR: SeriesObservations = {
  seriesId: "WGS1YR",
  label: "1-year Treasury constant maturity, weekly average",
  units: "%",
  frequency: "W",
  url: "https://fred.stlouisfed.org/series/WGS1YR",
  // values as published (FRED WGS1YR; the same figures the district courts' uscourts.gov tables list)
  obs: [
    { date: "2025-12-26", value: "3.51", vintage: "2025-12-29" },
    { date: "2026-01-02", value: "3.48", vintage: "2026-01-05" },
    { date: "2026-07-03", value: "3.98", vintage: "2026-07-06" },
    { date: "2026-10-02", value: "4.52", vintage: "2026-10-05" },
    { date: "2026-10-09", value: "4.45", vintage: "2026-10-13" },
  ],
};

describe("dates", () => {
  it("validates calendar dates and computes weekdays in UTC", () => {
    expect(isIsoDate("2026-02-29")).toBe(false);
    expect(isIsoDate("2028-02-29")).toBe(true);
    expect(weekday("2026-10-09")).toBe(5); // Friday
    expect(daysBetween("2026-10-14", "2027-10-14")).toBe(365);
    expect(anniversary("2028-02-29", 1)).toBe("2029-02-28");
    expect(anniversary("2026-10-14", 2)).toBe("2028-10-14");
  });
});

describe("28 U.S.C. § 1961 rate week", () => {
  // uscourts.gov district tables: week ending → judgments entered (Monday to Sunday)
  const table: [string, string, string][] = [
    ["2026-10-09", "2026-10-12", "2026-10-18"],
    ["2026-10-02", "2026-10-05", "2026-10-11"],
    ["2025-12-26", "2025-12-29", "2026-01-04"],
    ["2026-07-03", "2026-07-06", "2026-07-12"],
  ];
  it.each(table)("week ending %s applies to judgments %s to %s", (weekEnding, from, to) => {
    for (const d of [from, to]) {
      const w = rateWeekFor(d);
      expect(w.weekEnding).toBe(weekEnding);
      expect(w.effectiveFrom).toBe(from);
      expect(w.effectiveTo).toBe(to);
    }
    // the day before the window belongs to the previous week
    expect(rateWeekFor(from).weekEnding).not.toBe(
      rateWeekFor(to === from ? from : addDay(from, -1)).weekEnding,
    );
  });

  it("finds exactly that week or nothing (never the nearest week)", () => {
    expect(findRate(WGS1YR, "2026-10-09")!.value).toBe("4.45");
    expect(findRate(WGS1YR, "2026-09-25")).toBeNull();
  });
});

function addDay(iso: string, n: number) {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
}

describe("28 U.S.C. § 1961 interest", () => {
  const rate = findRate(WGS1YR, "2026-10-09")!;
  it("one full year at 4.45%: 4,450.00 on 100,000, compounded at the anniversary", () => {
    const r = computePji(
      { principal: 100000, judgmentDate: "2026-10-14", paymentDate: "2027-10-14", dayBasis: "365" },
      rate,
    );
    expect(r.week.weekEnding).toBe("2026-10-09");
    expect(r.days).toBe(365);
    expect(r.periods).toHaveLength(1);
    expect(r.periods[0]!.compounded).toBe(true);
    expect(roundCents(r.interest)).toBe(4450);
    expect(roundCents(r.total)).toBe(104450);
    expect(roundCents(r.perDiem)).toBe(12.19);
  });

  it("two years and 30 days, 365-day basis: 9,509.84 (hand computation in decimal arithmetic)", () => {
    // year 1: 100,000 × 0.0445 = 4,450.00; year 2 (366 days, leap year): 104,450 × 0.0445 × 366/365 = 4,660.7593;
    // 30 days: 109,110.7593 × 0.0445 × 30/365 = 399.0763; total 9,509.8357
    const r = computePji(
      { principal: 100000, judgmentDate: "2026-10-14", paymentDate: "2028-11-13", dayBasis: "365" },
      rate,
    );
    expect(r.periods.map((p) => [p.from, p.to, p.days, p.compounded])).toEqual([
      ["2026-10-14", "2027-10-14", 365, true],
      ["2027-10-14", "2028-10-14", 366, true],
      ["2028-10-14", "2028-11-13", 30, false],
    ]);
    expect(r.periods[1]!.interest).toBeCloseTo(4660.759315, 5);
    expect(roundCents(r.interest)).toBe(9509.84);
    expect(roundCents(r.total)).toBe(109509.84);
  });

  it("actual days of each judgment year: 9,497.05", () => {
    const r = computePji(
      {
        principal: 100000,
        judgmentDate: "2026-10-14",
        paymentDate: "2028-11-13",
        dayBasis: "actual",
      },
      rate,
    );
    expect(r.periods[1]!.basisDays).toBe(366);
    expect(r.periods[1]!.interest).toBeCloseTo(4648.025, 6);
    expect(roundCents(r.interest)).toBe(9497.05);
  });

  it("refuses what it cannot compute and says why", () => {
    expect(
      pjiInputProblem({
        principal: 0,
        judgmentDate: "2026-10-14",
        paymentDate: "2027-10-14",
        dayBasis: "365",
      }),
    ).toMatch(/greater than zero/);
    expect(
      pjiInputProblem({
        principal: 10,
        judgmentDate: "2026-10-14",
        paymentDate: "2026-10-13",
        dayBasis: "365",
      }),
    ).toMatch(/before the judgment/);
    expect(
      pjiInputProblem({
        principal: 10,
        judgmentDate: "1999-05-03",
        paymentDate: "2001-01-01",
        dayBasis: "365",
      }),
    ).toMatch(/52-week Treasury bill/);
    const same = computePji(
      { principal: 5000, judgmentDate: "2026-10-14", paymentDate: "2026-10-14", dayBasis: "365" },
      rate,
    );
    expect(same.interest).toBe(0);
    expect(same.periods).toHaveLength(0);
  });

  it("names the release-day difference between courts when the judgment is entered on or before the release date", () => {
    const prev = findRate(WGS1YR, "2026-10-02")!;
    // week ending 10/09/2026 was released Tuesday 10/13 (Monday 10/12 was a federal holiday)
    const r = computePji(
      { principal: 1000, judgmentDate: "2026-10-13", paymentDate: "2027-01-01", dayBasis: "365" },
      rate,
      prev,
    );
    expect(r.notes.join(" ")).toMatch(/District of Utah.*week ending 2026-10-02: 4\.52%/);
    const later = computePji(
      { principal: 1000, judgmentDate: "2026-10-14", paymentDate: "2027-01-01", dayBasis: "365" },
      rate,
      prev,
    );
    expect(later.notes.join(" ")).not.toMatch(/District of Utah/);
  });

  it("shows a revised weekly figure beside the current one", () => {
    const revised: SourceObservation = {
      ...rate,
      firstValue: "4.40",
      firstVintage: "2026-10-13",
      vintage: "2026-11-02",
    };
    const r = computePji(
      { principal: 1000, judgmentDate: "2026-10-14", paymentDate: "2027-01-01", dayBasis: "365" },
      revised,
    );
    expect(r.notes.join(" ")).toMatch(/first published 4\.40/);
  });
});

const CPI: SeriesObservations = {
  seriesId: "CPIAUCNS",
  label: "CPI-U, all items, U.S. city average, not seasonally adjusted",
  units: "Index 1982-1984=100",
  frequency: "M",
  url: "https://fred.stlouisfed.org/series/CPIAUCNS",
  obs: [
    { date: "2020-01-01", value: "257.971", vintage: "2020-02-13" },
    { date: "2024-01-01", value: "308.417", vintage: "2024-02-13" },
    { date: "2025-10-01", value: null, vintage: "2025-12-18" },
    {
      date: "2016-05-01",
      value: "240.229",
      vintage: "2016-10-18",
      firstValue: "240.236",
      firstVintage: "2016-06-16",
    },
  ],
};

describe("inflation adjustment", () => {
  it("$1,000 in January 2020 is $1,195.55 in January 2024 (308.417 ÷ 257.971)", () => {
    const r = computeInflation(
      { amount: 1000, fromMonth: "2020-01", toMonth: "2024-01", seriesId: "CPIAUCNS" },
      CPI,
      CPI,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.factor).toBeCloseTo(1.1955491121, 9);
    expect(roundCents(r.adjusted)).toBe(1195.55);
    expect(r.from.value).toBe("257.971");
    expect(r.to.value).toBe("308.417");
  });

  it("does not substitute a month BLS did not publish", () => {
    const r = computeInflation(
      { amount: 1000, fromMonth: "2025-10", toMonth: "2024-01", seriesId: "CPIAUCNS" },
      CPI,
      CPI,
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toMatch(/Not recorded.*October 2025/);
    expect(r.missing).toEqual(["2025-10"]);
  });

  it("notes a corrected value", () => {
    const r = computeInflation(
      { amount: 100, fromMonth: "2016-05", toMonth: "2024-01", seriesId: "CPIAUCNS" },
      CPI,
      CPI,
    );
    expect(r.ok && r.notes.join(" ")).toMatch(/first 240\.236/);
  });

  it("validates inputs", () => {
    expect(
      inflationInputProblem({
        amount: -1,
        fromMonth: "2020-01",
        toMonth: "2024-01",
        seriesId: "CPIAUCNS",
      }),
    ).toBeTruthy();
    expect(
      inflationInputProblem({
        amount: 1,
        fromMonth: "2020-13",
        toMonth: "2024-01",
        seriesId: "CPIAUCNS",
      }),
    ).toBeTruthy();
    expect(
      inflationInputProblem({
        amount: 1,
        fromMonth: "2020-01",
        toMonth: "2024-01",
        seriesId: "AAA",
      }),
    ).toBeTruthy();
  });
});

describe("present value", () => {
  const rate: SourceObservation = {
    seriesId: "DGS3",
    label: "3-year Treasury constant maturity, daily",
    date: "2026-10-16",
    value: "4.00",
    units: "%",
    vintage: "2026-10-17",
    url: "https://fred.stlouisfed.org/series/DGS3",
  };
  it("three end-of-year payments of 10,000 at 4%: 27,750.91 (annuity factor 2.775091)", () => {
    const r = computePv(
      { amount: 10000, years: 3, growthPercent: 0, timing: "end", basis: "annual" },
      rate,
    );
    expect(roundCents(r.presentValue)).toBe(27750.91);
    expect(r.nominalTotal).toBe(30000);
    expect(r.rows.map((x) => x.t)).toEqual([1, 2, 3]);
  });
  it("semiannual (bond-equivalent) treatment: r = 1.02² − 1 = 4.04%, PV 27,729.86", () => {
    expect(annualRateOf(4, "semiannual")).toBeCloseTo(0.0404, 12);
    const r = computePv(
      { amount: 10000, years: 3, growthPercent: 0, timing: "end", basis: "semiannual" },
      rate,
    );
    expect(roundCents(r.presentValue)).toBe(27729.86);
  });
  it("start-of-year timing discounts the first payment by nothing; growth compounds from the second payment", () => {
    const r = computePv(
      { amount: 1000, years: 2, growthPercent: 10, timing: "start", basis: "annual" },
      rate,
    );
    expect(r.rows[0]).toMatchObject({ t: 0, payment: 1000, factor: 1 });
    expect(r.rows[1]!.payment).toBeCloseTo(1100, 9);
    expect(roundCents(r.presentValue)).toBe(roundCents(1000 + 1100 / 1.04));
  });
  it("validates inputs", () => {
    expect(
      pvInputProblem({ amount: 1, years: 0, growthPercent: 0, timing: "end", basis: "annual" }),
    ).toBeTruthy();
    expect(
      pvInputProblem({ amount: 1, years: 2.5, growthPercent: 0, timing: "end", basis: "annual" }),
    ).toBeTruthy();
  });
});

describe("life expectancy", () => {
  const rows: string[][] = [
    [
      "0-1",
      "5.5314125493168831E-3",
      "100000",
      "553.1412353515625",
      "99515.4453125",
      "7897103",
      "78.971031188964844",
    ],
    [
      "1-2",
      "4.006756644230336E-4",
      "99446.859375",
      "39.845935821533203",
      "99426.9375",
      "7797587.5",
      "78.409591674804688",
    ],
    ["2-3", "2.59958062088117E-4", "99407.0", "25.8", "99394.1", "7698160.5", "77.44"],
    ["3 and over", "1", "99381.2", "99381.2", "7598766", "7598766", "76.46"],
  ];
  const table: LifeTable = {
    year: 2024,
    report: "NVSR 75-05",
    reportUrl: "https://www.cdc.gov/nchs/data/nvsr/nvsr75/nvsr75-05.pdf",
    table: 1,
    title: "Table 1. Life table for the total population: United States, 2024",
    group: "total",
    sex: "total",
    rows,
    sourceUrl:
      "https://ftp.cdc.gov/pub/Health_Statistics/NCHS/Publications/NVSR/75-05/Table01.xlsx",
  };
  it("reads e(x) at the age at last birthday and prints it as the report does (79.0 at birth, 2024)", () => {
    const r = lifeExpectancy(table, 0);
    expect(r.ok && r.exDisplay).toBe("79.0");
    expect(r.ok && r.ex).toBe("78.971031188964844");
    const one = lifeExpectancy(table, 1);
    expect(one.ok && one.exDisplay).toBe("78.4");
  });
  it("uses the open interval for the oldest ages and refuses what is not in the table", () => {
    expect(rowForAge(rows, 7)![0]).toBe("3 and over");
    expect(lifeExpectancy(table, -1).ok).toBe(false);
    expect(lifeExpectancy(null, 40).ok).toBe(false);
  });
  it("rounds half up on the decimal digits", () => {
    expect(oneDecimal("78.95")).toBe("79.0");
    expect(oneDecimal("78.9499")).toBe("78.9");
    expect(oneDecimal("5")).toBe("5.0");
  });
});
