import { describe, expect, it, vi } from "vitest";

vi.mock("./rest.server", () => ({ restGet: vi.fn() }));
vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => ({
    handler: (handler: unknown) => handler,
    inputValidator: () => ({ handler: (handler: unknown) => handler }),
  }),
}));

import {
  courtPageStatus,
  courtPageYield,
  isRoleHeadingLine,
  leadershipRuns,
  leadershipSections,
  parseCourtPage,
  parseMatter,
  parseSession,
  requiresPacerLogin,
  sessionPlace,
  type LeadershipBlock,
} from "./mdlIntel.functions";

const URL_3026 = "https://www.ilnd.uscourts.gov/mdl-details.aspx?Lbz1nwUsE4JWF/IQJN6GpA==";
const BECKER =
  "Timothy J. Becker Johnson // Becker, PLLC Wendy Fleishman Lieff, Cabraser, Heimann & Bernstein, LLP C. Andrew Childers Levin, Papantonio, Proctor, Buchanan, O'Brien, Barr & Mougey, P.A. José M. Rojas Levin, Rojas, Camassar & Reck, LLC Diandra S. Debrosse DiCello Levitt";
const MATTHEWS =
  "David P. Matthews Matthews & Associates Ashlie Case Sletvold Peiffer Wolf Carr Kane Conway & Wise James R. Ronca Anapol Weiss Diane K. Watkins Wagstaff & Cartmell Matthew J. Sill Fulmer Sil";
const ABNEY =
  "Russell T. Abney Watts LLP Deborah S. Dixon The Dixon Firm Kristine K. Kraft Schlicter Bogard LLP Pearl A. Robertson Irpino Avin & Hawkins Alyson Steele Beridon Herzfeld Suetholz Gastel Liniski & Wall, PLLC James R. Dugan, II Dugan Law Firm, APLC Noah C. Lauricella Goldenberg Lauricella PLLC John F. Romano Romano Law Group Gerald J. Diaz, Jr. Diaz Law Firm Elizabeth A. Kaveny Kaveny & Kroll Ellen …";

// The published MDL 3026 record (mdl_intel_court_pages, item.court.leadership_blocks) as stored on 2026-10-18:
// every heading kept up to 12 following elements, so the blocks overlap.
const STORED_3026 = [
  [
    "PLAINTIFFS' COUNSEL",
    [
      "Plaintiffs' Co-Lead Counsel",
      BECKER,
      "Plaintiffs' Executive Committee",
      MATTHEWS,
      "Plaintiffs' Steering Committee",
      ABNEY,
      "Plaintiffs' Liaison Counsel",
    ],
  ],
  [
    "Plaintiffs' Co-Lead Counsel",
    [
      BECKER,
      "Plaintiffs' Executive Committee",
      MATTHEWS,
      "Plaintiffs' Steering Committee",
      ABNEY,
      "Plaintiffs' Liaison Counsel",
      "Elizabeth A. Kaveny",
      "DEFENDANT'S LEAD COUNSEL",
    ],
  ],
  [
    "Plaintiffs' Executive Committee",
    [
      MATTHEWS,
      "Plaintiffs' Steering Committee",
      ABNEY,
      "Plaintiffs' Liaison Counsel",
      "Elizabeth A. Kaveny",
      "DEFENDANT'S LEAD COUNSEL",
      "Abbott's Lead Counsel",
    ],
  ],
  [
    "Plaintiffs' Steering Committee",
    [
      ABNEY,
      "Plaintiffs' Liaison Counsel",
      "Elizabeth A. Kaveny",
      "DEFENDANT'S LEAD COUNSEL",
      "Abbott's Lead Counsel",
      "Stephanie E. Parker",
      "Mead Johnson's Lead Counsel",
    ],
  ],
  [
    "Plaintiffs' Liaison Counsel",
    [
      "Elizabeth A. Kaveny",
      "DEFENDANT'S LEAD COUNSEL",
      "Abbott's Lead Counsel",
      "Stephanie E. Parker",
      "Mead Johnson's Lead Counsel",
      "Rachel Cannon",
    ],
  ],
  [
    "DEFENDANT'S LEAD COUNSEL",
    [
      "Abbott's Lead Counsel",
      "Stephanie E. Parker",
      "Mead Johnson's Lead Counsel",
      "Rachel Cannon",
      "Mead Johnson's Co-Liaison Counsel",
      "Darlene Alt William Andrichik",
    ],
  ],
  [
    "Abbott's Lead Counsel",
    [
      "Stephanie E. Parker",
      "Mead Johnson's Lead Counsel",
      "Rachel Cannon",
      "Mead Johnson's Co-Liaison Counsel",
      "Darlene Alt William Andrichik",
    ],
  ],
  [
    "Mead Johnson's Lead Counsel",
    ["Rachel Cannon", "Mead Johnson's Co-Liaison Counsel", "Darlene Alt William Andrichik"],
  ],
] as const;

