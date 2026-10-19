import { describe, expect, it } from "vitest";
import {
  checkText,
  documentTitle,
  figureAmount,
  filingsIn,
  fiscalYearEnd,
  latestMix,
  latestValue,
  moneyScale,
  parseIrDocument,
  parseSegmentsProfile,
  parseStatements,
  parseStatementsProfile,
  periodLabel,
  segmentSeries,
  stateName,
  statementRows,
  statementsCsv,
  subtotalMembers,
  tableValue,
  tickerLine,
  trendRows,
} from "./companyStatements";

const A = "0001628280-26-010185";
const Q = "0001628280-26-028357";

const statements = {
  annual_periods: [
    { fy: 2024, start: "2024-01-01", end: "2024-12-31" },
    { fy: 2025, start: "2025-01-01", end: "2025-12-31" },
  ],
  quarterly_periods: [
    { fy: 2025, q: 4, start: "2025-10-01", end: "2025-12-31" },
    { fy: 2026, q: 1, start: "2026-01-01", end: "2026-03-31" },
  ],
  lines: {
    revenue: {
      label: "Revenue",
      statement: "income",
      unit: "USD",
      annual: [
        [41950000000, A, "RevenueFromContractWithCustomerExcludingAssessedTax", 0],
        [44328000000, A, "RevenueFromContractWithCustomerExcludingAssessedTax", 0],
      ],
      quarterly: [
        [11459000000, A, "RevenueFromContractWithCustomerExcludingAssessedTax", 1],
        [11164000000, Q, "RevenueFromContractWithCustomerExcludingAssessedTax", 0],
      ],
    },
    eps_diluted: {
      label: "Diluted EPS",
      statement: "income",
      unit: "USD/shares",
      annual: [
        [7.64, A, "EarningsPerShareDiluted", 0],
        [-0.5, A, "EarningsPerShareDiluted", 0],
      ],
      quarterly: [null, [0.61, Q, "EarningsPerShareDiluted", 0]],
    },
    gross_profit: {
      label: "Gross profit",
      statement: "income",
      unit: "USD",
      annual: [
        [23244000000, null, null, 2],
        [25009000000, null, null, 2],
      ],
      quarterly: [null, null],
    },
    cash: {
      label: "Cash",
      statement: "balance",
      unit: "USD",
      annual: [
        [1, A, "Cash", 0],
        ["bad", A, "Cash", 0],
      ],
      quarterly: [null, null],
    },
    junk: { label: "Junk", statement: "nowhere", unit: "USD", annual: [], quarterly: [] },
    empty: { label: "Empty", statement: "income", unit: "USD", annual: [null], quarterly: [] },
  },
  margins: {
    annual: { gross_margin: [55.41, 56.42], net_margin: [31.95, "x"] },
    quarterly: {},
  },
  growth: { annual: { revenue: [null, 5.7] }, quarterly: { revenue: [null, null] } },
};

const profile = {
  kind: "statements",
  cik: "0000001800",
  name: "ABBOTT LABORATORIES",
  tickers: ["ABT"],
  exchanges: ["NYSE"],
  sic: "2834",
  sic_description: "Pharmaceutical Preparations",
  state_of_incorporation: "IL",
  fiscal_year_end: "1231",
  category: "Large Accelerated<br>Well Known Seasoned Issuer",
  website: "https://www.abbott.com/",
  ir_website: "javascript:alert(1)",
  description: "Abbott's principal business is the discovery of health care products.",
  description_source: {
    form: "10-K",
    accn: A,
    date: "2026-02-20",
    url: "https://www.sec.gov/Archives/edgar/data/1800/000162828026010185/abt-20251231.htm",
  },
  logo: { path: "/company-logos/0000001800.png", source_page: "https://www.abbott.com/" },
  currency: "USD",
  statements_supplement: [
    {
      form: "10-Q",
      accn: "0001628280-26-050134",
      date: "2026-07-28",
      url: "https://www.sec.gov/Archives/edgar/data/1800/000162828026050134/abt-20260630_htm.xml",
    },
    { form: "10-Q", accn: "bad", date: "2026-07-28", url: "https://example.com/x" },
  ],
  statements,
  filings: [
    {
      form: "8-K",
      accn: "0001104659-26-099247",
      date: "2026-08-20",
      items: "7.01,8.01,9.01",
      url: "https://www.sec.gov/Archives/edgar/data/1800/000110465926099247/tm2623675d1_8k.htm",
      index_url:
        "https://www.sec.gov/Archives/edgar/data/1800/000110465926099247/0001104659-26-099247-index",
    },
    { form: "10-K", accn: A, date: "2026-02-20", url: "https://evil.example.com/x.htm" },
    { form: "10-Q", accn: Q, date: "2026-04-29", url: "https://www.sec.gov/Archives/x.htm" },
  ],
  retrieved: "2026-10-19",
};

