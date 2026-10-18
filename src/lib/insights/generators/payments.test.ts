import { describe, expect, it } from "vitest";
import type { ManufacturerPayments, StatePayments } from "@/lib/external/openPayments.functions";
import { generatePaymentsInsights, titleCase, type PaymentsInput } from "./payments";

const MILLION = 1_000_000;

const py = (
  year: number,
  general: number | null,
  research: number | null,
  records: number | null = null,
) => ({
  year,
  general,
  generalRecords: records,
  research,
  researchRecords: null,
  source: "summary" as const,
});

const natYear = (
  year: number,
  general: number,
  research: number,
  records: number | null = null,
) => ({
  year,
  general,
  generalRecords: records,
  research,
  researchRecords: null,
  physicians: null,
  npps: null,
  teachingHospitals: null,
  source: "summary" as const,
});

const national = (over: Partial<StatePayments> = {}): StatePayments => ({
  state: "US",
  name: "United States",
  years: [
    natYear(2017, 2_000 * MILLION, 3_000 * MILLION),
    natYear(2024, 3_000 * MILLION, 5_000 * MILLION),
    natYear(2025, 3_450 * MILLION, 6_000 * MILLION, 12_300_000),
  ],
  nature: [],
  natureByYear: {
    "2025": [
      { label: "Royalty or License", amount: 1_000 * MILLION },
      { label: "Consulting Fee", amount: 800 * MILLION },
      { label: "Food and Beverage", amount: 600 * MILLION },
      { label: "Travel and Lodging", amount: 450 * MILLION },
    ],
  },
  reportingEntities: { "2017": 1_500, "2023": 1_900, "2024": 1_925, "2025": 1_833 },
  sourceUrl: "https://openpaymentsdata.cms.gov/",
  ...over,
});

/** 12 manufacturers; maker i reported (12 - i) x 100M in 2025 and a different amount in 2024. */
const makers = (n = 12): ManufacturerPayments[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `m${i}`,
    entityId: `e${i}`,
    name: i === 0 ? "BIONTECH SE" : `MAKER ${i} INC.`,
    years: [
      py(2024, i === 0 ? 100 * MILLION : i === 11 ? 300 * MILLION : 90 * MILLION, null),
      py(2025, (12 - i) * 100 * MILLION, null),
    ],
  })) as unknown as ManufacturerPayments[];

const stateRows = (n: number): StatePayments[] =>
  Array.from({ length: n }, (_, i) => ({
    state: `S${String(i).padStart(2, "0")}`,
    name: `State ${i}`,
    years: [natYear(2025, (i + 1) * 10 * MILLION, 0)],
    nature: [],
    natureByYear: {},
    reportingEntities: {},
    sourceUrl: "",
  }));

const population = (n: number) =>
  Object.fromEntries(
    Array.from({ length: n }, (_, i) => [
      `S${String(i).padStart(2, "0")}`,
      { "2025": 5 * MILLION },
    ]),
  );

const input = (over: Partial<PaymentsInput> = {}): PaymentsInput => ({
  national: national(),
  states: stateRows(50),
  manufacturers: makers(),
  population: population(50),
  ...over,
});

const byId = (d: PaymentsInput) =>
  Object.fromEntries(generatePaymentsInsights(d).map((i) => [i.id, i]));

