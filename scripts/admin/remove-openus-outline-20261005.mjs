// Owner-authorized removal of the OpenUS-only law-outline derivatives.
// The script never drops functions, tables, views, schema, or mixed context rows.
// Default mode validates the private recovery packet only; writes require --execute.
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { pathToFileURL } from "node:url";
import { rest } from "../ingest/members-pgrest.mjs";

export const PROJECT = "xosqzzsnhxcyehcnirpa";
export const TARGETS = Object.freeze({
  corpus_law_segments: 818_617,
  corpus_law_nodes: 196_458,
  corpus_law_collections: 224,
  corpus_context: 1,
});
export const TABLE_ORDER = Object.freeze([
  "corpus_law_segments",
  "corpus_law_nodes",
  "corpus_law_collections",
  "corpus_context",
]);
const DEFAULT_MANIFEST =
  "private/audit-2026-10-05/owner-removal-openus-cpsc/outline-backup-v1/manifest.json";
const BASE = path.resolve("private/audit-2026-10-05/owner-removal-openus-cpsc");
const CONTEXT_KEY = "law_outline";
const PAGE_SIZE = 1000;
const EXACT_KEY_BATCH_SIZE = 40;
const sha256 = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");
const fail = (code) => {
  throw new Error(code);
};
const isSha = (value) => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const isIsoDate = (value) => typeof value === "string" && Number.isFinite(Date.parse(value));

const TABLE_KEYS = Object.freeze({
  corpus_law_segments: ["node", "lo"],
  corpus_law_nodes: ["id"],
  corpus_law_collections: ["state", "kind"],
  corpus_context: ["key"],
});

function compareTuple(a, b) {
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    if (a[i] < b[i]) return -1;
    if (a[i] > b[i]) return 1;
  }
  return a.length - b.length;
}

export function identityTuple(table, row) {
  const keys = TABLE_KEYS[table];
  if (!keys || !row || keys.some((key) => row[key] === undefined || row[key] === null))
    fail("OUTLINE_ROW_IDENTITY_INVALID");
  return keys.map((key) => row[key]);
}

export function validateManifestEnvelope(manifest, targets = TARGETS) {
  const tableEntries = manifest?.tables;
  if (
    manifest?.schema !== "owner-openus-outline-backup/1" ||
    manifest.project !== PROJECT ||
    !isIsoDate(manifest.completed_at) ||
    !Array.isArray(tableEntries) ||
    tableEntries.length !== 3 ||
    !manifest.context ||
    manifest.context.file !== "law_outline.json" ||
    !isSha(manifest.context.sha256) ||
    !Number.isSafeInteger(manifest.context.bytes) ||
    manifest.context.bytes < 1
  )
    fail("OUTLINE_MANIFEST_INVALID");
  const tables = new Map(tableEntries.map((entry) => [entry?.table, entry]));
  if (
    tables.size !== 3 ||
    [...tables.keys()].some((table) => ![...TABLE_ORDER].slice(0, 3).includes(table)) ||
    [...TABLE_ORDER].slice(0, 3).some((table) => !tables.has(table))
  )
    fail("OUTLINE_TABLE_SET_INVALID");
  for (const table of TABLE_ORDER.slice(0, 3)) {
    const entry = tables.get(table);
    if (
      entry.rows !== targets[table] ||
      JSON.stringify(entry.keys) !== JSON.stringify(TABLE_KEYS[table]) ||
      !Array.isArray(entry.pages) ||
      entry.pages.length === 0 ||
      entry.pages.reduce(
        (sum, page) => sum + (Number.isSafeInteger(page?.rows) ? page.rows : 0),
        0,
      ) !== entry.rows
    )
      fail("OUTLINE_TABLE_INCOMPLETE");
    if (table === "corpus_law_collections" && entry.pages.length !== 1)
      fail("OUTLINE_TABLE_PAGE_SHAPE_INVALID");
    let previous = null;
    for (const [index, page] of entry.pages.entries()) {
      if (
        typeof page.file !== "string" ||
        !Number.isSafeInteger(page.bytes) ||
        page.bytes < 1 ||
        !isSha(page.sha256) ||
        !Number.isSafeInteger(page.rows) ||
        page.rows < 1 ||
        page.rows > PAGE_SIZE ||
        !Array.isArray(page.first) ||
        !Array.isArray(page.last) ||
        page.first.length !== TABLE_KEYS[table].length ||
        page.last.length !== TABLE_KEYS[table].length ||
        (previous && compareTuple(previous, page.first) >= 0) ||
        (index === 0 && page.first.length === 0)
      )
        fail("OUTLINE_PAGE_RECEIPT_INVALID");
      previous = page.last;
    }
  }
  return manifest;
}

