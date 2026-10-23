#!/usr/bin/env node
/**
 * Stores src/lib/citations/patterns.json content-addressed in private storage (corpus-exports/citations/patterns/
 * <sha256>.json) for the deployed ingest-citations function, which loads it at cold start and checks the digest
 * (src/lib/citations/patterns.remote.ts; the bundle is written by scripts/ingest/bundle_functions.mjs). Run it before
 * deploying a bundle made from a new pattern table. Never overwrites: an existing object must already have the same
 * bytes. Reads the object back and compares the hash.
 *
 *   node scripts/citations_v2/upload_patterns.mjs            # dry run: prints the object path and digest
 *   set -a && . private/scratch/env.sh && set +a && node scripts/citations_v2/upload_patterns.mjs --execute
 *
 * Credentials come only from the environment (EXTERNAL_SUPABASE_URL, EXTERNAL_SUPABASE_KEY) and are never printed.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const BUCKET = "corpus-exports";
const PROJECT = "xosqzzsnhxcyehcnirpa";

const bytes = readFileSync(path.join(ROOT, "src", "lib", "citations", "patterns.json"));
const digest = createHash("sha256").update(bytes).digest("hex");
const version = JSON.parse(bytes.toString("utf8")).version;
const key = `citations/patterns/${digest}.json`;
const report = { bucket: BUCKET, object: key, sha256: digest, bytes: bytes.length, version };

if (!process.argv.includes("--execute")) {
  console.log(JSON.stringify({ ...report, state: "dry_run" }));
  process.exit(0);
}

const url = process.env.EXTERNAL_SUPABASE_URL?.replace(/\/+$/, "");
const secret = process.env.EXTERNAL_SUPABASE_KEY ?? process.env.EXTERNAL_SUPABASE_SERVICE_ROLE_KEY;
if (url !== `https://${PROJECT}.supabase.co` || !secret) {
  console.error("CREDENTIALS_REQUIRED_IN_ENVIRONMENT");
  process.exit(2);
}
const headers = {
  apikey: secret,
  ...(secret.startsWith("sb_") ? {} : { Authorization: `Bearer ${secret}` }),
};
const objectUrl = `${url}/storage/v1/object/${BUCKET}/${key}`;
const sha = (b) => createHash("sha256").update(b).digest("hex");

async function readBack() {
  const r = await fetch(objectUrl, { headers, signal: AbortSignal.timeout(60_000) });
  if (r.status === 400 || r.status === 404) {
    await r.body?.cancel();
    return null;
  }
  if (!r.ok) throw new Error(`READBACK_HTTP_${r.status}`);
  return Buffer.from(await r.arrayBuffer());
}

let state = "already_present";
let back = await readBack();
if (!back) {
  const r = await fetch(objectUrl, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json", "x-upsert": "false" },
    body: bytes,
    signal: AbortSignal.timeout(120_000),
  });
  await r.body?.cancel();
  if (!r.ok && r.status !== 409) throw new Error(`UPLOAD_HTTP_${r.status}`);
  state = "uploaded";
  back = await readBack();
}
if (!back || back.length !== bytes.length || sha(back) !== digest)
  throw new Error("READBACK_HASH_MISMATCH");
console.log(JSON.stringify({ ...report, state, readback: "sha256_match" }));
