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
  companyKey,
  companyRegulatoryPaths,
  frbActionsPath,
  getCompanyRegulatory,
  matchKeyFor,
  parseAdviser,
  parseAdviserTable,
  parseBdOverview,
  parseBrokerDealer,
  parseFrbAction,
  parseFrbOverview,
} from "./regulatoryRecords.functions";
import { restGet } from "./rest.server";

// Shapes copied from the build files written by scripts/enrichment/regfin/build_regfin.py.
const FRB_ROW = {
  id: "frb:2375",
  source_url: "https://www.federalreserve.gov/newsevents/pressreleases/enforcement20180202a.htm",
  a: {
    id: "2375",
    effective_date: "2018-02-02",
    year: "2018",
    termination_date: "2026-03-04",
    type: "Cease and Desist Order",
    type_family: "Cease-and-desist and consent orders",
    subject: "organization",
    banking_organization: "Wells Fargo & Company, San Francisco, California",
    organizations: [
      {
        as_written: "Wells Fargo & Company, San Francisco, California",
        name: "Wells Fargo & Company",
        location: "San Francisco, California",
        key: "wells fargo and",
        match: {
          cik: "0000072971",
          registrant: "WELLS FARGO & COMPANY/MN",
          method: "exact normalised name (unique)",
        },
      },
    ],
    affiliations: [],
    url: "https://www.federalreserve.gov/newsevents/pressreleases/enforcement20180202a.htm",
    url_label: "Press Release",
    note: "Modification issued on 4/08/2020",
    note_links: [
      {
        label: "Modification",
        url: "https://www.federalreserve.gov/newsevents/pressreleases/enforcement20200408a.htm",
      },
    ],
  },
};

describe("parseFrbAction", () => {
  it("reads a stored action", () => {
    const a = parseFrbAction(FRB_ROW)!;
    expect(a.id).toBe("frb:2375");
    expect(a.year).toBe("2018");
    expect(a.terminationDate).toBe("2026-03-04");
    expect(a.typeFamily).toBe("Cease-and-desist and consent orders");
    expect(a.organizations[0]!.match).toEqual({
      cik: "0000072971",
      registrant: "WELLS FARGO & COMPANY/MN",
    });
    expect(a.noteLinks).toHaveLength(1);
  });

  it("keeps a missing termination date and document link as null, never a placeholder", () => {
    const a = parseFrbAction({
      ...FRB_ROW,
      a: { ...FRB_ROW.a, termination_date: undefined, url: undefined, url_label: undefined },
    })!;
    expect(a.terminationDate).toBeNull();
    expect(a.url).toBeNull();
    expect(a.sourceUrl).toBe(FRB_ROW.source_url);
  });

  it("falls back to the Board search page when the record has no usable source url", () => {
    const a = parseFrbAction({ ...FRB_ROW, source_url: "javascript:alert(1)" })!;
    expect(a.sourceUrl).toBe(
      "https://www.federalreserve.gov/supervisionreg/enforcementactions.htm",
    );
  });

  it("drops non-http links and keeps the unresolved path as text", () => {
    const a = parseFrbAction({
      ...FRB_ROW,
      a: {
        ...FRB_ROW.a,
        url: "javascript:alert(1)",
        url_unresolved: "boarddocs/press/x/default.htm",
        note_links: [{ label: "x", url: "javascript:1" }],
      },
    })!;
    expect(a.url).toBeNull();
    expect(a.urlUnresolved).toBe("boarddocs/press/x/default.htm");
    expect(a.noteLinks).toEqual([]);
  });

  it("drops malformed rows instead of repairing them", () => {
    expect(parseFrbAction({ ...FRB_ROW, id: "frb:x" })).toBeNull();
    expect(
      parseFrbAction({ ...FRB_ROW, a: { ...FRB_ROW.a, effective_date: "02/02/2018" } }),
    ).toBeNull();
    expect(parseFrbAction({ ...FRB_ROW, a: { ...FRB_ROW.a, type_family: "Made up" } })).toBeNull();
    expect(parseFrbAction({ ...FRB_ROW, a: { ...FRB_ROW.a, subject: "other" } })).toBeNull();
    expect(parseFrbAction({ ...FRB_ROW, a: null })).toBeNull();
  });

  it("ignores a company match that is not a 10-digit CIK", () => {
    const org = { ...FRB_ROW.a.organizations[0]!, match: { cik: "72971", registrant: "x" } };
    expect(
      parseFrbAction({ ...FRB_ROW, a: { ...FRB_ROW.a, organizations: [org] } })!.organizations[0]!
        .match,
    ).toBeNull();
  });
});

