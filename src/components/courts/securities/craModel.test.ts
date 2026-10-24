import { describe, expect, it } from "vitest";
import {
  buildSeries,
  compareVintage,
  defaultReport,
  groupReports,
  parseFact,
  parseReport,
  pdfLink,
  reportDateValue,
  reportShort,
  unitFormatter,
  unitWords,
  vintageRank,
  yearKeys,
  type CraFact,
  type CraReport,
  type LineSpec,
} from "./craModel";
import { linePath, reportFactsPath } from "./craReports.functions";

const CR = "Cornerstone Research and the Stanford Law School Securities Class Action Clearinghouse";

function report(
  id: string,
  period: string,
  date: string | null,
  extra: Partial<CraReport> = {},
): CraReport {
  return {
    id,
    family: "cr_filings",
    familyLabel: "Securities class action filings",
    publisher: CR,
    edition: `${period} report`,
    period,
    title: `Filings ${period}`,
    date,
    dateBasis: "printed on the report",
    pdfUrl: `https://www.cornerstone.com/${id}.pdf`,
    landingUrl: null,
    pages: 40,
    facts: 10,
    status: "facts extracted",
    ...extra,
  };
}

let n = 0;
function fact(
  reportId: string,
  period: string,
  value: number | null,
  extra: Partial<CraFact> = {},
): CraFact {
  n += 1;
  return {
    id: `${reportId}:${n.toString(16).padStart(16, "0")}`,
    reportId,
    series: "filings.class_action_filings",
    seriesLabel: "Class action filings",
    period,
    periodType: "year",
    aggregate: "",
    value,
    valueText: value == null ? "—" : String(value),
    unit: "filings",
    basis: "",
    dimension: "",
    scope: "",
    table: "Figure 1",
    pdfPage: 5,
    printedPage: "4",
    method: "table",
    partial: false,
    note: "",
    sourceUrl: `https://www.cornerstone.com/${reportId}.pdf#page=5`,
    ...extra,
  };
}

const SPEC: LineSpec = {
  id: "cr",
  label: "Cornerstone",
  series: "filings.class_action_filings",
  dimension: "",
  scope: "",
};

describe("vintage order", () => {
  it("puts the midyear report before the full-year report of the same year, and both before the next year", () => {
    const q1 = report("nera-us-2020-q1", "2020 Q1", "2020-04-20");
    const h1 = report("cr-filings-2020-mya", "2020 H1", "2020-07-28");
    const fy = report("cr-filings-2020-yir", "2020", "2021-01-27");
    const next = report("cr-filings-2021-mya", "2021 H1", "2021-07-27");
    const sorted = [next, fy, q1, h1].sort(compareVintage).map((r) => r.id);
    expect(sorted).toEqual([q1.id, h1.id, fy.id, next.id]);
  });
  it("ranks a report covering a range by its last year", () => {
    expect(vintageRank({ period: "2015–2020 Q1", date: null })).toBeLessThan(
      vintageRank({ period: "2020 H1", date: null }),
    );
    expect(vintageRank({ period: "1996–2011", date: null })).toBeLessThan(
      vintageRank({ period: "2012", date: null }),
    );
  });
});