describe("generatePaymentsInsights", () => {
  it("states the national general-payment trend and always carries the disclosure caveat", () => {
    const i = byId(input())["payments.national-payments"]!;
    expect(i.headline).toBe(
      "Manufacturers reported $3.5 billion in general payments to clinicians in 2025, up 15.0% from 2024",
    );
    expect(i.summary[2]).toContain("up 73% compared with 2017");
    expect(i.points[0]).toMatchObject({ label: "General payments, 2025", note: "+15.0%" });
    expect(i.caveat).toContain("not evidence of influence or wrongdoing");
    expect(i.dataThrough).toBe("Program year 2025");
  });

  it("measures concentration only among the listed manufacturers and says so", () => {
    const i = byId(input())["payments.manufacturer-concentration"]!;
    // top ten: 1200+1100+...+300 = 7,500M over a 3,450M national total would exceed 100%, so it must not be published
    expect(i).toBeUndefined();
    const ok = byId(
      input({
        national: national({
          years: [
            natYear(2017, 1, 1),
            natYear(2024, 1, 1),
            natYear(2025, 10_000 * MILLION, 6_000 * MILLION),
          ],
        }),
      }),
    )["payments.manufacturer-concentration"]!;
    expect(ok.headline).toBe(
      "Ten manufacturers account for 75% of general payments reported for 2025; Biontech SE is largest",
    );
    expect(ok.caveat).toContain("lists the 12 largest manufacturers");
  });

  it("names the biggest increase and decrease among manufacturers with at least $1 million the year before", () => {
    const i = byId(input())["payments.manufacturer-movers"]!;
    // Biontech: 100M -> 1,200M (+1,100M). Maker 11: 300M -> 100M (-200M). Others 90M -> (12 - i) x 100M.
    expect(i.headline).toBe(
      "Biontech SE raised general payments most in 2025 ($1.1 billion more); Maker 11 Inc. cut them most ($200 million less)",
    );
    expect(i.points[2]!.label).toBe("Manufacturers up / down");
  });

  it("drops the movers insight when fewer than ten manufacturers can be compared", () => {
    expect(
      byId(input({ manufacturers: makers().slice(0, 8) }))["payments.manufacturer-movers"],
    ).toBeUndefined();
  });

  it("describes the leading payment categories as a share of the categories reported", () => {
    const i = byId(input())["payments.payment-types"]!;
    // 1000 / 2850 = 35.1%
    expect(i.headline).toBe("Royalty or License made up 35% of general payments by value in 2025");
    expect(i.points[3]).toMatchObject({ label: "All categories", value: "$2.9 billion" });
  });

  it("ranks payments per resident only with a Census population and at least 45 states", () => {
    const i = byId(input())["payments.state-per-resident"]!;
    // State 49: 500M / 5M = $100; State 0: 10M / 5M = $2
    expect(i.headline).toBe(
      "General payments per resident in 2025 were highest in State 49 ($100) and lowest in State 0 ($2)",
    );
    expect(i.points[0]!.href).toBe("/places/S49");
    expect(byId(input({ population: null }))["payments.state-per-resident"]).toBeUndefined();
    expect(byId(input({ states: stateRows(30) }))["payments.state-per-resident"]).toBeUndefined();
  });

  it("compares research with general payments and the first year in the series", () => {
    const i = byId(input())["payments.research-share"]!;
    // 2025: 6000 / 9450 = 63.5%; 2017: 3000 / 5000 = 60%
    expect(i.headline).toBe(
      "Research payments were 63% of all reported payments in 2025, compared with 60% in 2017",
    );
  });

  it("reports the reporting-company count and the year it peaked", () => {
    const i = byId(input())["payments.reporting-companies"]!;
    expect(i.headline).toBe(
      "1,833 companies reported payments for 2025, down from 1,925 the year before",
    );
    expect(i.summary[1]).toBe("The highest count in the series was 1,925 in 2024.");
  });

  it("returns nothing without a national record or a complete latest year", () => {
    expect(generatePaymentsInsights(input({ national: null }))).toEqual([]);
    expect(
      generatePaymentsInsights(
        input({
          national: national({
            years: [natYear(2025, 1, 1)].map((y) => ({ ...y, general: null as unknown as number })),
          }),
        }),
      ),
    ).toEqual([]);
  });

  it("every candidate satisfies the card contract", () => {
    for (const i of generatePaymentsInsights(input())) {
      expect(i.id.startsWith("payments.")).toBe(true);
      expect(i.summary.length).toBeGreaterThanOrEqual(2);
      expect(i.points.length).toBeGreaterThanOrEqual(3);
      // every dollar figure carries the disclosure; the entity-count insight reports no dollars
      if (i.id !== "payments.reporting-companies")
        expect(i.caveat).toContain("not evidence of influence or wrongdoing");
      expect(JSON.stringify(i)).not.toMatch(/NaN|undefined|Infinity/);
    }
  });
});

describe("titleCase", () => {
  it("normalizes upper-case company names but keeps legal-form tokens", () => {
    expect(titleCase("PFIZER INC.")).toBe("Pfizer Inc.");
    expect(titleCase("BIONTECH SE")).toBe("Biontech SE");
    expect(titleCase("EDGE ENDO LLC")).toBe("Edge Endo LLC");
    expect(titleCase("JOHNSON & JOHNSON")).toBe("Johnson & Johnson");
    expect(titleCase("BANK OF THE WEST")).toBe("Bank of the West");
    expect(titleCase("  3M  COMPANY ")).toBe("3M Company");
  });
});
