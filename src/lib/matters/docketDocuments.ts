/**
 * Pure: documents of the DocketBird-tracked cases (`sw_docket_documents_v1`), one row per docket-sheet document.
 * Restricted, unknown-seal and sealed/redacted/ex-parte/in-camera-titled documents are not rows of the dataset; they
 * exist only as counts in its metadata and are never listed.
 */
import { matterPdfUrl } from "./documents";
import { isObj, nonBlank, safeUint, str } from "./values";

export const DOCKET_DOCUMENTS_DATASET = "sw_docket_documents_v1";

export type DocketDocumentAvailability = "stored" | "provider_not_downloaded" | "other";

export type DocketDocument = {
  /** The provider's native document id (also the PDF route's `doc`). */
  nativeDocumentId: string;
  nativeCaseId: string | null;
  docketKey: string | null;
  mdl: string | null;
  entryNumber: number | null;
  dateFiled: string | null;
  /** The document title as published; null when the record carries none or withholds it. */
  description: string | null;
  descriptionWithheld: boolean;
  fileName: string | null;
  availability: DocketDocumentAvailability;
  bytes: number | null;
  sha256: string | null;
  /** The provider supplies no category, so this is null on every row today. */
  label: string | null;
  /** Recorded fact "Parties of the matter in the registry"; null when that fact is absent. */
  parties: string | null;
  /** In-app, authorised PDF route; only for a stored, unrestricted document. */
  pdfUrl: string | null;
};

export const AVAILABILITY_LABELS: Record<DocketDocumentAvailability, string> = {
  stored: "PDF stored",
  provider_not_downloaded: "Provider has not downloaded the file",
  other: "Availability not recorded",
};

const SHA256 = /^[a-f0-9]{64}$/;

function partiesFact(facts: unknown): string | null {
  if (!Array.isArray(facts)) return null;
  for (const fact of facts) {
    if (!Array.isArray(fact) || fact.length < 2 || typeof fact[0] !== "string") continue;
    if (fact[0] !== "Parties of the matter in the registry") continue;
    if (typeof fact[1] === "string" && fact[1].trim()) return fact[1].trim();
    if (typeof fact[1] === "number" && Number.isFinite(fact[1])) return String(fact[1]);
  }
  return null;
}

/** A description withheld only because it carries contact data stays a row, without that text. */
const CONTACT_WITHHELD = "contact_or_access_data";

export function parseDocketDocument(item: unknown, facts?: unknown): DocketDocument | null {
  if (!isObj(item)) return null;
  const cells = isObj(item["cells"]) ? item["cells"] : null;
  if (!cells) return null;
  const nativeDocumentId = str(cells["native_document_id"]);
  if (!nativeDocumentId) return null;
  // Sealed, restricted, and unknown-seal rows are not listed. The projection omits them; this is the same rule.
  if (cells["restricted"] === true) return null;
  const withheldRaw = str(cells["description_withheld"]);
  if (withheldRaw && withheldRaw !== CONTACT_WITHHELD) return null;
  const contactWithheld = withheldRaw === CONTACT_WITHHELD;
  const rawAvailability = str(cells["availability"]);
  const availability: DocketDocumentAvailability =
    rawAvailability === "stored"
      ? "stored"
      : rawAvailability === "provider_not_downloaded"
        ? "provider_not_downloaded"
        : "other";
  const sha256 = str(cells["sha256"]);
  const entry = cells["entry_number"];
  const canOpen =
    availability === "stored" && cells["stored"] === true && !!sha256 && SHA256.test(sha256);
  return {
    nativeDocumentId,
    nativeCaseId: str(cells["native_case_id"]),
    docketKey: str(cells["docket_key"]),
    mdl: str(cells["mdl"]),
    entryNumber: typeof entry === "number" && Number.isInteger(entry) && entry >= 0 ? entry : null,
    dateFiled: nonBlank(cells["date_filed"]),
    description: contactWithheld ? null : str(cells["description"]),
    descriptionWithheld: contactWithheld,
    fileName: str(cells["file_name"]),
    availability,
    bytes: safeUint(cells["bytes"]),
    sha256: sha256 && SHA256.test(sha256) ? sha256 : null,
    label: str(cells["label"]),
    parties: partiesFact(facts),
    pdfUrl: canOpen
      ? matterPdfUrl({ sourceSystem: "docketbird", nativeDocumentId, availability: "open" })
      : null,
  };
}

export type DocketDocumentsCase = {
  caseId: string;
  /** The exact docket key shared with the registry's docket entries; null until read from the case's first row. */
  docketKey: string | null;
  rows: number;
  sheetDocuments: number | null;
  /** Documents on the provider's docket sheet that are not rows of the dataset (sealed/restricted rule). */
  withheld: number | null;
  mdl: string | null;
  title: string | null;
};

