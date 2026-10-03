/**
 * Pure: the matter timeline built from the matter registry's docket-entry projection (`sw_docket_entries_v1`,
 * contract §6.3), and the exact mapping from an entry to the verified PDFs the archive holds for it.
 *
 * Publication rules (owner decision 2026-10-03, contract §6.0): entry text is shown exactly as the court record shows
 * it. The projection already withholds text that mentions sealing, restriction, in camera, ex parte or redaction, and
 * drops the document list of an entry with a sealed document; this module honours those flags and never lists a
 * document the projection marks sealed. Unknown values stay null and render "Not recorded".
 */
import type { MatterDocument } from "./documents";

const isObj = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);
const int = (v: unknown): number | null =>
  typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : null;
const idStr = (v: unknown): string | null =>
  typeof v === "number" && Number.isFinite(v) ? String(v) : str(v)?.trim() || null;
const isoDate = (v: unknown): string | null => {
  const s = str(v);
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  return isRealDate(s) ? s : null;
};

export const REGISTRY_ENTRIES_DATASET = "sw_docket_entries_v1";

/** Why the projection published an entry without its text. */
export type EntryWithheld = "sealed_document" | "sealed_or_restricted_text";
const WITHHELD: readonly string[] = ["sealed_document", "sealed_or_restricted_text"];

/** One document of an entry as CourtListener lists it (RECAP availability, not the firm's archive). */
export type EntryDocumentRef = {
  /** CourtListener RECAP document id; the PDF archive's `courtlistener` rows use the same id. */
  nativeDocumentId: string;
  documentNumber: string | null;
  attachmentNumber: number | null;
  /** The document's own description as published; null when absent or withheld. */
  description: string | null;
  pageCount: number | null;
  /** CourtListener's RECAP availability flag (a free copy exists there); null when the source says nothing. */
  recapAvailable: boolean | null;
};

export type RegistryEntry = {
  id: string;
  nativeEntryId: string | null;
  docketKey: string | null;
  docketNumber: string | null;
  /** The court's docket entry number; null for an unnumbered entry. */
  entryNumber: number | null;
  /** yyyy-mm-dd; null when the entry has no filing date. */
  date: string | null;
  time: string | null;
  /** The docket text as published (clipped to 500 characters by the projection); null when withheld or absent. */
  description: string | null;
  /** Length of the text before the projection clipped it. */
  descriptionChars: number | null;
  descriptionTruncated: boolean;
  withheld: EntryWithheld | null;
  /** Documents CourtListener lists for the entry; null when it says nothing. */
  documentCount: number | null;
  /** Of those, documents with a free RECAP copy. */
  recapAvailableCount: number | null;
  /** Of those, documents CourtListener flags sealed (never listed). */
  sealedCount: number | null;
  /** The projection's RECAP summary (`recap_available`, `recap_unavailable`, `includes_sealed`...). */
  availability: string | null;
  documents: EntryDocumentRef[];
  /** CourtListener page for the entry (https only). */
  sourceUrl: string | null;
};

const ENTRY_ID = /^sw-entry:[a-z]{2,20}:[A-Za-z0-9._:-]{1,100}$/;
const DOC_ID = /^[A-Za-z0-9][A-Za-z0-9:._-]{0,119}$/;

