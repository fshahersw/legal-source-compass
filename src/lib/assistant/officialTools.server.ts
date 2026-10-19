/**
 * Assistant tools over official public sources that need no key (the Federal Register, the eCFR, SEC EDGAR full-text search and
 * openFDA) and a keyed full-text search of court filings. Each returns bounded, structured results with the URL to cite; nothing
 * is cached or stored.
 */
import type { ToolDefinition, ToolOutcome } from "./tools.server";

const MAX_RESULT = 12000;
const clip = (s: string, n = MAX_RESULT) => (s.length > n ? `${s.slice(0, n)}\n…[truncated]` : s);
const str = (v: unknown, n = 300) => (typeof v === "string" ? v.slice(0, n) : "");
const int = (v: unknown, lo: number, hi: number, d: number) =>
  typeof v === "number" && Number.isInteger(v) ? Math.min(hi, Math.max(lo, v)) : d;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const plain = (html: string) =>
  html
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();

async function getJson(
  url: string,
  headers: Record<string, string> = {},
): Promise<{ status: number; body: unknown }> {
  const res = await fetch(url, {
    headers: { accept: "application/json", ...headers },
    signal: AbortSignal.timeout(20000),
  });
  const body = (await res.json().catch(() => null)) as unknown;
  return { status: res.status, body };
}

export const OFFICIAL_TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: "search_federal_register",
    description:
      "Search the Federal Register (rules, proposed rules, notices, presidential documents) from 1994 on. Returns titles, document numbers, types, agencies, dates, citations, effective and comment dates, dockets, abstracts and official links.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string" },
        type: { type: "string", enum: ["RULE", "PRORULE", "NOTICE", "PRESDOCU"] },
        agency: {
          type: "string",
          description:
            "Optional agency slug, e.g. food-and-drug-administration or environmental-protection-agency.",
        },
        since: { type: "string", description: "Optional earliest publication date, YYYY-MM-DD." },
        order: { type: "string", enum: ["relevance", "newest"] },
      },
      required: ["query"],
    },
  },
  {
    name: "search_ecfr",
    description:
      "Search the current Code of Federal Regulations (eCFR) by words. Returns matching sections and parts with their citation, headings, a text excerpt and the official link. Optionally limit to one CFR title (e.g. 21 for food and drugs).",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string" },
        title: { type: "integer", minimum: 1, maximum: 50 },
      },
      required: ["query"],
    },
  },
  {
    name: "search_sec_filings",
    description:
      'Full-text search of SEC EDGAR filings since 2001. Put exact phrases in double quotes (e.g. "talc litigation"). Optional form types (comma-separated, e.g. 10-K,10-Q,8-K), company CIK and date range. Returns company, form, filing date, period and a link to the filed document.',
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string" },
        forms: { type: "string" },
        cik: { type: "string", description: "Optional company CIK (digits)." },
        start: { type: "string", description: "Optional earliest filing date, YYYY-MM-DD." },
        end: { type: "string", description: "Optional latest filing date, YYYY-MM-DD." },
      },
      required: ["query"],
    },
  },
  {
    name: "search_fda",
    description:
      'Query openFDA, the FDA\'s public data: drug, device and food enforcement reports (recalls), drug and device adverse-event reports, drug labels and device recalls. `search` uses openFDA syntax, e.g. openfda.brand_name:"ozempic", recalling_firm:"abbott", reason_for_recall:listeria+AND+report_date:[20240101+TO+20241231], or plain words. Set `count` to a field (e.g. patient.reaction.reactionmeddrapt.exact or classification.exact) for top values instead of records. Adverse-event reports do not show causation or incidence.',
    input_schema: {
      type: "object",
      properties: {
        endpoint: {
          type: "string",
          enum: [
            "drug/enforcement",
            "device/enforcement",
            "food/enforcement",
            "drug/event",
            "device/event",
            "drug/label",
            "device/recall",
          ],
        },
        search: { type: "string" },
        count: { type: "string" },
        limit: { type: "integer", minimum: 1, maximum: 10 },
      },
      required: ["endpoint"],
    },
  },
  {
    name: "search_court_filings",
    description:
      'Full-text search of the text of federal and state court filings (complaints, motions, orders, exhibits) across all courts. Syntax: words must all appear; "exact phrase"; or; -exclude; term* for word endings; /n, /s, /p for proximity. Optional court ids (comma-separated, e.g. ilnd,cand), filed date range and sort by recency. Returns document titles, case titles, courts, filing dates, matching snippets and the document page.',
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string" },
        courts: { type: "string" },
        filed_after: { type: "string", description: "YYYY-MM-DD" },
        filed_before: { type: "string", description: "YYYY-MM-DD" },
        sort: { type: "string", enum: ["relevance", "recency"] },
      },
      required: ["query"],
    },
  },
];

