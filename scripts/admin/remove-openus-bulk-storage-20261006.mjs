// Scoped Open US Law storage removal (bulk parquet + held large-text bytes).
// Requires the verified corpus-exports recovery manifest; deletes via the official Storage API only.
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";

const execFileAsync = promisify(execFile);
export const PROJECT = "xosqzzsnhxcyehcnirpa";
export const BUCKET = "corpus-originals";
export const EXPORT_BUCKET = "corpus-exports";
export const EXPORT_MANIFEST_KEY = "open-us-law-removal-2026-10-06/manifest.json";
export const PINNED_EXPORT_MANIFEST_SHA256 =
  "bf672ee098f2ad56baa397e63a3119702b5a9e09e2a7ecfa2efc2b6f7d1111d7";
export const PINNED_EXPORT_RECORD_ROWS = 2_968_623;
const BASE = path.resolve("private/audit-2026-10-06/open-us-law-storage-removal");
const HOST = `${PROJECT}.supabase.co`;
const RESOLVE_ARGS = ["--resolve", `${HOST}:443:104.18.38.10`];
const ARTIFACT_FIELDS = ["route", "sha256", "object_key", "bytes", "mime", "filename", "ready"];
const sha = (b) => crypto.createHash("sha256").update(b).digest("hex");
const fail = (code) => {
  throw new Error(code);
};

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
    fail("OBJECT_CHANGED_SINCE_PLAN");
}

export function groupPrefix(key) {
  const p = key.split("/");
  if (p.length < 2) fail("OBJECT_KEY_WITHOUT_PREFIX");
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

export function classifyBatchState({ prior, intent, planHash, batchHash, batch, currentKeys }) {
  const bytes = batch.reduce((sum, row) => sum + row.bytes, 0);
  if (
    intent &&
    (intent.plan_sha256 !== planHash ||
      intent.batch_sha256 !== batchHash ||
      !isDeepStrictEqual(intent.objects, batch))
  )
    fail("STORAGE_INTENT_CONFLICT");
  if (prior) {
    if (
      prior.plan_sha256 !== planHash ||
      prior.batch_sha256 !== batchHash ||
      prior.objects !== batch.length ||
      prior.bytes !== bytes ||
      batch.some((o) => currentKeys.has(o.key))
    )
      fail("PRIOR_STORAGE_RECEIPT_INVALID");
    return { state: "already_complete", remaining: [] };
  }
  if (!intent && batch.some((o) => !currentKeys.has(o.key))) fail("UNEXPECTED_OBJECT_ABSENCE");
  return { state: "delete", remaining: batch.filter((o) => currentKeys.has(o.key)) };
}

export async function deleteBatchOnce({ url, headers, objects, fetcher }) {
  const response = await fetcher(url, {
    method: "DELETE",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ prefixes: objects.map((o) => o.key) }),
  });
  if (!response.ok) fail(`STORAGE_DELETE_HTTP_${response.status}`);
  const ack = await response.json();
  const expected = new Set(objects.map((o) => `${o.key}\0${o.id}`));
  const received = new Set();
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
    fail("STORAGE_DELETE_ACK_MISMATCH");
  return ack;
}

function loadEnv() {
  const url = process.env.EXTERNAL_SUPABASE_URL;
  const key = process.env.EXTERNAL_SUPABASE_SERVICE_ROLE_KEY;
  if (url !== `https://${HOST}` || typeof key !== "string" || !key) fail("CORPUS_ENV_REQUIRED");
  return { url, key };
}

async function curlJson(method, urlPath, { key, body, prefer } = {}) {
  const { key: apiKey } = key ? { key } : loadEnv();
  const args = [
    "-sS",
    ...RESOLVE_ARGS,
    "-X",
    method,
    `https://${HOST}${urlPath}`,
    "-H",
    `apikey: ${apiKey}`,
    "-H",
    `Authorization: Bearer ${apiKey}`,
    "-H",
    "Content-Type: application/json",
  ];
  if (prefer) args.push("-H", `Prefer: ${prefer}`);
  if (body !== undefined) args.push("-d", JSON.stringify(body));
  const { stdout } = await execFileAsync("curl", args, { maxBuffer: 64 * 1024 * 1024 });
  if (!stdout) return null;
  try {
    return JSON.parse(stdout);
  } catch {
    return stdout;
  }
}

