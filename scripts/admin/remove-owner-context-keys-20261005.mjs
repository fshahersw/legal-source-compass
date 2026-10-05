// Owner-authorized deletion of three verified OpenUS/CPSC-only corpus_context bundles.
// Mixed coverage/federal contexts and summary parts are excluded by exact key allowlist.
// Default mode verifies local before-images only; network writes require --execute.
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { pathToFileURL } from "node:url";
import { rest } from "../ingest/members-pgrest.mjs";

export const PROJECT = "xosqzzsnhxcyehcnirpa";
export const SNAPSHOT_PATH =
  "private/audit-2026-10-05/owner-removal-openus-cpsc/target-context-before.json";
export const SNAPSHOT_SHA256 = "cfd3d154ad3550b788e35cffcbaa0f52370ab8b9a70baedb1a55dfc7c982dc31";
export const TARGETS = Object.freeze({
  "supplement:cpsc_injury_data_20260919": Object.freeze({
    source_sha256: "e8d9b98e6c588e00b8953ad159772ec4db033968f665a7572916d185b1913d4d",
    name: "cpsc_injury_data_20260919",
    file: "cpsc_injury_data.sqlite3",
  }),
  "supplement:law_snapshot_audit_20260920": Object.freeze({
    source_sha256: "41aa70b00b6922600fe65cdc7c2e8178106021364014b81d19fcf41149df1365",
    name: "law_snapshot_audit_20260920",
    file: "statute_audit.json",
  }),
  "supplement:state_code_outline_20260919": Object.freeze({
    source_sha256: "dba068f82c4171b5007d24c5b00b94f7ba53c16b9ef58a1989570d63ecf65edd",
    name: "state_code_outline_20260919",
    file: "outline.sqlite3",
  }),
});
const RECEIPT_IDS = Object.freeze({
  "supplement:cpsc_injury_data_20260919": "cpsc-injury-data-20260919",
  "supplement:law_snapshot_audit_20260920": "law-snapshot-audit-20260920",
  "supplement:state_code_outline_20260919": "state-code-outline-20260919",
});
const BASE = path.resolve("private/audit-2026-10-05/owner-removal-openus-cpsc");
const sha256 = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");
const fail = (code) => {
  throw new Error(code);
};
const isSha = (value) => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const isIsoDate = (value) => typeof value === "string" && Number.isFinite(Date.parse(value));

export function validateTargetContextRow(row, key) {
  const expected = TARGETS[key];
  if (
    !expected ||
    row?.key !== key ||
    row.source_sha256 !== expected.source_sha256 ||
    row.ready !== expectedReady(key) ||
    row.data?.name !== expected.name ||
    row.data?.status !== "passed" ||
    !Array.isArray(row.data?.data_files) ||
    row.data.data_files.length !== 1 ||
    row.data.data_files[0]?.path !== expected.file ||
    row.data.data_files[0]?.verified !== true
  )
    fail("CONTEXT_TARGET_ROW_INVALID");
  if (key === "supplement:cpsc_injury_data_20260919") {
    if (
      row.data.counts?.neiss_cases !== 410201 ||
      row.data.counts?.saferproducts_incidents !== 69333 ||
      !String(row.data.license_ref).includes("CPSC")
    )
      fail("CONTEXT_TARGET_ROW_INVALID");
  } else if (row.data.license_ref !== "open_us_law_cc_by_4_0_compilation") {
    fail("CONTEXT_TARGET_ROW_INVALID");
  }
  return row;
}

function expectedReady(key) {
  return key === "supplement:cpsc_injury_data_20260919";
}

export function validateSnapshot(snapshot, bytes, pinnedSha = SNAPSHOT_SHA256) {
  if (!Buffer.isBuffer(bytes) || sha256(bytes) !== pinnedSha || pinnedSha !== SNAPSHOT_SHA256)
    fail("CONTEXT_SNAPSHOT_HASH_MISMATCH");
  if (!Array.isArray(snapshot) || snapshot.length !== 449) fail("CONTEXT_SNAPSHOT_SHAPE_INVALID");
  const byKey = new Map();
  for (const row of snapshot) {
    if (typeof row?.key !== "string" || byKey.has(row.key)) fail("CONTEXT_SNAPSHOT_DUPLICATE_KEY");
    byKey.set(row.key, row);
  }
  const targets = {};
  for (const key of Object.keys(TARGETS)) {
    targets[key] = validateTargetContextRow(byKey.get(key), key);
  }
  return targets;
}

export function targetBeforeImageSha(row) {
  return sha256(Buffer.from(JSON.stringify(row)));
}

export function validateIntent(intent, expected) {
  if (
    intent?.key !== expected.key ||
    intent.source_sha256 !== expected.sourceSha256 ||
    intent.beforeimage_sha256 !== expected.beforeImageSha256 ||
    intent.snapshot_sha256 !== expected.snapshotSha256 ||
    !isIsoDate(intent.prepared_at)
  )
    fail("CONTEXT_DELETE_INTENT_INVALID");
  return intent;
}

