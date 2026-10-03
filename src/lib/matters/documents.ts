/**
 * Pure: matter documents from the verified PDF registry.
 *
 * "Held" means the registry could not confirm that the item is openly displayable (unknown seal status, restricted,
 * or a locator the registry holds). Held items are listed but never get a link, a hash or a size.
 */
import { courtDocumentFilename, courtFilenameDate, parseDocketBirdDocumentId } from "./docketKeys";

export const REGISTRY_SOURCES = [
  "docketbird",
  "courtlistener",
  "official-court",
  "courtlistener-public-locator",
] as const;
export type RegistrySource = (typeof REGISTRY_SOURCES)[number];
export type Availability = "open" | "held";

export type RegistryDocument = {
  sourceSystem: RegistrySource;
  nativeDocumentId: string;
  nativeCaseId: string | null;
  availability: Availability;
  /** Present only for open items. */
  sha256: string | null;
  bytes: number | null;
  /** The publisher's own public URL (court-hosted documents), open items only. */
  publicUrl: string | null;
  verifiedAt: string | null;
};

export type RegistrySummary = {
  total: number;
  open: number;
  held: number;
  openBytes: number | null;
  bySource: Record<string, number>;
};

const isObj = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** Parse one registry row. Anything malformed is dropped; an unknown availability is HELD (fail closed). */
export function parseRegistryDocument(raw: unknown): RegistryDocument | null {
  if (!isObj(raw)) return null;
  const sourceSystem = REGISTRY_SOURCES.find((s) => s === raw["source_system"]);
  const nativeDocumentId = str(raw["native_document_id"]);
  if (!sourceSystem || !nativeDocumentId || nativeDocumentId.length > 500) return null;
  const open = raw["availability"] === "open";
  const sha =
    open && typeof raw["sha256"] === "string" && /^[a-f0-9]{64}$/.test(raw["sha256"])
      ? raw["sha256"]
      : null;
  const publicUrl = open ? str(raw["public_url"]) : null;
  return {
    sourceSystem,
    nativeDocumentId,
    nativeCaseId: str(raw["native_case_id"]),
    // An "open" row without verifiable byte identity is not displayable.
    availability: open && sha ? "open" : "held",
    sha256: open ? sha : null,
    bytes: open ? num(raw["bytes"]) : null,
    publicUrl: publicUrl && /^https:\/\//i.test(publicUrl) ? publicUrl : null,
    verifiedAt: str(raw["verified_at"]),
  };
}

export function parseRegistrySummary(raw: unknown, rows: RegistryDocument[]): RegistrySummary {
  const s = isObj(raw) ? raw : {};
  const bySource: Record<string, number> = {};
  if (isObj(s["by_source"]))
    for (const [k, v] of Object.entries(s["by_source"])) if (typeof v === "number") bySource[k] = v;
  const open = num(s["open"]) ?? rows.filter((r) => r.availability === "open").length;
  const held = num(s["held"]) ?? rows.filter((r) => r.availability === "held").length;
  return {
    total: num(s["total"]) ?? open + held,
    open,
    held,
    openBytes: num(s["open_bytes"]),
    bySource,
  };
}

export const SOURCE_LABELS: Record<RegistrySource, string> = {
  docketbird: "DocketBird docket",
  courtlistener: "CourtListener / RECAP",
  "official-court": "Court website",
  "courtlistener-public-locator": "RECAP public link",
};

export type MatterDocument = RegistryDocument & {
  /** Docket-sheet number for DocketBird documents, otherwise null. */
  entryNumber: number | null;
  /** Attachment number within the entry (DocketBird ids ending "-001"), otherwise null. */
  attachment: number | null;
  /** Date printed in a court file name (court website items), otherwise null. */
  printedDate: string | null;
  label: string;
  sourceLabel: string;
};

/** Human label for a registry document without inventing a title: entry number or the court's own file name. */
export function describeDocument(doc: RegistryDocument): MatterDocument {
  let label = doc.nativeDocumentId;
  let entryNumber: number | null = null;
  let attachment: number | null = null;
  let printedDate: string | null = null;
  if (doc.sourceSystem === "docketbird") {
    const parsed = parseDocketBirdDocumentId(doc.nativeDocumentId);
    if (parsed) {
      entryNumber = parsed.sequence;
      attachment = parsed.attachment;
      label =
        parsed.attachment === null
          ? `Docket entry ${parsed.sequence}`
          : `Docket entry ${parsed.sequence} · attachment ${parsed.attachment}`;
    }
  } else if (
    doc.sourceSystem === "official-court" ||
    doc.sourceSystem === "courtlistener-public-locator"
  ) {
    label = courtDocumentFilename(doc.nativeDocumentId);
    printedDate = courtFilenameDate(label);
  } else if (doc.sourceSystem === "courtlistener") {
    label = `CourtListener document ${doc.nativeDocumentId}`;
  }
  return {
    ...doc,
    entryNumber,
    attachment,
    printedDate,
    label,
    sourceLabel: SOURCE_LABELS[doc.sourceSystem],
  };
}

/** In-app URL that streams an open document; null for held items so no link can exist. */
export function matterPdfUrl(
  doc: Pick<RegistryDocument, "sourceSystem" | "nativeDocumentId" | "availability">,
  download = false,
): string | null {
  if (doc.availability !== "open") return null;
  const params = new URLSearchParams({ source: doc.sourceSystem, doc: doc.nativeDocumentId });
  if (download) params.set("download", "1");
  return `/api/matter-pdf?${params.toString()}`;
}