describe("parseFrbOverview", () => {
  const raw = {
    first_effective_date: "1989-09-25",
    latest_effective_date: "2026-10-08",
    actions: 2898,
    by_year_family: {
      "1989": { "Civil money penalties": 3 },
      "2026": { "Written agreements": 5, "Not a family": 9 },
      bad: { "Civil money penalties": 1 },
    },
    subjects: { organization: 1563, individual: 1335 },
    partial_year: "2026",
    count_definition: "Rows",
  };
  it("keeps valid years and families only", () => {
    const o = parseFrbOverview(raw)!;
    expect(Object.keys(o.byYearFamily)).toEqual(["1989", "2026"]);
    expect(o.byYearFamily["2026"]).toEqual({ "Written agreements": 5 });
    expect(o.subjects).toEqual({ organization: 1563, individual: 1335 });
    expect(o.partialYear).toBe("2026");
  });
  it("is null without dates or counts", () => {
    expect(parseFrbOverview({ ...raw, actions: "many" })).toBeNull();
    expect(parseFrbOverview(null)).toBeNull();
  });
});

describe("broker-dealer and adviser parsers", () => {
  const BD = {
    id: "bd:0000782124",
    source_url:
      "https://www.sec.gov/files/data/broker-dealers/company-information-about-active-broker-dealers/bd100126.txt",
    b: {
      cik: "0000782124",
      name: "J.P. MORGAN SECURITIES LLC",
      file_number: "00815336",
      address1: "383 MADISON AVENUE,",
      address2: "FLOOR 8",
      city: "NEW YORK",
      state: "NY",
      zip: "10179",
      first_listed: "2007-03",
      last_listed: "2026-10",
      months_listed: 223,
      in_latest_file: true,
      latest_file_month: "2026-10",
      listing_url:
        "https://www.sec.gov/files/data/broker-dealers/company-information-about-active-broker-dealers/bd100126.txt",
      name_history: [
        { name: "BEAR STEARNS & CO INC", first: "2007-03", last: "2008-05" },
        { name: "J.P. MORGAN SECURITIES LLC", first: "2008-06", last: "2026-10" },
      ],
    },
  };
  it("parses a broker-dealer and joins address lines without a doubled comma", () => {
    const b = parseBrokerDealer(BD)!;
    expect(b.address).toBe("383 MADISON AVENUE, FLOOR 8");
    expect(b.inLatestFile).toBe(true);
    expect(b.nameHistory).toHaveLength(2);
  });
  it("requires the record id to be bd:<cik>", () => {
    expect(parseBrokerDealer({ ...BD, id: "bd:0000000001" })).toBeNull();
    expect(parseBrokerDealer({ ...BD, b: { ...BD.b, first_listed: "March 2007" } })).toBeNull();
  });
  it("parses an overview and rejects an empty series", () => {
    const ov = parseBdOverview({
      first_month: "2007-03",
      latest_month: "2007-05",
      files: 2,
      missing_months: ["2007-04", "x"],
      series: [
        { month: "2007-03", count: 5892 },
        { month: "2007-05", count: 5800 },
        { month: "bad", count: 1 },
      ],
      unique_ciks: 10,
      in_latest_file: 5,
    })!;
    expect(ov.series).toHaveLength(2);
    expect(ov.missingMonths).toEqual(["2007-04"]);
    expect(
      parseBdOverview({ first_month: "2007-03", latest_month: "2007-05", series: [] }),
    ).toBeNull();
  });

  const IA = {
    id: "ia:105541",
    source_url: "https://www.sec.gov/files/investment/data/other/x/ia100226.zip",
    a: {
      crd: "105541",
      sec_number: "801-1",
      firm_type: "Registered",
      cik: "0000009319",
      legal_name: "BCG SECURITIES, INC.",
      status: "Approved",
      status_effective_date: "1999-11-04",
      main_office: { city: "CHERRY HILL", state: "NJ", address_withheld: true },
      raum_total_usd: 150000000,
      accounts_total: 7,
      disclosure_any: "Y",
      disclosure_yes_items: [{ item: "11C(2)", count: 2 }, { item: "11H(2)" }],
      profile_match: { cik: "0000009319", registrant: "BCG", method: "exact CIK" },
      website: "javascript:alert(1)",
    },
  };
  it("parses an adviser, keeps the withheld-address flag and drops a non-http website", () => {
    const a = parseAdviser(IA)!;
    expect(a.addressWithheld).toBe(true);
    expect(a.website).toBeNull();
    expect(a.regulatoryAumUsd).toBe(150000000);
    expect(a.disclosureYesItems).toEqual([
      { item: "11C(2)", count: 2 },
      { item: "11H(2)", count: null },
    ]);
    expect(a.matchMethod).toBe("exact CIK");
  });
  it("rejects an unknown firm type or a mismatched id", () => {
    expect(parseAdviser({ ...IA, a: { ...IA.a, firm_type: "Other" } })).toBeNull();
    expect(parseAdviser({ ...IA, id: "ia:1" })).toBeNull();
  });
});