const asStored = () =>
  STORED_3026.map(([heading, lines]) => ({
    url: URL_3026,
    note: null,
    lines: [...lines],
    heading,
    contact_lines_removed: false,
  }));

const block = (
  heading: string,
  lines: string[],
  extra: Partial<LeadershipBlock> = {},
): LeadershipBlock => ({
  heading,
  group: null,
  lines,
  linesNotShown: 0,
  url: "https://x.uscourts.gov/mdl",
  contactLinesRemoved: false,
  updated: null,
  ...extra,
});

describe("leadershipSections on the published MDL 3026 record", () => {
  const page = parseCourtPage({ mdl: 3026, leadership_blocks: asStored() })!;

  it("yields each role once, in page order, without overlap", () => {
    expect(page.leadership.map((s) => [s.group, s.heading])).toEqual([
      ["PLAINTIFFS' COUNSEL", "Plaintiffs' Co-Lead Counsel"],
      ["PLAINTIFFS' COUNSEL", "Plaintiffs' Executive Committee"],
      ["PLAINTIFFS' COUNSEL", "Plaintiffs' Steering Committee"],
      ["PLAINTIFFS' COUNSEL", "Plaintiffs' Liaison Counsel"],
      ["DEFENDANT'S LEAD COUNSEL", "Abbott's Lead Counsel"],
      ["DEFENDANT'S LEAD COUNSEL", "Mead Johnson's Lead Counsel"],
      ["DEFENDANT'S LEAD COUNSEL", "Mead Johnson's Co-Liaison Counsel"],
    ]);
    const lines = page.leadership.flatMap((s) => s.lines);
    expect(new Set(lines).size).toBe(lines.length); // no line repeated across sections
    expect(lines.some((l) => page.leadership.some((s) => s.heading === l))).toBe(false);
  });

  it("keeps every line verbatim", () => {
    const by = Object.fromEntries(page.leadership.map((s) => [s.heading, s.lines]));
    expect(by["Plaintiffs' Co-Lead Counsel"]).toEqual([BECKER]);
    expect(by["Plaintiffs' Executive Committee"]).toEqual([MATTHEWS]);
    expect(by["Plaintiffs' Steering Committee"]).toEqual([ABNEY]);
    expect(by["Plaintiffs' Liaison Counsel"]).toEqual(["Elizabeth A. Kaveny"]);
    expect(by["Abbott's Lead Counsel"]).toEqual(["Stephanie E. Parker"]);
    expect(by["Mead Johnson's Lead Counsel"]).toEqual(["Rachel Cannon"]);
    expect(by["Mead Johnson's Co-Liaison Counsel"]).toEqual(["Darlene Alt William Andrichik"]);
    expect(page.leadership.every((s) => s.url === URL_3026 && s.moreLines === 0)).toBe(true);
  });
});

