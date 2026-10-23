/**
 * Regulations.gov API v4 → regulations_gov_documents and regulations_gov_dockets (wave 1025, api-law).
 *
 * One implementation for the full load (scripts/api_law/regulations_gov/*.mjs, run under Node with type stripping) and
 * for the scheduled refresh (supabase/functions/ingest-regulations-gov): the rows the full load writes and the rows a
 * scheduled run writes for the same API record are built by the same functions below.
 *
 * Scope: the agencies of the corpus's rulemaking views (the twelve of scripts/enrichment/rulemaking/build_rulemaking.py;
 * each Regulations.gov agency id equals that agency's Federal Register short name, checked against
 * https://www.federalregister.gov/api/v1/agencies on 2026-10-23). Documents: types Rule, Proposed Rule and Notice.
 * Dockets: every docket of those agencies.
 *
 * Exact identifiers only:
 *   - a document links to its Federal Register document by the published frDocNum, and to this corpus's
 *     federal_register_history record only when that record's source_url is https://www.federalregister.gov/d/<frDocNum>;
 *     CFR parts come from that Federal Register record's own cfr_pair values (never from text);
 *   - a document links to its docket by the published docketId.
 * Comment counts are the comments API's totalElements for filter[commentOnId]=<objectId> (document) or
 * filter[docketId]=<docketId> (docket): public submissions the agency has posted on Regulations.gov, which can be fewer
 * than it received. A count not read yet is null and shows as "Not recorded".
 *
 * Time: Regulations.gov answers instants in UTC and reads date-time filters in Eastern time (checked 2026-10-23: a
 * filter of 19:41:36 matched 23:41:36Z). Calendar dates shown here are Eastern-time dates of the published instant.
 */
import { BudgetExhausted, RateLimited } from "../http.ts";
import { maskPath } from "../rows.ts";
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

export const REGS_API = "https://api.regulations.gov/v4";
export const REGS_SITE = "https://www.regulations.gov";
export const REGS_DOCS = "https://open.gsa.gov/api/regulationsgov/";
export const DOCS_DATASET = "regulations_gov_documents";
export const DOCKETS_DATASET = "regulations_gov_dockets";
export const FR_DATASET = "federal_register_history";
export const NOT_RECORDED = "Not recorded";
export const PAGE_SIZE = 250;
/** Regulations.gov returns at most 20 pages of one query (5,000 records); larger sets are split by date window. */
export const MAX_PAGES_PER_QUERY = 20;

/** Regulations.gov agency id → Federal Register agency id and name (FR /agencies short_name equals the id). */
export const AGENCIES: readonly { id: string; frId: string; name: string }[] = [
  { id: "FDA", frId: "199", name: "Food and Drug Administration" },
  { id: "CPSC", frId: "84", name: "Consumer Product Safety Commission" },
  { id: "NHTSA", frId: "345", name: "National Highway Traffic Safety Administration" },
  { id: "EPA", frId: "145", name: "Environmental Protection Agency" },
  { id: "FTC", frId: "192", name: "Federal Trade Commission" },
  { id: "OSHA", frId: "386", name: "Occupational Safety and Health Administration" },
  { id: "CMS", frId: "45", name: "Centers for Medicare & Medicaid Services" },
  { id: "DEA", frId: "116", name: "Drug Enforcement Administration" },
  { id: "FAA", frId: "159", name: "Federal Aviation Administration" },
  { id: "CFPB", frId: "573", name: "Consumer Financial Protection Bureau" },
  { id: "SEC", frId: "466", name: "Securities and Exchange Commission" },
  { id: "PHMSA", frId: "408", name: "Pipeline and Hazardous Materials Safety Administration" },
];
export const AGENCY_IDS = AGENCIES.map((a) => a.id);
const AGENCY_BY_ID = new Map(AGENCIES.map((a) => [a.id, a]));

export const DOC_TYPES = ["Rule", "Proposed Rule", "Notice"] as const;
export type DocType = (typeof DOC_TYPES)[number];
export const TYPE_SLUG: Record<DocType, string> = {
  Rule: "rule",
  "Proposed Rule": "proposed_rule",
  Notice: "notice",
};
export const TYPE_LABEL: Record<string, string> = {
  rule: "Rule",
  proposed_rule: "Proposed Rule",
  notice: "Notice",
};

/* ------------------------------------------------------------------------------------------------ time */

const ET_PARTS = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/New_York",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

function etParts(instant: string): Record<string, string> | null {
  const t = Date.parse(instant);
  if (!Number.isFinite(t)) return null;
  const out: Record<string, string> = {};
  for (const p of ET_PARTS.formatToParts(new Date(t))) out[p.type] = p.value;
  return out;
}

/** Eastern-time calendar date (YYYY-MM-DD) of a published instant; null when absent or unreadable. */
export function etDate(instant: string | null | undefined): string | null {
  if (!instant) return null;
  const p = etParts(instant);
  return p ? `${p["year"]}-${p["month"]}-${p["day"]}` : null;
}

