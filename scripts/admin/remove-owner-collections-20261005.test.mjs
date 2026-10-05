import assert from "node:assert/strict";
import crypto from "node:crypto";
import { gzipSync } from "node:zlib";
import test from "node:test";
import {
  PROJECT,
  TARGETS,
  parseConcurrency,
  parseDatasetSelection,
  runBoundedPageWorkers,
  runRemoval,
  validateCatalogDeleteIntent,
  validateCompletionReceipt,
  validateManifestEnvelope,
  validatePageIntent,
  validatePageReceipt,
  validateRecoveryPage,
  validateWithdrawnReceipt,
} from "./remove-owner-collections-20261005.mjs";

const sha = (value) => crypto.createHash("sha256").update(value).digest("hex");
const iso = "2026-10-05T12:00:00.000Z";

function manifestFor(dataset, expectedRows, pageSize = 1000) {
  const pages = [];
  let remaining = expectedRows;
  let prior = null;
  let pageNumber = 0;
  while (remaining > 0) {
    const rows = Math.min(pageSize, remaining);
    pageNumber++;
    const firstId = `${dataset}:${String(pageNumber).padStart(5, "0")}:a`;
    const lastId = `${dataset}:${String(pageNumber).padStart(5, "0")}:z`;
    pages.push({
      page: pageNumber,
      previous_cursor: prior,
      rows,
      first_id: firstId,
      last_id: lastId,
      raw_bytes: 10,
      gzip_bytes: 8,
      bytes: 10,
      raw_sha256: "a".repeat(64),
      gzip_sha256: "b".repeat(64),
      sha256: "a".repeat(64),
      file: `${dataset}/page-${pageNumber}.jsonl`,
      gzip_file: `${dataset}/page-${pageNumber}.jsonl.gz`,
    });
    remaining -= rows;
    prior = lastId;
  }
  return {
    schema: "owner-collection-backup-manifest/1",
    project_id: PROJECT,
    created_at: iso,
    completed_at: iso,
    read_only: true,
    remote_writes: 0,
    before_images: { catalog: { file: "catalog.json", bytes: 2, sha256: "c".repeat(64) } },
    datasets: { [dataset]: { dataset, complete: true, rows: expectedRows, pages } },
  };
}

test("dataset selection supports one target and rejects duplicates or unknown collections", () => {
  assert.deepEqual(parseDatasetSelection(undefined), ["open_us_law", "cpsc_injury_data"]);
  assert.deepEqual(parseDatasetSelection("cpsc_injury_data"), ["cpsc_injury_data"]);
  assert.deepEqual(parseDatasetSelection("open_us_law,cpsc_injury_data"), [
    "open_us_law",
    "cpsc_injury_data",
  ]);
  assert.throws(
    () => parseDatasetSelection("cpsc_injury_data,cpsc_injury_data"),
    /DATASET_SELECTION_INVALID/,
  );
  assert.throws(() => parseDatasetSelection("other"), /DATASET_SELECTION_INVALID/);
  assert.throws(() => parseDatasetSelection(""), /DATASET_SELECTION_INVALID/);
});

test("page concurrency defaults to serial and is capped at four", () => {
  assert.equal(parseConcurrency(undefined), 1);
  assert.equal(parseConcurrency("4"), 4);
  for (const invalid of ["0", "5", "04", "1.5", "-1", "four", ""]) {
    assert.throws(() => parseConcurrency(invalid), /CONCURRENCY_INVALID/);
  }
});

test("bounded workers stop assigning pages after failure and drain in-flight work", async () => {
  const started = [];
  const finished = [];
  let active = 0;
  let maxActive = 0;
  await assert.rejects(
    runBoundedPageWorkers([0, 1, 2, 3, 4], 2, async (page) => {
      started.push(page);
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, page === 0 ? 5 : 20));
      active--;
      finished.push(page);
      if (page === 0) throw new Error("failed page");
    }),
    /failed page/,
  );
  assert.deepEqual(started, [0, 1]);
  assert.deepEqual(finished.sort(), [0, 1]);
  assert.equal(maxActive, 2);
  assert.equal(active, 0);
});