export function validateReceipt(receipt, expected) {
  if (
    receipt?.key !== expected.key ||
    receipt.source_sha256 !== expected.sourceSha256 ||
    receipt.beforeimage_sha256 !== expected.beforeImageSha256 ||
    receipt.snapshot_sha256 !== expected.snapshotSha256 ||
    !new Set(["exact_identity_deleted", "independently_absent_after_unknown_write"]).has(
      receipt.outcome,
    ) ||
    (receipt.outcome === "exact_identity_deleted" && !isIsoDate(receipt.completed_at)) ||
    (receipt.outcome === "independently_absent_after_unknown_write" &&
      !isIsoDate(receipt.confirmed_at))
  )
    fail("CONTEXT_DELETE_RECEIPT_INVALID");
  return receipt;
}

export function deleteRoute(key, sourceSha) {
  if (!Object.hasOwn(TARGETS, key) || !isSha(sourceSha) || sourceSha !== TARGETS[key].source_sha256)
    fail("CONTEXT_DELETE_SCOPE_INVALID");
  return `corpus_context?key=eq.${encodeURIComponent(key)}&source_sha256=eq.${sourceSha}`;
}

export function receiptStem(key) {
  const stem = RECEIPT_IDS[key];
  if (!stem) fail("CONTEXT_DELETE_SCOPE_INVALID");
  return stem;
}

async function readLocalSnapshot(snapshotPath, snapshotSha) {
  const privateRoot = await fs.realpath("private");
  const real = await fs.realpath(snapshotPath);
  const rel = path.relative(privateRoot, real);
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) fail("PRIVATE_SNAPSHOT_REQUIRED");
  const bytes = await fs.readFile(real);
  if (snapshotSha !== SNAPSHOT_SHA256 || sha256(bytes) !== snapshotSha)
    fail("CONTEXT_SNAPSHOT_HASH_MISMATCH");
  let snapshot;
  try {
    snapshot = JSON.parse(bytes.toString("utf8"));
  } catch {
    fail("CONTEXT_SNAPSHOT_JSON_INVALID");
  }
  const rows = validateSnapshot(snapshot, bytes, snapshotSha);
  return { bytes, snapshotSha, rows };
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

