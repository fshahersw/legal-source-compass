/**
 * Tools the assistant may call. Corpus tools are read-only and go through the same server reads as the site. Web tools reach
 * external services with keys read only from the server environment. Every result is bounded in size and returned as data, and
 * step labels never name a vendor or model.
 */
import { restGet, rpcPost } from "@/lib/external/rest.server";
import { queryPublishedDataset, searchPublishedCorpus } from "@/lib/external/catalog.reads.server";
import { codeFile, searchCode } from "./codeIndex.server";
import { publicUrl } from "@/lib/net/publicUrl";
import { OFFICIAL_EXECUTORS, OFFICIAL_TOOL_DEFINITIONS } from "./officialTools.server";
import { REGULATION_EXECUTORS, REGULATION_TOOL_DEFINITIONS } from "./regulationTools.server";
import { AUTHORITY_EXECUTORS, AUTHORITY_TOOL_DEFINITIONS } from "./authorityTools.server";
import { STATUTE_EXECUTORS, STATUTE_TOOL_DEFINITIONS } from "./statuteTools.server";
import { GOV_DOMAIN_EXECUTORS, GOV_DOMAIN_TOOL_DEFINITIONS } from "./govDomainTools.server";
import { LEGISLATION_EXECUTORS, LEGISLATION_TOOL_DEFINITIONS } from "./legislationTools.server";
import { FTC_DATA_EXECUTORS, FTC_DATA_TOOL_DEFINITIONS } from "./ftcDataTools.server";
import { CONGRESS_EXECUTORS, CONGRESS_TOOL_DEFINITIONS } from "./congressTools.server";
import { OVERSIGHT_EXECUTORS, OVERSIGHT_TOOL_DEFINITIONS } from "./oversightTools.server";
import { SEMANTIC_EXECUTORS, SEMANTIC_TOOL_DEFINITIONS } from "./semanticTools.server";
import { semanticConfigured } from "@/lib/semantic/semantic.server";
import { DOCUMENT_EXECUTORS, DOCUMENT_TOOL_DEFINITIONS } from "./documentTools.server";
import {
  CITATION_EXECUTORS,
  CITATION_TOOL_DEFINITIONS,
  caseLawConfigured,
} from "./citationVerify.server";
import { pageWindow } from "./textWindow";

export { publicUrl, pageWindow };
import type { AssistantSource } from "./protocol";

export type ToolDefinition = {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
};
export type ToolOutcome = {
  content: string;
  sources: AssistantSource[];
  label: string;
  detail: string;
};

const MAX_RESULT = 12000;
const MAX_RECORD = 30000;
const clip = (s: string, n = MAX_RESULT) => (s.length > n ? `${s.slice(0, n)}\n…[truncated]` : s);
const str = (v: unknown, n = 300) => (typeof v === "string" ? v.slice(0, n) : "");
const int = (v: unknown, lo: number, hi: number, d: number) =>
  typeof v === "number" && Number.isInteger(v) ? Math.min(hi, Math.max(lo, v)) : d;
const DATASET = /^[a-z][a-z0-9_]{1,80}$/;
const RECORD_ID = /^[A-Za-z0-9:._@/-]{1,200}$/;