describe("parseAdviserTable", () => {
  it("keeps rows whose value count equals the year count, blanks stay null", () => {
    const t = parseAdviserTable({
      tab: "Tab.1.1",
      title: "Number of advisers",
      years: [2000, 2001],
      rows: [
        { labels: ["RIA", "Subtotal"], values: [6551, null] },
        { labels: ["bad"], values: [1] },
      ],
    })!;
    expect(t.rows).toEqual([{ labels: ["RIA", "Subtotal"], values: [6551, null] }]);
    expect(parseAdviserTable({ tab: "Tab.1.1", years: [], rows: [] })).toBeNull();
    expect(parseAdviserTable({ tab: "Sheet1", years: [2000], rows: [] })).toBeNull();
  });
});

describe("companyKey", () => {
  // Expected keys come from scripts/enrichment/regfin/names.py normalize_company (the builders' implementation).
  const PAIRS: [string, string][] = [
    ["Wells Fargo & Company", "wells fargo and"],
    ["WELLS FARGO & COMPANY/MN", "wells fargo and"],
    ["JPMorgan Chase & Co.", "jpmorgan chase and"],
    ["Goldman Sachs Group, Inc.", "goldman sachs group"],
    ["The Goldman Sachs Group, Inc.", "goldman sachs group"],
    ["SEALED AIR CORP/DE", "sealed air"],
    ["SEACOR HOLDINGS INC /NEW/", "seacor holdings"],
    ["Merck & Co., Inc.", "merck and"],
    ["Energy Transfer, LP", "energy transfer lp"],
    ["Energy Transfer Operating, L.P.", "energy transfer operating l p"],
    ["Bank of America, National Association", "bank of america national association"],
    ["U.S. Bancorp", "u s bancorp"],
    ["AT&T Inc.", "at and t"],
    ["Société Générale S.A.", "société générale s a"],
    ["Nestlé S.A.", "nestlé s a"],
    ["BP Capital Markets p.l.c.", "bp capital markets p l c"],
    [
      "American Express Travel Related Services Company, Inc.",
      "american express travel related services",
    ],
    ["M/I HOMES, INC.", "m i homes"],
    ["3M CO", "3m"],
    ["A.B. Smith & Sons", "a b smith and sons"],
    ["  Spaced   Name  Inc  ", "spaced name"],
    ["", ""],
    ["Inc", ""],
    ["The", ""],
  ];
  it.each(PAIRS)("%s -> %s", (name, key) => {
    expect(companyKey(name)).toBe(key);
  });
  it("maps null and undefined to an empty key", () => {
    expect(companyKey(null)).toBe("");
    expect(companyKey(undefined)).toBe("");
  });
});

describe("matchKeyFor", () => {
  const profiles = [
    { id: "0000072971", title: "WELLS FARGO & COMPANY/MN" },
    { id: "0000000002", title: "Twin Corp" },
    { id: "0000000003", title: "Twin Corporation" },
  ];
  it("gives the key for a unique name", () => {
    expect(matchKeyFor("0000072971", profiles)).toEqual({ key: "wells fargo and", note: null });
  });
  it("refuses a key shared by two registrants", () => {
    expect(matchKeyFor("0000000002", profiles)).toEqual({ key: null, note: "shared" });
  });
  it("refuses a CIK without a profile", () => {
    expect(matchKeyFor("0000000009", profiles)).toEqual({ key: null, note: "unknown" });
  });
});

