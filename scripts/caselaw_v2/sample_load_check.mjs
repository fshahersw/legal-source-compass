// Case law v2: end-to-end check of a run's rows against the SQL contract, offline (PGlite; private sample data, so not
// part of the CI suites). Installs caselaw-read-v1.sql + caselaw-v2.sql, loads <run>/rows through the load RPCs exactly
// as load.py sends them, then for every loaded case reads caselaw_case_v2, follows each opinion pointer into the staged
// object (byte range), decompresses the member and checks it is that opinion's caselaw-read/1 record with a matching text
// hash; loads the texts with caselaw_load_text_v2 (prefix, 1,000 words) and runs full-text and citation lookups.
//   node scripts/caselaw_v2/sample_load_check.mjs private/build/w1025_caselaw/runs/sample
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";

const runtime =
  process.env.PUBLISHER_CODE_PGLITE ??
  path.resolve("private/tools/publisher-code-contract-tests/node_modules/@electric-sql/pglite/dist/index.js");
const { PGlite } = await import(pathToFileURL(runtime).href);
const runDir = process.argv[2];
const rowsDir = path.join(runDir, "rows");
const sha = (b) => createHash("sha256").update(b).digest("hex");
const jsonl = (p) =>
  (p.endsWith(".gz") ? zlib.gunzipSync(fs.readFileSync(p)) : fs.readFileSync(p)).toString("utf8").split("\n").filter(Boolean).map(JSON.parse);
const chunks = (a, n) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, (i + 1) * n));

const db = new PGlite();
const call = async (fn, args) => {
  const names = Object.keys(args);
  const sql = `select public.${fn}(${names.map((n, i) => `${n} => $${i + 1}`).join(", ")}) as r`;
  return (await db.query(sql, names.map((n) => args[n]))).rows[0].r;
};
await db.exec("create role anon; create role authenticated; create role service_role;");
await db.exec(fs.readFileSync("database/contracts/caselaw-read-v1.sql", "utf8"));
await db.exec(fs.readFileSync("database/contracts/caselaw-v2.sql", "utf8"));

const out = { counts: {}, failures: [] };
const count = (k, n = 1) => (out.counts[k] = (out.counts[k] ?? 0) + n);
const fail = (m) => out.failures.length < 50 && out.failures.push(m);

const courts = JSON.parse(fs.readFileSync(path.join(rowsDir, "courts.json"), "utf8"));
for (const b of chunks(courts, 2000)) count("courts", await call("caselaw_load_courts_v2", { p_rows: JSON.stringify(b) }));
const objects = jsonl(path.join(rowsDir, "objects.jsonl"));
const ids = await call("caselaw_load_objects_v1", { p_rows: JSON.stringify(objects) });
count("objects", Object.keys(ids).length);
for (const f of fs.readdirSync(rowsDir).filter((f) => f.startsWith("cases-p")).sort())
  for (const b of chunks(jsonl(path.join(rowsDir, f)), 1000))
    count("cases_loaded", await call("caselaw_load_cases_v2", { p_build: "v2-sample", p_rows: JSON.stringify(b) }));
for (const f of fs.readdirSync(rowsDir).filter((f) => f.startsWith("attach-u")).sort())
  for (const b of chunks(jsonl(path.join(rowsDir, f)), 500)) {
    const r = await call("caselaw_attach_opinions_v2", { p_build: "v2-sample", p_rows: JSON.stringify(b) });
    count("attach_changed", r.cases_changed);
    count("attach_missing_case", r.missing_case);
  }
await call("caselaw_refresh_court_counts_v2", {});

// every case: pointers -> staged bytes -> record
const cache = new Map();
const objectBytes = (key) => {
  if (!cache.has(key)) cache.set(key, fs.readFileSync(path.join(runDir, "staged", key)));
  return cache.get(key);
};
const textRows = [];
const cases = (await db.query("select cluster_id from caselaw.cases where tier between 4 and 7 order by cluster_id")).rows;
for (const { cluster_id } of cases) {
  const c = await call("caselaw_case_v2", { p_cluster_id: cluster_id });
  if (!c || !c.opinions.length) { fail(`case ${cluster_id}: no opinions`); continue; }
  for (const o of c.opinions) {
    const buf = objectBytes(o.key).subarray(o.s, o.s + o.n);
    const rec = JSON.parse(zlib.gunzipSync(buf).toString("utf8"));
    if (rec.format !== "caselaw-read/1" || rec.opinion_id !== o.id || rec.cluster_id !== cluster_id) fail(`case ${cluster_id}: pointer of ${o.id} reads another record`);
    else if (sha(Buffer.from(rec.text, "utf8")) !== rec.text_sha256) fail(`opinion ${o.id}: text hash`);
    else count("opinions_read_back");
    const blank = [];
    for (const [label, , off] of rec.pages ?? []) {
      const m = `*${label}`;
      if (Number.isInteger(off) && [...rec.text].slice(off, off + m.length).join("") === m && m.length >= 2 && m.length <= 24) blank.push([off, m.length]);
    }
    textRows.push({ opinion_id: rec.opinion_id, cluster_id, text: rec.text, text_sha256: rec.text_sha256, blank });
  }
  count("cases_checked");
}
for (const b of chunks(textRows, 200)) {
  const r = await call("caselaw_load_text_v2", { p_build: "v2-sample", p_scope: "prefix", p_rows: JSON.stringify(b), p_prefix_words: 1000 });
  count("text_rows", r.rows);
  count("text_missing", r.missing);
}
const status = await call("caselaw_status_v2", {});
out.status = { tiers: status.tiers, text_v2: status.text_v2 };
for (const q of ["summary judgment", "negligence", "\"due process\""]) {
  const f = await call("caselaw_fulltext_v2", { p_q: q, p_tiers: [4, 5, 6], p_limit: 5 });
  out.counts[`fulltext:${q}`] = f.rows.length;
}
// citations of loaded cases resolve back to them (or are reported ambiguous with them among the candidates)
const sample = (await db.query("select cluster_id, citations from caselaw.cases where tier between 4 and 7 and cardinality(citations) > 0 order by cluster_id limit 300")).rows;
for (const r of sample) {
  const res = await call("caselaw_resolve_v2", { p_citation: r.citations[0] });
  if (res.status === "resolved" && res.cluster_id === r.cluster_id) count("resolve_self");
  else if (res.status === "ambiguous" && res.candidates.some((c) => c.cluster_id === r.cluster_id)) count("resolve_ambiguous_with_self");
  else if (res.reason === "not_a_citation") count("resolve_unparsed");
  else fail(`citation ${r.citations[0]} of ${r.cluster_id}: ${res.status} ${res.reason ?? ""}`);
}
out.ok = out.failures.length === 0;
fs.writeFileSync(path.join(runDir, "sample_load_check.json"), JSON.stringify(out, null, 1) + "\n");
console.log(JSON.stringify(out, null, 1));
process.exit(out.ok ? 0 : 1);
