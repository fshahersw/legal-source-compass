// Dev-only mock of the corpus PostgREST for UI checks of the safety/1 pages: answers POST /rest/v1/rpc/<fn> for the
// safety_* and product_signals_v1 functions by running them in an in-memory PGlite holding
// database/contracts/safety-signals-v1.sql and the staged builder chunks (loaded through safety_load_v1, as load.py
// does); every other request gets an empty JSON array. Binds 127.0.0.1 only; no credentials.
//   node scripts/safety_v2/dev_mock_corpus.mjs <port> <build dir> [...]
//   EXTERNAL_SUPABASE_URL=http://127.0.0.1:<port> EXTERNAL_SUPABASE_KEY=mock-key LSC_PORT=<dev port> \
//     node private/scratch/with_server.mjs <screenshot script> ...
import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath, pathToFileURL } from "node:url";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const { PGlite } = await import(pathToFileURL(path.join(ROOT, "private/tools/publisher-code-contract-tests/node_modules/@electric-sql/pglite/dist/index.js")).href);
const [port, ...dirs] = process.argv.slice(2);
const db = new PGlite();
await db.exec(`create role anon; create role authenticated; create role service_role;
  create table public.corpus_records (dataset text not null, id text not null, title text, source_url text,
    item jsonb not null default '{}', filters jsonb not null default '{}', primary key (dataset, id));`);
await db.exec(await fs.readFile(path.join(ROOT, "database/contracts/safety-signals-v1.sql"), "utf8"));
const ORDER = ["subjects", "mdl_subjects", "series", "series_patch", "breakdowns", "maude_reports", "nhtsa_complaints", "record_subjects",
  "neiss_cases", "cfpb_monthly", "cfpb_complaints", "osha_inspections", "osha_violations", "osha_accidents", "open_payments"];
const list = [];
async function* walk(d) { for (const e of await fs.readdir(d, { withFileTypes: true })) { const p = path.join(d, e.name);
  if (e.isDirectory()) yield* walk(p); else if (e.name === "index.jsonl" && path.basename(d) === "chunks") yield p; } }
for (const d of dirs) for await (const ix of walk(d)) for (const l of (await fs.readFile(ix, "utf8")).split("\n").filter(Boolean)) {
  const ch = JSON.parse(l); list.push({ ...ch, path: path.join(path.dirname(ix), ch.file) }); }
list.sort((a, b) => ORDER.indexOf(a.target) - ORDER.indexOf(b.target));
for (const ch of list) {
  let rows; try { rows = zlib.gunzipSync(await fs.readFile(ch.path)).toString().split("\n").filter(Boolean).map((x) => JSON.parse(x)); } catch { continue; }
  const opts = { ...(ch.opts ?? {}), ...(ch.target === "neiss_cases" ? { confirmed_by_lead: "2026-10-25 ui check" } : {}) };
  try { await db.query("select public.safety_load_v1($1,$2::jsonb,$3::jsonb,'{}'::jsonb)", [ch.target, JSON.stringify(rows), JSON.stringify(opts)]); }
  catch (e) { console.error("load", ch.file, e.message.slice(0, 200)); }
}
console.log("mock loaded", list.length, "chunks");
http.createServer(async (req, res) => {
  let body = ""; for await (const c of req) body += c;
  const m = /^\/rest\/v1\/rpc\/(safety_[a-z0-9_]{1,40}|product_signals_v1)$/.exec(req.url.split("?")[0]);
  if (req.method === "POST" && m) {
    let args;
    try { args = body ? JSON.parse(body) : {}; } catch { args = null; }
    const names = args && typeof args === "object" ? Object.keys(args) : [];
    if (!args || names.some((n) => !/^p_[a-z0-9_]{1,40}$/.test(n))) {
      res.writeHead(400, { "Content-Type": "application/json" }); res.end(JSON.stringify({ message: "bad arguments" })); return;
    }
    const call = `public.${m[1]}(${names.map((n, i) => `${n} => $${i + 1}`).join(",")})`;
    const table = m[1] === "product_signals_v1";
    const sql = table ? `select to_jsonb(r) as v from ${call} r` : `select ${call} as v`;
    try {
      const vals = names.map((n) => (args[n] !== null && typeof args[n] === "object" ? JSON.stringify(args[n]) : args[n]));
      const out = (await db.query(sql, vals)).rows.map((x) => x.v);
      const result = table ? out : out[0] ?? null;
      res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify(result));
    } catch (e) { res.writeHead(400, { "Content-Type": "application/json" }); res.end(JSON.stringify({ message: e.message })); }
    return;
  }
  res.writeHead(200, { "Content-Type": "application/json", "Content-Range": "0-0/0" }); res.end("[]");
}).listen(Number(port), "127.0.0.1", () => console.log("mock corpus on", port));