export function isOpenUsLawArtifactRow(row) {
  if (!row || row.ready !== false || typeof row.route !== "string" || typeof row.object_key !== "string")
    return false;
  if (row.route.startsWith("/bulk-files/us_")) return true;
  if (row.route.includes("oul:") || row.route.includes("oul%3A")) return true;
  return false;
}

export function validateOpenUsLawStoragePlan(plan) {
  if (
    plan?.schema !== "owner-openus-bulk-storage-removal/v1" ||
    plan.project !== PROJECT ||
    plan.bucket !== BUCKET ||
    plan.export_manifest_sha256 !== PINNED_EXPORT_MANIFEST_SHA256 ||
    plan.export_manifest_key !== EXPORT_MANIFEST_KEY ||
    plan.export_record_rows !== PINNED_EXPORT_RECORD_ROWS
  )
    fail("PLAN_TARGET_INVALID");
  if (!Array.isArray(plan.storage_objects) || !Array.isArray(plan.artifact_rows)) fail("PLAN_SHAPE_INVALID");
  const keys = new Set();
  for (const o of plan.storage_objects) {
    if (
      o.bucket_id !== BUCKET ||
      typeof o.key !== "string" ||
      !o.key ||
      typeof o.id !== "string" ||
      !o.id ||
      typeof o.version !== "string" ||
      !o.version ||
      (o.id === "absent") !== Boolean(o.already_absent) ||
      !Number.isSafeInteger(o.bytes) ||
      o.bytes < 0 ||
      keys.has(o.key)
    )
      fail("STORAGE_OBJECT_INVALID");
    if (
      o.key.startsWith("seeger-weiss/pdf-sha256/") ||
      o.key.startsWith("state-codes/") ||
      o.key.startsWith("legal-authority-raw/")
    )
      fail("PROTECTED_PREFIX_IN_PLAN");
    keys.add(o.key);
  }
  const routes = new Set();
  for (const row of plan.artifact_rows) {
    if (!isOpenUsLawArtifactRow(row) || routes.has(row.route)) fail("ARTIFACT_ROW_INVALID");
    if (!keys.has(row.object_key)) fail("ARTIFACT_KEY_NOT_IN_STORAGE_PLAN");
    routes.add(row.route);
  }
  if (
    plan.totals?.storage_objects !== plan.storage_objects.length ||
    plan.totals?.artifact_rows !== plan.artifact_rows.length ||
    plan.totals?.storage_bytes !== plan.storage_objects.reduce((s, o) => s + o.bytes, 0)
  )
    fail("PLAN_TOTAL_INVALID");
  return true;
}

export function validateMaxAffected(plan, value) {
  if (!/^\d+$/.test(String(value ?? "")) || Number(value) !== plan.artifact_rows.length)
    fail("EXACT_MAX_AFFECTED_REQUIRED");
  return true;
}

async function paginateArtifacts() {
  const { key } = loadEnv();
  const rows = [];
  let routeAfter = "";
  for (;;) {
    const q = new URLSearchParams({
      select: ARTIFACT_FIELDS.join(","),
      ready: "eq.false",
      order: "route.asc",
      limit: "1000",
      ...(routeAfter ? { route: `gt.${routeAfter}` } : {}),
    });
    const page = await curlJson("GET", `/rest/v1/corpus_artifacts?${q}`, { key });
    if (!Array.isArray(page)) fail("ARTIFACT_PAGE_INVALID");
    if (!page.length) break;
    for (const row of page) if (isOpenUsLawArtifactRow(row)) rows.push(row);
    const next = page.at(-1)?.route;
    if (typeof next !== "string" || !next || next <= routeAfter) fail("ARTIFACT_CURSOR_INVALID");
    routeAfter = next;
  }
  rows.sort((a, b) => a.route.localeCompare(b.route));
  return rows;
}

function storageObjectKey(prefix, listedName) {
  if (!listedName) fail("STORAGE_LIST_INVALID");
  if (listedName.includes("/")) return listedName;
  return `${prefix}${listedName}`;
}

