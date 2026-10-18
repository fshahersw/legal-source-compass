import { describe, expect, it, vi } from "vitest";

vi.mock("./rest.server", () => ({ restGet: vi.fn() }));
vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => ({
    handler: (handler: unknown) => handler,
    inputValidator: () => ({ handler: (handler: unknown) => handler }),
  }),
}));

import {
  buildStateConsumerData,
  parseConsumerSummaries,
  parseConsumerYears,
  parseDncYears,
  parseNationalYears,
  parseRefundYears,
  printed,
} from "./stateConsumer.functions";

// Rows as the corpus returns them for the select in getStateConsumerData (Wyoming 2022 and California 2024).
const WY_2022 = {
  id: "WY-2022",
  source_url: "https://www.ftc.gov/system/files/ftc_gov/pdf/CSN-Data-Book-2022.pdf",
  cells: {
    year: "2022",
    state: "Wyoming",
    total_loss: "$11,293,782",
    median_loss: "$500",
    fraud_reports: "2,942",
    fraud_other_rank: "46",
    fraud_other_per100k: "700",
    fraud_other_reports: "4,068",
    identity_theft_rank: "48",
    identity_theft_reports: "552",
  },
  m: {
    fraud_reports: 2942,
    total_loss_usd: 11293782,
    median_loss_usd: 500,
    pct_reporting_loss: 28,
    fraud_other_rank: 46,
    fraud_other_per100k: 700,
    fraud_other_reports: 4068,
    identity_theft_rank: 48,
    identity_theft_per100k: 95,
    identity_theft_reports: 552,
  },
  a: {
    total_loss_yoy_pct: 45.7,
    median_loss_yoy_pct: 0,
    fraud_other_rank_change: 0,
    identity_theft_rank_change: 0,
    fraud_other_reports_yoy_pct: -3.83,
    fraud_other_per100k_yoy_pct: -4.24,
  },
  tc: null,
  it: [
    { type: "Credit Card Fraud", share_pct: 35 },
    { type: "Other Identity Theft", share_pct: 27 },
  ],
  pop: "2020",
  cv: ["Per-100K figures use 2020 Census estimates this year."],
  wh: ["top categories withheld: 11 categories instead of 10"],
};

const CA_2024 = {
  id: "CA-2024",
  source_url: "https://www.ftc.gov/system/files/ftc_gov/pdf/csn-annual-data-book-2024.pdf",
  cells: {
    fraud_other_reports: "506,727",
    fraud_other_per100k: "1,291",
    fraud_other_rank: "17",
    identity_theft_reports: "139,665",
    identity_theft_rank: "7",
    fraud_reports: "238,705",
    total_loss: "$1,678,703,608",
    median_loss: "$542",
  },
  m: {
    fraud_other_reports: 506727,
    fraud_other_per100k: 1291,
    fraud_other_rank: 17,
    identity_theft_reports: 139665,
    identity_theft_per100k: 356,
    identity_theft_rank: 7,
    fraud_reports: 238705,
    pct_reporting_loss: 40,
    total_loss_usd: 1678703608,
    median_loss_usd: 542,
  },
  a: { total_loss_yoy_pct: 21.54, fraud_other_rank_change: 2 },
  tc: [
    { category: "Identity Theft", share_pct: 22 },
    { category: "Credit Bureaus and Information Furnishers", share_pct: 20 },
  ],
  it: null,
  pop: "2023",
  cv: [],
  wh: [],
};

const DC_2025 = {
  id: "DC-2025",
  cells: { fraud_other_reports: "1,000", fraud_other_rank: "Unranked", fraud_other_per100k: "900" },
  m: { fraud_other_reports: 1000, fraud_other_per100k: 900, fraud_other_rank: null },
  pop: "2023",
};

describe("printed", () => {
  it("keeps the record's own cell text and the stored number beside it", () => {
    expect(printed("1,291", 1291)).toEqual({ text: "1,291", value: 1291 });
    expect(printed("$542", 542, (n) => `$${n}`)).toEqual({ text: "$542", value: 542 });
  });

  it("formats the stored number only when the record has no cell text", () => {
    expect(printed(undefined, 356)).toEqual({ text: "356", value: 356 });
    expect(printed(undefined, 1678703608, (n) => `$${n.toLocaleString("en-US")}`)).toEqual({
      text: "$1,678,703,608",
      value: 1678703608,
    });
  });

  it("treats a Not recorded cell with no number as unknown, never zero", () => {
    expect(printed("Not recorded", null)).toBeNull();
    expect(printed(undefined, null)).toBeNull();
    expect(printed("", Number.NaN)).toBeNull();
  });

  it("keeps an Unranked cell as text with no value, so it is never shown as a rank", () => {
    expect(printed("Unranked", null)).toEqual({ text: "Unranked", value: null });
  });
});

