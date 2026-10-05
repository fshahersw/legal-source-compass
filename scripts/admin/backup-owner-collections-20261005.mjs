// Read-only, resumable before-image export for the two owner-selected collections.
// Network access requires literal --execute. This script has no write/delete RPCs.
import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import zlib from "node:zlib";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";

const gzip = promisify(zlib.gzip),
  gunzip = promisify(zlib.gunzip);
export const PROJECT = "xosqzzsnhxcyehcnirpa";
export const TARGETS = Object.freeze({
  open_us_law: 2_968_623,
  cpsc_injury_data: 479_534,
});
export const PAGE_SIZE = 1000;
const MAX_BEFORE_IMAGE_BYTES = 64 * 1024 * 1024;
const MAX_PAGE_BYTES = 128 * 1024 * 1024;
const OUTPUT_ROOT = path.resolve(
  "private/audit-2026-10-05/owner-requested-full-audit/owner-collections-before-delete",
);
const CREDENTIALS_FILE = "C:/Users/firas/.codex/private/legal-source-compass.preview.json";
const sha256 = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");
const fail = (code) => {
  throw new Error(code);
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function exactCount(response) {
  const range = response.headers.get("content-range");
  const match = /^\d+-\d+\/(\d+)$/.exec(range ?? "");
  if (!match) fail("EXACT_COUNT_REQUIRED");
  const count = Number(match[1]);
  if (!Number.isSafeInteger(count) || count < 0) fail("EXACT_COUNT_INVALID");
  return count;
}

export function validateCatalog(catalogRows) {
  if (!Array.isArray(catalogRows)) fail("CATALOG_ROWS_REQUIRED");
  const targetRows = catalogRows.filter((row) => Object.hasOwn(TARGETS, row?.id));
  const byId = new Map(targetRows.map((row) => [row.id, row]));
  if (byId.size !== targetRows.length) fail("TARGET_CATALOG_ROWS_MISSING_OR_DUPLICATE");
  if (byId.size !== Object.keys(TARGETS).length) fail("TARGET_CATALOG_ROWS_MISSING_OR_DUPLICATE");
  for (const [id, expected] of Object.entries(TARGETS)) {
    const row = byId.get(id);
    if (row.imported_records !== expected) fail("TARGET_CATALOG_COUNT_MISMATCH");
  }
  return Object.fromEntries(byId);
}

export function validatePage({ dataset, rows, cursor, expectedRows, priorRows = 0 }) {
  if (!Object.hasOwn(TARGETS, dataset) || !Array.isArray(rows) || rows.length > PAGE_SIZE)
    fail("PAGE_SHAPE_INVALID");
  if (priorRows + rows.length > expectedRows) fail("PAGE_EXCEEDS_EXPECTED_COUNT");
  let previous = cursor;
  const ids = new Set();
  for (const row of rows) {
    if (
      row?.dataset !== dataset ||
      typeof row.id !== "string" ||
      !row.id ||
      (previous !== null && row.id <= previous) ||
      ids.has(row.id)
    )
      fail("PAGE_NATIVE_IDENTITY_OR_ORDER_INVALID");
    ids.add(row.id);
    previous = row.id;
  }
  return {
    rows: rows.length,
    firstId: rows[0]?.id ?? null,
    lastId: rows.at(-1)?.id ?? cursor,
  };
}

export function encodeJsonl(rows) {
  if (!Array.isArray(rows) || rows.length === 0) fail("NONEMPTY_PAGE_REQUIRED");
  return Buffer.from(rows.map((row) => JSON.stringify(row)).join("\n") + "\n", "utf8");
}

export async function verifyPageBytes({ rawBytes, gzipBytes, receipt }) {
  if (
    !Buffer.isBuffer(rawBytes) ||
    !Buffer.isBuffer(gzipBytes) ||
    sha256(rawBytes) !== receipt.raw_sha256 ||
    rawBytes.length !== receipt.raw_bytes ||
    sha256(gzipBytes) !== receipt.gzip_sha256 ||
    gzipBytes.length !== receipt.gzip_bytes
  )
    fail("PAGE_BACKUP_HASH_MISMATCH");
  const inflated = await gunzip(gzipBytes);
  if (!inflated.equals(rawBytes)) fail("PAGE_GZIP_CONTENT_MISMATCH");
  const lines = rawBytes.toString("utf8").split("\n");
  if (lines.at(-1) !== "") fail("PAGE_JSONL_TERMINATOR_REQUIRED");
  const rows = lines.slice(0, -1).map((line) => JSON.parse(line));
  if (
    rows.length !== receipt.rows ||
    rows[0]?.id !== receipt.first_id ||
    rows.at(-1)?.id !== receipt.last_id
  )
    fail("PAGE_IDENTITY_RECEIPT_MISMATCH");
  return rows;
}

async function withinPrivate(file, mustExist = false) {
  const root = await fs.realpath("private");
  const resolved = mustExist
    ? await fs.realpath(file)
    : path.join(await fs.realpath(path.dirname(file)), path.basename(file));
  const relative = path.relative(root, resolved);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative))
    fail("PRIVATE_PATH_REQUIRED");
  return resolved;
}

