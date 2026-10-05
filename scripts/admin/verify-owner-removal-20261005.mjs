// Read-only final reconciliation against the original inventory and deletion receipts.
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { rpc } from "../ingest/members-pgrest.mjs";
const ROOT = path.resolve("private/audit-2026-10-05/owner-removal-openus-cpsc");
const sha = (x) => crypto.createHash("sha256").update(x).digest("hex");
const read = async (p) => JSON.parse(await fs.readFile(p, "utf8"));
if (process.argv.slice(2).join(" ") !== "--execute") throw Error("READ_ONLY_EXECUTE_REQUIRED");
const final = await read(path.join(ROOT, "final-verification.json"));
const old = await read(
  "private/audit-2026-10-05/owner-requested-full-audit/live-dataset-sizes.json",
);
const targets = new Set(["open_us_law", "cpsc_injury_data"]);
const before = new Map(old.dataset_sizes.map((d) => [d.dataset, d.rows]));
const after = new Map(final.datasets.map((d) => [d.dataset, d.records]));
for (const [dataset, n] of before) {
  if (targets.has(dataset)) {
    if (after.has(dataset)) throw Error("TARGET_RECORDS_REMAIN");
  } else if (after.get(dataset) !== n) throw Error("OTHER_DATASET_COUNT_CHANGED");
}
if (
  after.size !== before.size - targets.size ||
  final.catalog_count !== 92 ||
  final.target_catalog_remaining !== 0
)
  throw Error("CATALOG_OR_DATASET_SCOPE_CHANGED");
if (Object.values(final.outline).some((n) => n !== 0)) throw Error("OUTLINE_REMAINS");
if (final.artifacts.rows !== 64542 || final.artifacts.ready !== 36812)
  throw Error("ARTIFACT_COUNTS_UNEXPECTED");
const storage = await read(path.join(ROOT, "storage-removal-receipts/complete.json"));
if (
  storage.complete !== true ||
  storage.deleted_objects !== 53882 ||
  storage.deleted_bytes !== 31175061974 ||
  storage.protected_objects_verified !== 220223 ||
  storage.remaining_objects !== 220223 ||
  storage.remaining_bytes !== 113595529636 ||
  final.storage.objects !== storage.remaining_objects ||
  final.storage.bytes !== storage.remaining_bytes
)
  throw Error("STORAGE_RECONCILIATION_FAILED");
for (const dataset of targets) {
  const r = await read(path.join(ROOT, `collection-removal-receipts/${dataset}-complete.json`));
  if (!r.catalog_removed || r.deleted_rows !== before.get(dataset))
    throw Error("COLLECTION_RECEIPT_INVALID");
}
const manifest = await read(path.join(ROOT, "inventory-v1/manifest.json"));
const originalPdf = [];
for (const p of manifest.pdfs.pages) {
  const b = await fs.readFile(path.join(ROOT, "inventory-v1", p.file));
  if (sha(b) !== p.sha256 || b.length !== p.bytes) throw Error("PDF_BASELINE_HASH_INVALID");
  originalPdf.push(...JSON.parse(b).rows);
}
const livePdf = [];
let cursor = "";
for (;;) {
  const r = await rpc("corpus_admin_pdf_dedup_index_v1", {
    p_kind: "objects",
    p_after: cursor,
    p_limit: 10000,
  });
  if (!Array.isArray(r.rows)) throw Error("PDF_INDEX_INVALID");
  if (!r.rows.length) break;
  if (r.rows.some((p, i) => p.sha256 <= cursor || (i > 0 && p.sha256 <= r.rows[i - 1].sha256)))
    throw Error("PDF_INDEX_ORDER_INVALID");
  livePdf.push(...r.rows);
  cursor = r.last;
}
if (!isDeepStrictEqual(originalPdf, livePdf)) throw Error("MATTER_PDF_REGISTRY_CHANGED");
const evidence = {
  schema: "owner-removal-final-reconciliation/1",
  project: "xosqzzsnhxcyehcnirpa",
  verified_at: new Date().toISOString(),
  complete: true,
  deleted_collections: [...targets],
  deleted_records: [...targets].reduce((n, k) => n + before.get(k), 0),
  other_dataset_counts_unchanged: after.size,
  deleted_storage_objects: storage.deleted_objects,
  deleted_storage_bytes: storage.deleted_bytes,
  remaining_storage_objects: storage.remaining_objects,
  remaining_storage_bytes: storage.remaining_bytes,
  protected_matter_pdf_objects: livePdf.length,
  protected_matter_pdf_bytes: livePdf.reduce((n, p) => n + p.bytes, 0),
  pdf_registry_exactly_unchanged: true,
  ready_artifact_routes_unchanged: final.artifacts.ready,
  removed_artifact_rows: 43744,
  database_allocated_bytes: final.database_bytes,
  corpus_record_table_allocated_bytes: final.record_table_physical_bytes,
  database_size_note:
    "Row deletion and allocated PostgreSQL disk size are distinct; no VACUUM FULL was run.",
};
await fs.writeFile(
  path.join(ROOT, "final-reconciliation.json"),
  JSON.stringify(evidence, null, 2),
  { flag: "wx" },
);
console.log(JSON.stringify(evidence));
