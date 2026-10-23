import { afterEach, describe, expect, it, vi } from "vitest";

const calls: { path: string; opts: unknown }[] = [];
let respond: (path: string) => { rows: unknown[]; total: number | null } = () => ({
  rows: [],
  total: 0,
});
vi.mock("./rest.server", () => ({
  restGet: vi.fn(async (path: string, opts: unknown) => {
    calls.push({ path, opts });
    return respond(path);
  }),
  ilikeTerm: (q: string) => encodeURIComponent(`*${q}*`),
}));
vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => ({
    handler: (handler: unknown) => handler,
    inputValidator: () => ({ handler: (handler: unknown) => handler }),
  }),
}));

import {
  appLink,
  getAgencyOversight,
  getCompanyCepResolutions,
  getDojOversight,
  getOversightMeta,
  getOversightOverview,
  httpsUrl,
  parseCepResolution,
  parseDatasetMeta,
  parseDojDocument,
  parseOscFile,
  parseOscPublication,
  parseOversightReport,
  parseTrend,
  searchOscFiles,
  searchOversightReports,
  searchTokens,
} from "./oversight.functions";

afterEach(() => {
  calls.length = 0;
  respond = () => ({ rows: [], total: 0 });
});

// Shapes copied from the build files (oversight_reports, oversight_trends, osc_*, doj_*).
const reportRow = {
  id: "ovr:0f1e2d3c4b5a69",
  title: "NASA's Role in the Decadal Survey Process",
  source_url: "https://www.oversight.gov/reports/audit/nasas-role-decadal-survey-process",
  r: {
    date: "2026-10-19",
    year: 2026,
    oig: "National Aeronautics and Space Administration OIG",
    oig_slug: "national-aeronautics-and-space-administration-oig",
    oig_agency_id: "301",
    agency_reviewed: "National Aeronautics and Space Administration",
    reviewed_agency_id: "301",
    type: "Audit",
    location: "Agency-Wide",
    report_number: "IG-27-001",
    recommendations: 8,
    description: "NASA contracts with the National Academies.",
    description_clipped: false,
    url: "https://www.oversight.gov/reports/audit/nasas-role-decadal-survey-process",
    doj_oig_id: null,
  },
};

describe("link and token helpers", () => {
  it("passes only https links", () => {
    expect(httpsUrl("https://www.oversight.gov/reports/x")).toBe(
      "https://www.oversight.gov/reports/x",
    );
    expect(httpsUrl("http://www.oversight.gov/")).toBeNull();
    expect(httpsUrl("javascript:alert(1)")).toBeNull();
    expect(httpsUrl("https://x.gov/a b")).toBeNull();
    expect(httpsUrl(null)).toBeNull();
  });

  it("passes only in-app links of known shapes", () => {
    expect(appLink("/agencies/268")).toBe("/agencies/268");
    expect(appLink("/companies/0000833444")).toBe("/companies/0000833444");
    expect(appLink("/records/doj_oig_reports/dojoig:audit-x")).toBe(
      "/records/doj_oig_reports/dojoig:audit-x",
    );
    expect(appLink("/companies/833444")).toBeNull();
    expect(appLink("//evil.example/x")).toBeNull();
    expect(appLink("/agencies/../x")).toBeNull();
  });

  it("splits a search into at most six words of two or more characters", () => {
    expect(searchTokens("a  grants,fraud (x) of")).toEqual(["grants", "fraud", "of"]);
    expect(searchTokens("one two three four five six seven")).toHaveLength(6);
    expect(searchTokens("   ")).toEqual([]);
  });
});

