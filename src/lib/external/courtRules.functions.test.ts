import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./rest.server", () => ({ restGet: vi.fn() }));
vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => ({
    handler: (handler: unknown) => handler,
    inputValidator: () => ({ handler: (handler: unknown) => handler }),
  }),
}));

import { restGet } from "./rest.server";
import {
  courtScope,
  documentsPath,
  ftsQuery,
  getCourtRuleInsights,
  getCourtRules,
  insightsPath,
  officialUrl,
  parseInsight,
  parseRuleDocument,
  parseSectionHit,
  parseSectionText,
  sectionSearchPath,
  snippet,
} from "./courtRules.functions";

const mocked = vi.mocked(restGet);
type Handler<I, O> = (args: { data: I }) => Promise<O>;
const call = <I, O>(fn: unknown, data: I) => (fn as Handler<I, O>)({ data });

const doc = {
  scope: "federal_local",
  status: "text",
  status_label: "Retrieved",
  publisher: "U.S. District Court, N.D. California",
  url: "https://cand.uscourts.gov/wp-content/uploads/local-rules/civil.pdf",
  found_on: "https://cand.uscourts.gov/rules/local-rules/",
  sections: 120,
  insights: 30,
  insight_categories: { response_deadline: 4, page_limit: 3, bogus: 9 },
  pages: 140,
  retrieved_at: "2026-10-19T12:00:00Z",
};
const insight = {
  category: "response_deadline",
  applies_to: "Opposition",
  value: "14 days after the motion is filed",
  quote: "The opposition must be filed and served not more than 14 days after the motion is filed.",
  quote_match: "exact",
  section_id: "cand-civil:0034",
  section_label: "7-3",
  section_title: "Opposition; Reply; Supplementary Material",
  page: 31,
  source_url: "https://cand.uscourts.gov/wp-content/uploads/local-rules/civil.pdf#page=31",
  doc: "cand-civil",
  doc_title: "N.D. Cal.: Civil Local Rules",
};

describe("court scope and document query", () => {
  it("maps court_spine types to levels", () => {
    const fed = (type: string) =>
      courtScope({ state: "CA", filters: { system: ["federal"], type: [type] } }, "x");
    expect(fed("FD")?.level).toBe("district");
    expect(fed("F")?.level).toBe("appellate");
    expect(fed("FB")?.level).toBe("bankruptcy");
    expect(fed("FS")?.level).toBeNull();
    const st = (type: string) =>
      courtScope({ state: "", filters: { system: ["state"], type: [type], state: ["MN"] } }, "x");
    expect(st("S")).toEqual({ courtId: "x", system: "state", level: "supreme", state: "MN" });
    expect(st("SA")?.level).toBe("appellate");
    expect(st("ST")?.level).toBe("trial");
    expect(st("CR:jp")?.level).toBe("trial");
    expect(st("SS")?.level).toBeNull();
    expect(st("REG:ST")).toEqual({
      courtId: "x",
      system: "state",
      level: null,
      state: "MN",
      allLevels: true,
    });
    expect(courtScope({ filters: { system: ["tribal"] } }, "x")).toBeNull();
    expect(courtScope(null, "x")).toBeNull();
  });

  it("builds containment filters, never an unfiltered query", () => {
    const fed = documentsPath({
      courtId: "cand",
      system: "federal",
      level: "district",
      state: "CA",
    })!;
    expect(decodeURIComponent(fed)).toContain(
      'or=(filters.cs.{"court":["cand"]},filters.cs.{"scope":["federal_national"],"level":["district"]})',
    );
    expect(fed).toContain("dataset=eq.court_rule_documents");
    const st = documentsPath({ courtId: "minn", system: "state", level: "supreme", state: "MN" })!;
    expect(decodeURIComponent(st)).toContain(
      'filters=cs.{"scope":["state"],"state":["MN"],"level":["supreme"]}',
    );
    expect(documentsPath({ courtId: "x", system: "state", level: null, state: "MN" })).toBeNull();
    const all = documentsPath({
      courtId: "reg-ST-mn_state",
      system: "state",
      level: null,
      state: "MN",
      allLevels: true,
    })!;
    expect(decodeURIComponent(all)).toContain('filters=cs.{"scope":["state"],"state":["MN"]}');
    expect(
      documentsPath({ courtId: "x", system: "state", level: "trial", state: null }),
    ).toBeNull();
  });
});