test("dry run is local-only and reports only the selected dataset", async () => {
  let calls = 0;
  const result = await runRemoval({
    execute: false,
    datasets: "cpsc_injury_data",
    restClient: async () => calls++,
    fetcher: async () => calls++,
    credentialsLoader: async () => calls++,
  });
  assert.deepEqual(result, {
    state: "dry_run_only",
    datasets: ["cpsc_injury_data"],
    recovery_material_verified: false,
    remote_writes: 0,
  });
  assert.equal(calls, 0);
});

test("manifest validation requires the exact selected subset and a complete full-count export", () => {
  const manifest = manifestFor("cpsc_injury_data", TARGETS.cpsc_injury_data);
  assert.equal(validateManifestEnvelope(manifest, ["cpsc_injury_data"]), manifest);
  assert.throws(
    () => validateManifestEnvelope(manifest, ["open_us_law"]),
    /WRONG_OR_INCOMPLETE_BACKUP_MANIFEST/,
  );
  assert.throws(
    () =>
      validateManifestEnvelope(
        {
          ...manifest,
          datasets: {
            ...manifest.datasets,
            cpsc_injury_data: { ...manifest.datasets.cpsc_injury_data, complete: false },
          },
        },
        ["cpsc_injury_data"],
      ),
    /INCOMPLETE_BACKUP/,
  );
  assert.throws(
    () =>
      validateManifestEnvelope(
        {
          ...manifest,
          datasets: {
            ...manifest.datasets,
            cpsc_injury_data: { ...manifest.datasets.cpsc_injury_data, rows: 479_533 },
          },
        },
        ["cpsc_injury_data"],
      ),
    /INCOMPLETE_BACKUP/,
  );
  assert.throws(
    () => validateManifestEnvelope({ ...manifest, remote_writes: 1 }, ["cpsc_injury_data"]),
    /WRONG_OR_INCOMPLETE_BACKUP_MANIFEST/,
  );
  assert.throws(
    () => validateManifestEnvelope({ ...manifest, complete: false }, ["cpsc_injury_data"]),
    /WRONG_OR_INCOMPLETE_BACKUP_MANIFEST/,
  );
});

test("page recovery validates raw and gzip bytes, full row identity, boundaries, and order", () => {
  const dataset = "cpsc_injury_data";
  const rows = [
    { dataset, id: "a", item: { value: 1 } },
    { dataset, id: "b", item: { value: 2 } },
  ];
  const raw = Buffer.from(`${rows.map((row) => JSON.stringify(row)).join("\n")}\n`);
  const zipped = gzipSync(raw);
  const page = {
    rows: 2,
    first_id: "a",
    last_id: "b",
    previous_cursor: null,
    raw_bytes: raw.length,
    raw_sha256: sha(raw),
    gzip_bytes: zipped.length,
    gzip_sha256: sha(zipped),
  };
  assert.deepEqual(
    validateRecoveryPage(dataset, page, raw, zipped),
    rows.map(({ dataset, id }) => ({ dataset, id })),
  );
  assert.throws(
    () => validateRecoveryPage(dataset, page, raw, Buffer.from(zipped).fill(0)),
    /RECOVERY_PAGE_INVALID|RECOVERY_GZIP_INVALID/,
  );
  const wrongOrder = Buffer.from(`${JSON.stringify(rows[1])}\n${JSON.stringify(rows[0])}\n`);
  const wrongOrderGzip = gzipSync(wrongOrder);
  const wrongOrderPage = {
    ...page,
    first_id: "b",
    last_id: "a",
    raw_bytes: wrongOrder.length,
    raw_sha256: sha(wrongOrder),
    gzip_bytes: wrongOrderGzip.length,
    gzip_sha256: sha(wrongOrderGzip),
  };
  assert.throws(
    () => validateRecoveryPage(dataset, wrongOrderPage, wrongOrder, wrongOrderGzip),
    /RECOVERY_SCOPE_INVALID/,
  );
});

