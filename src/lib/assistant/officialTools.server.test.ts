import { afterEach, describe, expect, it, vi } from "vitest";
import { OFFICIAL_EXECUTORS, OFFICIAL_TOOL_DEFINITIONS } from "./officialTools.server";
import { TOOL_DEFINITIONS, availableTools, pageWindow } from "./tools.server";

type Call = { url: string; headers: Record<string, string> };

function mockFetch(status: number, body: unknown): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url: String(url), headers: (init?.headers ?? {}) as Record<string, string> });
      return new Response(JSON.stringify(body), { status });
    }),
  );
  return calls;
}

afterEach(() => vi.unstubAllGlobals());

describe("official source tools", () => {
  it("are offered without keys and never name a model or tool vendor", () => {
    const names = OFFICIAL_TOOL_DEFINITIONS.map((t) => t.name).filter(
      (n) => n !== "search_court_filings",
    );
    expect(TOOL_DEFINITIONS.map((t) => t.name)).toEqual(expect.arrayContaining(names));
    expect(availableTools().map((t) => t.name)).toEqual(expect.arrayContaining(names));
    expect(JSON.stringify(OFFICIAL_TOOL_DEFINITIONS)).not.toMatch(
      /anthropic|claude|openai|gpt|tavily|firecrawl|browser.?use|docketbird/i,
    );
  });

  it("searches the Federal Register with type, agency and date filters", async () => {
    const calls = mockFetch(200, {
      count: 1,
      results: [
        {
          title: "Listeria Rule",
          type: "Rule",
          document_number: "2025-00001",
          publication_date: "2025-01-02",
          agencies: [{ name: "Food and Drug Administration" }],
          citation: "90 FR 1",
          abstract: "x".repeat(900),
          html_url: "https://www.federalregister.gov/documents/2025/01/02/2025-00001/listeria",
        },
      ],
    });
    const out = await OFFICIAL_EXECUTORS["search_federal_register"]!({
      query: "listeria",
      type: "RULE",
      agency: "food-and-drug-administration",
      since: "2024-01-01",
      order: "newest",
    });
    const url = new URL(calls[0]!.url);
    expect(url.origin + url.pathname).toBe("https://www.federalregister.gov/api/v1/documents.json");
    expect(url.searchParams.get("conditions[term]")).toBe("listeria");
    expect(url.searchParams.getAll("conditions[type][]")).toEqual(["RULE"]);
    expect(url.searchParams.getAll("conditions[agencies][]")).toEqual([
      "food-and-drug-administration",
    ]);
    expect(url.searchParams.get("conditions[publication_date][gte]")).toBe("2024-01-01");
    expect(url.searchParams.get("order")).toBe("newest");
    const parsed = JSON.parse(out.content) as {
      results: { abstract: string; agencies: string[] }[];
    };
    expect(parsed.results[0]!.abstract).toHaveLength(450);
    expect(parsed.results[0]!.agencies).toEqual(["Food and Drug Administration"]);
    expect(out.sources[0]!.url).toMatch(/^https:\/\/www\.federalregister\.gov\/documents\//);
  });

  it("ignores malformed Federal Register filters", async () => {
    const calls = mockFetch(200, { count: 0, results: [] });
    await OFFICIAL_EXECUTORS["search_federal_register"]!({
      query: "x",
      type: "BOGUS",
      agency: "Bad Agency!",
      since: "last year",
    });
    const url = new URL(calls[0]!.url);
    expect(url.searchParams.has("conditions[type][]")).toBe(false);
    expect(url.searchParams.has("conditions[agencies][]")).toBe(false);
    expect(url.searchParams.has("conditions[publication_date][gte]")).toBe(false);
  });

  it("builds eCFR citations and official links without markup", async () => {
    const calls = mockFetch(200, {
      meta: { total_count: 2 },
      results: [
        {
          starts_on: "2013-09-24",
          hierarchy: { title: "21", part: "801", section: "801.35" },
          headings: {
            chapter: "Food and Drug Administration",
            part: "Labeling",
            section: "Voluntary <strong>labeling</strong> &amp; UDI.",
          },
          full_text_excerpt: "The <strong>labeler</strong> of a device…",
        },
        {
          hierarchy: { title: "21", part: "830" },
          headings: { part: "Unique Device Identification" },
        },
      ],
    });
    const out = await OFFICIAL_EXECUTORS["search_ecfr"]!({ query: "udi label", title: 21 });
    expect(new URL(calls[0]!.url).searchParams.get("hierarchy[title]")).toBe("21");
    const parsed = JSON.parse(out.content) as {
      results: { citation: string; heading: string; url: string }[];
    };
    expect(parsed.results[0]).toMatchObject({
      citation: "21 CFR 801.35",
      heading: "Voluntary labeling & UDI.",
      url: "https://www.ecfr.gov/current/title-21/section-801.35",
    });
    expect(parsed.results[1]).toMatchObject({
      citation: "21 CFR part 830",
      url: "https://www.ecfr.gov/current/title-21/part-830",
    });
  });

  it("links SEC full-text hits to the filed document and validates filters", async () => {
    const calls = mockFetch(200, {
      hits: {
        total: { value: 1 },
        hits: [
          {
            _id: "0000891014-26-000067:form10k.htm",
            _source: {
              ciks: ["0000891014"],
              display_names: ["MINERALS TECHNOLOGIES INC  (MTX)  (CIK 0000891014)"],
              form: "10-K",
              file_date: "2026-02-20",
              period_ending: "2025-12-31",
              adsh: "0000891014-26-000067",
            },
          },
        ],
      },
    });
    const out = await OFFICIAL_EXECUTORS["search_sec_filings"]!({
      query: '"talc litigation"',
      forms: "10-K, 8-K, bad form!",
      cik: "891014",
      start: "2024-01-01",
    });
    const url = new URL(calls[0]!.url);
    expect(url.searchParams.get("q")).toBe('"talc litigation"');
    expect(url.searchParams.get("forms")).toBe("10-K,8-K");
    expect(url.searchParams.get("ciks")).toBe("0000891014");
    expect(url.searchParams.get("dateRange")).toBe("custom");
    expect(url.searchParams.get("startdt")).toBe("2024-01-01");
    expect(calls[0]!.headers["user-agent"]).toBeTruthy();
    expect(out.sources[0]!.url).toBe(
      "https://www.sec.gov/Archives/edgar/data/891014/000089101426000067/form10k.htm",
    );
  });

  it("passes openFDA syntax through, counts fields and reports no matches as zero", async () => {
    let calls = mockFetch(200, {
      meta: { last_updated: "2026-10-07", results: { total: 3 } },
      results: [{ recalling_firm: "A", long: "y".repeat(4000) }],
    });
    const out = await OFFICIAL_EXECUTORS["search_fda"]!({
      endpoint: "food/enforcement",
      search: "reason_for_recall:listeria+AND+report_date:[20240101+TO+20241231]",
      limit: 2,
    });
    expect(calls[0]!.url).toBe(
      "https://api.fda.gov/food/enforcement.json?search=reason_for_recall%3Alisteria+AND+report_date%3A%5B20240101+TO+20241231%5D&limit=2",
    );
    const parsed = JSON.parse(out.content) as { total: number; results: { truncated?: boolean }[] };
    expect(parsed.total).toBe(3);
    expect(parsed.results[0]!.truncated).toBe(true);

    calls = mockFetch(200, { meta: {}, results: [{ term: "NAUSEA", count: 10 }] });
    const counted = await OFFICIAL_EXECUTORS["search_fda"]!({
      endpoint: "drug/event",
      search: 'patient.drug.openfda.brand_name:"ozempic"',
      count: "patient.reaction.reactionmeddrapt.exact",
    });
    expect(calls[0]!.url).toContain("&count=patient.reaction.reactionmeddrapt.exact");
    expect(calls[0]!.url).not.toContain("limit=");
    expect(counted.detail).toContain("top values");

    mockFetch(404, { error: { code: "NOT_FOUND", message: "No matches found!" } });
    const none = await OFFICIAL_EXECUTORS["search_fda"]!({
      endpoint: "device/recall",
      search: "zzz",
    });
    expect(JSON.parse(none.content)).toMatchObject({ total: 0, results: [] });
  });

  it("refuses unknown openFDA endpoints and malformed count fields", async () => {
    mockFetch(200, {});
    await expect(
      OFFICIAL_EXECUTORS["search_fda"]!({ endpoint: "../../admin", search: "x" }),
    ).rejects.toThrow(/unknown/);
    await expect(
      OFFICIAL_EXECUTORS["search_fda"]!({ endpoint: "drug/event", count: "a&limit=1000" }),
    ).rejects.toThrow(/count/);
  });
});

describe("court filings search", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("is offered only with its key", () => {
    vi.stubEnv("DOCKETBIRD_API_KEY", "");
    expect(availableTools().map((t) => t.name)).not.toContain("search_court_filings");
    vi.stubEnv("DOCKETBIRD_API_KEY", "test-key");
    expect(availableTools().map((t) => t.name)).toContain("search_court_filings");
  });

  it("searches each named court, merges by recency and strips snippet markup", async () => {
    vi.stubEnv("DOCKETBIRD_API_KEY", "test-key");
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push(String(url));
        expect((init?.headers as Record<string, string>)["authorization"]).toBe("Bearer test-key");
        const court = new URL(String(url)).searchParams.get("court_id");
        const date = court === "ilnd" ? "2026-01-02" : "2026-03-04";
        return new Response(
          JSON.stringify({
            status: "success",
            data: {
              found: 2,
              next_cursor: null,
              documents: [
                {
                  document_title: "Complaint",
                  case_title: `Case in ${court}`,
                  case_id: `${court}-1:2026-cv-1`,
                  court_id: court,
                  date_filed: date,
                  snippets: ["<em>Hair</em> relaxer &amp; cancer"],
                  canonical_url: `https://filings.example/${court}`,
                },
              ],
            },
          }),
          { status: 200 },
        );
      }),
    );
    const out = await OFFICIAL_EXECUTORS["search_court_filings"]!({
      query: '"hair relaxer"',
      courts: "ilnd, cand, bad court!",
      filed_after: "2026-01-01",
      sort: "recency",
    });
    expect(calls).toHaveLength(2);
    const first = new URL(calls[0]!);
    expect(first.searchParams.get("q")).toBe('"hair relaxer"');
    expect(first.searchParams.get("filed_after")).toBe("2026-01-01");
    expect(first.searchParams.get("sort")).toBe("recency");
    const parsed = JSON.parse(out.content) as {
      found: number;
      results: { court: string; filed: string; snippets: string[] }[];
    };
    expect(parsed.found).toBe(4);
    expect(parsed.results.map((r) => r.filed)).toEqual(["2026-03-04", "2026-01-02"]);
    expect(parsed.results[0]!.snippets[0]).toBe("Hair relaxer & cancer");
    expect(out.label).toBe("Searched court filings");
  });
});