describe("leadershipSections rules", () => {
  it("drops a section already contained in an earlier one with the same heading", () => {
    const out = leadershipSections([
      block("Lead Counsel", ["Jane Doe", "Example LLP", "John Roe", "Roe LLP"]),
      block("lead  counsel", ["John Roe", "Roe LLP"], { url: "https://x.uscourts.gov/sub" }),
      block("Liaison Counsel", ["Jane Doe"]),
    ]);
    expect(out.map((s) => s.heading)).toEqual(["Lead Counsel", "Liaison Counsel"]);
  });

  it("keeps the same person under two roles", () => {
    const out = leadershipSections([
      block("Plaintiffs' Steering Committee", ["Elizabeth A. Kaveny", "Kaveny & Kroll"]),
      block("Plaintiffs' Liaison Counsel", ["Elizabeth A. Kaveny"]),
    ]);
    expect(out).toHaveLength(2);
  });

  it("uses a recorded group, carries omitted-line counts and skips a repeated own heading", () => {
    const out = leadershipSections([
      block(
        "Plaintiffs' Co-Lead Counsel",
        ["Plaintiffs' Co-Lead Counsel", "Anna Carter", "Carter PLLC"],
        {
          group: "PLAINTIFFS' COUNSEL",
          linesNotShown: 3,
        },
      ),
    ]);
    expect(out).toEqual([
      expect.objectContaining({
        group: "PLAINTIFFS' COUNSEL",
        lines: ["Anna Carter", "Carter PLLC"],
        moreLines: 3,
      }),
    ]);
  });

  it("does not carry a derived group across court pages", () => {
    const out = leadershipSections([
      block("PLAINTIFFS' COUNSEL", ["Lead Counsel"]),
      block("Lead Counsel", ["Jane Doe"]),
      block("Steering Committee", ["John Roe"], { url: "https://x.uscourts.gov/other" }),
    ]);
    expect(out.map((s) => s.group)).toEqual(["PLAINTIFFS' COUNSEL", null]);
  });

  it("drops a role already listed inside one joined line of an earlier role (published MDL 2441)", () => {
    const U = "https://www.mnd.uscourts.gov/content/stryker-rejuvenate";
    // mdl_intel_court_pages 2441 leadership_blocks as published on 2026-10-18 (one joined line per role), verbatim.
    const stored: [string, string][] = [
      [
        "Plaintiffs' Lead Counsel",
        "Last Updated: July 20, 2015 Peter J. Flowers, Chairperson Meyers & Flowers Annesley H. DeGaris DeGaris Law Group, LLC Wendy Fleischman Lieff Cabraser Heimann & Bernstein, LLP Ben W. Gordon, Jr. Levin Papantonio, PA Eric Kennedy Weisman, Kennedy & Berris Co. L.P.A. Genevieve M. Zimmerman Meshbesher & Spence Charles S. Zimmerman Zimmerman Reed, PllP",
      ],
      [
        "Plaintiffs' Liaison Counsel",
        "Last Updated: January 17, 2014 Liaison Counsel to the District of Minnesota Anthony J. Nemo Meshbesher & Spence, Ltd. Liaison Counsel to the State Courts Jesse Bernheim Kelly, Bernheim & Dolinsky, LLC",
      ],
      [
        "Liaison Counsel to the District of Minnesota",
        "Anthony J. Nemo\nMeshbesher & Spence, Ltd.",
      ],
      ["Liaison Counsel to the State Courts", "Jesse Bernheim\nKelly, Bernheim & Dolinsky, LLC"],
      [
        "Defendants' Lead Counsel",
        "Last Updated: May 27, 2016 Kim M. Catullo Gibbons PC Timothy P. Griffin Stinson Leonard Street",
      ],
      [
        "Defendants' Liaison Counsel",
        "Last Updated: January 17, 2014 Timothy P. Griffin Stinson Leonard Street",
      ],
    ];
    const c = parseCourtPage({
      mdl: 2441,
      leadership_blocks: stored.map(([heading, lines]) => ({
        heading,
        lines: lines.split("\n"),
        url: U,
        note: null,
        contact_lines_removed: false,
      })),
    })!;
    expect(c.leadership.map((s) => s.heading)).toEqual([
      "Plaintiffs' Lead Counsel",
      "Plaintiffs' Liaison Counsel",
      "Defendants' Lead Counsel",
      "Defendants' Liaison Counsel",
    ]);
    const text = c.leadership.flatMap((s) => s.lines).join(" ");
    expect(text.match(/Anthony J\. Nemo/g)).toHaveLength(1);
    expect(text.match(/Jesse Bernheim/g)).toHaveLength(1);
    // the page lists Griffin under two roles; both stay
    expect(text.match(/Timothy P\. Griffin/g)).toHaveLength(2);
    expect(c.leadership.find((s) => s.heading === "Plaintiffs' Liaison Counsel")!.lines).toEqual([
      stored[1]![1],
    ]); // verbatim
  });

  it("matches a joined line by whole words only", () => {
    const out = leadershipSections([
      block("Plaintiffs' Co-Lead Counsel", ["Plaintiffs' Co-Lead Counsel Jane Doe Doe LLP"]),
      block("Lead Counsel", ["Jane Doe"]),
    ]);
    expect(out.map((s) => s.heading)).toEqual(["Plaintiffs' Co-Lead Counsel", "Lead Counsel"]);
  });

  it("never lets a role line with no names group the next block", () => {
    const out = leadershipSections([
      block("Plaintiffs' Lead Counsel", ["Jane Doe", "Defendants' Liaison Counsel"]),
      block("Plaintiffs' Steering Committee", ["John Roe"]),
    ]);
    expect(out.map((s) => [s.group, s.heading, s.lines])).toEqual([
      [null, "Plaintiffs' Lead Counsel", ["Jane Doe"]],
      [null, "Defendants' Liaison Counsel", []], // shown as "Names not recorded"
      [null, "Plaintiffs' Steering Committee", ["John Roe"]],
    ]);
  });

  it("bounds a derived group to the headings printed under it", () => {
    const out = leadershipSections([
      block("DEFENDANTS' COUNSEL", [
        "Abbott's Lead Counsel",
        "Stephanie E. Parker",
        "Mead Johnson's Lead Counsel",
        "Rachel Cannon",
      ]),
      block("Plaintiffs' Steering Committee", ["John Roe"]),
    ]);
    expect(out.map((s) => [s.group, s.heading])).toEqual([
      ["DEFENDANTS' COUNSEL", "Abbott's Lead Counsel"],
      ["DEFENDANTS' COUNSEL", "Mead Johnson's Lead Counsel"],
      [null, "Plaintiffs' Steering Committee"],
    ]);
  });

  it("recognises role headings printed as lines, not names with roles", () => {
    expect(isRoleHeadingLine("Mead Johnson's Co-Liaison Counsel")).toBe(true);
    expect(isRoleHeadingLine("Plaintiffs’ Steering Committee:")).toBe(true);
    expect(isRoleHeadingLine("Jane Doe, Liaison Counsel")).toBe(false);
    expect(isRoleHeadingLine("Rachel Cannon")).toBe(false);
    expect(isRoleHeadingLine("Lead Counsel for the Plaintiffs in all actions")).toBe(false);
  });
});

