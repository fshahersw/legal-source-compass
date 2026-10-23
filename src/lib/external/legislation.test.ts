import { describe, expect, it } from "vitest";
import {
  displayCitation,
  federalSearchPath,
  ftsQuery,
  httpUrl,
  ordinal,
  parseBillCitation,
  parseCrsHit,
  parseFacetOptions,
  parseFederalBill,
  parseFederalHit,
  parseLawCitation,
  parseStateBill,
  parseStateHit,
  parseStateIdentifier,
  stateSearchPath,
} from "./legislation";

const decode = (p: string) => decodeURIComponent(p);

describe("citations", () => {
  it("formats ordinals and display citations", () => {
    expect(ordinal(108)).toBe("108th");
    expect(ordinal(111)).toBe("111th");
    expect(ordinal(112)).toBe("112th");
    expect(ordinal(113)).toBe("113th");
    expect(ordinal(101)).toBe("101st");
    expect(ordinal(102)).toBe("102nd");
    expect(displayCitation("hr", "1234", 118)).toBe("H.R. 1234, 118th Congress");
    expect(displayCitation("sjres", "5", 119)).toBe("S.J.Res. 5, 119th Congress");
  });

  it("parses bill citations in common spellings", () => {
    expect(parseBillCitation("H.R. 3935")).toEqual({ type: "hr", number: "3935" });
    expect(parseBillCitation("hr3935")).toEqual({ type: "hr", number: "3935" });
    expect(parseBillCitation("HR 0042")).toEqual({ type: "hr", number: "42" });
    expect(parseBillCitation("S. 1")).toEqual({ type: "s", number: "1" });
    expect(parseBillCitation("S.J.Res. 12")).toEqual({ type: "sjres", number: "12" });
    expect(parseBillCitation("h con res 5")).toEqual({ type: "hconres", number: "5" });
    expect(parseBillCitation("H.Res. 5")).toEqual({ type: "hres", number: "5" });
    expect(parseBillCitation("tax 2026")).toBeNull();
    expect(parseBillCitation("FAA reauthorization")).toBeNull();
  });

  it("parses public law citations", () => {
    expect(parseLawCitation("Public Law 118-63")).toBe("118-63");
    expect(parseLawCitation("Pub. L. 118–63")).toBe("118-63");
    expect(parseLawCitation("P.L. 117-2")).toBe("117-2");
    expect(parseLawCitation("118-63")).toBeNull();
  });

  it("parses state identifiers", () => {
    expect(parseStateIdentifier("AB 1")).toBe("AB1");
    expect(parseStateIdentifier("hb-1001")).toBe("HB1001");
    expect(parseStateIdentifier("LB 5A")).toBe("LB5A");
    expect(parseStateIdentifier("minimum wage")).toBeNull();
  });
});

describe("search paths", () => {
  it("uses exact filters for a bill citation and the full-text index for words", () => {
    const cite = federalSearchPath({ q: "H.R. 3935", congress: "118" });
    expect(cite.mode).toBe("citation");
    expect(decode(cite.path)).toContain(
      'filters=cs.{"congress":["118"],"type":["hr"],"number":["3935"]}',
    );
    expect(cite.path).not.toContain("search_vector");
    const words = federalSearchPath({ q: "aviation safety", status: "became_law" });
    expect(words.mode).toBe("words");
    expect(decode(words.path)).toContain("search_vector=fts(simple).aviation:*&safety:*");
    expect(decode(words.path)).toContain('"status":["became_law"]');
    const law = federalSearchPath({ q: "Public Law 118-63" });
    expect(law.mode).toBe("law");
    expect(decode(law.path)).toContain('"law":["118-63"]');
  });

  it("drops filter values that are not of the expected shape", () => {
    const p = decode(federalSearchPath({ congress: "99", type: "xx", status: "bogus" }).path);
    expect(p).not.toContain("filters=");
    expect(p).toContain("dataset=eq.congress_bills");
    expect(p).toContain("order=ordinal.asc");
  });

  it("builds state paths with identifier and word modes", () => {
    const id = stateSearchPath({ q: "AB 1", state: "CA" });
    expect(id.mode).toBe("identifier");
    expect(decode(id.path)).toContain('{"state":["CA"],"ident":["AB1"]}');
    const words = stateSearchPath({ q: "AB 1", state: "CA" }, false);
    expect(words.mode).toBe("words");
    expect(decode(words.path)).toContain("fts(simple).ab:*&1:*");
    expect(ftsQuery("  ")).toBeNull();
  });
});