describe("pageWindow", () => {
  const text = `${"a".repeat(20000)}Chevron deference${"b".repeat(3000)}chevron again${"c".repeat(500)}CHEVRON third`;

  it("returns windows with the next offset until the end", () => {
    const first = pageWindow(text, 0, "");
    expect(first).toMatchObject({
      total_chars: text.length,
      start: 0,
      end: 14000,
      next_start: 14000,
    });
    expect(first.text).toHaveLength(14000);
    const last = pageWindow(text, 14000, "");
    expect(last.end).toBe(text.length);
    expect(last.next_start).toBeNull();
    expect(pageWindow(text, 10_000_000, "").start).toBe(text.length - 1);
  });

  it("finds every mention and returns spaced passages with offsets", () => {
    const phrase = pageWindow(text, 0, "  Chevron DEFERENCE ");
    expect(phrase).toMatchObject({ find: "Chevron DEFERENCE", occurrences: 1 });
    const hits = pageWindow(text, 0, "chevron");
    expect(hits.occurrences).toBe(3);
    // the second and third mentions are less than 1,200 characters apart, so they share one passage
    expect(hits.matches?.map((m) => m.offset)).toEqual([20000, 20000 + 17 + 3000]);
    expect(hits.matches?.[0]?.excerpt).toContain("Chevron deference");
  });
});