/** Eastern-time "YYYY-MM-DD HH:MM:SS" of an instant: the form Regulations.gov's date-time filters read. */
export function etFilterTime(instant: string): string {
  const p = etParts(instant);
  if (!p) throw new Error(`not an instant: ${instant.slice(0, 40)}`);
  return `${p["year"]}-${p["month"]}-${p["day"]} ${p["hour"]}:${p["minute"]}:${p["second"]}`;
}

/* ------------------------------------------------------------------------------------------------ source records */

export type RegsDocument = {
  id: string;
  agencyId: string;
  docketId: string | null;
  documentType: string;
  subtype: string | null;
  title: string | null;
  postedDate: string | null;
  commentStartDate: string | null;
  commentEndDate: string | null;
  lastModifiedDate: string | null;
  frDocNum: string | null;
  objectId: string | null;
  withdrawn: boolean | null;
  allowLateComments: boolean | null;
};

export type RegsDocket = {
  id: string;
  agencyId: string;
  docketType: string | null;
  title: string | null;
  lastModifiedDate: string | null;
  objectId: string | null;
};

const s = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);
const b = (v: unknown): boolean | null => (typeof v === "boolean" ? v : null);
const DOC_ID = /^[A-Za-z0-9][A-Za-z0-9_.-]{2,120}$/;

/** A document of a list or detail response, attribute values exactly as published (empty strings read as absent). */
export function normalizeDocument(rec: JsonObject): RegsDocument | null {
  const a = (rec["attributes"] ?? {}) as JsonObject;
  const id = s(rec["id"]);
  if (!id || !DOC_ID.test(id)) return null;
  const agencyId = s(a["agencyId"]);
  const documentType = s(a["documentType"]);
  if (!agencyId || !documentType) return null;
  return {
    id,
    agencyId,
    docketId: s(a["docketId"]),
    documentType,
    subtype: s(a["subtype"]),
    title: s(a["title"]),
    postedDate: s(a["postedDate"]),
    commentStartDate: s(a["commentStartDate"]),
    commentEndDate: s(a["commentEndDate"]),
    lastModifiedDate: s(a["lastModifiedDate"]) ?? s(a["modifyDate"]),
    frDocNum: s(a["frDocNum"]),
    objectId: s(a["objectId"]),
    withdrawn: b(a["withdrawn"]),
    allowLateComments: b(a["allowLateComments"]),
  };
}

export function normalizeDocket(rec: JsonObject): RegsDocket | null {
  const a = (rec["attributes"] ?? {}) as JsonObject;
  const id = s(rec["id"]) ?? s(a["docketId"]);
  if (!id || !DOC_ID.test(id)) return null;
  const agencyId = s(a["agencyId"]);
  if (!agencyId) return null;
  return {
    id,
    agencyId,
    docketType: s(a["docketType"]),
    title: s(a["title"]),
    lastModifiedDate: s(a["lastModifiedDate"]) ?? s(a["modifyDate"]),
    objectId: s(a["objectId"]),
  };
}

/** Rebuild the source record from a stored row (the row keeps it unchanged under item.regs_document / regs_docket). */
export function storedDocument(row: Pick<StoredRow, "item">): RegsDocument | null {
  const d = row.item["regs_document"] as JsonObject | undefined;
  return d && typeof d["id"] === "string" ? (d as unknown as RegsDocument) : null;
}
export function storedDocket(row: Pick<StoredRow, "item">): RegsDocket | null {
  const d = row.item["regs_docket"] as JsonObject | undefined;
  return d && typeof d["id"] === "string" ? (d as unknown as RegsDocket) : null;
}

/* ------------------------------------------------------------------------------------------------ links and counts */

/** The corpus Federal Register record a document links to (exact source_url), or the reason there is none. */
export type FrLink = {
  document_number: string | null;
  record_id: string | null;
  status: "in_corpus" | "not_in_corpus" | "none_stated";
  cfr_pairs: string[];
};

export const frUrl = (docNum: string) => `https://www.federalregister.gov/d/${docNum}`;

/** FrLink for a document from the federal_register_history rows found by source_url (none = not in the corpus). */
export function frLinkFor(
  doc: RegsDocument,
  frRows: Map<string, StoredRow | { id: string; filters: JsonObject }>,
): FrLink {
  if (!doc.frDocNum)
    return { document_number: null, record_id: null, status: "none_stated", cfr_pairs: [] };
  const row = frRows.get(frUrl(doc.frDocNum));
  if (!row)
    return {
      document_number: doc.frDocNum,
      record_id: null,
      status: "not_in_corpus",
      cfr_pairs: [],
    };
  const pairs = (row.filters?.["cfr_pair"] ?? []) as Json;
  return {
    document_number: doc.frDocNum,
    record_id: row.id,
    status: "in_corpus",
    cfr_pairs: Array.isArray(pairs)
      ? pairs.filter(
          (p): p is string => typeof p === "string" && /^\d{1,2}:[0-9A-Za-z.-]{1,20}$/.test(p),
        )
      : [],
  };
}

