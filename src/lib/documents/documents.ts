/**
 * documents/1 client-safe shapes, parsers and labels (no I/O). The rows come from the documents_* RPCs
 * (database/contracts/documents-v1.sql, scope widened by documents-v2-docket-scope.sql): the court filings the published
 * matter and MDL pages list (with their MDL) and the open filings of every other docket (listed by their own case id,
 * with no MDL), open under the live availability rule, with page-numbered snippets cut from the stored text and exact
 * links only.
 */
import { assembleBlock, yearPoints, type TrendBlockData } from "@/lib/analytics/trend";

export const NOT_RECORDED = "Not recorded";

export const DOC_SOURCES = ["docketbird", "courtlistener", "official-court", "govinfo"] as const;
export type DocSource = (typeof DOC_SOURCES)[number];

export const TEXT_STATUSES = [
  "text_layer",
  "partial_text",
  "pending_index",
  "no_text_layer",
  "not_extracted",
  "withheld_policy",
] as const;
export type TextStatus = (typeof TEXT_STATUSES)[number];

export const COLLECTIONS = ["docket_filings", "court_mdl_pages", "govinfo_court_opinions"] as const;
export type DocCollection = (typeof COLLECTIONS)[number];

export const LISTED_BY = [
  "registry_pdf_case_id",
  "court_mdl_label",
  "derived_master_docket",
  "native_case_id",
] as const;
export type ListedBy = (typeof LISTED_BY)[number];

/** Document types the contract derives from the court's own wording (documents.doc_type). */
export const DOC_TYPES = [
  "order",
  "opinion",
  "proposed_order",
  "judgment",
  "report_recommendation",
  "motion",
  "response",
  "reply",
  "brief",
  "notice",
  "stipulation",
  "complaint",
  "answer",
  "transcript",
  "declaration",
  "exhibit",
  "letter",
  "minutes",
  "objection",
  "other",
] as const;
export type DocType = (typeof DOC_TYPES)[number];

export const TYPE_LABEL: Record<DocType | "not_recorded", string> = {
  order: "Order",
  opinion: "Opinion",
  proposed_order: "Proposed order",
  judgment: "Judgment",
  report_recommendation: "Report and recommendation",
  motion: "Motion",
  response: "Response",
  reply: "Reply",
  brief: "Brief or memorandum",
  notice: "Notice",
  stipulation: "Stipulation",
  complaint: "Complaint",
  answer: "Answer",
  transcript: "Transcript",
  declaration: "Declaration",
  exhibit: "Exhibit",
  letter: "Letter",
  minutes: "Minutes",
  objection: "Objection",
  other: "Other",
  not_recorded: "Type not recorded",
};

export const TEXT_STATUS_LABEL: Record<TextStatus, string> = {
  text_layer: "Text searchable",
  partial_text: "Partly searchable",
  pending_index: "Text not indexed yet",
  no_text_layer: "Scanned image, no text yet",
  not_extracted: "Text not extracted yet",
  withheld_policy: "Text not shown",
};

/** One sentence per status, for titles and the viewer. */
export const TEXT_STATUS_NOTE: Record<TextStatus, string> = {
  text_layer: "Every page with a text layer is searchable.",
  partial_text:
    "Some pages are scanned images still waiting for text recognition; only pages with text are searchable.",
  pending_index: "The stored text changed and will be searchable after the next index run.",
  no_text_layer:
    "The PDF is a scanned image without a text layer; it is not searchable until text recognition runs.",
  not_extracted: "The PDF's text has not been extracted yet, so it is not searchable.",
  withheld_policy:
    "The docket source marks this entry as held, sealed or with a withheld description, so its text is not shown or searched. The listing stays as published.",
};

export const COLLECTION_LABEL: Record<DocCollection, string> = {
  docket_filings: "Docket filing",
  court_mdl_pages: "Court MDL page",
  govinfo_court_opinions: "GovInfo court opinion",
};

