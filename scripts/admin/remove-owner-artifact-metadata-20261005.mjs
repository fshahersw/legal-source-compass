#!/usr/bin/env node
// Prepare an exact held corpus_artifacts metadata-removal plan; later execution is
// gated on a complete storage-removal receipt and exact live-row readback.
// The task that created this utility did not invoke --execute or contact Supabase.
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { pathToFileURL } from "node:url";
import { createClient } from "@supabase/supabase-js";

const PROJECT = "xosqzzsnhxcyehcnirpa";
const BUCKET = "corpus-originals";
const MAX_AFFECTED_ROWS = 50_000;
const DELETE_KEY_BATCH = 40;
const BASE = path.resolve("private/audit-2026-10-05/owner-removal-openus-cpsc");
const INVENTORY = path.join(BASE, "inventory-v1");
const STORAGE_PLAN = path.join(BASE, "storage-plan-v1/storage-plan-v1.json");
const OUT = path.join(BASE, "artifact-metadata-plan-v1");
const ROW_FIELDS = ["route", "sha256", "object_key", "bytes", "mime", "filename", "ready"];
const sha256 = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");

function fail(code) {
  throw new Error(code);
}
function canonical(row) {
  return JSON.stringify(Object.fromEntries(ROW_FIELDS.map((key) => [key, row[key] ?? null])));
}
export function selectHeldArtifactRows(artifacts, eligibleStorageKeys) {
  const eligible =
    eligibleStorageKeys instanceof Set ? eligibleStorageKeys : new Set(eligibleStorageKeys);
  const rows = [];
  const seenRoutes = new Set();
  for (const row of artifacts) {
    if (
      !row ||
      typeof row.route !== "string" ||
      !row.route ||
      typeof row.object_key !== "string" ||
      !row.object_key
    )
      fail("ARTIFACT_ROW_INVALID");
    if (seenRoutes.has(row.route)) fail("DUPLICATE_ARTIFACT_ROUTE");
    seenRoutes.add(row.route);
    if (eligible.has(row.object_key) && row.ready === true) fail("ELIGIBLE_KEY_HAS_READY_ARTIFACT");
    if (eligible.has(row.object_key) && row.ready === false) {
      if (!Number.isSafeInteger(Number(row.bytes)) || Number(row.bytes) < 0)
        fail("ARTIFACT_BYTES_INVALID");
      rows.push(Object.fromEntries(ROW_FIELDS.map((key) => [key, row[key] ?? null])));
    }
  }
  return rows.sort((a, b) => a.route.localeCompare(b.route));
}
export function validateArtifactPlan(plan, { maxAffected = MAX_AFFECTED_ROWS } = {}) {
  if (
    plan?.schema !== "owner-artifact-metadata-removal-plan/v1" ||
    plan.project !== PROJECT ||
    plan.bucket !== BUCKET
  )
    fail("ARTIFACT_PLAN_TARGET_INVALID");
  if (!Number.isSafeInteger(maxAffected) || maxAffected < 1 || maxAffected > MAX_AFFECTED_ROWS)
    fail("MAX_AFFECTED_INVALID");
  if (
    !Array.isArray(plan.selected_rows) ||
    plan.selected_rows.length !== plan.selected_row_count ||
    plan.selected_rows.length > maxAffected
  )
    fail("ARTIFACT_PLAN_ROW_LIMIT");
  const routes = new Set();
  const keys = new Set(plan.eligible_storage_keys);
  for (const row of plan.selected_rows) {
    if (!row || Object.keys(row).sort().join(",") !== [...ROW_FIELDS].sort().join(","))
      fail("ARTIFACT_BEFOREIMAGE_SHAPE_INVALID");
    if (row.ready !== false || !keys.has(row.object_key) || !row.route || routes.has(row.route))
      fail("ARTIFACT_BEFOREIMAGE_SCOPE_INVALID");
    if (!Number.isSafeInteger(row.bytes) || row.bytes < 0)
      fail("ARTIFACT_BEFOREIMAGE_BYTES_INVALID");
    routes.add(row.route);
  }
  if (
    !/^[a-f0-9]{64}$/.test(plan.storage_plan_sha256 ?? "") ||
    !/^[a-f0-9]{64}$/.test(plan.artifact_rows_sha256 ?? "")
  )
    fail("ARTIFACT_PLAN_HASH_INVALID");
  return true;
}
export function assertFullRowEquality(expectedRows, actualRows) {
  const expected = new Map(expectedRows.map((row) => [row.route, canonical(row)]));
  if (expected.size !== expectedRows.length) fail("EXPECTED_ARTIFACT_ROUTES_DUPLICATE");
  if (!Array.isArray(actualRows) || actualRows.length !== expected.size)
    fail("LIVE_ARTIFACT_ROW_COUNT_CHANGED");
  const seen = new Set();
  for (const row of actualRows) {
    if (!row || typeof row.route !== "string" || seen.has(row.route))
      fail("LIVE_ARTIFACT_ROUTE_INVALID");
    seen.add(row.route);
    const want = expected.get(row.route);
    if (want === undefined || canonical(row) !== want) fail("LIVE_ARTIFACT_ROW_CHANGED");
  }
  return true;
}
export function requireStorageCompletion(
  proof,
  storagePlan,
  expectedPlanSha,
  suppliedSha,
  actualBytes,
) {
  if (
    !suppliedSha ||
    sha256(actualBytes) !== suppliedSha ||
    !proof ||
    proof.plan_sha256 !== expectedPlanSha
  )
    fail("STORAGE_COMPLETION_PROOF_INVALID");
  if (
    proof.complete !== true ||
    proof.deleted_objects !== storagePlan.totals?.eligible?.objects ||
    proof.protected_objects_verified !== storagePlan.totals?.protected?.objects
  )
    fail("STORAGE_COMPLETION_INCOMPLETE");
  return true;
}
export function strictDeletePreference(maxAffected) {
  if (!Number.isSafeInteger(maxAffected) || maxAffected < 1 || maxAffected > MAX_AFFECTED_ROWS)
    fail("MAX_AFFECTED_INVALID");
  return `handling=strict,return=representation,max-affected=${maxAffected}`;
}
export function assertStrictDeleteAck(preferenceApplied, expectedRows, actualRows) {
  const applied = String(preferenceApplied ?? "")
    .toLowerCase()
    .split(",")
    .map((x) => x.trim());
  if (
    !applied.includes("handling=strict") ||
    !applied.includes("return=representation") ||
    !applied.includes(`max-affected=${expectedRows.length}`)
  )
    fail("DELETE_PREFERENCES_NOT_APPLIED");
  assertFullRowEquality(expectedRows, actualRows);
  return true;
}
export function assertPriorBatchReceipt(receipt, expected) {
  if (
    !receipt ||
    receipt.plan_sha256 !== expected.planSha ||
    receipt.batch_sha256 !== expected.batchSha ||
    receipt.deleted_rows !== expected.rowCount ||
    receipt.object_keys?.join("\0") !== expected.keys.join("\0") ||
    receipt.verified_absent !== true
  )
    fail("PRIOR_BATCH_RECEIPT_INVALID");
  return true;
}

