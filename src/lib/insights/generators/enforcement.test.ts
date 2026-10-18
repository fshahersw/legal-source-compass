import { describe, expect, it } from "vitest";
import type { ConsumerComplaints } from "@/lib/external/consumerComplaints.functions";
import type { EpaProfile } from "@/lib/external/enforcement.functions";
import type { AgencyActivity } from "@/lib/external/rulemaking.functions";
import {
  generateCfpbInsights,
  generateEpaInsights,
  generateRulemakingInsights,
} from "./enforcement";

const year = (y: number, complaints: number, over: Record<string, unknown> = {}) => ({
  year: y,
  complaints,
  complete: true,
  yoyPct: null,
  creditReporting: Math.round(complaints * 0.9),
  creditReportingSharePct: 90,
  timelyRate: 99.5,
  reliefRate: 40,
  ...over,
});

const cfpb = (over: Partial<ConsumerComplaints> = {}): ConsumerComplaints =>
  ({
    from: "2011-12-01",
    to: "2026-10-18",
    complaints: 1000,
    companies: 50,
    timelyRate: 99.4,
    years: [
      year(2023, 1000, { reliefRate: 44, timelyRate: 99.1 }),
      year(2024, 2000, { reliefRate: 42, timelyRate: 99.3 }),
      year(2025, 4000, {
        yoyPct: 100,
        reliefRate: 41,
        timelyRate: 99.5,
        creditReportingSharePct: 88.4,
      }),
      year(2026, 3000, { complete: false }),
    ],
    ytd: {
      from: "2026-01-01",
      to: "2026-10-18",
      complaints: 5000,
      previousComplaints: 3000,
      changePct: 66.7,
      note: "The current-year span is not yet matured",
    },
    productShift: {
      from: "2024",
      to: "2025",
      rows: [
        {
          product: "Credit reporting",
          complaints2024: 1,
          complaints2025: 2,
          share2024Pct: 86.5,
          share2025Pct: 88.4,
          shiftPp: 1.9,
        },
        {
          product: "Credit card",
          complaints2024: 1,
          complaints2025: 2,
          share2024Pct: 2.8,
          share2025Pct: 1.7,
          shiftPp: -1.1,
        },
        {
          product: "Money transfer",
          complaints2024: 1,
          complaints2025: 2,
          share2024Pct: 0.6,
          share2025Pct: 1.6,
          shiftPp: 0.9,
        },
      ],
    },
    states: [],
    perCapitaRanking: [],
    riseRanking: [],
    topCompanies: [
      {
        rank: 1,
        company: "Experian Information Solutions Inc.",
        complaints: 400,
        windowChangePct: null,
        topProduct: null,
        timelyRate: null,
        reliefRate: null,
      },
      {
        rank: 2,
        company: "TRANSUNION INTERMEDIATE HOLDINGS, INC.",
        complaints: 300,
        windowChangePct: null,
        topProduct: null,
        timelyRate: null,
        reliefRate: null,
      },
      {
        rank: 3,
        company: "EQUIFAX, INC.",
        complaints: 200,
        windowChangePct: null,
        topProduct: null,
        timelyRate: null,
        reliefRate: null,
      },
    ],
    reports: [],
    reportCount: 0,
    ...over,
  }) as ConsumerComplaints;

const cfpbById = (d: ConsumerComplaints) =>
  Object.fromEntries(generateCfpbInsights(d).map((i) => [i.id, i]));