/** One `sw_docket_entries_v1` row (id, listing cells, links, `detail.registry`) -> entry; null when malformed. */
export function parseRegistryEntry(row: {
  id: unknown;
  cells: unknown;
  links: unknown;
  reg: unknown;
}): RegistryEntry | null {
  const id = str(row.id);
  if (!id || !ENTRY_ID.test(id) || !isObj(row.cells)) return null;
  const cells = row.cells;
  const reg = isObj(row.reg) ? row.reg : {};
  const withheldRaw = str(cells["description_withheld"]) ?? str(reg["description_withheld"]);
  const withheld: EntryWithheld | null =
    withheldRaw && WITHHELD.includes(withheldRaw) ? (withheldRaw as EntryWithheld) : null;
  const text = str(cells["description"]);
  const documents: EntryDocumentRef[] = [];
  // An entry with a sealed document lists no documents at all (contract §6.0 rule 2).
  if (withheld !== "sealed_document" && Array.isArray(reg["documents"])) {
    for (const d of reg["documents"]) {
      if (!isObj(d)) continue;
      const nativeDocumentId = idStr(d["native_document_id"]);
      if (!nativeDocumentId || !DOC_ID.test(nativeDocumentId)) continue;
      // A document the source flags sealed is never listed, whatever else the row says.
      if (d["is_sealed"] === true) continue;
      const docWithheld = str(d["description_withheld"]);
      documents.push({
        nativeDocumentId,
        documentNumber: str(d["document_number"])?.trim() ?? null,
        attachmentNumber: int(d["attachment_number"]),
        description: docWithheld ? null : (str(d["description"]) ?? null),
        pageCount: int(d["page_count"]),
        recapAvailable: typeof d["is_available"] === "boolean" ? d["is_available"] : null,
      });
    }
  }
  const links = Array.isArray(row.links) ? row.links : [];
  let sourceUrl: string | null = null;
  for (const l of links) {
    const url = isObj(l) ? str(l["url"]) : null;
    if (url && /^https:\/\//i.test(url)) {
      sourceUrl = url;
      break;
    }
  }
  return {
    id,
    nativeEntryId: idStr(cells["native_entry_id"]),
    docketKey: str(cells["docket_key"]),
    docketNumber: str(cells["docket_number"]),
    entryNumber: int(cells["entry_number"]),
    date: isoDate(cells["date_filed"]),
    time: str(cells["time_filed"]),
    // A withheld entry carries no text, whatever the cell holds.
    description: withheld ? null : text,
    descriptionChars: int(cells["description_chars"]),
    descriptionTruncated: !withheld && cells["description_truncated"] === true,
    withheld,
    documentCount: int(cells["documents"]),
    recapAvailableCount: int(cells["documents_available"]),
    sealedCount: int(cells["documents_sealed"]),
    availability: str(cells["availability"]),
    documents,
    sourceUrl,
  };
}

/* ------------------------------------------------------------------ filters */

/** A real calendar date in yyyy-mm-dd form. */
export function isRealDate(value: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d;
}

export type TimelineFilter = {
  /** Words searched in the docket text and entry number (prefix match on each word). */
  q: string;
  /** Inclusive yyyy-mm-dd bounds on the filing date; entries with no date match neither. */
  from: string | null;
  to: string | null;
  /** Only entries CourtListener lists documents for. */
  hasDocuments: boolean;
  /** One docket of the matter; null for all. */
  docketKey: string | null;
};

export const EMPTY_TIMELINE_FILTER: TimelineFilter = {
  q: "",
  from: null,
  to: null,
  hasDocuments: false,
  docketKey: null,
};

/** True when any filter narrows the timeline. */
export function isFiltered(f: TimelineFilter): boolean {
  return !!(f.q.trim() || f.from || f.to || f.hasDocuments || f.docketKey);
}

/**
 * A `to_tsquery('simple')` string for plain words, matching how the database searches with its prefix mode
 * ("motion dismiss" -> "motion:*&dismiss:*"); null when the text has no searchable word. Only letters and digits reach
 * the query, so no operator can be injected.
 */
export function ftsPrefixQuery(q: string): string | null {
  const words = q.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  const terms = words.slice(0, 8).map((w) => w.slice(0, 40));
  return terms.length ? terms.map((t) => `${t}:*`).join("&") : null;
}

/** Ordered dates: a range typed backwards is swapped rather than returning nothing. */
export function normalizeRange(
  from: string | null,
  to: string | null,
): { from: string | null; to: string | null } {
  const f = from && isRealDate(from) ? from : null;
  const t = to && isRealDate(to) ? to : null;
  if (f && t && f > t) return { from: t, to: f };
  return { from: f, to: t };
}

/* ------------------------------------------------------------------ archive mapping */

/**
 * The verified-PDF archive of a matter, indexed for exact lookups: by (source, native document id) and, for DocketBird
 * documents, by (DocketBird case id, docket entry number). Held rows are indexed too (they map to "Held").
 */
export type ArchiveIndex = {
  byDocumentId: Map<string, MatterDocument>;
  byCaseEntry: Map<string, MatterDocument[]>;
  /** Rows indexed. */
  size: number;
  /** False when the archive holds more rows than were indexed, so a missing document may only be unread. */
  complete: boolean;
};

const docKey = (source: string, id: string) => `${source}|${id}`;
const entryKey = (caseId: string, entry: number) => `${caseId}|${entry}`;