export function validatePageBytes(table, page, bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length !== page.bytes || sha256(bytes) !== page.sha256)
    fail("OUTLINE_BACKUP_HASH_MISMATCH");
  let rows;
  try {
    rows = JSON.parse(bytes.toString("utf8"));
  } catch {
    fail("OUTLINE_BACKUP_JSON_INVALID");
  }
  if (!Array.isArray(rows) || rows.length !== page.rows) fail("OUTLINE_BACKUP_PAGE_COUNT_MISMATCH");
  let prior = null;
  for (const row of rows) {
    const tuple = identityTuple(table, row);
    if (prior && compareTuple(prior, tuple) >= 0) fail("OUTLINE_BACKUP_PAGE_ORDER_INVALID");
    prior = tuple;
  }
  if (
    !isDeepStrictEqual(identityTuple(table, rows[0]), page.first) ||
    !isDeepStrictEqual(identityTuple(table, rows.at(-1)), page.last)
  )
    fail("OUTLINE_BACKUP_PAGE_BOUNDARY_MISMATCH");
  return rows;
}

export function validateContextBytes(contextReceipt, bytes) {
  if (
    !Buffer.isBuffer(bytes) ||
    bytes.length !== contextReceipt.bytes ||
    sha256(bytes) !== contextReceipt.sha256
  )
    fail("OUTLINE_CONTEXT_HASH_MISMATCH");
  let rows;
  try {
    rows = JSON.parse(bytes.toString("utf8"));
  } catch {
    fail("OUTLINE_CONTEXT_JSON_INVALID");
  }
  if (
    !Array.isArray(rows) ||
    rows.length !== 1 ||
    rows[0]?.key !== CONTEXT_KEY ||
    rows[0]?.data?.ready !== false
  )
    fail("OUTLINE_CONTEXT_SCOPE_INVALID");
  return rows[0];
}

export function buildIdentityFilter(table, rows) {
  if (!Array.isArray(rows) || rows.length < 1 || rows.length > PAGE_SIZE)
    fail("OUTLINE_DELETE_BATCH_INVALID");
  const keys = TABLE_KEYS[table];
  if (!keys) fail("OUTLINE_TABLE_INVALID");
  if (table === "corpus_law_nodes") {
    const first = rows[0]?.id;
    const last = rows.at(-1)?.id;
    if (
      rows.some(
        (row, index) =>
          !Number.isSafeInteger(row.id) ||
          row.id < 1 ||
          (index > 0 && row.id <= rows[index - 1].id),
      )
    )
      fail("OUTLINE_ROW_IDENTITY_INVALID");
    return `id=gte.${first}&id=lte.${last}`;
  }
  if (table === "corpus_context") {
    if (rows.length !== 1 || rows[0].key !== CONTEXT_KEY) fail("OUTLINE_CONTEXT_SCOPE_INVALID");
    return `key=eq.${CONTEXT_KEY}`;
  }
  if (table === "corpus_law_segments") {
    const first = identityTuple(table, rows[0]);
    const last = identityTuple(table, rows.at(-1));
    if (
      rows.some(
        (row, index) =>
          index > 0 &&
          compareTuple(identityTuple(table, rows[index - 1]), identityTuple(table, row)) >= 0,
      )
    )
      fail("OUTLINE_ROW_IDENTITY_INVALID");
    const lower = `or(node.gt.${first[0]},and(node.eq.${first[0]},lo.gte.${first[1]}))`;
    const upper = `or(node.lt.${last[0]},and(node.eq.${last[0]},lo.lte.${last[1]}))`;
    return `and=(${lower},${upper})`;
  }
  if (table === "corpus_law_collections" && rows.length > EXACT_KEY_BATCH_SIZE)
    fail("OUTLINE_DELETE_BATCH_INVALID");
  const clauses = rows.map((row) => {
    const tuple = identityTuple(table, row);
    const pair = keys.map((key, index) => `${key}.eq.${tuple[index]}`).join(",");
    return `and(${pair})`;
  });
  return `or=(${clauses.join(",")})`;
}