async function federalRegisterTool(input: Record<string, unknown>): Promise<ToolOutcome> {
  const query = str(input["query"], 300).trim();
  if (!query) throw new Error("query required");
  const params = new URLSearchParams({
    per_page: "8",
    order: input["order"] === "newest" ? "newest" : "relevance",
    "conditions[term]": query,
  });
  for (const f of [
    "title",
    "document_number",
    "type",
    "publication_date",
    "agencies",
    "citation",
    "effective_on",
    "comments_close_on",
    "docket_ids",
    "abstract",
    "html_url",
    "pdf_url",
  ])
    params.append("fields[]", f);
  const type = str(input["type"], 10);
  if (["RULE", "PRORULE", "NOTICE", "PRESDOCU"].includes(type))
    params.append("conditions[type][]", type);
  const agency = str(input["agency"], 80);
  if (/^[a-z0-9-]{2,80}$/.test(agency)) params.append("conditions[agencies][]", agency);
  const since = str(input["since"], 10);
  if (DATE.test(since)) params.set("conditions[publication_date][gte]", since);
  const { status, body } = await getJson(
    `https://www.federalregister.gov/api/v1/documents.json?${params}`,
  );
  if (status !== 200) throw new Error(`Federal Register search failed (${status})`);
  const b = body as { count?: number; results?: Record<string, unknown>[] };
  const results = (b.results ?? []).map((r) => ({
    title: str(r["title"], 300),
    type: r["type"] ?? null,
    document_number: r["document_number"] ?? null,
    publication_date: r["publication_date"] ?? null,
    agencies: Array.isArray(r["agencies"])
      ? (r["agencies"] as { name?: string }[]).map((a) => a.name).filter(Boolean)
      : [],
    citation: r["citation"] ?? null,
    effective_on: r["effective_on"] ?? null,
    comments_close_on: r["comments_close_on"] ?? null,
    docket_ids: r["docket_ids"] ?? [],
    abstract: str(r["abstract"], 450),
    url: typeof r["html_url"] === "string" ? r["html_url"] : null,
    pdf_url: typeof r["pdf_url"] === "string" ? r["pdf_url"] : null,
  }));
  return {
    content: clip(JSON.stringify({ total: b.count ?? null, results })),
    sources: results
      .filter((r) => r.url)
      .slice(0, 6)
      .map((r) => ({ title: r.title, url: r.url!, internal: false })),
    label: "Searched the Federal Register",
    detail: `“${query}” · ${results.length} of ${b.count ?? results.length}`,
  };
}

async function ecfrTool(input: Record<string, unknown>): Promise<ToolOutcome> {
  const query = str(input["query"], 300).trim();
  if (!query) throw new Error("query required");
  const params = new URLSearchParams({ query, per_page: "10" });
  const title = int(input["title"], 1, 50, 0);
  if (title) params.set("hierarchy[title]", String(title));
  const { status, body } = await getJson(`https://www.ecfr.gov/api/search/v1/results?${params}`);
  if (status !== 200) throw new Error(`eCFR search failed (${status})`);
  const b = body as {
    meta?: { total_count?: number };
    results?: {
      type?: string;
      starts_on?: string;
      hierarchy?: Record<string, string | null>;
      headings?: Record<string, string | null>;
      full_text_excerpt?: string;
    }[];
  };
  const results = (b.results ?? []).map((r) => {
    const h = r.hierarchy ?? {};
    const t = h["title"];
    const where = h["section"]
      ? `section-${h["section"]}`
      : h["appendix"] && h["part"]
        ? `part-${h["part"]}`
        : h["part"]
          ? `part-${h["part"]}`
          : null;
    const url =
      t && where
        ? `https://www.ecfr.gov/current/title-${encodeURIComponent(t)}/${encodeURIComponent(where)}`
        : null;
    return {
      citation: h["section"]
        ? `${t} CFR ${h["section"]}`
        : h["part"]
          ? `${t} CFR part ${h["part"]}`
          : `${t} CFR`,
      heading: plain(
        r.headings?.["section"] ?? r.headings?.["appendix"] ?? r.headings?.["part"] ?? "",
      ),
      part: plain(r.headings?.["part"] ?? ""),
      agency: plain(r.headings?.["chapter"] ?? ""),
      excerpt: plain(r.full_text_excerpt ?? "").slice(0, 600),
      in_force_since: r.starts_on ?? null,
      url,
    };
  });
  return {
    content: clip(JSON.stringify({ total: b.meta?.total_count ?? null, results })),
    sources: results
      .filter((r) => r.url)
      .slice(0, 6)
      .map((r) => ({ title: `${r.citation} ${r.heading}`.trim(), url: r.url!, internal: false })),
    label: "Searched the Code of Federal Regulations",
    detail: `“${query}”${title ? ` · title ${title}` : ""} · ${results.length} results`,
  };
}

