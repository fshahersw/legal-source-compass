/** Bounded public API acquisition. No Supabase writes, inferred effective dates or guessed relationships. */
import { mkdirSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";

const value = (flag, fallback) =>
  process.argv.includes(flag) ? process.argv[process.argv.indexOf(flag) + 1] : fallback;
const after = value("--after", "2026-08-20");
const through = value("--through", "2026-10-01");
if (
  ![after, through].every(
    (date) => /^\d{4}-\d{2}-\d{2}$/.test(date) && !Number.isNaN(Date.parse(date)),
  )
)
  throw new Error("Use ISO dates for --after and --through.");
const since = new Date(Date.parse(after) + 86400000).toISOString().slice(0, 10);
if (since > through) throw new Error("The acquisition interval is empty.");
const directory = value("--output", "private/data/quality/reference/federal-register-gap");
const fields = [
  "document_number",
  "title",
  "type",
  "publication_date",
  "effective_on",
  "dates",
  "citation",
  "html_url",
  "pdf_url",
  "agencies",
  "cfr_references",
  "related_documents",
  "correction_of",
];
const pages = [];
const records = [];
let expected = null;
for (let page = 1; page <= 10; page++) {
  const params = new URLSearchParams({
    per_page: "1000",
    page: String(page),
    order: "oldest",
    "conditions[publication_date][gte]": since,
    "conditions[publication_date][lte]": through,
  });
  for (const field of fields) params.append("fields[]", field);
  const url = `https://www.federalregister.gov/api/v1/documents.json?${params}`;
  const response = await fetch(url, { signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error(`Publisher API: HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > 10000000)
    throw new Error("API page exceeds the source-file size limit; reduce per_page.");
  const data = JSON.parse(bytes);
  if (expected != null && expected !== data.count)
    throw new Error("Publisher count changed during acquisition; retry a stable date interval.");
  expected = data.count;
  if (!Number.isInteger(expected) || expected > 10000 || !Array.isArray(data.results))
    throw new Error("Unexpected or unbounded publisher response.");
  records.push(...data.results);
  pages.push({
    name: `page-${String(page).padStart(3, "0")}.json`,
    bytes,
    url,
    fetchedAt: new Date().toISOString(),
    sha256: createHash("sha256").update(bytes).digest("hex"),
  });
  if (records.length === expected) break;
  if (!data.results.length || records.length > expected)
    throw new Error("Publisher pagination does not reconcile.");
}
if (records.length !== expected || new Set(records.map((r) => r.document_number)).size !== expected)
  throw new Error("Record count or document identity does not reconcile.");
for (const record of records) {
  // Preserve native correction identifiers too; the publisher uses more than one ID syntax.
  if (
    typeof record.document_number !== "string" ||
    !record.document_number.trim() ||
    typeof record.publication_date !== "string" ||
    record.publication_date < since ||
    record.publication_date > through
  )
    throw new Error(
      `Document identity or publication date is outside the acquisition contract: ${record.document_number} (${record.publication_date}).`,
    );
  if (!record.pdf_url || new URL(record.pdf_url).hostname !== "www.govinfo.gov")
    throw new Error("Official PDF reference is absent or unexpected.");
}
const manifest = {
  schemaVersion: 1,
  source: "FederalRegister.gov public API",
  sourceSnapshotCutoff: after,
  publicationFrom: since,
  publicationThrough: through,
  fetchedAt: pages.at(-1).fetchedAt,
  records: records.length,
  typeCounts: [...new Set(records.map((r) => r.type))].map((label) => ({
    label,
    count: records.filter((r) => r.type === label).length,
  })),
  effectiveDateRecords: records.filter((r) => r.effective_on).length,
  cfrReferenceRecords: records.filter((r) => r.cfr_references?.length).length,
  correctionRecords: records.filter((r) => r.correction_of).length,
  qualification:
    "Complete publisher metadata index for this bounded publication interval, reconciled to the API count and unique document numbers. The official legal editions are the linked GovInfo PDFs. Effective dates are publisher fields, not a finding that every provision is in force. Acquisition preserves original source bytes; a separate administrative import records native document identities and versions.",
  pages: pages.map(({ bytes, ...metadata }) => ({
    ...metadata,
    bytes: bytes.length,
  })),
};
// Write only after all pages and identities pass validation; preserve the exact API bytes.
mkdirSync(directory, { recursive: true });
for (const page of pages) writeFileSync(`${directory}/${page.name}`, page.bytes);
writeFileSync(`${directory}/manifest.json`, JSON.stringify(manifest, null, 2) + "\n");
console.log(
  JSON.stringify({
    directory,
    records: records.length,
    pages: pages.length,
    publicationFrom: since,
    publicationThrough: through,
  }),
);