export const SOURCE_LABEL: Record<DocSource, string> = {
  docketbird: "DocketBird",
  courtlistener: "CourtListener RECAP",
  "official-court": "Court website",
  govinfo: "GovInfo",
};

export const LISTED_BY_LABEL: Record<ListedBy, string> = {
  registry_pdf_case_id: "Listed on the matter page",
  court_mdl_label: "Listed on the court's MDL page",
  derived_master_docket: "Filed on the MDL's master docket",
  native_case_id: "Filed on its own docket (no MDL listing)",
};

export type DocSummary = {
  id: string;
  collection: DocCollection;
  sourceSystem: DocSource;
  nativeDocumentId: string;
  nativeCaseId: string;
  /** The MDL a published page lists the filing for; null for a filing listed only by its own docket. */
  mdl: string | null;
  listedBy: ListedBy;
  courtId: string | null;
  docketNumber: string | null;
  entryNumber: number | null;
  attachment: number | null;
  documentNumber: string | null;
  filedDate: string | null;
  dateBasis: string | null;
  title: string | null;
  titleBasis: string | null;
  docType: DocType | null;
  pageCount: number | null;
  pagesWithText: number | null;
  textStatus: TextStatus;
  sourceUrl: string | null;
  bytes: number | null;
};

export type SnippetPart = { text: string; hit: boolean };
export type Snippet = { page: number; parts: SnippetPart[] };
export type DocHit = DocSummary & {
  rank: number | null;
  matchedPages: number | null;
  snippets: Snippet[];
};
export type Facet = { key: string; count: number; label?: string };
export type DocFacets = { court: Facet[]; mdl: Facet[]; type: Facet[]; year: Facet[] };
export type DocSort = "relevance" | "newest" | "oldest";

export type DocSearchResult = {
  mode: "text" | "browse";
  rows: DocHit[];
  total: number;
  hasMore: boolean;
  capped: boolean;
  facets: DocFacets;
  query: string | null;
  sort: DocSort;
  droppedUnavailable: number;
  malformed: number;
  offset: number;
  limit: number;
};

export type DocLinkRow = {
  toType: "law_unit" | "mdl" | "record";
  toId: string;
  relation: "cites" | "mentions";
  evidence: string;
  mentions: number;
  firstPage: number | null;
  /** The citation as the filing writes it (first occurrence), normalized. */
  citedAs: string | null;
};
export type DocAmount = {
  page: number;
  matched: string;
  amount: number | null;
  sentence: string | null;
};
export type DocDetail = DocSummary & {
  dataset: string | null;
  recordId: string | null;
  courtBasis: string | null;
  docketBasis: string | null;
  typeBasis: string | null;
  publishedRecord: string | null;
  withheldReason: string | null;
  ocrPendingPages: number | null;
  indexedPages: number | null;
  extractions: Record<string, number>;
  links: DocLinkRow[];
  amounts: DocAmount[];
};

export type EntityType = "court" | "judge" | "mdl" | "law_unit" | "case";
export type EntityDoc = DocSummary & { mentions: number | null; firstPage: number | null };
export type EntityDocs = {
  type: EntityType;
  id: string;
  basis: string;
  total: number;
  withText: number;
  undated: number;
  byYear: [number, number][];
  byType: Facet[];
  mentions: number | null;
  recent: EntityDoc[];
  refreshed: string | null;
};

const isObj = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown, n = 500): string | null =>
  typeof v === "string" && v.trim() ? v.slice(0, n) : null;
const int = (v: unknown): number | null =>
  typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : null;
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const oneOf = <T extends string>(list: readonly T[], v: unknown): T | null =>
  typeof v === "string" && (list as readonly string[]).includes(v) ? (v as T) : null;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const day = (v: unknown): string | null => (typeof v === "string" && DAY.test(v) ? v : null);

/** Only http(s) links leave the app. */
export function safeUrl(v: unknown): string | null {
  const s = str(v, 2000);
  if (!s) return null;
  try {
    const u = new URL(s);
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : null;
  } catch {
    return null;
  }
}