async function assertInsideBackupRoot(root, file, allowMissing = true) {
  const rootReal = await fs.realpath(root);
  let resolved;
  try {
    const stat = await fs.lstat(file);
    if (stat.isSymbolicLink()) fail("BACKUP_PATH_SYMLINK_REJECTED");
    resolved = await fs.realpath(file);
  } catch (error) {
    if (!allowMissing || error.code !== "ENOENT") throw error;
    resolved = path.join(await fs.realpath(path.dirname(file)), path.basename(file));
  }
  const relative = path.relative(rootReal, resolved);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative))
    fail("BACKUP_PATH_OUTSIDE_ROOT");
  return resolved;
}

async function preserveImmutable(root, file, bytes) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await assertInsideBackupRoot(root, file);
  try {
    const existing = await fs.readFile(file);
    if (existing.length !== bytes.length || sha256(existing) !== sha256(bytes))
      fail("EXISTING_BEFORE_IMAGE_CONFLICT");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    const handle = await fs.open(file, "wx");
    try {
      await handle.writeFile(bytes);
      await handle.sync();
    } finally {
      await handle.close();
    }
    const check = await fs.readFile(file);
    if (check.length !== bytes.length || sha256(check) !== sha256(bytes))
      fail("BEFORE_IMAGE_READBACK_MISMATCH");
  }
  return {
    file: path.relative(root, file).replaceAll("\\", "/"),
    bytes: bytes.length,
    sha256: sha256(bytes),
  };
}

function retryDelay(response, attempt) {
  const value = response.headers.get("retry-after");
  const parsed = /^\d+(?:\.\d+)?$/.test(value ?? "")
    ? Number(value) * 1000
    : value
      ? Date.parse(value) - Date.now()
      : NaN;
  const delay = Number.isFinite(parsed) && parsed >= 0 ? parsed : 1000 * 2 ** attempt;
  if (delay > 30_000) fail("READ_ONLY_RETRY_AFTER_EXCEEDS_BOUND");
  return Math.max(250, delay);
}