describe("parseConsumerYears", () => {
  it("builds one year per edition in year order with figures exactly as printed", () => {
    const years = parseConsumerYears([CA_2024, { ...CA_2024, id: "CA-2023" }], "CA");
    expect(years.map((y) => y.year)).toEqual([2023, 2024]);
    const y = years[1]!;
    expect(y.reports).toEqual({ text: "506,727", value: 506727 });
    expect(y.per100k).toEqual({ text: "1,291", value: 1291 });
    expect(y.rank).toEqual({ text: "17", value: 17 });
    expect(y.totalLoss).toEqual({ text: "$1,678,703,608", value: 1678703608 });
    expect(y.medianLoss?.text).toBe("$542");
    expect(y.identityTheftPer100k).toEqual({ text: "356", value: 356 });
    expect(y.pctReportingLoss).toBe(40);
    expect(y.populationYear).toBe(2023);
    expect(y.change.rankChange).toBe(2);
    expect(y.change.totalLossPct).toBe(21.54);
    expect(y.categories).toEqual([
      { rank: 1, category: "Identity Theft", sharePct: 22 },
      { rank: 2, category: "Credit Bureaus and Information Furnishers", sharePct: 20 },
    ]);
  });

  it("leaves a withheld top-ten table null and carries the reason on the record", () => {
    const y = parseConsumerYears([WY_2022], "WY")[0]!;
    expect(y.categories).toBeNull();
    expect(y.identityTheftTypes).toEqual([
      { type: "Credit Card Fraud", sharePct: 35 },
      { type: "Other Identity Theft", sharePct: 27 },
    ]);
    expect(y.withheld).toEqual(["top categories withheld: 11 categories instead of 10"]);
    expect(y.caveats).toHaveLength(1);
  });

  it("keeps DC's rank as Unranked with no numeric rank", () => {
    const y = parseConsumerYears([DC_2025], "DC")[0]!;
    expect(y.rank).toEqual({ text: "Unranked", value: null });
    expect(y.identityTheftRank).toBeNull();
    expect(y.totalLoss).toBeNull();
  });

  it("drops rows of another state, malformed ids, rows without metrics and duplicate years", () => {
    const rows = [
      CA_2024,
      { ...CA_2024, id: "TX-2024" },
      { ...CA_2024, id: "CA-24" },
      { ...CA_2024, id: "CA-2022", m: null },
      { ...CA_2024, id: "CA-2021", m: { ...CA_2024.m, fraud_other_reports: "506,727" } },
      { ...CA_2024, source_url: "https://example.com/duplicate" },
      null,
      "CA-2020",
    ];
    const years = parseConsumerYears(rows as unknown[], "CA");
    expect(years.map((y) => y.year)).toEqual([2024]);
    expect(years[0]!.sourceUrl).toContain("csn-annual-data-book-2024");
  });

  it("rejects category shares outside 0-100 rather than showing them", () => {
    const y = parseConsumerYears(
      [
        {
          ...CA_2024,
          tc: [
            { category: "Bad", share_pct: 140 },
            { category: "", share_pct: 5 },
          ],
        },
      ],
      "CA",
    )[0]!;
    expect(y.categories).toBeNull();
  });
});

describe("parseDncYears", () => {
  const CA_FY2025 = {
    id: "CA-FY2025",
    source_url: "https://www.ftc.gov/system/files/ftc_gov/pdf/DNC-Data-Book-2025.pdf",
    cells: {
      complaints: "304,497",
      complaints_per100k: "776",
      complaints_rank: "22",
      registrations: "28,923,788",
      registrations_per100k: "73,705",
    },
    m: {
      complaints: 304497,
      complaints_per100k: 776,
      complaints_rank: 22,
      registrations: 28923788,
      registrations_per100k: 73705,
      registrations_rank: 38,
    },
    a: { complaints_yoy_pct: 5.76, complaints_rank_change: -13 },
    pop: "2023",
  };

  it("reads a fiscal year with printed counts, ranks and the Census basis", () => {
    const d = parseDncYears([CA_FY2025], "CA")[0]!;
    expect(d.fy).toBe(2025);
    expect(d.complaints?.text).toBe("304,497");
    expect(d.complaintsRank).toEqual({ text: "22", value: 22 });
    expect(d.registrationsRank).toEqual({ text: "38", value: 38 });
    expect(d.populationYear).toBe(2023);
    expect(d.complaintsYoyPct).toBe(5.76);
  });

  it("leaves the blank DC and PR ranks null (Not recorded), never zero", () => {
    const dc = {
      ...CA_FY2025,
      id: "DC-FY2025",
      cells: { ...CA_FY2025.cells, complaints_rank: "Not recorded" },
      m: { ...CA_FY2025.m, complaints_rank: null, registrations_rank: null },
    };
    const d = parseDncYears([dc], "DC")[0]!;
    expect(d.complaintsRank).toBeNull();
    expect(d.registrationsRank).toBeNull();
    expect(d.complaints?.text).toBe("304,497");
  });

  it("drops another state's row and a row without a complaint count", () => {
    const rows = [
      CA_FY2025,
      { ...CA_FY2025, id: "TX-FY2024" },
      { ...CA_FY2025, id: "CA-FY2024", m: {} },
    ];
    expect(parseDncYears(rows, "CA").map((d) => d.fy)).toEqual([2025]);
  });
});

