/**
 * The assistant's case-law and federal-docket search tool (search_case_law) over CourtListener's v4 search API.
 *
 * The query is passed to the search engine verbatim (only URL-encoded): CourtListener's advanced syntax — phrases, AND / OR /
 * NOT and `-`, parentheses, `"words"~N` proximity, `*` `?` `!` wildcards, `~` fuzzy terms, `[A TO B]` ranges and fielded
 * queries such as `caseName:`, `court_id:`, `dateFiled:` and `citation:` — reaches it unchanged. Structured inputs (courts,
 * dates, precedential statuses, ordering) map to the API's own GET parameters or to a fielded date range joined with AND.
 * A query is never truncated: one that is too long, or whose quotes or parentheses do not balance (the engine would ignore
 * them silently), is refused with the reason. Docket counts (types r and d) are reported as approximate, as CourtListener
 * documents (cardinality counts, ±6% above 2,000 results). The key comes only from the server environment.
 */
import type { ToolDefinition, ToolOutcome } from "./tools.server";

const API = "https://www.courtlistener.com/api/rest/v4/search/";
const FRONT = "https://www.courtlistener.com/";
const MAX_QUERY = 1000;
export const SEARCH_TYPES = ["o", "r", "d", "rd", "oa", "p"] as const;
export type SearchType = (typeof SEARCH_TYPES)[number];
export const STATUSES = [
  "published",
  "unpublished",
  "errata",
  "separate",
  "in-chambers",
  "relating-to",
  "unknown",
] as const;
const STATUS_PARAM: Record<(typeof STATUSES)[number], string> = {
  published: "stat_Published",
  unpublished: "stat_Unpublished",
  errata: "stat_Errata",
  separate: "stat_Separate",
  "in-chambers": "stat_In-chambers",
  "relating-to": "stat_Relating-to",
  unknown: "stat_Unknown",
};
/** Sort orders offered per type (the front end's ordering menu); relevance is the default everywhere. */
const ORDER: Record<SearchType, readonly string[]> = {
  o: ["score desc", "dateFiled desc", "dateFiled asc", "citeCount desc", "citeCount asc"],
  r: ["score desc", "dateFiled desc", "dateFiled asc"],
  d: ["score desc", "dateFiled desc", "dateFiled asc"],
  rd: ["score desc", "dateFiled desc", "dateFiled asc"],
  oa: ["score desc", "dateArgued desc", "dateArgued asc"],
  p: ["score desc"],
};
/** The date field a date range applies to, per type (none for judges). */
const DATE_FIELD: Partial<Record<SearchType, string>> = {
  o: "dateFiled",
  r: "dateFiled",
  d: "dateFiled",
  rd: "dateFiled",
  oa: "dateArgued",
};
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const COURT = /^[a-z0-9]{2,20}$/;

export const CASE_LAW_TOOL: ToolDefinition = {
  name: "search_case_law",
  description: [
    "Search the free law archive: court opinions (type o, default), federal dockets with their filings (r), dockets only (d), filings only (rd), oral-argument recordings (oa) or judges (p).",
    'The query uses the archive\'s advanced syntax and is sent unchanged: phrases in double quotes match exactly (no stemming or synonyms); AND (or &), OR, NOT (or %) and a leading - combine terms; parentheses group, e.g. (customs OR "border patrol") AND asylum; "border fence"~50 finds the words within 50 words of each other; immigra* or !immigra match word starts, gr*mm*r and ?mmigra* single characters, immigrant~ (or ~1) spelling variants; [1939 TO 1945] and fielded ranges like citeCount:[100 TO *] or dateFiled:[2018-10-01 TO 2018-10-31] (ISO dates, TO in capitals).',
    "Fielded queries: opinions — caseName, court_id, dateFiled, dateArgued, docketNumber, citation (e.g. citation:(410 U.S. 113)), neutralCite, judge, author_id, panel_ids, status (published, unpublished...), type (lead-opinion, dissent...), suitNature, posture, syllabus, procedural_history, citeCount, cites (opinions citing an opinion id: cites:(108713)), cluster_id, per_curiam; dockets and filings — caseName, docketNumber, court_id, dateFiled, dateTerminated, party, attorney, firm, assignedTo, referredTo, suitNature, cause, juryDemand, jurisdictionType, chapter, description, document_number, page_count, is_available, plain_text; oral arguments — caseName, court_id, judge, dateArgued, docketNumber; judges — name, court, appointer, school, political_affiliation, aba_rating, position_type, date_confirmation, selection_method. related:<opinion id> finds similar opinions.",
    "Use court (space-separated court ids such as 'ca9 cand'), filed_after / filed_before (YYYY-MM-DD; argued dates for oral arguments) and statuses (case law only; by default only published opinions are searched) instead of writing them into the query. Set count_only when only the number of matches is needed.",
    "Results carry case names, courts, dates, citations, links to each item and the reproducible search page; docket counts are approximate above 2,000 results.",
  ].join(" "),
  input_schema: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "Advanced-syntax query, sent unchanged (at most 1,000 characters).",
      },
      type: { type: "string", enum: [...SEARCH_TYPES] },
      court: {
        type: "string",
        description: "Optional court ids separated by spaces, e.g. 'scotus ca9 cand'.",
      },
      filed_after: { type: "string", description: "YYYY-MM-DD, inclusive." },
      filed_before: { type: "string", description: "YYYY-MM-DD, inclusive." },
      statuses: {
        type: "array",
        items: { type: "string", enum: [...STATUSES] },
        description: "Precedential statuses to include (case law only). Default: published only.",
      },
      order_by: {
        type: "string",
        description:
          "Optional sort: 'score desc' (relevance, default), 'dateFiled desc|asc', 'citeCount desc|asc' (opinions), 'dateArgued desc|asc' (oral arguments).",
      },
      count_only: { type: "boolean", description: "Return the number of matches only." },
    },
    required: ["query"],
  },
};

