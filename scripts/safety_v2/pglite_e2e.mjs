// End-to-end check of the staged builder output against the SQL contract, offline: apply
// database/contracts/safety-signals-v1.sql to an in-memory PGlite, load every chunk of the given build dirs through
// public.safety_load_v1 (dependency order, as scripts/safety_v2/load.py does), then call the read RPCs and report rows and
// bytes per table (the size basis of the RUNBOOK's budget).
//   node scripts/safety_v2/pglite_e2e.mjs <build dir> [...] [--mdl 2740] [--subject faers:docetaxel] [--confirm-neiss]
import fs from "node:fs/promises";
import path from "node:path";
import zlib from "node:zlib";
import { pathToFileURL } from "node:url";

const runtime =
  process.env.PUBLISHER_CODE_PGLITE ??
  path.resolve(
    "private/tools/publisher-code-contract-tests/node_modules/@electric-sql/pglite/dist/index.js",
  );
const { PGlite } = await import(pathToFileURL(runtime).href);
const ORDER = [
  "subjects",
  "mdl_subjects",
  "series",
  "series_patch",
  "breakdowns",
  "maude_reports",
  "nhtsa_complaints",
  "record_subjects",
  "neiss_cases",
  "cfpb_monthly",
  "cfpb_complaints",
  "osha_inspections",
  "osha_violations",
  "osha_accidents",
  "open_payments",
];

const argv = process.argv.slice(2);
const flag = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv.splice(i, 2)[1] : null;
};
const mdls = [];
const subjects = [];
let m;
while ((m = flag("--mdl"))) mdls.push(m);
while ((m = flag("--subject"))) subjects.push(m);
const confirmNeiss = argv.includes("--confirm-neiss")
  ? (argv.splice(argv.indexOf("--confirm-neiss"), 1), true)
  : false;
const dirs = argv;

async function* walk(dir) {
  for (const e of await fs.readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else if (e.name === "index.jsonl" && path.basename(dir) === "chunks") yield p;
  }
}

const db = new PGlite();
await db.exec(`create role anon; create role authenticated; create role service_role;
  create table public.corpus_records (dataset text not null, id text not null, title text, source_url text,
    item jsonb not null default '{}', filters jsonb not null default '{}', primary key (dataset, id));`);
await db.exec(await fs.readFile("database/contracts/safety-signals-v1.sql", "utf8"));

const list = [];
for (const d of dirs) {
  for await (const index of walk(d)) {
    for (const line of (await fs.readFile(index, "utf8")).split("\n").filter(Boolean)) {
      const ch = JSON.parse(line);
      list.push({ ...ch, path: path.join(path.dirname(index), ch.file) });
    }
  }
}
list.sort(
  (a, b) => ORDER.indexOf(a.target) - ORDER.indexOf(b.target) || a.path.localeCompare(b.path),
);
const totals = {};
const started = Date.now();
for (const ch of list) {
  let rows;
  try {
    rows = zlib
      .gunzipSync(await fs.readFile(ch.path))
      .toString("utf8")
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l));
  } catch {
    continue; // a chunk already deleted after a load
  }
  const opts = { ...(ch.opts ?? {}) };
  if (ch.target === "neiss_cases") {
    if (!confirmNeiss) continue;
    opts.confirmed_by_lead = "2026-10-25 offline e2e check";
  }
  const r = (
    await db.query("select public.safety_load_v1($1, $2::jsonb, $3::jsonb, $4::jsonb) r", [
      ch.target,
      JSON.stringify(rows),
      JSON.stringify(opts),
      JSON.stringify({ source: ch.source ?? "", part: ch.file, sha256: ch.sha256 }),
    ])
  ).rows[0].r;
  const t = (totals[ch.target] ??= {
    chunks: 0,
    rows: 0,
    inserted: 0,
    updated: 0,
    unchanged: 0,
    deleted: 0,
  });
  t.chunks += 1;
  t.rows += rows.length;
  for (const k of ["inserted", "updated", "unchanged", "deleted"]) t[k] += r[k];
}
console.log(JSON.stringify({ loaded: totals, seconds: Math.round((Date.now() - started) / 1000) }));

const sizes = (
  await db.query(`select c.relname t, (select count(*) from pg_class x where x.oid = c.oid) _x,
      pg_total_relation_size(c.oid) bytes, c.reltuples from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'safety' and c.relkind = 'r' order by 1`)
).rows;
const counts = {};
for (const s of sizes) {
  const n = (await db.query(`select count(*)::int n from safety.${s.t}`)).rows[0].n;
  if (n)
    counts[s.t] = {
      rows: n,
      bytes: Number(s.bytes),
      bytes_per_row: Math.round(Number(s.bytes) / n),
    };
}
console.log(JSON.stringify({ tables: counts }));

for (const mdl of mdls) {
  const rows = (await db.query("select * from public.product_signals_v1($1)", [mdl])).rows;
  const by = {};
  for (const r of rows) {
    const b = (by[r.series] ??= {
      months: 0,
      total: 0,
      first: r.month,
      last: r.month,
      source_dataset: r.source_dataset,
    });
    b.months += 1;
    b.total += Number(r.value);
    b.last = r.month;
  }
  console.log(JSON.stringify({ mdl, series: by, basis: rows[0]?.basis ?? null }));
}
for (const id of subjects) {
  const p = (await db.query("select public.safety_subject_v1($1) p", [id])).rows[0].p;
  console.log(
    JSON.stringify({
      subject: id,
      label: p?.subject?.label,
      mdls: p?.mdls?.map((x) => [x.mdl, x.basis]),
      series: p?.series?.map((s) => [s.series, s.coverage_from, s.coverage_to, s.total]),
      breakdowns: Object.fromEntries(
        Object.entries(p?.breakdowns ?? {}).map(([k, v]) => [k, v.rows.slice(0, 3)]),
      ),
      quarters: p?.quarters?.length,
      records: p?.records,
    }),
  );
}
