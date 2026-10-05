import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { gzip } from "node:zlib";
import { promisify } from "node:util";
import {
  mapWithConcurrency,
  prefixOf,
  runBackup,
  validatePartitionCounts,
  verifyV2Checkpoint,
} from "./backup-owner-openus-parallel-20261005.mjs";

const gzipAsync = promisify(gzip);
const hash = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");

test("prefix parsing accepts only complete native OpenUS IDs", () => {
  assert.equal(prefixOf(`oul:0${"a".repeat(63)}`), "0");
  assert.equal(prefixOf(`oul:f${"0".repeat(63)}`), "f");
  assert.throws(() => prefixOf("neiss:123"), /OPENUS_NATIVE_ID_SHAPE_INVALID/);
  assert.throws(() => prefixOf(`oul:g${"0".repeat(63)}`), /OPENUS_NATIVE_ID_SHAPE_INVALID/);
  assert.throws(() => prefixOf(`oul:0${"a".repeat(62)}`), /OPENUS_NATIVE_ID_SHAPE_INVALID/);
});

test("partition counts must cover all hexadecimal prefixes and exact global total", () => {
  const counts = Object.fromEntries("0123456789abcdef".split("").map((prefix) => [prefix, 0]));
  counts["0"] = 1;
  assert.equal(validatePartitionCounts(counts, 1), 1);
  assert.throws(() => validatePartitionCounts({ 0: 1 }, 1), /PARTITION_COUNT_INVALID/);
  assert.throws(() => validatePartitionCounts({ ...counts, z: 0 }, 1), /PARTITION_TOTAL_MISMATCH/);
});

test("count-query worker never exceeds its explicit concurrency limit", async () => {
  let active = 0,
    maxActive = 0;
  const results = await mapWithConcurrency(
    Array.from({ length: 16 }, (_, i) => i),
    4,
    async (n) => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 2));
      active--;
      return n * 2;
    },
  );
  assert.equal(maxActive, 4);
  assert.deepEqual(
    results,
    Array.from({ length: 16 }, (_, i) => i * 2),
  );
});

test("dry-run makes no calls and does not need database credentials", async () => {
  let calls = 0;
  assert.deepEqual(
    await runBackup({
      fetcher: async () => {
        calls++;
      },
    }),
    { state: "dry_run_only", network_requests: 0, remote_writes: 0 },
  );
  assert.equal(calls, 0);
});

test("partition checkpoint readback verifies exact page bytes and cursors", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "openus-partition-checkpoint-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const prefixes = "0123456789abcdef".split(""),
    id = `oul:0${"a".repeat(63)}`,
    rows = [{ id, dataset: "open_us_law", text: "verified" }],
    raw = Buffer.from(rows.map(JSON.stringify).join("\n") + "\n"),
    zipped = await gzipAsync(raw, { level: 1, mtime: 0 }),
    rel = path.join("open_us_law", "partitions", "0", "page-0001.jsonl").replaceAll("\\", "/"),
    folder = path.join(root, "open_us_law", "partitions", "0");
  await fs.mkdir(folder, { recursive: true });
  await fs.writeFile(path.join(root, rel), raw);
  await fs.writeFile(path.join(root, `${rel}.gz`), zipped);
  const counts = Object.fromEntries(prefixes.map((prefix) => [prefix, prefix === "0" ? 1 : 0]));
  const page = {
    page: 1,
    file: rel,
    gzip_file: `${rel}.gz`,
    bytes: raw.length,
    gzip_bytes: zipped.length,
    sha256: hash(raw),
    gzip_sha256: hash(zipped),
    rows: 1,
    first_id: id,
    last_id: id,
    previous_cursor: null,
  };
  const checkpoint = {
    schema: "owner-openus-parallel-checkpoint/1",
    project_id: "xosqzzsnhxcyehcnirpa",
    partition_counts: counts,
    partitions: Object.fromEntries(
      prefixes.map((prefix) => [
        prefix,
        {
          expected_rows: counts[prefix],
          rows: prefix === "0" ? 1 : 0,
          next_cursor: prefix === "0" ? id : null,
          complete: true,
          pages: prefix === "0" ? [page] : [],
        },
      ]),
    ),
  };
  assert.equal(await verifyV2Checkpoint(root, checkpoint), checkpoint);
  await fs.writeFile(path.join(folder, "orphan.jsonl"), "bad");
  await assert.rejects(verifyV2Checkpoint(root, checkpoint), /CHECKPOINT_UNREFERENCED_PAGE_FILES/);
});
