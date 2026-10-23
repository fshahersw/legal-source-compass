#!/usr/bin/env node
/**
 * Resolve the Federal Register document numbers the acquired Regulations.gov documents state (frDocNum) to this corpus's
 * federal_register_history records, by exact source_url (https://www.federalregister.gov/d/<number>). Read-only.
 *
 *   . private/scratch/env.sh && node scripts/api_law/regulations_gov/fr_links.mjs [--out DIR] [--scan]
 *
 * Up to 2,000 numbers are looked up 40 at a time by source_url; more (the full load) are matched while reading the whole
 * federal_register_history once in ordinal order (1,000 rows a request, about 1,000 requests), which is lighter on the
 * database than thousands of source_url scans. Output: <out>/fr_links.jsonl.gz, one line per number found:
 * {doc_num, record_id, cfr_pairs}. Numbers not found are counted in <out>/fr_links.manifest.json.
 */
import fs from "node:fs";
import path from "node:path";
import { BUILD, corpusGet, ensureStripTypes, flag, nowIso, readJsonl, writeJson, writeJsonlGz } from "../lib/node.mjs";

ensureStripTypes(import.meta.url);
const R = await import("../../../src/lib/ingest/sources/regulationsGov.ts");
const args = process.argv.slice(2);
const out = path.resolve(flag(args, "--out", path.join(BUILD, "regulations_gov")));
const forceScan = args.includes("--scan");

const wanted = new Set();
for (const f of fs.readdirSync(path.join(out, "documents"))) {
  if (!f.endsWith(".jsonl.gz")) continue;
  for await (const line of readJsonl(path.join(out, "documents", f))) {
    const d = R.normalizeDocument(line.record);
    if (d?.frDocNum) wanted.add(d.frDocNum);
  }
}
const found = new Map();
let requests = 0;
const take = (row) => {
  const m = /^https:\/\/www\.federalregister\.gov\/d\/(.+)$/.exec(row.source_url ?? "");
  if (!m || !wanted.has(m[1])) return;
  if (found.has(m[1])) {
    // two corpus records with the same document URL: the link would not be exact
    found.set(m[1], { ...found.get(m[1]), ambiguous: true });
    return;
  }
  const pairs = Array.isArray(row.cfr) ? row.cfr.filter((p) => typeof p === "string") : [];
  found.set(m[1], { doc_num: m[1], record_id: row.id, cfr_pairs: pairs });
};
if (wanted.size <= 2000 && !forceScan) {
  const list = [...wanted];
  for (let i = 0; i < list.length; i += 40) {
    const urls = list.slice(i, i + 40).map((n) => `"${R.frUrl(n)}"`);
    const rows = await corpusGet(
      `corpus_records?select=id,source_url,cfr:filters->cfr_pair&dataset=eq.${R.FR_DATASET}&source_url=in.(${encodeURIComponent(urls.join(","))})`,
    );
    requests++;
    for (const r of rows) take(r);
  }
} else {
  let after = null;
  for (;;) {
    const rows = await corpusGet(
      `corpus_records?select=id,source_url,ordinal,cfr:filters->cfr_pair&dataset=eq.${R.FR_DATASET}&order=ordinal.asc&limit=1000${after === null ? "" : `&ordinal=gt.${after}`}`,
    );
    requests++;
    for (const r of rows) take(r);
    if (rows.length < 1000) break;
    after = rows[rows.length - 1].ordinal;
    if (requests % 50 === 0) console.error(JSON.stringify({ at: nowIso(), scanned_requests: requests, found: found.size }));
  }
}
const lines = [...found.values()].filter((f) => !f.ambiguous).sort((a, b) => (a.doc_num < b.doc_num ? -1 : 1));
const file = await writeJsonlGz(path.join(out, "fr_links.jsonl.gz"), lines);
writeJson(path.join(out, "fr_links.manifest.json"), {
  method: wanted.size <= 2000 && !forceScan ? "source_url lookup, 40 numbers a request" : "one ordered read of federal_register_history",
  numbers_stated: wanted.size,
  found: lines.length,
  ambiguous: [...found.values()].filter((f) => f.ambiguous).map((f) => f.doc_num),
  not_in_corpus: wanted.size - found.size,
  corpus_requests: requests,
  file,
  finished_at: nowIso(),
});
console.log(JSON.stringify({ numbers_stated: wanted.size, found: lines.length, requests }));
