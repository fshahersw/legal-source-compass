#!/usr/bin/env node
/**
 * ACTIVATION STEP. Adds a staged state-code outline release to the live private-snapshot manifest, so the site serves
 * it after the next deploy. Only `state-codes/<st>/outline-v1/` entries are added or replaced, and only for the states
 * the staged release carries; every other entry keeps its bytes and order.
 *
 *   node scripts/legal/state-codes/outline/activate-outline-release.mjs --staged=PATH --sha256=EXPECTED [--verify]
 *
 * --verify downloads every staged object again (EXTERNAL_SUPABASE_URL / EXTERNAL_SUPABASE_KEY from the environment,
 * never written) and checks its SHA-256 and size before the manifest is written. Undo: run with --remove=TX,OH to
 * drop those states' outline entries (the site then uses the projection's own outline again).
 */
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { readBytesWithRetry } from "../../../admin/private-release-network.mjs";

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const i = a.indexOf("=");
    return i < 0 ? [a.slice(2), true] : [a.slice(2, i), a.slice(i + 1)];
  }),
);
const live = "src/lib/private-data/manifest.server.json";
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const OUTLINE = /^state-codes\/([a-z]{2})\/outline-v1\//;
const liveBytes = await readFile(live);
const manifest = JSON.parse(liveBytes.toString("utf8"));
const before = sha(liveBytes);

if (args.remove) {
  const drop = new Set(String(args.remove).toLowerCase().split(","));
  const files = {};
  let removed = 0;
  for (const [name, entry] of Object.entries(manifest.files)) {
    const m = OUTLINE.exec(name);
    if (m && drop.has(m[1])) removed++;
    else files[name] = entry;
  }
  manifest.files = files;
  manifest.created_at = new Date().toISOString();
  const body = `${JSON.stringify(manifest, null, 2)}\n`;
  await writeFile(live, body);
  console.log(
    JSON.stringify({
      state: "outline_entries_removed",
      removed,
      manifest_before: before,
      manifest_after: sha(body),
    }),
  );
  process.exit(0);
}

const stagedBytes = await readFile(args.staged);
if (sha(stagedBytes) !== args.sha256) throw new Error("STAGED_MANIFEST_HASH_MISMATCH");
const staged = JSON.parse(stagedBytes.toString("utf8"));
if (
  staged.staged !== true ||
  staged.project_id !== manifest.project_id ||
  staged.bucket !== manifest.bucket
)
  throw new Error("NOT_A_STAGED_RELEASE_FOR_THIS_PROJECT");
const states = new Set();
for (const [name, entry] of Object.entries(staged.files)) {
  const m = OUTLINE.exec(name);
  if (!m) throw new Error(`UNEXPECTED_FILE ${name}`);
  if (
    entry.storage_key !==
    `atlas-private-data/sha256/${entry.sha256.slice(0, 2)}/${entry.sha256}.bin`
  )
    throw new Error(`UNEXPECTED_STORAGE_KEY ${name}`);
  states.add(m[1]);
}
if (args.verify) {
  const url = process.env.EXTERNAL_SUPABASE_URL?.replace(/\/+$/, "");
  const key = process.env.EXTERNAL_SUPABASE_KEY;
  if (!url || !key) throw new Error("CREDENTIALS_REQUIRED_IN_ENVIRONMENT");
  const headers = {
    apikey: key,
    ...(key.startsWith("sb_") ? {} : { Authorization: `Bearer ${key}` }),
  };
  for (const [name, entry] of Object.entries(staged.files)) {
    const { response, bytes } = await readBytesWithRetry(() =>
      fetch(`${url}/storage/v1/object/${staged.bucket}/${entry.storage_key}`, {
        headers,
        signal: AbortSignal.timeout(120000),
      }),
    );
    if (!response.ok || !bytes || bytes.length !== entry.bytes || sha(bytes) !== entry.sha256)
      throw new Error(`READBACK_MISMATCH ${name}`);
  }
}
// Keep order: existing entries in place (this release's states' outline entries replaced or dropped), new ones appended.
const files = {};
for (const [name, entry] of Object.entries(manifest.files)) {
  const m = OUTLINE.exec(name);
  if (!m || !states.has(m[1])) files[name] = entry;
  else if (staged.files[name]) files[name] = staged.files[name];
}
for (const [name, entry] of Object.entries(staged.files)) if (!files[name]) files[name] = entry;
manifest.files = files;
manifest.created_at = new Date().toISOString();
const body = `${JSON.stringify(manifest, null, 2)}\n`;
await writeFile(live, body);
console.log(
  JSON.stringify({
    state: "manifest_updated_not_deployed",
    release: staged.release,
    states: [...states].sort(),
    outline_files: Object.keys(staged.files).length,
    verified_by_download: args.verify === true,
    manifest_before: before,
    manifest_after: sha(body),
  }),
);