describe("parseOversightReport", () => {
  it("reads a stored row", () => {
    expect(parseOversightReport(reportRow)).toMatchObject({
      id: "ovr:0f1e2d3c4b5a69",
      date: "2026-10-19",
      year: 2026,
      oig: "National Aeronautics and Space Administration OIG",
      reportNumber: "IG-27-001",
      recommendations: 8,
      oigAgencyId: "301",
      dojOigId: null,
    });
  });

  it("keeps a stated zero and a missing count apart", () => {
    expect(
      parseOversightReport({ ...reportRow, r: { ...reportRow.r, recommendations: 0 } })
        ?.recommendations,
    ).toBe(0);
    expect(
      parseOversightReport({ ...reportRow, r: { ...reportRow.r, recommendations: null } })
        ?.recommendations,
    ).toBeNull();
  });

  it("drops malformed rows instead of repairing them", () => {
    expect(parseOversightReport({ ...reportRow, id: "bad id!" })).toBeNull();
    expect(parseOversightReport({ ...reportRow, title: "" })).toBeNull();
    expect(parseOversightReport({ ...reportRow, r: null })).toBeNull();
    expect(
      parseOversightReport({
        ...reportRow,
        source_url: "ftp://x",
        r: { ...reportRow.r, url: "http://y" },
      }),
    ).toBeNull();
  });

  it("rejects a non-ISO date and a non-numeric agency id", () => {
    const p = parseOversightReport({
      ...reportRow,
      r: { ...reportRow.r, date: "19/10/2026", oig_agency_id: "../1" },
    });
    expect(p?.date).toBeNull();
    expect(p?.oigAgencyId).toBeNull();
  });
});

describe("parseTrend", () => {
  const body = {
    scope: "oig",
    name: "Department of Justice OIG",
    oig_slug: "department-justice-oig",
    agency_id: "268",
    agency_title: "Justice Department",
    as_of: "2026-10-19",
    totals: {
      reports: 9,
      dated: 8,
      undated: 1,
      first_date: "2024-02-01",
      last_date: "2026-10-19",
      recs: 12,
      recs_reports: 5,
      types: { Audit: 5 },
    },
    years: [
      { year: 2026, reports: 5, types: { Audit: 3 }, recs: 5, recs_reports: 3 },
      { year: 2024, reports: 3, types: { Audit: 2 }, recs: 7, recs_reports: 2 },
      { year: "bad", reports: 3 },
    ],
    money: {
      source: "DOJ OIG report pages (oig.justice.gov), every report read",
      source_url: "https://oig.justice.gov/reports",
      excludes: ["Semiannual Report"],
      note: "As stated.",
      years: [
        {
          year: 2024,
          reports: 3,
          questioned_reports: 2,
          questioned_costs: 1500,
          better_use_reports: 0,
          funds_better_use: 0,
        },
      ],
    },
    oigs: [
      {
        name: "Department of Justice OIG",
        slug: "department-justice-oig",
        agency_id: "268",
        reports: 9,
      },
      { name: "x" },
    ],
  };

  it("reads totals, sorts years and keeps the money block", () => {
    const t = parseTrend(body)!;
    expect(t.totals.recs).toBe(12);
    expect(t.years.map((y) => y.year)).toEqual([2024, 2026]);
    expect(t.years[0]).toMatchObject({ recs: 7, recsReports: 2 });
    expect(t.money?.years[0]).toMatchObject({ questionedReports: 2, questionedCosts: 1500 });
    expect(t.money?.sourceUrl).toBe("https://oig.justice.gov/reports");
    expect(t.oigs).toHaveLength(1);
    expect(t.agencyId).toBe("268");
  });

  it("returns null for an unknown scope or missing totals", () => {
    expect(parseTrend({ ...body, scope: "x" })).toBeNull();
    expect(parseTrend({ ...body, totals: null })).toBeNull();
    expect(parseTrend(null)).toBeNull();
  });

  it("has no money block when none is stored", () => {
    expect(parseTrend({ ...body, money: undefined })?.money).toBeNull();
  });
});

