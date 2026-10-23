#!/usr/bin/env node
/**
 * Stage state-code outline releases (state-codes/<st>/outline-v1/*.json, built by build_outline_release.py) in the
 * private `corpus-originals` bucket without activating them.
 *
 *   node scripts/legal/state-codes/outline/stage-outline-release.mjs --dir=DIR --release=NAME --out=DIR [--execute]
 *
 * 1. Every file is checked: a root names only shards of its own state with their exact sha256 and size, and every
 *    shard on disk is named by a root.
 * 2. Each file goes to atlas-private-data/sha256/<xx>/<sha256>.bin (the content-addressed pattern of every live
 *    private snapshot) and is read back; its SHA-256 and size must match.
 * 3. A staged manifest (staged: true) goes to atlas-private-data/staged-releases/<release>/manifest.<sha>.json and is
 *    written to --out. The live manifest (src/lib/private-data/manifest.server.json) is never touched here; see
 *    activate-outline-release.mjs.
 *
 * Without --execute nothing is sent. Credentials come only from the environment (EXTERNAL_SUPABASE_URL and
 * EXTERNAL_SUPABASE_KEY, service role) and are never logged or written.
 */
import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { readBytesWithRetry, requestWithRetry } from "../../../admin/private-release-network.mjs";

const PROJECT = "xosqzzsnhxcyehcnirpa";
const BUCKET = "corpus-originals";
const SCHEMA = "state-code-outline-release/1";
const MAX_BYTES = 16 * 1024 * 1024;
const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const i = a.indexOf("=");
    return i < 0 ? [a.slice(2), true] : [a.slice(2, i), a.slice(i + 1)];
  }),
);
const dir = args.dir;
const release = args.release;
const out = args.out;
const execute = args.execute === true;
if (!dir || !out || !/^state-code-outlines-[0-9a-z.-]{1,40}$/.test(release ?? "")) {
  console.error("usage: --dir=DIR --release=state-code-outlines-<name> --out=DIR [--execute]");
  process.exit(2);
}
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const url = process.env.EXTERNAL_SUPABASE_URL?.replace(/\/+$/, "");
const key = process.env.EXTERNAL_SUPABASE_KEY;
if (execute && (url !== `https://${PROJECT}.supabase.co` || !key)) {
  console.error("CREDENTIALS_REQUIRED_IN_ENVIRONMENT");
  process.exit(2);
}
const headers = () => ({
  apikey: key,
  ...(key.startsWith("sb_") ? {} : { Authorization: `Bearer ${key}` }),
});
const objectUrl = (storageKey) => `${url}/storage/v1/object/${BUCKET}/${storageKey}`;

async function walk(base) {
  const files = [];
  for (const item of await readdir(base, { withFileTypes: true })) {
    const path = join(base, item.name);
    if (item.isSymbolicLink()) throw new Error("SYMLINK_REJECTED");
    if (item.isDirectory()) files.push(...(await walk(path)));
    else files.push(path);
  }
  return files;
}

async function exists(storageKey) {
  const { response: r, bytes } = await readBytesWithRetry(() =>
    fetch(objectUrl(storageKey), { headers: headers(), signal: AbortSignal.timeout(120000) }),
  );
  if (r.status === 404 || r.status === 400) return null;
  if (r.ok) return bytes;
  throw new Error(`READBACK_HTTP_${r.status}`);
}

async function putVerified(storageKey, bytes, expectedSha, contentType) {
  const existing = await exists(storageKey);
  let state = "already_present";
  if (!existing) {
    const r = await requestWithRetry(() =>
      fetch(objectUrl(storageKey), {
        method: "POST",
        headers: { ...headers(), "Content-Type": contentType, "x-upsert": "false" },
        body: bytes,
        signal: AbortSignal.timeout(300000),
      }),
    );
    await r.body?.cancel();
    if (!r.ok && r.status !== 409) throw new Error(`UPLOAD_HTTP_${r.status}`);
    state = "uploaded";
  }
  const back = existing ?? (await exists(storageKey));
  if (!back || back.length !== bytes.length || sha(back) !== expectedSha)
    throw new Error("READBACK_HASH_MISMATCH");
  return state;
}

