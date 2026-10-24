import { describe, expect, it } from "vitest";
import { countText, parseCourtCounts, parseTopicSeries, recordIds, shareOf } from "./searchCounts";

const at = "2026-10-24T02:10:00Z";
const page = (q: string) =>
  `https://www.courtlistener.com/?type=o&q=${encodeURIComponent(q)}&stat_Published=on&stat_Unpublished=on`;

const COURT = {
  kind: "court",
  court_id: "ca9",
  court: "Court of Appeals for the Ninth Circuit",
  window: ["2000-01-01", "2025-12-31"],
  total: {
    q: "court_id:ca9 AND dateFiled:[2000-01-01 TO 2025-12-31]",
    count: 200000,
    retrieved_at: at,
    search_url: page("court_id:ca9"),
  },
  topics: [
    {
      slug: "qualified_immunity",
      label: "Qualified immunity",
      topic_query: '"qualified immunity"',
      q: 'court_id:ca9 AND "qualified immunity" AND dateFiled:[2000-01-01 TO 2025-12-31]',
      count: 5000,
      share_pct: 2.5,
      rank: 3,
      rank_of: 14,
      pooled_share_pct: 2.1,
      retrieved_at: at,
      search_url: page('"qualified immunity"'),
    },
    {
      slug: "class_waiver",
      label: "Class waiver near arbitration (within 10 words)",
      topic_query: '"class waiver arbitration"~10',
      q: 'court_id:ca9 AND "class waiver arbitration"~10 AND dateFiled:[2000-01-01 TO 2025-12-31]',
      count: 7,
      share_pct: 0.004,
      rank: 1,
      rank_of: 14,
      retrieved_at: at,
      search_url: page('"class waiver arbitration"~10'),
    },
  ],
};

describe("shareOf", () => {
  it("rounds to three decimals and refuses a zero whole", () => {
    expect(shareOf(7, 200000)).toBe(0.004);
    expect(shareOf(1, 3)).toBe(33.333);
    expect(shareOf(1, 0)).toBeNull();
    expect(shareOf(1, null)).toBeNull();
  });
});

describe("parseCourtCounts", () => {
  it("keeps topics whose stored share equals the share of the stored counts", () => {
    const c = parseCourtCounts(COURT, "ca9")!;
    expect(c.total.count).toBe(200000);
    expect(c.topics.map((t) => [t.slug, t.sharePct, t.rank])).toEqual([
      ["qualified_immunity", 2.5, 3],
      ["class_waiver", 0.004, 1],
    ]);
    expect(c.topics[1]!.pooledSharePct).toBeNull();
  });

  it("drops a topic whose stored share disagrees with its counts", () => {
    const bad = structuredClone(COURT);
    bad.topics[0]!.share_pct = 3.5;
    expect(parseCourtCounts(bad, "ca9")!.topics.map((t) => t.slug)).toEqual(["class_waiver"]);
  });

  it("drops a point whose link is not a CourtListener search page", () => {
    const bad = structuredClone(COURT);
    bad.topics[0]!.search_url = "https://example.com/?q=x";
    expect(parseCourtCounts(bad, "ca9")!.topics).toHaveLength(1);
  });

  it("refuses another court's record", () => {
    expect(parseCourtCounts(COURT, "ca1")).toBeNull();
  });
});

describe("parseTopicSeries", () => {
  const series = {
    kind: "topic",
    slug: "daubert",
    label: "Daubert (expert evidence)",
    topic_query: '"Daubert"',
    points: [
      {
        year: 2026,
        partial: true,
        q: '"Daubert" AND dateFiled:[2026-01-01 TO 2026-12-31]',
        count: 10,
        total: 1000,
        share_pct: 1,
        retrieved_at: at,
        search_url: page("x"),
      },
      {
        year: 2025,
        q: '"Daubert" AND dateFiled:[2025-01-01 TO 2025-12-31]',
        count: 30,
        total: 1200,
        share_pct: 2.5,
        retrieved_at: at,
        search_url: page("x"),
      },
      {
        year: 2024,
        q: "x",
        count: 40,
        total: 30,
        share_pct: 133.333,
        retrieved_at: at,
        search_url: page("x"),
      },
    ],
  };
  it("orders years, marks the partial year and drops impossible points", () => {
    const s = parseTopicSeries(series)!;
    expect(s.points.map((p) => [p.year, p.partial, p.sharePct])).toEqual([
      [2025, false, 2.5],
      [2026, true, 1],
    ]);
  });
  it("keeps a point without a denominator as a count without a share", () => {
    const s = parseTopicSeries({
      ...series,
      points: [{ ...series.points[1]!, total: null, share_pct: null }],
    })!;
    expect(s.points[0]).toMatchObject({ count: 30, total: null, sharePct: null });
  });
});

describe("approximate counts", () => {
  it("marks every count above 2,000 approximate, whatever the record says", () => {
    const c = parseCourtCounts(COURT, "ca9")!;
    expect(c.total.approximate).toBe(true);
    expect(c.topics.find((t) => t.slug === "class_waiver")!.approximate).toBe(false);
    expect(countText(200000, true)).toBe("about 200,000");
    expect(countText(7, false)).toBe("7");
    expect(countText(null, false)).toBe("Not recorded");
  });
});

describe("recordIds", () => {
  it("lists the court record and the topic records", () => {
    expect(recordIds("ca9", ["daubert"])).toEqual(["court:ca9", "topic:daubert"]);
  });
});