describe("parseStatementsProfile", () => {
  const p = parseStatementsProfile(profile)!;
  it("keeps valid fields and drops unsafe or malformed ones", () => {
    expect(p.name).toBe("ABBOTT LABORATORIES");
    expect(p.website).toBe("www.abbott.com");
    expect(p.irWebsite).toBeNull();
    expect(p.logo?.path).toBe("/company-logos/0000001800.png");
    expect(p.supplement.map((f) => f.accn)).toEqual(["0001628280-26-050134"]);
    expect(p.filings.map((f) => f.form)).toEqual(["8-K", "10-Q"]);
    expect(p.descriptionSource?.form).toBe("10-K");
    expect(p.category).toBe("Large Accelerated · Well Known Seasoned Issuer");
  });
  it("rejects a logo path outside the logo folder and a record without a CIK", () => {
    expect(
      parseStatementsProfile({ ...profile, logo: { path: "https://x.com/a.png" } })?.logo,
    ).toBeNull();
    expect(parseStatementsProfile({ ...profile, cik: "1800" })).toBeNull();
  });
});

describe("parseStatements", () => {
  const s = parseStatements(statements)!;
  it("drops lines with an unknown statement or no values, and malformed cells", () => {
    expect(Object.keys(s.lines).sort()).toEqual(["cash", "eps_diluted", "gross_profit", "revenue"]);
    expect(s.lines["cash"]!.annual[1]).toBeNull();
    expect(s.lines["revenue"]!.quarterly[0]!.basis).toBe(1);
  });
  it("pads margins and growth to the period count, dropping non-numbers", () => {
    expect(s.margins.annual.net_margin).toEqual([31.95, null]);
    expect(s.margins.annual.operating_margin).toEqual([null, null]);
    expect(s.growth.annual["revenue"]).toEqual([null, 5.7]);
  });
  it("drops a grain whose periods are malformed instead of shifting columns", () => {
    const bad = parseStatements({ ...statements, quarterly_periods: [{ fy: 2025, q: 9 }] })!;
    expect(bad.quarterlyPeriods).toEqual([]);
    expect(bad.lines["revenue"]!.quarterly).toEqual([]);
  });
});

describe("statement views", () => {
  const s = parseStatements(statements)!;
  const scale = moneyScale(s);
  it("labels periods and orders rows by the statement layout", () => {
    expect(periodLabel(s.quarterlyPeriods[1]!)).toBe("Q1 FY2026");
    expect(periodLabel(s.annualPeriods[0]!)).toBe("FY2024");
    expect(statementRows(s, "income", "annual").map((l) => l.key)).toEqual([
      "revenue",
      "gross_profit",
      "eps_diluted",
    ]);
    expect(statementRows(s, "income", "quarterly").map((l) => l.key)).toEqual([
      "revenue",
      "eps_diluted",
    ]);
  });
  it("formats money in millions, per-share to cents and negatives in parentheses", () => {
    expect(scale).toEqual({ divisor: 1e6, label: "millions" });
    expect(tableValue(s.lines["revenue"]!.annual[1]!, "USD", scale)).toBe("44,328");
    expect(tableValue(s.lines["eps_diluted"]!.annual[1]!, "USD/shares", scale)).toBe("(0.50)");
    expect(tableValue(null, "USD", scale)).toBe("—");
  });
  it("finds the latest value and builds trend rows", () => {
    expect(latestValue(s, "eps_diluted", "quarterly")?.period.q).toBe(1);
    expect(latestValue(s, "missing", "annual")).toBeNull();
    const rows = trendRows(s, "annual");
    expect(rows.map((r) => [r.label, r.revenue, r.gross_margin])).toEqual([
      ["FY2024", 41950000000, 55.41],
      ["FY2025", 44328000000, 56.42],
    ]);
  });
  it("writes a tidy CSV with basis, concept and accession", () => {
    const csv = statementsCsv(s, "quarterly", "0000001800").trim().split("\n");
    expect(csv[0]).toBe(
      "cik,statement,line,unit,fiscal_year,fiscal_quarter,period_start,period_end,value,basis,concept,accession",
    );
    expect(csv).toContain(
      `0000001800,Income statement,Revenue,USD,2025,4,2025-10-01,2025-12-31,11459000000,derived,RevenueFromContractWithCustomerExcludingAssessedTax,${A}`,
    );
    expect(csv).toHaveLength(4);
  });
});

