import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { answerCitationCheck, runAssistant } from "./agent.server";
import { extractCitations } from "./citations";
import {
  __resetCitationState,
  buildOpinionDoc,
  CITATION_EXECUTORS,
  checkAnswerCitations,
  checkCitations,
  officialLookups,
  opinionText,
} from "./citationVerify.server";
import {
  citationSummary,
  sanitizeCitationCheck,
  type AssistantEvent,
  type CitationCheck,
} from "./protocol";
import { availableTools, TOOL_DEFINITIONS } from "./tools.server";

type Call = {
  url: string;
  method: string;
  body: string;
  headers: Record<string, string>;
  redirect?: string | undefined;
};
type Route = (call: Call) => Response | Promise<Response>;

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
const redirect = (location: string) => new Response(null, { status: 302, headers: { location } });
const noResults = () =>
  new Response("<title>Govinfo Link Service Error</title>No Results Found", { status: 400 });

function mockFetch(route: Route): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string, init?: RequestInit) => {
      const call: Call = {
        url: String(input),
        method: init?.method ?? "GET",
        body: typeof init?.body === "string" ? init.body : "",
        headers: (init?.headers ?? {}) as Record<string, string>,
        redirect: init?.redirect,
      };
      calls.push(call);
      return route(call);
    }),
  );
  return calls;
}

const cluster = (id: number, name: string, date: string, slug: string) => ({
  id,
  absolute_url: `/opinion/${id}/${slug}/`,
  case_name: name,
  date_filed: date,
  date_filed_is_approximate: false,
  blocked: false,
  citations: [],
});