export function batchBeforeImageHash(rows) {
  return sha256(Buffer.from(JSON.stringify(rows)));
}

export function validateBatchIntent(intent, expected) {
  if (
    intent?.table !== expected.table ||
    intent.page !== expected.page ||
    intent.batch !== expected.batch ||
    intent.rows !== expected.rows.length ||
    intent.identity_sha256 !== expected.identitySha256 ||
    intent.beforeimage_sha256 !== expected.beforeImageSha256 ||
    intent.manifest_sha256 !== expected.manifestSha256 ||
    !isIsoDate(intent.prepared_at)
  )
    fail("OUTLINE_BATCH_INTENT_INVALID");
  return intent;
}

export function validateBatchReceipt(receipt, expected) {
  if (
    receipt?.table !== expected.table ||
    receipt.page !== expected.page ||
    receipt.batch !== expected.batch ||
    receipt.rows !== expected.rows.length ||
    receipt.identity_sha256 !== expected.identitySha256 ||
    receipt.beforeimage_sha256 !== expected.beforeImageSha256 ||
    receipt.manifest_sha256 !== expected.manifestSha256 ||
    !isSha(receipt.deleted_identity_sha256) ||
    receipt.deleted_identity_sha256 !== expected.identitySha256 ||
    !new Set(["exact_identities_deleted", "independently_absent_after_unknown_write"]).has(
      receipt.outcome,
    ) ||
    (receipt.outcome === "exact_identities_deleted" && !isIsoDate(receipt.completed_at)) ||
    (receipt.outcome === "independently_absent_after_unknown_write" &&
      !isIsoDate(receipt.confirmed_at))
  )
    fail("OUTLINE_BATCH_RECEIPT_INVALID");
  return receipt;
}

function safeResolve(root, relative, code) {
  if (typeof relative !== "string" || !relative || path.isAbsolute(relative)) fail(code);
  const resolved = path.resolve(root, relative);
  const rel = path.relative(root, resolved);
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) fail(code);
  return resolved;
}

async function readPinnedFile(root, relative, code) {
  const resolved = safeResolve(root, relative, code);
  const stat = await fs.lstat(resolved);
  if (!stat.isFile() || stat.isSymbolicLink()) fail(code);
  const real = await fs.realpath(resolved);
  const rel = path.relative(root, real);
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) fail(code);
  return fs.readFile(real);
}