export type CommentCount = {
  /** comments API totalElements */
  posted: number;
  scope: "document" | "docket";
  /** UTC date the count was read */
  read_on: string;
  /** the request (without key) */
  api_url: string;
};

export const docCommentsUrl = (objectId: string) =>
  `${REGS_API}/comments?filter[commentOnId]=${encodeURIComponent(objectId)}&page[size]=5`;
export const docketCommentsUrl = (docketId: string) =>
  `${REGS_API}/comments?filter[docketId]=${encodeURIComponent(docketId)}&page[size]=5`;

/** totalElements of a comments response; null when the response is not the documented shape. */
export function commentTotal(body: unknown): number | null {
  const meta = (body as { meta?: { totalElements?: unknown } } | null)?.meta;
  const n = meta?.totalElements;
  return typeof n === "number" && Number.isInteger(n) && n >= 0 ? n : null;
}

export function commentBucket(c: CommentCount | null): string {
  if (!c) return "not_recorded";
  const n = c.posted;
  if (n === 0) return "0";
  if (n < 10) return "1-9";
  if (n < 100) return "10-99";
  if (n < 1000) return "100-999";
  if (n < 10000) return "1000-9999";
  return "10000+";
}
export const COMMENT_BUCKETS: Record<string, string> = {
  "0": "None posted",
  "1-9": "1 to 9",
  "10-99": "10 to 99",
  "100-999": "100 to 999",
  "1000-9999": "1,000 to 9,999",
  "10000+": "10,000 or more",
  not_recorded: "Not recorded",
};

/* ------------------------------------------------------------------------------------------------ rows */

const fmt = (n: number) => n.toLocaleString("en-US");
const docUrl = (id: string) => `${REGS_SITE}/document/${id}`;
const docketUrl = (id: string) => `${REGS_SITE}/docket/${id}`;
const yesNo = (v: boolean | null) => (v === null ? NOT_RECORDED : v ? "Yes" : "No");
const agencyName = (id: string) => AGENCY_BY_ID.get(id)?.name ?? id;

export type Provenance = { api_url: string; retrieved_at: string };