async function listStoragePrefix(prefix) {
  const { key } = loadEnv();
  const rows = new Map();
  let offset = 0;
  for (;;) {
    const page = await curlJson("POST", `/storage/v1/object/list/${BUCKET}`, {
      key,
      body: { prefix, limit: 1000, offset },
    });
    if (!Array.isArray(page)) fail("STORAGE_LIST_INVALID");
    if (!page.length) break;
    for (const o of page) {
      const name = storageObjectKey(prefix, o.name);
      if (!name.startsWith(prefix) || rows.has(name)) fail("STORAGE_LIST_INVALID");
      rows.set(name, { ...o, name });
    }
    if (page.length < 1000) break;
    offset += page.length;
  }
  return rows;
}

async function fetchStorageMeta(keys, artifactByKey) {
  const objects = [];
  const prefixes = [...new Set(keys.map((k) => `${k.split("/")[0]}/`))].sort();
  const byKey = new Map();
  for (const prefix of prefixes) {
    for (const [name, row] of await listStoragePrefix(prefix)) byKey.set(name, row);
  }
  for (const key of [...keys].sort()) {
    const row = byKey.get(key);
    const artifact = artifactByKey.get(key);
    if (!row) {
      objects.push({
        bucket_id: BUCKET,
        key,
        id: "absent",
        version: "absent",
        bytes: Number(artifact?.bytes ?? 0),
        mimetype: artifact?.mime ?? null,
        is_delete_marker: false,
        already_absent: true,
        reasons: ["open_us_law_bulk_removal_2026_10_06"],
      });
      continue;
    }
    objects.push({
      bucket_id: BUCKET,
      key,
      id: row.id,
      version: row.version,
      bytes: Number(row.metadata?.size ?? row.metadata?.contentLength ?? 0),
      mimetype: row.metadata?.mimetype ?? null,
      is_delete_marker: false,
      already_absent: false,
      reasons: ["open_us_law_bulk_removal_2026_10_06"],
    });
  }
  return objects;
}

async function verifyExportManifest() {
  const { key } = loadEnv();
  const bytes = await execFileAsync("curl", [
    "-sS",
    ...RESOLVE_ARGS,
    `https://${HOST}/storage/v1/object/${EXPORT_BUCKET}/${EXPORT_MANIFEST_KEY}`,
    "-H",
    `apikey: ${key}`,
    "-H",
    `Authorization: Bearer ${key}`,
  ]).then((r) => Buffer.from(r.stdout));
  if (sha(bytes) !== PINNED_EXPORT_MANIFEST_SHA256) fail("EXPORT_MANIFEST_HASH_MISMATCH");
  const manifest = JSON.parse(bytes.toString("utf8"));
  const openUsLawRows = manifest?.sets?.open_us_law_records?.exported_rows;
  if (openUsLawRows !== PINNED_EXPORT_RECORD_ROWS) fail("EXPORT_MANIFEST_ROW_COUNT_MISMATCH");
  return { bytes: bytes.length, manifest };
}

async function assertNoReadyDependency(storageKeys) {
  const { key } = loadEnv();
  const blocked = new Set(storageKeys);
  let routeAfter = "";
  for (;;) {
    const q = new URLSearchParams({
      select: "route,object_key",
      ready: "eq.true",
      order: "route.asc",
      limit: "1000",
      ...(routeAfter ? { route: `gt.${routeAfter}` } : {}),
    });
    const page = await curlJson("GET", `/rest/v1/corpus_artifacts?${q}`, { key });
    if (!Array.isArray(page)) fail("READY_ARTIFACT_PREFLIGHT_FAILED");
    if (!page.length) break;
    for (const row of page) if (blocked.has(row.object_key)) fail("READY_ARTIFACT_DEPENDS_ON_REMOVAL_KEY");
    const next = page.at(-1)?.route;
    if (typeof next !== "string" || !next || next <= routeAfter) fail("READY_ARTIFACT_CURSOR_INVALID");
    routeAfter = next;
  }
}

async function listPrefix(prefix) {
  return listStoragePrefix(prefix);
}