async function secFilingsTool(input: Record<string, unknown>): Promise<ToolOutcome> {
  const query = str(input["query"], 300).trim();
  if (!query) throw new Error("query required");
  const params = new URLSearchParams({ q: query });
  const forms = str(input["forms"], 120)
    .split(",")
    .map((f) => f.trim().toUpperCase())
    .filter((f) => /^[A-Z0-9-/]{1,12}$/.test(f));
  if (forms.length) params.set("forms", forms.join(","));
  const cik = str(input["cik"], 12).replace(/\D/g, "");
  if (cik) params.set("ciks", cik.padStart(10, "0"));
  const start = str(input["start"], 10);
  const end = str(input["end"], 10);
  if (DATE.test(start) || DATE.test(end)) {
    params.set("dateRange", "custom");
    params.set("startdt", DATE.test(start) ? start : "2001-01-01");
    params.set("enddt", DATE.test(end) ? end : new Date().toISOString().slice(0, 10));
  }
  const ua = process.env["SEC_USER_AGENT"]?.trim() || "legal-source-compass research";
  const { status, body } = await getJson(`https://efts.sec.gov/LATEST/search-index?${params}`, {
    "user-agent": ua,
  });
  if (status !== 200) throw new Error(`SEC full-text search failed (${status})`);
  const b = body as {
    hits?: {
      total?: { value?: number };
      hits?: { _id?: string; _source?: Record<string, unknown> }[];
    };
  };
  const results = (b.hits?.hits ?? []).slice(0, 12).map((h) => {
    const s = h._source ?? {};
    const adsh = str(s["adsh"], 30);
    const file = (h._id ?? "").split(":")[1] ?? "";
    const ciks = Array.isArray(s["ciks"]) ? (s["ciks"] as string[]) : [];
    const firstCik = ciks[0] ? String(Number(ciks[0])) : "";
    const url =
      firstCik && /^\d{10}-\d{2}-\d{6}$/.test(adsh) && /^[\w.-]{1,120}$/.test(file)
        ? `https://www.sec.gov/Archives/edgar/data/${firstCik}/${adsh.replace(/-/g, "")}/${file}`
        : null;
    return {
      company: Array.isArray(s["display_names"])
        ? str((s["display_names"] as string[])[0], 200)
        : "",
      form: s["form"] ?? null,
      file_date: s["file_date"] ?? null,
      period_ending: s["period_ending"] ?? null,
      description: str(s["file_description"], 120),
      accession: adsh,
      url,
    };
  });
  const total = b.hits?.total?.value ?? null;
  return {
    content: clip(JSON.stringify({ total, results })),
    sources: results
      .filter((r) => r.url)
      .slice(0, 6)
      .map((r) => ({
        title: `${r.company} ${r.form ?? ""} (${r.file_date ?? ""})`.trim(),
        url: r.url!,
        internal: false,
      })),
    label: "Searched SEC filings",
    detail: `${query} · ${results.length} of ${total ?? results.length}`,
  };
}

const FDA_ENDPOINTS = new Set([
  "drug/enforcement",
  "device/enforcement",
  "food/enforcement",
  "drug/event",
  "device/event",
  "drug/label",
  "device/recall",
]);

async function fdaTool(input: Record<string, unknown>): Promise<ToolOutcome> {
  const endpoint = str(input["endpoint"], 40);
  if (!FDA_ENDPOINTS.has(endpoint)) throw new Error("unknown openFDA endpoint");
  const search = str(input["search"], 400).trim();
  const count = str(input["count"], 120).trim();
  if (count && !/^[A-Za-z0-9_.]{1,120}$/.test(count)) throw new Error("invalid count field");
  // openFDA reads `+` as a space and needs the rest of its syntax (quotes, colons, brackets) as typed.
  const parts: string[] = [];
  if (search) parts.push(`search=${encodeURIComponent(search).replace(/%2B/g, "+")}`);
  if (count) parts.push(`count=${count}`);
  else parts.push(`limit=${int(input["limit"], 1, 10, 5)}`);
  const url = `https://api.fda.gov/${endpoint}.json?${parts.join("&")}`;
  const { status, body } = await getJson(url);
  const b = body as {
    meta?: { last_updated?: string; results?: { total?: number } };
    results?: Record<string, unknown>[];
    error?: { code?: string; message?: string };
  };
  if (status === 404 && b?.error?.code === "NOT_FOUND")
    return {
      content: JSON.stringify({ total: 0, results: [], note: "No matching records." }),
      sources: [],
      label: "Queried FDA data",
      detail: `${endpoint} · no matches`,
    };
  if (status !== 200)
    throw new Error(
      `openFDA query failed (${status}${b?.error?.message ? `: ${b.error.message}` : ""})`,
    );
  const results = (b.results ?? []).map((r) => {
    if (count) return r;
    // Labels and adverse-event reports are long; keep each record bounded.
    const text = JSON.stringify(r);
    return text.length > 2500 ? { truncated: true, record: text.slice(0, 2500) } : r;
  });
  return {
    content: clip(
      JSON.stringify({
        endpoint,
        last_updated: b.meta?.last_updated ?? null,
        total: b.meta?.results?.total ?? null,
        results: count ? results.slice(0, 25) : results,
        query_url: url,
      }),
    ),
    sources: [
      {
        title: `FDA data: ${endpoint}${search ? ` · ${search.slice(0, 60)}` : ""}`,
        url,
        internal: false,
      },
    ],
    label: "Queried FDA data",
    detail: count
      ? `${endpoint} · top values of ${count}`
      : `${endpoint} · ${b.meta?.results?.total ?? results.length} records`,
  };
}

