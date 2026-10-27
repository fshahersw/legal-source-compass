#!/usr/bin/env node
/**
 * Upload the court_reference seal PNGs (Free Law Project seal-rookery, built 2026-09-20) to the private
 * corpus-originals bucket at the content-addressed keys their public.corpus_artifacts rows already name
 * (<sha[0:2]>/<sha>), then read every object back and compare SHA-256 and size.
 *
 *   node scripts/admin/upload-court-reference-seals.mjs \
 *     --seals=C:/Users/firas/Downloads/SCRAPE/sources/court_reference_flp_20260920/seals \
 *     --out=private/acq/release-dataset-court-reference [--execute]
 *
 * Without --execute it only verifies the local files against the committed manifest and writes a plan.
 * The manifest (database/contracts/court-reference-seals-20261027.sha256) equals the live artifact rows
 * (md5 of the C-sorted "id sha256 bytes" lines = 3f00f295bafaa7489b512301fed90676, checked 2026-10-27).
 * It never touches database rows or ready flags; database/contracts/court-reference-release-20261027.sql does that.
 * Credentials come only from the environment (EXTERNAL_SUPABASE_URL, EXTERNAL_SUPABASE_SERVICE_ROLE_KEY) and are never printed.
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const PROJECT = "xosqzzsnhxcyehcnirpa";
export const BUCKET = "corpus-originals";
export const MANIFEST = "database/contracts/court-reference-seals-20261027.sha256";
export const MANIFEST_MD5 = "3f00f295bafaa7489b512301fed90676";
export const EXPECTED_ROWS = 253;
export const EXPECTED_OBJECTS = 250;
const ID = /^[a-z0-9]{1,40}$/;
const SHA = /^[a-f0-9]{64}$/;

export const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
export const md5 = (text) => createHash("md5").update(text).digest("hex");
export const objectKey = (sha) => `${sha.slice(0, 2)}/${sha}`;

/** Parse "id sha256 bytes" lines; exact shape, unique ids, C-sorted, fixed count and digest. */
export function parseManifest(text) {
  const normalized = text.replace(/\r/g, "");
  if (md5(normalized) !== MANIFEST_MD5) throw Error("MANIFEST_DIGEST_MISMATCH");
  const lines = normalized.split("\n").filter(Boolean);
  const rows = lines.map((line) => {
    const parts = line.split(" ");
    if (parts.length !== 3) throw Error("MANIFEST_LINE_SHAPE");
    const [id, sha, size] = parts;
    const bytes = Number(size);
    if (!ID.test(id) || !SHA.test(sha) || !Number.isInteger(bytes) || bytes < 1 || bytes > 2 * 1024 ** 2)
      throw Error("MANIFEST_LINE_VALUE");
    return { id, sha256: sha, bytes };
  });
  if (rows.length !== EXPECTED_ROWS) throw Error("MANIFEST_ROW_COUNT");
  if (new Set(rows.map((r) => r.id)).size !== rows.length) throw Error("MANIFEST_DUPLICATE_ID");
  return rows;
}

/**
 * Check every local file against its manifest row and group rows by content: one storage object per distinct hash.
 * `files` maps court id -> Buffer. A missing, extra or changed file stops the plan.
 */
export function planObjects(rows, files) {
  const ids = new Set(rows.map((r) => r.id));
  for (const id of files.keys()) if (!ids.has(id)) throw Error(`STRAY_LOCAL_FILE:${id}`);
  const objects = new Map();
  for (const row of rows) {
    const bytes = files.get(row.id);
    if (!bytes) throw Error(`MISSING_LOCAL_FILE:${row.id}`);
    if (bytes.length !== row.bytes || sha256(bytes) !== row.sha256) throw Error(`LOCAL_HASH_MISMATCH:${row.id}`);
    const existing = objects.get(row.sha256);
    if (existing) existing.ids.push(row.id);
    else objects.set(row.sha256, { key: objectKey(row.sha256), sha256: row.sha256, bytes: row.bytes, ids: [row.id], body: bytes });
  }
  const list = [...objects.values()];
  if (list.length !== EXPECTED_OBJECTS) throw Error("DISTINCT_OBJECT_COUNT");
  return list;
}

async function bounded(response, limit) {
  const parts = [];
  let size = 0;
  for await (const part of response.body) {
    size += part.length;
    if (size > limit) throw Error("STORAGE_SIZE_MISMATCH");
    parts.push(part);
  }
  return Buffer.concat(parts);
}

