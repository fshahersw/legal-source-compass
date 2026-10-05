// Removes only exact, reviewed owner-selected objects; matter PDFs and app dependencies are protected.
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { createClient } from "@supabase/supabase-js";
const PROJECT = "xosqzzsnhxcyehcnirpa",
  BUCKET = "corpus-originals";
const BASE = path.resolve("private/audit-2026-10-05/owner-removal-openus-cpsc");
const sha = (b) => crypto.createHash("sha256").update(b).digest("hex");
export function validatePlan(plan) {
  if (
    plan.schema !== "owner-storage-removal-plan/v1" ||
    plan.inventory?.project !== PROJECT ||
    plan.inventory?.bucket !== BUCKET ||
    !Array.isArray(plan.eligible) ||
    !Array.isArray(plan.protected)
  )
    throw Error("PLAN_TARGET_INVALID");
  const keys = new Set(),
    ids = new Set();
  for (const o of [...plan.protected, ...plan.eligible]) {
    if (
      o.bucket_id !== BUCKET ||
      typeof o.key !== "string" ||
      !o.key ||
      typeof o.id !== "string" ||
      !o.id ||
      typeof o.version !== "string" ||
      !o.version ||
      !Number.isSafeInteger(o.bytes) ||
      o.bytes < 0 ||
      keys.has(o.key) ||
      ids.has(o.id)
    )
      throw Error("PLAN_OBJECT_INVALID");
    keys.add(o.key);
    ids.add(o.id);
  }
  for (const o of plan.eligible)
    if (
      o.key.startsWith("seeger-weiss/pdf-sha256/") ||
      o.key.startsWith("state-codes/") ||
      o.key.startsWith("legal-authority-raw/") ||
      !Array.isArray(o.reasons) ||
      o.reasons.length ||
      o.is_delete_marker !== false ||
      o.archived_at
    )
      throw Error("PROTECTED_OBJECT_ELIGIBLE");
  for (const [kind, rows] of [
    ["eligible", plan.eligible],
    ["protected", plan.protected],
  ])
    if (
      plan.totals?.[kind]?.objects !== rows.length ||
      plan.totals?.[kind]?.bytes !== rows.reduce((s, o) => s + o.bytes, 0)
    )
      throw Error("PLAN_TOTAL_INVALID");
  if (plan.totals?.storage_objects !== keys.size || plan.totals?.missing_dependencies !== 0)
    throw Error("PLAN_DEPENDENCIES_MISSING");
  return true;
}
export function validateMaxAffected(plan, value) {
  if (!/^\d+$/.test(String(value ?? "")) || Number(value) !== plan.eligible.length)
    throw Error("EXACT_MAX_AFFECTED_REQUIRED");
  return true;
}
export function assertCurrentObject(want, actual) {
  if (
    !actual ||
    actual.name !== want.key ||
    actual.id !== want.id ||
    actual.version !== want.version ||
    Number(actual.metadata?.size) !== want.bytes ||
    actual.is_delete_marker ||
    actual.archived_at
  )
    throw Error("OBJECT_CHANGED_SINCE_PLAN");
}
export function groupPrefix(key) {
  const p = key.split("/");
  if (p.length < 2) throw Error("OBJECT_KEY_WITHOUT_PREFIX");
  return p.slice(0, Math.min(p.length - 1, 3)).join("/") + "/";
}
export function groupedBatches(plan, maxRows = 250) {
  const groups = new Map();
  for (const object of plan.eligible) {
    const prefix = groupPrefix(object.key);
    if (!groups.has(prefix)) groups.set(prefix, []);
    groups.get(prefix).push(object);
  }
  return [...groups.entries()].flatMap(([prefix, objects]) => {
    const batches = [];
    for (let i = 0; i < objects.length; i += maxRows)
      batches.push({ prefix, batch: objects.slice(i, i + maxRows) });
    return batches;
  });
}
export async function validateResumeScope({ plan, planHash, current, receiptsDirectory }) {
  const plannedKeys = new Set([...plan.protected, ...plan.eligible].map((object) => object.key));
  if ([...current.keys()].some((key) => !plannedKeys.has(key)))
    throw Error("UNPLANNED_STORAGE_OBJECT_FOUND");
  for (const object of plan.protected) assertCurrentObject(object, current.get(object.key));
  for (const { batch } of groupedBatches(plan)) {
    const batchHash = sha(JSON.stringify(batch));
    const receipt = path.join(receiptsDirectory, `${batchHash}.json`);
    const prior = await maybe(receipt),
      intent = await maybe(`${receipt}.intent`);
    const state = classifyBatchState({
      prior,
      intent,
      planHash,
      batchHash,
      batch,
      currentKeys: new Set(current.keys()),
    });
    for (const object of state.remaining) assertCurrentObject(object, current.get(object.key));
  }
  return true;
}
export async function verifyPlanOutputLists(plan, directory) {
  const expected = {
    eligible: "eligible-objects.jsonl",
    protected: "protected-objects.jsonl",
    ambiguous_pdfs: "ambiguous-pdf-objects.jsonl",
  };
  for (const [kind, file] of Object.entries(expected)) {
    const ref = plan.output_lists?.[kind];
    if (
      !ref ||
      ref.file !== file ||
      !Number.isSafeInteger(ref.rows) ||
      ref.rows < 0 ||
      !Number.isSafeInteger(ref.bytes) ||
      ref.bytes < 0 ||
      !/^[a-f0-9]{64}$/.test(ref.sha256 ?? "")
    )
      throw Error("PLAN_OUTPUT_REFERENCE_INVALID");
    const listedPath = path.join(directory, file),
      stat = await fs.lstat(listedPath);
    if (stat.isSymbolicLink()) throw Error("PLAN_OUTPUT_PATH_SYMLINK");
    const root = await fs.realpath(directory),
      real = await fs.realpath(listedPath),
      relative = path.relative(root, real);
    if (relative.startsWith("..") || path.isAbsolute(relative))
      throw Error("PLAN_OUTPUT_PATH_ESCAPE");
    const bytes = await fs.readFile(real);
    if (bytes.length !== ref.bytes || sha(bytes) !== ref.sha256)
      throw Error("PLAN_OUTPUT_HASH_MISMATCH");
    const lines = bytes.toString("utf8").split("\n");
    if (lines.at(-1) !== "" || lines.slice(0, -1).some((line) => !line))
      throw Error("PLAN_OUTPUT_JSONL_INVALID");
    const rows = lines.slice(0, -1).map((line) => JSON.parse(line));
    if (rows.length !== ref.rows) throw Error("PLAN_OUTPUT_ROW_COUNT_MISMATCH");
    if (
      (kind === "eligible" && ref.rows !== plan.totals?.eligible?.objects) ||
      (kind === "protected" && ref.rows !== plan.totals?.protected?.objects) ||
      (kind === "ambiguous_pdfs" && ref.rows !== plan.totals?.ambiguous_pdf_objects)
    )
      throw Error("PLAN_OUTPUT_TOTAL_MISMATCH");
    if (Array.isArray(plan[kind])) {
      if (
        plan[kind].length !== rows.length ||
        rows.some((row, i) => !isDeepStrictEqual(row, plan[kind][i]))
      )
        throw Error("PLAN_OUTPUT_CONTENT_MISMATCH");
    } else if ((kind === "eligible" || kind === "protected") && plan[kind]?.objects !== rows.length)
      throw Error("PLAN_OUTPUT_CONTENT_MISSING");
  }
  return true;
}
export function classifyBatchState({ prior, intent, planHash, batchHash, batch, currentKeys }) {
  const bytes = batch.reduce((sum, row) => sum + row.bytes, 0);
  if (
    intent &&
    (intent.plan_sha256 !== planHash ||
      intent.batch_sha256 !== batchHash ||
      !isDeepStrictEqual(intent.objects, batch))
  )
    throw Error("STORAGE_INTENT_CONFLICT");
  if (prior) {
    if (
      prior.plan_sha256 !== planHash ||
      prior.batch_sha256 !== batchHash ||
      prior.objects !== batch.length ||
      prior.bytes !== bytes ||
      batch.some((o) => currentKeys.has(o.key))
    )
      throw Error("PRIOR_STORAGE_RECEIPT_INVALID");
    return { state: "already_complete", remaining: [] };
  }
  if (!intent && batch.some((o) => !currentKeys.has(o.key)))
    throw Error("UNEXPECTED_OBJECT_ABSENCE");
  return { state: "delete", remaining: batch.filter((o) => currentKeys.has(o.key)) };
}
export async function deleteBatchOnce({ url, headers, objects, fetcher = fetch }) {
  const response = await fetcher(url, {
    method: "DELETE",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ prefixes: objects.map((o) => o.key) }),
    redirect: "error",
    signal: AbortSignal.timeout(60000),
  });
  if (!response.ok) throw Error(`STORAGE_DELETE_HTTP_${response.status}`);
  const ack = await response.json(),
    expected = new Set(objects.map((o) => `${o.key}\0${o.id}`)),
    received = new Set();
  if (
    !Array.isArray(ack) ||
    ack.length !== objects.length ||
    ack.some((a) => {
      const k = `${a?.name}\0${a?.id}`;
      if (!expected.has(k) || received.has(k)) return true;
      received.add(k);
      return false;
    }) ||
    received.size !== expected.size
  )
    throw Error("STORAGE_DELETE_ACK_MISMATCH");
  return ack;
}
async function save(file, data) {
  const b = Buffer.from(JSON.stringify(data));
  const h = await fs.open(file, "wx");
  try {
    await h.writeFile(b);
    await h.sync();
  } finally {
    await h.close();
  }
  return sha(b);
}
async function maybe(file) {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch (e) {
    if (e.code === "ENOENT") return null;
    throw e;
  }
}
async function main() {
  const pairs = process.argv.slice(2).map((x) => {
    const raw = x.replace(/^--/, ""),
      i = raw.indexOf("=");
    return i < 0 ? [raw, true] : [raw.slice(0, i), raw.slice(i + 1)];
  });
  if (new Set(pairs.map(([k]) => k)).size !== pairs.length) throw Error("DUPLICATE_ARGUMENT");
  const args = Object.fromEntries(pairs);
  if (
    Object.keys(args).some((k) => !["plan", "plan-sha256", "execute", "max-affected"].includes(k))
  )
    throw Error("UNEXPECTED_ARGUMENT");
  if ("execute" in args && args.execute !== true) throw Error("EXECUTE_FLAG_MUST_NOT_HAVE_VALUE");
  const baseReal = await fs.realpath(BASE),
    privateReal = await fs.realpath("private"),
    baseRel = path.relative(privateReal, baseReal);
  if (!baseRel || baseRel.startsWith("..") || path.isAbsolute(baseRel))
    throw Error("PRIVATE_BACKUP_ROOT_REQUIRED");
  const planPath = await fs.realpath(String(args.plan ?? ""));
  if (!planPath.startsWith(baseReal + path.sep)) throw Error("PRIVATE_PLAN_REQUIRED");
  const bytes = await fs.readFile(planPath),
    planHash = sha(bytes);
  if (planHash !== args["plan-sha256"]) throw Error("EXACT_PLAN_HASH_REQUIRED");
  const plan = JSON.parse(bytes);
  validatePlan(plan);
  await verifyPlanOutputLists(plan, path.dirname(planPath));
  if (args.execute) validateMaxAffected(plan, args["max-affected"]);
  if (!args.execute) {
    console.log(
      JSON.stringify({
        plan_verified: true,
        objects: plan.eligible.length,
        bytes: plan.totals.eligible.bytes,
        remote_writes: 0,
      }),
    );
    return;
  }
  const receipts = path.join(baseReal, "storage-removal-receipts");
  await fs.mkdir(receipts, { recursive: true });
  const receiptsReal = await fs.realpath(receipts),
    receiptRel = path.relative(baseReal, receiptsReal);
  if (receiptRel.startsWith("..") || path.isAbsolute(receiptRel))
    throw Error("RECEIPT_PATH_ESCAPE");
  const lockPath = path.join(baseReal, "storage-removal.lock"),
    lockBytes = Buffer.from(
      JSON.stringify({
        pid: process.pid,
        started_at: new Date().toISOString(),
        plan_sha256: planHash,
      }) + "\n",
    );
  let lock = null,
    lockCreated = false;
  try {
    lock = await fs.open(lockPath, "wx");
    await lock.writeFile(lockBytes);
    await lock.sync();
    await lock.close();
    lock = null;
    lockCreated = true;
    const cfg = JSON.parse(
      await fs.readFile("C:/Users/firas/.codex/private/legal-source-compass.preview.json", "utf8"),
    );
    if (cfg.EXTERNAL_SUPABASE_URL !== `https://${PROJECT}.supabase.co`)
      throw Error("WRONG_PROJECT");
    const storage = createClient(cfg.EXTERNAL_SUPABASE_URL, cfg.EXTERNAL_SUPABASE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    }).storage.from(BUCKET);
    const list = async (prefix) => {
      let cursor;
      const rows = new Map();
      do {
        const { data, error } = await storage.listV2(
          { prefix, limit: 1000, with_delimiter: false, ...(cursor ? { cursor } : {}) },
          { signal: AbortSignal.timeout(60000) },
        );
        if (error || !data || data.folders.length) throw Error("STORAGE_PREFLIGHT_FAILED");
        for (const o of data.objects) {
          if (!o.name.startsWith(prefix) || rows.has(o.name)) throw Error("STORAGE_LIST_INVALID");
          rows.set(o.name, o);
        }
        if (data.hasNext && (!data.nextCursor || data.nextCursor === cursor))
          throw Error("STORAGE_CURSOR_INVALID");
        cursor = data.hasNext ? data.nextCursor : null;
      } while (cursor);
      return rows;
    };
    // Every object we protect must still exist with exactly the recorded identity/version.
    const current = await list("");
    await validateResumeScope({ plan, planHash, current, receiptsDirectory: receipts });
    const localManifest = JSON.parse(
        await fs.readFile("src/lib/private-data/manifest.server.json", "utf8"),
      ),
      oldManifestBytes = await fs.readFile(
        path.join(baseReal, "inventory-v1", "app-manifest-before.json"),
      );
    const oldManifestReceipt = plan.inventory?.verified_pages?.app_manifest;
    if (
      !oldManifestReceipt ||
      oldManifestReceipt.bytes !== oldManifestBytes.length ||
      oldManifestReceipt.sha256 !== sha(oldManifestBytes)
    )
      throw Error("APP_MANIFEST_BEFORE_IMAGE_HASH_MISMATCH");
    const oldManifest = JSON.parse(oldManifestBytes.toString("utf8"));
    if (!isDeepStrictEqual(localManifest, oldManifest)) throw Error("APP_MANIFEST_CHANGED");
    const protectedKeys = new Set(plan.protected.map((o) => o.key));
    // Recheck every live ready download route immediately before deleting any bytes.
    let routeAfter = "";
    for (;;) {
      const q = new URLSearchParams({
        select: "route,object_key",
        ready: "eq.true",
        order: "route.asc",
        limit: "1000",
        ...(routeAfter ? { route: `gt.${routeAfter}` } : {}),
      });
      const r = await fetch(`${cfg.EXTERNAL_SUPABASE_URL}/rest/v1/corpus_artifacts?${q}`, {
        headers: {
          apikey: cfg.EXTERNAL_SUPABASE_KEY,
          ...(cfg.EXTERNAL_SUPABASE_KEY.startsWith("sb_")
            ? {}
            : { Authorization: `Bearer ${cfg.EXTERNAL_SUPABASE_KEY}` }),
        },
        signal: AbortSignal.timeout(60000),
        redirect: "error",
      });
      if (!r.ok) throw Error("READY_ARTIFACT_PREFLIGHT_FAILED");
      const rows = await r.json();
      if (!Array.isArray(rows)) throw Error("READY_ARTIFACT_SHAPE");
      if (!rows.length) break;
      for (const a of rows)
        if (!protectedKeys.has(a.object_key)) throw Error("NEW_WORKING_DEPENDENCY_FOUND");
      const nextRoute = rows.at(-1)?.route;
      if (typeof nextRoute !== "string" || !nextRoute || nextRoute <= routeAfter)
        throw Error("READY_ARTIFACT_CURSOR_INVALID");
      routeAfter = nextRoute;
    }
    const groups = new Map();
    for (const { prefix, batch } of groupedBatches(plan)) {
      if (!groups.has(prefix)) groups.set(prefix, []);
      groups.get(prefix).push(...batch);
    }
    let deleted = 0,
      deletedBytes = 0;
    for (const [prefix, objects] of groups) {
      const fresh = await list(prefix);
      for (let i = 0; i < objects.length; i += 250) {
        const batch = objects.slice(i, i + 250),
          batchHash = sha(JSON.stringify(batch)),
          file = path.join(receipts, `${batchHash}.json`),
          intentPath = file + ".intent";
        const prior = await maybe(file),
          intent = await maybe(intentPath);
        const state = classifyBatchState({
          prior,
          intent,
          planHash,
          batchHash,
          batch,
          currentKeys: new Set(fresh.keys()),
        });
        if (state.state === "already_complete") {
          deleted += batch.length;
          deletedBytes += prior.bytes;
          continue;
        }
        const remaining = state.remaining;
        for (const o of remaining) assertCurrentObject(o, fresh.get(o.key));
        if (!intent)
          await save(intentPath, {
            plan_sha256: planHash,
            batch_sha256: batchHash,
            objects: batch,
            created_at: new Date().toISOString(),
          });
        if (remaining.length) {
          // Official Storage API, no automatic retry of an unknown deletion outcome.
          await deleteBatchOnce({
            url: `${cfg.EXTERNAL_SUPABASE_URL}/storage/v1/object/${BUCKET}`,
            headers: {
              apikey: cfg.EXTERNAL_SUPABASE_KEY,
              ...(cfg.EXTERNAL_SUPABASE_KEY.startsWith("sb_")
                ? {}
                : { Authorization: `Bearer ${cfg.EXTERNAL_SUPABASE_KEY}` }),
            },
            objects: remaining,
          });
        }
        const absent = await list(prefix);
        if (batch.some((o) => absent.has(o.key))) throw Error("STORAGE_OBJECT_REMAINS");
        const removedBytes = batch.reduce((s, o) => s + o.bytes, 0);
        await save(file, {
          plan_sha256: planHash,
          batch_sha256: batchHash,
          objects: batch.length,
          bytes: removedBytes,
          verified_absent_at: new Date().toISOString(),
        });
        deleted += batch.length;
        deletedBytes += removedBytes;
      }
      if (deleted % 1000 < objects.length)
        console.log(JSON.stringify({ deleted_objects: deleted, deleted_bytes: deletedBytes }));
    }
    const final = await list("");
    for (const p of plan.protected) assertCurrentObject(p, final.get(p.key));
    const protectedKeySet = new Set(plan.protected.map((object) => object.key));
    if (
      final.size !== protectedKeySet.size ||
      plan.protected.some((o) => !final.has(o.key)) ||
      [...final.keys()].some((key) => !protectedKeySet.has(key))
    )
      throw Error("FINAL_STORAGE_SCOPE_MISMATCH");
    const remainingBytes = [...final.values()].reduce(
      (sum, object) => sum + Number(object.metadata.size),
      0,
    );
    if (
      deleted !== plan.eligible.length ||
      deletedBytes !== plan.totals.eligible.bytes ||
      remainingBytes !== plan.totals.protected.bytes
    )
      throw Error("FINAL_STORAGE_TOTAL_MISMATCH");
    await save(path.join(receipts, "complete.json"), {
      complete: true,
      plan_sha256: planHash,
      deleted_objects: deleted,
      deleted_bytes: deletedBytes,
      protected_objects_verified: plan.protected.length,
      remaining_objects: final.size,
      remaining_bytes: remainingBytes,
      completed_at: new Date().toISOString(),
    });
    console.log(
      JSON.stringify({
        complete: true,
        deleted_objects: deleted,
        deleted_bytes: deletedBytes,
        protected_objects_verified: plan.protected.length,
      }),
    );
  } finally {
    if (lock) await lock.close();
    if (lockCreated) {
      const currentLock = await fs.readFile(lockPath);
      if (!currentLock.equals(lockBytes)) throw Error("REMOVAL_LOCK_OWNERSHIP_CHANGED");
      await fs.unlink(lockPath);
    }
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href)
  main().catch((e) => {
    console.error(/^[A-Z0-9_]+$/.test(e.message) ? e.message : "OWNER_STORAGE_REMOVAL_STOPPED");
    process.exitCode = 1;
  });
