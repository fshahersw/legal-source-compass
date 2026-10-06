#!/usr/bin/env node
/**
 * ACTIVATION STEP (not run by staging). Merges a staged limitations release into the live private-snapshot
 * manifest so the calculator starts serving it after the next deploy.
 *
 *   node scripts/admin/activate-limitations-release.mjs --from-storage --release=limitations-2026-10-06.1 --sha256=EXPECTED_SHA --verify
 *   node scripts/admin/activate-limitations-release.mjs --staged=PATH_TO_staged-manifest.json --sha256=EXPECTED_SHA [--verify]
 *
 * Requires the code of the same release (claim types, month/day periods, provenance fields) to be deployed first.
 * With --verify the service-role key from EXTERNAL_SUPABASE_SERVICE_ROLE_KEY is used to confirm every referenced
 * object exists in private storage; the key is never written anywhere.
 */
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const i = a.indexOf("=");
    return i < 0 ? [a.slice(2), true] : [a.slice(2, i), a.slice(i + 1)];
  }),
);
const live = "src/lib/private-data/manifest.server.json";
let stagedBytes;
if (args["from-storage"]) {
  const url = process.env.EXTERNAL_SUPABASE_URL?.replace(/\/+$/, "");
  const key = process.env.EXTERNAL_SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key || !args.release) throw new Error("CREDENTIALS_AND_RELEASE_REQUIRED");
  const objectKey = `atlas-private-data/staged-releases/${args.release}/manifest.${args.sha256}.json`;
  const r = await fetch(`${url}/storage/v1/object/corpus-originals/${objectKey}`, {
    headers: { apikey: key },
  });
  if (!r.ok) throw new Error(`STAGED_MANIFEST_NOT_FOUND_${r.status}`);
  stagedBytes = Buffer.from(await r.arrayBuffer());
} else {
  stagedBytes = await readFile(args.staged);
}
if (createHash("sha256").update(stagedBytes).digest("hex") !== args.sha256)
  throw new Error("STAGED_MANIFEST_HASH_MISMATCH");
const staged = JSON.parse(stagedBytes);
if (
  staged.staged !== true ||
  staged.project_id !== "xosqzzsnhxcyehcnirpa" ||
  staged.bucket !== "corpus-originals"
)
  throw new Error("NOT_A_STAGED_RELEASE_FOR_THIS_PROJECT");
const manifest = JSON.parse(await readFile(live, "utf8"));
if (manifest.project_id !== staged.project_id) throw new Error("PROJECT_MISMATCH");
for (const name of Object.keys(staged.files))
  if (!name.startsWith("limitations/")) throw new Error(`UNEXPECTED_FILE ${name}`);
// Keep the existing key order so the one-file diff stays small: update in place, drop retired limitations
// entries, append new ones.
const files = {};
for (const [name, entry] of Object.entries(manifest.files)) {
  if (!name.startsWith("limitations/")) files[name] = entry;
  else if (staged.files[name]) files[name] = staged.files[name];
}
for (const [name, entry] of Object.entries(staged.files)) if (!files[name]) files[name] = entry;
manifest.files = files;
if (args.verify) {
  const url = process.env.EXTERNAL_SUPABASE_URL?.replace(/\/+$/, "");
  const key = process.env.EXTERNAL_SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("CREDENTIALS_REQUIRED_IN_ENVIRONMENT");
  for (const [name, entry] of Object.entries(staged.files)) {
    const r = await fetch(`${url}/storage/v1/object/info/${manifest.bucket}/${entry.storage_key}`, {
      headers: {
        apikey: key,
        ...(key.startsWith("sb_") ? {} : { Authorization: `Bearer ${key}` }),
      },
    });
    await r.body?.cancel();
    if (!r.ok) throw new Error(`MISSING_OBJECT ${name}`);
  }
}
manifest.created_at = new Date().toISOString();
await writeFile(live, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(
  JSON.stringify({
    state: "manifest_updated_not_deployed",
    limitations_files: Object.keys(staged.files).length,
  }),
);