describe("leadership display", () => {
  it("ends a group at an ungrouped role so it never reads as part of the group above (rebuilt MDL 2782)", () => {
    const u = "https://www.gand.uscourts.gov/2782";
    const c = parseCourtPage({
      mdl: 2782,
      leadership_blocks: [
        ["Plaintiff Co-Lead Counsel", "Plaintiffs' Counsel"],
        ["Plaintiff Liaison Counsel", null],
        ["Defendant Co-Lead Counsel", "Defendants' Counsel"],
        ["Defendant Co-Liaison Counsel", null],
        ["Plaintiffs' Steering Committee", null],
      ].map(([heading, group], i) => ({ heading, group, lines: [`Name ${i}`], url: u })),
    })!;
    expect(
      leadershipRuns(c.leadership).map((r) => [r.group, r.sections.map((s) => s.heading)]),
    ).toEqual([
      ["Plaintiffs' Counsel", ["Plaintiff Co-Lead Counsel"]],
      [null, ["Plaintiff Liaison Counsel"]],
      ["Defendants' Counsel", ["Defendant Co-Lead Counsel"]],
      [null, ["Defendant Co-Liaison Counsel"]],
      [null, ["Plaintiffs' Steering Committee"]],
    ]);
    expect(
      leadershipRuns([{ group: "A" }, { group: "A" }, { group: null }, { group: "A" }]).map((r) => [
        r.group,
        r.sections.length,
      ]),
    ).toEqual([
      ["A", 2],
      [null, 1],
      ["A", 1],
    ]);
  });

  it("counts roles beyond the payload bound and keeps the page's Last Updated text", () => {
    const c = parseCourtPage({
      mdl: 1,
      leadership_blocks: Array.from({ length: 14 }, (_, i) => ({
        heading: `Role ${i} Committee`,
        lines: [`Name ${i}`],
        url: `https://x.uscourts.gov/${i < 13 ? "a" : "b"}`,
        updated: i === 0 ? "Last Updated: July 20, 2015" : undefined,
      })),
    })!;
    expect(c.leadership).toHaveLength(12);
    expect([c.leadershipMore, c.leadershipMoreUrl]).toEqual([2, "https://x.uscourts.gov/a"]);
    expect(c.leadership[0]!.updated).toBe("Last Updated: July 20, 2015");
    expect(c.leadership[1]!.updated).toBeNull();
    expect(courtPageStatus({ ...c, pages: [{ url: "u", title: "t", retrieved: null }] })).toBe(
      "No orders extracted from the court page · leadership listed (14 roles)",
    );
  });
});