export function parseDocSummary(v: unknown): DocSummary | null {
  if (!isObj(v)) return null;
  const id = typeof v["id"] === "string" && /^d_[0-9a-f]{24}$/.test(v["id"]) ? v["id"] : null;
  const collection = oneOf(COLLECTIONS, v["collection"]);
  const sourceSystem = oneOf(DOC_SOURCES, v["source_system"]);
  const nativeDocumentId = str(v["native_document_id"]);
  const nativeCaseId = str(v["native_case_id"]);
  const mdl = typeof v["mdl"] === "string" && /^[1-9][0-9]{0,5}$/.test(v["mdl"]) ? v["mdl"] : null;
  const listedBy = oneOf(LISTED_BY, v["listed_by"]);
  const textStatus = oneOf(TEXT_STATUSES, v["text_status"]);
  if (
    !id ||
    !collection ||
    !sourceSystem ||
    !nativeDocumentId ||
    !nativeCaseId ||
    !listedBy ||
    !textStatus
  )
    return null;
  // a docket-only filing never carries an MDL; a listed filing always does
  if (listedBy === "native_case_id" ? v["mdl"] !== null && v["mdl"] !== undefined : !mdl)
    return null;
  const court = str(v["court_id"], 40);
  return {
    id,
    collection,
    sourceSystem,
    nativeDocumentId,
    nativeCaseId,
    mdl,
    listedBy,
    courtId: court && /^[a-z0-9_-]{1,40}$/.test(court) ? court : null,
    docketNumber: str(v["docket_number"], 60),
    entryNumber: int(v["entry_number"]),
    attachment: int(v["attachment"]),
    documentNumber: str(v["document_number"], 40),
    filedDate: day(v["filed_date"]),
    dateBasis: str(v["date_basis"], 200),
    title: str(v["title"], 500),
    titleBasis: str(v["title_basis"], 120),
    docType: oneOf(DOC_TYPES, v["doc_type"]),
    pageCount: int(v["page_count"]),
    pagesWithText: int(v["pages_with_text"]),
    textStatus,
    sourceUrl: safeUrl(v["source_url"]),
    bytes: int(v["bytes"]),
  };
}

/** ts_headline output with [[ ]] around matches, split into plain and matched parts; the markers never reach the page. */
export function parseSnippetText(text: string): SnippetPart[] {
  const parts: SnippetPart[] = [];
  const re = /\[\[([\s\S]*?)\]\]/g;
  let last = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m.index > last) parts.push({ text: text.slice(last, m.index), hit: false });
    if (m[1]) parts.push({ text: m[1], hit: true });
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push({ text: text.slice(last), hit: false });
  return parts
    .map((p) => ({ ...p, text: p.text.replace(/\s+/g, " ") }))
    .filter((p) => p.text.length > 0);
}

export function parseSnippet(v: unknown): Snippet | null {
  if (!isObj(v)) return null;
  const page = int(v["page"]);
  const text = typeof v["text"] === "string" ? v["text"].slice(0, 2000) : null;
  if (!page || !text) return null;
  const parts = parseSnippetText(text);
  return parts.length ? { page, parts } : null;
}

export function parseDocHit(v: unknown): DocHit | null {
  const d = parseDocSummary(v);
  if (!d || !isObj(v)) return null;
  const snippets = Array.isArray(v["snippets"])
    ? (v["snippets"] as unknown[]).map(parseSnippet).filter((s): s is Snippet => !!s)
    : [];
  return { ...d, rank: num(v["rank"]), matchedPages: int(v["matched_pages"]), snippets };
}

function parseFacets(v: unknown): Facet[] {
  if (!Array.isArray(v)) return [];
  const out: Facet[] = [];
  for (const f of v) {
    if (!Array.isArray(f) || f.length !== 2) continue;
    const key = typeof f[0] === "string" ? f[0].slice(0, 60) : null;
    const count = int(f[1]);
    if (key && count !== null) out.push({ key, count });
  }
  return out;
}