async function verifiedFile(file, entry) {
  const bytes = await fs.readFile(file);
  if (bytes.length !== entry.bytes || sha256(bytes) !== entry.sha256)
    fail("INVENTORY_PAGE_INTEGRITY_MISMATCH");
  return bytes;
}
async function loadInventoryArtifacts(manifest) {
  const out = [];
  for (const page of manifest.artifacts.pages ?? []) {
    const bytes = await verifiedFile(path.join(INVENTORY, page.file), page);
    const rows = JSON.parse(bytes.toString("utf8"));
    if (!Array.isArray(rows)) fail("ARTIFACT_PAGE_SHAPE_INVALID");
    out.push(...rows);
  }
  if (out.length !== manifest.artifacts.rows) fail("ARTIFACT_PAGE_ROW_TOTAL_INVALID");
  return out;
}
async function readPlanInputs() {
  const inventoryBytes = await fs.readFile(path.join(INVENTORY, "manifest.json"));
  const inventoryManifest = JSON.parse(inventoryBytes.toString("utf8"));
  if (inventoryManifest.project !== PROJECT || inventoryManifest.bucket !== BUCKET)
    fail("INVENTORY_TARGET_INVALID");
  const schemaBytes = await verifiedFile(
    path.join(INVENTORY, inventoryManifest.rest_schema.file),
    inventoryManifest.rest_schema,
  );
  const restSchema = JSON.parse(schemaBytes.toString("utf8"));
  const artifactProperties = Object.keys(
    restSchema.definitions?.corpus_artifacts?.properties ?? {},
  ).sort();
  if (artifactProperties.join(",") !== [...ROW_FIELDS].sort().join(","))
    fail("ARTIFACT_SCHEMA_FIELD_SET_CHANGED");
  const storageBytes = await fs.readFile(STORAGE_PLAN);
  const storagePlan = JSON.parse(storageBytes.toString("utf8"));
  if (
    storagePlan.inventory?.project !== PROJECT ||
    storagePlan.inventory?.bucket !== BUCKET ||
    storagePlan.inventory?.manifest_sha256 !== sha256(inventoryBytes)
  )
    fail("STORAGE_PLAN_INVENTORY_MISMATCH");
  if (
    !Array.isArray(storagePlan.eligible) ||
    !Array.isArray(storagePlan.protected) ||
    storagePlan.totals?.missing_dependencies !== 0
  )
    fail("STORAGE_PLAN_INCOMPLETE");
  const artifactRows = await loadInventoryArtifacts(inventoryManifest);
  const eligibleKeys = storagePlan.eligible.map((row) => {
    if (
      row.bucket_id !== BUCKET ||
      typeof row.key !== "string" ||
      !row.key ||
      !row.id ||
      !row.version ||
      !Number.isSafeInteger(row.bytes)
    )
      fail("STORAGE_ELIGIBLE_ROW_INVALID");
    return row.key;
  });
  const protectedKeys = new Set(storagePlan.protected.map((row) => row.key));
  if (
    eligibleKeys.some((key) => protectedKeys.has(key)) ||
    new Set(eligibleKeys).size !== eligibleKeys.length
  )
    fail("STORAGE_PLAN_KEY_PARTITION_INVALID");
  return {
    inventoryManifest,
    inventoryManifestSha256: sha256(inventoryBytes),
    storagePlan,
    storagePlanBytes: storageBytes,
    storagePlanSha256: sha256(storageBytes),
    artifactRows,
    eligibleKeys,
    restSchemaSha256: sha256(schemaBytes),
  };
}
async function writeNew(file, bytes) {
  const handle = await fs.open(file, "wx");
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }
}
async function preparePlan() {
  const input = await readPlanInputs();
  const selectedRows = selectHeldArtifactRows(input.artifactRows, new Set(input.eligibleKeys));
  if (selectedRows.length > MAX_AFFECTED_ROWS) fail("MAX_AFFECTED_HARD_CAP_EXCEEDED");
  const rowBuffer = Buffer.from(
    selectedRows.map((row) => JSON.stringify(row)).join("\n") + (selectedRows.length ? "\n" : ""),
  );
  const plan = {
    schema: "owner-artifact-metadata-removal-plan/v1",
    created_at: new Date().toISOString(),
    project: PROJECT,
    bucket: BUCKET,
    mode: "prepared_only_no_remote_calls",
    storage_plan_path:
      "private/audit-2026-10-05/owner-removal-openus-cpsc/storage-plan-v1/storage-plan-v1.json",
    storage_plan_sha256: input.storagePlanSha256,
    storage_completion_required: true,
    inventory_manifest_sha256: input.inventoryManifestSha256,
    artifact_schema_sha256: input.restSchemaSha256,
    artifact_page_refs: input.inventoryManifest.artifacts.pages,
    artifact_rows_beforeimage_file: "held-artifact-beforeimages.jsonl",
    artifact_rows_sha256: sha256(rowBuffer),
    artifact_rows_bytes: rowBuffer.length,
    artifact_rows_manifest_count: input.artifactRows.length,
    eligible_storage_key_count: input.eligibleKeys.length,
    eligible_storage_keys: input.eligibleKeys,
    selected_row_count: selectedRows.length,
    max_affected_rows: MAX_AFFECTED_ROWS,
    delete_object_key_batch_size: DELETE_KEY_BATCH,
    selected_rows: selectedRows,
    execution: { storage_completion_receipt_sha256: null, remote_deletes: 0, status: "not_run" },
  };
  validateArtifactPlan(plan);
  await fs.mkdir(OUT, { recursive: false });
  await writeNew(
    path.join(OUT, "artifact-removal-plan-v1.json"),
    Buffer.from(JSON.stringify(plan, null, 2) + "\n"),
  );
  await writeNew(path.join(OUT, "held-artifact-beforeimages.jsonl"), rowBuffer);
  await writeNew(
    path.join(OUT, "inventory-artifact-page-refs.json"),
    Buffer.from(
      JSON.stringify(
        {
          inventory_manifest_sha256: input.inventoryManifestSha256,
          artifact_rows: input.artifactRows.length,
          pages: input.inventoryManifest.artifacts.pages,
        },
        null,
        2,
      ) + "\n",
    ),
  );
  console.log(
    JSON.stringify(
      {
        prepared: true,
        selected_rows: selectedRows.length,
        unique_storage_keys: new Set(selectedRows.map((r) => r.object_key)).size,
        max_affected_rows: MAX_AFFECTED_ROWS,
        remote_writes: 0,
        output: OUT,
      },
      null,
      2,
    ),
  );
}