export function documentRow(
  doc: RegsDocument,
  fr: FrLink,
  comments: CommentCount | null,
  prov: Provenance,
): CorpusRow {
  const posted = etDate(doc.postedDate);
  const start = etDate(doc.commentStartDate);
  const end = etDate(doc.commentEndDate);
  const slug = (TYPE_SLUG as Record<string, string>)[doc.documentType] ?? "other";
  const typeText = doc.subtype ? `${doc.documentType} (${doc.subtype})` : doc.documentType;
  const title = doc.title ?? `${doc.documentType} ${doc.id}`;
  const period =
    start && end
      ? `${start} to ${end}`
      : end
        ? `ends ${end}`
        : start
          ? `from ${start}`
          : NOT_RECORDED;
  const cfrTitles = [...new Set(fr.cfr_pairs.map((p) => p.split(":")[0]!))];
  const links: Json[] = [{ url: docUrl(doc.id), label: "Document on Regulations.gov" }];
  if (doc.docketId) {
    links.push({ url: `/law/rulemaking/dockets/${doc.docketId}`, label: `Docket ${doc.docketId}` });
    links.push({ url: docketUrl(doc.docketId), label: "Docket on Regulations.gov" });
  }
  if (fr.document_number)
    links.push({
      url: frUrl(fr.document_number),
      label: `Federal Register document ${fr.document_number}`,
    });
  if (fr.record_id)
    links.push({
      url: `/records/${FR_DATASET}/${fr.record_id}`,
      label: "Federal Register record in this atlas",
    });
  const facts: [string, Json][] = [
    ["Document ID", doc.id],
    ["Agency", `${agencyName(doc.agencyId)} (${doc.agencyId})`],
    ["Document type", doc.documentType],
    ["Subtype", doc.subtype ?? NOT_RECORDED],
    ["Docket ID", doc.docketId ?? NOT_RECORDED],
    [
      "Posted on Regulations.gov",
      posted ? `${posted} (Eastern time; published instant ${doc.postedDate})` : NOT_RECORDED,
    ],
    ["Comment period", period],
    ["Late comments allowed", yesNo(doc.allowLateComments)],
    ["Withdrawn", yesNo(doc.withdrawn)],
    ["Federal Register document number", fr.document_number ?? "None stated by Regulations.gov"],
    [
      "Federal Register record in this atlas",
      fr.status === "in_corpus"
        ? `Yes, record ${fr.record_id} (exact document number)`
        : fr.status === "not_in_corpus"
          ? "No record with this document number"
          : "Not applicable",
    ],
    [
      "CFR parts (from the Federal Register record)",
      fr.cfr_pairs.length
        ? fr.cfr_pairs.map((p) => p.replace(":", " CFR Part ")).join("; ")
        : fr.status === "in_corpus"
          ? "None listed in the Federal Register record"
          : NOT_RECORDED,
    ],
    [
      "Public comments posted on this document",
      comments
        ? `${fmt(comments.posted)} (Regulations.gov comments API, read ${comments.read_on})`
        : NOT_RECORDED,
    ],
    ["Last modified on Regulations.gov", doc.lastModifiedDate ?? NOT_RECORDED],
    ["Source", `Regulations.gov API v4, document ${doc.id} (${REGS_DOCS})`],
  ];
  return corpusRecord(DOCS_DATASET, doc.id, title, {
    source_url: docUrl(doc.id),
    subtitle: [
      agencyName(doc.agencyId),
      typeText,
      posted ? `posted ${posted}` : null,
      doc.docketId ? `docket ${doc.docketId}` : null,
    ]
      .filter(Boolean)
      .join(" · "),
    cells: {
      agency: doc.agencyId,
      type: typeText,
      posted: posted ?? NOT_RECORDED,
      docket: doc.docketId ?? NOT_RECORDED,
      fr_doc: fr.document_number ?? "None stated",
      comment_period: period,
      comments: comments ? fmt(comments.posted) : NOT_RECORDED,
    },
    facts: facts as unknown as Json,
    badges: [doc.documentType, ...(doc.withdrawn ? ["Withdrawn"] : [])],
    links,
    text: [
      doc.agencyId,
      agencyName(doc.agencyId),
      doc.docketId,
      doc.frDocNum,
      doc.subtype,
    ]
      .filter(Boolean)
      .join(" "),
    filters: {
      agency: [doc.agencyId],
      type: [slug],
      year: posted ? [posted.slice(0, 4)] : [],
      docket: doc.docketId ? [doc.docketId] : [],
      fr_doc: fr.document_number ? [fr.document_number] : [],
      fr_linked: [fr.status],
      comment_end: end ? [end] : [],
      comments: [commentBucket(comments)],
      cfr_pair: fr.cfr_pairs,
      cfr_title: cfrTitles,
      withdrawn: doc.withdrawn ? ["yes"] : ["no"],
    },
    extra: {
      kind: "document",
      regs_document: doc as unknown as JsonObject,
      dates_et: { posted, comment_start: start, comment_end: end },
      federal_register: fr as unknown as JsonObject,
      comments: (comments as unknown as JsonObject) ?? null,
      provenance: prov as unknown as JsonObject,
    },
  });
}

/** The year printed in a docket id (EPA-HQ-OAR-2021-0317 → 2021), or null. */
export function docketIdYear(id: string): string | null {
  const m = /-((?:19|20)\d{2})-/.exec(id);
  return m ? m[1]! : null;
}

export function docketRow(
  d: RegsDocket,
  comments: CommentCount | null,
  prov: Provenance,
): CorpusRow {
  const modified = etDate(d.lastModifiedDate);
  const typeSlug =
    d.docketType === "Rulemaking"
      ? "rulemaking"
      : d.docketType === "Nonrulemaking"
        ? "nonrulemaking"
        : "other";
  const year = docketIdYear(d.id);
  const title = d.title ?? `Docket ${d.id}`;
  return corpusRecord(DOCKETS_DATASET, d.id, title, {
    source_url: docketUrl(d.id),
    subtitle: [
      agencyName(d.agencyId),
      d.docketType ? `${d.docketType} docket` : null,
      modified ? `modified ${modified}` : null,
    ]
      .filter(Boolean)
      .join(" · "),
    cells: {
      agency: d.agencyId,
      docket_type: d.docketType ?? NOT_RECORDED,
      modified: modified ?? NOT_RECORDED,
      comments: comments ? fmt(comments.posted) : NOT_RECORDED,
    },
    facts: [
      ["Docket ID", d.id],
      ["Agency", `${agencyName(d.agencyId)} (${d.agencyId})`],
      ["Docket type", d.docketType ?? NOT_RECORDED],
      ["Year in the docket ID", year ?? NOT_RECORDED],
      ["Last modified on Regulations.gov", d.lastModifiedDate ?? NOT_RECORDED],
      [
        "Public comments posted in this docket",
        comments
          ? `${fmt(comments.posted)} (Regulations.gov comments API, read ${comments.read_on})`
          : NOT_RECORDED,
      ],
      ["Source", `Regulations.gov API v4, docket ${d.id} (${REGS_DOCS})`],
    ] as unknown as Json,
    badges: d.docketType ? [d.docketType] : [],
    links: [
      { url: `/law/rulemaking/dockets/${d.id}`, label: "Docket in this atlas" },
      { url: docketUrl(d.id), label: "Docket on Regulations.gov" },
    ],
    text: [d.agencyId, agencyName(d.agencyId)].join(" "),
    filters: {
      agency: [d.agencyId],
      docket_type: [typeSlug],
      id_year: year ? [year] : [],
      comments: [commentBucket(comments)],
    },
    extra: {
      kind: "docket",
      regs_docket: d as unknown as JsonObject,
      dates_et: { modified },
      comments: (comments as unknown as JsonObject) ?? null,
      provenance: prov as unknown as JsonObject,
    },
  });
}