const fedCells = {
  id: "118-hr-3935",
  title: "H.R. 3935, 118th Congress: FAA Reauthorization Act of 2024",
  source_url: "https://www.congress.gov/bill/118th-congress/house-bill/3935",
  c: {
    citation: "H.R. 3935, 118th Congress",
    congress: 118,
    type: "hr",
    number: "3935",
    title: "FAA Reauthorization Act of 2024",
    sponsor: "Rep. Graves, Sam [R-MO-6]",
    introduced: "2023-06-09",
    latest_action_date: "2024-05-16",
    latest_action: "Became Public Law No: 118-63.",
    status: "became_law",
    status_label: "Became law",
    law: "Public Law 118-63",
    policy_area: "Transportation and Public Works",
    cosponsors: 3,
  },
};

describe("federal rows", () => {
  it("parses a list row", () => {
    const h = parseFederalHit(fedCells)!;
    expect(h.citation).toBe("H.R. 3935, 118th Congress");
    expect(h.status).toBe("became_law");
    expect(h.law).toBe("Public Law 118-63");
  });

  it("rejects a row whose id does not match its cells", () => {
    expect(parseFederalHit({ ...fedCells, id: "118-hr-1" })).toBeNull();
    expect(parseFederalHit({ ...fedCells, c: { ...fedCells.c, type: "xx" } })).toBeNull();
  });

  it("parses the full bill and keeps only safe links", () => {
    const bill = parseFederalBill("118-hr-3935", {
      congress: 118,
      type: "hr",
      number: "3935",
      titles: {
        display: "FAA Reauthorization Act of 2024",
        official: [{ type: "Official Title as Introduced", title: "To amend title 49 ..." }],
        short: [],
        other: [],
      },
      sponsors: [
        { name: "Rep. Graves, Sam [R-MO-6]", bioguide: "G000546", party: "R", state: "MO" },
      ],
      cosponsors: [{ name: "Rep. Larsen, Rick [D-WA-2]", original: true, date: "2023-06-09" }],
      cosponsorCount: 1,
      actions: [
        { d: "2024-05-16", x: "Became Public Law No: 118-63.", c: "36000", v: [0] },
        { d: "2023-06-09", x: "Introduced in House", c: "1000", ch: "House" },
        { d: "2023-06-09" },
      ],
      votes: [
        { chamber: "House", date: "2023-07-20T14:00:00Z", roll: "362", url: "javascript:alert(1)" },
      ],
      related: [
        {
          congress: 118,
          type: "s",
          number: "1939",
          citation: "S. 1939, 118th Congress",
          href: "/law/legislation/federal/118/s/1939",
        },
        { congress: 118, type: "hr", number: "1", href: "https://evil.example/x" },
      ],
      laws: [
        {
          type: "Public Law",
          number: "118-63",
          label: "Public Law 118-63",
          govinfo: "https://www.govinfo.gov/link/plaw/118/public/63",
          resolution: { status: "resolved", href: "/records/public_laws_enacted/stat-138-1025" },
        },
        {
          type: "Public Law",
          number: "118-64",
          resolution: { status: "resolved", href: "/admin/x" },
        },
      ],
      reports: [
        { citation: "H. Rept. 118-138", url: "https://www.govinfo.gov/link/crpt/118/hrpt/138" },
      ],
      summary: {
        version: "Introduced in House",
        date: "2023-06-09",
        blocks: [
          { k: "p", x: "This bill ..." },
          { k: "li", x: "item" },
        ],
      },
      milestones: {
        introduced: { date: "2023-06-09", evidence: "introducedDate" },
        passed_senate: { date: "2024-05-09", vitiated: "2024-05-10" },
      },
      status: "became_law",
      statusLabel: "Became law",
      source: {
        congressGov: "https://www.congress.gov/bill/118th-congress/house-bill/3935",
        billStatusXml:
          "https://www.govinfo.gov/bulkdata/BILLSTATUS/118/hr/BILLSTATUS-118hr3935.xml",
      },
    })!;
    expect(bill.title).toBe("FAA Reauthorization Act of 2024");
    expect(bill.actions).toHaveLength(2);
    expect(bill.votes[0]!.url).toBeNull();
    expect(bill.votes[0]!.date).toBe("2023-07-20");
    expect(bill.related[0]!.target).toEqual({ congress: "118", type: "s", number: "1939" });
    expect(bill.related[1]!.target).toBeNull();
    expect(bill.laws[0]!.recordId).toBe("stat-138-1025");
    expect(bill.laws[1]!.recordId).toBeNull();
    expect(bill.summary!.blocks.map((b) => b.kind)).toEqual(["p", "li"]);
    expect(bill.milestones.find((m) => m.key === "passed_senate")!.vitiated).toBe("2024-05-10");
    expect(bill.milestones.find((m) => m.key === "reported")!.date).toBeNull();
    expect(parseFederalBill("118-hr-1", { congress: 118, type: "hr", number: "3935" })).toBeNull();
  });
});

