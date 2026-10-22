import { describe, expect, it, vi } from "vitest";

vi.mock("./rest.server", () => ({
  restGet: vi.fn(),
  ilikeTerm: (q: string) => encodeURIComponent(`*${q.replace(/[*,()%]/g, " ").trim()}*`),
}));
vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => ({
    handler: (handler: unknown) => handler,
    inputValidator: () => ({ handler: (handler: unknown) => handler }),
  }),
}));

import {
  dojReleasesPath,
  ftcCasesPath,
  parseDojOverview,
  parseDojRelease,
  parseFacts,
  parseFtcAction,
  parseFtcCase,
  parseOfficialSettlement,
  parseSecAction,
  secActionsPath,
  webUrl,
} from "./enforcementActions.functions";

// Shapes copied from the build files written by scripts/enrichment/enforcement_actions/*.
const OVERVIEW = {
  partitions: [
    { dataset: "doj_press_releases_2025", year: "2025", records: 18000 },
    { dataset: "doj_press_releases_2009", year: "2009", records: 4100 },
    { dataset: "evil; drop table", year: "2010", records: 1 },
    { dataset: "doj_press_releases_2011", year: "11", records: 3 },
  ],
  total: 22100,
  components: [{ name: "Civil Division", count: 900 }, { name: "", count: 3 }, { name: "x" }],
  topics: [{ name: "False Claims Act", count: 400 }],
  by_year: [
    { year: "2025", count: 18000, amount: { "1b_plus": 4, junk: 9, none: 100 } },
    { year: "bad", count: 1 },
  ],
  checks: { values_checked: 258302, span_failures: 0, releases: 22100 },
};

const RELEASE = {
  id: "doj-pr:20797307-3c80-4d88-bfff-6e75cb26144e",
  title: "Wells Fargo Bank Agrees to Pay $1.2 Billion",
  source_url: "https://www.justice.gov/opa/pr/x",
  r: {
    date: "2016-04-08",
    url: "https://www.justice.gov/opa/pr/x",
    number: "16-420",
    components: ["Civil Division", 7],
    topics: ["Mortgage Fraud"],
    amounts: [
      {
        as_written: "$1.2 billion",
        value_usd: 1.2e9,
        keyword: "settlement",
        sentence: "Wells Fargo agreed to pay $1.2 billion.",
      },
      { as_written: "1.2 billion", value_usd: 1 },
    ],
    amounts_total: 3,
    max_resolution_amount_usd: 1.2e9,
    statutes: [{ cite: "False Claims Act" }, { nope: 1 }],
    dockets: [{ as_written: "1:16-cv-03499" }],
    courts: [
      { as_written: "U.S. District Court for the Southern District of New York", court_id: "nysd" },
      { as_written: "U.S. District Court for the Central District of Texas", court_id: "BAD ID!" },
    ],
    parties: [{ as_written: "Wells Fargo Bank", kind: "organization (suffix in name)" }],
    companies: [
      { cik: "0000072971", registrant: "WELLS FARGO & COMPANY/MN", as_written: "Wells Fargo" },
      { cik: "72971", registrant: "short", as_written: "x" },
    ],
    office_state: "ny",
  },
};

describe("parseDojOverview", () => {
  it("keeps valid partitions, sorted, and drops malformed values", () => {
    const o = parseDojOverview(OVERVIEW)!;
    expect(o.partitions.map((p) => p.dataset)).toEqual([
      "doj_press_releases_2009",
      "doj_press_releases_2025",
    ]);
    expect(o.years).toEqual(["2009", "2025"]);
    expect(o.components).toEqual([{ name: "Civil Division", count: 900 }]);
    expect(o.byYear).toEqual([{ year: "2025", count: 18000, amount: { "1b_plus": 4, none: 100 } }]);
    expect(o.checks).toEqual({ valuesChecked: 258302, spanFailures: 0, releases: 22100 });
  });
  it("returns null without any valid partition", () => {
    expect(
      parseDojOverview({ partitions: [{ dataset: "x", year: "2020", records: 1 }] }),
    ).toBeNull();
    expect(parseDojOverview(null)).toBeNull();
  });
});

describe("parseDojRelease", () => {
  it("validates nested values and drops malformed ones", () => {
    const r = parseDojRelease(RELEASE, "doj_press_releases_2016")!;
    expect(r.components).toEqual(["Civil Division"]);
    expect(r.amounts).toHaveLength(1);
    expect(r.amounts[0]!.valueUsd).toBe(1.2e9);
    expect(r.statutes).toEqual(["False Claims Act"]);
    expect(r.courts).toEqual([
      { asWritten: "U.S. District Court for the Southern District of New York", courtId: "nysd" },
      { asWritten: "U.S. District Court for the Central District of Texas", courtId: null },
    ]);
    expect(r.companies).toEqual([
      { cik: "0000072971", registrant: "WELLS FARGO & COMPANY/MN", asWritten: "Wells Fargo" },
    ]);
    expect(r.officeState).toBeNull();
    expect(r.url).toBe("https://www.justice.gov/opa/pr/x");
  });
  it("rejects rows without a DOJ id or title", () => {
    expect(parseDojRelease({ ...RELEASE, id: "x" }, "d")).toBeNull();
    expect(parseDojRelease({ ...RELEASE, title: "" }, "d")).toBeNull();
  });
  it("drops non-web links", () => {
    expect(
      parseDojRelease(
        { ...RELEASE, source_url: "javascript:alert(1)", r: { ...RELEASE.r, url: "ftp://x" } },
        "d",
      )!.url,
    ).toBeNull();
    expect(webUrl("https://www.ftc.gov/a")).toBe("https://www.ftc.gov/a");
    expect(webUrl("/courts/nysd")).toBeNull();
  });
});