const segProfile = {
  cik: "0000001800",
  axes: [
    {
      axis: "StatementBusinessSegmentsAxis",
      kind: "segment",
      measure: "revenue",
      concept: "RevenueFromContractWithCustomerExcludingAssessedTax",
      unit: "usd",
      members: [
        { member: "abt:MedicalDevicesMember", label: "Medical Devices" },
        { member: "abt:DiagnosticProductsMember", label: "Diagnostics" },
        { member: "abt:NutritionalProductsMember", label: "Nutrition" },
      ],
      annual: {
        periods: [
          { start: "2024-01-01", end: "2024-12-31" },
          { start: "2025-01-01", end: "2025-12-31" },
        ],
        values: {
          "abt:MedicalDevicesMember": [18000, 20000],
          "abt:DiagnosticProductsMember": [9000, 9500],
          "abt:NutritionalProductsMember": [8000, 8500],
          "abt:UnlistedMember": [1, 1],
        },
        accn: { "abt:MedicalDevicesMember": [A, A] },
      },
      checks: [
        {
          start: "2025-01-01",
          end: "2025-12-31",
          members: 3,
          sum: 38000,
          total: 38010,
          diff_pct: -0.03,
          status: "matches",
        },
        { start: "x", end: "y", sum: 1, status: "matches" },
      ],
    },
    { axis: "X", kind: "planet", measure: "revenue", concept: "Revenues", members: [] },
  ],
  filings_used: [
    { form: "10-K", accn: A, date: "2026-02-20", url: "https://www.sec.gov/Archives/a.xml" },
  ],
};

describe("segments", () => {
  const p = parseSegmentsProfile(segProfile)!;
  const axis = p.axes[0]!;
  it("keeps valid axes, listed members and well-formed checks", () => {
    expect(p.axes).toHaveLength(1);
    expect(Object.keys(axis.annual!.values)).toHaveLength(3);
    expect(axis.checks).toHaveLength(1);
    expect(axis.annual!.accn["abt:DiagnosticProductsMember"]).toEqual([null, null]);
  });
  it("orders series by the latest value and folds the rest into Other members", () => {
    const series = segmentSeries(axis, "annual", 2)!;
    expect(series.keys.map((k) => k.label)).toEqual([
      "Medical Devices",
      "Diagnostics",
      "Other members (1)",
    ]);
    expect(series.rows[1]).toEqual({ end: "2025-12-31", m0: 20000, m1: 9500, other: 8500 });
    expect(segmentSeries(axis, "quarterly")).toBeNull();
  });
  it("computes the latest mix as shares of the members' sum, with that period's check", () => {
    const mix = latestMix(axis, "annual")!;
    expect(mix.sum).toBe(38000);
    expect(mix.items[0]!.share).toBeCloseTo(52.63, 2);
    expect(mix.check?.status).toBe("matches");
    expect(checkText(mix.check, (v) => String(v))).toContain("within 1%");
    expect(checkText(null, String)).toContain("No consolidated total");
  });
});

describe("subtotal members", () => {
  const geo = (values: Record<string, (number | null)[]>, totals: (number | null)[]) =>
    parseSegmentsProfile({
      cik: "0000001800",
      axes: [
        {
          axis: "StatementGeographicalAxis",
          kind: "geography",
          measure: "revenue",
          concept: "Revenues",
          members: Object.keys(values).map((m) => ({ member: m, label: m.replace("x:", "") })),
          annual: {
            periods: [
              { start: "2024-01-01", end: "2024-12-31" },
              { start: "2025-01-01", end: "2025-12-31" },
            ],
            values,
          },
          checks: totals.map((t, i) => ({
            start: `${2024 + i}-01-01`,
            end: `${2024 + i}-12-31`,
            sum: 0,
            total: t,
            status: t === null ? "no_total" : "differs",
          })),
        },
      ],
    })!.axes[0]!;

  it("recognises a member that is the sum of others in every period with a total", () => {
    const axis = geo(
      { "x:US": [60, 62], "x:NonUS": [40, 41], "x:Germany": [25, 26], "x:Japan": [15, 15] },
      [100, 103],
    );
    expect(subtotalMembers(axis, "annual")).toEqual({
      members: ["x:NonUS"],
      matched: 2,
      compared: 2,
    });
    const mix = latestMix(axis, "annual", new Set(["x:NonUS"]))!;
    expect(mix.sum).toBe(103);
    expect(segmentSeries(axis, "annual", 8, new Set(["x:NonUS"]))!.keys).toHaveLength(3);
  });

  it("accepts a subtotal that fits the latest period and half of all, and reports the count", () => {
    // The earlier period comes from a filing that listed other countries, so it does not add up.
    const axis = geo(
      { "x:US": [60, 62], "x:NonUS": [45, 41], "x:Germany": [20, 26], "x:Japan": [15, 15] },
      [100, 103],
    );
    expect(subtotalMembers(axis, "annual")).toEqual({
      members: ["x:NonUS"],
      matched: 1,
      compared: 2,
    });
  });

  it("leaves members as filed when they already add up, or when no single member explains the gap", () => {
    const none = (values: Record<string, (number | null)[]>, totals: (number | null)[]) =>
      subtotalMembers(geo(values, totals), "annual").members;
    expect(none({ "x:US": [60, 62], "x:Other": [40, 41] }, [100, 103])).toEqual([]);
    expect(none({ "x:A": [60, 62], "x:B": [40, 41], "x:C": [5, 9] }, [90, 90])).toEqual([]);
    expect(none({ "x:A": [60, 62], "x:B": [40, 41] }, [null, null])).toEqual([]);
  });

  it("rejects a candidate that fits only an earlier period", () => {
    const axis = geo({ "x:A": [60, 62], "x:B": [40, 41], "x:C": [40, 5] }, [100, 108]);
    expect(subtotalMembers(axis, "annual").members).toEqual([]);
  });
});