async function readOnlyGet(url, headers, fetcher = fetch) {
  for (let attempt = 0; attempt <= 3; attempt++) {
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
      const delay = retryDelay(response, attempt);
      await response.body?.cancel();
      await sleep(delay);
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

async function getBytes(url, headers, maxBytes, fetcher) {
  const response = await readOnlyGet(url, headers, fetcher);
  const chunks = [];
  let total = 0;
  try {
    for await (const chunk of response.body ?? []) {
      total += chunk.length;
      if (total > maxBytes) fail("RESPONSE_SIZE_LIMIT");
      chunks.push(Buffer.from(chunk));
    }
  } catch (error) {
    await response.body?.cancel().catch(() => {});
    throw error;
  }
  return { response, bytes: Buffer.concat(chunks) };
}

function credentials() {
  const cfg = JSON.parse(fsSync.readFileSync(CREDENTIALS_FILE, "utf8"));
  if (
    cfg.EXTERNAL_SUPABASE_URL !== `https://${PROJECT}.supabase.co` ||
    typeof cfg.EXTERNAL_SUPABASE_KEY !== "string"
  )
    fail("WRONG_PROJECT_CREDENTIALS");
  const token = cfg.EXTERNAL_SUPABASE_KEY;
  return {
    url: cfg.EXTERNAL_SUPABASE_URL,
    headers: {
      apikey: token,
      ...(token.startsWith("sb_") ? {} : { Authorization: `Bearer ${token}` }),
    },
  };
}

function checkpointSnapshot(checkpoint) {
  return JSON.stringify(checkpoint, null, 2) + "\n";
}

async function saveCheckpoint(file, checkpoint) {
  const root = path.dirname(file);
  await assertInsideBackupRoot(root, file);
  const bytes = Buffer.from(checkpointSnapshot(checkpoint));
  const temporary = `${file}.${crypto.randomUUID()}.tmp`;
  const handle = await fs.open(temporary, "wx");
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }
  await fs.rename(temporary, file);
}

async function acquireBackupLock(root) {
  const file = path.join(root, "backup.lock"),
    nonce = crypto.randomUUID(),
    bytes = Buffer.from(
      JSON.stringify({
        schema: "owner-collection-backup-lock/1",
        pid: process.pid,
        nonce,
        started_at: new Date().toISOString(),
      }) + "\n",
    );
  let handle;
  try {
    handle = await fs.open(file, "wx");
  } catch (error) {
    if (error.code === "EEXIST") fail("BACKUP_LOCK_PRESENT");
    throw error;
  }
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }
  return async () => {
    const current = await fs.readFile(file);
    if (!current.equals(bytes)) fail("BACKUP_LOCK_OWNERSHIP_CHANGED");
    await fs.unlink(file);
  };
}

export async function verifyCheckpoint(root, checkpoint) {
  if (
    checkpoint?.schema !== "owner-collection-backup-checkpoint/1" ||
    checkpoint.project_id !== PROJECT ||
    JSON.stringify(Object.keys(checkpoint.datasets ?? {}).sort()) !==
      JSON.stringify(Object.keys(TARGETS).sort())
  )
    fail("CHECKPOINT_IDENTITY_MISMATCH");
  for (const [dataset, expectedRows] of Object.entries(TARGETS)) {
    const state = checkpoint.datasets[dataset];
    if (!state || state.expected_rows !== expectedRows || !Array.isArray(state.pages))
      fail("CHECKPOINT_DATASET_STATE_INVALID");
    let cursor = null,
      count = 0;
    const expectedFiles = new Set();
    for (const [index, receipt] of state.pages.entries()) {
      if (
        receipt.page !== index + 1 ||
        receipt.previous_cursor !== cursor ||
        receipt.rows < 1 ||
        receipt.rows > PAGE_SIZE
      )
        fail("CHECKPOINT_PAGE_SEQUENCE_MISMATCH");
      const rawPath = path.join(
          root,
          dataset,
          `page-${String(receipt.page).padStart(4, "0")}.jsonl`,
        ),
        gzipPath = `${rawPath}.gz`;
      await assertInsideBackupRoot(root, rawPath, false);
      await assertInsideBackupRoot(root, gzipPath, false);
      if (
        receipt.file !== path.relative(root, rawPath).replaceAll("\\", "/") ||
        receipt.gzip_file !== path.relative(root, gzipPath).replaceAll("\\", "/") ||
        receipt.bytes !== receipt.raw_bytes ||
        receipt.sha256 !== receipt.raw_sha256
      )
        fail("CHECKPOINT_PAGE_FILE_REFERENCE_MISMATCH");
      expectedFiles.add(path.basename(rawPath));
      expectedFiles.add(path.basename(gzipPath));
      const [rawBytes, gzipBytes] = await Promise.all([
        fs.readFile(rawPath),
        fs.readFile(gzipPath),
      ]);
      const rows = await verifyPageBytes({ rawBytes, gzipBytes, receipt });
      const identity = validatePage({ dataset, rows, cursor, expectedRows, priorRows: count });
      if (identity.firstId !== receipt.first_id || identity.lastId !== receipt.last_id)
        fail("CHECKPOINT_PAGE_NATIVE_ID_MISMATCH");
      cursor = identity.lastId;
      count += rows.length;
    }
    let actualFiles;
    try {
      await assertInsideBackupRoot(root, path.join(root, dataset), false);
      actualFiles = await fs.readdir(path.join(root, dataset));
    } catch (error) {
      if (error.code !== "ENOENT" || state.pages.length !== 0) throw error;
      actualFiles = [];
    }
    if (
      actualFiles.length !== expectedFiles.size ||
      actualFiles.some((file) => !expectedFiles.has(file))
    )
      fail("CHECKPOINT_UNREFERENCED_PAGE_FILES");
    if (count !== state.rows || cursor !== state.next_cursor || count > expectedRows)
      fail("CHECKPOINT_DATASET_CURSOR_MISMATCH");
    if (state.complete !== (count === expectedRows)) fail("CHECKPOINT_COMPLETION_MISMATCH");
  }
  return checkpoint;
}