describe("hearing sessions", () => {
  it("parses printed location lines and states a missing city", () => {
    const s = parseSession({
      date: "2025-09-25",
      location: "Santiago E. Campus U.S. Courthouse",
      location_lines: ["Santiago E. Campus U.S. Courthouse", "Santa Fe, New Mexico 87501"],
      location_city: "Santa Fe",
      location_state: "New Mexico",
      notice_url: "https://www.jpml.uscourts.gov/x.pdf",
      tallies: { "A:granted": 3, bad: "x" },
    })!;
    expect(sessionPlace(s)).toBe("Santiago E. Campus U.S. Courthouse · Santa Fe, New Mexico");
    expect(s.tallies).toEqual({ "A:granted": 3 });
    const old = parseSession({
      date: "2023-11-30",
      location: "United States District Court",
      notice_url: "https://www.jpml.uscourts.gov/y.pdf",
    })!;
    expect(old.locationLines).toEqual([]);
    expect(sessionPlace(old)).toBe("United States District Court · city not recorded");
    expect(sessionPlace({ location: null, city: null, state: null })).toBe("Not recorded");
    expect(parseSession({ date: "2023-11-30" })).toBeNull();
  });
});

describe("court page status", () => {
  const page = { url: "https://www.laed.uscourts.gov/taxotere", title: "Taxotere" };
  const court = (v: Record<string, unknown>) => parseCourtPage({ mdl: 2740, ...v })!;

  // Says what extraction read, never what the page contains: the 2740 and 3023 court pages list order PDFs the
  // extractor did not read, so "no orders listed" would be false.
  it("says what was extracted instead of calling a page with quotes unreadable", () => {
    const c = court({
      pages: [page],
      orders_total: 0,
      quote_counts: { leadership: 84, bellwether: 57, settlement: 32 },
    });
    expect(courtPageYield(c)).toBe("statements");
    expect(courtPageStatus(c)).toBe(
      "No orders extracted from the court page · 173 statements quoted",
    );
    const one = court({
      pages: [page, { url: `${page.url}/eye`, title: "Taxotere eye" }],
      quote_counts: { leadership: 0, bellwether: 1, settlement: 0 },
    });
    expect(courtPageStatus(one)).toBe(
      "No orders extracted from the court pages · 1 statement quoted",
    );
    const lead = court({
      pages: [page],
      leadership_blocks: [
        { heading: "Plaintiffs' Lead Counsel", lines: ["Jane Doe"], url: page.url },
      ],
    });
    expect(courtPageStatus(lead)).toBe(
      "No orders extracted from the court page · leadership listed (1 role)",
    );
    for (const text of [courtPageStatus(c), courtPageStatus(one), courtPageStatus(lead)])
      expect(text).not.toMatch(/no orders listed|lists no orders|unreadable/i);
  });

  it("names a page with nothing extracted, fetch failures and undated orders", () => {
    expect(courtPageStatus(court({ pages: [page] }))).toBe("Nothing extracted from the court page");
    expect(courtPageStatus(court({}))).toBe("No court page located");
    const failed = court({ failed_pages: [{ url: page.url, status: 503 }] });
    expect(courtPageYield(failed)).toBe("failed");
    expect(courtPageStatus(failed)).toBe(
      "Court page located, but 1 court page could not be fetched",
    );
    expect(courtPageStatus(court({ pages: [page], orders_total: 12 }))).toBe(
      "12 orders listed, no order date extracted",
    );
    const vacated = court({
      pages: [page],
      orders_total: 2,
      orders: [
        {
          title: "VACATED: Order No. 3",
          url: "https://x/3.pdf",
          date: "2026-01-02",
          vacated: true,
        },
      ],
    });
    expect(courtPageStatus(vacated)).toBe(
      "2 orders listed; the latest dated order is marked vacated",
    );
  });
});