export function buildArchiveIndex(docs: MatterDocument[], complete: boolean): ArchiveIndex {
  const byDocumentId = new Map<string, MatterDocument>();
  const byCaseEntry = new Map<string, MatterDocument[]>();
  for (const d of docs) {
    byDocumentId.set(docKey(d.sourceSystem, d.nativeDocumentId), d);
    if (d.sourceSystem === "docketbird" && d.nativeCaseId && d.entryNumber !== null) {
      const key = entryKey(d.nativeCaseId, d.entryNumber);
      const list = byCaseEntry.get(key);
      if (list) list.push(d);
      else byCaseEntry.set(key, [d]);
    }
  }
  return { byDocumentId, byCaseEntry, size: docs.length, complete };
}

/** How an archive document was tied to an entry. Both are exact joins, never a name or description match. */
export type ArchiveVia = "document_id" | "entry_number";
export type EntryArchiveDocument = { doc: MatterDocument; via: ArchiveVia };

export type EntryArchive = {
  documents: EntryArchiveDocument[];
  /** Listed documents that are not in the archive (by exact id). */
  notArchived: number;
};

/**
 * The archive documents of one entry:
 * - every document CourtListener lists for the entry whose RECAP id is a `courtlistener` row of the archive; and
 * - for the same docket (registry-resolved DocketBird case id) the DocketBird documents whose id carries the entry's
 *   own docket-sheet number (an attachment keeps its parent's number).
 * An entry whose projection withheld its document list (sealed document) maps to nothing.
 */
export function matchEntryDocuments(
  entry: Pick<RegistryEntry, "entryNumber" | "documents" | "withheld">,
  docketbirdCaseId: string | null,
  index: ArchiveIndex,
): EntryArchive {
  if (entry.withheld === "sealed_document") return { documents: [], notArchived: 0 };
  const out: EntryArchiveDocument[] = [];
  const seen = new Set<string>();
  let notArchived = 0;
  for (const d of entry.documents) {
    const hit = index.byDocumentId.get(docKey("courtlistener", d.nativeDocumentId));
    if (!hit) {
      notArchived++;
      continue;
    }
    const key = docKey(hit.sourceSystem, hit.nativeDocumentId);
    if (!seen.has(key)) {
      seen.add(key);
      out.push({ doc: hit, via: "document_id" });
    }
  }
  if (docketbirdCaseId && entry.entryNumber !== null) {
    for (const hit of index.byCaseEntry.get(entryKey(docketbirdCaseId, entry.entryNumber)) ?? []) {
      const key = docKey(hit.sourceSystem, hit.nativeDocumentId);
      if (!seen.has(key)) {
        seen.add(key);
        out.push({ doc: hit, via: "entry_number" });
      }
    }
  }
  // Main document before its attachments; CourtListener rows (no attachment number) keep their listed order.
  out.sort((a, b) => (a.doc.attachment ?? 0) - (b.doc.attachment ?? 0));
  return { documents: out, notArchived };
}

/** Counts of an entry's archive documents by availability. */
export function archiveCounts(documents: EntryArchiveDocument[]): { open: number; held: number } {
  let open = 0;
  let held = 0;
  for (const d of documents) {
    if (d.doc.availability === "open") open++;
    else held++;
  }
  return { open, held };
}

/* ------------------------------------------------------------------ display helpers */

/** What the projection's RECAP summary means, in words; the archive is a separate thing and is never implied. */
export const RECAP_LABELS: Record<string, string> = {
  no_documents: "No documents listed",
  recap_available: "Free PDF in RECAP",
  recap_partly_available: "Some PDFs in RECAP",
  recap_unavailable: "Not in RECAP",
  includes_sealed: "Includes a sealed document",
  unknown: "RECAP status not recorded",
};

export function recapLabel(availability: string | null): string | null {
  if (!availability) return null;
  return RECAP_LABELS[availability] ?? availability.replace(/_/g, " ");
}

export const WITHHELD_NOTES: Record<EntryWithheld, string> = {
  sealed_document:
    "Published without text or document list: the entry has a document the source flags as sealed.",
  sealed_or_restricted_text:
    "Published without text: the docket text mentions sealing, restriction, in camera, ex parte or redaction, which the publication rule withholds.",
};
