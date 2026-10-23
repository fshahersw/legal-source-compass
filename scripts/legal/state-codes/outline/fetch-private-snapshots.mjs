// Read-only: download private snapshot files named in src/lib/private-data/manifest.server.json, verify each one's
// size and SHA-256 against the manifest, and save them under <outDir>/<name>. Nothing is written to storage.
//
//   node scripts/legal/state-codes/outline/fetch-private-snapshots.mjs <outDir> <name-prefix-or-name>...
//
// Needs EXTERNAL_SUPABASE_URL / EXTERNAL_SUPABASE_KEY (service role) in the environment; never printed.
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { readBytesWithRetry } from "../../../admin/private-release-network.mjs";

const [outDir, ...wanted] = process.argv.slice(2);
if (!outDir || !wanted.length) {
  console.error("usage: fetch-private-snapshots.mjs <outDir> <name-prefix>...");
  process.exit(2);
}
const manifest = JSON.parse(fs.readFileSync("src/lib/private-data/manifest.server.json", "utf8"));
const url = (process.env.EXTERNAL_SUPABASE_URL ?? "").replace(/\/+$/, "");
const key = process.env.EXTERNAL_SUPABASE_KEY ?? "";
if (url !== `https://${manifest.project_id}.supabase.co` || !key) {
  console.error("CREDENTIALS_REQUIRED_IN_ENVIRONMENT");
  process.exit(2);
}
const headers = {
  apikey: key,
  ...(key.startsWith("sb_") ? {} : { Authorization: `Bearer ${key}` }),
};
const names = Object.keys(manifest.files).filter((name) =>
  wanted.some((w) => name === w || name.startsWith(w)),
);
let fetched = 0;
let skipped = 0;
let next = 0;
await Promise.all(
  Array.from({ length: 4 }, async () => {
    while (next < names.length) {
      const name = names[next++];
      const entry = manifest.files[name];
      const target = path.join(outDir, name);
      if (!path.resolve(target).startsWith(path.resolve(outDir) + path.sep))
        throw new Error("UNSAFE_NAME");
      if (fs.existsSync(target)) {
        const have = fs.readFileSync(target);
        if (
          have.length === entry.bytes &&
          createHash("sha256").update(have).digest("hex") === entry.sha256
        ) {
          skipped++;
          continue;
        }
      }
      const { response, bytes } = await readBytesWithRetry(() =>
        fetch(`${url}/storage/v1/object/${manifest.bucket}/${entry.storage_key}`, {
          headers,
          signal: AbortSignal.timeout(120000),
        }),
      );
      if (!response.ok || !bytes) throw new Error(`DOWNLOAD_FAILED ${name} ${response.status}`);
      if (
        bytes.length !== entry.bytes ||
        createHash("sha256").update(bytes).digest("hex") !== entry.sha256
      )
        throw new Error(`HASH_MISMATCH ${name}`);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, bytes);
      fetched++;
    }
  }),
);
console.log(JSON.stringify({ matched: names.length, fetched, already_verified: skipped }));