export type SearchRequest = {
  params: URLSearchParams;
  q: string;
  type: SearchType;
  notes: string[];
};

/** Why a query would be misread by the engine, or null when it is well formed. */
export function queryProblem(q: string): string | null {
  if (!q.trim()) return "query required";
  if (q.length > MAX_QUERY)
    return `query is longer than ${MAX_QUERY} characters; split it into several searches`;
  if ((q.match(/"/g) ?? []).length % 2)
    return "the query has an odd number of double quotes; the search engine would ignore them all";
  let depth = 0;
  let inQuote = false;
  for (const ch of q) {
    if (ch === '"') inQuote = !inQuote;
    else if (!inQuote && ch === "(") depth++;
    else if (!inQuote && ch === ")" && --depth < 0)
      return "a closing parenthesis has no opening one";
  }
  if (depth !== 0) return "the parentheses in the query do not balance";
  if (/\[[^\]]*\s+to\s+[^\]]*\]/.test(q) && !/\[[^\]]*\sTO\s[^\]]*\]/.test(q))
    return "write range queries as [A TO B] with TO in capitals";
  // the engine refuses a word-start wildcard on fewer than three letters (a*, bc*, !a)
  if (/(^|[\s(:])(!\p{L}{1,2}(?=[\s)]|$)|\p{L}{1,2}\*(?=[\s)]|$))/u.test(q))
    return "a wildcard needs at least three letters before it (the engine refuses a*, bc* or !ab)";
  return null;
}

/** The exact GET parameters for one tool call; throws a plain error message when an input is invalid. */
export function buildSearchRequest(input: Record<string, unknown>): SearchRequest {
  const raw = typeof input["query"] === "string" ? input["query"] : "";
  const problem = queryProblem(raw);
  if (problem) throw new Error(problem);
  const type: SearchType = (SEARCH_TYPES as readonly unknown[]).includes(input["type"])
    ? (input["type"] as SearchType)
    : "o";
  const notes: string[] = [];
  const clauses = [raw.trim()];
  const after = typeof input["filed_after"] === "string" ? input["filed_after"] : "";
  const before = typeof input["filed_before"] === "string" ? input["filed_before"] : "";
  if ((after && !ISO.test(after)) || (before && !ISO.test(before)))
    throw new Error("filed_after and filed_before take YYYY-MM-DD dates");
  if (after || before) {
    const field = DATE_FIELD[type];
    if (!field) throw new Error("date filters do not apply to judge searches");
    if (after && before && after > before)
      throw new Error("filed_after is later than filed_before");
    clauses.push(`${field}:[${after || "*"} TO ${before || "*"}]`);
  }
  // the user's query keeps its own grouping: it is wrapped in parentheses before a filter is joined to it
  const q =
    clauses.length > 1 ? `(${clauses[0]}) AND ${clauses.slice(1).join(" AND ")}` : clauses[0]!;
  const params = new URLSearchParams({ q, type });
  const courtRaw = typeof input["court"] === "string" ? input["court"].trim() : "";
  if (courtRaw) {
    const courts = courtRaw.split(/[\s,]+/).filter(Boolean);
    if (!courts.length || courts.length > 40 || !courts.every((c) => COURT.test(c)))
      throw new Error(
        "court takes the archive's court ids such as 'ca9' or 'cand', separated by spaces",
      );
    params.set("court", courts.join(" "));
  }
  const statuses = Array.isArray(input["statuses"]) ? input["statuses"] : [];
  if (statuses.length) {
    if (type !== "o") throw new Error("statuses apply to case-law searches (type o) only");
    for (const s of statuses) {
      if (!(STATUSES as readonly unknown[]).includes(s))
        throw new Error(`unknown status '${String(s)}'`);
      params.set(STATUS_PARAM[s as (typeof STATUSES)[number]], "on");
    }
  } else if (type === "o")
    notes.push("Only published opinions are searched unless statuses are given.");
  const order = typeof input["order_by"] === "string" ? input["order_by"].trim() : "";
  if (order) {
    if (!ORDER[type].includes(order))
      throw new Error(`order_by for type ${type} is one of: ${ORDER[type].join(", ")}`);
    params.set("order_by", order);
  } else params.set("order_by", "score desc");
  if (type === "r" || type === "d")
    notes.push(
      "Docket counts are approximate: the archive reports an error of up to ±6% above 2,000 results.",
    );
  return { params, q, type, notes };
}