describe("court page record", () => {
  it("reads failed pages and keeps quote counts", () => {
    const c = parseCourtPage({
      mdl: 2740,
      pages: [{ url: "https://www.laed.uscourts.gov/taxotere", title: "Taxotere" }],
      failed_pages: [{ url: "https://www.laed.uscourts.gov/x", status: 503 }, { status: 404 }],
      quote_counts: { leadership: 84, bellwether: 57, settlement: 32 },
    })!;
    expect(c.failedPages).toEqual([{ url: "https://www.laed.uscourts.gov/x", status: 503 }]);
    expect(c.transferOrderUrl).toBeNull();
    expect(c.quoteCounts).toEqual({ leadership: 84, bellwether: 57, settlement: 32 });
    expect(c.leadership).toEqual([]);
  });
});

describe("PACER-gated order links", () => {
  it("marks CM/ECF and PACER hosts only", () => {
    // Hosts as published on court-page orders (MDLs 3026, 3060: ecf.ilnd; 3047: ecf.cand; 2753: ecf.nhd).
    expect(
      requiresPacerLogin("https://ecf.ilnd.uscourts.gov/cgi-bin/DisplayReceipt.pl?410968,3666"),
    ).toBe(true);
    expect(requiresPacerLogin("https://ecf.cand.uscourts.gov/doc1/035027797744")).toBe(true);
    expect(requiresPacerLogin("https://ECF.NHD.USCOURTS.GOV/doc1/11702727156")).toBe(true);
    expect(requiresPacerLogin("https://pacer.login.uscourts.gov/csologin/login.jsf")).toBe(true);
    expect(requiresPacerLogin("https://pcl.uscourts.gov/pcl/pages/search/findCase.jsf")).toBe(true);
    for (const url of [
      "https://www.ilnd.uscourts.gov/_assets/_documents/_forms/_cmecf/MDL3060/CMO No. 7.pdf",
      "https://www.njd.uscourts.gov/sites/njd/files/17md2789%20CMO14.pdf",
      "https://ecf.ilnd.uscourts.gov.example.com/doc1/1",
      "https://notecf.ilnd.uscourts.gov/doc1/1",
      "ftp://ecf.ilnd.uscourts.gov/doc1/1",
      "ecf.ilnd.uscourts.gov/doc1/1",
      "",
    ])
      expect(requiresPacerLogin(url)).toBe(false);
  });

  it("records the flag on each parsed order", () => {
    const c = parseCourtPage({
      mdl: 3026,
      pages: [{ url: URL_3026, title: "MDL 3026" }],
      orders: [
        {
          title: "Case Management Order No. 12",
          url: "https://ecf.ilnd.uscourts.gov/cgi-bin/DisplayReceipt.pl?410968,3666",
          date: "2026-09-01",
        },
        {
          title: "CMO No. 7",
          url: "https://www.ilnd.uscourts.gov/_assets/_documents/_forms/_cmecf/MDL3060/CMO No. 7.pdf",
        },
      ],
    })!;
    expect(c.latestOrders.map((o) => o.pacer)).toEqual([true, false]);
  });
});