describe("parseRefundYears", () => {
  const row = (id: string, amount: string, usd: number | null, extra = {}) => ({
    id,
    source_url: `https://www.ftc.gov/${id}.pdf`,
    cells: { amount },
    v: usd == null ? {} : { mailed_usd: usd },
    a: { share_of_listed_states_pct: 9.07, yoy_pct: -2.78 },
    ...extra,
  });

  it("keeps the printed dollar amount and the state's own year rows", () => {
    const years = parseRefundYears(
      [
        row("2024-state-CA", "$24,919,399", 24919399),
        row("2022-state-CA", "$28,946,347", 28946347),
      ],
      "CA",
    );
    expect(years.map((y) => y.year)).toEqual([2022, 2024]);
    expect(years[1]!.mailed).toEqual({ text: "$24,919,399", value: 24919399 });
    expect(years[1]!.sharePct).toBe(9.07);
    expect(years[1]!.yoyPct).toBe(-2.78);
  });

  it("never binds another state's row or a case row to this state", () => {
    const years = parseRefundYears(
      [
        row("2024-state-TX", "$1", 1),
        row("2024-first_distribution-vonage", "$2", 2),
        row("2024-state-CA", "Not recorded", null),
        row("2023-state-CA", "$5", 5),
      ],
      "CA",
    );
    expect(years.map((y) => y.recordId)).toEqual(["2023-state-CA"]);
  });
});

describe("parseNationalYears", () => {
  const US_2020 = {
    id: "US-2020",
    cells: { median_loss: "$311", total_loss: "$3,305,412,862", fraud_reports: "2,184,531" },
    fs: {
      median_loss_usd: 311,
      pct_reporting_loss: 34,
      total_loss_usd: 3305412862,
      fraud_reports: 2184531,
    },
    n: ["2020: ReportFraud.ftc.gov launched in 2020; Internet Auctions retired."],
  };

  it("carries the national median and the FTC's definition notice for the edition", () => {
    const n = parseNationalYears([US_2020, { id: "US-series", fs: {} }])[0]!;
    expect(n.year).toBe(2020);
    expect(n.medianLoss).toEqual({ text: "$311", value: 311 });
    expect(n.pctReportingLoss).toBe(34);
    expect(n.notices).toHaveLength(1);
  });

  it("ignores the series record and rows without a fraud summary", () => {
    expect(parseNationalYears([{ id: "US-series", fs: {} }, { id: "US-2019" }])).toEqual([]);
  });
});

describe("parseConsumerSummaries", () => {
  it("reads edition names and the terms line, ignoring hashes and unrelated keys", () => {
    const { terms, editions } = parseConsumerSummaries([
      {
        id: "ftc_sentinel_states",
        terms: "Public domain; no FTC endorsement may be implied.",
        src: {
          "2024": {
            name: "Consumer Sentinel Network Data Book 2024",
            url: "https://x/2024.pdf",
            official_pdf_sha256: "abc",
          },
          bogus: { name: "Not an edition" },
        },
      },
      {
        id: "ftc_dnc_states",
        terms: "ignored later",
        src: { FY2025: { name: "DNC FY 2025", url: "https://x/dnc.pdf" } },
      },
      {
        id: "ftc_refunds",
        src: {
          report_2024: { name: "2024 FTC Annual Report on Refunds to Consumers" },
          data_page: { name: "Data page" },
        },
      },
    ]);
    expect(terms).toBe("Public domain; no FTC endorsement may be implied.");
    expect(editions.sentinel[2024]).toEqual({
      name: "Consumer Sentinel Network Data Book 2024",
      url: "https://x/2024.pdf",
    });
    expect(Object.keys(editions.sentinel)).toEqual(["2024"]);
    expect(editions.dnc[2025]?.name).toBe("DNC FY 2025");
    expect(editions.refunds[2024]).toEqual({
      name: "2024 FTC Annual Report on Refunds to Consumers",
      url: null,
    });
  });
});

describe("buildStateConsumerData", () => {
  it("assembles the state's rows and reports the sections that did not load", () => {
    const v = buildStateConsumerData("CA", {
      sentinel: [CA_2024],
      dnc: [],
      refunds: [],
      national: [],
      summaries: [],
      unavailable: ["dnc"],
    });
    expect(v.usps).toBe("CA");
    expect(v.years).toHaveLength(1);
    expect(v.dnc).toEqual([]);
    expect(v.terms).toBeNull();
    expect(v.unavailable).toEqual(["dnc"]);
  });
});
