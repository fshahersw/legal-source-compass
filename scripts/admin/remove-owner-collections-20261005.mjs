// Owner-authorized deletion of only Open US Law and CPSC injury records.
// Complete private before-images and an exact manifest hash are required.
// Default mode validates local recovery material only; remote writes require --execute.
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import zlib from "node:zlib";
import { promisify } from "node:util";
import { isDeepStrictEqual } from "node:util";
import { pathToFileURL } from "node:url";
import { rest } from "../ingest/members-pgrest.mjs";

const gunzip = promisify(zlib.gunzip);
export const TARGETS = Object.freeze({ open_us_law: 2_968_623, cpsc_injury_data: 479_534 });
export const PROJECT = "xosqzzsnhxcyehcnirpa";
const BASE = path.resolve("private/audit-2026-10-05/owner-removal-openus-cpsc");
const CREDENTIALS_FILE = "C:/Users/firas/.codex/private/legal-source-compass.preview.json";
const MANIFEST_SCHEMA = "owner-collection-backup-manifest/1";
const sha = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");
const fail = (code) => {
  throw new Error(code);
};
const isSha = (value) => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const isIsoDate = (value) => typeof value === "string" && Number.isFinite(Date.parse(value));
const sortedKeys = (value) => Object.keys(value ?? {}).sort();

export function parseDatasetSelection(raw) {
  if (raw === undefined) return Object.keys(TARGETS);
  if (typeof raw !== "string" || !raw.trim()) fail("DATASET_SELECTION_INVALID");
  const requested = raw.split(",").map((value) => value.trim());
  if (
    requested.some((value) => !Object.hasOwn(TARGETS, value)) ||
    new Set(requested).size !== requested.length
  )
    fail("DATASET_SELECTION_INVALID");
  return Object.keys(TARGETS).filter((dataset) => requested.includes(dataset));
}

export function parseConcurrency(raw) {
  if (raw === undefined) return 1;
  if (!/^[1-4]$/.test(raw)) fail("CONCURRENCY_INVALID");
  return Number(raw);
}

export async function runBoundedPageWorkers(items, concurrency, worker) {
  if (
    !Array.isArray(items) ||
    !Number.isSafeInteger(concurrency) ||
    concurrency < 1 ||
    concurrency > 4 ||
    typeof worker !== "function"
  )
    fail("CONCURRENCY_INVALID");
  let next = 0;
  let failed = false;
  let firstError;
  const runWorker = async () => {
    while (!failed) {
      const index = next++;
      if (index >= items.length) return;
      try {
        await worker(items[index], index);
      } catch (error) {
        if (!failed) firstError = error;
        failed = true;
        return;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, runWorker));
  if (failed) throw firstError;
}

function safeResolve(root, relativePath, code) {
  if (typeof relativePath !== "string" || !relativePath || path.isAbsolute(relativePath))
    fail(code);
  const resolved = path.resolve(root, relativePath);
  const relative = path.relative(root, resolved);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) fail(code);
  return resolved;
}

async function readBackupFile(root, relativePath, code) {
  const resolved = safeResolve(root, relativePath, code);
  const stat = await fs.lstat(resolved);
  if (stat.isSymbolicLink() || !stat.isFile()) fail(code);
  const real = await fs.realpath(resolved);
  const relative = path.relative(root, real);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) fail(code);
  return fs.readFile(real);
}

