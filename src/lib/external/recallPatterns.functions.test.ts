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
  getRecallDomain,
  parseAnomaly,
  parseItem,
  parseOverview,
  parseTheme,
} from "./recallPatterns.functions";

// Shapes copied from published recall_patterns records.
const OVERVIEW = {
  kind: "overview",
  domain: "fda_food",
  domain_label: "FDA foods, supplements and cosmetics",
  events: 7872,
  product_rows: 29406,
  firms: 5200,
  first: "2012-06-20",
  last: "2026-09-09",
  by_year: { "2012": 500, "2013": 600, bad: 3 },
  class_mix: { "Class I": 3000, "Class II": 4000 },
  class1_by_year: { "2012": 200 },
  median_days_to_classification_by_year: { "2025": 41, "2026": -5 },
  themes: [
    {
      theme: "allergen_sesame",
      label: "Undeclared sesame",
      events: 80,
      firms: 70,
      growth: {
        recent_years: "2023–2025",
        recent: 56,
        prior_years: "2020–2022",
        prior: 9,
        change_pct: 522.2,
      },
      class1_share: 60,
    },
    { theme: "x", events: 3 },
  ],
  rising_themes: [],
  anomalies: [
    {
      month: "2015-07",
      count: 538,
      trailing_median: 144,
      robust_z: 4.4,
      measure: "product_rows",
      measure_label: "Products recalled (rows)",
      firms: 20,
      top_firms: [{ firm: "Blue Bell Creameries, L.P.", amount: 286 }],
      top_firm_share: 53.2,
      top_themes: [{ theme: "listeria", label: "Listeria monocytogenes", events: 12 }],
      pattern: "several firms",
    },
    { month: "2015-08", count: 10, trailing_median: 20 },
  ],
  untagged_events: 1124,
  top_firms: [
    { firm: "Whole Foods Market", role: null, events: 64, id: "fda_food:firm:whole-foods-market" },
  ],
  last_full_year: 2025,
};

describe("recall patterns parsers", () => {
  it("reads an overview and drops malformed parts", () => {
    const o = parseOverview(OVERVIEW, "fda_food")!;
    expect(o.byYear.map((y) => y.year)).toEqual(["2012", "2013"]);
    expect(o.themes).toHaveLength(1);
    expect(o.anomalies).toHaveLength(1);
    expect(o.daysToClassification).toEqual([{ year: "2025", days: 41 }]);
    expect(o.topFirms[0]?.id).toBe("fda_food:firm:whole-foods-market");
    expect(parseOverview(OVERVIEW, "fda_drug")).toBeNull();
  });

  it("keeps growth figures as stored", () => {
    expect(parseTheme(OVERVIEW.themes[0])?.growth?.changePct).toBe(522.2);
    expect(parseAnomaly(OVERVIEW.anomalies[1])).toBeNull();
  });

  it("reads list items and refuses another domain or a bad id", () => {
    const cluster = {
      kind: "cluster",
      domain: "fda_food",
      theme_label: "Salmonella",
      commodity: "peanut butter",
      firms: 37,
      events: 37,
      start: "2012-09-24",
      end: "2012-11-08",
      span_days: 45,
      suppliers_named: [{ supplier: "Sunland, Inc", events: 30 }],
      members: [
        { id: "62345", firm: "Trader Joe's", start: "2012-09-24", recall_numbers: ["F-0001-2013"] },
      ],
      members_total: 37,
    };
    const item = parseItem(
      "fda_food:cluster:2012-09-24-salmonella-peanut-butter",
      cluster,
      "fda_food",
    )!;
    expect(item.title).toBe("Salmonella · peanut butter");
    expect(item.suppliers).toEqual(["Sunland, Inc"]);
    expect(item.members[0]?.date).toBe("2012-09-24");
    expect(parseItem("fda_food:cluster:x", cluster, "fda_drug")).toBeNull();
    expect(parseItem("../etc", cluster)).toBeNull();
  });

  it("reads a domain with list rows trimmed", async () => {
    vi.mocked(restGet)
      .mockResolvedValueOnce({ rows: [{ p: OVERVIEW }], total: null })
      .mockResolvedValueOnce({
        rows: [
          {
            id: "fda_food:theme:allergen-sesame",
            p: {
              kind: "theme",
              domain: "fda_food",
              label: "Undeclared sesame",
              events: 80,
              recent: [{ id: "1" }],
            },
          },
          { id: "fda_food:theme:bad", p: { kind: "theme", domain: "fda_food" } },
        ],
        total: null,
      })
      .mockResolvedValueOnce({ rows: [], total: null });
    const handler = getRecallDomain as unknown as (a: { data: { domain: string } }) => Promise<{
      themes: { recent: unknown[] }[];
      dropped: number;
    }>;
    const r = await handler({ data: { domain: "fda_food" } });
    expect(r.themes).toHaveLength(1);
    expect(r.themes[0]?.recent).toEqual([]);
    expect(r.dropped).toBe(1);
  });
});