export type DocumentFilter = {
  q?: string;
  source?: RegistrySource | "";
  availability?: Availability | "";
  entry?: number | null;
  /** Exact provider case id the document is filed under. */
  caseId?: string;
};

export function filterDocuments(docs: MatterDocument[], f: DocumentFilter): MatterDocument[] {
  const q = (f.q ?? "").trim().toLowerCase();
  return docs.filter((d) => {
    if (f.source && d.sourceSystem !== f.source) return false;
    if (f.availability && d.availability !== f.availability) return false;
    if (f.entry != null && d.entryNumber !== f.entry) return false;
    if (f.caseId && d.nativeCaseId !== f.caseId) return false;
    if (q && !`${d.label} ${d.nativeDocumentId} ${d.entryNumber ?? ""}`.toLowerCase().includes(q))
      return false;
    return true;
  });
}

export type DocumentSort = "entry-desc" | "entry-asc" | "name";

/** Newest docket entries first by default; court-website items (no entry number) sort by their printed date. */
export function sortDocuments(docs: MatterDocument[], sort: DocumentSort): MatterDocument[] {
  const byName = (a: MatterDocument, b: MatterDocument) =>
    a.label.localeCompare(b.label, "en", { numeric: true });
  const out = [...docs];
  if (sort === "name") return out.sort(byName);
  const dir = sort === "entry-desc" ? -1 : 1;
  return out.sort((a, b) => {
    const ae = a.entryNumber;
    const be = b.entryNumber;
    if (ae != null && be != null && ae !== be) return (ae - be) * dir;
    if (ae != null && be == null) return -1;
    if (ae == null && be != null) return 1;
    const ad = a.printedDate;
    const bd = b.printedDate;
    if (ad && bd && ad !== bd) return ad.localeCompare(bd) * dir;
    if (ad && !bd) return -1;
    if (!ad && bd) return 1;
    return byName(a, b);
  });
}

/** Counts computed from the rows in hand (the caller says whether those rows are the whole set). */
export function countDocuments(docs: MatterDocument[]) {
  const bySource: Record<string, number> = {};
  const byCase: Record<string, number> = {};
  let open = 0;
  let held = 0;
  for (const d of docs) {
    bySource[d.sourceSystem] = (bySource[d.sourceSystem] ?? 0) + 1;
    if (d.nativeCaseId) byCase[d.nativeCaseId] = (byCase[d.nativeCaseId] ?? 0) + 1;
    if (d.availability === "open") open++;
    else held++;
  }
  return { total: docs.length, open, held, bySource, byCase };
}

/** Rows per page of the verified-PDF list. */
export const DOCUMENT_PAGE_SIZE = 50;

export const DOCUMENT_SORTS: readonly DocumentSort[] = ["entry-desc", "entry-asc", "name"];

export type DocumentFacets = {
  /** Counts per source, with every filter except the source applied. */
  bySource: Record<string, number>;
  /** Open / held counts, with every filter except the availability applied. */
  availability: { open: number; held: number };
  /** Counts per exact provider case id, with every filter except the case id applied. */
  byCase: Record<string, number>;
};

export type DocumentsPage = {
  rows: MatterDocument[];
  /** Documents matching the filter (all pages). */
  total: number;
  facets: DocumentFacets;
  offset: number;
  pageSize: number;
};

/**
 * One page of a matter's verified PDFs: filter, sort, count and facet the whole list, return the slice asked for. The
 * server runs this over its cached list so the browser never receives thousands of rows (3047 has 8,000).
 */
export function pageDocuments(
  docs: MatterDocument[],
  filter: DocumentFilter,
  sort: DocumentSort,
  offset: number,
  pageSize: number = DOCUMENT_PAGE_SIZE,
): DocumentsPage {
  const filtered = sortDocuments(filterDocuments(docs, filter), sort);
  const start = Math.min(Math.max(0, Math.floor(offset)), Math.max(0, filtered.length - 1));
  const aligned = start - (start % pageSize);
  // Each facet ignores its own filter but honours the others, so option counts match the table.
  const without = (key: keyof DocumentFilter): DocumentFilter => {
    const copy = { ...filter };
    delete copy[key];
    return copy;
  };
  const avail = countDocuments(filterDocuments(docs, without("availability")));
  return {
    rows: filtered.slice(aligned, aligned + pageSize),
    total: filtered.length,
    facets: {
      bySource: countDocuments(filterDocuments(docs, without("source"))).bySource,
      availability: { open: avail.open, held: avail.held },
      byCase: countDocuments(filterDocuments(docs, without("caseId"))).byCase,
    },
    offset: aligned,
    pageSize,
  };
}

export function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null || !Number.isFinite(bytes) || bytes < 0) return "Not recorded";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value >= 100 ? value.toFixed(0) : value.toFixed(1)} ${units[unit]}`;
}

/** Validate the query a streaming request carries; returns the exact lookup key or null. */
export function parsePdfRequest(
  params: URLSearchParams,
): { source: RegistrySource; doc: string; download: boolean } | null {
  const source = REGISTRY_SOURCES.find((s) => s === params.get("source"));
  const doc = params.get("doc");
  if (!source || !doc || doc.length > 500) return null;
  for (let i = 0; i < doc.length; i++) {
    const code = doc.charCodeAt(i);
    if (code < 32 || code === 127) return null;
  }
  return { source, doc, download: params.get("download") === "1" };
}