/** Change detection ignores when and through which query a record was read, and when an unchanged count was read. */
export function comparableRegs(c: RowContent): Json {
  let v = c as unknown as Json;
  v = maskPath(v, ["item", "provenance"]);
  v = maskPath(v, ["item", "comments", "read_on"]);
  v = maskPath(v, ["item", "comments", "api_url"]);
  // the facts restate the read date of the count
  const detail = (v as JsonObject)["detail"] as JsonObject;
  const facts = Array.isArray(detail?.["facts"])
    ? (detail["facts"] as Json[]).map((f) =>
        Array.isArray(f) &&
        typeof f[1] === "string" &&
        /\(Regulations\.gov comments API, read \d{4}-\d{2}-\d{2}\)$/.test(f[1])
          ? [f[0]!, f[1].replace(/, read \d{4}-\d{2}-\d{2}\)$/, ")")]
          : f,
      )
    : detail?.["facts"];
  return { ...(v as JsonObject), detail: { ...detail, facts: facts ?? null } };
}

/* ------------------------------------------------------------------------------------------------ API URLs */

export function documentsQuery(p: {
  agencies: readonly string[];
  types?: readonly string[];
  postedFrom?: string;
  postedTo?: string;
  modifiedFromEt?: string;
  commentEndFrom?: string;
  sort?: string;
  page?: number;
  size?: number;
}): string {
  const q: string[] = [`filter[agencyId]=${p.agencies.join(",")}`];
  q.push(`filter[documentType]=${(p.types ?? DOC_TYPES).map(encodeURIComponent).join(",")}`);
  if (p.postedFrom) q.push(`filter[postedDate][ge]=${p.postedFrom}`);
  if (p.postedTo) q.push(`filter[postedDate][le]=${p.postedTo}`);
  if (p.modifiedFromEt)
    q.push(`filter[lastModifiedDate][ge]=${encodeURIComponent(p.modifiedFromEt)}`);
  if (p.commentEndFrom) q.push(`filter[commentEndDate][ge]=${p.commentEndFrom}`);
  q.push(`sort=${p.sort ?? "lastModifiedDate,documentId"}`);
  q.push(`page[size]=${p.size ?? PAGE_SIZE}`);
  q.push(`page[number]=${p.page ?? 1}`);
  return `${REGS_API}/documents?${q.join("&")}`;
}

export function docketsQuery(p: {
  agencies: readonly string[];
  modifiedFromEt?: string;
  modifiedToEt?: string;
  page?: number;
  size?: number;
}): string {
  const q: string[] = [`filter[agencyId]=${p.agencies.join(",")}`];
  if (p.modifiedFromEt)
    q.push(`filter[lastModifiedDate][ge]=${encodeURIComponent(p.modifiedFromEt)}`);
  if (p.modifiedToEt) q.push(`filter[lastModifiedDate][le]=${encodeURIComponent(p.modifiedToEt)}`);
  q.push("sort=lastModifiedDate,docketId");
  q.push(`page[size]=${p.size ?? PAGE_SIZE}`);
  q.push(`page[number]=${p.page ?? 1}`);
  return `${REGS_API}/dockets?${q.join("&")}`;
}

export type ListPage = { data: JsonObject[]; total: number; hasNextPage: boolean };

export function parseListPage(text: string): ListPage {
  const doc = JSON.parse(text) as {
    data?: unknown;
    meta?: { totalElements?: unknown; hasNextPage?: unknown };
  };
  if (!Array.isArray(doc.data) || typeof doc.meta?.totalElements !== "number")
    throw new Error("Unexpected Regulations.gov list shape");
  return {
    data: doc.data as JsonObject[],
    total: doc.meta.totalElements,
    hasNextPage: doc.meta.hasNextPage === true,
  };
}

/**
 * Dataset order (ordinal policy 'prepend'): newest posted first, then document id descending; a document without a
 * posted date sorts after the dated ones. The full load and a scheduled run sort the same way.
 */
export function sortDocumentsNewestFirst(docs: RegsDocument[]): RegsDocument[] {
  return [...docs].sort(
    (a, b) =>
      (b.postedDate ?? "").localeCompare(a.postedDate ?? "") ||
      (b.id < a.id ? -1 : b.id > a.id ? 1 : 0),
  );
}