describe("generateCfpbInsights", () => {
  it("compares the last two complete years and the credit-reporting share", () => {
    const i = cfpbById(cfpb())["enforcement.cfpb-annual"]!;
    expect(i.headline).toBe(
      "The CFPB received 4,000 consumer complaints in 2025, up 100% from 2024",
    );
    expect(i.summary[1]).toContain("88.4% of the 2025 complaints were about credit reporting");
    // excluding credit reporting: 2025 = 4000 - 3600 = 400; 2024 = 2000 - 1800 = 200 -> up 100.0%
    expect(i.summary[2]).toContain("complaints were 400 in 2025 and 200 in 2024 (up 100.0%)");
    expect(i.caveat).toContain("not findings of wrongdoing");
  });

  it("refuses to publish a change that contradicts the stored year-over-year figure", () => {
    const bad = cfpb({ years: [year(2024, 2000), year(2025, 4000, { yoyPct: 5 })] });
    expect(cfpbById(bad)["enforcement.cfpb-annual"]).toBeUndefined();
  });

  it("reports the year to date with the stored maturity note", () => {
    const i = cfpbById(cfpb())["enforcement.cfpb-year-to-date"]!;
    expect(i.headline).toBe(
      "CFPB complaints received so far in 2026 are up 67% from the same stretch of 2025",
    );
    expect(i.summary[1]).toBe("That is already more than the 4,000 received in all of 2025.");
    expect(i.caveat).toContain("The current-year span is not yet matured");
  });

  it("uses the largest product shift and the three most-named companies", () => {
    const ids = cfpbById(cfpb());
    expect(ids["enforcement.cfpb-product-shift"]!.headline).toBe(
      "Credit reporting went from 86.5% to 88.4% of CFPB complaints between 2024 and 2025",
    );
    const c = ids["enforcement.cfpb-companies"]!;
    expect(c.headline).toBe("Three company names account for 90% of all CFPB consumer complaints");
    expect(c.summary[2]).toContain("split across them");
  });

  it("describes the relief rate over three complete years", () => {
    const i = cfpbById(cfpb())["enforcement.cfpb-relief-rate"]!;
    expect(i.headline).toBe(
      "41% of CFPB complaints were closed with relief in 2025, compared with 44% in 2023",
    );
  });

  it("drops candidates that lack their inputs", () => {
    const sparse = cfpb({
      years: [],
      ytd: null,
      productShift: { from: "", to: "", rows: [] },
      topCompanies: [],
    });
    expect(generateCfpbInsights(sparse)).toEqual([]);
  });
});

const epaYear = (fy: number, cases: number, fedPenalty: number) => ({
  fy,
  cases,
  judicial: 2,
  administrative: cases - 2,
  settlements: cases,
  penaltySettlements: 10,
  fedPenalty,
  sep: 0,
  costRecovery: 0,
});

const statute = (name: string, cases: number) => ({
  code: null,
  name,
  cases,
  judicial: 0,
  fedPenalty: 0,
  sep: 0,
  citedCases: null,
  years: [2022, 2023, 2024, 2025, 2026].map((fy) => ({ fy, cases, fedPenalty: 1_000_000 })),
});

const epa = (over: Partial<EpaProfile> = {}): EpaProfile =>
  ({
    id: "epa-profile:US",
    code: "US",
    name: "United States",
    kind: "national",
    fips: null,
    totals: { fedPenalty: 100_000_000 },
    years: [2020, 2021, 2022, 2023, 2024, 2025, 2026].map((fy) =>
      epaYear(fy, 100 + fy - 2020, (fy - 2019) * 1_000_000),
    ),
    statutes: [
      statute("Clean Water Act", 30),
      statute("Clean Air Act", 20),
      statute("Safe Drinking Water Act", 10),
    ],
    topCases: [
      {
        caseNumber: "a",
        name: "BP Exploration",
        fy: 2011,
        settled: null,
        settlementFy: 2016,
        type: null,
        statute: null,
        fedPenalty: 40_000_000,
        records: ["a"],
        defendants: [],
        inCasesDataset: true,
      },
      {
        caseNumber: "b",
        name: "Cummins",
        fy: 2020,
        settled: null,
        settlementFy: 2020,
        type: null,
        statute: null,
        fedPenalty: 10_000_000,
        records: ["b"],
        defendants: [],
        inCasesDataset: true,
      },
      {
        caseNumber: "c",
        name: "Volkswagen",
        fy: 2016,
        settled: null,
        settlementFy: 2017,
        type: null,
        statute: null,
        fedPenalty: 5_000_000,
        records: ["c"],
        defendants: [],
        inCasesDataset: true,
      },
    ],
    ...over,
  }) as unknown as EpaProfile;

const epaById = (p: EpaProfile, fileDate: string | null = "2026-10-10") =>
  Object.fromEntries(generateEpaInsights({ fileDate, national: p }).map((i) => [i.id, i]));