/** Full-text filing search; needs DOCKETBIRD_API_KEY. Several courts are searched one request each and merged. */
async function courtFilingsTool(input: Record<string, unknown>): Promise<ToolOutcome> {
  const key = process.env["DOCKETBIRD_API_KEY"]?.trim();
  if (!key) throw new Error("court filing search is not configured");
  const query = str(input["query"], 500).trim();
  if (!query) throw new Error("query required");
  const sort = input["sort"] === "recency" ? "recency" : "relevance";
  const base = new URLSearchParams({ q: query, size: "15", sort });
  const after = str(input["filed_after"], 10);
  const before = str(input["filed_before"], 10);
  if (DATE.test(after)) base.set("filed_after", after);
  if (DATE.test(before)) base.set("filed_before", before);
  const courts = str(input["courts"], 120)
    .split(",")
    .map((c) => c.trim().toLowerCase())
    .filter((c) => /^[a-z0-9]{2,12}$/.test(c))
    .slice(0, 4);
  const requests = (courts.length ? courts : [""]).map(async (court) => {
    const params = new URLSearchParams(base);
    if (court) params.set("court_id", court);
    const { status, body } = await getJson(
      `https://api.docketbird.com/documents/search?${params}`,
      {
        authorization: `Bearer ${key}`,
      },
    );
    if (status !== 200) throw new Error(`court filing search failed (${status})`);
    return ((body as { data?: unknown })?.data ?? {}) as {
      found?: number;
      next_cursor?: string | null;
      documents?: Record<string, unknown>[];
    };
  });
  const pages = await Promise.all(requests);
  let documents = pages.flatMap((page) => page.documents ?? []);
  if (sort === "recency")
    documents = documents.sort((a, b) =>
      String(b["date_filed"] ?? "").localeCompare(String(a["date_filed"] ?? "")),
    );
  const found = pages.reduce((n, page) => n + (page.found ?? 0), 0);
  const results = documents.slice(0, 15).map((d) => ({
    document: str(d["document_title"], 300),
    case: str(d["case_title"], 200),
    case_id: str(d["case_id"], 80),
    court: str(d["court_name"], 120) || str(d["court_id"], 20),
    filed: str(d["date_filed"], 10) || null,
    snippets: Array.isArray(d["snippets"])
      ? (d["snippets"] as unknown[]).slice(0, 3).map((x) => plain(str(x, 600)))
      : [],
    url:
      typeof d["canonical_url"] === "string" && /^https:\/\//.test(d["canonical_url"])
        ? d["canonical_url"]
        : null,
  }));
  return {
    content: clip(
      JSON.stringify({
        found,
        more: pages.some((page) => !!page.next_cursor),
        note: "found can include restricted documents that are never returned",
        results,
      }),
    ),
    sources: results
      .filter((r) => r.url)
      .slice(0, 6)
      .map((r) => ({
        title: `${r.case}: ${r.document}`.slice(0, 200),
        url: r.url!,
        internal: false,
      })),
    label: "Searched court filings",
    detail: `${query}${courts.length ? ` · ${courts.join(", ")}` : ""} · ${results.length} of ${found}`,
  };
}

export const OFFICIAL_EXECUTORS: Record<
  string,
  (input: Record<string, unknown>) => Promise<ToolOutcome>
> = {
  search_federal_register: federalRegisterTool,
  search_ecfr: ecfrTool,
  search_sec_filings: secFilingsTool,
  search_fda: fdaTool,
  search_court_filings: courtFilingsTool,
};
