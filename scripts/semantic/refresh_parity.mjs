#!/usr/bin/env node
/**
 * Full-scale parity of the scheduled refresh's TypeScript pipeline (sources.ts + chunking.ts + embed keys) with what the
 * batch build embedded: every record of a collection is rebuilt from its published row and compared, passage by passage,
 * with the shard metadata under private/build/semantic/<dataset>/ (record, chunk number, chunk total, offsets, text
 * sha256, embed key, title, link, source URL, snippet). Nothing is sent anywhere; no embedding request is made.
 *
 *   node scripts/semantic/refresh_parity.mjs [--dataset ID ...] [--out private/build/w1025_semantic/parity_report.json]
 *
 * Rows come from the build files sources.py reads (the exact rows published to corpus_records). U.S. Code sections have
 * no build file on this machine any more; with --live-usc they are read from corpus_records by read-only REST GETs
 * (EXTERNAL_SUPABASE_URL / EXTERNAL_SUPABASE_KEY in the environment, never printed).
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

if (!process.execArgv.includes("--experimental-strip-types") && !process.features?.typescript) {
  const r = spawnSync(process.execPath, ["--experimental-strip-types", "--no-warnings", fileURLToPath(import.meta.url), ...process.argv.slice(2)], { stdio: "inherit" });
  process.exit(r.status ?? 1);
}

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const { chunkDoc, chunkEmbedText, embedKey, sha256Hex, snippetOf } = await import("../../src/lib/semantic/chunking.ts");
const { buildDoc, encodeHref } = await import("../../supabase/functions/semantic-refresh/sources.ts");
const { EMBEDDING_MODEL, EMBEDDING_INPUT_TYPE } = await import("../../supabase/functions/semantic-refresh/embed.ts");

const BUILD = path.join(ROOT, "private", "build");
const FILES = {
  ecfr_sections_full: path.join(BUILD, "ecfr_full", "ecfr_sections_full.rows.jsonl.gz"),
  crs_reports: path.join(BUILD, "legislation", "crs_reports.json"),
  congress_bills: path.join(BUILD, "legislation", "congress_bills.rows.jsonl.gz"),
  oversight_reports: path.join(BUILD, "oversight", "oversight_reports.json"),
  doj_oig_reports: path.join(BUILD, "oversight", "doj_oig_reports.json"),
  ftc_publications_index: path.join(BUILD, "ftc_data", "ftc_publications_index.json"),
};

const args = process.argv.slice(2);
const wanted = [];
let out = path.join(BUILD, "w1025_semantic", "parity_report.json");
let liveUsc = false;
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--dataset") wanted.push(args[++i]);
  else if (args[i] === "--out") out = path.resolve(args[++i]);
  else if (args[i] === "--live-usc") liveUsc = true;
}
const datasets = wanted.length ? wanted : [...Object.keys(FILES), ...(liveUsc ? ["us_code_sections"] : [])];

async function* jsonlGz(file) {
  const rl = readline.createInterface({ input: fs.createReadStream(file).pipe(zlib.createGunzip()), crlfDelay: Infinity });
  for await (const line of rl) if (line.trim()) yield JSON.parse(line);
}

async function* rowsOf(dataset) {
  const file = FILES[dataset];
  if (file.endsWith(".jsonl.gz")) yield* jsonlGz(file);
  else for (const r of JSON.parse(fs.readFileSync(file, "utf8")).rows) yield r;
}

async function rest(pathAndQuery) {
  const url = (process.env.EXTERNAL_SUPABASE_URL ?? "").replace(/\/$/, "");
  const key = process.env.EXTERNAL_SUPABASE_KEY ?? "";
  if (!url || !key) throw new Error("EXTERNAL_SUPABASE_URL / EXTERNAL_SUPABASE_KEY are needed for --live-usc");
  const headers = { apikey: key, Accept: "application/json" };
  if (!key.startsWith("sb_")) headers.Authorization = `Bearer ${key}`;
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(`${url}/rest/v1/${pathAndQuery}`, { headers });
    if (res.ok) return res.json();
    if (attempt >= 4) throw new Error(`corpus read failed: HTTP ${res.status}`);
    await new Promise((r) => setTimeout(r, 2000 * attempt));
  }
}

async function* uscRows() {
  const titles = await rest("corpus_records?select=ordinal,id,number:detail->usc_title->number,name:detail->usc_title->name&dataset=eq.us_code_titles&order=ordinal.asc,id.asc");
  const byNumber = new Map();
  for (const t of titles) {
    if (t.number === null || t.number === undefined) continue;
    const k = typeof t.number === "string" ? t.number : JSON.stringify(t.number);
    if (!byNumber.has(k)) byNumber.set(k, []);
    byNumber.get(k).push([t.number, t.name ?? null]);
  }
  let after = "";
  for (;;) {
    const q = `corpus_records?select=id,title,source_url,text,usc:detail->usc&dataset=eq.us_code_sections&order=id.asc&limit=1000${after ? `&id=gt.${encodeURIComponent(after)}` : ""}`;
    const page = await rest(q);
    for (const r of page) {
      const t = r.usc && typeof r.usc === "object" && !Array.isArray(r.usc) ? r.usc.title : undefined;
      const k = t === undefined || t === null ? null : typeof t === "string" ? t : JSON.stringify(t);
      yield { id: r.id, title: r.title, source_url: r.source_url, text: r.text, detail: { usc: r.usc ?? null }, _title_names: (k !== null && byNumber.get(k)) || [] };
    }
    if (page.length < 1000) return;
    after = page[page.length - 1].id;
  }
}

function readMetas(dataset) {
  const dir = path.join(BUILD, "semantic", dataset);
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf8"));
  const byRecord = new Map();
  for (const shard of manifest.shards) {
    const text = zlib.gunzipSync(fs.readFileSync(path.join(dir, `${shard.name}.meta.jsonl.gz`))).toString("utf8");
    for (const line of text.split("\n")) {
      if (!line) continue;
      const m = JSON.parse(line);
      if (!byRecord.has(m.record_id)) byRecord.set(m.record_id, []);
      byRecord.get(m.record_id).push(m);
    }
  }
  return { manifest, byRecord };
}

const FIELDS = ["chunk_total", "char_start", "char_end", "text_sha256", "embed_sha256", "title", "href", "source_url", "snippet"];

async function check(dataset) {
  const t0 = Date.now();
  const { manifest, byRecord } = readMetas(dataset);
  const rows = dataset === "us_code_sections" ? uscRows() : rowsOf(dataset);
  const stat = { dataset, records_in_shards: byRecord.size, chunks_in_shards: manifest.totals.chunks, rows: 0, docs: 0, no_doc: 0, records_equal: 0, chunks_compared: 0, record_mismatch: 0, field_mismatch: {}, missing_in_shards: 0, missing_from_rows: 0, build_errors: 0, samples: [] };
  const seen = new Set();
  for await (const row of rows) {
    stat.rows++;
    let doc;
    try {
      doc = buildDoc(dataset, row);
    } catch (e) {
      stat.build_errors++;
      if (stat.samples.length < 20) stat.samples.push({ record_id: String(row.id), problem: `build error ${e?.name}` });
      continue;
    }
    if (!doc) {
      stat.no_doc++;
      if (byRecord.has(String(row.id)) && stat.samples.length < 20) stat.samples.push({ record_id: String(row.id), problem: "no document here but passages in the shards" });
      continue;
    }
    stat.docs++;
    const metas = byRecord.get(doc.record_id);
    if (!metas) {
      stat.missing_in_shards++;
      if (stat.samples.length < 20) stat.samples.push({ record_id: doc.record_id, problem: "record not in the shards" });
      continue;
    }
    seen.add(doc.record_id);
    const chunks = chunkDoc(doc);
    let equal = chunks.length === metas.length;
    if (!equal) {
      stat.field_mismatch.chunk_count = (stat.field_mismatch.chunk_count ?? 0) + 1;
    }
    for (const c of chunks) {
      const m = metas.find((x) => x.chunk_no === c.chunk_no);
      if (!m) continue;
      stat.chunks_compared++;
      const et = chunkEmbedText(c);
      const ours = { chunk_total: c.chunk_total, char_start: c.start, char_end: c.end, text_sha256: await sha256Hex(c.body), embed_sha256: await embedKey(et, EMBEDDING_MODEL, EMBEDDING_INPUT_TYPE), title: c.title, href: c.href, source_url: c.source_url, snippet: snippetOf(c.body) };
      const theirs = { ...m, href: encodeHref(m.href) };
      for (const f of FIELDS) {
        if (ours[f] !== theirs[f]) {
          equal = false;
          stat.field_mismatch[f] = (stat.field_mismatch[f] ?? 0) + 1;
          if (stat.samples.length < 20) stat.samples.push({ record_id: doc.record_id, chunk_no: c.chunk_no, field: f, ours: String(ours[f]).slice(0, 120), shards: String(theirs[f]).slice(0, 120) });
        }
      }
    }
    if (equal) stat.records_equal++;
    else stat.record_mismatch++;
  }
  for (const id of byRecord.keys()) if (!seen.has(id)) stat.missing_from_rows++;
  stat.seconds = Math.round((Date.now() - t0) / 1000);
  return stat;
}

const report = { checked_at: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"), method: "scripts/semantic/refresh_parity.mjs: TypeScript rebuild of every published row vs the batch build's shard metadata", datasets: {} };
for (const d of datasets) {
  const s = await check(d);
  report.datasets[d] = s;
  console.log(JSON.stringify({ dataset: d, rows: s.rows, docs: s.docs, records_equal: s.records_equal, record_mismatch: s.record_mismatch, chunks_compared: s.chunks_compared, missing_in_shards: s.missing_in_shards, missing_from_rows: s.missing_from_rows, field_mismatch: s.field_mismatch, seconds: s.seconds }));
}
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify(report, null, 1) + "\n");
console.log(`report: ${path.relative(ROOT, out)}`);