describe("generateEpaInsights", () => {
  it("compares the latest complete fiscal year with the five before it", () => {
    const i = epaById(epa())["enforcement.epa-penalties"]!;
    // FY2026 = 7M; FY2021-FY2025 = 2,3,4,5,6 M -> average 4M
    expect(i.headline).toBe(
      "EPA settlements assessed $7 million in federal penalties in FY2026, against an average of $4 million over FY2021 to FY2025",
    );
    expect(i.caveat).toContain("FY2026 is the latest year in the ECHO file (dated 2026-10-10)");
  });

  it("treats the fiscal year as in progress until the file is dated after September 30", () => {
    const i = epaById(epa(), "2026-09-29")["enforcement.epa-penalties"]!;
    expect(i.headline).toContain("in FY2025");
    expect(i.headline).toContain("FY2020 to FY2024");
  });

  it("counts cases opened and the administrative share", () => {
    const i = epaById(epa())["enforcement.epa-cases-opened"]!;
    expect(i.headline).toBe("EPA opened 106 enforcement cases in FY2026, up 1% from FY2025");
    expect(i.summary[1]).toContain("98.1% of the FY2026 cases were administrative");
  });

  it("ranks main statutes over the last five complete fiscal years", () => {
    const i = epaById(epa())["enforcement.epa-statutes"]!;
    expect(i.headline).toBe(
      "Clean Water Act was the main statute in 50% of EPA cases opened in FY2022 to FY2026",
    );
    expect(i.points[3]).toMatchObject({ label: "Cases with a main statute", value: "300" });
  });

  it("shows the largest penalty against the all-time total", () => {
    const i = epaById(epa())["enforcement.epa-largest-cases"]!;
    expect(i.headline).toBe(
      "The largest federal penalty in EPA's case data is $40 million, 40% of all EPA federal penalties recorded",
    );
  });

  it("returns nothing when the file date is unreadable or a needed year is missing", () => {
    expect(generateEpaInsights({ fileDate: null, national: epa() })).toEqual([]);
    const missing = epa({ years: epa().years.filter((y) => y.fy !== 2023) });
    expect(epaById(missing)["enforcement.epa-penalties"]).toBeUndefined();
  });
});

const agency = (
  short: string,
  recent: number,
  base: number,
  over: Record<string, unknown> = {},
): AgencyActivity =>
  ({
    slug: short.toLowerCase(),
    short,
    name: short,
    flags: {
      RULE: {
        recent,
        baselineAnnual: base,
        ratio: recent / base,
        window: "2025-10 to 2026-09",
        baselineWindow: "2022-10 to 2025-09",
        surprise: 0,
        flag: null,
      },
    },
    ...over,
  }) as unknown as AgencyActivity;

describe("generateRulemakingInsights", () => {
  const agencies = [
    agency("PHMSA", 92, 15),
    agency("DEA", 35, 16.7),
    agency("EPA", 302, 336.7),
    agency("CFPB", 15, 28.3),
    agency("FTC", 4, 13),
    agency("FDA", 91, 70.3),
  ];

  it("names the biggest rise and fall in final-rule output against each agency's own average", () => {
    const [i] = generateRulemakingInsights({ asOf: "2026-10-18", agencies });
    expect(i!.headline).toBe(
      "Federal Register final rules: PHMSA up to 92 in the latest 12 months; FTC down to 4",
    );
    expect(i!.summary[0]).toContain("6.1 times its yearly average of 15.0");
    expect(i!.points[0]).toMatchObject({
      value: "92",
      href: "https://www.federalregister.gov/agencies/phmsa",
    });
    expect(i!.dataThrough).toBe("2026-09");
  });

  it("needs several agencies measured over the same window", () => {
    expect(generateRulemakingInsights({ asOf: null, agencies: agencies.slice(0, 4) })).toEqual([]);
    const mixed = [
      ...agencies.slice(0, 5),
      agency("OSHA", 8, 5.7, {
        flags: {
          RULE: {
            recent: 8,
            baselineAnnual: 5.7,
            ratio: 1.4,
            window: "2025-09 to 2026-08",
            baselineWindow: "x",
            surprise: 0,
            flag: null,
          },
        },
      }),
    ];
    expect(generateRulemakingInsights({ asOf: null, agencies: mixed })).toEqual([]);
  });

  it("is empty when no agency moved in both directions", () => {
    const allUp = [
      agency("A", 20, 10),
      agency("B", 30, 10),
      agency("C", 12, 10),
      agency("D", 15, 10),
      agency("E", 18, 10),
    ];
    expect(generateRulemakingInsights({ asOf: null, agencies: allUp })).toEqual([]);
  });
});