export const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: "search_corpus",
    description:
      "Full-text search across every published dataset in the research corpus (courts, judges, MDLs and dockets, law and regulation, agencies, recalls, adverse events, companies, firms, states). Returns ranked records with dataset, id, title, state and source URL. Use several focused queries in parallel when a question has several parts.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Words to search for (2-200 characters)." },
        offset: { type: "integer", minimum: 0, maximum: 200 },
      },
      required: ["query"],
    },
  },
  {
    name: "list_datasets",
    description:
      "List published datasets (id, label, record count), optionally filtered by words in the id or label. Use to find the right dataset before querying it.",
    input_schema: {
      type: "object",
      properties: {
        filter: { type: "string", description: "Optional words to match in id or label." },
      },
    },
  },
  {
    name: "query_dataset",
    description:
      "Query one dataset: optional full-text words and exact filters (filter names come from the dataset's listing; each value is one string). Returns up to 25 records per page with their listed cells.",
    input_schema: {
      type: "object",
      properties: {
        dataset: { type: "string" },
        query: { type: "string" },
        filters: { type: "object", additionalProperties: { type: "string" } },
        offset: { type: "integer", minimum: 0, maximum: 5000 },
      },
      required: ["dataset"],
    },
  },
  {
    name: "get_record",
    description:
      "Read one corpus record in full (facts, cells, links, stored profile and text) by dataset and id. Use after a search to read the evidence before relying on it.",
    input_schema: {
      type: "object",
      properties: { dataset: { type: "string" }, id: { type: "string" } },
      required: ["dataset", "id"],
    },
  },
  {
    name: "search_code",
    description:
      "Search the site's own source map (routes and their paths, components, server functions, the datasets each file reads, file summaries). Use to explain how a page works, which data it shows and where a feature lives.",
    input_schema: {
      type: "object",
      properties: { query: { type: "string" } },
      required: ["query"],
    },
  },
  {
    name: "read_code_file",
    description: "Read the source-map entry of one file by its path (as returned by search_code).",
    input_schema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
  },
  {
    name: "web_search",
    description:
      "Search the public web for current information outside the corpus (news, agency announcements, company releases). Prefer official sources. Returns titles, URLs and extracted text.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string" },
        max_results: { type: "integer", minimum: 1, maximum: 8 },
        topic: { type: "string", enum: ["general", "news"] },
      },
      required: ["query"],
    },
  },
  {
    name: "read_web_page",
    description:
      "Fetch and read one public web page or document (HTML, PDF and common office files are converted to text). Use to read a source found by web_search or linked from a record. Long documents come in windows of about 14,000 characters: the result gives total_chars and next_start; call again with start to continue, or with find to get the passages around every mention of a word or phrase (with their offsets) instead of reading from the top.",
    input_schema: {
      type: "object",
      properties: {
        url: { type: "string" },
        start: { type: "integer", minimum: 0, description: "Character offset to read from." },
        find: { type: "string", description: "Word or phrase to locate in the document." },
      },
      required: ["url"],
    },
  },
  {
    name: "search_case_law",
    description:
      "Search U.S. court opinions (type o) or federal dockets (type r) in the free law archive. Returns case names, courts, dates, citations and links.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string" },
        type: { type: "string", enum: ["o", "r"] },
        court: { type: "string", description: "Optional court id, e.g. cand or ca9." },
      },
      required: ["query"],
    },
  },
  ...OFFICIAL_TOOL_DEFINITIONS,
  ...STATUTE_TOOL_DEFINITIONS,
  ...SEMANTIC_TOOL_DEFINITIONS,
  ...LEGISLATION_TOOL_DEFINITIONS,
  ...FTC_DATA_TOOL_DEFINITIONS,
  ...CONGRESS_TOOL_DEFINITIONS,
  ...OVERSIGHT_TOOL_DEFINITIONS,
  ...REGULATION_TOOL_DEFINITIONS,
  ...AUTHORITY_TOOL_DEFINITIONS,
  ...CITATION_TOOL_DEFINITIONS,
  ...GOV_DOMAIN_TOOL_DEFINITIONS,
  ...DOCUMENT_TOOL_DEFINITIONS,
];

function env(name: string): string | null {
  const v = process.env[name];
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

async function timed<T>(ms: number, run: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await run(controller.signal);
  } finally {
    clearTimeout(timer);
  }
}

const recordLink = (dataset: string, id: string) =>
  `/records/${encodeURIComponent(dataset)}/${encodeURIComponent(id)}`;

async function searchCorpusTool(input: Record<string, unknown>): Promise<ToolOutcome> {
  const q = str(input["query"], 200).trim();
  if (q.length < 2) throw new Error("query must have at least 2 characters");
  const r = await searchPublishedCorpus(q, int(input["offset"], 0, 200, 0), 12);
  const rows = r.matches.map((m) => ({
    dataset: m.record.dataset,
    id: m.record.id,
    title: m.displayTitle,
    state: m.state,
    subtitle: typeof m.item["subtitle"] === "string" ? m.item["subtitle"] : null,
    source_url: m.record.source_url,
    page: recordLink(m.record.dataset, m.record.id),
  }));
  return {
    content: clip(
      JSON.stringify({ total: r.total, returned: rows.length, hasMore: r.hasMore, results: rows }),
    ),
    sources: rows.slice(0, 6).map((x) => ({ title: x.title, url: x.page, internal: true })),
    label: "Searched the corpus",
    detail: `“${q}” · ${rows.length} of ${r.total ?? rows.length} records`,
  };
}