export function parseSearchResult(v: unknown): DocSearchResult | null {
  if (!isObj(v)) return null;
  const list = Array.isArray(v["rows"]) ? (v["rows"] as unknown[]) : [];
  const rows = list.map(parseDocHit).filter((r): r is DocHit => !!r);
  const f = isObj(v["facets"]) ? v["facets"] : {};
  return {
    mode: v["mode"] === "text" ? "text" : "browse",
    rows,
    total: int(v["total"]) ?? rows.length,
    hasMore: v["has_more"] === true,
    capped: v["capped"] === true,
    facets: {
      court: parseFacets(f["court"]),
      mdl: parseFacets(f["mdl"]),
      type: parseFacets(f["type"]),
      year: parseFacets(f["year"]),
    },
    query: str(v["query"], 600),
    sort: oneOf(["relevance", "newest", "oldest"] as const, v["sort"]) ?? "newest",
    droppedUnavailable: int(v["dropped_unavailable"]) ?? 0,
    malformed: list.length - rows.length,
    offset: int(v["offset"]) ?? 0,
    limit: int(v["limit"]) ?? rows.length,
  };
}

export function parseDocDetail(v: unknown): DocDetail | null {
  const d = parseDocSummary(v);
  if (!d || !isObj(v)) return null;
  const ex: Record<string, number> = {};
  if (isObj(v["extractions"]))
    for (const [k, n] of Object.entries(v["extractions"]))
      if (int(n) !== null) ex[k.slice(0, 40)] = n as number;
  const links: DocLinkRow[] = Array.isArray(v["links"])
    ? (v["links"] as unknown[]).flatMap((l) => {
        if (!isObj(l)) return [];
        const toType = oneOf(["law_unit", "mdl", "record"] as const, l["to_type"]);
        const relation = oneOf(["cites", "mentions"] as const, l["relation"]);
        const toId = str(l["to_id"], 120);
        if (!toType || !relation || !toId) return [];
        return [
          {
            toType,
            toId,
            relation,
            evidence: str(l["evidence"], 40) ?? "exact_id",
            mentions: int(l["mentions"]) ?? 1,
            firstPage: int(l["first_page"]),
            citedAs: str(l["cited_as"], 120),
          },
        ];
      })
    : [];
  const amounts: DocAmount[] = Array.isArray(v["amounts"])
    ? (v["amounts"] as unknown[]).flatMap((a) => {
        if (!isObj(a)) return [];
        const page = int(a["page"]);
        const matched = str(a["matched"], 80);
        if (!page || !matched) return [];
        const value = isObj(a["value"]) ? a["value"] : {};
        return [
          { page, matched, amount: num(value["amount"]), sentence: str(value["sentence"], 600) },
        ];
      })
    : [];
  return {
    ...d,
    dataset: str(v["dataset"], 40),
    recordId: str(v["record_id"], 80),
    courtBasis: str(v["court_basis"], 120),
    docketBasis: str(v["docket_basis"], 120),
    typeBasis: str(v["type_basis"], 120),
    publishedRecord: str(v["published_record"], 160),
    withheldReason: str(v["withheld_reason"], 60),
    ocrPendingPages: int(v["ocr_pending_pages"]),
    indexedPages: int(v["indexed_pages"]),
    extractions: ex,
    links,
    amounts,
  };
}

export function parseEntityDocs(v: unknown): EntityDocs | null {
  if (!isObj(v)) return null;
  const type = oneOf(["court", "judge", "mdl", "law_unit", "case"] as const, v["type"]);
  const id = str(v["id"], 120);
  if (!type || !id) return null;
  const byYear: [number, number][] = Array.isArray(v["by_year"])
    ? (v["by_year"] as unknown[]).flatMap((p) =>
        Array.isArray(p) && int(p[0]) !== null && int(p[1]) !== null
          ? [[p[0] as number, p[1] as number] as [number, number]]
          : [],
      )
    : [];
  const recent: EntityDoc[] = Array.isArray(v["recent"])
    ? (v["recent"] as unknown[]).flatMap((r) => {
        const d = parseDocSummary(r);
        return d && isObj(r)
          ? [{ ...d, mentions: int(r["mentions"]), firstPage: int(r["first_page"]) }]
          : [];
      })
    : [];
  return {
    type,
    id,
    basis: str(v["basis"], 400) ?? "",
    total: int(v["total"]) ?? 0,
    withText: int(v["with_text"]) ?? 0,
    undated: int(v["undated"]) ?? 0,
    byYear,
    byType: parseFacets(v["by_type"]),
    mentions: int(v["mentions"]),
    recent,
    refreshed: str(v["refreshed"], 40),
  };
}