/** Answers citation-lookup by finding each known citation's position in the posted text, as the real API does. */
function caseLawRoute(call: Call): Response {
  if (call.url.endsWith("/citation-lookup/")) {
    const text = new URLSearchParams(call.body).get("text") ?? "";
    const rows: unknown[] = [];
    const known: Record<string, { status: number; clusters: unknown[]; normalized?: string[] }> = {
      "576 U.S. 644": {
        status: 200,
        clusters: [cluster(2812209, "Obergefell v. Hodges", "2015-06-26", "obergefell-v-hodges")],
      },
      "999 F.3d 99999": { status: 404, clusters: [] },
      "123 F. Supp. 456": {
        status: 300,
        clusters: [
          cluster(8535319, "Louis v. Steamboat Buckeye", "1854-06-15", "louis-v-steamboat-buckeye"),
          cluster(6606131, "Fell v. Parke", "1854-10-15", "fell-v-parke"),
        ],
      },
    };
    for (const [cite, r] of Object.entries(known)) {
      const at = text.indexOf(cite);
      if (at >= 0)
        rows.push({
          citation: cite,
          normalized_citations: r.normalized ?? [cite],
          start_index: at,
          end_index: at + cite.length,
          status: r.status,
          error_message: r.status === 404 ? `Citation not found: '${cite}'` : "",
          clusters: r.clusters,
        });
    }
    // Any other citation in the text is reported as not found.
    for (const m of text.matchAll(/\d+ [A-Za-z. ']+ \d+/g))
      if (!Object.keys(known).includes(m[0]))
        rows.push({ citation: m[0], start_index: m.index, status: 404, clusters: [] });
    return json(200, rows);
  }
  if (call.url.includes("/search/")) {
    const courts: Record<number, string> = {
      2812209: "Supreme Court of the United States",
      8535319: "Ohio Superior Court, Cincinnati",
      6606131: "Hawaii Supreme Court",
    };
    const q = new URL(call.url).searchParams.get("q") ?? "";
    const ids = [...q.matchAll(/\d+/g)].map((m) => Number(m[0]));
    return json(200, {
      count: ids.length,
      results: ids
        .filter((id) => courts[id])
        .map((id) => ({
          cluster_id: id,
          court: courts[id],
          caseName: id === 2812209 ? "Obergefell v. Hodges" : "Other",
          dateFiled: "2015-06-26",
          citation: ["576 U.S. 644", "135 S. Ct. 2584"],
          docketNumber: "14-556",
          absolute_url: `/opinion/${id}/obergefell-v-hodges/`,
        })),
    });
  }
  return json(404, {});
}

// The stored current U.S. Code: null means the corpus cannot be read (the checker then uses the link service alone).
const corpus = vi.hoisted(() => ({
  rows: null as Record<string, unknown>[] | null,
  paths: [] as string[],
}));
vi.mock("@/lib/external/rest.server", () => ({
  restGet: vi.fn(async (path: string) => {
    corpus.paths.push(path);
    if (!corpus.rows) throw new Error("corpus not configured");
    const wanted = decodeURIComponent(path);
    return {
      rows: corpus.rows.filter((r) => wanted.includes(`"${String(r["id"])}"`)),
      total: null,
    };
  }),
}));
const storedUsc = (id: string, citation: string, extra: Record<string, unknown> = {}) => {
  const [title, sec] = id.split(":");
  return {
    id,
    citation,
    heading: "Statements or entries generally",
    status: null,
    url: `https://uscode.house.gov/us/usc/119-124/t${title}/s${sec}/`,
    release: "119-124",
    law_date: "2026-10-15",
    ...extra,
  };
};

const savedEnv = { ...process.env };
beforeEach(() => {
  __resetCitationState(0);
  process.env["COURTLISTENER_API_KEY"] = "test-key";
});
afterEach(() => {
  vi.unstubAllGlobals();
  process.env = { ...savedEnv };
  corpus.rows = null;
  corpus.paths.length = 0;
});

describe("case citations", () => {
  it("looks up a batch in one request and adds the court from one search", async () => {
    const calls = mockFetch(caseLawRoute);
    const items = await checkCitations(
      extractCitations(
        "Obergefell, 576 U.S. 644 (2015); Varghese, 999 F.3d 99999; 123 F. Supp. 456",
      ),
    );
    const lookup = calls.filter((c) => c.url.endsWith("/citation-lookup/"));
    expect(lookup).toHaveLength(1);
    expect(lookup[0]!.method).toBe("POST");
    expect(lookup[0]!.headers["authorization"]).toBe("Token test-key");
    expect(lookup[0]!.headers["content-type"]).toBe("application/x-www-form-urlencoded");
    expect(calls.filter((c) => c.url.includes("/search/"))).toHaveLength(1);
    expect(items.map((i) => i.status)).toEqual(["found", "not_found", "ambiguous"]);
    expect(items[0]).toMatchObject({
      citation: "576 U.S. 644",
      title: "Obergefell v. Hodges",
      court: "Supreme Court of the United States",
      date: "2015-06-26",
      clusterId: 2812209,
      url: "https://www.courtlistener.com/opinion/2812209/obergefell-v-hodges/",
      httpStatus: 200,
    });
    expect(items[1]!.reason).toMatch(/No decision with this citation/);
    expect(items[1]!.title).toBeNull();
    expect(items[2]!.normalized).toBe("123 F. Supp. 456");
    expect(items[2]!.matches.map((m) => [m.title, m.court])).toEqual([
      ["Louis v. Steamboat Buckeye", "Ohio Superior Court, Cincinnati"],
      ["Fell v. Parke", "Hawaii Supreme Court"],
    ]);
  });

  it("reuses results within the conversation instead of looking them up again", async () => {
    const calls = mockFetch(caseLawRoute);
    await checkCitations(extractCitations("576 U.S. 644 and 999 F.3d 99999"));
    const before = calls.length;
    const again = await checkCitations(extractCitations("See 576 U.S. 644, 650; 999 F.3d 99999."));
    expect(calls.length).toBe(before);
    expect(again.map((i) => i.status)).toEqual(["found", "not_found"]);
  });

  it("says plainly that case citations were not checked when no key is configured", async () => {
    delete process.env["COURTLISTENER_API_KEY"];
    const calls = mockFetch(caseLawRoute);
    const [item] = await checkCitations(extractCitations("576 U.S. 644"));
    expect(calls).toHaveLength(0);
    expect(item).toMatchObject({ status: "unverified" });
    expect(item!.reason).toMatch(/not configured/);
    expect(availableTools().map((t) => t.name)).toContain("verify_citations");
    expect(availableTools().map((t) => t.name)).not.toContain("get_opinion");
  });

  it("keeps to 60 citations a minute and marks the rest as not checked", async () => {
    mockFetch(caseLawRoute);
    const text = Array.from({ length: 65 }, (_, i) => `${i + 1} F.3d ${100 + i}`).join("; ");
    const items = await checkCitations(extractCitations(text), { max: 80 });
    expect(items.filter((i) => i.status === "not_found")).toHaveLength(60);
    const skipped = items.filter((i) => i.status === "unverified");
    expect(skipped).toHaveLength(5);
    expect(skipped[0]!.reason).toMatch(/60 citations a minute/);
  });

  it("stops looking up after a 429 until the wait time", async () => {
    const wait = new Date(Date.now() + 120_000).toISOString();
    const calls = mockFetch(() => json(429, { wait_until: wait }));
    const first = await checkCitations(extractCitations("576 U.S. 644"));
    expect(first[0]!.status).toBe("unverified");
    expect(first[0]!.reason).toMatch(/wait until/);
    const n = calls.length;
    const second = await checkCitations(extractCitations("410 U.S. 113"));
    expect(calls.length).toBe(n);
    expect(second[0]!.status).toBe("unverified");
  });

  it("marks citations the lookup did not recognize as not found, never as another case", async () => {
    mockFetch(() => json(200, []));
    const [item] = await checkCitations(extractCitations("12 Cal. App. 5th 34"));
    expect(item).toMatchObject({ status: "not_found", title: null, clusterId: null, url: null });
  });
});

describe("statutes and regulations", () => {
  const officialRoute: Route = (call) => {
    const u = call.url;
    if (u.includes("/link/uscode/18/1001"))
      return redirect(
        "https://www.govinfo.gov/content/pkg/USCODE-2024-title18/html/USCODE-2024-title18-partI-chap47-sec1001.htm",
      );
    if (u.includes("/link/cfr/21/101?sectionnum=9&"))
      return redirect(
        "https://www.govinfo.gov/content/pkg/CFR-2025-title21-vol2/pdf/CFR-2025-title21-vol2-sec101-9.pdf",
      );
    if (u.endsWith("/ancestry/current/title-21.json?section=101.9"))
      return json(200, {
        ancestors: [
          { identifier: "21", label: "Title 21—Food and Drugs", type: "title" },
          {
            identifier: "101.9",
            label: "§ 101.9 Nutrition labeling of food.",
            type: "section",
            reserved: false,
          },
        ],
      });
    if (u.includes("/link/cfr/21/101?sectionnum=999&"))
      return redirect(
        "https://www.govinfo.gov/content/pkg/CFR-2025-title21-vol2/pdf/CFR-2025-title21-vol2-sec101-999.pdf",
      );
    if (u.includes("/link/statute/124/119"))
      return redirect(
        "https://www.govinfo.gov/content/pkg/STATUTE-124/pdf/STATUTE-124-Pg119.pdf#page=1",
      );
    if (u.includes("/link/fr/85/999999")) return noResults();
    if (u.includes("/link/uscode/18/99999")) return noResults();
    if (u.includes("/link/cfr/21/9999")) return noResults();
    if (u.includes("/ancestry/")) return json(404, null);
    if (u.includes("/link/plaw/111/public/148")) throw new TypeError("fetch failed");
    return noResults();
  };

  it("resolves through the link service without following the redirect", async () => {
    const calls = mockFetch(officialRoute);
    const items = await checkCitations(
      extractCitations(
        "18 U.S.C. § 1001(a); 18 U.S.C. § 99999; 124 Stat. 119; 85 Fed. Reg. 999,999; Pub. L. No. 111-148; Pub. L. No. 88-352; 99 U.S.C. § 1",
      ),
    );
    expect(items.map((i) => [i.normalized, i.status])).toEqual([
      ["18 U.S.C. § 1001", "found"],
      ["18 U.S.C. § 99999", "not_found"],
      ["124 Stat. 119", "found"],
      ["85 Fed. Reg. 999999", "not_found"],
      ["Pub. L. No. 111-148", "unverified"],
      ["Pub. L. No. 88-352", "unverified"],
      ["99 U.S.C. § 1", "not_found"],
    ]);
    expect(items[0]).toMatchObject({
      httpStatus: 302,
      url: "https://www.govinfo.gov/content/pkg/USCODE-2024-title18/html/USCODE-2024-title18-partI-chap47-sec1001.htm",
    });
    expect(items[0]!.reason).toMatch(/2024 edition of the U\.S\. Code/);
    expect(items[1]).toMatchObject({ httpStatus: 400 });
    expect(items[1]!.url).toBe(
      "https://www.govinfo.gov/link/uscode/18/99999?year=mostrecent&link-type=html",
    );
    expect(items[4]!.reason).toMatch(/did not answer/);
    expect(items[5]!.reason).toMatch(/104th Congress/);
    // Pre-1995 public laws and impossible titles are answered without a request.
    expect(calls.some((c) => c.url.includes("/plaw/88/"))).toBe(false);
    expect(calls.some((c) => c.url.includes("/uscode/99/"))).toBe(false);
    for (const c of calls.filter((c) => c.url.includes("/link/")))
      expect(c.redirect).toBe("manual");
  });

  it("finds U.S.C. sections in the stored current Code without asking the link service", async () => {
    corpus.rows = [
      storedUsc("18:1001", "18 U.S.C. § 1001"),
      storedUsc("18:14", "18 U.S.C. § 14", { heading: "Repealed.", status: "repealed" }),
    ];
    const calls = mockFetch(officialRoute);
    const [current, repealed] = await checkCitations(
      extractCitations("18 U.S.C. § 1001(a); 18 U.S.C. § 14"),
    );
    expect(current).toMatchObject({
      status: "found",
      title: "Statements or entries generally",
      url: "https://uscode.house.gov/us/usc/119-124/t18/s1001/",
      links: [
        {
          label: "Official text (current)",
          url: "https://uscode.house.gov/us/usc/119-124/t18/s1001/",
        },
        { label: "Section page", url: "/law/uscode/18/1001" },
      ],
    });
    expect(current!.reason).toMatch(/release point 119-124, current through 2026-10-15/);
    expect(repealed!.status).toBe("found");
    expect(repealed!.reason).toMatch(/18 U\.S\.C\. § 14 is marked repealed/);
    expect(calls.some((c) => c.url.includes("/link/uscode/"))).toBe(false);
    expect(corpus.paths.map((p) => decodeURIComponent(p))).toContainEqual(
      expect.stringContaining('dataset=eq.us_code_sections&id=in.("18:1001")'),
    );
  });

  it("falls back to the link service when the stored Code lacks a section, and says so", async () => {
    corpus.rows = [storedUsc("42:1981", "42 U.S.C. § 1981")];
    mockFetch((call) =>
      call.url.includes("/link/uscode/18/1001")
        ? redirect(
            "https://www.govinfo.gov/content/pkg/USCODE-2024-title18/html/USCODE-2024-title18-partI-chap47-sec1001.htm",
          )
        : call.url.includes("/link/uscode/42/")
          ? redirect("https://www.govinfo.gov/content/pkg/USCODE-2024-title42/html/x.htm")
          : noResults(),
    );
    const [onlyEdition, missing, range] = await checkCitations(
      extractCitations("18 U.S.C. § 1001; 18 U.S.C. § 99999; 42 U.S.C. §§ 1981–1983"),
    );
    expect(onlyEdition!.status).toBe("found");
    expect(onlyEdition!.reason).toMatch(
      /2024 edition of the U\.S\. Code\. Not in the current U\.S\. Code text stored in this workspace: 18 U\.S\.C\. § 1001 \(it may have been repealed or renumbered since that edition\)\./,
    );
    expect(missing!.status).toBe("not_found");
    expect(missing!.reason).toMatch(
      /Not in the current U\.S\. Code text stored in this workspace: 18 U\.S\.C\. § 99999\.$/,
    );
    expect(range!.status).toBe("found");
    expect(range!.reason).toMatch(/stored in this workspace: 42 U\.S\.C\. § 1983 \(/);
  });

  it("checks C.F.R. sections against the current eCFR and the annual edition", async () => {
    mockFetch(officialRoute);
    const [current, removed, missing] = await checkCitations(
      extractCitations("21 C.F.R. § 101.9(c); 21 C.F.R. § 101.999; 21 C.F.R. § 9999.1"),
    );
    expect(current).toMatchObject({
      status: "found",
      title: "§ 101.9 Nutrition labeling of food.",
      url: "https://www.ecfr.gov/current/title-21/section-101.9",
    });
    expect(current!.links.map((l) => l.label)).toEqual(["eCFR (current)", "2025 annual edition"]);
    expect(removed!.status).toBe("not_found");
    expect(removed!.reason).toMatch(/removed or renumbered/);
    expect(missing!.status).toBe("not_found");
    expect(missing!.links).toEqual([
      {
        label: "Lookup",
        url: "https://www.govinfo.gov/link/cfr/21/9999?sectionnum=1&year=mostrecent&link-type=pdf",
      },
    ]);
    expect(missing!.reason).toMatch(/Not in the current eCFR or the latest annual edition/);
  });

  it("builds official lookup addresses for ranges, parts and Treasury-style sections", () => {
    const [range, part, treasury, pl] = extractCitations(
      "42 U.S.C. §§ 1981–1983; 21 C.F.R. Part 11; 26 C.F.R. § 1.401(k)-1; Pub. L. No. 111-148",
    );
    expect(officialLookups(range!).map((l) => l.link)).toEqual([
      "https://www.govinfo.gov/link/uscode/42/1981?year=mostrecent&link-type=html",
      "https://www.govinfo.gov/link/uscode/42/1983?year=mostrecent&link-type=html",
    ]);
    expect(officialLookups(part!)).toEqual([
      {
        link: "https://www.govinfo.gov/link/cfr/21/11?year=mostrecent&link-type=pdf",
        ecfr: "part:11",
        ecfrPage: "https://www.ecfr.gov/current/title-21/part-11",
      },
    ]);
    expect(officialLookups(treasury!)[0]).toMatchObject({
      link: "https://www.govinfo.gov/link/cfr/26/1?sectionnum=401(k)-1&year=mostrecent&link-type=pdf",
      ecfr: "1.401(k)-1",
    });
    expect(officialLookups(pl!)[0]!.link).toBe(
      "https://www.govinfo.gov/link/plaw/111/public/148?link-type=pdf",
    );
  });
});

describe("answer check", () => {
  it("lists every citation in the answer with counts, checking at most 40 and counting the rest", async () => {
    mockFetch(caseLawRoute);
    const text = Array.from({ length: 64 }, (_, i) => `${i + 1} F.3d ${100 + i}`).join("; ");
    const check = (await checkAnswerCitations(`See 576 U.S. 644. ${text}`))!;
    expect(check.total).toBe(60);
    expect(check.more).toBe(5);
    expect(check.items[0]!.status).toBe("found");
    expect(check.counts.unverified).toBe(20);
    expect(check.items.at(-1)!.reason).toMatch(/first 40/);
    expect(citationSummary(check)).toBe(
      "60 citations checked · 39 not found · 20 could not be checked · 5 more not checked",
    );
  });

  it("returns nothing when the answer has no citations, and reports progress as a step otherwise", async () => {
    mockFetch(caseLawRoute);
    const events: AssistantEvent[] = [];
    const none = await answerCitationCheck(
      "No authorities here.",
      (e) => events.push(e),
      new AbortController().signal,
    );
    expect(none).toBeNull();
    expect(events).toEqual([]);
    const check = await answerCitationCheck(
      "Obergefell v. Hodges, 576 U.S. 644 (2015); Smith v. Jones, 999 F.3d 99999.",
      (e) => events.push(e),
      new AbortController().signal,
    );
    expect(check!.counts).toEqual({ found: 1, ambiguous: 0, not_found: 1, unverified: 0 });
    expect(
      events.map((e) => (e.type === "step" ? [e.step.label, e.step.state, e.step.detail] : e.type)),
    ).toEqual([
      ["Checking citations", "running", "2 in the answer"],
      ["Checked citations", "done", "2 citations checked · 1 not found"],
    ]);
  });

  it("attaches the check to the final answer event", async () => {
    process.env["ANTHROPIC_API_KEY"] = "test-model-key";
    const answer =
      "Obergefell v. Hodges, 576 U.S. 644 (2015), applies. Smith v. Jones, 999 F.3d 99999 (9th Cir. 2021), does not exist.";
    const sse = [
      { type: "message_start", message: {} },
      { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
      { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: answer } },
      { type: "content_block_stop", index: 0 },
      { type: "message_delta", delta: { stop_reason: "end_turn" } },
      { type: "message_stop" },
    ]
      .map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`)
      .join("");
    mockFetch((call) =>
      call.url.startsWith("https://api.anthropic.com/")
        ? new Response(sse, { status: 200, headers: { "content-type": "text/event-stream" } })
        : caseLawRoute(call),
    );
    const events: AssistantEvent[] = [];
    await runAssistant(
      {
        messages: [{ role: "user", content: "Is there a right to marry?" }],
        page: null,
        attachments: [],
      },
      (e) => events.push(e),
      new AbortController().signal,
      "2026-10-22",
    );
    const done = events.find((e) => e.type === "done");
    expect(done && done.type === "done" && done.text).toBe(answer);
    const check = done && done.type === "done" ? (done.citation_check as CitationCheck) : null;
    expect(check!.items.map((i) => [i.citation, i.status])).toEqual([
      ["576 U.S. 644", "found"],
      ["999 F.3d 99999", "not_found"],
    ]);
    // The answer text is never edited: the unresolved citation stays in it.
    expect(done && done.type === "done" && done.text).toContain("999 F.3d 99999");
  });
});

describe("protocol", () => {
  it("sanitizes a stored check: unsafe links dropped, counts recomputed, junk rejected", () => {
    const check = sanitizeCitationCheck({
      total: 99,
      counts: { found: 99 },
      more: 0,
      checkedAt: "2026-10-22T00:00:00Z",
      items: [
        {
          citation: "576 U.S. 644",
          normalized: "576 U.S. 644",
          kind: "case",
          status: "found",
          reason: "Found",
          url: "javascript:alert(1)",
          links: [
            { label: "Decision", url: "https://www.courtlistener.com/opinion/2812209/x/" },
            { label: "Bad", url: "data:text/html,x" },
            { label: "Section page", url: "/law/uscode/42/1983" },
            { label: "Elsewhere", url: "//evil.example/x" },
          ],
          matches: [],
        },
        { citation: "x", status: "verified", kind: "case" },
      ],
    })!;
    expect(check.total).toBe(1);
    expect(check.counts).toEqual({ found: 1, ambiguous: 0, not_found: 0, unverified: 0 });
    expect(check.items[0]!.url).toBeNull();
    expect(check.items[0]!.links).toEqual([
      { label: "Decision", url: "https://www.courtlistener.com/opinion/2812209/x/" },
      { label: "Section page", url: "/law/uscode/42/1983" },
    ]);
    expect(sanitizeCitationCheck({ items: "nope" })).toBeNull();
    expect(sanitizeCitationCheck(null)).toBeNull();
  });
});

describe("tools", () => {
  it("are described without naming vendors, and verify_citations reports statuses with sources for found items only", async () => {
    const text = JSON.stringify(
      TOOL_DEFINITIONS.filter((t) => ["verify_citations", "get_opinion"].includes(t.name)),
    );
    expect(text).not.toMatch(/courtlistener|anthropic|claude|openai|tavily|firecrawl/i);
    mockFetch(caseLawRoute);
    const out = await CITATION_EXECUTORS["verify_citations"]!({
      citations: ["576 U.S. 644", "999 F.3d 99999"],
    });
    const body = JSON.parse(out.content) as {
      citations: { status: string; cluster_id?: number; court?: string }[];
    };
    expect(body.citations.map((c) => c.status)).toEqual(["found", "not_found"]);
    expect(body.citations[0]).toMatchObject({
      cluster_id: 2812209,
      court: "Supreme Court of the United States",
    });
    expect(out.sources).toHaveLength(1);
    expect(out.detail).toBe("2 citations checked · 1 not found");
    const empty = await CITATION_EXECUTORS["verify_citations"]!({
      text: "Id. at 5; supra note 2.",
    });
    expect(JSON.parse(empty.content)).toMatchObject({ checked: 0 });
  });

  it("reads an opinion by cluster id in windows, finds passages, and caches the text", async () => {
    const calls = mockFetch((call) => {
      if (call.url.includes("/opinions/?"))
        return json(200, {
          results: [
            {
              id: 2,
              absolute_url: "/opinion/2812209/obergefell-v-hodges/",
              cluster_id: 2812209,
              type: "040dissent",
              author_str: "Roberts",
              html_with_citations:
                "<p>The majority&#8217;s decision is an act of will, not legal judgment.</p>",
            },
            {
              id: 1,
              absolute_url: "/opinion/2812209/obergefell-v-hodges/",
              cluster_id: 2812209,
              type: "020lead",
              author_str: "Kennedy",
              ordering_key: 1,
              html_with_citations:
                "<opinion><p>The Constitution promises liberty to all within its reach &amp; more.</p><p>" +
                "x".repeat(20000) +
                "</p></opinion>",
            },
          ],
        });
      return caseLawRoute(call);
    });
    const first = await CITATION_EXECUTORS["get_opinion"]!({ cluster_id: 2812209 });
    const body = JSON.parse(first.content.replace(/\n…\[truncated\]$/, "")) as Record<
      string,
      unknown
    >;
    expect(body).toMatchObject({
      case_name: "Obergefell v. Hodges",
      court: "Supreme Court of the United States",
      url: "https://www.courtlistener.com/opinion/2812209/obergefell-v-hodges/",
      start: 0,
      next_start: 14000,
    });
    expect((body["opinions"] as { type: string }[]).map((o) => o.type)).toEqual([
      "Lead opinion",
      "Dissent",
    ]);
    expect(String(body["text"])).toContain("[Lead opinion · Kennedy · opinion 1]");
    expect(String(body["text"])).toContain("promises liberty to all within its reach & more.");
    const n = calls.length;
    const found = await CITATION_EXECUTORS["get_opinion"]!({
      cluster_id: 2812209,
      find: "act of will",
    });
    expect(calls.length).toBe(n);
    const hits = JSON.parse(found.content) as {
      occurrences: number;
      matches: { excerpt: string }[];
    };
    expect(hits.occurrences).toBe(1);
    expect(hits.matches[0]!.excerpt).toContain("The majority’s decision is an act of will");
    await expect(CITATION_EXECUTORS["get_opinion"]!({})).rejects.toThrow(
      /cluster_id or opinion_id/,
    );
  });

  it("converts opinion markup to text without inventing anything", () => {
    expect(
      opinionText("<p>A&nbsp;&sect;&nbsp;1983 claim</p><p>Second<br/>line &unknown;</p>"),
    ).toBe("A § 1983 claim\n\nSecond\nline &unknown;");
    const doc = buildOpinionDoc(
      [{ id: 5, type: "010combined", plain_text: "", html_with_citations: "" }],
      null,
    );
    expect(doc.title).toBeNull();
    expect(doc.text).toContain("No text for this opinion is available");
  });
});