/** Dockets: newest modification first, then docket id descending. */
export function sortDocketsNewestFirst(ds: RegsDocket[]): RegsDocket[] {
  return [...ds].sort(
    (a, b) =>
      (b.lastModifiedDate ?? "").localeCompare(a.lastModifiedDate ?? "") ||
      (b.id < a.id ? -1 : b.id > a.id ? 1 : 0),
  );
}

/** Whether a document's comment count is worth reading: proposed rules, and any document with a comment period. */
export function wantsDocumentCount(d: RegsDocument): boolean {
  return (
    Boolean(d.objectId) &&
    (d.documentType === "Proposed Rule" || Boolean(d.commentEndDate || d.commentStartDate))
  );
}

/* ------------------------------------------------------------------------------------------------ scheduled runs */

const KEY_HEADER = "X-Api-Key";
const RUN_PAGES = 12;
const RUN_COUNTS = 40;
/** A scheduled run re-reads the hour before its cursor (records modified while the last run paged). */
const OVERLAP_MS = 3600_000;

function stepBack(cursorEt: string, ms: number): string {
  // cursorEt is Eastern wall time; shifting the wall time back is exact for an overlap window except across a DST
  // change, where the overlap is an hour longer or shorter — still an overlap, so nothing is skipped.
  const asUtc = Date.parse(cursorEt.replace(" ", "T") + "Z");
  return new Date(asUtc - ms).toISOString().slice(0, 19).replace("T", " ");
}

type CursorDocs = { modified_from_et?: string; count_offset?: number };

async function readCursorStart(
  ctx: CollectContext,
  dataset: string,
  path: "regs_document" | "regs_docket",
): Promise<string> {
  const c = (ctx.cursor ?? {}) as CursorDocs;
  if (
    typeof c.modified_from_et === "string" &&
    /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(c.modified_from_et)
  )
    return c.modified_from_et;
  // first scheduled run: continue from the newest modification the full load stored
  const rows = await ctx.corpus.query(
    `corpus_records?select=v:item->${path}->>lastModifiedDate&dataset=eq.${dataset}&order=item->${path}->>lastModifiedDate.desc.nullslast&limit=1`,
  );
  const v = String(rows[0]?.["v"] ?? "");
  if (!/^\d{4}-\d{2}-\d{2}T/.test(v))
    throw new Error(`${dataset} has no stored lastModifiedDate to continue from`);
  return etFilterTime(v);
}

async function getJson(
  ctx: CollectContext,
  url: string,
): Promise<{ body: unknown; url: string; at: string }> {
  const key = ctx.env("DATA_GOV_API_KEY") ?? "";
  const res = await ctx.http.getText(url, { headers: { [KEY_HEADER]: key } });
  if (res.status !== 200) throw new Error(`Regulations.gov HTTP ${res.status}`);
  return {
    body: JSON.parse(res.text) as unknown,
    url: res.record.url,
    at: res.record.retrieved_at,
  };
}

async function storedComments(
  ctx: CollectContext,
  dataset: string,
  ids: string[],
): Promise<Map<string, CommentCount | null>> {
  const out = new Map<string, CommentCount | null>();
  if (!ids.length) return out;
  for (const r of await ctx.corpus.rowsBy(dataset, "id", ids, "id,item")) {
    const c = r.item?.["comments"] as JsonObject | null | undefined;
    out.set(r.id, c && typeof c["posted"] === "number" ? (c as unknown as CommentCount) : null);
  }
  return out;
}

async function frRowsFor(ctx: CollectContext, docs: RegsDocument[]) {
  const urls = [...new Set(docs.filter((d) => d.frDocNum).map((d) => frUrl(d.frDocNum!)))];
  const map = new Map<string, { id: string; filters: JsonObject }>();
  if (!urls.length) return map;
  for (const r of await ctx.corpus.rowsBy(FR_DATASET, "source_url", urls, "id,source_url,filters"))
    map.set(r.source_url, { id: r.id, filters: r.filters });
  return map;
}

/**
 * Documents: (1) every document of the agencies modified since the cursor (an hour of overlap), (2) the documents whose
 * comment period ends today or later or ended in the last 14 days, whose counts still move. Counts are read for new
 * or changed documents that want one, then for the comment-window documents in rotation; a document whose count was
 * not read this run keeps its stored count.
 */
