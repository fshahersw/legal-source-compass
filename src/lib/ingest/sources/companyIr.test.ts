import { describe, expect, it } from "vitest";
import { politeHttp } from "../http.ts";
import { contentOf } from "../rows.ts";
import type { CollectContext, CorpusReader, CorpusRow, JsonObject, StoredRow } from "../types.ts";
import {
  bodyText,
  comparableIr,
  companyIrKpis,
  companySecCover,
  containsNumber,
  coverFacts,
  customId,
  irRow,
  irRowId,
  isFirstParty,
  parseBatchResults,
  pickCandidates,
  registrableDomain,
  rowIdOf,
  siteUrl,
  validateFigures,
  type IrDocument,
} from "./companyIr.ts";

const NOW = new Date("2026-10-28T12:00:00Z");

const doc = (over: Partial<IrDocument> = {}): IrDocument => ({
  cik: "0000010795",
  company: "BECTON DICKINSON & CO",
  url: "https://investors.bd.com/static-files/q4-2026-earnings-presentation.pdf",
  title: "Q4 FY2026 earnings presentation",
  kind: "presentation",
  pdf: true,
  year: 2026,
  sha256: "a".repeat(64),
  chars: 400,
  retrieved: "2026-10-28",
  linked_from: null,
  ...over,
});

const pending = {
  status: "pending" as const,
  batch: null,
  model: null,
  figures: [],
  dropped: 0,
  document_period: null,
  currency: null,
  error: null,
};

const stored = (r: CorpusRow, i = 0): StoredRow => ({ ...r, ordinal: i }) as StoredRow;

describe("hosts", () => {
  it("reduces hosts to their registrable domain", () => {
    expect(registrableDomain("investors.bd.com")).toBe("bd.com");
    expect(registrableDomain("www.astrazeneca.co.uk")).toBe("astrazeneca.co.uk");
    expect(registrableDomain("WWW.Abbottinvestor.com.")).toBe("abbottinvestor.com");
  });

  it("reads SEC profile hosts with or without a scheme", () => {
    expect(siteUrl("www.abbottinvestor.com")?.origin).toBe("https://www.abbottinvestor.com");
    expect(siteUrl("https://investors.bd.com/")?.hostname).toBe("investors.bd.com");
    expect(siteUrl("")).toBeNull();
    expect(siteUrl("ftp://x.com")).toBeNull();
  });

  it("accepts only the official domains", () => {
    expect(isFirstParty("https://investors.bd.com/a.pdf", ["bd.com"])).toBe(true);
    expect(isFirstParty("https://bd.com.evil.net/a.pdf", ["bd.com"])).toBe(false);
    expect(isFirstParty("https://www.reuters.com/bd", ["bd.com"])).toBe(false);
  });
});

describe("candidate documents", () => {
  it("keeps recent first-party results documents, PDFs first, and drops the rest", () => {
    const links = [
      "https://investors.bd.com/static-files/q4-2026-earnings-presentation.pdf",
      "https://investors.bd.com/news/q3-2026-results",
      "https://investors.bd.com/static-files/2026-proxy-statement.pdf",
      "https://investors.bd.com/static-files/q1-2019-earnings-presentation.pdf",
      "https://www.seekingalpha.com/bd-q4-2026-earnings-slides.pdf",
      "https://s201.q4cdn.com/123/files/doc_financials/2026/q2/q2-2026-supplement.pdf",
      "https://investors.bd.com/static-files/q4-2026-earnings-presentation.pdf#page=2",
      "https://investors.bd.com/careers",
    ];
    const picks = pickCandidates(links, ["bd.com"], NOW, 10);
    expect(picks.map((p) => p.url)).toEqual([
      "https://investors.bd.com/static-files/q4-2026-earnings-presentation.pdf",
      "https://s201.q4cdn.com/123/files/doc_financials/2026/q2/q2-2026-supplement.pdf",
      "https://investors.bd.com/news/q3-2026-results",
    ]);
    expect(picks[0]!.pdf).toBe(true);
    expect(picks[2]!.pdf).toBe(false);
  });
});

