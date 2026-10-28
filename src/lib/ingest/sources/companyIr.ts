/**
 * Investor-relations figures for the MDL-defendant registrants, as two self-updating sources (ingest/1):
 *
 * company_ir_kpis (source company_ir_kpis, dataset company_ir_kpis): documents the companies publish on their own
 * investor-relations sites (results presentations, earnings slides, KPI and segment supplements), one row per document.
 *   - Targets are the registrants in company_sec_statements; the official hosts are the IR and corporate websites the
 *     registrant states in its SEC filings (profile.ir_website / profile.website). A document counts only when it is
 *     served from one of those registrable domains, or from a page those hosts link to on the IR platform the site
 *     itself uses (recorded as `linked_from`). Nothing is taken from news sites, aggregators or data vendors.
 *   - Discovery: Firecrawl map of both official sites (IR host and corporate site; IR hosts often redirect to the
 *     corporate site, where the documents sit), then Tavily search restricted to the official domains when the maps
 *     give fewer than two candidates.
 *   - Text: Firecrawl scrape (v1 scrape, markdown; PDFs through its PDF parser, parsePDF). The text is
 *     stored in the row and is the check every figure is held to.
 *   - Figures: one asynchronous model pass per run (Anthropic Message Batches). PDFs are given to the model as the
 *     document itself, so tables and charts are read from the page images; HTML documents as their text. Every figure
 *     must come with the line it was read from; a figure whose number does not appear in that line is dropped, and a
 *     figure whose number is not in the stored document text is kept but marked `check: "image"` (read from the page
 *     image only). Nothing is computed or estimated by the model.
 *   - Each run: collect finished batches, submit pending documents (one batch), then discover and fetch the most
 *     relevant registrant that is due (see dueTargets: pending-MDL defendants weekly, other MDL links every two weeks,
 *     other current filers monthly; one per run keeps a run inside the edge function's wall-clock limit). Rows move pending → submitted → extracted | failed through upserts.
 *
 * company_sec_cover_facts (source company_sec_cover_facts): the cover-page facts each registrant tags in XBRL (dei
 * EntityPublicFloat, EntityCommonStockSharesOutstanding) from data.sec.gov company concepts, one row per company.
 * Public float is the market value of shares held by non-affiliates on the date the filer states; it is shown as such,
 * never as a market capitalisation.
 */
import { BudgetExhausted, RateLimited, sha256Hex } from "../http.ts";
import { corpusRecord } from "../rows.ts";
import type {
  CollectContext,
  Collected,
  CorpusRow,
  HeldRecord,
  Json,
  JsonObject,
  RowContent,
  SourceAdapter,
  StoredRow,
} from "../types.ts";

export const IR_DATASET = "company_ir_kpis";
export const COVER_DATASET = "company_sec_cover_facts";
export const MODEL = "claude-haiku-5-5";

const FIRECRAWL = "https://api.firecrawl.dev/v1";
const TAVILY = "https://api.tavily.com/search";
const ANTHROPIC = "https://api.anthropic.com/v1/messages/batches";

const TARGETS_PER_RUN = 1;
const DOCS_PER_TARGET = 4;
const BATCH_SIZE = 15;
const TEXT_LIMIT = 150_000;
const MODEL_TEXT_LIMIT = 60_000;
const MAX_FIGURES = 150;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
const enc = encodeURIComponent;

/* ------------------------------------------------------------------------------------------------ hosts and URLs */

const SECOND_LEVEL = new Set(["co", "com", "org", "net", "ac", "gov", "ne", "or"]);

/** "investors.bd.com" → "bd.com"; "www.astrazeneca.co.uk" → "astrazeneca.co.uk". Lower-case, no port. */
export function registrableDomain(host: string): string {
  const h = host.toLowerCase().replace(/:\d+$/, "").replace(/\.$/, "");
  const parts = h.split(".").filter(Boolean);
  if (parts.length <= 2) return parts.join(".");
  const last = parts[parts.length - 1]!;
  const second = parts[parts.length - 2]!;
  if (last.length === 2 && SECOND_LEVEL.has(second)) return parts.slice(-3).join(".");
  return parts.slice(-2).join(".");
}