async function outputDirectory(outputArg) {
  const target = path.resolve(outputArg ?? OUTPUT_ROOT),
    privateRoot = await fs.realpath("private"),
    lexicalRelative = path.relative(privateRoot, target);
  if (!lexicalRelative || lexicalRelative.startsWith("..") || path.isAbsolute(lexicalRelative))
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
  const realRelative = path.relative(privateRoot, ancestorReal);
  if (realRelative.startsWith("..") || path.isAbsolute(realRelative)) fail("PRIVATE_PATH_REQUIRED");
  await fs.mkdir(target, { recursive: true });
  return await withinPrivate(target, true);
}

async function parseJsonResponse(bytes, label) {
  try {
    return JSON.parse(bytes.toString("utf8"));
  } catch {
    fail(`${label}_JSON_INVALID`);
  }
}

async function captureBeforeImages(root, cfg, fetcher) {
  const base = cfg.url;
  const [catalogResult, contextResult, schemaResult] = await Promise.all([
    getBytes(
      `${base}/rest/v1/corpus_datasets?select=*&order=id.asc`,
      cfg.headers,
      MAX_BEFORE_IMAGE_BYTES,
      fetcher,
    ),
    getBytes(
      `${base}/rest/v1/corpus_context?select=*&order=key.asc`,
      cfg.headers,
      MAX_BEFORE_IMAGE_BYTES,
      fetcher,
    ),
    getBytes(`${base}/rest/v1/`, cfg.headers, MAX_BEFORE_IMAGE_BYTES, fetcher),
  ]);
  const catalog = await parseJsonResponse(catalogResult.bytes, "CATALOG"),
    context = await parseJsonResponse(contextResult.bytes, "CONTEXT");
  const targetCatalog = validateCatalog(catalog);
  const catalogReceipt = await preserveImmutable(
      root,
      path.join(root, "corpus-datasets-before.json"),
      catalogResult.bytes,
    ),
    contextReceipt = await preserveImmutable(
      root,
      path.join(root, "corpus-context-before.json"),
      contextResult.bytes,
    ),
    schemaReceipt = await preserveImmutable(
      root,
      path.join(root, "postgrest-schema-before.json"),
      schemaResult.bytes,
    );
  return {
    catalog,
    targetCatalog,
    receipts: { catalog: catalogReceipt, context: contextReceipt, rest_schema: schemaReceipt },
  };
}

async function exactDatasetCount(cfg, dataset, fetcher) {
  const params = new URLSearchParams({ dataset: `eq.${dataset}`, select: "id", limit: "1" });
  const response = await readOnlyGet(
    `${cfg.url}/rest/v1/corpus_records?${params}`,
    {
      ...cfg.headers,
      Prefer: "count=exact",
    },
    fetcher,
  );
  await response.body?.cancel();
  return exactCount(response);
}