test("an existing page receipt is accepted only with the exact matching intent and manifest", () => {
  const dataset = "cpsc_injury_data";
  const page = { page: 1, rows: 2, raw_sha256: "a".repeat(64) };
  const intent = {
    dataset,
    page: 1,
    rows: 2,
    recovery_sha256: page.raw_sha256,
    identity_sha256: "b".repeat(64),
    manifest_sha256: "c".repeat(64),
  };
  const receipt = {
    ...intent,
    deleted_identity_sha256: "d".repeat(64),
    outcome: "exact_identities_deleted",
  };
  assert.equal(
    validatePageReceipt(receipt, {
      dataset,
      page,
      manifestSha256: intent.manifest_sha256,
      identitySha: intent.identity_sha256,
      intent,
    }),
    receipt,
  );
  assert.throws(
    () =>
      validatePageReceipt(
        { ...receipt, rows: 3 },
        {
          dataset,
          page,
          manifestSha256: intent.manifest_sha256,
          identitySha: intent.identity_sha256,
          intent,
        },
      ),
    /PAGE_RECEIPT_INVALID/,
  );
  assert.throws(
    () =>
      validatePageReceipt(receipt, {
        dataset,
        page,
        manifestSha256: "e".repeat(64),
        identitySha: intent.identity_sha256,
        intent,
      }),
    /PAGE_INTENT_INVALID/,
  );
  assert.throws(
    () =>
      validatePageIntent(
        { ...intent, identity_sha256: "f".repeat(64) },
        {
          dataset,
          page,
          manifestSha256: intent.manifest_sha256,
          identitySha: intent.identity_sha256,
        },
      ),
    /PAGE_INTENT_INVALID/,
  );
});

test("missing catalog recovery requires matching before-image intent and a valid withdrawal receipt", () => {
  const dataset = "cpsc_injury_data";
  const original = {
    id: dataset,
    ready: true,
    updated_at: iso,
    metadata: { ready: true, imported_records: TARGETS[dataset] },
  };
  const after = {
    ...original,
    ready: false,
    updated_at: "2026-10-05T12:01:00.000Z",
    metadata: { ...original.metadata, ready: false, owner_removal_scope: "openus-cpsc-20261005" },
  };
  const manifestSha256 = "a".repeat(64);
  const withdrawn = { dataset, before: original, after, manifest_sha256: manifestSha256 };
  assert.equal(
    validateWithdrawnReceipt(withdrawn, { dataset, original, manifestSha256 }),
    withdrawn,
  );
  const intent = { dataset, before: after, manifest_sha256: manifestSha256, prepared_at: iso };
  assert.equal(validateCatalogDeleteIntent(intent, { dataset, withdrawn, manifestSha256 }), intent);
  assert.throws(
    () =>
      validateCatalogDeleteIntent(
        { ...intent, before: { ...after, ready: true } },
        { dataset, withdrawn, manifestSha256 },
      ),
    /CATALOG_DELETE_INTENT_INVALID/,
  );
  assert.throws(
    () =>
      validateWithdrawnReceipt(
        { ...withdrawn, manifest_sha256: "b".repeat(64) },
        { dataset, original, manifestSha256 },
      ),
    /WITHDRAWAL_RECEIPT_INVALID/,
  );
});

test("completion receipts must bind exact count, catalog removal, and selected manifest", () => {
  const dataset = "cpsc_injury_data";
  const receipt = {
    dataset,
    deleted_rows: TARGETS[dataset],
    catalog_removed: true,
    completed_at: iso,
    manifest_sha256: "a".repeat(64),
  };
  assert.equal(
    validateCompletionReceipt(receipt, {
      dataset,
      expectedRows: TARGETS[dataset],
      manifestSha256: receipt.manifest_sha256,
    }),
    receipt,
  );
  assert.throws(
    () =>
      validateCompletionReceipt(
        { ...receipt, deleted_rows: 1 },
        { dataset, expectedRows: TARGETS[dataset], manifestSha256: receipt.manifest_sha256 },
      ),
    /COMPLETION_RECEIPT_INVALID/,
  );
});
