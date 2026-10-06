#!/usr/bin/env node
/**
 * Stage a limitations release in the private `corpus-originals` bucket without activating it.
 *
 *  1. Raw official captures -> limitations-raw-captures/sha256/<xx>/<sha256>.bin (exact response bytes).
 *  2. Release files (rules/sources/coverage/cases JSON + text) -> atlas-private-data/sha256/<xx>/<sha256>.bin,
 *     the same content-addressed pattern as the live private snapshots.
 *  3. A staged manifest (calculation_activation_allowed:false) -> atlas-private-data/staged-releases/.
 *
 * Every object is read back and its SHA-256 checked. The live manifest (src/lib/private-data/manifest.server.json)
 * is NEVER touched: the running calculator keeps serving the current release until that file is replaced.
 *
 * Credentials come only from the environment (EXTERNAL_SUPABASE_URL, EXTERNAL_SUPABASE_SERVICE_ROLE_KEY) and are
 * never logged or written. Usage:
 *   node scripts/admin/stage-limitations-release.mjs --bundle=DIR --captures=DIR --out=DIR [--execute]
 */
import { createHash } from "node:crypto";
import { readdir, readFile, writeFile, mkdir, stat } from "node:fs/promises";
import { join, relative } from "node:path";

const PROJECT = "xosqzzsnhxcyehcnirpa";
const BUCKET = "corpus-originals";
const RELEASE = "2026-10-06.1";
const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const i = a.indexOf("=");
    return i < 0 ? [a.slice(2), true] : [a.slice(2, i), a.slice(i + 1)];
  }),
);
const bundle = args.bundle ?? "/tmp/lim/out/limitations";
const captures = args.captures ?? "/tmp/lim/backfill/captures";
const out = args.out ?? "/tmp/lim/out/staging";
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const execute = args.execute === true;

const url = process.env.EXTERNAL_SUPABASE_URL?.replace(/\/+$/, "");
const key = process.env.EXTERNAL_SUPABASE_SERVICE_ROLE_KEY;
if (execute && (url !== `https://${PROJECT}.supabase.co` || !key)) {
  console.error("CREDENTIALS_REQUIRED_IN_ENVIRONMENT");
  process.exit(2);
}
const headers = () => ({
  apikey: key,
  ...(key.startsWith("sb_") ? {} : { Authorization: `Bearer ${key}` }),
});
const objectUrl = (storageKey) => `${url}/storage/v1/object/${BUCKET}/${storageKey}`;

async function walk(dir) {
  const files = [];
  for (const item of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, item.name);
    if (item.isSymbolicLink()) throw new Error("SYMLINK_REJECTED");
    if (item.isDirectory()) files.push(...(await walk(path)));
    else files.push(path);
  }
  return files;
}

async function exists(storageKey) {
  for (let attempt = 0; ; attempt++) {
    try {
      const r = await fetch(objectUrl(storageKey), {
        headers: headers(),
        signal: AbortSignal.timeout(120000),
      });
      if (r.status === 404 || r.status === 400) {
        await r.body?.cancel();
        return null;
      }
      if (r.ok) return new Uint8Array(await r.arrayBuffer());
      await r.body?.cancel();
      if (attempt >= 4 || ![408, 429, 500, 502, 503, 504].includes(r.status))
        throw new Error(`READBACK_HTTP_${r.status}`);
    } catch (error) {
      if (attempt >= 4 || /^READBACK_HTTP_/.test(String(error?.message))) throw error;
    }
    await new Promise((res) => setTimeout(res, 2000 * 2 ** attempt));
  }
}

async function putVerified(
  storageKey,
  bytes,
  expectedSha,
  contentType = "application/octet-stream",
) {
  const existing = await exists(storageKey);
  let state = "already_present";
  if (!existing) {
    for (let attempt = 0; ; attempt++) {
      const r = await fetch(objectUrl(storageKey), {
        method: "POST",
        headers: { ...headers(), "Content-Type": contentType, "x-upsert": "false" },
        body: bytes,
        signal: AbortSignal.timeout(300000),
      });
      await r.body?.cancel();
      if (r.ok || r.status === 409) break;
      if (attempt >= 3 || ![408, 429, 500, 502, 503, 504].includes(r.status))
        throw new Error(`UPLOAD_HTTP_${r.status}`);
      await new Promise((res) => setTimeout(res, 2000 * 2 ** attempt));
    }
    state = "uploaded";
  }
  const back = existing ?? (await exists(storageKey));
  if (!back || back.length !== bytes.length || sha(back) !== expectedSha)
    throw new Error("READBACK_HASH_MISMATCH");
  return state;
}

async function pool(items, worker, size = 4) {
  let next = 0;
  const results = [];
  await Promise.all(
    Array.from({ length: size }, async () => {
      while (next < items.length) {
        const i = next++;
        results[i] = await worker(items[i]);
      }
    }),
  );
  return results;
}

await mkdir(out, { recursive: true });