async function prepare() {
  await fs.mkdir(BASE, { recursive: true });
  const exportProof = await verifyExportManifest();
  const artifactRows = await paginateArtifacts();
  const artifactByKey = new Map(artifactRows.map((r) => [r.object_key, r]));
  const storageKeys = [...new Set(artifactRows.map((r) => r.object_key))].sort();
  const storageObjects = await fetchStorageMeta(storageKeys, artifactByKey);
  if (storageObjects.length !== storageKeys.length) fail("STORAGE_META_INCOMPLETE");
  const plan = {
    schema: "owner-openus-bulk-storage-removal/v1",
    created_at: new Date().toISOString(),
    project: PROJECT,
    bucket: BUCKET,
    export_bucket: EXPORT_BUCKET,
    export_manifest_key: EXPORT_MANIFEST_KEY,
    export_manifest_sha256: PINNED_EXPORT_MANIFEST_SHA256,
    export_record_rows: PINNED_EXPORT_RECORD_ROWS,
    export_manifest_bytes: exportProof.bytes,
    totals: {
      storage_objects: storageObjects.length,
      storage_bytes: storageObjects.reduce((s, o) => s + o.bytes, 0),
      storage_already_absent: storageObjects.filter((o) => o.already_absent).length,
      artifact_rows: artifactRows.length,
      bulk_file_routes: artifactRows.filter((r) => r.route.startsWith("/bulk-files/us_")).length,
      oul_text_routes: artifactRows.filter((r) => r.route.includes("oul")).length,
    },
    storage_objects: storageObjects,
    artifact_rows: artifactRows,
  };
  validateOpenUsLawStoragePlan(plan);
  const planPath = path.join(BASE, "open-us-law-storage-plan-v1.json");
  const body = Buffer.from(JSON.stringify(plan, null, 2) + "\n");
  await fs.writeFile(planPath, body);
  await fs.writeFile(path.join(BASE, "artifact-rows-before.jsonl"), Buffer.from(artifactRows.map((r) => JSON.stringify(r)).join("\n") + "\n"));
  console.log(
    JSON.stringify({
      prepared: true,
      plan_sha256: sha(body),
      plan_path: planPath,
      storage_objects: plan.totals.storage_objects,
      storage_bytes: plan.totals.storage_bytes,
      artifact_rows: plan.totals.artifact_rows,
      bulk_file_routes: plan.totals.bulk_file_routes,
      oul_text_routes: plan.totals.oul_text_routes,
      remote_writes: 0,
    }),
  );
}

async function saveNew(file, data) {
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

async function deleteArtifactRows(rows) {
  const { url, key } = loadEnv();
  const batchSize = 40;
  let deleted = 0;
  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);
    const quoted = batch
      .map((r) => `"${r.object_key.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`)
      .join(",");
    const q = new URLSearchParams({
      object_key: `in.(${quoted})`,
      ready: "eq.false",
      select: "*",
    });
    const prefer = `handling=strict,return=representation,max-affected=${batch.length}`;
    const ack = await curlJson("DELETE", `/rest/v1/corpus_artifacts?${q}`, { key, prefer });
    if (!Array.isArray(ack) || ack.length !== batch.length) fail("ARTIFACT_DELETE_ACK_MISMATCH");
    deleted += ack.length;
  }
  return deleted;
}