describe("figures", () => {
  it("finds a number as printed, with or without thousands separators", () => {
    expect(containsNumber("Medical segment revenue $1,234.5 million", 1234.5)).toBe(true);
    expect(containsNumber("Units 12345 shipped", 12345)).toBe(true);
    expect(containsNumber("Revenue 21,234.5", 1234.5)).toBe(false);
    expect(containsNumber("Growth (3.2)%", -3.2)).toBe(true);
    expect(containsNumber("Up 4.0%.", 4)).toBe(true);
    expect(containsNumber("International sales of $2.0 billion", 2)).toBe(true);
    expect(containsNumber("International sales of $2.5 billion", 2)).toBe(false);
    expect(containsNumber("sales of 2,500 units", 2)).toBe(false);
    expect(containsNumber("sales of 2,500 units", 2500)).toBe(true);
    expect(containsNumber("ended in 2021.", 2021)).toBe(true);
  });

  it("drops figures whose quote does not print the value and marks image-only figures", () => {
    const text = "Segment results\nMedical | 1,234.5 | 1,190.0\nLife Sciences | 812.0 | 790.1";
    const v = validateFigures(
      {
        document_period: "Q4 FY2026",
        currency: "USD",
        figures: [
          {
            group: "segment",
            name: "Medical",
            metric: "revenue",
            period: "Q4 FY2026",
            value: 1234.5,
            unit: "USD millions",
            quote: "Medical | 1,234.5 | 1,190.0",
            page: 7,
          },
          {
            group: "segment",
            name: "Medical",
            metric: "revenue",
            period: "Q4 FY2026",
            value: 1234.5,
            unit: "USD millions",
            quote: "Medical | 1,234.5",
            page: 7,
          },
          {
            group: "segment",
            name: "Interventional",
            metric: "revenue",
            period: "Q4 FY2026",
            value: 999,
            unit: "USD millions",
            quote: "Interventional 1,000",
            page: 7,
          },
          {
            group: "product",
            name: "Alaris",
            metric: "units",
            period: "Q4 FY2026",
            value: "4,200",
            unit: "units",
            quote: "Alaris pumps placed: 4,200",
            page: 9,
          },
          { group: "made-up", name: "x", value: 1, quote: "1" },
          "not an object",
        ],
      },
      text,
    );
    expect(v.figures.map((f) => [f.name, f.check])).toEqual([
      ["Medical", "text"],
      ["Alaris", "image"],
    ]);
    expect(v.dropped).toBe(3);
    expect(v.documentPeriod).toBe("Q4 FY2026");
    expect(v.currency).toBe("USD");
  });

  it("reads batch results files", () => {
    const jsonl = [
      JSON.stringify({
        custom_id: "ir-0000010795-0123456789abcdef",
        result: {
          type: "succeeded",
          message: { content: [{ type: "text", text: 'Here: {"figures": []}' }] },
        },
      }),
      JSON.stringify({ custom_id: "ir-0000010795-fedcba9876543210", result: { type: "errored" } }),
      "not json",
    ].join("\n");
    const r = parseBatchResults(jsonl);
    expect(r.get("ir-0000010795-0123456789abcdef")).toEqual({ answer: { figures: [] } });
    expect(r.get("ir-0000010795-fedcba9876543210")).toEqual({ error: "errored" });
    expect(r.size).toBe(2);
  });
});

describe("rows", () => {
  it("round-trips row ids through batch custom ids", async () => {
    const id = await irRowId("0000010795", doc().url);
    expect(id).toMatch(/^ir:[0-9]{10}:[0-9a-f]{16}$/);
    expect(customId(id)).toMatch(/^[a-zA-Z0-9_-]{1,64}$/);
    expect(rowIdOf(customId(id))).toBe(id);
  });

  it("recovers the document text from a stored row whatever its status", async () => {
    const id = await irRowId("0000010795", doc().url);
    const body = "Medical | 1,234.5 | 1,190.0 ".repeat(20).trim();
    const a = irRow(id, doc(), body, pending);
    expect(a.category).toBe("company_ir_kpis");
    expect(bodyText(stored(a))).toBe(body);
    const b = irRow(id, doc(), bodyText(stored(a)), {
      ...pending,
      status: "submitted",
      batch: "b1",
    });
    expect(bodyText(stored(b))).toBe(body);
    expect(b.text.length).toBe(a.text.length + ("submitted".length - "pending".length));
  });

  it("does not count a later retrieval date of the same document as a change", async () => {
    const id = await irRowId("0000010795", doc().url);
    const a = irRow(id, doc(), "text ".repeat(60), pending);
    const b = irRow(id, doc({ retrieved: "2026-11-04" }), "text ".repeat(60), pending);
    expect(JSON.stringify(comparableIr(contentOf(a)))).toBe(
      JSON.stringify(comparableIr(contentOf(b))),
    );
  });
});