/** The in-app PDF stream (it re-checks availability on every request), opened at a page when one is given. */
export function documentPdfUrl(
  d: Pick<DocSummary, "sourceSystem" | "nativeDocumentId">,
  page?: number | null,
): string {
  const p = new URLSearchParams({ source: d.sourceSystem, doc: d.nativeDocumentId });
  return `/api/matter-pdf?${p.toString()}${page && page > 0 ? `#page=${page}` : ""}`;
}

/** The title as published, else what identifies the filing. Never invented. */
export function documentTitle(
  d: Pick<DocSummary, "title" | "entryNumber" | "attachment" | "documentNumber">,
): string {
  if (d.title) return d.title;
  if (d.entryNumber !== null)
    return `Docket entry ${d.entryNumber}${d.attachment ? `, attachment ${d.attachment}` : ""} (no description published)`;
  if (d.documentNumber) return `Document ${d.documentNumber} (no title published)`;
  return "Untitled filing (no title published)";
}

export function typeLabel(t: string | null | undefined): string {
  return t && t in TYPE_LABEL ? TYPE_LABEL[t as DocType] : TYPE_LABEL.not_recorded;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export function fmtDay(iso: string | null | undefined): string {
  if (!iso || !DAY.test(iso)) return NOT_RECORDED;
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  return `${MONTHS[m - 1]} ${d}, ${y}`;
}

export function fmtCount(n: number | null | undefined): string {
  return n == null ? NOT_RECORDED : n.toLocaleString("en-US");
}

const enc = encodeURIComponent;

/** In-app page of a link target, when the app has one; the label says what the link is. */
export function linkTarget(l: Pick<DocLinkRow, "toType" | "toId"> & { citedAs?: string | null }): {
  href: string | null;
  label: string;
} {
  if (l.toType === "law_unit") {
    const usc = /^usc:([0-9]{1,2}a?):(.+)$/.exec(l.toId);
    if (usc)
      return {
        href: `/law/uscode/${enc(usc[1]!)}/${enc(usc[2]!)}`,
        label: `${usc[1]} U.S.C. § ${usc[2]}`,
      };
    const cfr = /^cfr:([0-9]{1,2}):([0-9]{1,5})$/.exec(l.toId);
    if (cfr)
      return {
        href: `/law/cfr/${enc(cfr[1]!)}/part/${enc(cfr[2]!)}`,
        label: `${cfr[1]} C.F.R. part ${cfr[2]}`,
      };
  }
  if (l.toType === "mdl" && /^[1-9][0-9]{0,5}$/.test(l.toId))
    return { href: `/matters/${enc(l.toId)}`, label: `MDL No. ${l.toId}` };
  if (l.toType === "record") {
    const c = /^caselaw\/([1-9][0-9]{0,9})$/.exec(l.toId);
    if (c) return { href: `/cases/${c[1]}`, label: l.citedAs ?? `Decision ${c[1]}` };
  }
  return { href: null, label: l.toId };
}

/** Searchable states: the text is in the index (fully or partly). */
export const searchable = (s: TextStatus) => s === "text_layer" || s === "partial_text";

// ------------------------------------------------------------------ URL state of the search page

export type DocSearchState = {
  q?: string | undefined;
  court?: string | undefined;
  mdl?: string | undefined;
  type?: DocType | undefined;
  from?: string | undefined;
  to?: string | undefined;
  sort?: DocSort | undefined;
  page?: number | undefined;
};
export const PAGE_SIZE = 20;
export const MAX_PAGE = 50;

const validDay = (v: unknown) => {
  if (typeof v !== "string" || !DAY.test(v)) return undefined;
  const t = new Date(`${v}T00:00:00Z`);
  return Number.isNaN(t.getTime()) || t.toISOString().slice(0, 10) !== v ? undefined : v;
};

export function normalizeDocumentSearch(s: Record<string, unknown>): DocSearchState {
  const out: DocSearchState = {};
  if (typeof s["q"] === "string" && s["q"].trim()) out.q = s["q"].trim().slice(0, 300);
  if (typeof s["court"] === "string" && /^[a-z0-9_-]{1,40}$/.test(s["court"]))
    out.court = s["court"];
  const mdl = typeof s["mdl"] === "number" ? String(s["mdl"]) : s["mdl"];
  if (typeof mdl === "string" && /^[1-9][0-9]{0,5}$/.test(mdl)) out.mdl = mdl;
  const type = oneOf(DOC_TYPES, s["type"]);
  if (type) out.type = type;
  out.from = validDay(s["from"]);
  out.to = validDay(s["to"]);
  if (out.from && out.to && out.from > out.to) [out.from, out.to] = [out.to, out.from];
  const sort = oneOf(["relevance", "newest", "oldest"] as const, s["sort"]);
  if (sort && (sort !== "relevance" || out.q)) out.sort = sort;
  const page =
    typeof s["page"] === "number"
      ? s["page"]
      : typeof s["page"] === "string"
        ? Number(s["page"])
        : NaN;
  if (Number.isInteger(page) && page >= 2 && page <= MAX_PAGE) out.page = page;
  for (const k of Object.keys(out) as (keyof DocSearchState)[])
    if (out[k] === undefined) delete out[k];
  return out;
}

// ------------------------------------------------------------------ trend block for entity panels

export const ENTITY_NOUN: Record<EntityType, string> = {
  court: "court",
  judge: "judge",
  mdl: "MDL",
  law_unit: "provision",
  case: "decision",
};

/**
 * Filings per year for an entity panel. Every year from the first to the last dated filing is drawn; a year inside that
 * span with no filing in the collection is 0 (the collection is ours and complete for what it lists), the current year is
 * partial, and undated filings are counted in the notes, never placed in a year.
 */
export function documentsTrend(e: EntityDocs, today: string): TrendBlockData | null {
  if (!e.byYear.length) return null;
  const thisYear = Number(today.slice(0, 4));
  const lo = Math.min(...e.byYear.map(([y]) => y));
  const hi = Math.max(...e.byYear.map(([y]) => y));
  const counts = new Map(e.byYear);
  const entries = [];
  for (let y = lo; y <= hi; y += 1)
    entries.push({
      year: y,
      value: counts.get(y) ?? 0,
      ...(y >= thisYear ? { partial: true } : {}),
    });
  const cited = e.type === "law_unit" || e.type === "case";
  const notes = [
    cited
      ? "Counts filings in this collection whose text cites it, by the filing date; a filing citing it several times counts once."
      : "Counts filings in this collection, by the filing date the docket or the court's page gives (else the date printed in the ECF header).",
    "The collection is the court filings the published matter pages list and that are open to view; it is not every filing in these cases.",
    "A year without a filing in the collection shows 0. The current year is partial.",
  ];
  if (e.undated)
    notes.push(
      `${fmtCount(e.undated)} filing${e.undated === 1 ? " has" : "s have"} no recorded date and are not drawn.`,
    );
  return assembleBlock({
    id: `documents-${e.type}-${e.id}`,
    xKind: "year",
    chart: "bar",
    unit: "filings",
    series: [
      {
        id: "filings",
        label: cited ? "Filings citing it" : "Filings",
        points: yearPoints(entries),
      },
    ],
    source: { label: "Court filings listed on the matter pages", url: "/litigation/documents" },
    asOf: e.refreshed ? e.refreshed.slice(0, 10) : null,
    notes,
  });
}