describe("parsers", () => {
  it("keeps known categories and official addresses only", () => {
    const d = parseRuleDocument("cand-civil", "N.D. Cal.: Civil Local Rules", doc)!;
    expect(d.categories).toEqual({ response_deadline: 4, page_limit: 3 });
    expect(d.url).toBe(doc.url);
    expect(parseRuleDocument("cand-civil", "x", { ...doc, scope: "elsewhere" })).toBeNull();
    expect(parseRuleDocument("Bad Id", "x", doc)).toBeNull();
    expect(
      parseRuleDocument("cand-civil", "x", { ...doc, url: "https://github.com/x/y.pdf" })!.url,
    ).toBeNull();
    expect(officialUrl("javascript:alert(1)")).toBeNull();
  });

  it("drops an insight whose value is not inside its quote or whose document was not asked for", () => {
    const docs = new Set(["cand-civil"]);
    expect(parseInsight("cand-civil:i001", insight, docs)!.page).toBe(31);
    expect(parseInsight("cand-civil:i001", { ...insight, value: "21 days" }, docs)).toBeNull();
    expect(parseInsight("cand-civil:i001", insight, new Set(["other"]))).toBeNull();
    expect(parseInsight("cand-civil:i001", { ...insight, category: "guess" }, docs)).toBeNull();
    expect(parseInsight("cand-civil:i001", { ...insight, quote_match: "fuzzy" }, docs)).toBeNull();
    expect(
      parseInsight("cand-civil:i001", { ...insight, section_id: "drop table" }, docs),
    ).toBeNull();
  });

  it("parses search hits with a passage around the match", () => {
    const text =
      "A".repeat(400) + " The motion for summary judgment shall be noticed. " + "B".repeat(400);
    const hit = parseSectionHit(
      {
        id: "cand-civil:0088",
        title: "56-1. Notice of Motion",
        s: { doc: "cand-civil", page: 40, source_url: doc.url, chars: 900 },
        text,
      },
      "summary judgment",
    )!;
    expect(hit.snippet).toContain("summary judgment");
    expect(hit.snippet.startsWith("…")).toBe(true);
    expect(parseSectionHit({ id: "x", title: "t", s: {}, text }, "q")).toBeNull();
  });

  it("caps long section text and reports it", () => {
    const row = {
      id: "us-frbp:0001",
      title: "Rule 1001",
      s: { doc: "us-frbp", source_url: "https://www.uscourts.gov/x.pdf" },
      text: "x".repeat(70_000),
    };
    const s = parseSectionText(row)!;
    expect(s.text.length).toBe(60_000);
    expect(s.truncated).toBe(true);
  });

  it("builds prefix full-text queries from letters and digits only", () => {
    expect(ftsQuery("Summary-judgment & reply!")).toBe("summary:*&judgment:*&reply:*");
    expect(ftsQuery("  ")).toBeNull();
    const path = sectionSearchPath(["cand-civil", "us-frcp"], "reply brief")!;
    expect(decodeURIComponent(path)).toContain(
      'or=(filters.cs.{"doc":["cand-civil"]},filters.cs.{"doc":["us-frcp"]})',
    );
    expect(decodeURIComponent(path)).toContain("search_vector=fts(simple).reply:*&brief:*");
    expect(decodeURIComponent(path)).toContain("title=not.like.Front matter*");
    expect(decodeURIComponent(insightsPath(["cand-civil"], "page_limit"))).toContain(
      'filters=cs.{"category":["page_limit"]}',
    );
  });

  it("snippet falls back to the start when no word matches", () => {
    expect(snippet("Short text.", "absent")).toBe("Short text.");
  });
});

describe("server functions", () => {
  beforeEach(() => mocked.mockReset());

  it("returns the applicable documents for a court", async () => {
    mocked.mockResolvedValueOnce({
      rows: [{ state: "CA", filters: { system: ["federal"], type: ["FD"] } }],
      total: null,
    });
    mocked.mockResolvedValueOnce({
      rows: [
        { id: "cand-civil", title: "N.D. Cal.: Civil Local Rules", d: doc },
        { id: "bad", title: "x", d: { scope: "nope" } },
      ],
      total: null,
    });
    const r = await call<{ id: string }, Awaited<ReturnType<typeof getCourtRules>>>(getCourtRules, {
      id: "cand",
    });
    expect(r!.documents.map((d) => d.id)).toEqual(["cand-civil"]);
    expect(r!.dropped).toBe(1);
    expect(mocked.mock.calls[0]![0]).toContain("dataset=eq.court_spine&id=eq.cand");
  });

  it("returns null for a court that is not recorded", async () => {
    mocked.mockResolvedValueOnce({ rows: [], total: null });
    expect(await call(getCourtRules, { id: "nowhere" })).toBeNull();
    expect(mocked).toHaveBeenCalledTimes(1);
  });

  it("pages practice points with a count", async () => {
    mocked.mockResolvedValueOnce({ rows: [{ id: "cand-civil:i001", i: insight }], total: 30 });
    const r = await call<object, Awaited<ReturnType<typeof getCourtRuleInsights>>>(
      getCourtRuleInsights,
      {
        docs: ["cand-civil"],
        category: "not-a-category",
        offset: 0,
        limit: 40,
      },
    );
    expect(r.insights).toHaveLength(1);
    expect(r.total).toBe(30);
    expect(mocked.mock.calls[0]![1]).toEqual({ count: true, range: [0, 39] });
    expect(mocked.mock.calls[0]![0]).not.toContain("category");
  });
});
