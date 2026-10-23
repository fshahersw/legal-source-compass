// Case law v2: measure full-text index sizes on a sample run's stored opinion texts with an offline PostgreSQL
// (PGlite, no network, no credentials): tsvector column bytes (stored, TOAST-compressed like production) and table +
// GIN bytes, per tier, for four index scopes: full text, full text without positions (strip), first 2,000 words and
// first 1,000 words. Writes private/build/w1025_caselaw/tsv_ratios.json (bytes on disk per text character) for
// estimate.py.
//   node scripts/caselaw_v2/tsv_measure.mjs private/build/w1025_caselaw/runs/sample
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { pathToFileURL } from "node:url";

const runtime =
  process.env.PUBLISHER_CODE_PGLITE ??
  path.resolve("private/tools/publisher-code-contract-tests/node_modules/@electric-sql/pglite/dist/index.js");
const { PGlite } = await import(pathToFileURL(runtime).href);
const runDir = process.argv[2];
if (!runDir) throw new Error("usage: node tsv_measure.mjs <run dir>");

function* members(buf) {
  // each gzip member is one reading record; gunzipSync reads concatenated members as one stream, so split on records
  const text = zlib.gunzipSync(buf).toString("utf8");
  let depth = 0, start = 0, inStr = false, esc = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === "{") { if (depth++ === 0) start = i; }
    else if (c === "}" && --depth === 0) yield JSON.parse(text.slice(start, i + 1));
  }
}

const files = [];
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (p.endsWith(".jsonl.gz")) files.push(p);
  }
})(path.join(runDir, "staged"));

const db = new PGlite();
await db.exec(`create table t (tier int, chars int, full_tsv tsvector, strip_tsv tsvector, p2k tsvector, p1k tsvector)`);
let n = 0;
for (const f of files.sort()) {
  for (const r of members(fs.readFileSync(f))) {
    const w = r.text.split(/\s+/).filter(Boolean);
    await db.query(
      `insert into t values ($1, $2, to_tsvector('english', $3), strip(to_tsvector('english', $3)),
         to_tsvector('english', $4), to_tsvector('english', $5))`,
      [Number(String(r.tier).replace(/^t/, "")), r.text.length, r.text, w.slice(0, 2000).join(" "), w.slice(0, 1000).join(" ")],
    );
    n++;
  }
}
const scopes = { full: "full_tsv", strip: "strip_tsv", prefix2000: "p2k", prefix1000: "p1k" };
const out = { measured_at: new Date().toISOString(), opinions: n, engine: "PGlite (PostgreSQL), english configuration", tiers: {}, all: {} };
// table + GIN bytes for all tiers together give the on-disk factor over the stored column bytes
for (const [name, col] of Object.entries(scopes)) {
  await db.exec(`create table x_${col} as select ${col} v from t; create index on x_${col} using gin (v);`);
  const r = (await db.query(`select pg_total_relation_size('x_${col}')::bigint total, (select sum(pg_column_size(${col})) from t)::bigint col,
                               (select sum(chars) from t)::bigint chars`)).rows[0];
  out.all[name] = { disk_per_char: Number(r.total) / Number(r.chars), disk_over_column: Number(r.total) / Number(r.col) };
}
const per = (await db.query(`select tier, count(*)::int n, sum(chars)::bigint chars,
  sum(pg_column_size(full_tsv))::bigint full_tsv, sum(pg_column_size(strip_tsv))::bigint strip_tsv,
  sum(pg_column_size(p2k))::bigint p2k, sum(pg_column_size(p1k))::bigint p1k from t group by tier order by tier`)).rows;
for (const r of per) {
  const t = {};
  for (const [name, col] of Object.entries(scopes))
    t[name] = (Number(r[col]) / Number(r.chars)) * out.all[name].disk_over_column;
  out.tiers[r.tier] = { opinions: r.n, chars: Number(r.chars), disk_per_char: t };
}
fs.writeFileSync(path.resolve("private/build/w1025_caselaw/tsv_ratios.json"), JSON.stringify(out, null, 1) + "\n");
console.log(JSON.stringify(out, null, 1));
