// Read-only OpenUS backup continuation: exact hexadecimal ID-prefix partitions.
// This is a separate export root; --execute is required for any network reads.
import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import zlib from "node:zlib";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";
import {
  encodeJsonl,
  PROJECT,
  TARGETS,
  verifyPageBytes,
} from "./backup-owner-collections-20261005.mjs";

const gzip = promisify(zlib.gzip);
const DATASET = "open_us_law";
const EXPECTED_ROWS = TARGETS[DATASET];
const PAGE_SIZE = 1000;
const WORKERS = 4;
const MAX_PAGE_BYTES = 128 * 1024 * 1024;
const CREDENTIALS_FILE = "C:/Users/firas/.codex/private/legal-source-compass.preview.json";
const V1_ROOT = path.resolve(
  "private/audit-2026-10-05/owner-removal-openus-cpsc/collection-backup-v1",
);
const OUTPUT_ROOT = path.resolve(
  "private/audit-2026-10-05/owner-removal-openus-cpsc/collection-backup-v2-openus",
);
const sha256 = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");
const fail = (code) => {
  throw new Error(code);
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const PREFIXES = Object.freeze("0123456789abcdef".split(""));

export function prefixOf(id) {
  const match = /^oul:([0-9a-f])[0-9a-f]{63}$/.exec(id ?? "");
  if (!match) fail("OPENUS_NATIVE_ID_SHAPE_INVALID");
  return match[1];
}

export function validatePartitionCounts(counts, expected = EXPECTED_ROWS) {
  if (!counts || typeof counts !== "object") fail("PARTITION_COUNTS_REQUIRED");
  let sum = 0;
  for (const prefix of PREFIXES) {
    const count = counts[prefix];
    if (!Number.isSafeInteger(count) || count < 0) fail("PARTITION_COUNT_INVALID");
    sum += count;
  }
  if (Object.keys(counts).some((key) => !PREFIXES.includes(key)) || sum !== expected)
    fail("PARTITION_TOTAL_MISMATCH");
  return sum;
}

export async function mapWithConcurrency(items, concurrency, mapper) {
  if (!Number.isSafeInteger(concurrency) || concurrency < 1) fail("CONCURRENCY_INVALID");
  const results = Array(items.length);
  let next = 0;
  const settled = await Promise.allSettled(
    Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (true) {
        const index = next++;
        if (index >= items.length) return;
        results[index] = await mapper(items[index], index);
      }
    }),
  );
  const failure = settled.find((item) => item.status === "rejected");
  if (failure) throw failure.reason;
  return results;
}

function credentials() {
  const cfg = JSON.parse(fsSync.readFileSync(CREDENTIALS_FILE, "utf8"));
  if (
    cfg.EXTERNAL_SUPABASE_URL !== `https://${PROJECT}.supabase.co` ||
    typeof cfg.EXTERNAL_SUPABASE_KEY !== "string"
  )
    fail("WRONG_PROJECT_CREDENTIALS");
  const key = cfg.EXTERNAL_SUPABASE_KEY;
  return {
    url: cfg.EXTERNAL_SUPABASE_URL,
    headers: { apikey: key, ...(key.startsWith("sb_") ? {} : { Authorization: `Bearer ${key}` }) },
  };
}

async function get(url, headers, fetcher = fetch) {
  for (let attempt = 0; attempt < 4; attempt++) {
    let response;
    try {
      response = await fetcher(url, {
        method: "GET",
        headers,
        redirect: "error",
        signal: AbortSignal.timeout(120_000),
      });
    } catch {
      if (attempt === 3) fail("READ_ONLY_TRANSPORT_FAILURE");
      await sleep(1000 * 2 ** attempt);
      continue;
    }
    if ([429, 500, 502, 503, 504].includes(response.status)) {
      if (attempt === 3) fail(`READ_ONLY_HTTP_${response.status}`);
      const retry = response.headers.get("retry-after");
      const ms = /^\d+(?:\.\d+)?$/.test(retry ?? "") ? Number(retry) * 1000 : 1000 * 2 ** attempt;
      if (ms > 30_000) fail("READ_ONLY_RETRY_AFTER_EXCEEDS_BOUND");
      await response.body?.cancel();
      await sleep(Math.max(250, ms));
      continue;
    }
    if (!response.ok) {
      await response.body?.cancel();
      fail(`READ_ONLY_HTTP_${response.status}`);
    }
    return response;
  }
  fail("READ_ONLY_RETRY_LIMIT");
}