async function listDatasetsTool(input: Record<string, unknown>): Promise<ToolOutcome> {
  const words = str(input["filter"], 80).toLowerCase().split(/\s+/).filter(Boolean);
  const r = await restGet<{ id: string; label: string; imported_records: number | null }[]>(
    "corpus_datasets?select=id,label,imported_records&ready=eq.true&order=id.asc",
  );
  const rows = r.rows.filter((d) =>
    words.every((w) => `${d.id} ${d.label}`.toLowerCase().includes(w)),
  );
  return {
    content: clip(JSON.stringify({ datasets: rows.slice(0, 120), total: rows.length })),
    sources: [],
    label: "Checked the dataset list",
    detail: words.length
      ? `“${words.join(" ")}” · ${rows.length} datasets`
      : `${rows.length} datasets`,
  };
}

async function queryDatasetTool(input: Record<string, unknown>): Promise<ToolOutcome> {
  const dataset = str(input["dataset"], 80);
  if (!DATASET.test(dataset)) throw new Error("unknown dataset id");
  const filters: Record<string, string> = {};
  const raw = input["filters"];
  if (raw && typeof raw === "object" && !Array.isArray(raw))
    for (const [k, v] of Object.entries(raw as Record<string, unknown>).slice(0, 8))
      if (/^[a-z_][a-z0-9_]{0,40}$/.test(k) && typeof v === "string" && v.length <= 200)
        filters[k] = v;
  const r = await queryPublishedDataset(
    { dataset, q: str(input["query"], 200), filters, offset: int(input["offset"], 0, 5000, 0) },
    25,
  );
  const items = r.items.map((i) => {
    const o = i as Record<string, unknown>;
    return {
      id: o["id"],
      title: o["title"],
      subtitle: o["subtitle"],
      cells: o["cells"],
      page: recordLink(dataset, String(o["id"])),
    };
  });
  return {
    content: clip(JSON.stringify({ dataset, total: r.total, capped: r.capped, items })),
    sources: items
      .slice(0, 4)
      .map((x) => ({ title: String(x.title ?? x.id), url: x.page, internal: true })),
    label: "Queried a dataset",
    detail: `${dataset} · ${items.length} of ${r.total ?? items.length}`,
  };
}

async function getRecordTool(input: Record<string, unknown>): Promise<ToolOutcome> {
  const dataset = str(input["dataset"], 80);
  const id = str(input["id"], 200);
  if (!DATASET.test(dataset) || !RECORD_ID.test(id)) throw new Error("invalid dataset or id");
  const r = await restGet<
    {
      title: string;
      source_url: string | null;
      item: unknown;
      detail: unknown;
      text: string | null;
    }[]
  >(
    `corpus_records?select=title,source_url,item,detail,text&dataset=eq.${dataset}&id=eq.${encodeURIComponent(id)}&limit=1`,
  );
  const row = r.rows[0];
  if (!row) {
    const d = await rpcPost<unknown>("corpus_detail", {
      p_id: id,
      p_datasets: [dataset],
      p_full: false,
    }).catch(() => null);
    if (!d)
      return {
        content: JSON.stringify({ found: false }),
        sources: [],
        label: "Read a record",
        detail: `${dataset}/${id} · not found`,
      };
    return {
      content: clip(JSON.stringify(d)),
      sources: [{ title: id, url: recordLink(dataset, id), internal: true }],
      label: "Read a record",
      detail: `${dataset}/${id}`,
    };
  }
  return {
    // Records can be large (profiles with yearly series); allow more room than other tools and skip the search text.
    content: clip(
      JSON.stringify({
        title: row.title,
        source_url: row.source_url,
        item: row.item,
        detail: row.detail,
        text: (row.text ?? "").slice(0, 1500),
      }),
      MAX_RECORD,
    ),
    sources: [
      { title: row.title, url: recordLink(dataset, id), internal: true },
      ...(row.source_url && /^https?:\/\//.test(row.source_url)
        ? [{ title: `Source: ${row.title}`, url: row.source_url, internal: false }]
        : []),
    ],
    label: "Read a record",
    detail: row.title.slice(0, 80),
  };
}