describe("cover facts", () => {
  it("keeps the latest-filed fact per period end, newest first", () => {
    const json = {
      units: {
        USD: [
          { end: "2025-03-31", val: 100, accn: "a1", form: "10-K", filed: "2025-11-20", fy: 2025 },
          {
            end: "2025-03-31",
            val: 101,
            accn: "a2",
            form: "10-K/A",
            filed: "2026-01-10",
            fy: 2025,
          },
          { end: "2026-03-31", val: 120, accn: "a3", form: "10-K", filed: "2026-11-19", fy: 2026 },
          { end: "bad", val: 1 },
        ],
      },
    };
    const f = coverFacts(json, "USD", 5);
    expect(f.map((x) => [x.end, x.value])).toEqual([
      ["2026-03-31", 120],
      ["2025-03-31", 101],
    ]);
    expect(coverFacts({}, "USD", 5)).toEqual([]);
  });
});

/* -------------------------------------------------------------------------------------- offline runs */

function corpusWith(rows: CorpusRow[], targets: JsonObject[]): CorpusReader & { all: StoredRow[] } {
  const all = rows.map((r, i) => stored(r, i));
  return {
    all,
    rowsBy: async (_d, _c, values) => all.filter((r) => values.includes(r.id)),
    edge: async () => [],
    query: async (q: string) => {
      if (q.includes("dataset=eq.company_sec_statements")) return targets;
      if (q.includes("item->extraction->>status=eq.pending"))
        return all
          .filter((r) => (r.item["extraction"] as JsonObject)["status"] === "pending")
          .map((r) => ({ id: r.id }));
      return [];
    },
    rpc: async <T>() => null as T,
  };
}

const BD = {
  id: "0000010795",
  n: "BECTON DICKINSON & CO",
  w: "www.bd.com",
  ir: "investors.bd.com",
};