async function readPage(cfg, dataset, cursor, fetcher) {
  const params = new URLSearchParams({
    dataset: `eq.${dataset}`,
    select: "*",
    order: "id.asc",
    limit: String(PAGE_SIZE),
  });
  if (cursor !== null) params.set("id", `gt.${cursor}`);
  const { bytes } = await getBytes(
    `${cfg.url}/rest/v1/corpus_records?${params}`,
    cfg.headers,
    MAX_PAGE_BYTES,
    fetcher,
  );
  const rows = await parseJsonResponse(bytes, "CORPUS_PAGE");
  if (!Array.isArray(rows)) fail("CORPUS_PAGE_ARRAY_REQUIRED");
  return rows;
}

async function exportDataset(root, cfg, checkpoint, dataset, fetcher, saveState) {
  const state = checkpoint.datasets[dataset],
    expectedRows = TARGETS[dataset],
    folder = path.join(root, dataset);
  await fs.mkdir(folder, { recursive: true });
  while (!state.complete) {
    const rows = await readPage(cfg, dataset, state.next_cursor, fetcher);
    if (rows.length === 0) fail("UNEXPECTED_EARLY_END_OF_DATASET");
    const identity = validatePage({
      dataset,
      rows,
      cursor: state.next_cursor,
      expectedRows,
      priorRows: state.rows,
    });
    const rawBytes = encodeJsonl(rows),
      gzipBytes = await gzip(rawBytes, { level: 1, mtime: 0 }),
      page = state.pages.length + 1,
      rawPath = path.join(folder, `page-${String(page).padStart(4, "0")}.jsonl`),
      gzipPath = `${rawPath}.gz`;
    const receipt = {
      page,
      file: path.relative(root, rawPath).replaceAll("\\", "/"),
      gzip_file: path.relative(root, gzipPath).replaceAll("\\", "/"),
      rows: identity.rows,
      first_id: identity.firstId,
      last_id: identity.lastId,
      previous_cursor: state.next_cursor,
      bytes: rawBytes.length,
      raw_bytes: rawBytes.length,
      sha256: sha256(rawBytes),
      raw_sha256: sha256(rawBytes),
      gzip_bytes: gzipBytes.length,
      gzip_sha256: sha256(gzipBytes),
    };
    await preserveImmutable(root, rawPath, rawBytes);
    await preserveImmutable(root, gzipPath, gzipBytes);
    state.pages.push(receipt);
    state.rows += identity.rows;
    state.next_cursor = identity.lastId;
    state.complete = state.rows === expectedRows;
    await saveState();
    if (page % 50 === 0)
      console.error(
        `backup_progress dataset=${dataset} pages=${page} rows=${state.rows}/${expectedRows}`,
      );
  }
  const finalCount = await exactDatasetCount(cfg, dataset, fetcher);
  if (finalCount !== expectedRows || state.rows !== finalCount)
    fail("FINAL_DATASET_COUNT_MISMATCH");
  return { dataset, rows: state.rows, pages: state.pages.length, next_cursor: state.next_cursor };
}

export async function runBackup({ output, fetcher = fetch, execute = false } = {}) {
  if (execute !== true) return { state: "dry_run_only", network_requests: 0, remote_writes: 0 };
  const root = await outputDirectory(output),
    releaseLock = await acquireBackupLock(root);
  try {
    return await runBackupAtRoot({ root, fetcher });
  } finally {
    await releaseLock();
  }
}