type Fetcher = (
  url: string,
  init: { signal: AbortSignal; headers: Record<string, string> },
) => Promise<Response>;

const s = (v: unknown, n = 300) => (typeof v === "string" && v ? v.slice(0, n) : null);

function result(type: SearchType, x: Record<string, unknown>) {
  const url =
    typeof x["absolute_url"] === "string"
      ? `https://www.courtlistener.com${x["absolute_url"]}`
      : null;
  const first = Array.isArray(x["opinions"])
    ? (x["opinions"][0] as Record<string, unknown> | undefined)
    : undefined;
  const recap = Array.isArray(x["recap_documents"])
    ? (x["recap_documents"][0] as Record<string, unknown> | undefined)
    : undefined;
  if (type === "p")
    return {
      name: s(x["name"]),
      courts: Array.isArray(x["court"]) ? x["court"].slice(0, 6) : s(x["court"]),
      url,
    };
  if (type === "oa")
    return {
      case: s(x["caseName"]),
      court: s(x["court"]),
      argued: s(x["dateArgued"], 10),
      judges: s(x["judge"], 200),
      docket: s(x["docketNumber"], 80),
      url,
    };
  if (type === "o")
    return {
      case: s(x["caseName"]),
      court: s(x["court"]),
      court_id: s(x["court_id"], 40),
      date: s(x["dateFiled"], 10),
      citation: Array.isArray(x["citation"]) ? x["citation"].slice(0, 4) : null,
      status: s(x["status"], 30),
      docket: s(x["docketNumber"], 80),
      cited_by: typeof x["citeCount"] === "number" ? x["citeCount"] : null,
      url,
      snippet: s(first?.["snippet"], 500),
    };
  return {
    case: s(x["caseName"]),
    court: s(x["court"]),
    court_id: s(x["court_id"], 40),
    filed: s(x["dateFiled"], 10),
    docket: s(x["docketNumber"], 80),
    nature_of_suit: s(x["suitNature"], 80),
    cause: s(x["cause"], 120),
    assigned_to: s(x["assignedTo"], 120),
    url,
    snippet: s(recap?.["snippet"] ?? x["snippet"], 500),
  };
}

/** Run one search; `fetcher` and `timeoutMs` are injectable for tests. */
export async function runCaseLawSearch(
  input: Record<string, unknown>,
  key: string | null,
  fetcher: Fetcher = (url, init) => fetch(url, init),
  timeoutMs = 25000,
): Promise<ToolOutcome> {
  if (!key) throw new Error("case-law search is not configured");
  const req = buildSearchRequest(input);
  const countOnly = input["count_only"] === true;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetcher(`${API}?${req.params}`, {
      signal: controller.signal,
      headers: { authorization: `Token ${key}` },
    });
  } finally {
    clearTimeout(timer);
  }
  if (res.status === 400) {
    const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    const detail =
      body && typeof body["detail"] === "string" ? `: ${body["detail"].slice(0, 200)}` : "";
    throw new Error(`the search engine refused the query${detail}`);
  }
  if (!res.ok) throw new Error(`case-law search failed (${res.status})`);
  const body = (await res.json()) as { count?: unknown; results?: Record<string, unknown>[] };
  const count = typeof body.count === "number" ? body.count : null;
  const searchPage = `${FRONT}?${req.params}`;
  const results = countOnly
    ? []
    : (body.results ?? []).slice(0, 10).map((x) => result(req.type, x));
  const approx = req.type === "r" || req.type === "d";
  return {
    content: JSON.stringify({
      query_sent: req.q,
      parameters: Object.fromEntries(req.params),
      count,
      count_is_approximate: approx && count != null && count > 2000,
      notes: req.notes,
      search_page: searchPage,
      results,
    }).slice(0, 12000),
    sources: [
      { title: "CourtListener search", url: searchPage, internal: false },
      ...results
        .filter((x): x is typeof x & { url: string } => typeof x.url === "string")
        .slice(0, 6)
        .map((x) => ({
          title: String(("case" in x && x.case) || ("name" in x && x.name) || "Result"),
          url: x.url,
          internal: false,
        })),
    ],
    label:
      req.type === "o"
        ? "Searched case law"
        : req.type === "oa"
          ? "Searched oral arguments"
          : req.type === "p"
            ? "Searched judges"
            : "Searched federal dockets",
    detail: `“${req.q.slice(0, 120)}” · ${count == null ? "count not reported" : `${approx && count > 2000 ? "about " : ""}${count.toLocaleString("en-US")} matches`}`,
  };
}