async function webSearchTool(input: Record<string, unknown>): Promise<ToolOutcome> {
  const key = env("TAVILY_API_KEY");
  if (!key) throw new Error("web search is not configured");
  const query = str(input["query"], 300).trim();
  if (!query) throw new Error("query required");
  const res = await timed(25000, (signal) =>
    fetch("https://api.tavily.com/search", {
      method: "POST",
      signal,
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify({
        query,
        max_results: int(input["max_results"], 1, 8, 5),
        topic: input["topic"] === "news" ? "news" : "general",
        search_depth: "advanced",
        include_answer: false,
      }),
    }),
  );
  if (!res.ok) throw new Error(`web search failed (${res.status})`);
  const body = (await res.json()) as {
    results?: { title?: string; url?: string; content?: string; published_date?: string }[];
  };
  const results = (body.results ?? [])
    .filter((x) => x.url && publicUrl(x.url))
    .map((x) => ({
      title: str(x.title, 200),
      url: x.url!,
      published: x.published_date ?? null,
      content: str(x.content, 1800),
    }));
  return {
    content: clip(JSON.stringify({ query, results })),
    sources: results.map((x) => ({ title: x.title || x.url, url: x.url, internal: false })),
    label: "Searched the web",
    detail: `“${query}” · ${results.length} results`,
  };
}

async function readWebPageTool(input: Record<string, unknown>): Promise<ToolOutcome> {
  const key = env("FIRECRAWL_API_KEY");
  if (!key) throw new Error("page reading is not configured");
  const url = publicUrl(str(input["url"], 2000));
  if (!url) throw new Error("only public http(s) URLs can be read");
  const cached = cachedPage(url.toString());
  if (cached) return pageOutcome(url, cached.title, cached.text, input);
  const res = await timed(45000, (signal) =>
    fetch("https://api.firecrawl.dev/v2/scrape", {
      method: "POST",
      signal,
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify({
        url: url.toString(),
        formats: ["markdown"],
        onlyMainContent: true,
        parsers: ["pdf"],
        timeout: 40000,
      }),
    }),
  );
  if (!res.ok) throw new Error(`page could not be read (${res.status})`);
  const body = (await res.json()) as {
    data?: { markdown?: string; metadata?: { title?: string; sourceURL?: string } };
  };
  const title = str(body.data?.metadata?.title, 200) || url.hostname;
  const text = (body.data?.markdown ?? "").slice(0, PAGE_TEXT_MAX);
  rememberPage(url.toString(), title, text);
  return pageOutcome(url, title, text, input);
}

const PAGE_TEXT_MAX = 1_500_000;
const PAGE_TTL = 10 * 60 * 1000;
const pageCache = new Map<string, { at: number; title: string; text: string }>();

/** Pages read in the last few minutes, so paging through a long document does not fetch it again. */
function rememberPage(url: string, title: string, text: string) {
  pageCache.delete(url);
  pageCache.set(url, { at: Date.now(), title, text });
  while (pageCache.size > 20) pageCache.delete(pageCache.keys().next().value!);
}

function cachedPage(url: string): { title: string; text: string } | null {
  const hit = pageCache.get(url);
  if (!hit || Date.now() - hit.at > PAGE_TTL) return null;
  return hit;
}

function pageOutcome(
  url: URL,
  title: string,
  text: string,
  input: Record<string, unknown>,
): ToolOutcome {
  const start = int(input["start"], 0, PAGE_TEXT_MAX, 0);
  const find = str(input["find"], 200);
  const window = pageWindow(text, start, find);
  const host = url.hostname.replace(/^www\./, "");
  return {
    content: clip(JSON.stringify({ url: url.toString(), title, ...window }), 16000),
    sources: [{ title, url: url.toString(), internal: false }],
    label: find.trim() ? "Searched within a page" : "Read a page",
    detail: find.trim()
      ? `${host} · “${find.trim()}”`
      : start
        ? `${host} · from character ${window.start?.toLocaleString("en-US")}`
        : host,
  };
}