export function validateManifestEnvelope(
  manifest,
  selectedDatasets = Object.keys(TARGETS),
  targets = TARGETS,
) {
  const selected = parseDatasetSelection(selectedDatasets.join(","));
  if (
    manifest?.schema !== MANIFEST_SCHEMA ||
    manifest.project_id !== PROJECT ||
    manifest.read_only !== true ||
    manifest.remote_writes !== 0 ||
    manifest.complete === false ||
    !isIsoDate(manifest.created_at) ||
    !isIsoDate(manifest.completed_at) ||
    sortedKeys(manifest.datasets).join(",") !== [...selected].sort().join(",")
  )
    fail("WRONG_OR_INCOMPLETE_BACKUP_MANIFEST");
  if (!manifest.before_images?.catalog || !isSha(manifest.before_images.catalog.sha256))
    fail("CATALOG_BACKUP_RECEIPT_INVALID");

  for (const dataset of selected) {
    const state = manifest.datasets[dataset];
    const expectedRows = targets[dataset];
    if (
      !state ||
      state.dataset !== dataset ||
      state.rows !== expectedRows ||
      state.complete !== true ||
      !Array.isArray(state.pages) ||
      state.pages.length === 0 ||
      state.pages.reduce(
        (sum, page) => sum + (Number.isSafeInteger(page?.rows) ? page.rows : 0),
        0,
      ) !== expectedRows
    )
      fail("INCOMPLETE_BACKUP");

    let cursor = null;
    for (const [index, page] of state.pages.entries()) {
      if (
        page.page !== index + 1 ||
        page.previous_cursor !== cursor ||
        !Number.isSafeInteger(page.rows) ||
        page.rows < 1 ||
        page.rows > 1000 ||
        typeof page.first_id !== "string" ||
        typeof page.last_id !== "string" ||
        page.first_id > page.last_id ||
        (cursor !== null && page.first_id <= cursor) ||
        !Number.isSafeInteger(page.raw_bytes) ||
        page.raw_bytes < 1 ||
        !Number.isSafeInteger(page.gzip_bytes) ||
        page.gzip_bytes < 1 ||
        !isSha(page.raw_sha256) ||
        !isSha(page.gzip_sha256) ||
        page.bytes !== page.raw_bytes ||
        page.sha256 !== page.raw_sha256 ||
        typeof page.file !== "string" ||
        typeof page.gzip_file !== "string"
      )
        fail("BACKUP_PAGE_RECEIPT_INVALID");
      cursor = page.last_id;
    }
  }
  return manifest;
}

export function validateRecoveryPage(dataset, page, rawBytes, gzipBytes) {
  if (
    !Object.hasOwn(TARGETS, dataset) ||
    !Buffer.isBuffer(rawBytes) ||
    !Buffer.isBuffer(gzipBytes) ||
    sha(rawBytes) !== page.raw_sha256 ||
    rawBytes.length !== page.raw_bytes ||
    sha(gzipBytes) !== page.gzip_sha256 ||
    gzipBytes.length !== page.gzip_bytes
  )
    fail("RECOVERY_PAGE_INVALID");
  let inflated;
  try {
    inflated = zlib.gunzipSync(gzipBytes);
  } catch {
    fail("RECOVERY_GZIP_INVALID");
  }
  if (!inflated.equals(rawBytes)) fail("RECOVERY_GZIP_CONTENT_MISMATCH");

  const lines = rawBytes.toString("utf8").split("\n");
  if (lines.at(-1) !== "" || lines.length < 2) fail("RECOVERY_JSONL_INVALID");
  let rows;
  try {
    rows = lines.slice(0, -1).map((line) => JSON.parse(line));
  } catch {
    fail("RECOVERY_JSONL_INVALID");
  }
  if (
    rows.length !== page.rows ||
    rows.length > 1000 ||
    rows[0]?.id !== page.first_id ||
    rows.at(-1)?.id !== page.last_id
  )
    fail("RECOVERY_BOUNDS_INVALID");
  let previous = page.previous_cursor;
  for (const row of rows) {
    if (
      row?.dataset !== dataset ||
      typeof row.id !== "string" ||
      !row.id ||
      (previous !== null && row.id <= previous)
    )
      fail("RECOVERY_SCOPE_INVALID");
    previous = row.id;
  }
  return rows.map(({ dataset: rowDataset, id }) => ({ dataset: rowDataset, id }));
}

export function deleteQuery(dataset, page) {
  if (
    !Object.hasOwn(TARGETS, dataset) ||
    typeof page.first_id !== "string" ||
    typeof page.last_id !== "string" ||
    page.first_id > page.last_id
  )
    fail("DELETE_SCOPE_INVALID");
  return new URLSearchParams([
    ["dataset", `eq.${dataset}`],
    ["id", `gte.${page.first_id}`],
    ["id", `lte.${page.last_id}`],
    ["select", "dataset,id"],
  ]).toString();
}