function parseArgs(argv) {
  const args = {};
  for (const token of argv) {
    if (!token.startsWith("--")) fail("ARGUMENT_INVALID");
    const [key, ...parts] = token.slice(2).split("=");
    if (Object.hasOwn(args, key)) fail("ARGUMENT_DUPLICATE");
    args[key] = parts.length ? parts.join("=") : true;
  }
  for (const key of Object.keys(args))
    if (
      !new Set([
        "prepare",
        "execute",
        "max-affected",
        "plan-sha256",
        "storage-completion",
        "storage-completion-sha256",
      ]).has(key)
    )
      fail("ARGUMENT_UNEXPECTED");
  return args;
}
function normalizeLiveRow(row) {
  return Object.fromEntries(ROW_FIELDS.map((key) => [key, row?.[key] ?? null]));
}
async function fetchRows(storage, keys) {
  const { data, error } = await storage
    .from("corpus_artifacts")
    .select("*")
    .in("object_key", keys)
    .abortSignal(AbortSignal.timeout(60000));
  if (error || !Array.isArray(data)) fail("ARTIFACT_READBACK_FAILED");
  return data.map(normalizeLiveRow);
}
async function deleteRowsOnce({ url, key }, keys, expectedRows) {
  const quoted = keys
    .map((value) => `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`)
    .join(",");
  const query = new URLSearchParams({
    object_key: `in.(${quoted})`,
    ready: "eq.false",
    select: "*",
  });
  const headers = {
    apikey: key,
    Accept: "application/json",
    Prefer: strictDeletePreference(expectedRows.length),
  };
  if (!key.startsWith("sb_")) headers.Authorization = `Bearer ${key}`;
  let response;
  try {
    response = await fetch(`${url}/rest/v1/corpus_artifacts?${query}`, {
      method: "DELETE",
      headers,
      redirect: "error",
      signal: AbortSignal.timeout(60000),
    });
  } catch {
    fail("ARTIFACT_DELETE_UNKNOWN_OR_FAILED");
  }
  if (!response.ok) fail(`ARTIFACT_DELETE_HTTP_${response.status}`);
  let rows;
  try {
    rows = await response.json();
  } catch {
    fail("ARTIFACT_DELETE_RESPONSE_INVALID");
  }
  if (!Array.isArray(rows)) fail("ARTIFACT_DELETE_RESPONSE_INVALID");
  assertStrictDeleteAck(
    response.headers.get("preference-applied"),
    expectedRows,
    rows.map(normalizeLiveRow),
  );
  return rows;
}
async function saveReceipt(file, body) {
  await writeNew(file, Buffer.from(JSON.stringify(body, null, 2) + "\n"));
}
async function readReceipt(file) {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}
async function executePlan(args) {
  const maxAffected = Number(args["max-affected"]);
  if (
    args["max-affected"] === undefined ||
    !Number.isSafeInteger(maxAffected) ||
    maxAffected < 1 ||
    maxAffected > MAX_AFFECTED_ROWS
  )
    fail("MAX_AFFECTED_REQUIRED");
  const planFile = path.join(OUT, "artifact-removal-plan-v1.json");
  const planBytes = await fs.readFile(planFile);
  const plan = JSON.parse(planBytes.toString("utf8"));
  if (!args["plan-sha256"] || sha256(planBytes) !== args["plan-sha256"])
    fail("EXACT_ARTIFACT_PLAN_HASH_REQUIRED");
  validateArtifactPlan(plan, { maxAffected });
  const planSha = sha256(planBytes);
  const currentInputs = await readPlanInputs();
  if (
    currentInputs.inventoryManifestSha256 !== plan.inventory_manifest_sha256 ||
    currentInputs.restSchemaSha256 !== plan.artifact_schema_sha256 ||
    currentInputs.storagePlanSha256 !== plan.storage_plan_sha256
  )
    fail("ARTIFACT_PLAN_INPUTS_CHANGED");
  const selectedNow = selectHeldArtifactRows(
    currentInputs.artifactRows,
    new Set(currentInputs.eligibleKeys),
  );
  assertFullRowEquality(plan.selected_rows, selectedNow);
  const completionPath = await fs.realpath(String(args["storage-completion"] ?? ""));
  if (!completionPath.startsWith((await fs.realpath(BASE)) + path.sep))
    fail("STORAGE_COMPLETION_PATH_NOT_PRIVATE");
  const completionBytes = await fs.readFile(completionPath);
  const completionSha = sha256(completionBytes);
  if (completionSha !== args["storage-completion-sha256"]) fail("STORAGE_COMPLETION_HASH_REQUIRED");
  const completion = JSON.parse(completionBytes.toString("utf8"));
  const storagePlanBytes = await fs.readFile(STORAGE_PLAN);
  const storagePlan = JSON.parse(storagePlanBytes.toString("utf8"));
  if (sha256(storagePlanBytes) !== plan.storage_plan_sha256) fail("STORAGE_PLAN_CHANGED");
  requireStorageCompletion(
    completion,
    storagePlan,
    plan.storage_plan_sha256,
    completionSha,
    completionBytes,
  );
  const beforeimageBytes = await fs.readFile(path.join(OUT, plan.artifact_rows_beforeimage_file));
  if (
    beforeimageBytes.length !== plan.artifact_rows_bytes ||
    sha256(beforeimageBytes) !== plan.artifact_rows_sha256
  )
    fail("ARTIFACT_BEFOREIMAGE_HASH_MISMATCH");
  const beforeRows = beforeimageBytes
    .toString("utf8")
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
    .map(JSON.parse);
  assertFullRowEquality(plan.selected_rows, beforeRows);
  if (plan.selected_rows.length > maxAffected) fail("MAX_AFFECTED_EXCEEDED");
  const attemptDir = path.join(OUT, `attempt-${planSha.slice(0, 16)}`);
  const otherAttempts = (await fs.readdir(OUT)).filter(
    (name) => name.startsWith("attempt-") && name !== path.basename(attemptDir),
  );
  if (otherAttempts.length) fail("PRIOR_ATTEMPT_OTHER_PLAN");
  try {
    await fs.mkdir(attemptDir, { recursive: false });
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
  }
  if (!(await fs.stat(attemptDir)).isDirectory()) fail("ATTEMPT_PATH_NOT_DIRECTORY");
  const lockPath = path.join(BASE, "artifact-metadata-removal.lock");
  const lock = await fs.open(lockPath, "wx");
  try {
    await lock.writeFile(
      JSON.stringify({
        pid: process.pid,
        started_at: new Date().toISOString(),
        plan_sha256: planSha,
      }),
    );
    const credentials = JSON.parse(
      await fs.readFile("C:/Users/firas/.codex/private/legal-source-compass.preview.json", "utf8"),
    );
    if (credentials.EXTERNAL_SUPABASE_URL !== `https://${PROJECT}.supabase.co`)
      fail("WRONG_PROJECT");
    const client = createClient(
      credentials.EXTERNAL_SUPABASE_URL,
      credentials.EXTERNAL_SUPABASE_KEY,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
    const selectedByKey = new Map();
    for (const row of plan.selected_rows) {
      if (!selectedByKey.has(row.object_key)) selectedByKey.set(row.object_key, []);
      selectedByKey.get(row.object_key).push(row);
    }
    const selectedKeys = [...selectedByKey.keys()];
    let removedRows = 0,
      removedKeys = 0,
      completedBatches = 0;
    const totalBatches = Math.ceil(selectedKeys.length / DELETE_KEY_BATCH);
    for (let start = 0; start < selectedKeys.length; start += DELETE_KEY_BATCH) {
      const keys = selectedKeys.slice(start, start + DELETE_KEY_BATCH);
      const expected = keys.flatMap((key) => selectedByKey.get(key));
      const batchId = sha256(Buffer.from(JSON.stringify(expected)));
      const intentPath = path.join(attemptDir, `${batchId}.intent.json`);
      const receiptPath = path.join(attemptDir, `${batchId}.receipt.json`);
      const intent = await readReceipt(intentPath);
      const prior = await readReceipt(receiptPath);
      if (prior) {
        assertPriorBatchReceipt(prior, {
          planSha,
          batchSha: batchId,
          keys,
          rowCount: expected.length,
        });
        const absentCheck = await fetchRows(client, keys);
        if (absentCheck.length) fail("PRIOR_RECEIPT_ROWS_REAPPEARED");
        removedRows += expected.length;
        removedKeys += keys.length;
        completedBatches++;
      } else {
        if (intent) {
          if (
            intent.plan_sha256 !== planSha ||
            intent.batch_sha256 !== batchId ||
            intent.object_keys?.join("\0") !== keys.join("\0")
          )
            fail("PRIOR_BATCH_INTENT_INVALID");
          assertFullRowEquality(expected, intent.before_rows ?? []);
          const state = await fetchRows(client, keys);
          if (state.length === 0) {
            await saveReceipt(receiptPath, {
              plan_sha256: planSha,
              batch_sha256: batchId,
              object_keys: keys,
              deleted_rows: expected.length,
              verified_absent: true,
              reconciliation: "absence_confirmed_after_interrupted_intent",
              verified_absent_at: new Date().toISOString(),
            });
            removedRows += expected.length;
            removedKeys += keys.length;
            completedBatches++;
          } else {
            assertFullRowEquality(expected, state);
            fail("UNRESOLVED_PRIOR_BATCH_INTENT");
          }
        } else {
          // One exact read immediately before mutation; no global pre-scan is needed.
          const fresh = await fetchRows(client, keys);
          assertFullRowEquality(expected, fresh);
          if (fresh.some((row) => row.ready !== false)) fail("READY_ARTIFACT_IN_DELETE_SET");
          await saveReceipt(intentPath, {
            plan_sha256: planSha,
            batch_sha256: batchId,
            object_keys: keys,
            before_rows: expected,
            created_at: new Date().toISOString(),
          });
          const deletedRows = await deleteRowsOnce(
            { url: credentials.EXTERNAL_SUPABASE_URL, key: credentials.EXTERNAL_SUPABASE_KEY },
            keys,
            expected,
          );
          const remaining = await fetchRows(client, keys);
          if (remaining.length) fail("ARTIFACT_DELETE_READBACK_NOT_ABSENT");
          await saveReceipt(receiptPath, {
            plan_sha256: planSha,
            batch_sha256: batchId,
            object_keys: keys,
            deleted_rows: deletedRows.length,
            verified_absent: true,
            verified_absent_at: new Date().toISOString(),
          });
          removedRows += deletedRows.length;
          removedKeys += keys.length;
          completedBatches++;
        }
      }
      if (completedBatches % 100 === 0 || completedBatches === totalBatches) {
        console.log(
          JSON.stringify({
            verified_batches: completedBatches,
            total_batches: totalBatches,
            deleted_rows: removedRows,
            deleted_object_keys: removedKeys,
          }),
        );
      }
    }
    const completePath = path.join(attemptDir, "complete.json");
    const priorComplete = await readReceipt(completePath);
    const completeBody = {
      complete: true,
      plan_sha256: planSha,
      storage_completion_sha256: completionSha,
      deleted_rows: removedRows,
      deleted_object_keys: removedKeys,
      completed_at: new Date().toISOString(),
    };
    if (priorComplete) {
      if (
        priorComplete.plan_sha256 !== planSha ||
        priorComplete.storage_completion_sha256 !== completionSha ||
        priorComplete.deleted_rows !== removedRows ||
        priorComplete.deleted_object_keys !== removedKeys
      )
        fail("PRIOR_COMPLETE_RECEIPT_INVALID");
    } else await saveReceipt(completePath, completeBody);
    console.log(
      JSON.stringify(
        {
          complete: true,
          deleted_rows: removedRows,
          deleted_object_keys: removedKeys,
          attempt_dir: attemptDir,
          plan_sha256: planSha,
        },
        null,
        2,
      ),
    );
  } finally {
    await lock.close();
    await fs.unlink(lockPath);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.prepare) {
    if (args.execute) fail("PREPARE_AND_EXECUTE_MUTUALLY_EXCLUSIVE");
    await preparePlan();
    return;
  }
  if (args.execute) return executePlan(args);
  fail("SPECIFY_PREPARE_OR_EXECUTE");
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    const allowed = /^[A-Z0-9_]+$/.test(error.message)
      ? error.message
      : "ARTIFACT_METADATA_REMOVAL_STOPPED";
    console.error(allowed);
    process.exitCode = 1;
  });
}