describe("buildSeries", () => {
  const r18 = report("cr-filings-2018-yir", "2018", "2019-01-30");
  const r25 = report("cr-filings-2025-yir", "2025", "2026-01-28");
  const reports = new Map([r18, r25].map((r) => [r.id, r]));

  it("takes each year from the latest report and lists the earlier differing value", () => {
    const facts = [
      fact(r18.id, "2017", 412),
      fact(r18.id, "2018", 403),
      fact(r25.id, "2018", 420),
      fact(r25.id, "2024", 226),
      fact(r25.id, "2017", 412),
    ];
    const s = buildSeries(facts, reports, SPEC);
    expect(s.points.map((p) => [p.period, p.value, p.report.id])).toEqual([
      ["2017", 412, r25.id],
      ["2018", 420, r25.id],
      ["2024", 226, r25.id],
    ]);
    expect(s.restated).toHaveLength(1);
    expect(s.restated[0]!.period).toBe("2018");
    expect(s.restated[0]!.earlier.map((e) => [e.value, e.report.id])).toEqual([[403, r18.id]]);
  });

  it("keeps a year only an earlier report prints", () => {
    const s = buildSeries([fact(r18.id, "1997", 174), fact(r25.id, "2024", 226)], reports, SPEC);
    expect(s.points.map((p) => p.period)).toEqual(["1997", "2024"]);
    expect(s.points[0]!.report.id).toBe(r18.id);
  });

  it("never mixes dollar bases: only the latest report's basis is drawn", () => {
    const spec = { ...SPEC, series: "filings.ddl_total" };
    const usd = { series: "filings.ddl_total", unit: "usd_billions" };
    const facts = [
      fact(r18.id, "2016", 107, { ...usd, basis: "not stated" }),
      fact(r18.id, "2010", 40, { ...usd, basis: "not stated" }),
      fact(r25.id, "2016", 140, { ...usd, basis: "inflation-adjusted, 2025 dollars" }),
    ];
    const s = buildSeries(facts, reports, spec);
    expect(s.basis).toBe("inflation-adjusted, 2025 dollars");
    expect(s.points.map((p) => [p.period, p.value])).toEqual([["2016", 140]]);
    expect(s.otherBasis).toBe(2);
    expect(s.restated).toEqual([]);
  });

  it("leaves out ranges, aggregates, other breakdowns, other populations and missing values", () => {
    const facts = [
      fact(r25.id, "1997–2024", 220, { periodType: "range", aggregate: "annual average" }),
      fact(r25.id, "2024", 230, { aggregate: "annual maximum" }),
      fact(r25.id, "2024", 300, { scope: "Federal and State" }),
      fact(r25.id, "2024", 10, { dimension: "Sector: Health Care" }),
      fact(r25.id, "2023", null),
      fact(r25.id, "2024 H1", 110, { periodType: "half" }),
      fact("cr-filings-2099-yir", "2024", 999),
      fact(r25.id, "2024", 226),
    ];
    const s = buildSeries(facts, reports, SPEC);
    expect(s.points.map((p) => [p.period, p.value])).toEqual([["2024", 226]]);
  });

  it("marks partial values and does not count a partial earlier value as a restatement", () => {
    const facts = [
      fact(r18.id, "2018", 215, { partial: true }),
      fact(r25.id, "2018", 208),
      fact(r25.id, "2025", 207, { partial: true }),
    ];
    const s = buildSeries(facts, reports, SPEC);
    expect(s.points.map((p) => [p.period, p.partial])).toEqual([
      ["2018", false],
      ["2025", true],
    ]);
    expect(s.restated).toEqual([]);
  });

  it("returns an empty series when no fact matches", () => {
    const s = buildSeries([], reports, SPEC);
    expect(s.points).toEqual([]);
    expect(yearKeys([s])).toEqual([]);
  });

  it("lays every year out between the first and last so a gap stays a gap", () => {
    const s = buildSeries([fact(r25.id, "2020", 1), fact(r25.id, "2023", 2)], reports, SPEC);
    expect(yearKeys([s])).toEqual(["2020", "2021", "2022", "2023"]);
  });
});

describe("parsing", () => {
  const profile = {
    report_id: "cr-filings-2025-yir",
    series: "filings.ddl_total",
    period: "2025",
    period_type: "year",
    aggregate: "",
    value: 694,
    value_text: "$694",
    unit: "usd_billions",
    basis: "inflation-adjusted, 2025 dollars",
    dimension: "",
    scope: "",
    table: "Figure 1",
    pdf_page: 5,
    printed_page: "4",
    method: "table",
  };
  const row = {
    id: "cr-filings-2025-yir:0123456789abcdef",
    source_url:
      "https://www.cornerstone.com/wp-content/uploads/2026/01/Filings-2025-YIR.pdf#page=5",
    label: "Disclosure Dollar Loss (total)",
    p: profile,
  };

  it("reads a fact row", () => {
    const f = parseFact(row);
    expect(f).toMatchObject({
      value: 694,
      valueText: "$694",
      pdfPage: 5,
      seriesLabel: "Disclosure Dollar Loss (total)",
    });
    expect(f?.sourceUrl).toBe(row.source_url);
  });

  it("drops a fact whose id does not belong to its report, and a value that is not a number is not recorded", () => {
    expect(parseFact({ ...row, id: "cr-filings-2024-yir:0123456789abcdef" })).toBeNull();
    expect(parseFact({ ...row, p: { ...profile, value: "694" } })?.value).toBeNull();
    expect(parseFact({ ...row, p: { ...profile, value: Number.NaN } })?.value).toBeNull();
  });

  it("keeps only links to the publishers' PDFs", () => {
    expect(
      pdfLink("https://securities.stanford.edu/research-reports/1996-2020/x.pdf"),
    ).not.toBeNull();
    expect(
      pdfLink("https://www.nera.com/content/dam/nera/publications/2025/x.pdf#page=3"),
    ).not.toBeNull();
    expect(pdfLink("http://www.cornerstone.com/x.pdf")).toBeNull();
    expect(pdfLink("https://example.com/x.pdf")).toBeNull();
    expect(pdfLink("https://www.cornerstone.com/insights/")).toBeNull();
    expect(pdfLink("https://www.cornerstone.com/x.pdf#javascript")).toBeNull();
    expect(parseFact({ ...row, source_url: "javascript:alert(1)" })?.sourceUrl).toBeNull();
  });

  it("reads a report row and rejects a mismatched id", () => {
    const p = {
      id: "cr-filings-2025-yir",
      family: "cr_filings",
      family_label: "Filings",
      publisher: CR,
      edition: "2025 Year in Review",
      period: "2025",
      title: "Securities Class Action Filings—2025 Year in Review",
      date: "2026-01-28",
      date_basis: "printed on the report",
      pdf_url: "https://www.cornerstone.com/x.pdf",
      landing_url: "https://www.cornerstone.com/insights/reports/x/",
      pages: 44,
      facts: 900,
      status: "facts extracted",
    };
    expect(parseReport({ id: p.id, p })).toMatchObject({ id: p.id, pages: 44, facts: 900 });
    expect(parseReport({ id: "cr-filings-2024-yir", p })).toBeNull();
    expect(parseReport({ id: p.id, p: { ...p, date: "28 January 2026" } })?.date).toBe(
      "28 January 2026",
    );
    expect(parseReport({ id: p.id, p: { ...p, date: "Winter 2026" } })?.date).toBeNull();
  });
});