describe("investor documents", () => {
  const id = "0000001800:0001628280-26-048377:EX99.1:e77803";
  const raw = {
    cik: "0000001800",
    accn: "0001628280-26-048377",
    date: "2026-07-16",
    form: "8-K",
    items: "2.02,9.01",
    exhibit: "EX-99.1",
    description: "EX-99.1",
    doc_type: "earnings_release",
    url: "https://www.sec.gov/Archives/edgar/data/1800/000162828026048377/abt-2026q2xexhibitx991.htm",
    chars: 37724,
    extraction: {
      period_label: "Second Quarter 2026",
      revenue: { value: 12593, scale: "millions", quote: "Net Sales $12,593 $11,142 13.0" },
      eps_diluted: { value: 0.53, quote: "GAAP diluted EPS of $0.53" },
      net_income: { value: "928", scale: "millions", quote: "Net Earnings $928" },
      segments: [
        { name: "Medical Devices", value: 5853, scale: "millions", quote: "q" },
        { name: "x" },
      ],
      kpis: [{ name: "Comparable growth", value: "4.8%", quote: "4.8 percent" }],
      guidance: "none",
      xbrl_quarter: { fy: 2026, q: 2, start: "2026-04-01", end: "2026-06-30" },
      xbrl_checks: {
        revenue: { status: "matches", xbrl: 12593000000, extracted: 12593000000, xbrl_accn: Q },
        eps_diluted: { status: "invented" },
      },
    },
  };
  it("parses a document and validates its figures and checks", () => {
    const d = parseIrDocument(id, raw)!;
    expect(d.extraction!.netIncome).toBeNull();
    expect(d.extraction!.segments).toHaveLength(1);
    expect(d.extraction!.guidance).toEqual([]);
    expect(d.extraction!.checks.revenue?.status).toBe("matches");
    expect(d.extraction!.checks.epsDiluted).toBeNull();
    expect(d.extraction!.quarter?.q).toBe(2);
    expect(figureAmount(d.extraction!.revenue!)).toBe(12593000000);
  });
  it("titles generic exhibits by type and period", () => {
    expect(documentTitle(parseIrDocument(id, raw)!)).toBe("Earnings release: Second Quarter 2026");
    expect(
      documentTitle(parseIrDocument(id, { ...raw, description: "Press release dated July 16" })!),
    ).toBe("Press release dated July 16");
  });
  it("rejects bad ids, non-SEC URLs and unknown types", () => {
    expect(parseIrDocument("1800:x", raw)).toBeNull();
    expect(parseIrDocument(id, { ...raw, url: "https://example.com/a.htm" })).toBeNull();
    expect(parseIrDocument(id, { ...raw, doc_type: "rumour" })).toBeNull();
  });
});

describe("small helpers", () => {
  it("names states and fiscal year ends, or says not recorded", () => {
    expect(stateName("IL")).toBe("Illinois");
    expect(stateName("L2")).toBe("EDGAR code L2");
    expect(stateName(null)).toBe("Not recorded");
    expect(fiscalYearEnd("0628")).toBe("June 28");
    expect(fiscalYearEnd("1399")).toBe("Not recorded");
  });
  it("groups filings by form", () => {
    const p = parseStatementsProfile(profile)!;
    expect(filingsIn(p.filings, "periodic").map((f) => f.form)).toEqual(["10-Q"]);
    expect(filingsIn(p.filings, "current").map((f) => f.form)).toEqual(["8-K"]);
    expect(filingsIn(p.filings, "all")).toHaveLength(2);
  });
  it("builds the ticker line", () => {
    expect(tickerLine(parseStatementsProfile(profile), null)).toBe("ABT · NYSE");
    expect(tickerLine(null, null)).toBe("No ticker recorded");
  });
});