async function execute(args) {
  const planPath = await fs.realpath(String(args.plan ?? path.join(BASE, "open-us-law-storage-plan-v1.json")));
  if (!planPath.startsWith((await fs.realpath(BASE)) + path.sep)) fail("PRIVATE_PLAN_REQUIRED");
  const planBytes = await fs.readFile(planPath);
  const planHash = sha(planBytes);
  if (planHash !== args["plan-sha256"]) fail("EXACT_PLAN_HASH_REQUIRED");
  const plan = JSON.parse(planBytes.toString("utf8"));
  validateOpenUsLawStoragePlan(plan);
  validateMaxAffected(plan, args["max-affected"]);
  await verifyExportManifest();
  const liveArtifacts = await paginateArtifacts();
  if (
    liveArtifacts.length !== plan.artifact_rows.length ||
    JSON.stringify(liveArtifacts) !== JSON.stringify(plan.artifact_rows)
  )
    fail("ARTIFACT_PLAN_DRIFT");
  const storageKeys = new Set(plan.storage_objects.map((o) => o.key));
  await assertNoReadyDependency(storageKeys);
  const receipts = path.join(BASE, "storage-removal-receipts");
  await fs.mkdir(receipts, { recursive: true });
  const { url, key } = loadEnv();
  const pseudoPlan = {
    eligible: plan.storage_objects,
    protected: [],
    totals: { eligible: { objects: plan.storage_objects.length, bytes: plan.totals.storage_bytes } },
  };
  const groups = new Map();
  for (const { prefix, batch } of groupedBatches(pseudoPlan)) {
    if (!groups.has(prefix)) groups.set(prefix, []);
    groups.get(prefix).push(...batch);
  }
  let deleted = 0;
  let deletedBytes = 0;
  for (const [prefix, objects] of groups) {
    const fresh = await listPrefix(prefix);
    for (let i = 0; i < objects.length; i += 250) {
        const batch = objects.slice(i, i + 250);
        const batchHash = sha(JSON.stringify(batch));
        const file = path.join(receipts, `${batchHash}.json`);
        const intentPath = `${file}.intent`;
        const prior = await maybe(file);
        const intent = await maybe(intentPath);
        if (batch.every((o) => o.already_absent)) {
          if (!prior) {
            const removedBytes = batch.reduce((s, o) => s + o.bytes, 0);
            await saveNew(file, {
              plan_sha256: planHash,
              batch_sha256: batchHash,
              objects: batch.length,
              bytes: removedBytes,
              already_absent: true,
              verified_absent_at: new Date().toISOString(),
            });
            deleted += batch.length;
            deletedBytes += removedBytes;
          } else {
            deleted += batch.length;
            deletedBytes += prior.bytes;
          }
          continue;
        }
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
        const remaining = state.remaining.filter((o) => !o.already_absent);
      for (const o of remaining) assertCurrentObject(o, fresh.get(o.key));
      if (!intent)
        await saveNew(intentPath, {
          plan_sha256: planHash,
          batch_sha256: batchHash,
          objects: batch,
          created_at: new Date().toISOString(),
        });
      if (remaining.length) {
        await deleteBatchOnce({
          url: `${url}/storage/v1/object/${BUCKET}`,
          headers: {
            apikey: key,
            ...(key.startsWith("sb_") ? {} : { Authorization: `Bearer ${key}` }),
          },
          objects: remaining,
          fetcher: async (deleteUrl, init) => {
            const body = JSON.parse(init.body);
            const ack = await curlJson("DELETE", deleteUrl.replace(`https://${HOST}`, ""), {
              key,
              body,
            });
            return { ok: true, json: async () => ack, status: 200 };
          },
        });
      }
      const absent = await listPrefix(prefix);
      if (batch.some((o) => !o.already_absent && absent.has(o.key))) fail("STORAGE_OBJECT_REMAINS");
      const removedBytes = batch.reduce((s, o) => s + o.bytes, 0);
      await saveNew(file, {
        plan_sha256: planHash,
        batch_sha256: batchHash,
        objects: batch.length,
        bytes: removedBytes,
        verified_absent_at: new Date().toISOString(),
      });
      deleted += batch.length;
      deletedBytes += removedBytes;
    }
  }
  const deletedArtifacts = await deleteArtifactRows(plan.artifact_rows);
  if (deletedArtifacts !== plan.artifact_rows.length) fail("ARTIFACT_DELETE_INCOMPLETE");
  const remainingBulk = await paginateArtifacts();
  if (remainingBulk.length) fail("OPEN_US_LAW_ARTIFACTS_REMAIN");
  await saveNew(path.join(receipts, "complete.json"), {
    complete: true,
    plan_sha256: planHash,
    export_manifest_sha256: PINNED_EXPORT_MANIFEST_SHA256,
    deleted_storage_objects: deleted,
    deleted_storage_bytes: deletedBytes,
    deleted_artifact_rows: deletedArtifacts,
    completed_at: new Date().toISOString(),
  });
  console.log(
    JSON.stringify({
      complete: true,
      deleted_storage_objects: deleted,
      deleted_storage_bytes: deletedBytes,
      deleted_artifact_rows: deletedArtifacts,
      export_manifest_preserved: true,
    }),
  );
}

async function main() {
  const pairs = process.argv.slice(2).map((x) => {
    const raw = x.replace(/^--/, "");
    const i = raw.indexOf("=");
    return i < 0 ? [raw, true] : [raw.slice(0, i), raw.slice(i + 1)];
  });
  const args = Object.fromEntries(pairs);
  if (args.prepare) return prepare();
  if (args.execute) return execute(args);
  fail("MODE_REQUIRED");
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((e) => {
    console.error(/^[A-Z0-9_]+$/.test(e.message) ? e.message : "OPENUS_STORAGE_REMOVAL_STOPPED");
    process.exitCode = 1;
  });
}