describe("query paths", () => {
  it("builds exact-containment filters and a sanitised search", () => {
    const path = decodeURIComponent(
      dojReleasesPath("doj_press_releases_2024", {
        year: "2024",
        component: "Civil Division",
        amount: "1b_plus",
        q: "a,b(c)",
        page: 0,
      }),
    );
    expect(path).toContain("dataset=eq.doj_press_releases_2024");
    expect(path).toContain('filters=cs.{"component":["Civil Division"],"amount":["1b_plus"]}');
    expect(path).toContain("or=(title.ilike.*a b c*,text.ilike.*a b c*)");
    expect(path).toContain("order=ordinal.asc");
  });
  it("omits filters and short searches", () => {
    const path = dojReleasesPath("doj_press_releases_2024", { year: "2024", q: "a", page: 0 });
    expect(path).not.toContain("filters=");
    expect(path).not.toContain("or=(");
  });
  it("FTC case and SEC paths carry only known filters", () => {
    expect(decodeURIComponent(ftcCasesPath({ actionType: "Federal", page: 0 }))).toContain(
      'filters=cs.{"action_type":["Federal"]}',
    );
    expect(
      decodeURIComponent(secActionsPath({ type: "litigation_release", court: "nysd", page: 0 })),
    ).toContain('filters=cs.{"type":["litigation_release"],"court":["nysd"]}');
  });
});

describe("FTC parsers", () => {
  it("parses a data-set action and keeps only valid case ids", () => {
    const a = parseFtcAction({
      id: "ftc-action:bcp_penalty:abc",
      source_url: "https://www.ftc.gov/system/files/x.xlsx",
      a: {
        kind: "bcp_penalty",
        name: "Mazda Motor of America, Inc.",
        date: "1999-10-04",
        ordered_amount: 4050000,
        case_ids: ["ftc-case:ok-1", "bad id"],
      },
    })!;
    expect(a.orderedAmount).toBe(4050000);
    expect(a.caseIds).toEqual(["ftc-case:ok-1"]);
    expect(parseFtcAction({ id: "ftc-action:x", a: { kind: "other" } })).toBeNull();
  });
  it("withholds documents count when the case page was not read", () => {
    const c = parseFtcCase({
      id: "ftc-case:161-0001-vyera-pharmaceuticals-llc",
      c: {
        name: "Vyera Pharmaceuticals, LLC",
        page_read: false,
        documents_total: 0,
        documents: [{ title: "x", url: "/rel" }],
      },
    })!;
    expect(c.documentsTotal).toBeNull();
    expect(c.documents).toEqual([]);
    expect(parseFtcCase({ id: "bad", c: { name: "x" } })).toBeNull();
  });
});

describe("parseSecAction", () => {
  it("parses a litigation release", () => {
    const s = parseSecAction({
      id: "sec-lr:LR-26675",
      s: {
        type: "Litigation release",
        release_number: "LR-26675",
        date: "2026-10-20",
        respondents: "Terrance P. Berland and David Michael Scalzo",
        civil_actions: [{ as_written: "26-cv-02430" }],
        courts: [{ as_written: "M.D. Fla.", court_id: "flmd" }],
        text_read: true,
      },
    })!;
    expect(s.civilActions).toEqual(["26-cv-02430"]);
    expect(s.courts[0]!.courtId).toBe("flmd");
  });
  it("rejects unknown types", () => {
    expect(
      parseSecAction({
        id: "sec-lr:1",
        s: { type: "Speech", release_number: "1", respondents: "x" },
      }),
    ).toBeNull();
  });
});

describe("parseOfficialSettlement", () => {
  const base = {
    id: "settle:amazon-return-policy-settlement",
    source_url: "https://www.returnsettlement.com/",
    s: {
      name: "Amazon Return Policy Settlement",
      name_check: "all party words",
      deadline: { date: "2026-12-01", status: "confirmed", as_written: "December 1, 2026" },
      amounts: [{ page_as_written: "$309.5 million", value_usd: 309500000, status: "confirmed" }],
      facts_confirmed: ["deadline", "amount", "invented"],
      claim_url: "https://www.returnsettlement.com/submit-claim",
      discovery: { url: "https://settlesignal.com/settlements/amazon-return-policy-settlement/" },
    },
  };
  it("keeps confirmed facts only", () => {
    const s = parseOfficialSettlement(base)!;
    expect(s.confirmed).toEqual(["deadline", "amount"]);
    expect(s.deadline).toBe("2026-12-01");
    expect(s.amounts[0]!.asWritten).toBe("$309.5 million");
  });
  it("hides a deadline that was not confirmed and drops rows with no confirmed fact", () => {
    const s = parseOfficialSettlement({
      ...base,
      s: { ...base.s, deadline: { date: "2026-12-01", status: "not_found" } },
    })!;
    expect(s.deadline).toBeNull();
    expect(parseOfficialSettlement({ ...base, s: { ...base.s, facts_confirmed: [] } })).toBeNull();
  });
});

describe("parseFacts", () => {
  it("keeps string pairs only", () => {
    expect(parseFacts([["Date", "2020-01-01"], ["x"], [1, 2], "y"])).toEqual([
      ["Date", "2020-01-01"],
    ]);
  });
});
