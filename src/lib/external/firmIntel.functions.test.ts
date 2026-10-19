import { describe, expect, it, vi } from "vitest";

vi.mock("./rest.server", () => ({
  restGet: vi.fn(),
  ilikeTerm: (q: string) => encodeURIComponent(`*${q}*`),
}));
vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => ({
    handler: (handler: unknown) => handler,
    inputValidator: () => ({ handler: (handler: unknown) => handler }),
  }),
}));

import { restGet } from "./rest.server";
import {
  firmHref,
  getFirmList,
  parseAssociation,
  parseFirmProfile,
  parseFirmRow,
  parseMdl,
  parseOverview,
  parsePair,
  slugOf,
} from "./firmIntel.functions";

// Shapes copied from published firm_profiles, firm_matter_overview and firm_network records.
const PROFILE = {
  key: "seeger weiss",
  name: "Seeger Weiss LLP",
  raw_forms: [{ text: "Seeger Weiss LLP", n: 900 }],
  appearances: 1033,
  parties: 751,
  attorneys: 43,
  plaintiffs_represented: 700,
  side_mix: { plaintiff: 1012, defense: 2, other: 19 },
  lead_designations: 478,
  pro_hac_vice: 10,
  terminated: 5,
  per_mdl: [
    {
      mdl: 2738,
      title: "Talc",
      type: "Products Liability",
      year: 2016,
      appearances: 120,
      parties: 100,
      side: "plaintiff",
      lead: 40,
      link: "/records/sw_matters_v1/sw-matter:2738",
    },
    {
      mdl: 2741,
      title: "Roundup",
      year: 2016,
      appearances: 5000,
      side: "plaintiff",
      link: "/records/sw_matters_v1/sw-matter:2741",
    },
  ],
  litigation_types: [{ type: "Products Liability", mdls: 12 }],
  courts: [
    { court_id: "njd", appearances: 300, link: "/courts/njd" },
    { court_id: "cand", appearances: 20, link: "/courts/nysd" },
  ],
  defense_parties: [{ name: "Acme Corp", appearances: 2 }],
  cocounsel: [
    {
      firm: "Motley Rice LLC",
      key: "motley rice",
      shared_parties: 40,
      link: "/records/firm_profiles/firm:motley-rice",
    },
  ],
  opposing: [
    {
      firm: "Kirkland & Ellis",
      dockets: 6,
      mdls: [2741, 3047],
      link: "/records/firm_profiles/firm:kirkland-and-ellis",
    },
  ],
  same_side_overlap: [
    { firm: "Levin Sedran & Berman", shared_mdls: 4, jaccard: 0.25, link: "javascript:alert(1)" },
  ],
};

describe("firm links", () => {
  it("accepts only exact firm record paths", () => {
    expect(firmHref("/records/firm_profiles/firm:motley-rice")).toBe(
      "/records/firm_profiles/firm:motley-rice",
    );
    expect(firmHref("javascript:alert(1)")).toBeNull();
    expect(firmHref("/records/firm_profiles/../x")).toBeNull();
    expect(slugOf("seeger weiss")).toBe("firm:seeger-weiss");
    expect(slugOf("x".repeat(121))).toBe("");
  });
});

describe("parseFirmProfile", () => {
  it("parses a profile and keeps only values that fit", () => {
    const p = parseFirmProfile(PROFILE, "firm:seeger-weiss")!;
    expect(p.name).toBe("Seeger Weiss LLP");
    expect(p.perMdl.map((m) => m.mdl)).toEqual([2738]); // 5,000 appearances in one MDL exceeds the firm total
    expect(p.perMdl[0]!.href).toBe("/records/sw_matters_v1/sw-matter:2738");
    expect(p.courts).toEqual([
      { courtId: "njd", appearances: 300, href: "/courts/njd" },
      { courtId: "cand", appearances: 20, href: null },
    ]);
    expect(p.opposing[0]).toMatchObject({
      firm: "Kirkland & Ellis",
      dockets: 6,
      mdls: [2741, 3047],
    });
    expect(p.sameSide[0]!.href).toBeNull();
  });

  it("rejects another firm's profile", () => {
    expect(parseFirmProfile(PROFILE, "firm:motley-rice")).toBeNull();
    expect(parseFirmProfile({ ...PROFILE, appearances: -1 }, "firm:seeger-weiss")).toBeNull();
  });
});