async function readBytes(url, headers, limit, fetcher) {
  const response = await get(url, headers, fetcher),
    chunks = [];
  let bytes = 0;
  try {
    for await (const chunk of response.body ?? []) {
      bytes += chunk.length;
      if (bytes > limit) fail("READ_ONLY_RESPONSE_SIZE_LIMIT");
      chunks.push(Buffer.from(chunk));
    }
  } catch (error) {
    await response.body?.cancel().catch(() => {});
    throw error;
  }
  return { response, bytes: Buffer.concat(chunks) };
}

function countFrom(response) {
  const m = /^\d+-\d+\/(\d+)$/.exec(response.headers.get("content-range") ?? "");
  if (!m || !Number.isSafeInteger(Number(m[1]))) fail("EXACT_COUNT_REQUIRED");
  return Number(m[1]);
}

function makeParams(prefix, { count = false, cursor = null } = {}) {
  const params = new URLSearchParams({ dataset: `eq.${DATASET}`, select: count ? "id" : "*" });
  if (count) params.set("limit", "1");
  else (params.set("order", "id.asc"), params.set("limit", String(PAGE_SIZE)));
  const lower = `oul:${prefix}`,
    upper = `oul:${PREFIXES[PREFIXES.indexOf(prefix) + 1] ?? 'g'}`;
  params.set("and", `(id.gte.${lower},id.lt.${upper})`);
  if (cursor !== null) params.set("id", `gt.${cursor}`);
  return params;
}

async function exactGlobalCount(cfg, fetcher) {
  const params = new URLSearchParams({ dataset: `eq.${DATASET}`, select: "id", limit: "1" });
  const response = await get(
    `${cfg.url}/rest/v1/corpus_records?${params}`,
    { ...cfg.headers, Prefer: "count=exact" },
    fetcher,
  );
  const n = countFrom(response);
  await response.body?.cancel();
  return n;
}

async function exactPrefixCount(cfg, prefix, fetcher) {
  const params = makeParams(prefix, { count: true });
  const response = await get(
    `${cfg.url}/rest/v1/corpus_records?${params}`,
    { ...cfg.headers, Prefer: "count=exact" },
    fetcher,
  );
  const n = countFrom(response);
  await response.body?.cancel();
  return n;
}

async function currentOpenUsCatalogRow(cfg, fetcher) {
  const params = new URLSearchParams({ id: `eq.${DATASET}`, select: "*" });
  const { bytes } = await readBytes(
    `${cfg.url}/rest/v1/corpus_datasets?${params}`,
    cfg.headers,
    2 * 1024 * 1024,
    fetcher,
  );
  const rows = JSON.parse(bytes.toString("utf8"));
  if (!Array.isArray(rows) || rows.length !== 1 || rows[0]?.id !== DATASET)
    fail("OPENUS_CATALOG_ROW_UNAVAILABLE");
  return rows[0];
}

async function readPage(cfg, prefix, cursor, fetcher) {
  const params = makeParams(prefix, { cursor });
  const { bytes } = await readBytes(
    `${cfg.url}/rest/v1/corpus_records?${params}`,
    cfg.headers,
    MAX_PAGE_BYTES,
    fetcher,
  );
  const rows = JSON.parse(bytes.toString("utf8"));
  if (!Array.isArray(rows) || rows.length > PAGE_SIZE) fail("PAGE_SHAPE_INVALID");
  let last = cursor;
  for (const row of rows) {
    if (row.dataset !== DATASET || prefixOf(row.id) !== prefix || (last !== null && row.id <= last))
      fail("PARTITION_IDENTITY_OR_ORDER_INVALID");
    last = row.id;
  }
  return rows;
}

async function assertPrivateRoot(root) {
  const privateRoot = await fs.realpath("private"),
    real = await fs.realpath(root),
    rel = path.relative(privateRoot, real);
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) fail("PRIVATE_PATH_REQUIRED");
}