/** A host string as an SEC profile prints it ("www.abbottinvestor.com", "https://investors.bd.com/") → URL. */
export function siteUrl(raw: string | null | undefined): URL | null {
  const s = str(raw);
  if (!s) return null;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s) && !/^https?:\/\//i.test(s)) return null;
  try {
    const u = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`);
    return u.protocol === "https:" || u.protocol === "http:" ? u : null;
  } catch {
    return null;
  }
}

/** Whether `url` is served from one of the official registrable domains. */
export function isFirstParty(url: string, officialDomains: readonly string[]): boolean {
  try {
    const u = new URL(url);
    if (u.protocol !== "https:" && u.protocol !== "http:") return false;
    return officialDomains.includes(registrableDomain(u.hostname));
  } catch {
    return false;
  }
}

/** IR platforms that host a company's investor documents on the company's behalf (linked from its own site). */
const IR_PLATFORMS = [
  "q4cdn.com",
  "q4inc.com",
  "gcs-web.com",
  "investorroom.com",
  "s201.q4cdn.com",
  "notified.com",
];

export function isIrPlatform(url: string): boolean {
  try {
    const d = registrableDomain(new URL(url).hostname);
    return IR_PLATFORMS.some((p) => registrableDomain(p) === d);
  } catch {
    return false;
  }
}

const DOC_WORDS =
  /(presentation|slides?|earnings|results|quarter|q[1-4]\b|q[1-4][-_ ]?20\d\d|fy\s?20\d\d|supplement|fact[-_ ]?sheet|investor[-_ ]?day|kpi|segment|financial[-_ ]?(data|tables)|reconciliation)/i;
const SKIP_WORDS =
  /(proxy|sustainab|esg|governance|charter|code-of|conduct|careers|privacy|cookie|terms|webcast|calendar|contact|email-alert|subscribe|\.(jpg|jpeg|png|gif|svg|mp3|mp4|zip|xlsx?)(\?|$))/i;

export type Candidate = { url: string; score: number; pdf: boolean; year: number | null };

/** The year a URL or title names (2000–2099), the latest when several appear. */
export function yearOf(text: string): number | null {
  const ys = [...text.matchAll(/(?:^|[^0-9])(20\d\d)(?:[^0-9]|$)/g)].map((m) => Number(m[1]));
  return ys.length ? Math.max(...ys) : null;
}

/**
 * Candidate documents from a site map: first-party (or the site's IR platform), looks like a results or presentation
 * document, from this year or the two before (or undated), PDFs first, newest first. At most `limit`.
 */
export function pickCandidates(
  links: readonly string[],
  officialDomains: readonly string[],
  now: Date,
  limit = DOCS_PER_TARGET,
): Candidate[] {
  const thisYear = now.getUTCFullYear();
  const seen = new Set<string>();
  const out: Candidate[] = [];
  for (const raw of links) {
    let u: URL;
    try {
      u = new URL(raw);
    } catch {
      continue;
    }
    u.hash = "";
    const url = u.href;
    if (seen.has(url)) continue;
    seen.add(url);
    if (!isFirstParty(url, officialDomains) && !isIrPlatform(url)) continue;
    const path = decodeURIComponent(u.pathname + u.search);
    if (SKIP_WORDS.test(path) || !DOC_WORDS.test(path)) continue;
    // the year the file name states (upload folders such as /files/2025-12/ say when it was posted, not the period)
    const file = decodeURIComponent(u.pathname.split("/").pop() ?? "");
    const year = yearOf(file) ?? yearOf(path);
    if (year !== null && (year < thisYear - 2 || year > thisYear + 1)) continue;
    const pdf = /\.pdf(\?|$)/i.test(u.pathname);
    const score =
      (pdf ? 4 : 0) +
      (/(presentation|slides|supplement|fact[-_ ]?sheet|kpi|segment)/i.test(path) ? 3 : 0) +
      (/(earnings|results|quarter|q[1-4])/i.test(path) ? 2 : 0) +
      (year !== null ? (year - (thisYear - 2)) * 2 : 0);
    out.push({ url, score, pdf, year });
  }
  return out
    .sort(
      (a, b) => b.score - a.score || (b.year ?? 0) - (a.year ?? 0) || a.url.localeCompare(b.url),
    )
    .slice(0, limit);
}

export function docKind(
  url: string,
  title: string,
): "presentation" | "earnings" | "supplement" | "other" {
  const t = `${url} ${title}`;
  if (/(supplement|fact[-_ ]?sheet|financial[-_ ]?(data|tables)|kpi)/i.test(t)) return "supplement";
  if (/(presentation|slides|investor[-_ ]?day)/i.test(t)) return "presentation";
  if (/(earnings|results|quarter|q[1-4])/i.test(t)) return "earnings";
  return "other";
}

/* ------------------------------------------------------------------------------------------------ figures */

export type Figure = {
  group: "segment" | "product" | "geography" | "operating" | "guidance";
  name: string;
  metric: string;
  period: string;
  value: number;
  unit: string;
  quote: string;
  page: number | null;
  check: "text" | "image";
};

const GROUPS = new Set(["segment", "product", "geography", "operating", "guidance"]);

/**
 * Digits of a number as it can be printed: "1234.5" → ["1234.5", "1,234.5"]; an integer also with one or two zero
 * decimals ("2" → "2", "2.0", "2.00"), since tables print "$2.0 billion" for a value of 2.
 */
export function numberForms(value: number): string[] {
  const abs = Math.abs(value);
  const out = new Set<string>();
  const raw = String(abs);
  const [int = raw, dec] = raw.split(".");
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  for (const i of [int, grouped]) {
    if (dec) out.add(`${i}.${dec}`);
    else for (const tail of ["", ".0", ".00"]) out.add(i + tail);
  }
  return [...out];
}

/** Text with whitespace collapsed and thousands separators kept, for number search. */
const flat = (s: string) => s.replace(/\s+/g, " ");

/** Whether one of the printed forms of `value` occurs in `text` as a whole number (not inside a longer one). */
export function containsNumber(text: string, value: number): boolean {
  const t = flat(text);
  return numberForms(value).some((form) => {
    const esc = form.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // the form must not continue as a longer number: "2" is not in "2.5", "12" or "2,500"
    return new RegExp(`(^|[^0-9.,])${esc}([^0-9.,]|[.,](?![0-9])|$)`).test(t);
  });
}

/**
 * The model's answer, validated: figures need a group, a name, a finite value, and a quote that prints that value;
 * the check is "text" when the value is in the stored document text, else "image". At most MAX_FIGURES, unique by
 * (group, name, metric, period).
 */
export function validateFigures(
  answer: unknown,
  documentText: string,
): { figures: Figure[]; dropped: number; documentPeriod: string | null; currency: string | null } {
  const a = isObj(answer) ? answer : {};
  const list = Array.isArray(a["figures"]) ? a["figures"] : [];
  const out: Figure[] = [];
  const keys = new Set<string>();
  let dropped = 0;
  for (const raw of list) {
    if (!isObj(raw)) {
      dropped++;
      continue;
    }
    const group = str(raw["group"])?.toLowerCase() ?? "";
    const name = str(raw["name"]);
    const metric = str(raw["metric"]) ?? "value";
    const period = str(raw["period"]) ?? "";
    const quote = str(raw["quote"]);
    const value =
      typeof raw["value"] === "number"
        ? raw["value"]
        : typeof raw["value"] === "string"
          ? Number(String(raw["value"]).replace(/[,$\s]/g, ""))
          : NaN;
    if (
      !GROUPS.has(group) ||
      !name ||
      !quote ||
      !Number.isFinite(value) ||
      !containsNumber(quote, value)
    ) {
      dropped++;
      continue;
    }
    const key = [group, name.toLowerCase(), metric.toLowerCase(), period.toLowerCase()].join("|");
    if (keys.has(key)) continue;
    keys.add(key);
    const page =
      typeof raw["page"] === "number" && Number.isInteger(raw["page"]) ? raw["page"] : null;
    out.push({
      group: group as Figure["group"],
      name: name.slice(0, 160),
      metric: metric.slice(0, 120),
      period: period.slice(0, 80),
      value,
      unit: (str(raw["unit"]) ?? "").slice(0, 40),
      quote: quote.slice(0, 240),
      page,
      check: containsNumber(documentText, value) ? "text" : "image",
    });
    if (out.length >= MAX_FIGURES) break;
  }
  return {
    figures: out,
    dropped,
    documentPeriod: str(a["document_period"])?.slice(0, 80) ?? null,
    currency: str(a["currency"])?.slice(0, 12) ?? null,
  };
}

export const SYSTEM_PROMPT =
  "You read investor-relations documents published by companies and list the figures they print. You never compute, " +
  "convert, round or estimate a figure. Reply with one JSON object and nothing else.";

export function userPrompt(company: string, kind: string): string {
  return [
    `This ${kind} document was published by ${company} on its investor-relations website.`,
    "List every figure it prints for business segments, product lines or franchises, geographic regions, operating",
    "KPIs (units, procedures, patients, subscribers, backlog, same-store sales and similar) and guidance.",
    "For each figure give:",
    '  group: one of "segment", "product", "geography", "operating", "guidance";',
    "  name: the segment, product, region or KPI exactly as printed;",
    '  metric: what is measured (for example "net sales", "operating income", "reported growth %");',
    '  period: as printed (for example "Q2 2026", "FY2025", "six months ended June 30, 2026");',
    "  value: the number exactly as printed, without currency symbols or thousands separators (negative with -);",
    '  unit: as printed or stated in the table header (for example "USD millions", "%", "units");',
    "  quote: the exact line or table row the figure is printed in (at most 200 characters);",
    "  page: the page number for a PDF, else null.",
    "Read tables and charts on every page. Leave out a figure you would have to calculate.",
    `Reply {"document_period": string|null, "currency": string|null, "figures": [...]}, at most ${MAX_FIGURES} figures.`,
  ].join("\n");
}

/* ------------------------------------------------------------------------------------------------ targets */

export type Target = {
  cik: string;
  name: string;
  ir: URL | null;
  site: URL | null;
  domains: string[];
};

async function readTargets(ctx: CollectContext): Promise<Target[]> {
  const rows = await ctx.corpus.query(
    "corpus_records?select=id,n:item->profile->>name,w:item->profile->>website,ir:item->profile->>ir_website" +
      "&dataset=eq.company_sec_statements&order=id.asc&limit=1000",
  );
  return rows
    .map((r) => {
      const ir = siteUrl(r["ir"] as string | null);
      const site = siteUrl(r["w"] as string | null);
      const domains = [
        ...new Set(
          [ir, site].filter((u): u is URL => !!u).map((u) => registrableDomain(u.hostname)),
        ),
      ];
      return { cik: String(r["id"]), name: String(r["n"] ?? r["id"]), ir, site, domains };
    })
    .filter((t) => /^\d{10}$/.test(t.cik));
}

/* ------------------------------------------------------------------------------------------------ relevance */

/**
 * Which registrants the IR source reads, in what order and how often. Relevance comes from company_sec_mdl_links
 * with the company pages' rule (tier C evidence never counts toward exposure):
 *   1  named as defendant in a pending MDL on tier A or B evidence, not dismissed      revisited every 7 days
 *   2  any other pending, not-dismissed MDL link (tier C, role unclear)                  every 14 days
 *   3  other registrants still filing                                                     every 30 days
 *   skipped: no pending MDL link and the last 10-K cover date is more than three years old (stopped filing)
 */
export type Relevance = 1 | 2 | 3;
export const REVISIT_DAYS: Record<Relevance, number> = { 1: 7, 2: 14, 3: 30 };
const STALE_FILER_DAYS = 3 * 365;
const DAY = 86_400_000;

export type MdlLinkFact = {
  cik: string;
  status: string | null;
  tier: string | null;
  role: string | null;
  dismissed: boolean;
};

export function relevanceOf(links: readonly MdlLinkFact[]): Relevance | null {
  const pending = links.filter((l) => l.status === "pending" && !l.dismissed);
  if (pending.some((l) => l.role === "defendant" && (l.tier === "A" || l.tier === "B"))) return 1;
  if (pending.length) return 2;
  return null;
}

export type RankedTarget = Target & { relevance: Relevance; lastVisit: string | null };

/**
 * The targets due now, most relevant first, then the longest unvisited. `visited` maps CIK to the ISO time of the
 * last visit; `floatDates` maps CIK to its latest public-float date (absent when no cover row exists).
 */
export function dueTargets(
  targets: readonly Target[],
  links: readonly MdlLinkFact[],
  floatDates: ReadonlyMap<string, string>,
  visited: Readonly<Record<string, string>>,
  now: Date,
): RankedTarget[] {
  const byCik = new Map<string, MdlLinkFact[]>();
  for (const l of links) byCik.set(l.cik, [...(byCik.get(l.cik) ?? []), l]);
  const out: RankedTarget[] = [];
  for (const t of targets) {
    let relevance: Relevance | null = relevanceOf(byCik.get(t.cik) ?? []);
    if (relevance === null) {
      const float = floatDates.get(t.cik);
      if (float && now.getTime() - Date.parse(`${float}T00:00:00Z`) > STALE_FILER_DAYS * DAY)
        continue;
      relevance = 3;
    }
    const lastVisit = visited[t.cik] ?? null;
    if (lastVisit && now.getTime() - Date.parse(lastVisit) < REVISIT_DAYS[relevance] * DAY)
      continue;
    out.push({ ...t, relevance, lastVisit });
  }
  return out.sort(
    (a, b) =>
      a.relevance - b.relevance ||
      (a.lastVisit ?? "").localeCompare(b.lastVisit ?? "") ||
      a.cik.localeCompare(b.cik),
  );
}

async function readRelevance(ctx: CollectContext) {
  const linkRows = await ctx.corpus.query(
    "corpus_records?select=c:item->link->>cik,s:item->link->>mdl_status,t:item->link->>tier," +
      "r:item->link->>role,d:item->link->>dismissed&dataset=eq.company_sec_mdl_links&order=id.asc&limit=5000",
  );
  const links: MdlLinkFact[] = linkRows
    .map((r) => ({
      cik: String(r["c"] ?? ""),
      status: typeof r["s"] === "string" ? r["s"] : null,
      tier: typeof r["t"] === "string" ? r["t"] : null,
      role: typeof r["r"] === "string" ? r["r"] : null,
      dismissed: r["d"] === "true" || r["d"] === true,
    }))
    .filter((l) => /^\d{10}$/.test(l.cik));
  const coverRows = await ctx.corpus.query(
    "corpus_records?select=id,f:item->cells->>float_date&dataset=eq.company_sec_cover_facts&order=id.asc&limit=1000",
  );
  const floatDates = new Map<string, string>();
  for (const r of coverRows) {
    const cik = String(r["id"] ?? "").replace(/^cover:/, "");
    if (typeof r["f"] === "string" && /^\d{4}-\d{2}-\d{2}$/.test(r["f"]))
      floatDates.set(cik, r["f"]);
  }
  return { links, floatDates };
}

/* ------------------------------------------------------------------------------------------------ API calls */

type Http = CollectContext["http"];

async function postJson(http: Http, url: string, body: unknown, headers: Record<string, string>) {
  if (!http.send) throw new Error("this run's HTTP client cannot POST");
  const res = await http.send(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    recordUrl: url,
  });
  let json: unknown = null;
  try {
    json = JSON.parse(res.text);
  } catch {
    json = null;
  }
  return { status: res.status, json };
}

async function firecrawlMap(http: Http, key: string, site: URL): Promise<string[]> {
  const { status, json } = await postJson(
    http,
    `${FIRECRAWL}/map`,
    {
      url: site.origin,
      search: "investor presentation earnings results quarterly supplement",
      includeSubdomains: true,
      limit: 500,
    },
    { Authorization: `Bearer ${key}` },
  );
  if (status !== 200 || !isObj(json)) throw new Error(`Firecrawl map HTTP ${status}`);
  const links = Array.isArray(json["links"]) ? json["links"] : [];
  return links
    .map((l) => (typeof l === "string" ? l : isObj(l) ? str(l["url"]) : null))
    .filter((u): u is string => !!u);
}

async function tavilyLinks(http: Http, key: string, t: Target): Promise<string[]> {
  if (!t.domains.length) return [];
  const { status, json } = await postJson(
    http,
    TAVILY,
    {
      query: `${t.name} investor relations quarterly results presentation segment`,
      include_domains: t.domains,
      max_results: 15,
      search_depth: "basic",
    },
    { Authorization: `Bearer ${key}` },
  );
  if (status !== 200 || !isObj(json)) throw new Error(`Tavily search HTTP ${status}`);
  const results = Array.isArray(json["results"]) ? json["results"] : [];
  return results.map((r) => (isObj(r) ? str(r["url"]) : null)).filter((u): u is string => !!u);
}

/** The page as markdown, or Firecrawl's status and error text (never carries a key) when it could not be read. */
async function firecrawlScrape(
  http: Http,
  key: string,
  url: string,
): Promise<{ markdown: string; title: string } | { status: number; error: string }> {
  const { status, json } = await postJson(
    http,
    `${FIRECRAWL}/scrape`,
    { url, formats: ["markdown"], onlyMainContent: true, parsePDF: true },
    { Authorization: `Bearer ${key}` },
  );
  if (status !== 200 || !isObj(json) || !isObj(json["data"])) {
    const error = isObj(json) ? (str(json["error"]) ?? str(json["message"]) ?? "") : "";
    return { status, error: error.slice(0, 200) };
  }
  const data = json["data"];
  const markdown = str(data["markdown"]) ?? "";
  const meta = isObj(data["metadata"]) ? data["metadata"] : {};
  // Firecrawl answers 200 for a page the site itself answered with an error; the site's status is in the metadata
  const siteStatus = typeof meta["statusCode"] === "number" ? meta["statusCode"] : 200;
  if (siteStatus >= 400)
    return { status: siteStatus, error: "the site answered with an error page" };
  return { markdown, title: str(meta["title"]) ?? "" };
}

/* ------------------------------------------------------------------------------------------------ rows */

export const irRowId = async (cik: string, url: string) =>
  `ir:${cik}:${(await sha256Hex(new TextEncoder().encode(url))).slice(0, 16)}`;

/** custom_id of a batch request: the row id with its separators replaced (the API allows [A-Za-z0-9_-]). */
export const customId = (rowId: string) => rowId.replace(/:/g, "-");
export const rowIdOf = (custom: string) =>
  custom.replace(/^ir-(\d{10})-([0-9a-f]{16})$/, "ir:$1:$2");

export type IrDocument = {
  cik: string;
  company: string;
  url: string;
  title: string;
  kind: ReturnType<typeof docKind>;
  pdf: boolean;
  year: number | null;
  sha256: string;
  chars: number;
  retrieved: string;
  linked_from: string | null;
};

export type Extraction = {
  status: "pending" | "submitted" | "extracted" | "failed";
  batch: string | null;
  model: string | null;
  figures: Figure[];
  dropped: number;
  document_period: string | null;
  currency: string | null;
  error: string | null;
};

export function irRow(id: string, doc: IrDocument, text: string, ex: Extraction): CorpusRow {
  const counts = { text: ex.figures.filter((f) => f.check === "text").length, image: 0 };
  counts.image = ex.figures.length - counts.text;
  const groups = [...new Set(ex.figures.map((f) => f.group))];
  return corpusRecord(IR_DATASET, id, `${doc.company}: ${doc.title || doc.url}`, {
    source_url: doc.url,
    subtitle: `${doc.kind} · ${ex.document_period ?? doc.year ?? "period not recorded"} · ${ex.status}`,
    cells: {
      company: doc.company,
      kind: doc.kind,
      period: ex.document_period,
      figures: ex.figures.length,
      status: ex.status,
    },
    facts: [
      ["Company", doc.company],
      ["Document", doc.title || "Not recorded"],
      ["Published at", doc.url],
      ["Retrieved", doc.retrieved],
      ["SHA-256 of text", doc.sha256],
      [
        "Figures",
        `${ex.figures.length} (${counts.text} found in the document text, ${counts.image} read from page images only)`,
      ],
      [
        "Extraction",
        ex.status === "extracted"
          ? `Read by ${ex.model}; every figure printed in its quoted line`
          : ex.status,
      ],
      ...(doc.linked_from ? ([["Linked from", doc.linked_from]] as [string, string][]) : []),
    ],
    text: text.slice(0, TEXT_LIMIT),
    filters: {
      company: [doc.cik],
      kind: [doc.kind],
      status: [ex.status],
      group: groups.length ? groups : ["none"],
    },
    badges: [doc.kind, ...(counts.image ? ["Some figures read from page images"] : [])],
    links: [
      { label: "Document on the company's site", url: doc.url },
      { label: "Company profile", url: `/companies/${doc.cik}` },
    ],
    extra: { document: doc as unknown as JsonObject, extraction: ex as unknown as JsonObject },
  });
}

/** Change detection: the retrieval time of an unchanged document is provenance, not a change. */
export function comparableIr(content: RowContent): Json {
  const item = { ...content.item };
  const doc = isObj(item["document"])
    ? { ...item["document"], retrieved: "<retrieved>" }
    : item["document"];
  item["document"] = doc as Json;
  const facts = (Array.isArray(content.detail["facts"]) ? content.detail["facts"] : []).map((f) =>
    Array.isArray(f) && f[0] === "Retrieved" ? ["Retrieved", "<retrieved>"] : f,
  );
  return {
    ...(content as unknown as JsonObject),
    item,
    detail: { ...content.detail, facts },
  } as unknown as Json;
}

function storedDoc(row: StoredRow): { doc: IrDocument; ex: Extraction } | null {
  const item = row.item as Obj;
  if (!isObj(item["document"]) || !isObj(item["extraction"])) return null;
  return {
    doc: item["document"] as unknown as IrDocument,
    ex: item["extraction"] as unknown as Extraction,
  };
}

/** The document text of a stored row: corpusRecord joins id, title and subtitle in front of it. */
export function bodyText(row: Pick<StoredRow, "id" | "title" | "text" | "item">): string {
  const subtitle = typeof row.item["subtitle"] === "string" ? row.item["subtitle"] : "";
  const prefix = [row.id, row.title, subtitle].filter((p) => p !== "").join(" ") + " ";
  return row.text.startsWith(prefix) ? row.text.slice(prefix.length) : row.text;
}

/* ------------------------------------------------------------------------------------------------ batches */

type BatchRef = { id: string; submitted: string; ids: string[] };

function batchRequest(rowId: string, doc: IrDocument, text: string) {
  const content: unknown[] = doc.pdf
    ? [{ type: "document", source: { type: "url", url: doc.url } }]
    : [{ type: "text", text: text.slice(0, MODEL_TEXT_LIMIT) }];
  content.push({ type: "text", text: userPrompt(doc.company, doc.kind) });
  return {
    custom_id: customId(rowId),
    params: {
      model: MODEL,
      max_tokens: 8000,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content }],
    },
  };
}

const anthropicHeaders = (key: string) => ({ "x-api-key": key, "anthropic-version": "2023-06-01" });

function answerOf(message: unknown): unknown {
  if (!isObj(message) || !Array.isArray(message["content"])) return null;
  const text = message["content"]
    .map((b) => (isObj(b) && b["type"] === "text" ? String(b["text"] ?? "") : ""))
    .join("");
  const m = /\{[\s\S]*\}/.exec(text);
  if (!m) return null;
  try {
    return JSON.parse(m[0]);
  } catch {
    return null;
  }
}

/** Parse a batch results file (JSONL) into custom_id → answer or error text. */
export function parseBatchResults(
  jsonl: string,
): Map<string, { answer: unknown } | { error: string }> {
  const out = new Map<string, { answer: unknown } | { error: string }>();
  for (const line of jsonl.split("\n")) {
    if (!line.trim()) continue;
    let r: unknown;
    try {
      r = JSON.parse(line);
    } catch {
      continue;
    }
    if (!isObj(r) || typeof r["custom_id"] !== "string" || !isObj(r["result"])) continue;
    const res = r["result"];
    if (res["type"] === "succeeded") out.set(r["custom_id"], { answer: answerOf(res["message"]) });
    else out.set(r["custom_id"], { error: String(res["type"] ?? "error") });
  }
  return out;
}

/* ------------------------------------------------------------------------------------------------ adapter */

export const companyIrKpis: SourceAdapter = {
  source: "company_ir_kpis",
  dataset: IR_DATASET,
  mode: "upsert",
  ordinalPolicy: "append",
  functionName: "ingest-company-ir",
  limits: { maxRequests: 40, minIntervalMs: 1500 },
  secrets: ["FIRECRAWL_API_KEY", "ANTHROPIC_API_KEY"],

  async collect(ctx): Promise<Collected> {
    const fc = ctx.env("FIRECRAWL_API_KEY")!;
    const ak = ctx.env("ANTHROPIC_API_KEY")!;
    const tv = ctx.env("TAVILY_API_KEY") ?? null;
    const cursor = (isObj(ctx.cursor) ? ctx.cursor : {}) as Obj;
    // CIK → ISO time of the last visit (relevance decides how soon a registrant is due again)
    const visited: Record<string, string> = isObj(cursor["visited"])
      ? Object.fromEntries(
          Object.entries(cursor["visited"]).filter(
            (e): e is [string, string] => typeof e[1] === "string" && /^\d{10}$/.test(e[0]),
          ),
        )
      : {};
    let batches: BatchRef[] = Array.isArray(cursor["batches"])
      ? (cursor["batches"] as BatchRef[])
      : [];
    const retrieved = ctx.now.toISOString().slice(0, 10);
    const rows: CorpusRow[] = [];
    const held: HeldRecord[] = [];
    const notes: JsonObject = {};
    let fetched = 0;
    let complete = true;
    const scrapeErrors: JsonObject[] = [];

    const stop = (error: unknown) => {
      if (error instanceof BudgetExhausted || error instanceof RateLimited) {
        complete = false;
        notes["stopped"] = error.message;
        return true;
      }
      return false;
    };

    try {
      // 1. finished batches
      const open: BatchRef[] = [];
      for (const b of batches) {
        const st = await ctx.http.getText(`${ANTHROPIC}/${enc(b.id)}`, {
          headers: anthropicHeaders(ak),
        });
        const info = JSON.parse(st.text) as Obj;
        if (info["processing_status"] !== "ended" || typeof info["results_url"] !== "string") {
          open.push(b);
          continue;
        }
        const res = await ctx.http.getText(String(info["results_url"]), {
          headers: anthropicHeaders(ak),
        });
        const results = parseBatchResults(res.text);
        const stored = await ctx.corpus.rowsBy(IR_DATASET, "id", b.ids);
        for (const row of stored) {
          const s = storedDoc(row);
          if (!s) continue;
          const r = results.get(customId(row.id));
          const ex: Extraction =
            r && "answer" in r && r.answer
              ? (() => {
                  const v = validateFigures(r.answer, bodyText(row));
                  return {
                    status: "extracted",
                    batch: b.id,
                    model: MODEL,
                    figures: v.figures,
                    dropped: v.dropped,
                    document_period: v.documentPeriod,
                    currency: v.currency,
                    error: null,
                  };
                })()
              : {
                  ...s.ex,
                  status: "failed",
                  batch: b.id,
                  model: MODEL,
                  error: r && "error" in r ? r.error : "no answer",
                };
          rows.push(irRow(row.id, s.doc, bodyText(row), ex));
        }
      }
      batches = open;
      notes["batches_open"] = open.length;

      // 2. submit pending documents (one batch per run)
      if (!batches.length) {
        const pending = await ctx.corpus.query(
          `corpus_records?select=id&dataset=eq.${IR_DATASET}&item->extraction->>status=eq.pending&order=id.asc&limit=${BATCH_SIZE}`,
        );
        const ids = pending.map((p) => String(p["id"]));
        if (ids.length) {
          const stored = await ctx.corpus.rowsBy(IR_DATASET, "id", ids);
          const reqs = stored
            .map((row) => ({ row, s: storedDoc(row) }))
            .filter((x): x is { row: StoredRow; s: { doc: IrDocument; ex: Extraction } } => !!x.s);
          const { status, json } = await postJson(
            ctx.http,
            ANTHROPIC,
            { requests: reqs.map(({ row, s }) => batchRequest(row.id, s.doc, bodyText(row))) },
            anthropicHeaders(ak),
          );
          if (status !== 200 || !isObj(json) || typeof json["id"] !== "string")
            throw new Error(`model batch could not be created (HTTP ${status})`);
          const id = String(json["id"]);
          batches.push({ id, submitted: ctx.now.toISOString(), ids: reqs.map((x) => x.row.id) });
          for (const { row, s } of reqs)
            rows.push(
              irRow(row.id, s.doc, bodyText(row), {
                ...s.ex,
                status: "submitted",
                batch: id,
                model: MODEL,
              }),
            );
          notes["submitted"] = reqs.length;
        }
      }

      // 3. discover and fetch a few targets
      const targets = await readTargets(ctx);
      const { links, floatDates } = await readRelevance(ctx);
      const due = dueTargets(targets, links, floatDates, visited, ctx.now);
      notes["targets"] = targets.length;
      notes["due"] = due.length;
      notes["due_by_relevance"] = {
        "1": due.filter((t) => t.relevance === 1).length,
        "2": due.filter((t) => t.relevance === 2).length,
        "3": due.filter((t) => t.relevance === 3).length,
      };
      for (const t of due.slice(0, TARGETS_PER_RUN)) {
        visited[t.cik] = ctx.now.toISOString();
        notes["visited"] = { cik: t.cik, relevance: t.relevance };
        if (!t.domains.length) {
          held.push({ key: t.cik, reason: "no official website stated in SEC filings" });
          continue;
        }
        const base = t.ir ?? t.site!;
        try {
          // Both official sites are mapped: an IR host often redirects to the corporate site, where the results
          // documents live. Tavily (restricted to the same domains) fills in when the maps give fewer than two.
          const origins = [
            ...new Set([t.ir, t.site].filter((u): u is URL => !!u).map((u) => u.origin)),
          ];
          const found: string[] = [];
          let mapError: unknown = null;
          for (const origin of origins) {
            try {
              found.push(...(await firecrawlMap(ctx.http, fc, new URL(origin))));
            } catch (error) {
              if (error instanceof BudgetExhausted || error instanceof RateLimited) throw error;
              mapError = error;
            }
          }
          let picks = pickCandidates(found, t.domains, ctx.now);
          if (picks.length < 2 && tv) {
            try {
              found.push(...(await tavilyLinks(ctx.http, tv, t)));
              picks = pickCandidates(found, t.domains, ctx.now);
            } catch (error) {
              if (error instanceof BudgetExhausted || error instanceof RateLimited) throw error;
            }
          }
          if (!found.length && mapError) throw mapError;
          if (!picks.length) {
            held.push({
              key: t.cik,
              reason: "no results or presentation document found on the official sites",
            });
            continue;
          }
          const ids = await Promise.all(picks.map((p) => irRowId(t.cik, p.url)));
          const known = new Set(
            (await ctx.corpus.rowsBy(IR_DATASET, "id", ids, "id")).map((r) => r.id),
          );
          for (let k = 0; k < picks.length; k++) {
            const p = picks[k]!;
            const id = ids[k]!;
            if (known.has(id) || rows.some((r) => r.id === id)) continue;
            const page = await firecrawlScrape(ctx.http, fc, p.url);
            fetched++;
            if ("error" in page) {
              held.push({
                key: p.url,
                reason: `document could not be read (HTTP ${page.status})`,
              });
              scrapeErrors.push({ url: p.url, status: page.status, error: page.error });
              continue;
            }
            if (page.markdown.length < 200) {
              held.push({ key: p.url, reason: "document text could not be read" });
              continue;
            }
            const text = page.markdown.slice(0, TEXT_LIMIT);
            const doc: IrDocument = {
              cik: t.cik,
              company: t.name,
              url: p.url,
              title: page.title.slice(0, 300),
              kind: docKind(p.url, page.title),
              pdf: p.pdf,
              year: p.year,
              sha256: await sha256Hex(new TextEncoder().encode(text)),
              chars: text.length,
              retrieved,
              linked_from: isFirstParty(p.url, t.domains) ? null : base.origin,
            };
            rows.push(
              irRow(id, doc, text, {
                status: "pending",
                batch: null,
                model: null,
                figures: [],
                dropped: 0,
                document_period: null,
                currency: null,
                error: null,
              }),
            );
          }
        } catch (error) {
          if (error instanceof BudgetExhausted || error instanceof RateLimited) throw error;
          held.push({
            key: t.cik,
            reason: error instanceof Error ? error.message.slice(0, 200) : "target failed",
          });
        }
      }
    } catch (error) {
      if (!stop(error)) throw error;
    }

    if (scrapeErrors.length) notes["scrape_errors"] = scrapeErrors.slice(0, 6);
    // a row produced twice in one run (fetched and extracted) keeps its last state
    const byId = new Map(rows.map((r) => [r.id, r]));
    return {
      rows: [...byId.values()],
      fetched,
      held,
      cursorAfter: { batches, visited } as unknown as Json,
      complete,
      notes,
    };
  },

  comparable: comparableIr,
};

/* ------------------------------------------------------------------------------------------------ cover facts */

const COVER_PER_RUN = 25;
const CONCEPT = (cik: string, tag: string) =>
  `https://data.sec.gov/api/xbrl/companyconcept/CIK${cik}/dei/${tag}.json`;

export type CoverFact = {
  end: string;
  value: number;
  accn: string;
  form: string;
  filed: string;
  fy: number | null;
};

/** The latest facts of one dei concept, one per period end (the latest filed), newest first. */
export function coverFacts(json: unknown, unit: string, limit: number): CoverFact[] {
  if (!isObj(json) || !isObj(json["units"])) return [];
  const list = (json["units"] as Obj)[unit];
  if (!Array.isArray(list)) return [];
  const byEnd = new Map<string, CoverFact>();
  for (const f of list) {
    if (!isObj(f)) continue;
    const end = str(f["end"]);
    const value = typeof f["val"] === "number" ? f["val"] : NaN;
    const filed = str(f["filed"]) ?? "";
    if (!end || !/^\d{4}-\d{2}-\d{2}$/.test(end) || !Number.isFinite(value)) continue;
    const fact: CoverFact = {
      end,
      value,
      accn: str(f["accn"]) ?? "",
      form: str(f["form"]) ?? "",
      filed,
      fy: typeof f["fy"] === "number" ? f["fy"] : null,
    };
    const prev = byEnd.get(end);
    if (!prev || prev.filed < filed) byEnd.set(end, fact);
  }
  return [...byEnd.values()].sort((a, b) => b.end.localeCompare(a.end)).slice(0, limit);
}

export function coverRow(
  cik: string,
  name: string,
  float: CoverFact[],
  shares: CoverFact[],
  retrieved: string,
) {
  const latest = float[0] ?? null;
  const latestShares = shares[0] ?? null;
  return corpusRecord(COVER_DATASET, `cover:${cik}`, `${name}: SEC cover-page facts`, {
    source_url: CONCEPT(cik, "EntityPublicFloat"),
    subtitle: latest
      ? `Public float ${latest.value.toLocaleString("en-US")} USD at ${latest.end} (${latest.form})`
      : "Public float not tagged",
    cells: {
      company: name,
      public_float: latest?.value ?? null,
      float_date: latest?.end ?? null,
      shares_outstanding: latestShares?.value ?? null,
      shares_date: latestShares?.end ?? null,
    },
    facts: [
      ["Company", name],
      [
        "Public float (dei:EntityPublicFloat)",
        latest
          ? `${latest.value.toLocaleString("en-US")} USD at ${latest.end}, ${latest.form} filed ${latest.filed}`
          : "Not recorded",
      ],
      [
        "Shares outstanding (dei:EntityCommonStockSharesOutstanding)",
        latestShares
          ? `${latestShares.value.toLocaleString("en-US")} at ${latestShares.end}, ${latestShares.form} filed ${latestShares.filed}`
          : "Not recorded",
      ],
      [
        "Meaning",
        "Public float is the market value of shares held by non-affiliates on the date the filer states (10-K cover page).",
      ],
      ["Source", `SEC data.sec.gov company concepts, retrieved ${retrieved}`],
    ],
    text: `${cik} ${name} public float shares outstanding`,
    filters: { company: [cik] },
    links: [
      { label: "Public float concept (SEC)", url: CONCEPT(cik, "EntityPublicFloat") },
      {
        label: "Shares outstanding concept (SEC)",
        url: CONCEPT(cik, "EntityCommonStockSharesOutstanding"),
      },
      { label: "Company profile", url: `/companies/${cik}` },
    ],
    extra: { cover: { public_float: float, shares_outstanding: shares } as unknown as JsonObject },
  });
}

export function comparableCover(content: RowContent): Json {
  const facts = (Array.isArray(content.detail["facts"]) ? content.detail["facts"] : []).map((f) =>
    Array.isArray(f) && f[0] === "Source" ? ["Source", "SEC data.sec.gov company concepts"] : f,
  );
  return {
    ...(content as unknown as JsonObject),
    detail: { ...content.detail, facts },
  } as unknown as Json;
}

export const companySecCover: SourceAdapter = {
  source: "company_sec_cover_facts",
  dataset: COVER_DATASET,
  mode: "upsert",
  ordinalPolicy: "append",
  functionName: "ingest-company-ir",
  limits: { maxRequests: COVER_PER_RUN * 2 + 2, minIntervalMs: 150 },
  secrets: [],

  async collect(ctx): Promise<Collected> {
    const cursor = (isObj(ctx.cursor) ? ctx.cursor : {}) as Obj;
    let next = typeof cursor["next"] === "number" ? cursor["next"] : 0;
    const retrieved = ctx.now.toISOString().slice(0, 10);
    const targets = await readTargets(ctx);
    const rows: CorpusRow[] = [];
    const held: HeldRecord[] = [];
    let fetched = 0;
    let complete = true;
    const notes: JsonObject = { targets: targets.length };
    const read = async (cik: string, tag: string) => {
      const res = await ctx.http.getText(CONCEPT(cik, tag));
      if (res.status === 404) return null;
      if (res.status !== 200) throw new Error(`SEC company concept HTTP ${res.status}`);
      return JSON.parse(res.text) as unknown;
    };
    try {
      for (let i = 0; i < COVER_PER_RUN && i < targets.length; i++) {
        const t = targets[next % targets.length]!;
        const float = await read(t.cik, "EntityPublicFloat");
        const shares = await read(t.cik, "EntityCommonStockSharesOutstanding");
        next = (next + 1) % targets.length;
        fetched++;
        const f = coverFacts(float, "USD", 8);
        const s = coverFacts(shares, "shares", 12);
        if (!f.length && !s.length) {
          held.push({ key: t.cik, reason: "no cover-page facts tagged" });
          continue;
        }
        rows.push(coverRow(t.cik, t.name, f, s, retrieved));
      }
    } catch (error) {
      if (error instanceof BudgetExhausted || error instanceof RateLimited) {
        complete = false;
        notes["stopped"] = error.message;
      } else throw error;
    }
    return { rows, fetched, held, cursorAfter: { next } as unknown as Json, complete, notes };
  },

  comparable: comparableCover,
};
