#!/usr/bin/env node
/**
 * Build the staged limitations manifest JSON (same shape as stage-limitations-release.mjs)
 * without uploading. Prints manifest_sha256 for verifier handoff when credentials are absent.
 */
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { join, relative } from "node:path";

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const i = a.indexOf("=");
    return i < 0 ? [a.slice(2), true] : [a.slice(2, i), a.slice(i + 1)];
  }),
);
const RELEASE = args.release ?? "2026-10-06.4";
const bundle = args.bundle ?? "/tmp/lim/out/limitations";
const captures = args.captures ?? "/tmp/lim/backfill/captures";
const PROJECT = "xosqzzsnhxcyehcnirpa";
const BUCKET = "corpus-originals";
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");

async function walk(dir) {
  const files = [];
  for (const item of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, item.name);
    if (item.isDirectory()) files.push(...(await walk(path)));
    else files.push(path);
  }
  return files;
}

const captureIndex = [];
for (const file of (await walk(captures)).filter((f) => f.endsWith(".raw")).sort()) {
  const bytes = await readFile(file);
  const digest = sha(bytes);
  const meta = JSON.parse(await readFile(file.replace(/\.raw$/, ".json"), "utf8"));
  captureIndex.push({ captureId: meta.id, rawSha256: digest });
}
const indexBytes = Buffer.from(
  JSON.stringify({ release: RELEASE, captures: captureIndex }, null, 1) + "\n",
);
const indexSha = sha(indexBytes);

const manifestFiles = {};
for (const file of (await walk(bundle)).sort()) {
  const name = `limitations/${relative(bundle, file).replaceAll("\\", "/")}`;
  if (!/^[a-zA-Z0-9_-][a-zA-Z0-9_./-]*\.(jsonl?|txt|csv)$/.test(name)) continue;
  const bytes = await readFile(file);
  const digest = sha(bytes);
  manifestFiles[name] = {
    sha256: digest,
    bytes: bytes.length,
    storage_key: `atlas-private-data/sha256/${digest.slice(0, 2)}/${digest}.bin`,
  };
}

const manifest = {
  schema_version: "atlas-private-snapshots/1",
  project_id: PROJECT,
  bucket: BUCKET,
  release: `limitations-${RELEASE}`,
  staged: true,
  calculation_activation_allowed: false,
  activation:
    "Not activated. The live calculator reads src/lib/private-data/manifest.server.json, which this release does not modify.",
  created_at: args["created-at"] ?? "2026-10-06T00:00:00.000Z",
  capture_index: {
    storage_key: `atlas-private-data/staged-releases/limitations-${RELEASE}/capture-index.${indexSha}.json`,
    sha256: indexSha,
    bytes: indexBytes.length,
  },
  files: manifestFiles,
};
const manifestBytes = Buffer.from(JSON.stringify(manifest, null, 2) + "\n");
console.log(
  JSON.stringify({
    release: RELEASE,
    manifest_sha256: sha(manifestBytes),
    capture_index_sha256: indexSha,
    release_files: Object.keys(manifestFiles).length,
    capture_objects: captureIndex.length,
  }),
);
