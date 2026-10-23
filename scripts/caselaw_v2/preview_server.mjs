// Case law v2: preview a run with the real app before anything is loaded into production.
//   node scripts/caselaw_v2/preview_server.mjs private/build/w1025_caselaw/runs/sample 4599
// Starts a local stand-in for the corpus API on the given port:
//   POST /rest/v1/rpc/caselaw_*      answered by an in-memory PostgreSQL (PGlite) holding caselaw-read-v1.sql +
//                                    caselaw-v2.sql and the run's rows (loaded through the load RPCs, texts indexed
//                                    as a 1,000-word prefix);
//   GET  /storage/v1/object/...      a staged object of the run, served with HTTP Range (206) like Supabase Storage;
//   anything else                    forwarded unchanged (read-only GET / RPC POST) to the real corpus when
//                                    UPSTREAM_URL / UPSTREAM_KEY are set, else 404.
// Point the dev server at it: EXTERNAL_SUPABASE_URL=http://127.0.0.1:<port> EXTERNAL_SUPABASE_KEY=preview.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { pathToFileURL } from "node:url";

const runtime =
  process.env.PUBLISHER_CODE_PGLITE ??
  path.resolve("private/tools/publisher-code-contract-tests/node_modules/@electric-sql/pglite/dist/index.js");
const { PGlite } = await import(pathToFileURL(runtime).href);
const [runDir, portArg] = process.argv.slice(2);
const port = Number(portArg || 4599);
const rowsDir = path.join(runDir, "rows");
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
for (const b of chunks(JSON.parse(fs.readFileSync(path.join(rowsDir, "courts.json"), "utf8")), 2000))
  await call("caselaw_load_courts_v2", { p_rows: JSON.stringify(b) });
await call("caselaw_load_objects_v1", { p_rows: JSON.stringify(jsonl(path.join(rowsDir, "objects.jsonl"))) });
for (const f of fs.readdirSync(rowsDir).filter((f) => f.startsWith("cases-p")).sort())
  for (const b of chunks(jsonl(path.join(rowsDir, f)), 1000)) await call("caselaw_load_cases_v2", { p_build: "preview", p_rows: JSON.stringify(b) });
for (const f of fs.readdirSync(rowsDir).filter((f) => f.startsWith("attach-u")).sort())
  for (const b of chunks(jsonl(path.join(rowsDir, f)), 500)) await call("caselaw_attach_opinions_v2", { p_build: "preview", p_rows: JSON.stringify(b) });
await call("caselaw_refresh_court_counts_v2", {});
// index the texts (first 1,000 words) so full-text search answers
const texts = [];
const objCache = new Map();
for (const f of fs.readdirSync(rowsDir).filter((f) => f.startsWith("attach-u")).sort())
  for (const row of jsonl(path.join(rowsDir, f)))
    for (const o of row.opinions) {
      if (!objCache.has(o.key)) objCache.set(o.key, fs.readFileSync(path.join(runDir, "staged", o.key)));
      const r = JSON.parse(zlib.gunzipSync(objCache.get(o.key).subarray(o.s, o.s + o.n)).toString("utf8"));
      texts.push({ opinion_id: r.opinion_id, cluster_id: r.cluster_id, text: r.text, text_sha256: r.text_sha256 });
    }
for (const b of chunks(texts, 200))
  await call("caselaw_load_text_v2", { p_build: "preview", p_scope: "prefix", p_rows: JSON.stringify(b), p_prefix_words: 1000 });
console.log(`[preview] ${texts.length} opinions indexed; listening on ${port}`);

const UP = process.env.UPSTREAM_URL?.replace(/\/$/, "");
const UPKEY = process.env.UPSTREAM_KEY;
const known = new Set(
  (await db.query("select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'")).rows.map(
    (r) => r.proname,
  ),
);

async function forward(req, res, body) {
  if (!UP || !UPKEY || !(req.method === "GET" || (req.method === "POST" && req.url.startsWith("/rest/v1/rpc/")))) {
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ code: "PGRST202", message: "Could not find the function (preview)" }));
    return;
  }
  const headers = { apikey: UPKEY, accept: req.headers["accept"] ?? "application/json" };
  if (!UPKEY.startsWith("sb_")) headers.authorization = `Bearer ${UPKEY}`;
  for (const h of ["range", "content-type", "prefer"]) if (req.headers[h]) headers[h] = req.headers[h];
  const r = await fetch(UP + req.url, { method: req.method, headers, body: req.method === "POST" ? body : undefined });
  const buf = Buffer.from(await r.arrayBuffer());
  const out = {};
  for (const h of ["content-type", "content-range"]) if (r.headers.get(h)) out[h] = r.headers.get(h);
  res.writeHead(r.status, out);
  res.end(buf);
}

http
  .createServer(async (req, res) => {
    const chunksIn = [];
    for await (const c of req) chunksIn.push(c);
    const body = Buffer.concat(chunksIn).toString("utf8");
    try {
      const m = /^\/rest\/v1\/rpc\/([a-z0-9_]+)$/.exec(req.url ?? "");
      if (req.method === "POST" && m && m[1].startsWith("caselaw_") && known.has(m[1])) {
        const args = body ? JSON.parse(body) : {};
        try {
          const r = await call(m[1], args);
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify(r));
        } catch (e) {
          res.writeHead(400, { "content-type": "application/json" });
          res.end(JSON.stringify({ code: e.code ?? "P0001", message: String(e.message ?? e) }));
        }
        return;
      }
      const s = /^\/storage\/v1\/object\/(?:authenticated\/)?corpus-originals\/(.+)$/.exec(req.url ?? "");
      const local = s ? path.join(runDir, "staged", decodeURIComponent(s[1].split("?")[0])) : null;
      if (local && fs.existsSync(local)) {
        const data = fs.readFileSync(local);
        const rg = /^bytes=(\d+)-(\d+)$/.exec(req.headers["range"] ?? "");
        if (rg) {
          const a = Number(rg[1]);
          const b = Math.min(Number(rg[2]), data.length - 1);
          res.writeHead(206, { "content-type": "application/gzip", "content-range": `bytes ${a}-${b}/${data.length}` });
          res.end(data.subarray(a, b + 1));
        } else {
          res.writeHead(200, { "content-type": "application/gzip" });
          res.end(data);
        }
        return;
      }
      await forward(req, res, body);
    } catch (e) {
      res.writeHead(500);
      res.end(String(e));
    }
  })
  .listen(port, "127.0.0.1");