export function validatePageIntent(intent, { dataset, page, manifestSha256, identitySha }) {
  if (
    intent?.dataset !== dataset ||
    intent.page !== page.page ||
    intent.rows !== page.rows ||
    intent.recovery_sha256 !== page.raw_sha256 ||
    intent.identity_sha256 !== identitySha ||
    intent.manifest_sha256 !== manifestSha256
  )
    fail("PAGE_INTENT_INVALID");
  return intent;
}

export function validatePageReceipt(
  receipt,
  { dataset, page, manifestSha256, identitySha, intent },
) {
  validatePageIntent(intent, { dataset, page, manifestSha256, identitySha });
  if (
    receipt?.dataset !== dataset ||
    receipt.page !== page.page ||
    receipt.rows !== page.rows ||
    receipt.recovery_sha256 !== page.raw_sha256 ||
    receipt.identity_sha256 !== identitySha ||
    receipt.manifest_sha256 !== manifestSha256
  )
    fail("PAGE_RECEIPT_INVALID");
  if (receipt.outcome === "exact_identities_deleted" && !isSha(receipt.deleted_identity_sha256))
    fail("PAGE_RECEIPT_INVALID");
  if (
    receipt.outcome === "independently_absent_after_unknown_write" &&
    receipt.deleted_identity_sha256 !== undefined
  )
    fail("PAGE_RECEIPT_INVALID");
  if (
    !new Set(["exact_identities_deleted", "independently_absent_after_unknown_write"]).has(
      receipt.outcome,
    )
  )
    fail("PAGE_RECEIPT_INVALID");
  return receipt;
}

export function validateWithdrawnReceipt(receipt, { dataset, original, manifestSha256 }) {
  const expectedAfter = {
    ...original,
    ready: false,
    metadata: { ...original.metadata, ready: false, owner_removal_scope: "openus-cpsc-20261005" },
  };
  const actualAfter = receipt?.after ? { ...receipt.after, updated_at: original.updated_at } : null;
  if (
    receipt?.dataset !== dataset ||
    !isDeepStrictEqual(receipt.before, original) ||
    receipt.manifest_sha256 !== manifestSha256 ||
    !isDeepStrictEqual(actualAfter, expectedAfter) ||
    !isIsoDate(receipt?.after?.updated_at)
  )
    fail("WITHDRAWAL_RECEIPT_INVALID");
  return receipt;
}

export function validateCompletionReceipt(receipt, { dataset, expectedRows, manifestSha256 }) {
  if (
    receipt?.dataset !== dataset ||
    receipt.deleted_rows !== expectedRows ||
    receipt.catalog_removed !== true ||
    receipt.manifest_sha256 !== manifestSha256 ||
    !new Set([undefined, "independently_absent_after_unknown_catalog_delete"]).has(
      receipt.outcome,
    ) ||
    !isIsoDate(receipt.completed_at)
  )
    fail("COMPLETION_RECEIPT_INVALID");
  return receipt;
}

export function validateCatalogDeleteIntent(intent, { dataset, withdrawn, manifestSha256 }) {
  if (
    intent?.dataset !== dataset ||
    intent.manifest_sha256 !== manifestSha256 ||
    !isDeepStrictEqual(intent.before, withdrawn.after) ||
    !isIsoDate(intent.prepared_at)
  )
    fail("CATALOG_DELETE_INTENT_INVALID");
  return intent;
}

async function save(file, value) {
  const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
  const handle = await fs.open(file, "wx");
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function readJson(file, code) {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") fail(code);
    if (error instanceof SyntaxError) fail(code);
    throw error;
  }
}