/** Upload one object unless it exists (no overwrite), then read it back and compare hash and size. */
export async function putVerified(url, headers, object, fetcher = fetch) {
  const endpoint = `${url}/storage/v1/object/${BUCKET}/${object.key}`;
  const request = (extra = {}) =>
    fetcher(endpoint, { headers, redirect: "error", signal: AbortSignal.timeout(45000), ...extra });
  let response = await request();
  let created = false;
  if (response.status === 404 || response.status === 400) {
    // Supabase Storage answers a missing object with HTTP 400 and a structured not-found body; anything else stops.
    let problem;
    try {
      problem = JSON.parse((await bounded(response, 8192)).toString("utf8"));
    } catch {
      throw Error("UNEXPECTED_STORAGE_ERROR");
    }
    if (!["404", 404].includes(problem?.statusCode) && problem?.error !== "not_found") throw Error("UNEXPECTED_STORAGE_ERROR");
    const put = await request({
      method: "POST",
      headers: { ...headers, "Content-Type": "image/png", "x-upsert": "false" },
      body: object.body,
    });
    await put.body?.cancel?.();
    if (!put.ok && put.status !== 409) throw Error(`STORAGE_UPLOAD_${put.status}:${object.ids[0]}`);
    created = put.ok;
    response = await request();
  }
  if (!response.ok) {
    await response.body?.cancel?.();
    throw Error(`STORAGE_READBACK_${response.status}:${object.ids[0]}`);
  }
  const back = await bounded(response, object.bytes);
  if (back.length !== object.bytes || sha256(back) !== object.sha256) throw Error(`STORAGE_HASH_MISMATCH:${object.ids[0]}`);
  return { key: object.key, sha256: object.sha256, bytes: object.bytes, ids: object.ids, created, verified: true };
}

function parseArgs(argv) {
  const args = { execute: false };
  for (const arg of argv) {
    if (arg === "--execute") args.execute = true;
    else if (arg.startsWith("--seals=")) args.seals = arg.slice(8);
    else if (arg.startsWith("--out=")) args.out = arg.slice(6);
    else throw Error(`UNKNOWN_ARGUMENT:${arg}`);
  }
  if (!args.seals || !args.out) throw Error("USAGE: --seals=<dir> --out=<dir> [--execute]");
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const rows = parseManifest(await readFile(MANIFEST, "utf8"));
  const files = new Map();
  for (const row of rows) {
    try {
      files.set(row.id, await readFile(resolve(args.seals, `${row.id}.png`)));
    } catch {
      throw Error(`MISSING_LOCAL_FILE:${row.id}`);
    }
  }
  const objects = planObjects(rows, files);
  const receipt = {
    schema: "court-reference-seal-upload/1",
    project: PROJECT,
    bucket: BUCKET,
    manifest: MANIFEST,
    manifestMd5: MANIFEST_MD5,
    rows: rows.length,
    distinctObjects: objects.length,
    totalBytes: objects.reduce((n, o) => n + o.bytes, 0),
    executed: args.execute,
    objects: [],
    checkedAt: new Date().toISOString(),
  };
  if (args.execute) {
    const url = process.env.EXTERNAL_SUPABASE_URL?.replace(/\/+$/, "");
    const key = process.env.EXTERNAL_SUPABASE_SERVICE_ROLE_KEY;
    if (url !== `https://${PROJECT}.supabase.co` || !key) throw Error("CORPUS_SERVER_CREDENTIALS_REQUIRED");
    const headers = { apikey: key, ...(key.startsWith("sb_") ? {} : { Authorization: `Bearer ${key}` }) };
    const bucket = await fetch(`${url}/storage/v1/bucket/${BUCKET}`, { headers, redirect: "error", signal: AbortSignal.timeout(30000) });
    if (!bucket.ok || (await bucket.json()).public !== false) throw Error("PRIVATE_BUCKET_REQUIRED");
    for (const object of objects) receipt.objects.push(await putVerified(url, headers, object));
    receipt.created = receipt.objects.filter((o) => o.created).length;
    receipt.verified = receipt.objects.filter((o) => o.verified).length;
  } else {
    receipt.objects = objects.map(({ key, sha256: s, bytes, ids }) => ({ key, sha256: s, bytes, ids }));
  }
  await mkdir(args.out, { recursive: true });
  const name = args.execute ? "upload-receipt.json" : "upload-plan.json";
  await writeFile(resolve(args.out, name), JSON.stringify(receipt, null, 2) + "\n");
  console.log(
    JSON.stringify({ executed: receipt.executed, rows: receipt.rows, distinctObjects: receipt.distinctObjects, totalBytes: receipt.totalBytes, created: receipt.created ?? 0, verified: receipt.verified ?? 0, wrote: name }),
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    console.error(String(error?.message ?? error));
    process.exit(1);
  });
}