describe("hearing-session matter", () => {
  it("keeps the exact MDL number and the evidence as recorded", () => {
    const m = parseMatter({
      mdl: 3194,
      title: "IN RE: ABBOTT LABORATORIES SPINAL CORD STIMULATOR PRODUCTS LIABILITY LITIGATION",
      outcome: "granted",
      section: "A",
      session: "2026-09-24",
      outcome_label: "Centralized (transfer order)",
      actions_listed: 15,
      requested_district: "Central District of California",
      evidence: {
        url: "https://www.jpml.uscourts.gov/sites/jpml/files/MDL-3194-Transfer_Order-9-26.pdf",
        date: "2026-10-02",
        source: "jpml_panel_orders_page",
        district: "N.D. Illinois",
      },
    })!;
    expect(m).toMatchObject({
      mdl: 3194,
      section: "A",
      session: "2026-09-24",
      outcome: "granted",
      actionsListed: 15,
      evidenceDate: "2026-10-02",
      district: "N.D. Illinois",
    });
    expect(m.evidenceUrl).toBe(
      "https://www.jpml.uscourts.gov/sites/jpml/files/MDL-3194-Transfer_Order-9-26.pdf",
    );
    expect(parseMatter({ mdl: "3194", session: "2026-09-24", section: "A" })).toBeNull();
    expect(parseMatter({ mdl: 3194, session: "2026-09-24", section: "C" })).toBeNull();
    // The evidence URL is rendered as a link, so only http(s) is kept.
    expect(
      parseMatter({
        mdl: 3194,
        session: "2026-09-24",
        section: "A",
        evidence: { url: "javascript:alert(1)", source: "govinfo" },
      })!.evidenceUrl,
    ).toBeNull();
  });
});

describe("not-yet-transferred court record", () => {
  it("keeps the Panel's transfer order link and refuses non-http links", () => {
    // Published MDL 3194 record (mdl_intel_court_pages), JPML pending report of 10/1/2026.
    const c = parseCourtPage({
      mdl: 3194,
      status: "not_transferred_as_of_report",
      transfer_order_filed: "2026-10-02",
      transfer_order_url:
        "https://www.jpml.uscourts.gov/sites/jpml/files/MDL-3194-Transfer_Order-9-26.pdf",
      judge: "Lindsay C. Jenkins",
      district_label: "N.D. Illinois",
    })!;
    expect(c).toMatchObject({
      status: "not_transferred_as_of_report",
      transferOrderFiled: "2026-10-02",
      transferOrderUrl:
        "https://www.jpml.uscourts.gov/sites/jpml/files/MDL-3194-Transfer_Order-9-26.pdf",
    });
    expect(
      parseCourtPage({ mdl: 3194, transfer_order_url: "javascript:alert(1)" })!.transferOrderUrl,
    ).toBeNull();
  });
});
