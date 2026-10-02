/** Public-source supplement. Native document numbers and dates remain source-authored. */
export type RegisterDocument = {
  document_number: string;
  title: string;
  type: string;
  publication_date: string;
  effective_on: string | null;
  dates: string | null;
  citation: string | null;
  html_url: string;
  pdf_url: string;
  agencies: { id?: number; name: string; url?: string }[];
  cfr_references: { title: number; part: string | null; [key: string]: unknown }[] | null;
  related_documents: unknown;
  correction_of: unknown;
};
export type RegisterManifest = {
  schemaVersion: number;
  records: number;
  fetchedAt: string;
  publicationFrom: string;
  publicationThrough: string;
  sourceSnapshotCutoff: string;
  qualification: string;
  effectiveDateRecords: number;
  cfrReferenceRecords: number;
  correctionRecords: number;
  typeCounts: { label: string; count: number }[];
  pages: {
    name: string;
    url: string;
    sha256: string;
    bytes: number;
    fetchedAt: string;
  }[];
};

const ROOT = "/data/quality/reference/federal-register-gap/";

export async function loadRegisterManifest(): Promise<RegisterManifest> {
  const r = await fetch(`${ROOT}manifest.json`);
  if (!r.ok) throw new Error(`Register supplement: HTTP ${r.status}`);
  const m = (await r.json()) as RegisterManifest;
  if (
    m.schemaVersion !== 1 ||
    !Number.isInteger(m.records) ||
    !Array.isArray(m.pages) ||
    m.pages.length > 10
  )
    throw new Error("Register supplement manifest is invalid.");
  return m;
}

export function reconcileRegisterPages(
  manifest: RegisterManifest,
  pages: { count: number; results: RegisterDocument[] }[],
) {
  if (
    pages.length !== manifest.pages.length ||
    pages.some((p) => p.count !== manifest.records || !Array.isArray(p.results))
  )
    throw new Error("Register page counts do not reconcile.");
  const records = pages.flatMap((p) => p.results);
  if (
    records.length !== manifest.records ||
    new Set(records.map((r) => r.document_number)).size !== manifest.records
  )
    throw new Error("Register document identities do not reconcile.");
  if (
    records.some(
      (r) =>
        r.publication_date < manifest.publicationFrom ||
        r.publication_date > manifest.publicationThrough,
    )
  )
    throw new Error("Register publication date is outside the supplement interval.");
  return records;
}

export async function loadRegisterDocuments(manifest: RegisterManifest) {
  const pages = await Promise.all(
    manifest.pages.map(async (page) => {
      if (!/^page-\d{3}\.json$/.test(page.name)) throw new Error("Invalid source page path.");
      const r = await fetch(`${ROOT}${page.name}`);
      if (!r.ok) throw new Error(`Register source page: HTTP ${r.status}`);
      const bytes = await r.arrayBuffer();
      const sha = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
        .map((n) => n.toString(16).padStart(2, "0"))
        .join("");
      if (sha !== page.sha256 || bytes.byteLength !== page.bytes)
        throw new Error("Register source bytes do not match their provenance.");
      return JSON.parse(new TextDecoder().decode(bytes)) as {
        count: number;
        results: RegisterDocument[];
      };
    }),
  );
  return reconcileRegisterPages(manifest, pages);
}

/** Exact publication labels. Proposed rules do not become final rules. */
export const publicationLabel = (type: string) => (type === "Rule" ? "Final rule" : type);

export function filterRegisterDocuments(
  records: readonly RegisterDocument[],
  q: string,
  type: string,
) {
  const term = q.trim().toLowerCase();
  return records.filter(
    (r) =>
      (!type || r.type === type) &&
      (!term ||
        [r.document_number, r.title, r.citation, ...r.agencies.map((a) => a.name)]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(term)),
  );
}
