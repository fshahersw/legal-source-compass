#!/usr/bin/env node
/**
 * One end-to-end smoke check of the refresh's embedding path against what the batch build stored, spending at most
 * 2,000 tokens once: one published record is rebuilt from its live corpus row by the refresh's own code (sources.ts,
 * chunking.ts), its embed key is compared with the batch build's shard metadata (same embed string), the passage is embedded
 * once with the refresh's client (same model, input type, float16 rounding and text), and the result is written for a
 * read-only comparison with the stored vector (semantic.chunks) in SQL.
 *
 *   . private/scratch/env.sh && node scripts/semantic/refresh_smoke.mjs [--dataset ftc_publications_index] [--id ID]
 *
 * Budget: refuses when private/build/w1025_semantic/smoke_usage.json exists (already spent) or when usage.json's
 * tokens_used plus the request's upper bound would pass 400,000,000, or when that bound passes 2,000. The tokens billed are
 * recorded in smoke_usage.json, which refresh_seed.py adds to the ledger seed. Keys are read inside this process only.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const { chunkDoc, chunkEmbedText, embedKey, sha256Hex } =
  await import("../../src/lib/semantic/chunking.ts");
const { buildDoc, encodeHref } =
  await import("../../supabase/functions/semantic-refresh/sources.ts");
const { embeddingClient, EMBEDDING_MODEL, EMBEDDING_INPUT_TYPE } =
  await import("../../supabase/functions/semantic-refresh/embed.ts");
const { reserveFor } = await import("../../supabase/functions/semantic-refresh/refresh.ts");

const OWN = path.join(ROOT, "private", "build", "w1025_semantic");
const SMOKE = path.join(OWN, "smoke_usage.json");
const arg = (n, d) => (process.argv.includes(n) ? process.argv[process.argv.indexOf(n) + 1] : d);
const dataset = arg("--dataset", "ftc_publications_index");
const id = arg("--id", "spotlight-reported-losses-scams-social-media-eight-times-higher-2020");

if (fs.existsSync(SMOKE)) {
  console.error("the smoke check already ran (smoke_usage.json exists); not spending again");
  process.exit(3);
}
const used = JSON.parse(
  fs.readFileSync(path.join(ROOT, "private", "build", "semantic", "usage.json"), "utf8"),
).tokens_used;

function secret(name) {
  if (process.env[name]) return process.env[name];
  for (let line of fs
    .readFileSync(path.join(ROOT, "private", "scratch", "secrets.env"), "utf8")
    .split("\n")) {
    line = line.trim().replace(/^export\s+/, "");
    const i = line.indexOf("=");
    if (i > 0 && line.slice(0, i).trim() === name)
      return line
        .slice(i + 1)
        .trim()
        .replace(/^["']|["']$/g, "");
  }
  return null;
}

const url = process.env.EXTERNAL_SUPABASE_URL.replace(/\/$/, "");
const key = process.env.EXTERNAL_SUPABASE_KEY;
const headers = {
  apikey: key,
  Accept: "application/json",
  ...(key.startsWith("sb_") ? {} : { Authorization: `Bearer ${key}` }),
};
const res = await fetch(
  `${url}/rest/v1/corpus_records?select=id,title,source_url,text,item,detail&dataset=eq.${dataset}&id=eq.${encodeURIComponent(id)}`,
  { headers },
);
if (!res.ok) throw new Error(`corpus read failed: HTTP ${res.status}`);
const [row] = await res.json();
if (!row) throw new Error("record not found");

const doc = buildDoc(dataset, row);
const [chunk] = chunkDoc(doc);
const text = chunkEmbedText(chunk);
const ekey = await embedKey(text, EMBEDDING_MODEL, EMBEDDING_INPUT_TYPE);

// the batch build's metadata for this record
const dir = path.join(ROOT, "private", "build", "semantic", dataset);
const manifest = JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf8"));
let meta = null;
for (const s of manifest.shards) {
  for (const line of zlib
    .gunzipSync(fs.readFileSync(path.join(dir, `${s.name}.meta.jsonl.gz`)))
    .toString("utf8")
    .split("\n")) {
    if (line && line.includes(JSON.stringify(id))) {
      const m = JSON.parse(line);
      if (m.record_id === id && m.chunk_no === 0) meta = m;
    }
  }
}
if (!meta) throw new Error("record not in the shards");
const sameString =
  meta.embed_sha256 === ekey &&
  meta.text_sha256 === (await sha256Hex(chunk.body)) &&
  encodeHref(meta.href) === chunk.href;
const bound = reserveFor(text);
console.log(
  JSON.stringify({
    dataset,
    id,
    chunk_no: 0,
    embed_key_matches_build: sameString,
    reserve_bound: bound,
    usage_json_tokens_used: used,
  }),
);
if (!sameString) process.exit(4);
if (bound > 2000 || used + bound > 400_000_000) {
  console.error("budget does not allow the smoke check");
  process.exit(5);
}

const client = embeddingClient({ key: secret("VOYAGE_API_KEY") });
const out = await client.embed([text]);
fs.mkdirSync(path.join(OWN, "smoke"), { recursive: true });
fs.writeFileSync(path.join(OWN, "smoke", "vector.txt"), out.vectors[0]);
const result = {
  at: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
  dataset,
  record_id: id,
  chunk_no: 0,
  tokens: out.tokens,
  reserve_bound: bound,
  tokens_within_bound: out.tokens <= bound,
  embed_key: ekey,
  vector_text_sha256: crypto.createHash("sha256").update(out.vectors[0]).digest("hex"),
  note: "scripts/semantic/refresh_smoke.mjs: one request of the refresh's embedding path; compare smoke/vector.txt with semantic.chunks",
};
fs.writeFileSync(SMOKE, JSON.stringify(result, null, 1) + "\n");
console.log(JSON.stringify(result));
