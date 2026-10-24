import { describe, expect, it } from "vitest";
import {
  buildSearchRequest,
  CASE_LAW_TOOL,
  queryProblem,
  runCaseLawSearch,
} from "./caseLawSearch.server";

const q = (query: string, extra: Record<string, unknown> = {}) =>
  buildSearchRequest({ query, ...extra });

describe("buildSearchRequest passes the advanced syntax through unchanged", () => {
  it.each([
    ['"qualified immunity"'],
    ['(customs OR "border patrol") AND asylum'],
    ['"border fence"~50'],
    ['immigration AND border AND -"border patrol"'],
    ['"border patrol" NOT (immigration OR asylum)'],
    ["immigra* OR ?mmigra* OR immigrant~1"],
    ["citation:([22 TO 23] F2)"],
    ["caseName:(wade OR roe) AND court_id:scotus"],
    ["citeCount:[100 TO *] AND dateFiled:[2018-10-01 TO 2018-10-31]"],
    ["cites:(108713)"],
  ])("%s", (query) => {
    const r = q(query);
    expect(r.q).toBe(query);
    expect(r.params.get("q")).toBe(query);
    // URL encoding keeps every operator character intact on the way back
    expect(new URLSearchParams(r.params.toString()).get("q")).toBe(query);
  });

  it("joins a date filter with AND around the user's own grouping", () => {
    const r = q("arbitration OR waiver", { filed_after: "2020-01-01", filed_before: "2020-12-31" });
    expect(r.q).toBe("(arbitration OR waiver) AND dateFiled:[2020-01-01 TO 2020-12-31]");
  });

  it("uses an open end when one date is given, and the argued date for oral arguments", () => {
    expect(q("Daubert", { filed_after: "2024-01-01" }).q).toBe(
      "(Daubert) AND dateFiled:[2024-01-01 TO *]",
    );
    expect(q("Daubert", { type: "oa", filed_before: "2010-12-31" }).q).toBe(
      "(Daubert) AND dateArgued:[* TO 2010-12-31]",
    );
  });

  it("maps statuses to the API switches and says when only published opinions are searched", () => {
    const r = q('"class certification"', { statuses: ["published", "unpublished"] });
    expect(r.params.get("stat_Published")).toBe("on");
    expect(r.params.get("stat_Unpublished")).toBe("on");
    expect(q("x y z").notes.join(" ")).toMatch(/Only published opinions/);
  });

  it("accepts several court ids and the documented sort orders", () => {
    const r = q("preemption", { court: "ca9 cand", order_by: "citeCount desc" });
    expect(r.params.get("court")).toBe("ca9 cand");
    expect(r.params.get("order_by")).toBe("citeCount desc");
    expect(q("preemption").params.get("order_by")).toBe("score desc");
  });

  it("marks docket counts as approximate", () => {
    expect(q("antitrust", { type: "r" }).notes.join(" ")).toMatch(/±6%/);
  });
});

describe("refusals instead of silent misreading", () => {
  it.each([
    ['"qualified immunity', /odd number of double quotes/],
    ["(customs OR border", /parentheses/],
    ["customs) OR (border", /closing parenthesis/],
    ["dateFiled:[2018-10-01 to 2018-10-31]", /TO in capitals/],
    ["a* OR immigration", /three letters/],
    ["x".repeat(1001), /longer than 1000/],
    ["   ", /query required/],
  ])("%s", (query, why) => {
    expect(queryProblem(query)).toMatch(why);
    expect(() => q(query)).toThrow(why);
  });

  it("refuses inputs that do not fit the search type", () => {
    expect(() => q("x y z", { type: "r", statuses: ["published"] })).toThrow(/\(type o\) only/);
    expect(() => q("x y z", { type: "p", filed_after: "2020-01-01" })).toThrow(/judge searches/);
    expect(() => q("x y z", { filed_after: "01/01/2020" })).toThrow(/YYYY-MM-DD/);
    expect(() => q("x y z", { court: "ca9; drop" })).toThrow(/court ids/);
    expect(() => q("x y z", { type: "oa", order_by: "citeCount desc" })).toThrow(/order_by/);
  });
});

describe("runCaseLawSearch", () => {
  it("sends the key as a header, never in the URL, and returns counts, results and the search page", async () => {
    const calls: { url: string; auth: string | undefined }[] = [];
    const out = await runCaseLawSearch(
      {
        query: '"class waiver arbitration"~10',
        statuses: ["published", "unpublished"],
        filed_after: "2020-01-01",
      },
      "secret-key",
      async (url, init) => {
        calls.push({ url, auth: init.headers["authorization"] });
        return new Response(
          JSON.stringify({
            count: 1234,
            results: [
              {
                caseName: "A v. B",
                court: "Court of Appeals for the Ninth Circuit",
                court_id: "ca9",
                dateFiled: "2021-05-04",
                citation: ["1 F.4th 2"],
                status: "Published",
                absolute_url: "/opinion/1/a-v-b/",
                opinions: [{ snippet: "class waiver in the arbitration agreement" }],
              },
            ],
          }),
          { status: 200 },
        );
      },
    );
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).not.toContain("secret-key");
    expect(calls[0]!.auth).toBe("Token secret-key");
    const u = new URL(calls[0]!.url);
    expect(u.searchParams.get("q")).toBe(
      '("class waiver arbitration"~10) AND dateFiled:[2020-01-01 TO *]',
    );
    const body = JSON.parse(out.content);
    expect(body.count).toBe(1234);
    expect(body.results[0]).toMatchObject({
      case: "A v. B",
      court_id: "ca9",
      url: "https://www.courtlistener.com/opinion/1/a-v-b/",
    });
    expect(body.search_page.startsWith("https://www.courtlistener.com/?")).toBe(true);
    expect(out.detail).toContain("1,234 matches");
  });

  it("says a large docket count is approximate", async () => {
    const out = await runCaseLawSearch(
      { query: "antitrust", type: "r" },
      "k",
      async () => new Response(JSON.stringify({ count: 52000, results: [] })),
    );
    expect(JSON.parse(out.content).count_is_approximate).toBe(true);
    expect(out.detail).toContain("about 52,000");
  });

  it("returns the engine's reason when it refuses a query", async () => {
    await expect(
      runCaseLawSearch(
        { query: "x y z" },
        "k",
        async () =>
          new Response(
            JSON.stringify({ detail: "The query contains a disallowed wildcard pattern." }),
            { status: 400 },
          ),
      ),
    ).rejects.toThrow(/disallowed wildcard/);
  });

  it("is not configured without a key", async () => {
    await expect(runCaseLawSearch({ query: "x y z" }, null)).rejects.toThrow(/not configured/);
  });

  it("documents the operators in the tool description", () => {
    for (const term of [
      '"border fence"~50',
      "[A TO B]".replace("A TO B", "1939 TO 1945"),
      "caseName",
      "court_id",
      "dateFiled",
      "cites:(",
      "statuses",
      "count_only",
    ])
      expect(CASE_LAW_TOOL.description).toContain(term);
  });
});
