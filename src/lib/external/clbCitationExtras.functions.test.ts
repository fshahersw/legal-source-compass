import { describe, expect, it, vi } from "vitest";

vi.mock("./rest.server", () => ({ restGet: vi.fn() }));
vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => ({
    handler: (handler: unknown) => handler,
    inputValidator: () => ({ handler: (handler: unknown) => handler }),
  }),
}));

import { restGet } from "./rest.server";
import {
  getClbParentheticals,
  getClbUnmatchedList,
  parseClusterParentheticals,
  parseUnmatchedDetail,
  parseUnmatchedRow,
  UNMATCHED_ID,
} from "./clbCitationExtras.functions";

// Shape of a clb_top_cited_parentheticals profile (cut down from the Strickland v. Washington record).
const PAREN = {
  cluster_id: 111170,
  case_name: "Strickland v. Washington",
  parentheticals: 7470,
  describing_opinions: 6633,
  groups: 543,
  describing_courts: [
    { court_id: "ca9", name: "Ninth Circuit", n: 452, share_pct: 6.1, link: "/courts/ca9" },
  ],
  describing_groups: { Federal: 3884, State: 3516, Other: 69 },
  by_decade: [
    { decade: 1990, n: 776 },
    { decade: 1995, n: 3 },
  ],
  examples: [
    {
      parenthetical_id: 1,
      score: 0.9,
      text: "holding that counsel was ineffective",
      truncated: false,
      describing_cluster_id: 130159,
      describing_case: "Wiggins v. Smith",
      describing_url: "https://www.courtlistener.com/opinion/130159/",
      describing_court: "Supreme Court",
      describing_court_id: "scotus",
      describing_court_link: "/courts/scotus",
      describing_year: 2003,
    },
    {
      parenthetical_id: 2,
      score: 0.8,
      text: "a blocked case's description",
      describing_case_withheld: true,
      describing_case: "Should not show",
      describing_cluster_id: 5,
      describing_url: "https://www.courtlistener.com/opinion/5/",
    },
    {
      parenthetical_id: 3,
      score: 0.7,
      text: "wrong url",
      describing_cluster_id: 9,
      describing_case: "X v. Y",
      describing_url: "https://example.com/opinion/9/",
    },
  ],
};

describe("parseClusterParentheticals", () => {
  it("never names a withheld case and keeps only exact CourtListener links", () => {
    const p = parseClusterParentheticals(PAREN, 111170)!;
    expect(p.examples[0]!.describingUrl).toBe("https://www.courtlistener.com/opinion/130159/");
    expect(p.examples[0]!.describingCourtLink).toBe("/courts/scotus");
    expect(p.examples[1]!.describingCase).toBeNull();
    expect(p.examples[1]!.describingUrl).toBeNull();
    expect(p.examples[2]!.describingUrl).toBeNull();
    expect(p.byDecade).toEqual([{ decade: 1990, n: 776 }]);
    expect(p.describingGroups).toEqual({ federal: 3884, state: 3516, other: 69 });
    expect(parseClusterParentheticals(PAREN, 1)).toBeNull();
  });

  it("reads by the cluster id", async () => {
    const mocked = vi.mocked(restGet);
    mocked.mockReset();
    mocked.mockResolvedValueOnce({ rows: [{ p: PAREN }], total: null });
    const handler = getClbParentheticals as unknown as (a: {
      data: { clusterId: number };
    }) => Promise<unknown>;
    expect(await handler({ data: { clusterId: 111170 } })).not.toBeNull();
    expect(mocked.mock.calls[0]![0]).toContain(
      "dataset=eq.clb_top_cited_parentheticals&id=eq.cluster:111170",
    );
  });
});

describe("unmatched citations", () => {
  it("accepts only the two record id shapes", () => {
    expect(UNMATCHED_ID.test("reporter:f-supp-3d")).toBe(true);
    expect(UNMATCHED_ID.test("court:ca9")).toBe(true);
    expect(UNMATCHED_ID.test("overview:all")).toBe(false);
    expect(UNMATCHED_ID.test("reporter:F. Supp")).toBe(false);
  });

  it("parses list rows and rejects a kind that does not match the id", () => {
    const r = parseUnmatchedRow("reporter:wl", {
      kind: "reporter",
      name: "WL",
      citations: 3399526,
      distinct: 1235126,
      opinions: 933644,
      unresolved_pct: 100,
      type: "Westlaw citation",
      in_citation_table: "Yes",
    })!;
    expect(r.inCitationTable).toBe(true);
    expect(
      parseUnmatchedRow("court:ca9", { kind: "reporter", name: "x", citations: 1 }),
    ).toBeNull();
    const c = parseUnmatchedRow("court:ca9", {
      kind: "court",
      name: "Ninth Circuit",
      citations: 441736,
      in_citation_table: "Yes",
    })!;
    expect(c.inCitationTable).toBeNull();
  });

  it("parses a court detail only when the profile names that court", () => {
    const prof = {
      court_id: "ca9",
      name: "Ninth Circuit",
      citations: 100,
      statuses: [
        { code: 1, label: "Not in CourtListener's citation table", n: 60, share_pct: 60 },
        { code: 9, label: "x", n: 500 },
      ],
      reporters: [{ reporter: "S. Ct.", n: 30, share_pct: 30 }],
      by_year: [
        { yr: 2020, citations: 10, opinions: 3 },
        { yr: 1900, citations: 1, opinions: 1 },
      ],
      opinions_with_unmatched_pct: 45,
      court_opinions: 230917,
    };
    const d = parseUnmatchedDetail("court:ca9", prof)!;
    expect(d.statuses).toHaveLength(1);
    expect(d.parts[0]!.label).toBe("S. Ct.");
    expect(d.byPeriod).toEqual([{ label: "2020", n: 10 }]);
    expect(parseUnmatchedDetail("court:ca2", prof)).toBeNull();
  });

  it("lists the overview and rows", async () => {
    const mocked = vi.mocked(restGet);
    mocked.mockReset();
    mocked
      .mockResolvedValueOnce({
        rows: [
          {
            p: {
              citations: 10,
              unresolved: 9,
              unresolved_pct: 90,
              statuses: [],
              types: [],
              by_decade: [],
            },
          },
        ],
        total: null,
      })
      .mockResolvedValueOnce({
        rows: [
          { id: "reporter:wl", c: { kind: "reporter", name: "WL", citations: 5 } },
          { id: "bad id", c: {} },
        ],
        total: null,
      });
    const handler = getClbUnmatchedList as unknown as () => Promise<{
      rows: unknown[];
      overview: { citations: number } | null;
    }>;
    const r = await handler();
    expect(r.overview?.citations).toBe(10);
    expect(r.rows).toHaveLength(1);
  });
});
