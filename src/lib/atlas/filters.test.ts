import { describe, expect, it } from "vitest";

import {
  defaultFilters,
  filterSources,
  matchesQuery,
  paginate,
  queryAndPaginate,
  sortSources,
  type LibraryFilters,
} from "./filters";
import type { ReviewOverlay, Source } from "./types";

function s(overrides: Partial<Source> & { id: string }): Source {
  return {
    url: `https://example.gov/${overrides.id}`,
    title: "Title",
    domain: "example.gov",
    jurisdiction: "Federal",
    heading_category: "Dockets",
    source_family: "Federal dockets",
    occurrences: 1,
    ...overrides,
  } as Source;
}

const rows: Source[] = [
  s({
    id: "1",
    title: "PACER Case Locator",
    url: "https://pcl.uscourts.gov/pcl/index.jsf?x=1#/search",
    domain: "pcl.uscourts.gov",
    jurisdiction: "Federal",
    heading_category: "Dockets",
    occurrences: 12,
  }),
  s({
    id: "2",
    title: "California Courts Opinions",
    url: "https://courts.ca.gov/opinions",
    domain: "courts.ca.gov",
    jurisdiction: "California",
    heading_category: "Opinions",
    source_family: "State appellate",
    occurrences: 5,
  }),
  s({
    id: "3",
    title: "Texas Judicial Branch",
    url: "https://txcourts.gov/",
    domain: "txcourts.gov",
    jurisdiction: "Texas",
    heading_category: "Dockets",
    source_family: "State trial",
    occurrences: 5,
  }),
];

const emptyCtx = { overlays: {} as Record<string, ReviewOverlay>, bookmarks: {} };

function f(overrides: Partial<LibraryFilters> = {}): LibraryFilters {
  return { ...defaultFilters, ...overrides };
}

describe("matchesQuery", () => {
  it("matches on title", () => {
    expect(matchesQuery(rows[0]!, "pacer")).toBe(true);
  });

  it("matches on the exact URL including query and hash", () => {
    expect(matchesQuery(rows[0]!, "index.jsf?x=1#/search")).toBe(true);
  });

  it("matches on domain, jurisdiction and heading category", () => {
    expect(matchesQuery(rows[1]!, "courts.ca.gov")).toBe(true);
    expect(matchesQuery(rows[1]!, "california")).toBe(true);
    expect(matchesQuery(rows[1]!, "opinions")).toBe(true);
  });

  it("requires all terms (AND semantics)", () => {
    expect(matchesQuery(rows[1]!, "california opinions")).toBe(true);
    expect(matchesQuery(rows[1]!, "california dockets")).toBe(false);
  });

  it("treats an empty query as match-all", () => {
    expect(matchesQuery(rows[2]!, "   ")).toBe(true);
  });
});

describe("filterSources", () => {
  it("filters by jurisdiction facet", () => {
    expect(filterSources(rows, f({ jurisdictions: ["Texas"] }), emptyCtx).map((r) => r.id)).toEqual([
      "3",
    ]);
  });

  it("combines facets with search", () => {
    const out = filterSources(rows, f({ query: "courts", headingCategories: ["Opinions"] }), emptyCtx);
    expect(out.map((r) => r.id)).toEqual(["2"]);
  });

  it("filters by browser-local review state", () => {
    const overlays: Record<string, ReviewOverlay> = {
      "2": { source_id: "2", action: "accepted", reason: "verified by hand", at: "2026-01-01T00:00:00Z" },
    };
    const ctx = { overlays, bookmarks: {} };
    expect(filterSources(rows, f({ reviewState: "accepted" }), ctx).map((r) => r.id)).toEqual(["2"]);
    expect(filterSources(rows, f({ reviewState: "unreviewed" }), ctx).map((r) => r.id)).toEqual([
      "1",
      "3",
    ]);
    expect(filterSources(rows, f({ reviewState: "rejected" }), ctx)).toHaveLength(0);
  });

  it("filters bookmarked only", () => {
    const ctx = { overlays: {}, bookmarks: { "3": true as const } };
    expect(filterSources(rows, f({ bookmarkedOnly: true }), ctx).map((r) => r.id)).toEqual(["3"]);
  });

  it("matches the (unspecified) bucket for blank values", () => {
    const withBlank = [...rows, s({ id: "4", jurisdiction: "" })];
    expect(
      filterSources(withBlank, f({ jurisdictions: ["(unspecified)"] }), emptyCtx).map((r) => r.id),
    ).toEqual(["4"]);
  });
});

describe("sortSources", () => {
  it("sorts by occurrences descending with a stable title tiebreak", () => {
    const out = sortSources(rows, "occurrences", "desc").map((r) => r.id);
    expect(out[0]).toBe("1");
    expect(out.slice(1)).toEqual(["2", "3"]);
  });

  it("sorts by title ascending", () => {
    expect(sortSources(rows, "title", "asc").map((r) => r.id)).toEqual(["2", "1", "3"]);
  });

  it("does not mutate the input array", () => {
    const copy = [...rows];
    sortSources(rows, "title", "desc");
    expect(rows).toEqual(copy);
  });
});

describe("paginate", () => {
  const items = Array.from({ length: 23 }, (_, i) => i + 1);

  it("slices the requested page and reports the range", () => {
    const page = paginate(items, 2, 10);
    expect(page.items).toEqual([11, 12, 13, 14, 15, 16, 17, 18, 19, 20]);
    expect(page).toMatchObject({ page: 2, pageCount: 3, total: 23, from: 11, to: 20 });
  });

  it("clamps out-of-range pages", () => {
    expect(paginate(items, 99, 10).page).toBe(3);
    expect(paginate(items, 0, 10).page).toBe(1);
  });

  it("handles an empty list", () => {
    expect(paginate([], 1, 25)).toMatchObject({ pageCount: 1, total: 0, from: 0, to: 0 });
  });
});

describe("queryAndPaginate", () => {
  it("filters, sorts and paginates in one pass", () => {
    const page = queryAndPaginate(
      rows,
      f({ query: "courts", sortKey: "title", sortDir: "asc", pageSize: 1, page: 2 }),
      emptyCtx,
    );
    expect(page.total).toBe(3);
    expect(page.items.map((r) => r.id)).toEqual(["1"]);
  });
});