export const regulationsGovDocuments: SourceAdapter = {
  source: "regulations_gov_documents",
  dataset: DOCS_DATASET,
  mode: "upsert",
  ordinalPolicy: "prepend",
  functionName: "ingest-regulations-gov",
  limits: { maxRequests: RUN_PAGES + 2 + RUN_COUNTS, minIntervalMs: 1500 },
  secrets: ["DATA_GOV_API_KEY"],

  async collect(ctx: CollectContext): Promise<Collected> {
    const from = stepBack(await readCursorStart(ctx, DOCS_DATASET, "regs_document"), OVERLAP_MS);
    const cursor = (ctx.cursor ?? {}) as CursorDocs;
    const held: HeldRecord[] = [];
    const docs = new Map<string, { doc: RegsDocument; prov: Provenance }>();
    let complete = true;
    let stopped: string | null = null;
    let fetched = 0;
    let lastModified: string | null = null;
    const reads: JsonObject[] = [];
    const take = (data: JsonObject[], url: string, at: string) => {
      for (const rec of data) {
        fetched++;
        const d = normalizeDocument(rec);
        if (!d) {
          held.push({
            key: String(rec["id"] ?? "?"),
            reason: "record without a usable id, agency or document type",
          });
          continue;
        }
        if (
          !AGENCY_BY_ID.has(d.agencyId) ||
          !(DOC_TYPES as readonly string[]).includes(d.documentType)
        ) {
          held.push({ key: d.id, reason: "agency or document type outside the dataset's scope" });
          continue;
        }
        docs.set(d.id, { doc: d, prov: { api_url: url, retrieved_at: at } });
      }
    };
    try {
      // (1) modified since the cursor, oldest first; 20 pages at most per query, then the cursor moves on
      let start = from;
      for (let pages = 0; pages < RUN_PAGES;) {
        let page = 1;
        let last: string | null = null;
        let more = false;
        for (; page <= MAX_PAGES_PER_QUERY && pages < RUN_PAGES; page++, pages++) {
          const url = documentsQuery({ agencies: AGENCY_IDS, modifiedFromEt: start, page });
          const { body, url: rec, at } = await getJson(ctx, url);
          const p = parseListPage(JSON.stringify(body));
          take(p.data, rec, at);
          const tail = p.data.at(-1)?.["attributes"] as JsonObject | undefined;
          if (typeof tail?.["lastModifiedDate"] === "string")
            last = tail["lastModifiedDate"] as string;
          reads.push({
            query: "modified",
            from: start,
            page,
            results: p.data.length,
            total: p.total,
          });
          more = p.hasNextPage;
          if (!more) break;
        }
        if (last) lastModified = last;
        if (!more) break;
        if (page > MAX_PAGES_PER_QUERY && last) {
          const next = etFilterTime(last);
          if (next <= start)
            throw new Error("more than 5,000 documents share one modification second");
          start = next;
          continue;
        }
        complete = false;
        break;
      }
      // (2) comment windows still open or recently closed
      const since = etDate(new Date(ctx.now.getTime() - 14 * 86400_000).toISOString())!;
      const windowIds: string[] = [];
      for (let page = 1; page <= 2; page++) {
        const url = documentsQuery({
          agencies: AGENCY_IDS,
          commentEndFrom: since,
          sort: "commentEndDate,documentId",
          page,
        });
        const { body, url: rec, at } = await getJson(ctx, url);
        const p = parseListPage(JSON.stringify(body));
        take(p.data, rec, at);
        for (const r of p.data) if (typeof r["id"] === "string") windowIds.push(r["id"] as string);
        reads.push({
          query: "comment_window",
          from: since,
          page,
          results: p.data.length,
          total: p.total,
        });
        if (!p.hasNextPage) break;
      }
      cursor.count_offset = Number.isInteger(cursor.count_offset) ? cursor.count_offset : 0;
      // counts: changed/new documents first (in modification order), then the comment-window documents in rotation
      const stored = await storedComments(ctx, DOCS_DATASET, [...docs.keys()]);
      const counts = new Map<string, CommentCount | null>(stored);
      const first = [...docs.values()].filter(
        ({ doc }) => wantsDocumentCount(doc) && !stored.get(doc.id),
      );
      const rot = windowIds.length ? cursor.count_offset % windowIds.length : 0;
      const rotation = [...windowIds.slice(rot), ...windowIds.slice(0, rot)];
      const order = [...first.map((x) => x.doc.id), ...rotation].filter(
        (id, i, a) => a.indexOf(id) === i,
      );
      let counted = 0;
      for (const id of order) {
        const d = docs.get(id)?.doc;
        if (!d?.objectId) continue;
        if (ctx.http.remaining < 1) break;
        const { body, url, at } = await getJson(ctx, docCommentsUrl(d.objectId));
        const n = commentTotal(body);
        if (n !== null) {
          counts.set(id, { posted: n, scope: "document", read_on: at.slice(0, 10), api_url: url });
          counted++;
        }
      }
      cursor.count_offset = windowIds.length ? (rot + counted) % windowIds.length : 0;
      reads.push({ query: "comment_counts", read: counted });
      const fr = await frRowsFor(
        ctx,
        [...docs.values()].map((x) => x.doc),
      );
      const rows = sortDocumentsNewestFirst([...docs.values()].map((x) => x.doc)).map((doc) =>
        documentRow(doc, frLinkFor(doc, fr), counts.get(doc.id) ?? null, docs.get(doc.id)!.prov),
      );
      return {
        rows,
        fetched,
        held,
        cursorAfter: complete
          ? {
              modified_from_et: lastModified ? etFilterTime(lastModified) : from,
              count_offset: cursor.count_offset,
            }
          : {
              modified_from_et: lastModified ? etFilterTime(lastModified) : from,
              count_offset: cursor.count_offset,
            },
        complete,
        notes: { modified_from_et: from, reads: reads as Json, ...(stopped ? { stopped } : {}) },
      };
    } catch (error) {
      if (error instanceof BudgetExhausted || error instanceof RateLimited) {
        stopped = error.message;
        complete = false;
        // nothing half-read is written: the next run re-reads from the same cursor
        return {
          rows: [],
          fetched,
          held,
          cursorAfter: ctx.cursor,
          complete,
          notes: { stopped, reads: reads as Json },
        };
      }
      throw error;
    }
  },

  comparable: comparableRegs,
};