describe("parseDatasetMeta", () => {
  it("reads filter options and the source facts", () => {
    const m = parseDatasetMeta({
      id: "oversight_reports",
      m: {
        listing: {
          total: 36309,
          filters: [
            { name: "q", type: "search", label: "Search" },
            {
              name: "type",
              type: "select",
              label: "Report type",
              options: [
                { label: "Audit", value: "Audit" },
                { label: "", value: "x" },
              ],
            },
          ],
        },
        summary: {
          source_page: "https://www.oversight.gov/reports/federal",
          coverage: "36,309 reports",
          as_of: "2026-10-22",
        },
      },
    })!;
    expect(m.records).toBe(36309);
    expect(m.filters["type"]).toEqual([{ value: "Audit", label: "Audit" }]);
    expect(m.sourcePage).toBe("https://www.oversight.gov/reports/federal");
    expect(m.asOf).toBe("2026-10-22");
    expect(parseDatasetMeta({ id: "x", m: null })).toBeNull();
  });
});

describe("OSC and DOJ rows", () => {
  it("reads a public file with only https documents", () => {
    const f = parseOscFile({
      id: "oscdi:di-25-001991",
      source_url: "https://www.osc.gov/case/di-25-001991/",
      b: {
        number: "DI-25-001991",
        agency: "Veterans Affairs",
        location: "Phoenix, Arizona",
        date_closed: "2026-10-22",
        results: ["Partially substantiated"],
        files: [
          { label: "Agency Report", url: "https://www.osc.gov/a.pdf" },
          { label: "Bad", url: "http://x" },
        ],
        url: "https://www.osc.gov/case/di-25-001991/",
      },
    })!;
    expect(f.files).toEqual([{ label: "Agency Report", url: "https://www.osc.gov/a.pdf" }]);
    expect(f.dateClosed).toBe("2026-10-22");
    expect(parseOscFile({ id: "x", b: {} })).toBeNull();
  });

  it("reads publications and keeps the kind label", () => {
    const p = parseOscPublication({
      id: "oscpub:1",
      source_url: "https://www.osc.gov/news/x/",
      b: {
        kind: "press_release",
        kind_label: "Press release",
        title: "OSC Announces",
        tags: ["hatch act"],
        date: "2026-09-30",
        year: 2026,
        url: "https://www.osc.gov/news/x/",
      },
    })!;
    expect(p).toMatchObject({
      kind: "press_release",
      kindLabel: "Press release",
      tags: ["hatch act"],
      year: 2026,
    });
    expect(
      parseOscPublication({
        id: "oscpub:2",
        source_url: "https://www.osc.gov/x",
        b: { title: "T" },
      }),
    ).toBeNull();
  });

  it("reads a CEP resolution and accepts only a 10-digit company key", () => {
    const base = {
      id: "cep:1",
      source_url: "https://www.justice.gov/media/1/dl",
      b: {
        label: "In re: Akamai Technologies, Inc.",
        company: "Akamai Technologies, Inc.",
        date: "2016-06-06",
        date_text: "6/6/2016",
        url: "https://www.justice.gov/media/1/dl",
        company_cik: "0001086222",
      },
    };
    expect(parseCepResolution(base)?.companyCik).toBe("0001086222");
    expect(
      parseCepResolution({ ...base, b: { ...base.b, company_cik: "1086222" } })?.companyCik,
    ).toBeNull();
    expect(parseCepResolution({ ...base, b: { ...base.b, label: "" } })).toBeNull();
  });

  it("reads a DOJ index document", () => {
    const d = parseDojDocument({
      id: "dojdoc:1",
      source_url: "https://www.justice.gov/doj/x",
      b: {
        kind: "budget",
        group: "Agency Financial Reports",
        title: "FY 2025 Agency Financial Report",
        year: 2025,
        url: "https://www.justice.gov/doj/x",
      },
    });
    expect(d).toMatchObject({ kind: "budget", year: 2025, entity: null });
    expect(
      parseDojDocument({
        id: "dojdoc:2",
        source_url: "javascript:x",
        b: { kind: "budget", title: "T" },
      }),
    ).toBeNull();
  });
});

