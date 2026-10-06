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
  /** In-app, authorised PDF route; only for a stored, unrestricted document. */
  pdfUrl: string | null;
};

export const AVAILABILITY_LABELS: Record<DocketDocumentAvailability, string> = {
  stored: "PDF stored",
  provider_not_downloaded: "Provider has not downloaded the file",
  other: "Availability not recorded",
};

const SHA256 = /^[a-f0-9]{64}$/;

export function parseDocketDocument(item: unknown): DocketDocument | null {
  if (!isObj(item)) return null;
  const cells = isObj(item["cells"]) ? item["cells"] : null;
  if (!cells) return null;
  const nativeDocumentId = str(cells["native_document_id"]);
  if (!nativeDocumentId) return null;
  const restricted = cells["restricted"] === true;
  const withheld = restricted || !!cells["description_withheld"];
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
    availability === "stored" &&
    !restricted &&
    cells["stored"] === true &&
    !!sha256 &&
    SHA256.test(sha256);
  return {
    nativeDocumentId,
    nativeCaseId: str(cells["native_case_id"]),
    docketKey: str(cells["docket_key"]),
    mdl: str(cells["mdl"]),
    entryNumber: typeof entry === "number" && Number.isInteger(entry) && entry >= 0 ? entry : null,
    dateFiled: nonBlank(cells["date_filed"]),
    description: withheld ? null : str(cells["description"]),
    descriptionWithheld: withheld,
    fileName: restricted ? null : str(cells["file_name"]),
    availability,
    bytes: safeUint(cells["bytes"]),
    sha256: sha256 && SHA256.test(sha256) ? sha256 : null,
    label: str(cells["label"]),
    pdfUrl: canOpen
      ? matterPdfUrl({ sourceSystem: "docketbird", nativeDocumentId, availability: "open" })
      : null,
  };
}

export type DocketDocumentsCase = {
  caseId: string;
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