async function prepareOutputRoot(output) {
  const target = path.resolve(output),
    privateRoot = await fs.realpath("private"),
    relative = path.relative(privateRoot, target);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative))
    fail("PRIVATE_PATH_REQUIRED");
  let ancestor = target,
    ancestorReal;
  while (!ancestorReal) {
    try {
      ancestorReal = await fs.realpath(ancestor);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      const parent = path.dirname(ancestor);
      if (parent === ancestor) throw error;
      ancestor = parent;
    }
  }
  const ancestorRelative = path.relative(privateRoot, ancestorReal);
  if (ancestorRelative.startsWith("..") || path.isAbsolute(ancestorRelative))
    fail("PRIVATE_PATH_REQUIRED");
  await fs.mkdir(target, { recursive: true });
  const root = await fs.realpath(target);
  await assertPrivateRoot(root);
  return root;
}

async function writeImmutable(root, file, bytes) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const parentReal = await fs.realpath(path.dirname(file)),
    relative = path.relative(root, parentReal);
  if (relative.startsWith("..") || path.isAbsolute(relative)) fail("BACKUP_PATH_OUTSIDE_ROOT");
  try {
    if ((await fs.lstat(file)).isSymbolicLink()) fail("BACKUP_PATH_SYMLINK_REJECTED");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  try {
    const old = await fs.readFile(file);
    if (!old.equals(bytes)) fail("EXISTING_BACKUP_CONFLICT");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    const h = await fs.open(file, "wx");
    try {
      await h.writeFile(bytes);
      await h.sync();
    } finally {
      await h.close();
    }
  }
}

async function saveCheckpoint(file, checkpoint) {
  const temp = `${file}.${crypto.randomUUID()}.tmp`,
    h = await fs.open(temp, "wx");
  try {
    await h.writeFile(JSON.stringify(checkpoint, null, 2) + "\n");
    await h.sync();
  } finally {
    await h.close();
  }
  await fs.rename(temp, file);
}

async function loadAndVerifyV1Seed(root) {
  const lock = path.join(root, "backup.lock");
  try {
    await fs.access(lock);
    fail("V1_BACKUP_STILL_LOCKED");
  } catch (error) {
    if (error.message === "V1_BACKUP_STILL_LOCKED") throw error;
    if (error.code !== "ENOENT") throw error;
  }
  const checkpoint = JSON.parse(await fs.readFile(path.join(root, "checkpoint.json"), "utf8"));
  if (checkpoint.project_id !== PROJECT || checkpoint.expected_rows?.[DATASET] !== EXPECTED_ROWS)
    fail("V1_SEED_CHECKPOINT_IDENTITY_MISMATCH");
  const state = checkpoint.datasets?.[DATASET];
  if (
    !state ||
    !Array.isArray(state.pages) ||
    state.rows !== state.pages.reduce((n, p) => n + p.rows, 0)
  )
    fail("V1_SEED_CHECKPOINT_INVALID");
  let cursor = null,
    total = 0;
  for (const [index, receipt] of state.pages.entries()) {
    if (receipt.page !== index + 1 || receipt.previous_cursor !== cursor)
      fail("V1_SEED_PAGE_SEQUENCE_INVALID");
    const rawPath = path.join(root, DATASET, `page-${String(receipt.page).padStart(4, "0")}.jsonl`),
      gzipPath = `${rawPath}.gz`;
    const [rawBytes, gzipBytes] = await Promise.all([fs.readFile(rawPath), fs.readFile(gzipPath)]);
    const rows = await verifyPageBytes({ rawBytes, gzipBytes, receipt });
    for (const row of rows) {
      if (row.dataset !== DATASET || !row.id || (cursor !== null && row.id <= cursor))
        fail("V1_SEED_ROW_SEQUENCE_INVALID");
      prefixOf(row.id);
      cursor = row.id;
      total++;
    }
  }
  if (
    total !== state.rows ||
    cursor !== state.next_cursor ||
    state.complete !== (total === EXPECTED_ROWS)
  )
    fail("V1_SEED_PROGRESS_MISMATCH");
  const beforeImages = {};
  for (const [key, receipt] of Object.entries(checkpoint.before_images ?? {})) {
    const bytes = await fs.readFile(path.join(root, receipt.file));
    if (bytes.length !== receipt.bytes || sha256(bytes) !== receipt.sha256)
      fail("V1_BEFORE_IMAGE_HASH_MISMATCH");
    beforeImages[key] = { receipt, bytes };
  }
  return { checkpoint, state, beforeImages };
}