describe("company_ir_kpis run (offline)", () => {
  it("submits pending documents in one batch, then maps and fetches new documents", async () => {
    const heldId = await irRowId(
      BD.id,
      "https://investors.bd.com/static-files/q3-2026-supplement.pdf",
    );
    const held = irRow(
      heldId,
      doc({
        url: "https://investors.bd.com/static-files/q3-2026-supplement.pdf",
        kind: "supplement",
      }),
      "Medical | 1,234.5 ".repeat(30),
      pending,
    );
    const seen: { url: string; method: string; headers: Record<string, string>; body: string }[] =
      [];
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      seen.push({
        url,
        method: init?.method ?? "GET",
        headers: init?.headers as Record<string, string>,
        body: String(init?.body ?? ""),
      });
      if (url.endsWith("/v1/messages/batches"))
        return new Response(JSON.stringify({ id: "msgbatch_1", processing_status: "in_progress" }));
      if (url.endsWith("/v1/map"))
        return new Response(
          JSON.stringify({
            success: true,
            links: [
              "https://investors.bd.com/static-files/q4-2026-earnings-presentation.pdf",
              "https://investors.bd.com/static-files/q3-2026-supplement.pdf",
              "https://www.reuters.com/bd-q4-2026-results",
            ],
          }),
        );
      if (url.endsWith("/v1/scrape"))
        return new Response(
          JSON.stringify({
            success: true,
            data: {
              markdown: "Q4 FY2026 results. Medical revenue 1,234.5. ".repeat(10),
              metadata: { title: "Q4 FY2026 earnings presentation" },
            },
          }),
        );
      return new Response("{}", { status: 404 });
    }) as typeof fetch;
    const ctx: CollectContext = {
      http: politeHttp({ maxRequests: 40, minIntervalMs: 0, fetch: fetchImpl }),
      corpus: corpusWith([held], [BD]),
      cursor: null,
      now: NOW,
      env: (k) => ({ FIRECRAWL_API_KEY: "FC-KEY", ANTHROPIC_API_KEY: "AK-KEY" })[k],
    };
    const out = await companyIrKpis.collect(ctx);
    expect(out.complete).toBe(true);
    const batch = seen.find((s) => s.url.endsWith("/v1/messages/batches"))!;
    expect(batch.method).toBe("POST");
    expect(batch.headers["x-api-key"]).toBe("AK-KEY");
    const sent = JSON.parse(batch.body) as {
      requests: { custom_id: string; params: JsonObject }[];
    };
    expect(sent.requests.map((r) => r.custom_id)).toEqual([customId(heldId)]);
    expect(JSON.stringify(sent.requests[0]!.params)).toContain('"type":"document"');
    const scrapes = seen.filter((s) => s.url.endsWith("/v1/scrape"));
    expect(scrapes).toHaveLength(1);
    // v1 scrape takes parsePDF; the v2 `parsers` option is refused with HTTP 400
    expect(JSON.parse(scrapes[0]!.body)).toMatchObject({ parsePDF: true, formats: ["markdown"] });
    expect(JSON.parse(scrapes[0]!.body)).not.toHaveProperty("parsers");
    const status = Object.fromEntries(
      out.rows.map((r) => [r.id, (r.item["extraction"] as JsonObject)["status"]]),
    );
    expect(status[heldId]).toBe("submitted");
    expect(Object.values(status).filter((s) => s === "pending")).toHaveLength(1);
    expect(out.cursorAfter).toEqual({
      next: 0,
      batches: [{ id: "msgbatch_1", submitted: NOW.toISOString(), ids: [heldId] }],
    });
    expect(ctx.http.requests.every((r) => !r.url.includes("KEY"))).toBe(true);
  });

  it("collects an ended batch and keeps only figures printed in their quoted line", async () => {
    const id = await irRowId(BD.id, doc().url);
    const body = "Segment revenue\nMedical | 1,234.5 | 1,190.0\n".repeat(8);
    const submitted = irRow(id, doc(), body, {
      ...pending,
      status: "submitted",
      batch: "msgbatch_1",
    });
    const answer = {
      document_period: "Q4 FY2026",
      currency: "USD",
      figures: [
        {
          group: "segment",
          name: "Medical",
          metric: "revenue",
          period: "Q4 FY2026",
          value: 1234.5,
          unit: "USD millions",
          quote: "Medical | 1,234.5 | 1,190.0",
          page: 4,
        },
        { group: "segment", name: "Other", value: 5, quote: "Other 6" },
      ],
    };
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/batches/msgbatch_1"))
        return new Response(
          JSON.stringify({
            processing_status: "ended",
            results_url: "https://api.anthropic.com/v1/messages/batches/msgbatch_1/results",
          }),
        );
      if (url.endsWith("/results"))
        return new Response(
          JSON.stringify({
            custom_id: customId(id),
            result: {
              type: "succeeded",
              message: { content: [{ type: "text", text: JSON.stringify(answer) }] },
            },
          }) + "\n",
        );
      if (url.endsWith("/v1/map")) return new Response(JSON.stringify({ links: [] }));
      return new Response("{}", { status: 404 });
    }) as typeof fetch;
    const out = await companyIrKpis.collect({
      http: politeHttp({ maxRequests: 40, minIntervalMs: 0, fetch: fetchImpl }),
      corpus: corpusWith([submitted], [BD]),
      cursor: { next: 0, batches: [{ id: "msgbatch_1", submitted: "x", ids: [id] }] },
      now: NOW,
      env: (k) => ({ FIRECRAWL_API_KEY: "F", ANTHROPIC_API_KEY: "A" })[k],
    });
    const row = out.rows.find((r) => r.id === id)!;
    const ex = row.item["extraction"] as JsonObject;
    expect(ex["status"]).toBe("extracted");
    expect(ex["dropped"]).toBe(1);
    expect((ex["figures"] as JsonObject[]).map((f) => [f["name"], f["check"]])).toEqual([
      ["Medical", "text"],
    ]);
    expect(bodyText(stored(row))).toBe(body);
    expect((out.cursorAfter as JsonObject)["batches"]).toEqual([]);
    expect(out.held).toEqual([
      { key: BD.id, reason: "no results or presentation document found on the official sites" },
    ]);
  });

  it("holds a registrant that states no website and a target whose site fails", async () => {
    const fetchImpl = (async () => new Response("{}", { status: 500 })) as typeof fetch;
    const targets = [{ id: "0000000001", n: "NO SITE INC", w: null, ir: null }, BD];
    const run = (next: number) =>
      companyIrKpis.collect({
        http: politeHttp({ maxRequests: 40, minIntervalMs: 0, attempts: 1, fetch: fetchImpl }),
        corpus: corpusWith([], targets),
        cursor: { next, batches: [] },
        now: NOW,
        env: (k) => ({ FIRECRAWL_API_KEY: "F", ANTHROPIC_API_KEY: "A" })[k],
      });
    const first = await run(0);
    expect(first.rows).toEqual([]);
    expect(first.held).toEqual([
      { key: "0000000001", reason: "no official website stated in SEC filings" },
    ]);
    expect(first.cursorAfter).toEqual({ next: 1, batches: [] });
    const second = await run(1);
    expect(second.held).toEqual([{ key: BD.id, reason: "Firecrawl map HTTP 500" }]);
    expect(second.cursorAfter).toEqual({ next: 0, batches: [] });
  });
});