async function runBackupAtRoot({ root, fetcher }) {
  const cfg = credentials(),
    before = await captureBeforeImages(root, cfg, fetcher);
  for (const [dataset, expected] of Object.entries(TARGETS)) {
    if (before.targetCatalog[dataset].imported_records !== expected)
      fail("TARGET_CATALOG_COUNT_MISMATCH");
    if ((await exactDatasetCount(cfg, dataset, fetcher)) !== expected)
      fail("INITIAL_DATASET_COUNT_MISMATCH");
  }

  const checkpointPath = path.join(root, "checkpoint.json");
  let checkpoint, existingCheckpoint;
  await assertInsideBackupRoot(root, checkpointPath);
  try {
    existingCheckpoint = await fs.readFile(checkpointPath, "utf8");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  if (existingCheckpoint !== undefined) {
    checkpoint = JSON.parse(existingCheckpoint);
    await verifyCheckpoint(root, checkpoint);
    if (JSON.stringify(checkpoint.before_images) !== JSON.stringify(before.receipts))
      fail("CHECKPOINT_BEFORE_IMAGE_MISMATCH");
  } else {
    checkpoint = {
      schema: "owner-collection-backup-checkpoint/1",
      project_id: PROJECT,
      created_at: new Date().toISOString(),
      expected_rows: TARGETS,
      before_images: before.receipts,
      datasets: Object.fromEntries(
        Object.entries(TARGETS).map(([id, expected_rows]) => [
          id,
          { expected_rows, rows: 0, next_cursor: null, complete: false, pages: [] },
        ]),
      ),
    };
    await saveCheckpoint(checkpointPath, checkpoint);
  }

  // Two independent, read-only keyset traversals; checkpoint writes serialize.
  let checkpointWrites = Promise.resolve();
  const saveState = () => {
    checkpointWrites = checkpointWrites.then(() => saveCheckpoint(checkpointPath, checkpoint));
    return checkpointWrites;
  };
  const settled = await Promise.allSettled(
    Object.keys(TARGETS).map((dataset) =>
      exportDataset(root, cfg, checkpoint, dataset, fetcher, saveState),
    ),
  );
  await checkpointWrites;
  const failure = settled.find((result) => result.status === "rejected");
  if (failure) throw failure.reason;
  const results = settled.map((result) => result.value);
  const catalogCheck = await getBytes(
    `${cfg.url}/rest/v1/corpus_datasets?select=*&order=id.asc`,
    cfg.headers,
    MAX_BEFORE_IMAGE_BYTES,
    fetcher,
  );
  const finalCatalog = validateCatalog(await parseJsonResponse(catalogCheck.bytes, "CATALOG"));
  for (const id of Object.keys(TARGETS))
    if (JSON.stringify(finalCatalog[id]) !== JSON.stringify(before.targetCatalog[id]))
      fail("TARGET_CATALOG_CHANGED_DURING_BACKUP");
  await saveState();
  checkpoint.completed_at ??= new Date().toISOString();
  await saveState();
  const manifest = {
    schema: "owner-collection-backup-manifest/1",
    project_id: PROJECT,
    created_at: checkpoint.created_at,
    completed_at: checkpoint.completed_at,
    complete: true,
    read_only: true,
    remote_writes: 0,
    before_images: before.receipts,
    datasets: Object.fromEntries(
      Object.entries(TARGETS).map(([dataset]) => [
        dataset,
        {
          dataset,
          complete: checkpoint.datasets[dataset].complete === true,
          rows: checkpoint.datasets[dataset].rows,
          pages: checkpoint.datasets[dataset].pages,
        },
      ]),
    ),
  };
  await preserveImmutable(
    root,
    path.join(root, "manifest.json"),
    Buffer.from(JSON.stringify(manifest, null, 2) + "\n"),
  );
  return {
    state: "backup_complete",
    project_id: PROJECT,
    read_only: true,
    remote_writes: 0,
    datasets: results,
    before_images: before.receipts,
    manifest: path.relative(root, path.join(root, "manifest.json")).replaceAll("\\", "/"),
    checkpoint: path.relative(root, checkpointPath).replaceAll("\\", "/"),
  };
}

async function main() {
  const args = new Set(process.argv.slice(2));
  for (const arg of args)
    if (arg !== "--execute" && !arg.startsWith("--output=")) fail("UNSUPPORTED_ARGUMENT");
  const outputArg = [...args].find((arg) => arg.startsWith("--output="))?.slice("--output=".length);
  const result = await runBackup({ execute: args.has("--execute"), output: outputArg });
  console.log(JSON.stringify(result));
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href)
  main().catch((error) => {
    console.error(
      /^[A-Z0-9_]+$/.test(error?.message ?? "") ? error.message : "OWNER_COLLECTION_BACKUP_STOPPED",
    );
    process.exitCode = 1;
  });