async function saveExclusive(file, value) {
  const handle = await fs.open(file, "wx");
  try {
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`);
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function readJson(file, errorCode) {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT" || error instanceof SyntaxError) fail(errorCode);
    throw error;
  }
}

async function exists(file) {
  try {
    await fs.access(file);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

async function verifyLocalBackup(manifestPath, manifestSha) {
  const privateRoot = await fs.realpath("private");
  const realPath = await fs.realpath(manifestPath);
  const rel = path.relative(privateRoot, realPath);
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) fail("PRIVATE_MANIFEST_REQUIRED");
  const manifestBytes = await fs.readFile(realPath);
  if (!isSha(manifestSha) || sha256(manifestBytes) !== manifestSha)
    fail("EXACT_MANIFEST_HASH_REQUIRED");
  let manifest;
  try {
    manifest = JSON.parse(manifestBytes.toString("utf8"));
  } catch {
    fail("OUTLINE_MANIFEST_JSON_INVALID");
  }
  validateManifestEnvelope(manifest);
  const root = path.dirname(realPath);
  const byTable = new Map();
  for (const entry of manifest.tables) {
    const rows = [];
    for (const page of entry.pages) {
      const pageRows = validatePageBytes(
        entry.table,
        page,
        await readPinnedFile(root, page.file, "OUTLINE_PAGE_PATH_INVALID"),
      );
      rows.push(...pageRows);
    }
    if (rows.length !== entry.rows) fail("OUTLINE_TABLE_TOTAL_MISMATCH");
    byTable.set(entry.table, rows);
  }
  const context = validateContextBytes(
    manifest.context,
    await readPinnedFile(root, manifest.context.file, "OUTLINE_CONTEXT_PATH_INVALID"),
  );
  const nodeIds = new Set(byTable.get("corpus_law_nodes").map((row) => row.id));
  if (nodeIds.size !== TARGETS.corpus_law_nodes) fail("OUTLINE_NODE_ID_DUPLICATE");
  if (byTable.get("corpus_law_segments").some((row) => !nodeIds.has(row.node)))
    fail("OUTLINE_SEGMENT_NODE_NOT_BACKED_UP");
  return { manifest, manifestBytes, manifestSha, root, byTable, context };
}

async function acquireLock(lockFile) {
  const handle = await fs.open(lockFile, "wx");
  const marker = Buffer.from(
    `${JSON.stringify({ pid: process.pid, started_at: new Date().toISOString() })}\n`,
  );
  try {
    await handle.writeFile(marker);
    await handle.sync();
  } catch (error) {
    await handle.close();
    await fs.unlink(lockFile).catch(() => {});
    throw error;
  }
  return async () => {
    await handle.close();
    await fs.unlink(lockFile);
  };
}

async function readCount(restClient, table, filter = "") {
  if (!filter && table === "corpus_context") filter = `key=eq.${CONTEXT_KEY}`;
  const query = `${table}?select=${encodeURIComponent(TABLE_KEYS[table].join(","))}&limit=1${filter ? `&${filter}` : ""}`;
  const response = await restClient(query, { prefer: "count=exact" });
  const count = Number(response.headers.get("content-range")?.split("/")[1]);
  if (!Number.isSafeInteger(count) || count < 0) fail("OUTLINE_EXACT_COUNT_REQUIRED");
  return count;
}

function sortedByKey(table, rows) {
  return [...rows].sort((a, b) => compareTuple(identityTuple(table, a), identityTuple(table, b)));
}

async function mutateOnce(fetcher, cfg, table, rows, expected) {
  const filter = buildIdentityFilter(table, rows);
  const response = await fetcher(`${cfg.EXTERNAL_SUPABASE_URL}/rest/v1/${table}?${filter}`, {
    method: "DELETE",
    headers: {
      apikey: cfg.EXTERNAL_SUPABASE_KEY,
      ...(cfg.EXTERNAL_SUPABASE_KEY.startsWith("sb_")
        ? {}
        : { Authorization: `Bearer ${cfg.EXTERNAL_SUPABASE_KEY}` }),
      "Content-Type": "application/json",
      Prefer: `handling=strict,max-affected=${rows.length},return=representation`,
    },
    redirect: "error",
    signal: AbortSignal.timeout(60_000),
  });
  let data;
  try {
    data = await response.json();
  } catch {
    fail(`OUTLINE_DELETE_NON_JSON_${response.status}`);
  }
  if (!response.ok) fail(`OUTLINE_DELETE_HTTP_${response.status}`);
  if (!response.headers.get("preference-applied")?.includes(`max-affected=${rows.length}`))
    fail("OUTLINE_MAX_AFFECTED_NOT_ACKNOWLEDGED");
  const actual = Array.isArray(data) ? sortedByKey(table, data) : null;
  if (!actual || !isDeepStrictEqual(actual, expected)) fail("OUTLINE_DELETE_ACK_MISMATCH");
  return actual;
}

async function removeBatch({
  table,
  rows,
  page,
  batch,
  manifestSha,
  receiptsDir,
  restClient,
  fetcher,
  cfg,
}) {
  const keys = TABLE_KEYS[table];
  const expectedRows = sortedByKey(table, rows);
  const identitySha = batchBeforeImageHash(expectedRows.map((row) => identityTuple(table, row)));
  const beforeImageSha = batchBeforeImageHash(expectedRows);
  const expected = {
    table,
    page,
    batch,
    rows: expectedRows,
    identitySha256: identitySha,
    beforeImageSha256: beforeImageSha,
    manifestSha256: manifestSha,
  };
  const prefix = `${table}-${String(page).padStart(4, "0")}-${String(batch).padStart(3, "0")}`;
  const intentFile = path.join(receiptsDir, `${prefix}.intent.json`);
  const receiptFile = path.join(receiptsDir, `${prefix}.receipt.json`);
  const filter = buildIdentityFilter(table, expectedRows);
  const live = await restClient(
    `${table}?select=*&${filter}${table === "corpus_law_segments" ? "&order=node.asc,lo.asc" : table === "corpus_law_nodes" ? "&order=id.asc" : table === "corpus_law_collections" ? "&order=state.asc,kind.asc" : "&order=key.asc"}&limit=${rows.length}`,
    { prefer: "count=exact" },
  );
  if (!Array.isArray(live.data)) fail("OUTLINE_LIVE_ROWS_INVALID");
  const liveCount = Number(live.headers.get("content-range")?.split("/")[1]);
  if (!Number.isSafeInteger(liveCount) || liveCount < 0) fail("OUTLINE_EXACT_COUNT_REQUIRED");
  const actual = sortedByKey(table, live.data);
  const receiptExists = await exists(receiptFile);
  const intentExists = await exists(intentFile);
  if (receiptExists) {
    const intent = validateBatchIntent(
      await readJson(intentFile, "OUTLINE_INTENT_INVALID"),
      expected,
    );
    const receipt = validateBatchReceipt(
      await readJson(receiptFile, "OUTLINE_RECEIPT_INVALID"),
      expected,
    );
    void intent;
    void receipt;
    if (liveCount !== 0 || actual.length !== 0) fail("OUTLINE_RECEIPTED_ROWS_REAPPEARED");
    return "already_receipted_absent";
  }
  if (intentExists) {
    validateBatchIntent(await readJson(intentFile, "OUTLINE_INTENT_INVALID"), expected);
    if (liveCount === 0 && actual.length === 0) {
      const identityShaReturned = identitySha;
      const recoveryReceipt = {
        table,
        page,
        batch,
        rows: expectedRows.length,
        identity_sha256: identityShaReturned,
        beforeimage_sha256: beforeImageSha,
        manifest_sha256: manifestSha,
        deleted_identity_sha256: identityShaReturned,
        outcome: "independently_absent_after_unknown_write",
        confirmed_at: new Date().toISOString(),
      };
      validateBatchReceipt(recoveryReceipt, expected);
      await saveExclusive(receiptFile, recoveryReceipt);
      return "independently_absent_after_unknown_write";
    }
  }
  if (
    liveCount !== expectedRows.length ||
    actual.length !== expectedRows.length ||
    !isDeepStrictEqual(actual, expectedRows)
  )
    fail("OUTLINE_LIVE_BEFOREIMAGE_MISMATCH");
  if (!intentExists) {
    await saveExclusive(intentFile, {
      table,
      page,
      batch,
      rows: expectedRows.length,
      identity_sha256: identitySha,
      beforeimage_sha256: beforeImageSha,
      manifest_sha256: manifestSha,
      prepared_at: new Date().toISOString(),
    });
  }
  const intent = validateBatchIntent(
    await readJson(intentFile, "OUTLINE_INTENT_INVALID"),
    expected,
  );
  void intent;
  const deleted = await mutateOnce(fetcher, cfg, table, expectedRows, expectedRows);
  const receipt = {
    table,
    page,
    batch,
    rows: deleted.length,
    identity_sha256: identitySha,
    beforeimage_sha256: beforeImageSha,
    manifest_sha256: manifestSha,
    deleted_identity_sha256: batchBeforeImageHash(deleted.map((row) => identityTuple(table, row))),
    outcome: "exact_identities_deleted",
    completed_at: new Date().toISOString(),
  };
  validateBatchReceipt(receipt, expected);
  await saveExclusive(receiptFile, receipt);
  return "deleted";
}

async function executeRemoval({ verified, restClient, fetcher, cfg, base }) {
  const receiptsDir = path.join(base, "outline-removal-receipts");
  await fs.mkdir(receiptsDir, { recursive: true });
  for (const name of await fs.readdir(receiptsDir)) {
    if (
      !/^(corpus_law_(?:segments|nodes|collections)|corpus_context)-\d{4}-\d{3}\.(?:intent|receipt)\.json$/.test(
        name,
      )
    )
      fail("OUTLINE_UNEXPECTED_RECEIPT_FILE");
  }
  for (const table of TABLE_ORDER) {
    const rows = table === "corpus_context" ? [verified.context] : verified.byTable.get(table);
    const pages =
      table === "corpus_context"
        ? [{ rows }]
        : verified.manifest.tables.find((entry) => entry.table === table).pages;
    const beforeCount = await readCount(restClient, table);
    if (beforeCount > TARGETS[table]) fail("OUTLINE_LIVE_COUNT_MISMATCH");
    let batchCount = 0;
    for (const [pageIndex, page] of pages.entries()) {
      const pageRows =
        table === "corpus_context"
          ? page.rows
          : verified.byTable.get(table).slice(
              pages.slice(0, pageIndex).reduce((sum, item) => sum + item.rows, 0),
              pages.slice(0, pageIndex + 1).reduce((sum, item) => sum + item.rows, 0),
            );
      const batchSize = table === "corpus_law_collections" ? EXACT_KEY_BATCH_SIZE : PAGE_SIZE;
      for (let offset = 0; offset < pageRows.length; offset += batchSize) {
        const batchRows = pageRows.slice(offset, offset + batchSize);
        const batchNumber = Math.floor(offset / batchSize) + 1;
        await removeBatch({
          table,
          rows: batchRows,
          page: pageIndex + 1,
          batch: batchNumber,
          manifestSha: verified.manifestSha,
          receiptsDir,
          restClient,
          fetcher,
          cfg,
        });
        batchCount++;
        if (batchCount % 50 === 0)
          console.error(JSON.stringify({ phase: "outline_removal", table, batches: batchCount }));
      }
    }
    if ((await readCount(restClient, table)) !== 0) fail("OUTLINE_TABLE_ROWS_REMAIN");
  }
}

export async function runRemoval({
  manifestPath = DEFAULT_MANIFEST,
  manifestSha256,
  execute = false,
  restClient = rest,
  fetcher = fetch,
  credentialsLoader = async () => {
    const cfg = JSON.parse(
      await fs.readFile("C:/Users/firas/.codex/private/legal-source-compass.preview.json", "utf8"),
    );
    if (
      cfg.EXTERNAL_SUPABASE_URL !== `https://${PROJECT}.supabase.co` ||
      typeof cfg.EXTERNAL_SUPABASE_KEY !== "string"
    )
      fail("WRONG_PROJECT");
    return cfg;
  },
  base = BASE,
} = {}) {
  if (!isSha(manifestSha256)) fail("EXACT_MANIFEST_HASH_REQUIRED");
  const verified = await verifyLocalBackup(manifestPath, manifestSha256);
  if (execute !== true)
    return {
      state: "dry_run_only",
      manifest_sha256: manifestSha256,
      rows: TARGETS,
      remote_writes: 0,
    };
  await fs.mkdir(base, { recursive: true });
  const releaseLock = await acquireLock(path.join(base, "outline-removal.lock"));
  try {
    const cfg = await credentialsLoader();
    if (cfg.EXTERNAL_SUPABASE_URL !== `https://${PROJECT}.supabase.co`) fail("WRONG_PROJECT");
    await executeRemoval({ verified, restClient, fetcher, cfg, base });
    return {
      state: "outline_removal_complete",
      manifest_sha256: manifestSha256,
      remote_writes: "performed",
    };
  } finally {
    await releaseLock();
  }
}

function parseArgs(argv) {
  const args = {};
  for (const arg of argv) {
    if (arg === "--execute") {
      if (args.execute) fail("DUPLICATE_ARGUMENT");
      args.execute = true;
      continue;
    }
    const match = /^--(manifest|manifest-sha256)=(.+)$/.exec(arg);
    if (!match || Object.hasOwn(args, match[1])) fail("UNEXPECTED_ARGUMENT");
    args[match[1]] = match[2];
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const result = await runRemoval({
    manifestPath: args.manifest ?? DEFAULT_MANIFEST,
    manifestSha256: args["manifest-sha256"],
    execute: args.execute === true,
  });
  console.log(JSON.stringify(result));
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href)
  main().catch((error) => {
    console.error(
      /^[A-Z0-9_]+$/.test(error?.message ?? "") ? error.message : "OPENUS_OUTLINE_REMOVAL_STOPPED",
    );
    process.exitCode = 1;
  });