export async function seedFromV1({ seedRoot = V1_ROOT, outRoot, checkpoint, counts }) {
  const { checkpoint: source, state } = await loadAndVerifyV1Seed(seedRoot);
  validatePartitionCounts(counts);
  const seeded = Object.fromEntries(PREFIXES.map((p) => [p, { rows: 0, cursor: null, pages: [] }]));
  const buffers = Object.fromEntries(PREFIXES.map((p) => [p, []]));
  const flush = async (prefix) => {
    const state = seeded[prefix],
      rows = buffers[prefix];
    if (!rows.length) return;
    const rawBytes = encodeJsonl(rows),
      gzipBytes = await gzip(rawBytes, { level: 1, mtime: 0 });
    const page = state.pages.length + 1,
      rel = path
        .join(DATASET, "partitions", prefix, `page-${String(page).padStart(4, "0")}.jsonl`)
        .replaceAll("\\", "/"),
      rawPath = path.join(outRoot, rel),
      gzipRel = `${rel}.gz`;
    await writeImmutable(outRoot, rawPath, rawBytes);
    await writeImmutable(outRoot, `${rawPath}.gz`, gzipBytes);
    const firstId = rows[0].id,
      lastId = rows.at(-1).id;
    if (state.cursor !== null && firstId <= state.cursor) fail("V1_SEED_PARTITION_ORDER_INVALID");
    state.pages.push({
      page,
      file: rel,
      gzip_file: gzipRel,
      bytes: rawBytes.length,
      gzip_bytes: gzipBytes.length,
      sha256: sha256(rawBytes),
      gzip_sha256: sha256(gzipBytes),
      rows: rows.length,
      first_id: firstId,
      last_id: lastId,
      previous_cursor: state.cursor,
    });
    state.rows += rows.length;
    state.cursor = lastId;
    rows.length = 0;
  };
  let priorId = null;
  for (const receipt of state.pages) {
    const rawPath = path.join(
        seedRoot,
        DATASET,
        `page-${String(receipt.page).padStart(4, "0")}.jsonl`,
      ),
      raw = await fs.readFile(rawPath);
    for (const line of raw.toString("utf8").trimEnd().split("\n")) {
      const row = JSON.parse(line),
        prefix = prefixOf(row.id);
      if (row.dataset !== DATASET || (priorId !== null && row.id <= priorId))
        fail("V1_SEED_ROW_SEQUENCE_INVALID");
      if (seeded[prefix].rows >= counts[prefix]) fail("V1_SEED_EXCEEDS_PARTITION_COUNT");
      priorId = row.id;
      buffers[prefix].push(row);
      if (buffers[prefix].length === PAGE_SIZE) await flush(prefix);
    }
  }
  for (const prefix of PREFIXES) await flush(prefix);
  for (const prefix of PREFIXES) {
    const local = seeded[prefix];
    checkpoint.partitions[prefix].rows = local.rows;
    checkpoint.partitions[prefix].next_cursor = local.cursor;
    checkpoint.partitions[prefix].pages = local.pages;
    if (local.rows === counts[prefix]) checkpoint.partitions[prefix].complete = true;
  }
  checkpoint.seed = {
    source_checkpoint: path.join(seedRoot, "checkpoint.json"),
    source_rows: source.datasets[DATASET].rows,
    source_pages: source.datasets[DATASET].pages.length,
    source_cursor: source.datasets[DATASET].next_cursor,
  };
}