export type DocketDocumentsOverview = {
  total: number | null;
  stored: number | null;
  providerNotDownloaded: number | null;
  /** All documents counted but not listed under the sealed/restricted rule. */
  withheld: number | null;
  cases: DocketDocumentsCase[];
};

/** A case belongs to an MDL page by its own MDL label, or by the MDL number in its exact docket id. */
export function caseBelongsToMdl(
  c: Pick<DocketDocumentsCase, "caseId" | "mdl">,
  mdl: string,
): boolean {
  if (c.mdl) return c.mdl === mdl;
  const digits = mdl.replace(/^0+/, "");
  return new RegExp(`-md-0*${digits}$`).test(c.caseId);
}

/**
 * The cases the dataset holds, from its own metadata: `coverage.by_case` (rows, sheet documents, withheld) when it is
 * published, otherwise the case filter's options of the listing (rows only). Nothing is a fixed list of matters.
 */
export function casesFromMetadata(
  coverage: unknown,
  filters: unknown,
): { caseId: string; rows: number; sheetDocuments: number | null; withheld: number | null }[] {
  const byCase = isObj(coverage) && isObj(coverage["by_case"]) ? coverage["by_case"] : null;
  if (byCase && Object.keys(byCase).length)
    return Object.entries(byCase).map(([caseId, raw]) => {
      const c = isObj(raw) ? raw : {};
      return {
        caseId,
        rows: safeUint(c["rows"]) ?? 0,
        sheetDocuments: safeUint(c["sheet_documents"]),
        withheld: safeUint(c["withheld_no_row"]),
      };
    });
  const list = Array.isArray(filters) ? filters : [];
  const filter = list.find((f) => isObj(f) && f["name"] === "case_id");
  const options = isObj(filter) && Array.isArray(filter["options"]) ? filter["options"] : [];
  return options.flatMap((o) =>
    isObj(o) && typeof o["value"] === "string" && o["value"]
      ? [
          {
            caseId: o["value"],
            rows: safeUint(o["count"]) ?? 0,
            sheetDocuments: null,
            withheld: null,
          },
        ]
      : [],
  );
}

/** Live counts for one matter's docket-sheet documents. */
export type ExactCount = {
  value: number | null;
  /** exact: value is the corpus count. too-large: the count was not returned. not-recorded: there was nothing to count. */
  gap: "exact" | "too-large" | "not-recorded";
};

export type MatterDocketDocumentsSummary = {
  /** Rows in the dataset for the matter's cases. */
  listed: ExactCount;
  /** Of those, rows whose PDF is stored. */
  stored: ExactCount;
  /** Docket entries of the same cases, from sw_docket_entries_v1. */
  entries: ExactCount;
  /** Documents counted but not listed under the sealed/restricted rule; null when the dataset does not say. */
  withheld: number | null;
  cases: {
    caseId: string;
    docketKey: string | null;
    rows: number | null;
    entries: number | null;
  }[];
  /** Rows on cases with no registry entries, which cannot appear under an entry. Null when that count is not exact. */
  unlisted: number | null;
};

/** Sum only when every part came back. A missing part is too large to count, never a partial total. */
export function exactSum(values: (number | null)[]): ExactCount {
  if (values.some((value) => value === null)) return { value: null, gap: "too-large" };
  return { value: values.reduce<number>((sum, value) => sum + (value ?? 0), 0), gap: "exact" };
}

/**
 * Entries of the document cases. A missing docket key means the entries were not recorded.
 * A failed count is too large to count. Neither case is filled in from the other cases.
 */
export function entriesExact(
  parts: { docketKey: string | null; count: number | null }[],
): ExactCount {
  if (parts.some((part) => !part.docketKey)) return { value: null, gap: "not-recorded" };
  return exactSum(parts.map((part) => part.count));
}

/** Documents that cannot sit under a registry entry. Null unless every case's pieces are exact. */
export function unlistedTotal(
  parts: { rows: number | null; entries: number | null; unnumbered: number | null }[],
): number | null {
  let total = 0;
  for (const part of parts) {
    if (part.rows === null || part.entries === null) return null;
    if (part.entries === 0) total += part.rows;
    else if (part.unnumbered === null) return null;
    else total += part.unnumbered;
  }
  return total;
}

/** Exact number, "too large to count", or "Not recorded". Never a guessed total. */
export function formatExactCount(count: ExactCount | null | undefined): string {
  if (!count || count.gap === "not-recorded" || (count.gap === "exact" && count.value === null))
    return "Not recorded";
  if (count.gap === "too-large" || count.value === null) return "too large to count";
  return count.value.toLocaleString();
}