async function fileExists(file) {
  try {
    await fs.access(file);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

async function validateReceiptDirectory(receiptsDir, dataset, pageCount) {
  let names;
  try {
    names = await fs.readdir(receiptsDir);
  } catch (error) {
    if (error.code === "ENOENT") return;
    throw error;
  }
  const recognized = new Set([
    `${dataset}-complete.json`,
    `${dataset}-withdrawn.json`,
    `${dataset}-catalog-delete.intent`,
  ]);
  for (const name of names) {
    if (!name.startsWith(`${dataset}-`)) continue;
    const pageMatch = new RegExp(`^${dataset}-(\\d{4})\\.json(?:\\.intent)?$`).exec(name);
    if (pageMatch) {
      const page = Number(pageMatch[1]);
      if (page < 1 || page > pageCount) fail("UNEXPECTED_RECEIPT_FILE");
      recognized.add(name);
      continue;
    }
    if (!recognized.has(name)) fail("UNEXPECTED_RECEIPT_FILE");
  }
}

async function validateManifestFiles(root, manifest, datasets) {
  const catalogReceipt = manifest.before_images.catalog;
  const catalogBytes = await readBackupFile(root, catalogReceipt.file, "CATALOG_PATH_INVALID");
  if (
    sha(catalogBytes) !== catalogReceipt.sha256 ||
    (catalogReceipt.bytes !== undefined && catalogBytes.length !== catalogReceipt.bytes)
  )
    fail("CATALOG_RECOVERY_HASH_MISMATCH");
  let catalog;
  try {
    catalog = JSON.parse(catalogBytes.toString("utf8"));
  } catch {
    fail("CATALOG_RECOVERY_JSON_INVALID");
  }
  if (!Array.isArray(catalog)) fail("CATALOG_RECOVERY_JSON_INVALID");
  const byId = new Map(
    catalog.filter((row) => datasets.includes(row?.id)).map((row) => [row.id, row]),
  );
  if (byId.size !== datasets.length) fail("CATALOG_RECOVERY_MISSING");
  for (const dataset of datasets) {
    if (byId.get(dataset)?.imported_records !== TARGETS[dataset]) fail("CATALOG_COUNT_MISMATCH");
    const state = manifest.datasets[dataset];
    for (const page of state.pages) {
      const [rawBytes, gzipBytes] = await Promise.all([
        readBackupFile(root, page.file, "PAGE_PATH_INVALID"),
        readBackupFile(root, page.gzip_file, "PAGE_PATH_INVALID"),
      ]);
      validateRecoveryPage(dataset, page, rawBytes, gzipBytes);
    }
  }
  return catalog;
}

async function acquireLock(file) {
  const handle = await fs.open(file, "wx");
  const bytes = Buffer.from(
    `${JSON.stringify({ pid: process.pid, started_at: new Date().toISOString() })}\n`,
  );
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } catch (error) {
    await handle.close();
    await fs.unlink(file).catch(() => {});
    throw error;
  }
  return async () => {
    await handle.close();
    await fs.unlink(file);
  };
}

async function loadCredentials() {
  const cfg = JSON.parse(await fs.readFile(CREDENTIALS_FILE, "utf8"));
  if (
    cfg.EXTERNAL_SUPABASE_URL !== `https://${PROJECT}.supabase.co` ||
    typeof cfg.EXTERNAL_SUPABASE_KEY !== "string" ||
    !cfg.EXTERNAL_SUPABASE_KEY
  )
    fail("WRONG_PROJECT");
  return cfg;
}

async function executeRemoval({
  selected,
  manifest,
  manifestBytes,
  root,
  catalog,
  restClient = rest,
  fetcher = fetch,
  cfg,
  concurrency = 1,
}) {
  const manifestSha256 = sha(manifestBytes);
  const receiptsDir = path.join(BASE, "collection-removal-receipts");
  await fs.mkdir(receiptsDir, { recursive: true });
  const count = async (dataset) => {
    const result = await restClient(`corpus_records?dataset=eq.${dataset}&select=id&limit=1`, {
      prefer: "count=exact",
    });
    const raw = result.headers.get("content-range")?.split("/")[1];
    const n = Number(raw);
    if (!Number.isSafeInteger(n) || n < 0) fail("EXACT_DATASET_COUNT_REQUIRED");
    return n;
  };
  const queryCatalog = async (dataset) =>
    (await restClient(`corpus_datasets?id=eq.${dataset}&select=*`)).data;
  const mutate = async (route, method, body, max) => {
    const key = cfg.EXTERNAL_SUPABASE_KEY;
    const response = await fetcher(`${cfg.EXTERNAL_SUPABASE_URL}/rest/v1/${route}`, {
      method,
      headers: {
        apikey: key,
        ...(key.startsWith("sb_") ? {} : { Authorization: `Bearer ${key}` }),
        "Content-Type": "application/json",
        Prefer: `handling=strict,max-affected=${max},return=representation`,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: "error",
      signal: AbortSignal.timeout(60_000),
    });
    const text = await response.text();
    let data;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      fail(`MUTATION_NON_JSON_${response.status}`);
    }
    if (!response.ok)
      fail(
        `MUTATION_HTTP_${response.status}_${String(data?.code ?? "UNKNOWN").replace(/[^A-Z0-9_]/gi, "")}`,
      );
    if (!response.headers.get("preference-applied")?.includes(`max-affected=${max}`))
      fail("MAX_AFFECTED_NOT_ACKNOWLEDGED");
    return data;
  };

  for (const dataset of selected) {
    const state = manifest.datasets[dataset];
    await validateReceiptDirectory(receiptsDir, dataset, state.pages.length);
    const original = catalog.find((row) => row.id === dataset);
    const doneFile = path.join(receiptsDir, `${dataset}-complete.json`);
    if (!original) fail("CATALOG_RECOVERY_MISSING");
    const withdrawnFile = path.join(receiptsDir, `${dataset}-withdrawn.json`);
    const hasWithdrawn = await fileExists(withdrawnFile);
    const withdrawn = hasWithdrawn
      ? validateWithdrawnReceipt(await readJson(withdrawnFile, "WITHDRAWAL_RECEIPT_INVALID"), {
          dataset,
          original,
          manifestSha256,
        })
      : null;
    let allPagesReceipted = true;
    let receiptsValidated = 0;
    for (const page of state.pages) {
      const expected = validateRecoveryPage(
        dataset,
        page,
        await readBackupFile(root, page.file, "PAGE_PATH_INVALID"),
        await readBackupFile(root, page.gzip_file, "PAGE_PATH_INVALID"),
      );
      const identitySha = sha(Buffer.from(JSON.stringify(expected)));
      const receiptFile = path.join(
        receiptsDir,
        `${dataset}-${String(page.page).padStart(4, "0")}.json`,
      );
      const intentFile = `${receiptFile}.intent`;
      const hasIntent = await fileExists(intentFile);
      const hasReceipt = await fileExists(receiptFile);
      if (!hasReceipt) {
        allPagesReceipted = false;
        if (hasIntent)
          validatePageIntent(await readJson(intentFile, "PAGE_INTENT_INVALID"), {
            dataset,
            page,
            manifestSha256,
            identitySha,
          });
      } else {
        const intent = validatePageIntent(await readJson(intentFile, "PAGE_INTENT_INVALID"), {
          dataset,
          page,
          manifestSha256,
          identitySha,
        });
        validatePageReceipt(await readJson(receiptFile, "PAGE_RECEIPT_INVALID"), {
          dataset,
          page,
          manifestSha256,
          identitySha,
          intent,
        });
      }
      receiptsValidated++;
      if (receiptsValidated % 50 === 0)
        console.error(
          JSON.stringify({
            phase: "receipt_validation",
            dataset,
            pages: receiptsValidated,
            total_pages: state.pages.length,
          }),
        );
    }
    const catalogDeleteIntentFile = path.join(receiptsDir, `${dataset}-catalog-delete.intent`);
    const hasCatalogDeleteIntent = await fileExists(catalogDeleteIntentFile);
    if (hasCatalogDeleteIntent) {
      if (!withdrawn) fail("WITHDRAWAL_RECEIPT_INVALID");
      validateCatalogDeleteIntent(
        await readJson(catalogDeleteIntentFile, "CATALOG_DELETE_INTENT_INVALID"),
        {
          dataset,
          withdrawn,
          manifestSha256,
        },
      );
    }
    if (await fileExists(doneFile)) {
      validateCompletionReceipt(await readJson(doneFile, "COMPLETION_RECEIPT_INVALID"), {
        dataset,
        expectedRows: TARGETS[dataset],
        manifestSha256,
      });
      if (!withdrawn || !hasCatalogDeleteIntent || !allPagesReceipted)
        fail("COMPLETION_RECEIPTS_INCOMPLETE");
      if ((await queryCatalog(dataset)).length !== 0 || (await count(dataset)) !== 0)
        fail("COMPLETED_DATASET_REAPPEARED");
      continue;
    }

    let current = await queryCatalog(dataset);
    if (current.length === 0) {
      if (!withdrawn || !hasCatalogDeleteIntent || !allPagesReceipted)
        fail("CATALOG_MISSING_WITHOUT_COMPLETE_INTENT");
      if ((await count(dataset)) !== 0) fail("CATALOG_MISSING_WITH_ROWS_REMAIN");
      await save(doneFile, {
        dataset,
        deleted_rows: TARGETS[dataset],
        catalog_removed: true,
        completed_at: new Date().toISOString(),
        manifest_sha256: manifestSha256,
        outcome: "independently_absent_after_unknown_catalog_delete",
      });
      continue;
    }
    if (current.length !== 1) fail("TARGET_CATALOG_DUPLICATE");

    let activeWithdrawn = withdrawn;
    if (await fileExists(withdrawnFile)) {
      if (!isDeepStrictEqual(current[0], activeWithdrawn.after)) fail("WITHDRAWN_CATALOG_CHANGED");
    } else if (current[0].metadata?.owner_removal_scope !== "openus-cpsc-20261005") {
      if (!isDeepStrictEqual(current[0], original) || (await count(dataset)) !== TARGETS[dataset])
        fail("TARGET_CHANGED_BEFORE_REMOVAL");
      const expectedAfter = {
        ...original,
        ready: false,
        metadata: {
          ...original.metadata,
          ready: false,
          owner_removal_scope: "openus-cpsc-20261005",
        },
      };
      const patched = await mutate(
        `corpus_datasets?id=eq.${dataset}&updated_at=eq.${encodeURIComponent(original.updated_at)}`,
        "PATCH",
        { ready: false, metadata: expectedAfter.metadata },
        1,
      );
      const returned = Array.isArray(patched) ? patched[0] : null;
      if (
        !Array.isArray(patched) ||
        patched.length !== 1 ||
        !returned ||
        !isIsoDate(returned.updated_at) ||
        !isDeepStrictEqual({ ...returned, updated_at: original.updated_at }, expectedAfter)
      )
        fail("WITHDRAWAL_ACK_MISMATCH");
      activeWithdrawn = {
        dataset,
        before: original,
        after: returned,
        manifest_sha256: manifestSha256,
      };
      await save(withdrawnFile, activeWithdrawn);
      current = [returned];
    } else {
      fail("WITHDRAWAL_RECEIPT_MISSING");
    }

    let processedPages = 0;
    let processedRows = 0;
    const reportPageProgress = (page) => {
      processedPages++;
      processedRows += page.rows;
      if (processedPages % 50 === 0)
        console.error(
          JSON.stringify({
            phase: "removal",
            dataset,
            pages: processedPages,
            total_pages: state.pages.length,
            rows: processedRows,
          }),
        );
    };
    const removePage = async (page) => {
      const expected = validateRecoveryPage(
        dataset,
        page,
        await readBackupFile(root, page.file, "PAGE_PATH_INVALID"),
        await readBackupFile(root, page.gzip_file, "PAGE_PATH_INVALID"),
      );
      const identitySha = sha(Buffer.from(JSON.stringify(expected)));
      const receiptFile = path.join(
        receiptsDir,
        `${dataset}-${String(page.page).padStart(4, "0")}.json`,
      );
      const intentFile = `${receiptFile}.intent`;
      const query = deleteQuery(dataset, page);
      const live = await restClient(`corpus_records?${query}&order=id.asc&limit=1000`, {
        prefer: "count=exact",
      });
      const countRaw = live.headers.get("content-range")?.split("/")[1];
      const liveCount = Number(countRaw);
      if (!Number.isSafeInteger(liveCount) || liveCount < 0) fail("EXACT_PAGE_COUNT_REQUIRED");
      if (await fileExists(receiptFile)) {
        const existingIntent = await readJson(intentFile, "PAGE_INTENT_INVALID");
        const existingReceipt = validatePageReceipt(
          await readJson(receiptFile, "PAGE_RECEIPT_INVALID"),
          {
            dataset,
            page,
            manifestSha256,
            identitySha,
            intent: existingIntent,
          },
        );
        void existingReceipt;
        if (liveCount !== 0 || !Array.isArray(live.data) || live.data.length !== 0)
          fail("RECEIPTED_PAGE_REAPPEARED");
        reportPageProgress(page);
        return;
      }
      if (liveCount === 0 && (await fileExists(intentFile))) {
        const intent = validatePageIntent(await readJson(intentFile, "PAGE_INTENT_INVALID"), {
          dataset,
          page,
          manifestSha256,
          identitySha,
        });
        await save(receiptFile, {
          dataset,
          page: page.page,
          rows: page.rows,
          recovery_sha256: page.raw_sha256,
          identity_sha256: identitySha,
          manifest_sha256: manifestSha256,
          outcome: "independently_absent_after_unknown_write",
        });
        validatePageReceipt(await readJson(receiptFile, "PAGE_RECEIPT_INVALID"), {
          dataset,
          page,
          manifestSha256,
          identitySha,
          intent,
        });
        reportPageProgress(page);
        return;
      }
      if (
        liveCount !== expected.length ||
        !Array.isArray(live.data) ||
        !isDeepStrictEqual(live.data, expected)
      )
        fail("LIVE_PAGE_IDENTITIES_CHANGED");
      if (!(await fileExists(intentFile)))
        await save(intentFile, {
          dataset,
          page: page.page,
          rows: page.rows,
          recovery_sha256: page.raw_sha256,
          identity_sha256: identitySha,
          manifest_sha256: manifestSha256,
        });
      const intent = validatePageIntent(await readJson(intentFile, "PAGE_INTENT_INVALID"), {
        dataset,
        page,
        manifestSha256,
        identitySha,
      });
      const deleted = await mutate(`corpus_records?${query}`, "DELETE", undefined, page.rows);
      const sortedDeleted = Array.isArray(deleted)
        ? deleted.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
        : null;
      if (!Array.isArray(sortedDeleted) || !isDeepStrictEqual(sortedDeleted, expected))
        fail("DELETED_IDENTITY_ACK_MISMATCH");
      const receipt = {
        dataset,
        page: page.page,
        rows: page.rows,
        recovery_sha256: page.raw_sha256,
        identity_sha256: identitySha,
        manifest_sha256: manifestSha256,
        deleted_identity_sha256: sha(Buffer.from(JSON.stringify(sortedDeleted))),
        outcome: "exact_identities_deleted",
      };
      validatePageReceipt(receipt, { dataset, page, manifestSha256, identitySha, intent });
      await save(receiptFile, receipt);
      reportPageProgress(page);
    };
    await runBoundedPageWorkers(
      state.pages,
      dataset === "open_us_law" ? concurrency : 1,
      removePage,
    );

    if ((await count(dataset)) !== 0) fail("TARGET_ROWS_REMAIN");
    current = await queryCatalog(dataset);
    if (current.length !== 1 || !isDeepStrictEqual(current[0], activeWithdrawn.after))
      fail("CATALOG_CHANGED_BEFORE_DELETE");
    const deleteIntentFile = path.join(receiptsDir, `${dataset}-catalog-delete.intent`);
    if (!(await fileExists(deleteIntentFile)))
      await save(deleteIntentFile, {
        dataset,
        before: current[0],
        manifest_sha256: manifestSha256,
        prepared_at: new Date().toISOString(),
      });
    validateCatalogDeleteIntent(await readJson(deleteIntentFile, "CATALOG_DELETE_INTENT_INVALID"), {
      dataset,
      withdrawn: activeWithdrawn,
      manifestSha256,
    });
    const gone = await mutate(
      `corpus_datasets?id=eq.${dataset}&updated_at=eq.${encodeURIComponent(current[0].updated_at)}`,
      "DELETE",
      undefined,
      1,
    );
    if (!Array.isArray(gone) || gone.length !== 1 || gone[0].id !== dataset)
      fail("CATALOG_DELETE_ACK_MISMATCH");
    await save(doneFile, {
      dataset,
      deleted_rows: TARGETS[dataset],
      catalog_removed: true,
      completed_at: new Date().toISOString(),
      manifest_sha256: manifestSha256,
    });
  }
}

export async function validateRecoveryManifestFile(manifestPath, manifestSha256, selectedDatasets) {
  const privateRoot = await fs.realpath("private");
  const realManifest = await fs.realpath(manifestPath);
  const relativeManifest = path.relative(privateRoot, realManifest);
  if (!relativeManifest || relativeManifest.startsWith("..") || path.isAbsolute(relativeManifest))
    fail("PRIVATE_MANIFEST_REQUIRED");
  const manifestBytes = await fs.readFile(realManifest);
  if (sha(manifestBytes) !== manifestSha256) fail("EXACT_MANIFEST_HASH_REQUIRED");
  let manifest;
  try {
    manifest = JSON.parse(manifestBytes.toString("utf8"));
  } catch {
    fail("BACKUP_MANIFEST_JSON_INVALID");
  }
  const selected = parseDatasetSelection(selectedDatasets.join(","));
  validateManifestEnvelope(manifest, selected);
  const root = path.dirname(realManifest);
  const catalog = await validateManifestFiles(root, manifest, selected);
  return { manifest, manifestBytes, root, catalog, selected };
}

export async function runRemoval({
  manifestPath,
  manifestSha256,
  datasets,
  execute = false,
  concurrency = 1,
  restClient = rest,
  fetcher = fetch,
  base = BASE,
  credentialsLoader = loadCredentials,
} = {}) {
  const selected = parseDatasetSelection(datasets);
  if (!Number.isSafeInteger(concurrency) || concurrency < 1 || concurrency > 4)
    fail("CONCURRENCY_INVALID");
  if (execute !== true && manifestPath === undefined && manifestSha256 === undefined)
    return {
      state: "dry_run_only",
      datasets: selected,
      recovery_material_verified: false,
      remote_writes: 0,
    };
  if (typeof manifestPath !== "string" || !isSha(manifestSha256))
    fail("EXACT_MANIFEST_HASH_REQUIRED");
  const verified = await validateRecoveryManifestFile(manifestPath, manifestSha256, selected);
  if (execute !== true)
    return {
      state: "dry_run_only",
      datasets: selected,
      recovered_rows_verified: selected.reduce(
        (sum, dataset) => sum + verified.manifest.datasets[dataset].rows,
        0,
      ),
      manifest_sha256: manifestSha256,
      remote_writes: 0,
    };
  await fs.mkdir(base, { recursive: true });
  const releaseLock = await acquireLock(path.join(base, "collection-removal.lock"));
  try {
    // Credential loading is inside the lock-protected try/finally so every failure releases it.
    const cfg = await credentialsLoader();
    if (cfg.EXTERNAL_SUPABASE_URL !== `https://${PROJECT}.supabase.co`) fail("WRONG_PROJECT");
    await executeRemoval({ ...verified, restClient, fetcher, cfg, concurrency });
    return { state: "removal_complete", datasets: selected, remote_writes: "performed" };
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
    const match = /^--(manifest|manifest-sha256|datasets|concurrency)=(.+)$/.exec(arg);
    if (!match || Object.hasOwn(args, match[1])) fail("UNEXPECTED_ARGUMENT");
    args[match[1]] = match[2];
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const result = await runRemoval({
    manifestPath: args.manifest,
    manifestSha256: args["manifest-sha256"],
    datasets: args.datasets,
    concurrency: parseConcurrency(args.concurrency),
    execute: args.execute === true,
  });
  console.log(JSON.stringify(result));
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href)
  main().catch((error) => {
    console.error(
      /^[A-Z0-9_]+$/.test(error?.message ?? "")
        ? error.message
        : "OWNER_COLLECTION_REMOVAL_STOPPED",
    );
    process.exitCode = 1;
  });