export async function verifyV2Checkpoint(root, checkpoint) {
  if (
    checkpoint?.schema !== "owner-openus-parallel-checkpoint/1" ||
    checkpoint.project_id !== PROJECT ||
    JSON.stringify(Object.keys(checkpoint.partitions ?? {}).sort()) !==
      JSON.stringify([...PREFIXES].sort())
  )
    fail("CHECKPOINT_IDENTITY_MISMATCH");
  for (const prefix of PREFIXES) {
    const state = checkpoint.partitions[prefix];
    if (
      !state ||
      state.expected_rows !== checkpoint.partition_counts[prefix] ||
      !Array.isArray(state.pages)
    )
      fail("CHECKPOINT_PARTITION_INVALID");
    let cursor = null,
      rowsTotal = 0;
    const expectedFiles = new Set();
    for (const [i, receipt] of state.pages.entries()) {
      const rel = path
          .join(DATASET, "partitions", prefix, `page-${String(i + 1).padStart(4, "0")}.jsonl`)
          .replaceAll("\\", "/"),
        gzipRel = `${rel}.gz`;
      if (
        receipt.page !== i + 1 ||
        receipt.file !== rel ||
        receipt.gzip_file !== gzipRel ||
        receipt.previous_cursor !== cursor
      )
        fail("CHECKPOINT_PAGE_SEQUENCE_INVALID");
      expectedFiles.add(path.basename(rel));
      expectedFiles.add(path.basename(gzipRel));
      const [rawBytes, gzipBytes] = await Promise.all([
        fs.readFile(path.join(root, rel)),
        fs.readFile(path.join(root, gzipRel)),
      ]);
      const rows = await verifyPageBytes({
        rawBytes,
        gzipBytes,
        receipt: { ...receipt, raw_bytes: receipt.bytes, raw_sha256: receipt.sha256 },
      });
      let prior = cursor;
      for (const row of rows) {
        if (
          row.dataset !== DATASET ||
          prefixOf(row.id) !== prefix ||
          (prior !== null && row.id <= prior)
        )
          fail("CHECKPOINT_PAGE_ROWS_INVALID");
        prior = row.id;
      }
      if (rows[0]?.id !== receipt.first_id || rows.at(-1)?.id !== receipt.last_id)
        fail("CHECKPOINT_PAGE_BOUNDARY_INVALID");
      cursor = prior;
      rowsTotal += rows.length;
    }
    let actualFiles = [];
    try {
      actualFiles = await fs.readdir(path.join(root, DATASET, "partitions", prefix));
    } catch (error) {
      if (error.code !== "ENOENT" || state.pages.length !== 0) throw error;
    }
    if (
      actualFiles.length !== expectedFiles.size ||
      actualFiles.some((file) => !expectedFiles.has(file))
    )
      fail("CHECKPOINT_UNREFERENCED_PAGE_FILES");
    if (
      rowsTotal !== state.rows ||
      cursor !== state.next_cursor ||
      state.complete !== (rowsTotal === state.expected_rows)
    )
      fail("CHECKPOINT_PARTITION_CURSOR_MISMATCH");
  }
  return checkpoint;
}

async function exportPartition(root, cfg, checkpoint, prefix, fetcher, save, shouldStop) {
  const state = checkpoint.partitions[prefix],
    expected = state.expected_rows;
  while (!state.complete) {
    if (shouldStop()) fail("OTHER_PARTITION_FAILED_STOPPING_READS");
    const rows = await readPage(cfg, prefix, state.next_cursor, fetcher);
    if (!rows.length || state.rows + rows.length > expected)
      fail("PARTITION_EARLY_END_OR_OVERFLOW");
    const rawBytes = encodeJsonl(rows),
      gzipBytes = await gzip(rawBytes, { level: 1, mtime: 0 });
    const page = state.pages.length + 1,
      rel = path
        .join(DATASET, "partitions", prefix, `page-${String(page).padStart(4, "0")}.jsonl`)
        .replaceAll("\\", "/"),
      rawPath = path.join(root, rel),
      gzipRel = `${rel}.gz`;
    await writeImmutable(root, rawPath, rawBytes);
    await writeImmutable(root, `${rawPath}.gz`, gzipBytes);
    const firstId = rows[0].id,
      lastId = rows.at(-1).id;
    if (state.next_cursor !== null && firstId <= state.next_cursor)
      fail("PARTITION_CURSOR_ORDER_INVALID");
    state.pages.push({
      page,
      file: rel,
      gzip_file: gzipRel,
      bytes: rawBytes.length,
      gzip_bytes: gzipBytes.length,
      sha256: sha256(rawBytes),
      gzip_sha256: sha256(gzipBytes),
      rows: rows.length,
      first_id: firstId,
      last_id: lastId,
      previous_cursor: state.next_cursor,
    });
    state.rows += rows.length;
    state.next_cursor = lastId;
    state.complete = state.rows === expected;
    await save();
    if (state.pages.length % 50 === 0)
      console.error(
        `backup_progress dataset=${DATASET} prefix=${prefix} pages=${state.pages.length} rows=${state.rows}/${expected}`,
      );
  }
}