// 1. Read and cross-check every file.
const files = {};
const byName = new Map();
for (const path of (await walk(dir)).sort()) {
  const name = relative(dir, path).replaceAll("\\", "/");
  if (!/^state-codes\/[a-z]{2}\/outline-v1\/(?:root|s\d{1,4})\.json$/.test(name))
    throw new Error(`UNEXPECTED_FILE ${name}`);
  const bytes = await readFile(path);
  if (!bytes.length || bytes.length > MAX_BYTES) throw new Error(`UNBOUNDED_FILE ${name}`);
  const digest = sha(bytes);
  byName.set(name, { bytes, digest });
  files[name] = {
    sha256: digest,
    bytes: bytes.length,
    storage_key: `atlas-private-data/sha256/${digest.slice(0, 2)}/${digest}.bin`,
  };
}
const named = new Set();
const states = [];
for (const [name, { bytes }] of byName) {
  if (!name.endsWith("/root.json")) continue;
  const st = name.split("/")[1];
  const root = JSON.parse(bytes.toString("utf8"));
  if (root.schema_version !== SCHEMA || root.jurisdiction !== st.toUpperCase())
    throw new Error(`BAD_ROOT ${name}`);
  for (const [shard, entry] of Object.entries(root.shards ?? {})) {
    const file = byName.get(shard);
    if (!shard.startsWith(`state-codes/${st}/outline-v1/`) || !file)
      throw new Error(`MISSING_SHARD ${shard}`);
    if (file.digest !== entry.sha256 || file.bytes.length !== entry.bytes)
      throw new Error(`SHARD_HASH_MISMATCH ${shard}`);
    const parsed = JSON.parse(file.bytes.toString("utf8"));
    if (parsed.schema_version !== SCHEMA || parsed.jurisdiction !== root.jurisdiction)
      throw new Error(`BAD_SHARD ${shard}`);
    named.add(shard);
  }
  states.push({
    state: root.jurisdiction,
    sections: root.projection_sections,
    shards: Object.keys(root.shards).length,
  });
}
for (const name of byName.keys())
  if (!name.endsWith("/root.json") && !named.has(name)) throw new Error(`ORPHAN_SHARD ${name}`);
const plan = {
  release,
  states,
  files: Object.keys(files).length,
  bytes: Object.values(files).reduce((s, f) => s + f.bytes, 0),
};
if (!execute) {
  console.log(JSON.stringify({ state: "plan_only_nothing_sent", ...plan }));
  process.exit(0);
}

// 2. Upload content-addressed objects with readback.
const receipts = [];
const names = Object.keys(files);
let next = 0;
await Promise.all(
  Array.from({ length: 4 }, async () => {
    while (next < names.length) {
      const name = names[next++];
      const entry = files[name];
      const state = await putVerified(
        entry.storage_key,
        byName.get(name).bytes,
        entry.sha256,
        "application/octet-stream",
      );
      receipts.push({ name, ...entry, state, verified_at: new Date().toISOString() });
    }
  }),
);

// 3. Staged manifest, also content-addressed and read back.
const manifest = {
  schema_version: "atlas-private-snapshots/1",
  project_id: PROJECT,
  bucket: BUCKET,
  release,
  staged: true,
  activation:
    "Not activated. The site reads src/lib/private-data/manifest.server.json; activate-outline-release.mjs adds these entries.",
  created_at: new Date().toISOString(),
  states,
  files,
};
const manifestBytes = Buffer.from(JSON.stringify(manifest, null, 2) + "\n");
const manifestSha = sha(manifestBytes);
const manifestKey = `atlas-private-data/staged-releases/${release}/manifest.${manifestSha}.json`;
await putVerified(manifestKey, manifestBytes, manifestSha, "application/json");
await mkdir(out, { recursive: true });
await writeFile(join(out, "staged-manifest.json"), manifestBytes);
await writeFile(
  join(out, "receipts.jsonl"),
  receipts.map((r) => JSON.stringify(r)).join("\n") + "\n",
);
console.log(
  JSON.stringify({
    state: "staged_not_activated",
    ...plan,
    uploaded: receipts.filter((r) => r.state === "uploaded").length,
    already_present: receipts.filter((r) => r.state === "already_present").length,
    manifest_storage_key: manifestKey,
    manifest_sha256: manifestSha,
    all_objects_hash_verified_by_readback: true,
  }),
);