describe("report dates", () => {
  it("reads ISO days, printed days and upload months", () => {
    expect(reportDateValue("2025-07-28")).toBe(Date.UTC(2025, 6, 28));
    expect(reportDateValue("28 January 2026")).toBe(Date.UTC(2026, 0, 28));
    expect(reportDateValue("July 2026")).toBe(Date.UTC(2026, 6, 1));
    expect(reportDateValue("2025-13-01")).toBeNull();
    expect(reportDateValue("Jan 2026")).toBeNull();
    expect(reportDateValue(null)).toBeNull();
  });
  it("breaks a tie between reports of the same period by date", () => {
    expect(vintageRank({ period: "2020", date: "27 January 2021" })).toBeGreaterThan(
      vintageRank({ period: "2020", date: "2021-01-20" }),
    );
  });
});

describe("display helpers", () => {
  it("writes values in the printed unit", () => {
    expect(unitFormatter("usd_billions").full(694)).toBe("$694 billion");
    expect(unitFormatter("usd_millions").full(14.25)).toBe("$14.3 million");
    expect(unitFormatter("usd_millions").tick(1500)).toBe("$1.5B");
    expect(unitFormatter("usd_millions").tick(40)).toBe("$40M");
    expect(unitFormatter("usd_billions").tick(1500)).toBe("$1,500B");
    expect(unitFormatter("percent").full(18.3)).toBe("18.3%");
    expect(unitFormatter("filings").full(null)).toBe("Not recorded");
    expect(unitWords("usd_billions", "inflation-adjusted, 2025 dollars")).toBe(
      "US$ billions, inflation-adjusted, 2025 dollars",
    );
    expect(unitWords("usd_millions", "not stated")).toBe("US$ millions");
  });

  it("names the publisher of a value", () => {
    expect(reportShort({ publisher: CR, edition: "2025 Year in Review" })).toBe(
      "Cornerstone Research and Stanford Clearinghouse, 2025 Year in Review",
    );
    expect(
      reportShort({ publisher: "NERA Economic Consulting", edition: "2025 Full-Year Review" }),
    ).toBe("NERA, 2025 Full-Year Review");
  });

  it("groups reports by series, newest first, and opens the newest filings report with facts", () => {
    const a = report("cr-filings-2025-yir", "2025", "2026-01-28");
    const b = report("cr-filings-2026-mya", "2026 H1", "2026-07-29", { facts: 0 });
    const c = report("nera-us-2025-fy", "2025", "2026-01-27", {
      family: "nera_us",
      familyLabel: "NERA",
    });
    const g = groupReports([a, b, c]);
    expect(g.map((x) => x.family)).toEqual(["cr_filings", "nera_us"]);
    expect(g[0]!.reports.map((r) => r.id)).toEqual([b.id, a.id]);
    expect(defaultReport([a, b, c])?.id).toBe(a.id);
  });
});

describe("query paths", () => {
  it("reads one series by year from cra_facts, with the breakdown matched exactly", () => {
    const p = decodeURIComponent(
      linePath("filings.sp500_companies_sued_pct", "Sector: All S&P 500 Companies"),
    );
    expect(p).toContain("dataset=eq.cra_facts");
    expect(p).toContain(
      'filters=cs.{"series":["filings.sp500_companies_sued_pct"],"period_type":["year"]}',
    );
    expect(p).toContain("item->profile->>dimension=eq.Sector: All S&P 500 Companies");
    expect(linePath("x", "Sector: All S&P 500 Companies")).toContain("S%26P");
    expect(linePath("filings.class_action_filings", "")).not.toContain("dimension");
  });
  it("reads one report's facts", () => {
    expect(decodeURIComponent(reportFactsPath("cr-filings-2025-yir"))).toContain(
      'dataset=eq.cra_facts&filters=cs.{"report":["cr-filings-2025-yir"]}',
    );
  });
});