describe("company_sec_cover_facts run (offline)", () => {
  it("writes one row per registrant from its dei concepts", async () => {
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("EntityPublicFloat.json"))
        return new Response(
          JSON.stringify({
            units: {
              USD: [{ end: "2026-03-31", val: 60e9, accn: "a", form: "10-K", filed: "2026-11-19" }],
            },
          }),
        );
      if (url.endsWith("EntityCommonStockSharesOutstanding.json"))
        return new Response(
          JSON.stringify({
            units: {
              shares: [
                { end: "2026-10-31", val: 287e6, accn: "a", form: "10-K", filed: "2026-11-19" },
              ],
            },
          }),
        );
      return new Response("{}", { status: 404 });
    }) as typeof fetch;
    const out = await companySecCover.collect({
      http: politeHttp({ maxRequests: 60, minIntervalMs: 0, fetch: fetchImpl }),
      corpus: corpusWith([], [BD]),
      cursor: null,
      now: NOW,
      env: () => undefined,
    });
    expect(out.rows.map((r) => r.id)).toEqual(["cover:0000010795"]);
    const cells = out.rows[0]!.item["cells"] as JsonObject;
    expect(cells["public_float"]).toBe(60e9);
    expect(cells["shares_outstanding"]).toBe(287e6);
    expect(out.rows[0]!.category).toBe("company_sec_cover_facts");
    expect(out.cursorAfter).toEqual({ next: 0 });
  });
});

describe("company_ir_kpis scrape errors (offline)", () => {
  it("records Firecrawl's status and error text for a document it refuses", async () => {
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/v1/map"))
        return new Response(
          JSON.stringify({ links: ["https://investors.bd.com/q4-2026-earnings-presentation.pdf"] }),
        );
      if (url.endsWith("/v1/scrape"))
        return new Response(
          JSON.stringify({ success: false, error: "Bad Request: unsupported URL" }),
          {
            status: 400,
          },
        );
      return new Response("{}", { status: 404 });
    }) as typeof fetch;
    const out = await companyIrKpis.collect({
      http: politeHttp({ maxRequests: 40, minIntervalMs: 0, fetch: fetchImpl }),
      corpus: corpusWith([], [BD]),
      cursor: null,
      now: NOW,
      env: (k) => ({ FIRECRAWL_API_KEY: "F", ANTHROPIC_API_KEY: "A" })[k],
    });
    expect(out.rows).toEqual([]);
    expect(out.held).toEqual([
      {
        key: "https://investors.bd.com/q4-2026-earnings-presentation.pdf",
        reason: "document could not be read (HTTP 400)",
      },
    ]);
    expect(out.notes["scrape_errors"]).toEqual([
      {
        url: "https://investors.bd.com/q4-2026-earnings-presentation.pdf",
        status: 400,
        error: "Bad Request: unsupported URL",
      },
    ]);
  });
});