async function readJson(file, code) {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT" || error instanceof SyntaxError) fail(code);
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

async function acquireLock(file) {
  const handle = await fs.open(file, "wx");
  const marker = Buffer.from(
    `${JSON.stringify({ pid: process.pid, started_at: new Date().toISOString() })}\n`,
  );
  try {
    await handle.writeFile(marker);
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
  const cfg = JSON.parse(
    await fs.readFile("C:/Users/firas/.codex/private/legal-source-compass.preview.json", "utf8"),
  );
  if (
    cfg.EXTERNAL_SUPABASE_URL !== `https://${PROJECT}.supabase.co` ||
    typeof cfg.EXTERNAL_SUPABASE_KEY !== "string" ||
    !cfg.EXTERNAL_SUPABASE_KEY
  )
    fail("WRONG_PROJECT");
  return cfg;
}

async function exactRow(restClient, key) {
  const result = await restClient(`corpus_context?key=eq.${encodeURIComponent(key)}&select=*`);
  if (!Array.isArray(result.data)) fail("CONTEXT_LIVE_READ_INVALID");
  if (result.data.length > 1) fail("CONTEXT_TARGET_DUPLICATE");
  return result.data[0] ?? null;
}

async function executeRemoval({ rows, snapshotSha, restClient, fetcher, cfg, base }) {
  const receiptDir = path.join(base, "owner-context-removal-receipts");
  await fs.mkdir(receiptDir, { recursive: true });
  const names = await fs.readdir(receiptDir);
  const allowedNames = new Set(
    Object.keys(TARGETS).flatMap((key) => {
      const stem = receiptStem(key);
      return [`${stem}.intent.json`, `${stem}.receipt.json`];
    }),
  );
  if (names.some((name) => !allowedNames.has(name))) fail("UNEXPECTED_CONTEXT_RECEIPT_FILE");

  for (const key of Object.keys(TARGETS)) {
    const before = rows[key];
    const sourceSha = before.source_sha256;
    const beforeImageSha = targetBeforeImageSha(before);
    const expected = {
      key,
      sourceSha256: sourceSha,
      beforeImageSha256: beforeImageSha,
      snapshotSha256: snapshotSha,
    };
    const stem = receiptStem(key);
    const intentPath = path.join(receiptDir, `${stem}.intent.json`);
    const receiptPath = path.join(receiptDir, `${stem}.receipt.json`);
    const hasIntent = await exists(intentPath);
    const hasReceipt = await exists(receiptPath);
    if (hasReceipt) {
      const intent = validateIntent(
        await readJson(intentPath, "CONTEXT_DELETE_INTENT_INVALID"),
        expected,
      );
      validateReceipt(await readJson(receiptPath, "CONTEXT_DELETE_RECEIPT_INVALID"), expected);
      void intent;
      const current = await exactRow(restClient, key);
      if (current !== null) fail("CONTEXT_RECEIPTED_ROW_REAPPEARED");
      continue;
    }

    const current = await exactRow(restClient, key);
    if (current === null) {
      if (!hasIntent) fail("CONTEXT_ROW_ABSENT_WITHOUT_INTENT");
      validateIntent(await readJson(intentPath, "CONTEXT_DELETE_INTENT_INVALID"), expected);
      await saveExclusive(receiptPath, {
        key,
        source_sha256: sourceSha,
        beforeimage_sha256: beforeImageSha,
        snapshot_sha256: snapshotSha,
        outcome: "independently_absent_after_unknown_write",
        confirmed_at: new Date().toISOString(),
      });
      validateReceipt(await readJson(receiptPath, "CONTEXT_DELETE_RECEIPT_INVALID"), expected);
      continue;
    }
    if (!isDeepStrictEqual(current, before)) fail("CONTEXT_LIVE_BEFOREIMAGE_MISMATCH");
    if (!hasIntent) {
      await saveExclusive(intentPath, {
        key,
        source_sha256: sourceSha,
        beforeimage_sha256: beforeImageSha,
        snapshot_sha256: snapshotSha,
        prepared_at: new Date().toISOString(),
      });
    }
    validateIntent(await readJson(intentPath, "CONTEXT_DELETE_INTENT_INVALID"), expected);
    const response = await fetcher(
      `${cfg.EXTERNAL_SUPABASE_URL}/rest/v1/${deleteRoute(key, sourceSha)}`,
      {
        method: "DELETE",
        headers: {
          apikey: cfg.EXTERNAL_SUPABASE_KEY,
          ...(cfg.EXTERNAL_SUPABASE_KEY.startsWith("sb_")
            ? {}
            : { Authorization: `Bearer ${cfg.EXTERNAL_SUPABASE_KEY}` }),
          "Content-Type": "application/json",
          Prefer: "handling=strict,max-affected=1,return=representation",
        },
        redirect: "error",
        signal: AbortSignal.timeout(60_000),
      },
    );
    let deleted;
    try {
      deleted = await response.json();
    } catch {
      fail(`CONTEXT_DELETE_NON_JSON_${response.status}`);
    }
    if (!response.ok) fail(`CONTEXT_DELETE_HTTP_${response.status}`);
    if (!response.headers.get("preference-applied")?.includes("max-affected=1"))
      fail("CONTEXT_MAX_AFFECTED_NOT_ACKNOWLEDGED");
    if (!Array.isArray(deleted) || deleted.length !== 1 || !isDeepStrictEqual(deleted[0], before))
      fail("CONTEXT_DELETE_ACK_MISMATCH");
    const receipt = {
      key,
      source_sha256: sourceSha,
      beforeimage_sha256: beforeImageSha,
      snapshot_sha256: snapshotSha,
      outcome: "exact_identity_deleted",
      completed_at: new Date().toISOString(),
    };
    validateReceipt(receipt, expected);
    await saveExclusive(receiptPath, receipt);
    if ((await exactRow(restClient, key)) !== null) fail("CONTEXT_DELETE_NOT_INDEPENDENTLY_ABSENT");
  }
}

export async function runRemoval({
  snapshotPath = SNAPSHOT_PATH,
  snapshotSha256,
  execute = false,
  restClient = rest,
  fetcher = fetch,
  credentialsLoader = loadCredentials,
  base = BASE,
} = {}) {
  if (!isSha(snapshotSha256)) fail("EXACT_SNAPSHOT_HASH_REQUIRED");
  const local = await readLocalSnapshot(snapshotPath, snapshotSha256);
  if (execute !== true)
    return {
      state: "dry_run_only",
      snapshot_sha256: snapshotSha256,
      target_keys: Object.keys(TARGETS),
      remote_writes: 0,
    };
  await fs.mkdir(base, { recursive: true });
  const releaseLock = await acquireLock(path.join(base, "owner-context-removal.lock"));
  try {
    const cfg = await credentialsLoader();
    if (cfg.EXTERNAL_SUPABASE_URL !== `https://${PROJECT}.supabase.co`) fail("WRONG_PROJECT");
    await executeRemoval({
      rows: local.rows,
      snapshotSha: local.snapshotSha,
      restClient,
      fetcher,
      cfg,
      base,
    });
    return {
      state: "context_removal_complete",
      target_keys: Object.keys(TARGETS),
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
    const match = /^--(snapshot|snapshot-sha256)=(.+)$/.exec(arg);
    if (!match || Object.hasOwn(args, match[1])) fail("UNEXPECTED_ARGUMENT");
    args[match[1]] = match[2];
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const result = await runRemoval({
    snapshotPath: args.snapshot ?? SNAPSHOT_PATH,
    snapshotSha256: args["snapshot-sha256"],
    execute: args.execute === true,
  });
  console.log(JSON.stringify(result));
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href)
  main().catch((error) => {
    console.error(
      /^[A-Z0-9_]+$/.test(error?.message ?? "") ? error.message : "OWNER_CONTEXT_REMOVAL_STOPPED",
    );
    process.exitCode = 1;
  });