describe("landscape parsers", () => {
  it("parses an MDL row only under its own id", () => {
    const raw = {
      mdl: 3047,
      title: "Social media",
      year: 2022,
      plaintiff: {
        firms: 200,
        appearances: 5000,
        hhi: 812.4,
        top1_pct: 11.2,
        top3_pct: 25,
        top5_pct: 33.3,
        top: [
          {
            firm: "A LLP",
            appearances: 560,
            share_pct: 11.2,
            link: "/records/firm_profiles/firm:a",
          },
        ],
      },
      defense: { firms: 30, appearances: 400, hhi: 20000 },
      lead_plaintiff: [{ firm: "A LLP", key: "a", designations: 300 }],
    };
    const m = parseMdl(raw, "mdl:3047")!;
    expect(m.plaintiff.top[0]!.href).toBe("/records/firm_profiles/firm:a");
    expect(m.defense.hhi).toBeNull();
    expect(m.leadPlaintiff[0]!.href).toBe("/records/firm_profiles/firm:a");
    expect(parseMdl(raw, "mdl:2741")).toBeNull();
  });

  it("parses an association and rejects an interval that does not hold rho", () => {
    const raw = {
      label: "A vs B",
      rho: 0.47,
      n: 24,
      ci: [0.08, 0.73],
      strength: "moderate",
      points: [
        { mdl: 1, x: 2, y: 3 },
        { mdl: 2, x: "x", y: 1 },
      ],
    };
    const a = parseAssociation(raw, "corr:a~b")!;
    expect(a.points).toEqual([{ mdl: 1, x: 2, y: 3 }]);
    expect(parseAssociation({ ...raw, ci: [0.5, 0.7] }, "corr:a~b")).toBeNull();
    expect(parseAssociation({ ...raw, n: 3 }, "corr:a~b")).toBeNull();
  });

  it("parses the overview's left-out counts in descending order", () => {
    const o = parseOverview({
      firms: 10,
      excluded: { a: 1, b: 5, c: "x" },
      side_firms: { plaintiff: 6 },
      government: { entries: 3, offices: [{ name: "AG", entries: 3 }], mdls: [1, 2] },
      top: [],
    })!;
    expect(o.leftOut).toEqual([
      { label: "b", n: 5 },
      { label: "a", n: 1 },
    ]);
    expect(o.sideFirms).toEqual({ plaintiff: 6, defense: null, other: null });
    expect(o.government.mdls).toBe(2);
  });

  it("parses a network pair with links only of the exact shape", () => {
    const p = parsePair({ firm_a: "A", firm_b: "B", weight: 6 }, [
      { url: "/records/firm_profiles/firm:a" },
      { url: "https://x" },
    ])!;
    expect(p.a.href).toBe("/records/firm_profiles/firm:a");
    expect(p.b.href).toBeNull();
    expect(parsePair({ firm_a: "A", firm_b: "B", weight: 0 }, [])).toBeNull();
  });
});

describe("getFirmList", () => {
  it("filters by side, searches the title and pages with a range", async () => {
    const mocked = vi.mocked(restGet);
    mocked.mockReset();
    mocked.mockResolvedValueOnce({
      rows: [
        {
          id: "firm:a",
          c: { firm: "A LLP", appearances: 10, parties: 50, side: "defense", rank: 3 },
        },
        { id: "bad id", c: { firm: "B", appearances: 1 } },
      ],
      total: 2,
    });
    const handler = getFirmList as unknown as (a: {
      data: unknown;
    }) => Promise<{ rows: unknown[]; dropped: number }>;
    const r = await handler({ data: { side: "defense", q: "a;drop", sort: "mdls", offset: 50 } });
    expect(r.rows).toHaveLength(1);
    expect(r.dropped).toBe(1);
    expect(
      parseFirmRow("firm:a", { firm: "A LLP", appearances: 10, parties: 50 })!.parties,
    ).toBeNull();
    const [path, opts] = mocked.mock.calls[0]!;
    expect(path).toContain("item->cells->>side=eq.defense");
    expect(path).toContain("order=item->cells->mdls.desc");
    expect(path).toContain("title=ilike.");
    expect(path).not.toContain(";");
    expect(opts).toEqual({ count: true, range: [50, 99] });
  });
});