describe("company_ir_kpis page checks", () => {
  it("dates a document by its file name, not the upload folder", () => {
    const picks = pickCandidates(
      [
        "https://www.baxter.com/sites/files/2025-12/Baxter_Reports_Third_Quarter_2022_Results_Release.pdf",
        "https://www.baxter.com/sites/files/2026-03/q4_2025_earnings_release_financial_schedules.pdf",
        "https://www.baxter.com/sites/files/2026-03/earnings-presentation.pdf",
      ],
      ["baxter.com"],
      NOW,
      10,
    );
    expect(picks.map((p) => [p.url.split("/").pop(), p.year])).toEqual([
      ["earnings-presentation.pdf", 2026],
      ["q4_2025_earnings_release_financial_schedules.pdf", 2025],
    ]);
  });

  it("refuses a page the site answered with an error status", async () => {
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/v1/map"))
        return new Response(
          JSON.stringify({ links: ["https://investors.bd.com/q4-2026-earnings-presentation.pdf"] }),
        );
      if (url.endsWith("/v1/scrape"))
        return new Response(
          JSON.stringify({
            data: {
              markdown: "The requested page was not found on our website. ".repeat(20),
              metadata: { title: "Not found", statusCode: 404 },
            },
          }),
        );
      return new Response("{}", { status: 404 });
    }) as typeof fetch;
    const out = await companyIrKpis.collect({
      http: politeHttp({ maxRequests: 40, minIntervalMs: 0, fetch: fetchImpl }),
      corpus: corpusWith([], [BD]),
      cursor: null,
      now: NOW,
      env: (k) => ({ FIRECRAWL_API_KEY: "F", ANTHROPIC_API_KEY: "A" })[k],
    });
    expect(out.rows).toEqual([]);
    expect(out.held.map((h) => h.reason)).toEqual(["document could not be read (HTTP 404)"]);
  });
});

describe("company_ir_kpis discovery (offline)", () => {
  it("maps both official sites and asks Tavily, on the same domains, when the maps find too little", async () => {
    const abbott = {
      id: "0000001800",
      n: "ABBOTT LABORATORIES",
      w: "www.abbott.com",
      ir: "www.abbottinvestor.com",
    };
    const seen: { url: string; body: string }[] = [];
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const body = String(init?.body ?? "");
      seen.push({ url, body });
      if (url.endsWith("/v1/map")) {
        const site = (JSON.parse(body) as { url: string }).url;
        return new Response(
          JSON.stringify({
            links:
              site === "https://www.abbott.com"
                ? ["https://www.abbott.com/content/dam/hub/Q2-2026-Earnings-Infographic.pdf"]
                : [],
          }),
        );
      }
      if (url === "https://api.tavily.com/search")
        return new Response(
          JSON.stringify({
            results: [
              { url: "https://www.abbott.com/content/dam/hub/Q3-2026-earnings-presentation.pdf" },
              { url: "https://www.reuters.com/abbott-q3-2026-results" },
            ],
          }),
        );
      if (url.endsWith("/v1/scrape"))
        return new Response(
          JSON.stringify({
            data: {
              markdown: "Second-quarter 2026 results. Worldwide sales $12.6B. ".repeat(10),
              metadata: { title: "Q2 2026 earnings" },
            },
          }),
        );
      return new Response("{}", { status: 404 });
    }) as typeof fetch;
    const out = await companyIrKpis.collect({
      http: politeHttp({ maxRequests: 40, minIntervalMs: 0, fetch: fetchImpl }),
      corpus: corpusWith([], [abbott]),
      cursor: null,
      now: NOW,
      env: (k) => ({ FIRECRAWL_API_KEY: "F", ANTHROPIC_API_KEY: "A", TAVILY_API_KEY: "T" })[k],
    });
    const maps = seen.filter((s) => s.url.endsWith("/v1/map")).map((s) => JSON.parse(s.body).url);
    expect(maps).toEqual(["https://www.abbottinvestor.com", "https://www.abbott.com"]);
    const tavily = seen.find((s) => s.url === "https://api.tavily.com/search")!;
    expect(JSON.parse(tavily.body).include_domains).toEqual(["abbottinvestor.com", "abbott.com"]);
    expect(out.rows.map((r) => r.source_url).sort()).toEqual([
      "https://www.abbott.com/content/dam/hub/Q2-2026-Earnings-Infographic.pdf",
      "https://www.abbott.com/content/dam/hub/Q3-2026-earnings-presentation.pdf",
    ]);
    expect(out.held).toEqual([]);
  });
});