describe("server functions", () => {
  const call = (fn: unknown, data: unknown) =>
    (fn as (a: { data: unknown }) => Promise<unknown>)({ data });

  it("searches reports with exact filters, text words and the stored order", async () => {
    respond = () => ({ rows: [reportRow], total: 1 });
    const out = (await call(searchOversightReports, {
      q: "decadal survey",
      oig: "National Aeronautics and Space Administration OIG",
      type: "Audit",
      year: "2026",
      page: 2,
    })) as { reports: unknown[]; total: number; pageSize: number };
    expect(out.reports).toHaveLength(1);
    expect(out.total).toBe(1);
    const c = calls[0]!;
    expect(c.path).toContain("dataset=eq.oversight_reports");
    expect(decodeURIComponent(c.path)).toContain(
      'filters=cs.{"oig":["National Aeronautics and Space Administration OIG"],"type":["Audit"],"year":["2026"]}',
    );
    expect(c.path).toContain("text=ilike.*decadal*");
    expect(c.path).toContain("text=ilike.*survey*");
    expect(c.path.endsWith("order=ordinal.asc")).toBe(true);
    expect(c.opts).toEqual({ count: true, range: [50, 74] });
  });

  it("does not add a filter that was not asked for", async () => {
    await call(searchOversightReports, { q: "", oig: "", type: "", year: "", page: 0 });
    expect(calls[0]!.path).not.toContain("filters=");
    expect(calls[0]!.path).not.toContain("text=ilike");
  });

  it("reads the agency panel by exact agency id", async () => {
    respond = (path) =>
      path.includes("oversight_trends")
        ? {
            rows: [
              {
                t: {
                  scope: "oig",
                  name: "Department of Justice OIG",
                  totals: { reports: 3 },
                  years: [],
                },
              },
            ],
            total: null,
          }
        : { rows: [reportRow], total: 120 };
    const out = (await call(getAgencyOversight, { agencyId: "268" })) as {
      trend: { name: string };
      reports: unknown[];
      total: number;
    };
    expect(out.trend.name).toBe("Department of Justice OIG");
    expect(out.total).toBe(120);
    const paths = calls.map((c) => decodeURIComponent(c.path));
    expect(
      paths.some(
        (p) =>
          p.includes("dataset=eq.oversight_trends") &&
          p.includes('filters=cs.{"agency_id":["268"]}'),
      ),
    ).toBe(true);
    expect(
      paths.some(
        (p) =>
          p.includes("dataset=eq.oversight_reports") &&
          p.includes('filters=cs.{"oig_agency":["268"]}'),
      ),
    ).toBe(true);
  });

  it("returns no trend for an agency without a matched OIG", async () => {
    const out = (await call(getAgencyOversight, { agencyId: "999" })) as {
      trend: unknown;
      reports: unknown[];
    };
    expect(out.trend).toBeNull();
    expect(out.reports).toEqual([]);
  });

  it("reads the national overview, the facet metadata and the DOJ lists", async () => {
    respond = (path) => {
      if (path.includes("id=eq.national"))
        return {
          rows: [{ t: { scope: "national", name: "All OIGs", totals: { reports: 5 }, years: [] } }],
          total: null,
        };
      if (path.includes("corpus_datasets"))
        return {
          rows: [
            { id: "oversight_reports", m: { listing: { total: 5, filters: [] }, summary: {} } },
          ],
          total: null,
        };
      return { rows: [], total: 0 };
    };
    expect(((await call(getOversightOverview, undefined)) as { scope: string }).scope).toBe(
      "national",
    );
    expect(Object.keys((await call(getOversightMeta, undefined)) as object)).toEqual([
      "oversight_reports",
    ]);
    expect(await call(getDojOversight, undefined)).toEqual({ resolutions: [], documents: [] });
  });

  it("looks up company resolutions by the 10-digit key only", async () => {
    await call(getCompanyCepResolutions, { cik: "0001086222" });
    expect(decodeURIComponent(calls[0]!.path)).toContain('filters=cs.{"company":["0001086222"]}');
  });

  it("filters OSC files by agency as OSC lists it", async () => {
    await call(searchOscFiles, { q: "", a: "Veterans Affairs", year: "2024", page: 0 });
    expect(decodeURIComponent(calls[0]!.path)).toContain(
      'filters=cs.{"agency":["Veterans Affairs"],"year":["2024"]}',
    );
  });
});