/** Dockets modified since the cursor; docket comment counts for rulemaking dockets among them (stored counts kept). */
export const regulationsGovDockets: SourceAdapter = {
  source: "regulations_gov_dockets",
  dataset: DOCKETS_DATASET,
  mode: "upsert",
  ordinalPolicy: "prepend",
  functionName: "ingest-regulations-gov",
  limits: { maxRequests: RUN_PAGES + 30, minIntervalMs: 1500 },
  secrets: ["DATA_GOV_API_KEY"],

  async collect(ctx: CollectContext): Promise<Collected> {
    const from = stepBack(await readCursorStart(ctx, DOCKETS_DATASET, "regs_docket"), OVERLAP_MS);
    const held: HeldRecord[] = [];
    const dockets = new Map<string, { d: RegsDocket; prov: Provenance }>();
    const reads: JsonObject[] = [];
    let fetched = 0;
    let complete = true;
    let lastModified: string | null = null;
    try {
      let start = from;
      for (let pages = 0; pages < RUN_PAGES;) {
        let page = 1;
        let last: string | null = null;
        let more = false;
        for (; page <= MAX_PAGES_PER_QUERY && pages < RUN_PAGES; page++, pages++) {
          const { body, url, at } = await getJson(
            ctx,
            docketsQuery({ agencies: AGENCY_IDS, modifiedFromEt: start, page }),
          );
          const p = parseListPage(JSON.stringify(body));
          for (const rec of p.data) {
            fetched++;
            const d = normalizeDocket(rec);
            if (!d || !AGENCY_BY_ID.has(d.agencyId)) {
              held.push({
                key: String(rec["id"] ?? "?"),
                reason: "docket without a usable id or outside the agencies",
              });
              continue;
            }
            dockets.set(d.id, { d, prov: { api_url: url, retrieved_at: at } });
          }
          const tail = p.data.at(-1)?.["attributes"] as JsonObject | undefined;
          if (typeof tail?.["lastModifiedDate"] === "string")
            last = tail["lastModifiedDate"] as string;
          reads.push({
            query: "modified",
            from: start,
            page,
            results: p.data.length,
            total: p.total,
          });
          more = p.hasNextPage;
          if (!more) break;
        }
        if (last) lastModified = last;
        if (!more) break;
        if (page > MAX_PAGES_PER_QUERY && last) {
          const next = etFilterTime(last);
          if (next <= start)
            throw new Error("more than 5,000 dockets share one modification second");
          start = next;
          continue;
        }
        complete = false;
        break;
      }
      const stored = await storedComments(ctx, DOCKETS_DATASET, [...dockets.keys()]);
      const counts = new Map<string, CommentCount | null>(stored);
      let counted = 0;
      for (const { d } of dockets.values()) {
        if (d.docketType !== "Rulemaking") continue;
        if (ctx.http.remaining < 1) break;
        const { body, url, at } = await getJson(ctx, docketCommentsUrl(d.id));
        const n = commentTotal(body);
        if (n !== null) {
          counts.set(d.id, { posted: n, scope: "docket", read_on: at.slice(0, 10), api_url: url });
          counted++;
        }
      }
      reads.push({ query: "comment_counts", read: counted });
      const rows = sortDocketsNewestFirst([...dockets.values()].map((x) => x.d)).map((d) =>
        docketRow(d, counts.get(d.id) ?? null, dockets.get(d.id)!.prov),
      );
      return {
        rows,
        fetched,
        held,
        cursorAfter: { modified_from_et: lastModified ? etFilterTime(lastModified) : from },
        complete,
        notes: { modified_from_et: from, reads: reads as Json },
      };
    } catch (error) {
      if (error instanceof BudgetExhausted || error instanceof RateLimited) {
        return {
          rows: [],
          fetched,
          held,
          cursorAfter: ctx.cursor,
          complete: false,
          notes: { stopped: error.message, reads: reads as Json },
        };
      }
      throw error;
    }
  },

  comparable: comparableRegs,
};