async function caseLawTool(input: Record<string, unknown>): Promise<ToolOutcome> {
  const key = env("COURTLISTENER_API_KEY");
  if (!key) throw new Error("case-law search is not configured");
  const q = str(input["query"], 300).trim();
  if (!q) throw new Error("query required");
  const type = input["type"] === "r" ? "r" : "o";
  const params = new URLSearchParams({ q, type, order_by: "score desc" });
  const court = str(input["court"], 40);
  if (/^[a-z0-9]{2,20}$/.test(court)) params.set("court", court);
  const res = await timed(25000, (signal) =>
    fetch(`https://www.courtlistener.com/api/rest/v4/search/?${params}`, {
      signal,
      headers: { authorization: `Token ${key}` },
    }),
  );
  if (!res.ok) throw new Error(`case-law search failed (${res.status})`);
  const body = (await res.json()) as { count?: number; results?: Record<string, unknown>[] };
  const results = (body.results ?? []).slice(0, 10).map((x) => ({
    case: x["caseName"] ?? x["case_name"],
    court: x["court"] ?? x["court_id"],
    date: x["dateFiled"] ?? x["date_filed"],
    citation: x["citation"],
    docket: x["docketNumber"],
    url:
      typeof x["absolute_url"] === "string"
        ? `https://www.courtlistener.com${x["absolute_url"]}`
        : null,
    snippet: Array.isArray(x["opinions"])
      ? str((x["opinions"][0] as Record<string, unknown> | undefined)?.["snippet"], 500)
      : str(x["snippet"], 500),
  }));
  return {
    content: clip(JSON.stringify({ count: body.count ?? null, results })),
    sources: results
      .filter((x) => x.url)
      .slice(0, 6)
      .map((x) => ({ title: String(x.case ?? "Case"), url: x.url!, internal: false })),
    label: type === "o" ? "Searched case law" : "Searched federal dockets",
    detail: `“${q}” · ${results.length} results`,
  };
}

function codeSearchTool(input: Record<string, unknown>): ToolOutcome {
  const q = str(input["query"], 200);
  const hits = searchCode(q, 12);
  return {
    content: clip(JSON.stringify({ query: q, files: hits })),
    sources: [],
    label: "Looked through the site's code",
    detail: `“${q}” · ${hits.length} files`,
  };
}

function codeFileTool(input: Record<string, unknown>): ToolOutcome {
  const path = str(input["path"], 300);
  const entry = codeFile(path);
  return {
    content: JSON.stringify(entry ?? { found: false }),
    sources: [],
    label: "Read a code file summary",
    detail: path.split("/").pop() ?? path,
  };
}

const EXECUTORS: Record<
  string,
  (input: Record<string, unknown>) => Promise<ToolOutcome> | ToolOutcome
> = {
  search_corpus: searchCorpusTool,
  list_datasets: listDatasetsTool,
  query_dataset: queryDatasetTool,
  get_record: getRecordTool,
  search_code: codeSearchTool,
  read_code_file: codeFileTool,
  web_search: webSearchTool,
  read_web_page: readWebPageTool,
  search_case_law: caseLawTool,
  ...OFFICIAL_EXECUTORS,
  ...STATUTE_EXECUTORS,
  ...SEMANTIC_EXECUTORS,
  ...LEGISLATION_EXECUTORS,
  ...FTC_DATA_EXECUTORS,
  ...CONGRESS_EXECUTORS,
  ...OVERSIGHT_EXECUTORS,
  ...REGULATION_EXECUTORS,
  ...AUTHORITY_EXECUTORS,
  ...CITATION_EXECUTORS,
  ...GOV_DOMAIN_EXECUTORS,
  ...DOCUMENT_EXECUTORS,
};

/** Tools whose service keys are present; the model is only offered these. */
export function availableTools(): ToolDefinition[] {
  return TOOL_DEFINITIONS.filter((t) => {
    if (t.name === "web_search") return !!env("TAVILY_API_KEY");
    if (t.name === "read_web_page") return !!env("FIRECRAWL_API_KEY");
    if (t.name === "search_case_law") return !!env("COURTLISTENER_API_KEY");
    if (t.name === "search_court_filings") return !!env("DOCKETBIRD_API_KEY");
    if (t.name === "semantic_search") return semanticConfigured();
    // verify_citations stays on without the key: statutes and regulations need none, and case citations then report
    // that they could not be checked.
    if (t.name === "get_opinion") return caseLawConfigured();
    return true;
  });
}

export async function runTool(name: string, input: unknown): Promise<ToolOutcome> {
  const run = EXECUTORS[name];
  if (!run) throw new Error(`unknown tool ${name}`);
  const args =
    input && typeof input === "object" && !Array.isArray(input)
      ? (input as Record<string, unknown>)
      : {};
  return await timed(50000, async () => await run(args));
}