describe("query paths", () => {
  it("builds the Fed list path with containment filters and the listing flag", () => {
    const path = frbActionsPath({
      year: "2018",
      family: "Civil money penalties",
      subject: "organization",
      q: "Wells",
      page: 0,
    });
    expect(path).toContain("dataset=eq.frb_enforcement_actions");
    expect(decodeURIComponent(path.match(/filters=cs\.([^&]+)/)![1]!)).toBe(
      JSON.stringify({
        _listing: ["yes"],
        year: ["2018"],
        type_family: ["Civil money penalties"],
        subject: ["organization"],
      }),
    );
    expect(path).toContain("or=(title.ilike.*Wells*,text.ilike.*Wells*)");
    expect(path.endsWith("order=ordinal.asc")).toBe(true);
  });
  it("omits the search filter for a one-character term and never drops the listing flag", () => {
    const path = frbActionsPath({ q: "a", page: 0 });
    expect(path).not.toContain("or=");
    expect(path).toContain(encodeURIComponent(JSON.stringify({ _listing: ["yes"] })));
  });
  it("queries the CIK for registrations and the name key only when there is one", () => {
    const withKey = companyRegulatoryPaths("0000782124", "wells fargo and");
    expect(decodeURIComponent(withKey.brokerDealers)).toContain('{"company":["0000782124"]}');
    expect(decodeURIComponent(withKey.fedSubject!)).toContain('{"name_key":["wells fargo and"]}');
    expect(decodeURIComponent(withKey.fedAffiliation!)).toContain(
      '{"affiliation_key":["wells fargo and"]}',
    );
    const noKey = companyRegulatoryPaths("0000782124", null);
    expect(noKey.fedSubject).toBeNull();
    expect(noKey.fedAffiliation).toBeNull();
  });
});

describe("getCompanyRegulatory", () => {
  it("matches Fed actions by exact name key and registrations by CIK, in parallel", async () => {
    const get = vi.mocked(restGet);
    get.mockReset();
    get.mockImplementation(async (path: string) => {
      if (path.includes("dataset=eq.company_sec_profiles"))
        return {
          rows: [
            { id: "0000072971", title: "WELLS FARGO & COMPANY/MN" },
            { id: "0000200406", title: "JOHNSON & JOHNSON" },
          ] as never,
          total: 2,
        };
      if (path.includes("name_key")) return { rows: [FRB_ROW] as never, total: 1 };
      if (path.includes("affiliation_key")) return { rows: [] as never, total: 0 };
      return { rows: [] as never, total: 0 };
    });
    const out = await (
      getCompanyRegulatory as unknown as (a: {
        data: { cik: string };
      }) => Promise<Awaited<ReturnType<typeof getCompanyRegulatory>>>
    )({ data: { cik: "0000072971" } });
    expect(out.nameKey).toBe("wells fargo and");
    expect(out.fedSubject.map((a) => a.id)).toEqual(["frb:2375"]);
    expect(out.fedAffiliation).toEqual([]);
    expect(out.brokerDealers).toEqual([]);
    expect(out.totals.fedSubject).toBe(1);
  });

  it("does not query Fed actions for a CIK with no profile", async () => {
    const get = vi.mocked(restGet);
    get.mockReset();
    get.mockImplementation(async (path: string) => {
      if (path.includes("dataset=eq.company_sec_profiles"))
        return { rows: [{ id: "0000200406", title: "JOHNSON & JOHNSON" }] as never, total: 1 };
      return { rows: [] as never, total: 0 };
    });
    const out = await (
      getCompanyRegulatory as unknown as (a: {
        data: { cik: string };
      }) => Promise<Awaited<ReturnType<typeof getCompanyRegulatory>>>
    )({ data: { cik: "0000782124" } });
    expect(out.nameKey).toBeNull();
    expect(out.nameKeyNote).toBe("unknown");
    expect(get.mock.calls.some((c) => String(c[0]).includes("frb_enforcement_actions"))).toBe(
      false,
    );
  });
});