export async function runBackup({
  execute = false,
  fetcher = fetch,
  output = OUTPUT_ROOT,
  seedRoot = V1_ROOT,
} = {}) {
  if (!execute) return { state: "dry_run_only", network_requests: 0, remote_writes: 0 };
  const root = await prepareOutputRoot(output);
  const lockPath = path.join(root, "backup.lock"),
    nonce = crypto.randomUUID();
  let lock;
  try {
    lock = await fs.open(lockPath, "wx");
  } catch (error) {
    if (error.code === "EEXIST") fail("BACKUP_LOCK_PRESENT");
    throw error;
  }
  const lockBytes = Buffer.from(
    JSON.stringify({ pid: process.pid, nonce, started_at: new Date().toISOString() }) + "\n",
  );
  try {
    await lock.writeFile(lockBytes);
    await lock.sync();
  } finally {
    await lock.close();
  }
  try {
    const cfg = credentials(),
      source = await loadAndVerifyV1Seed(seedRoot);
    const globalBefore = await exactGlobalCount(cfg, fetcher);
    if (globalBefore !== EXPECTED_ROWS) fail("INITIAL_GLOBAL_COUNT_MISMATCH");
    const countRows = await mapWithConcurrency(PREFIXES, WORKERS, async (p) => [
      p,
      await exactPrefixCount(cfg, p, fetcher),
    ]);
    const counts = Object.fromEntries(countRows);
    validatePartitionCounts(counts);
    const checkpointPath = path.join(root, "checkpoint.json");
    let checkpoint;
    try {
      checkpoint = JSON.parse(await fs.readFile(checkpointPath, "utf8"));
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    if (checkpoint) {
      if (
        checkpoint.project_id !== PROJECT ||
        JSON.stringify(checkpoint.partition_counts) !== JSON.stringify(counts)
      )
        fail("CHECKPOINT_IDENTITY_OR_COUNT_MISMATCH");
      validatePartitionCounts(checkpoint.partition_counts);
    } else {
      for (const [key, { receipt, bytes }] of Object.entries(source.beforeImages))
        await writeImmutable(root, path.join(root, receipt.file), bytes);
      checkpoint = {
        schema: "owner-openus-parallel-checkpoint/1",
        project_id: PROJECT,
        created_at: new Date().toISOString(),
        expected_rows: EXPECTED_ROWS,
        partition_counts: counts,
        seed: null,
        partitions: Object.fromEntries(
          PREFIXES.map((prefix) => [
            prefix,
            {
              expected_rows: counts[prefix],
              rows: 0,
              next_cursor: null,
              complete: counts[prefix] === 0,
              pages: [],
            },
          ]),
        ),
      };
      await seedFromV1({ seedRoot, outRoot: root, checkpoint, counts });
      await saveCheckpoint(checkpointPath, checkpoint);
    }
    await verifyV2Checkpoint(root, checkpoint);
    let writes = Promise.resolve();
    const save = () => {
      writes = writes.then(() => saveCheckpoint(checkpointPath, checkpoint));
      return writes;
    };
    const queue = [...PREFIXES];
    let firstFailure = null;
    const worker = async () => {
      while (queue.length) {
        if (firstFailure) return;
        const prefix = queue.shift();
        try {
          await exportPartition(
            root,
            cfg,
            checkpoint,
            prefix,
            fetcher,
            save,
            () => firstFailure !== null,
          );
        } catch (error) {
          if (!firstFailure && error.message !== "OTHER_PARTITION_FAILED_STOPPING_READS")
            firstFailure = error;
          throw error;
        }
      }
    };
    const settled = await Promise.allSettled(Array.from({ length: WORKERS }, worker));
    await writes;
    if (firstFailure) throw firstFailure;
    const failed = settled.find((x) => x.status === "rejected");
    if (failed) throw failed.reason;
    const afterCountRows = await mapWithConcurrency(PREFIXES, WORKERS, async (p) => [
      p,
      await exactPrefixCount(cfg, p, fetcher),
    ]);
    const afterCounts = Object.fromEntries(afterCountRows);
    validatePartitionCounts(afterCounts);
    if (
      JSON.stringify(afterCounts) !== JSON.stringify(counts) ||
      (await exactGlobalCount(cfg, fetcher)) !== EXPECTED_ROWS
    )
      fail("FINAL_SOURCE_COUNTS_CHANGED");
    const v1CatalogBytes = source.beforeImages.catalog?.bytes;
    if (!v1CatalogBytes) fail("V1_CATALOG_BEFORE_IMAGE_MISSING");
    const v1CatalogRows = JSON.parse(v1CatalogBytes.toString("utf8"));
    const v1OpenUsRows = Array.isArray(v1CatalogRows)
      ? v1CatalogRows.filter((row) => row?.id === DATASET)
      : [];
    if (
      v1OpenUsRows.length !== 1 ||
      JSON.stringify(await currentOpenUsCatalogRow(cfg, fetcher)) !==
        JSON.stringify(v1OpenUsRows[0])
    )
      fail("OPENUS_CATALOG_CHANGED_SINCE_V1_BEFORE_IMAGE");
    let prior = null,
      globalPage = 0,
      rowsTotal = 0;
    const pages = [];
    for (const prefix of PREFIXES) {
      const part = checkpoint.partitions[prefix];
      if (!part.complete || part.rows !== counts[prefix]) fail("PARTITION_INCOMPLETE");
      for (const receipt of part.pages) {
        if (prior !== null && receipt.first_id <= prior) fail("MERGED_GLOBAL_ID_ORDER_INVALID");
        const rawPath = path.join(root, receipt.file),
          gzipPath = path.join(root, receipt.gzip_file);
        const [rawBytes, gzipBytes] = await Promise.all([
          fs.readFile(rawPath),
          fs.readFile(gzipPath),
        ]);
        const verified = await verifyPageBytes({
          rawBytes,
          gzipBytes,
          receipt: {
            ...receipt,
            raw_bytes: receipt.bytes,
            raw_sha256: receipt.sha256,
            gzip_bytes: receipt.gzip_bytes,
            gzip_sha256: receipt.gzip_sha256,
          },
        });
        if (verified.some((row) => prefixOf(row.id) !== prefix))
          fail("MERGED_PARTITION_CONTENT_MISMATCH");
        globalPage++;
        pages.push({
          ...receipt,
          page: globalPage,
          partition: prefix,
          previous_cursor: prior,
          raw_bytes: receipt.bytes,
          raw_sha256: receipt.sha256,
        });
        prior = receipt.last_id;
        rowsTotal += receipt.rows;
      }
    }
    if (rowsTotal !== EXPECTED_ROWS) fail("MERGED_GLOBAL_ROW_COUNT_MISMATCH");
    const manifest = {
      schema: "owner-collection-backup-manifest/1",
      project_id: PROJECT,
      created_at: checkpoint.created_at,
      completed_at: new Date().toISOString(),
      read_only: true,
      remote_writes: 0,
      before_images: source.checkpoint.before_images,
      datasets: {
        [DATASET]: {
          dataset: DATASET,
          rows: rowsTotal,
          complete: true,
          pages,
          partition_counts: counts,
          global_count: EXPECTED_ROWS,
        },
      },
    };
    await writeImmutable(
      root,
      path.join(root, "manifest.json"),
      Buffer.from(JSON.stringify(manifest, null, 2) + "\n"),
    );
    return {
      state: "backup_complete",
      project_id: PROJECT,
      read_only: true,
      remote_writes: 0,
      rows: rowsTotal,
      pages: globalPage,
      partition_counts: counts,
    };
  } finally {
    const actual = await fs.readFile(lockPath);
    if (!actual.equals(lockBytes)) fail("BACKUP_LOCK_OWNERSHIP_CHANGED");
    await fs.unlink(lockPath);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const args = new Set(process.argv.slice(2));
  for (const arg of args)
    if (arg !== "--execute" && !arg.startsWith("--output=") && !arg.startsWith("--seed-v1="))
      fail("UNSUPPORTED_ARGUMENT");
  const output = [...args].find((x) => x.startsWith("--output="))?.slice(9),
    seedRoot = [...args].find((x) => x.startsWith("--seed-v1="))?.slice(10);
  runBackup({ execute: args.has("--execute"), output, seedRoot })
    .then((result) => console.log(JSON.stringify(result)))
    .catch((error) => {
      console.error(
        /^[A-Z0-9_]+$/.test(error?.message ?? "") ? error.message : "OPENUS_BACKUP_STOPPED",
      );
      process.exitCode = 1;
    });
}
