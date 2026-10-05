import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  PAGE_SIZE,
  PROJECT,
  TARGETS,
  encodeJsonl,
  runBackup,
  validateCatalog,
  validatePage,
  verifyCheckpoint,
  verifyPageBytes,
} from "./backup-owner-collections-20261005.mjs";
import { gzip } from "node:zlib";
import { promisify } from "node:util";

const gzipAsync = promisify(gzip);
const hash = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");

test("catalog validation pins only the two exact collections and their row totals", () => {
  const rows = Object.entries(TARGETS).map(([id, imported_records]) => ({ id, imported_records }));
  assert.equal(Object.keys(validateCatalog(rows)).length, 2);
  assert.throws(
    () => validateCatalog([...rows, rows[0]]),
    /TARGET_CATALOG_ROWS_MISSING_OR_DUPLICATE/,
  );
  assert.throws(
    () =>
      validateCatalog(rows.map((row) => ({ ...row, imported_records: row.imported_records + 1 }))),
    /TARGET_CATALOG_COUNT_MISMATCH/,
  );
});

test("execution is opt-in and the default mode makes no network calls", async () => {
  let calls = 0;
  const result = await runBackup({
    fetcher: async () => {
      calls++;
    },
  });
  assert.deepEqual(result, { state: "dry_run_only", network_requests: 0, remote_writes: 0 });
  assert.equal(calls, 0);
});

test("keyset pages require exact dataset identity, strict lexical order and the page bound", () => {
  assert.equal(PAGE_SIZE, 1000);
  assert.deepEqual(
    validatePage({ dataset: "cpsc_injury_data", rows: [{ dataset: "cpsc_injury_data", id: "a" }] }),
    { rows: 1, firstId: "a", lastId: "a" },
  );
  assert.throws(
    () =>
      validatePage({
        dataset: "cpsc_injury_data",
        cursor: "a",
        rows: [{ dataset: "cpsc_injury_data", id: "a" }],
      }),
    /PAGE_NATIVE_IDENTITY_OR_ORDER_INVALID/,
  );
  assert.throws(
    () =>
      validatePage({ dataset: "cpsc_injury_data", rows: [{ dataset: "open_us_law", id: "a" }] }),
    /PAGE_NATIVE_IDENTITY_OR_ORDER_INVALID/,
  );
  assert.throws(
    () =>
      validatePage({
        dataset: "cpsc_injury_data",
        rows: Array.from({ length: PAGE_SIZE + 1 }, (_, i) => ({
          dataset: "cpsc_injury_data",
          id: `${i}`,
        })),
      }),
    /PAGE_SHAPE_INVALID/,
  );
});

test("gzip JSONL receipt validates bytes, hashes, row count and boundary IDs", async () => {
  const rows = [
    { dataset: "open_us_law", id: "oul:001", text: "first" },
    { dataset: "open_us_law", id: "oul:002", text: "last" },
  ];
  const rawBytes = encodeJsonl(rows),
    gzipBytes = await gzipAsync(rawBytes, { level: 1, mtime: 0 }),
    receipt = {
      rows: 2,
      first_id: rows[0].id,
      last_id: rows[1].id,
      raw_bytes: rawBytes.length,
      raw_sha256: hash(rawBytes),
      gzip_bytes: gzipBytes.length,
      gzip_sha256: hash(gzipBytes),
    };
  assert.deepEqual(await verifyPageBytes({ rawBytes, gzipBytes, receipt }), rows);
  await assert.rejects(
    verifyPageBytes({ rawBytes: Buffer.from(rawBytes).fill(0), gzipBytes, receipt }),
    /PAGE_BACKUP_HASH_MISMATCH/,
  );
});

test("checkpoint resume verifies page files and rejects unreferenced crash leftovers", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "owner-backup-checkpoint-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const dataset = "open_us_law",
    rows = [{ dataset, id: "oul:0abc", caption: "example" }],
    rawBytes = encodeJsonl(rows),
    gzipBytes = await gzipAsync(rawBytes, { level: 1, mtime: 0 }),
    dir = path.join(root, dataset),
    rawPath = path.join(dir, "page-0001.jsonl");
  await fs.mkdir(dir, { recursive: true });
  await fs.mkdir(path.join(root, "cpsc_injury_data"), { recursive: true });
  await fs.writeFile(rawPath, rawBytes);
  await fs.writeFile(`${rawPath}.gz`, gzipBytes);
  const checkpoint = {
    schema: "owner-collection-backup-checkpoint/1",
    project_id: PROJECT,
    datasets: {
      open_us_law: {
        expected_rows: TARGETS.open_us_law,
        rows: 1,
        next_cursor: rows[0].id,
        complete: false,
        pages: [
          {
            page: 1,
            file: "open_us_law/page-0001.jsonl",
            gzip_file: "open_us_law/page-0001.jsonl.gz",
            rows: 1,
            first_id: rows[0].id,
            last_id: rows[0].id,
            previous_cursor: null,
            bytes: rawBytes.length,
            raw_bytes: rawBytes.length,
            sha256: hash(rawBytes),
            raw_sha256: hash(rawBytes),
            gzip_bytes: gzipBytes.length,
            gzip_sha256: hash(gzipBytes),
          },
        ],
      },
      cpsc_injury_data: {
        expected_rows: TARGETS.cpsc_injury_data,
        rows: 0,
        next_cursor: null,
        complete: false,
        pages: [],
      },
    },
  };
  assert.equal(await verifyCheckpoint(root, checkpoint), checkpoint);
  await fs.writeFile(path.join(dir, "page-0002.jsonl"), "orphan");
  await assert.rejects(verifyCheckpoint(root, checkpoint), /CHECKPOINT_UNREFERENCED_PAGE_FILES/);
});