// 1. raw captures (exact response bytes), de-duplicated by digest
const rawFiles = (await walk(captures)).filter((f) => f.endsWith(".raw")).sort();
const rawJobs = new Map();
const captureIndex = [];
for (const file of rawFiles) {
  const bytes = await readFile(file);
  const digest = sha(bytes);
  const meta = JSON.parse(await readFile(file.replace(/\.raw$/, ".json"), "utf8"));
  if (meta.rawSha256 !== digest && !meta.seeded)
    throw new Error(`CAPTURE_HASH_MISMATCH ${meta.id}`);
  const storageKey = `limitations-raw-captures/sha256/${digest.slice(0, 2)}/${digest}.bin`;
  rawJobs.set(digest, { file, digest, bytes: bytes.length, storageKey });
  captureIndex.push({
    state: meta.state,
    captureId: meta.id,
    url: meta.url,
    finalUrl: meta.finalUrl,
    retrievedAt: meta.retrievedAt,
    contentType: meta.contentType,
    rawSha256: digest,
    rawBytes: bytes.length,
    textSha256: meta.textSha256,
    seeded: Boolean(meta.seeded),
    intermediary: Boolean(meta.intermediary),
    storageBucket: BUCKET,
    storageKey,
  });
}

// 2. release files
const bundleFiles = (await walk(bundle)).sort();
const manifestFiles = {};
const releaseJobs = new Map();
for (const file of bundleFiles) {
  const name = `limitations/${relative(bundle, file).replaceAll("\\", "/")}`;
  if (!/^[a-zA-Z0-9_-][a-zA-Z0-9_./-]*\.(jsonl?|txt|csv)$/.test(name)) continue;
  const bytes = await readFile(file);
  if (bytes.length < 1 || bytes.length > 16 * 1024 * 1024)
    throw new Error(`UNBOUNDED_FILE ${name}`);
  const digest = sha(bytes);
  const storageKey = `atlas-private-data/sha256/${digest.slice(0, 2)}/${digest}.bin`;
  manifestFiles[name] = { sha256: digest, bytes: bytes.length, storage_key: storageKey };
  releaseJobs.set(digest, { file, digest, storageKey });
}

const plan = {
  raw_capture_objects: rawJobs.size,
  raw_capture_bytes: [...rawJobs.values()].reduce((a, j) => a + j.bytes, 0),
  release_files: Object.keys(manifestFiles).length,
  release_objects: releaseJobs.size,
};
if (!execute) {
  console.log(JSON.stringify({ state: "dry_run", ...plan }));
  process.exit(0);
}

const receipts = [];
const alreadyVerified = new Set();
if (args["known-receipts"]) {
  for (const line of (await readFile(args["known-receipts"], "utf8")).split("\n").filter(Boolean)) {
    const r = JSON.parse(line);
    if (r.kind === "raw_capture") alreadyVerified.add(r.sha256);
  }
}
const rawResults = await pool([...rawJobs.values()], async (job) => {
  const bytes = await readFile(job.file);
  const state = await putVerified(job.storageKey, bytes, job.digest);
  receipts.push({
    kind: "raw_capture",
    storage_key: job.storageKey,
    sha256: job.digest,
    bytes: job.bytes,
    state,
  });
  return state;
});
if (args["raw-only"]) {
  await writeFile(
    join(out, "raw-receipts.jsonl"),
    receipts.map((r) => JSON.stringify(r)).join("\n") + "\n",
  );
  console.log(
    JSON.stringify({
      state: "raw_captures_retained",
      ...plan,
      uploaded: rawResults.filter((x) => x === "uploaded").length,
      already_present: rawResults.filter((x) => x === "already_present").length,
      all_objects_hash_verified_by_readback: true,
    }),
  );
  process.exit(0);
}
const releaseResults = await pool([...releaseJobs.values()], async (job) => {
  const bytes = await readFile(job.file);
  const state = await putVerified(job.storageKey, bytes, job.digest);
  receipts.push({ kind: "release_file", storage_key: job.storageKey, sha256: job.digest, state });
  return state;
});

const indexBytes = Buffer.from(
  JSON.stringify({ release: RELEASE, captures: captureIndex }, null, 1) + "\n",
);
const indexSha = sha(indexBytes);
const indexKey = `atlas-private-data/staged-releases/limitations-${RELEASE}/capture-index.${indexSha}.json`;
await putVerified(indexKey, indexBytes, indexSha, "application/json");

const manifest = {
  schema_version: "atlas-private-snapshots/1",
  project_id: PROJECT,
  bucket: BUCKET,
  release: `limitations-${RELEASE}`,
  staged: true,
  calculation_activation_allowed: false,
  activation:
    "Not activated. The live calculator reads src/lib/private-data/manifest.server.json, which this release does not modify.",
  created_at: new Date().toISOString(),
  capture_index: { storage_key: indexKey, sha256: indexSha, bytes: indexBytes.length },
  files: manifestFiles,
};
const manifestBytes = Buffer.from(JSON.stringify(manifest, null, 2) + "\n");
const manifestSha = sha(manifestBytes);
const manifestKey = `atlas-private-data/staged-releases/limitations-${RELEASE}/manifest.${manifestSha}.json`;
await putVerified(manifestKey, manifestBytes, manifestSha, "application/json");
await writeFile(join(out, "staged-manifest.json"), manifestBytes);
await writeFile(join(out, "capture-index.json"), indexBytes);
await writeFile(
  join(out, "receipts.jsonl"),
  receipts.map((r) => JSON.stringify(r)).join("\n") + "\n",
);
const tally = (rs, s) => rs.filter((x) => x === s).length;
console.log(
  JSON.stringify({
    state: "staged_not_activated",
    ...plan,
    raw_uploaded: tally(rawResults, "uploaded"),
    raw_already_present: tally(rawResults, "already_present"),
    release_uploaded: tally(releaseResults, "uploaded"),
    release_already_present: tally(releaseResults, "already_present"),
    manifest_storage_key: manifestKey,
    manifest_sha256: manifestSha,
    capture_index_sha256: indexSha,
    all_objects_hash_verified_by_readback: true,
  }),
);
void stat;