describe("state rows", () => {
  const row = {
    id: "ca-20252026-ab1",
    source_url: "https://leginfo.legislature.ca.gov/faces/billNavClient.xhtml?bill_id=202520260AB1",
    c: {
      state: "CA",
      session: "20252026",
      session_name: "2025-2026 Regular Session",
      identifier: "AB 1",
      title: "Budget Act of 2025",
      sponsor: "Gabriel",
      latest_action_date: "2025-06-27",
      status: "became_law",
      status_label: "Became law",
    },
  };
  it("parses a list row and rejects malformed ids", () => {
    expect(parseStateHit(row)!.identifier).toBe("AB 1");
    expect(parseStateHit({ ...row, id: "CA AB 1" })).toBeNull();
    expect(parseStateHit({ ...row, c: { ...row.c, state: "California" } })).toBeNull();
  });

  it("parses a state bill and requires the id to match the state", () => {
    const b = parseStateBill(
      "ca-20252026-ab1",
      {
        state: "CA",
        stateName: "California",
        identifier: "AB 1",
        title: "Budget Act of 2025",
        session: { id: "20252026", name: "2025-2026 Regular Session", role: "current" },
        sponsors: [{ name: "Gabriel", primary: true, classification: "primary" }],
        versions: [
          {
            note: "Introduced",
            links: [
              { url: "https://leginfo.legislature.ca.gov/x.pdf", mediaType: "application/pdf" },
              { url: "ftp://x" },
            ],
          },
        ],
        milestones: {
          became_law: { date: "2025-06-27", description: "Chaptered by Secretary of State" },
        },
        officialSources: [
          {
            url: "https://leginfo.legislature.ca.gov/faces/billNavClient.xhtml?bill_id=202520260AB1",
          },
        ],
        status: "became_law",
      },
      row.source_url,
    )!;
    expect(b.versions[0]!.links).toHaveLength(1);
    expect(b.milestones.find((m) => m.key === "became_law")!.date).toBe("2025-06-27");
    expect(
      parseStateBill(
        "ny-20252026-ab1",
        { state: "CA", identifier: "AB 1", session: { id: "x" } },
        null,
      ),
    ).toBeNull();
  });
});

describe("crs and facets", () => {
  it("parses CRS rows and facet options", () => {
    expect(
      parseCrsHit({
        id: "R49359",
        source_url: "https://www.congress.gov/crs-product/R49359",
        c: { title: "College Sports", type: "Reports" },
      })!.url,
    ).toBe("https://www.congress.gov/crs-product/R49359");
    expect(parseCrsHit({ id: "../x", c: {} })).toBeNull();
    const opts = parseFacetOptions(
      {
        filters: [
          {
            name: "session",
            options: [
              {
                value: "20252026",
                label: "California 2025-2026",
                state: "CA",
                role: "current",
                count: 5041,
              },
              { value: "" },
            ],
          },
        ],
      },
      "session",
    );
    expect(opts).toEqual([
      {
        value: "20252026",
        label: "California 2025-2026",
        count: 5041,
        state: "CA",
        role: "current",
      },
    ]);
    expect(httpUrl("javascript:alert(1)")).toBeNull();
  });
});
