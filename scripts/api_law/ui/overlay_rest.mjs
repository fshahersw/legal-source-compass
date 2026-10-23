// Local, read-only REST overlay for UI checks of datasets that are built but not yet published (wave 1025, api-law).
//
//   LSC_OVERLAY_UPSTREAM=<real corpus URL> node scripts/api_law/ui/overlay_rest.mjs <port>
//
// Serves this worker's built datasets (private/build/w1025_api-law/**/<dataset>.header.json + rows) from memory and
// forwards every other request. Two engines: OVERLAY_ENGINE=js (default; a small evaluator of the PostgREST subset over
// the parsed rows, light enough for a crowded machine; RPC results come from snapshots written by the offline contract
// test, private/build/w1025_api-law/ui/rpc/<fn>.json) and OVERLAY_ENGINE=pglite (an in-memory PostgreSQL copy of the
// two corpus tables with corpus_detail as in production and the api-law contract RPCs). Every other request is forwarded unchanged to the upstream corpus REST API with the caller's own headers. Only
// GET and POST /rest/v1/rpc/* (read-only SQL functions) are accepted; anything else is refused. Nothing is written
// anywhere and no credential is printed. Supports the PostgREST subset the app uses: select (aliases, -> and ->>),
// eq/neq/gt/gte/lt/lte/in/cs/is/ilike/fts/plfts/wfts/phfts, order, limit/offset, Range and Prefer: count=exact.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { pathToFileURL } from "node:url";

const ROOT = path.resolve(new URL("../../..", import.meta.url).pathname);
const BUILD = path.join(ROOT, "private/build/w1025_api-law");
const port = Number(process.argv[2] || 4518);
const upstream = (process.env.LSC_OVERLAY_UPSTREAM || "").replace(/\/$/, "");
if (!upstream) {
  console.error("LSC_OVERLAY_UPSTREAM is not set");
  process.exit(2);
}
const ENGINE = process.env.OVERLAY_ENGINE === "pglite" ? "pglite" : "js";

const CORPUS = `
create role anon; create role authenticated; create role service_role;
create table public.corpus_datasets (id text primary key, label text not null, ready boolean not null default false,
  expected_records bigint not null default 0, imported_records bigint not null default 0, manifest_sha256 text,
  metadata jsonb not null default '{}', updated_at timestamptz not null default now());
create table public.corpus_records (dataset text not null references public.corpus_datasets(id), id text not null,
  category text not null, state text, county_geoids text[] not null default '{}', title text not null default '',
  source_url text, ordinal bigint not null default 0, item jsonb not null, detail jsonb not null default '{}',
  text text not null default '', filters jsonb not null default '{}', search_vector tsvector, primary key (dataset, id));
create index on public.corpus_records using gin (filters jsonb_path_ops);
create index on public.corpus_records using gin (search_vector);
create index on public.corpus_records (dataset, ordinal);
-- production definition (pg_get_functiondef, read 2026-10-23)
create or replace function public.corpus_detail(p_id text, p_datasets text[] default null, p_full boolean default false)
returns jsonb language sql stable set search_path to '' as $f$
  with selected as (
    select r.detail, r.text,
      case when r.detail->>'full_text_offloaded'='true' and r.detail->>'full_text_characters' ~ '^[0-9]{1,18}$'
        then greatest((r.detail->>'full_text_characters')::bigint, length(r.text)::bigint) else length(r.text)::bigint end
        as complete_characters
    from public.corpus_records r join public.corpus_datasets d on d.id = r.dataset and d.ready
    where r.id = p_id and (p_datasets is null or r.dataset = any(p_datasets))
    order by r.dataset limit 1
  ), preview as (select *, case when p_full then text else left(text, 60000) end as returned_text from selected)
  select detail || jsonb_build_object('text', returned_text, 'text_characters', complete_characters,
    'text_preview_characters', length(returned_text), 'text_truncated', length(returned_text) < complete_characters)
  from preview;
$f$;
`;

let db = null;
if (ENGINE === "pglite") {
  const runtime =
    process.env.PUBLISHER_CODE_PGLITE ??
    path.join(ROOT, "private/tools/publisher-code-contract-tests/node_modules/@electric-sql/pglite/dist/index.js");
  const { PGlite } = await import(pathToFileURL(runtime).href);
  db = new PGlite();
  await db.exec(CORPUS);
  for (const f of ["database/contracts/ingest-v1.sql", "database/contracts/api-law-v1.sql"])
    await db.exec(fs.readFileSync(path.join(ROOT, f), "utf8"));
}
const RPCS = new Set(["api_law_regs_overview_v1"]);
const RPC_SNAPSHOTS = path.join(BUILD, "ui/rpc");
/** js engine: dataset id → rows (with ordinal); catalog rows */
const LOCAL = new Map();
const CATALOG = [];

// ------------------------------------------------------------------ load the built datasets
const headers = [];
for (const dir of fs.readdirSync(BUILD))
  for (const f of fs.existsSync(path.join(BUILD, dir)) && fs.statSync(path.join(BUILD, dir)).isDirectory()
    ? fs.readdirSync(path.join(BUILD, dir))
    : [])
    if (f.endsWith(".header.json")) headers.push(path.join(BUILD, dir, f));
const MINE = new Set();
for (const h of headers) {
  const header = JSON.parse(fs.readFileSync(h, "utf8"));
  const rowsPath = h.replace(/\.header\.json$/, ".rows.jsonl.gz");
  if (!fs.existsSync(rowsPath)) continue;
  // OVERLAY_MAX_ROWS keeps memory low on a shared machine (the first rows of each build, newest first)
  const lines = zlib
    .gunzipSync(fs.readFileSync(rowsPath))
    .toString("utf8")
    .split("\n")
    .filter(Boolean)
    .slice(0, Number(process.env.OVERLAY_MAX_ROWS || 3000));
  const ds = header.dataset;
  MINE.add(ds);
  const metadata = {
    id: ds,
    label: header.label,
    ready: true,
    listing: { ...header.listing_block, total: lines.length },
    summary: { ...header.summary, published_by: "api_law/ui overlay (local, unpublished)" },
  };
  if (ENGINE === "js") {
    CATALOG.push({
      id: ds,
      label: header.label,
      ready: true,
      expected_records: lines.length,
      imported_records: lines.length,
      manifest_sha256: null,
      metadata,
      updated_at: new Date().toISOString(),
    });
    LOCAL.set(
      ds,
      lines.map((l, i) => {
        const r = JSON.parse(l);
        return { county_geoids: [], detail: {}, text: "", filters: {}, ...r, ordinal: i, _words: null };
      }),
    );
  } else {
    await db.query(
      "insert into public.corpus_datasets (id, label, ready, expected_records, imported_records, metadata) values ($1, $2, true, $3, $3, $4)",
      [ds, header.label, lines.length, JSON.stringify(metadata)],
    );
    for (let i = 0; i < lines.length; i += 1000) {
      const batch = lines.slice(i, i + 1000).map((l, j) => ({ ...JSON.parse(l), ordinal: i + j }));
      await db.query(
        `insert into public.corpus_records (dataset, id, category, state, title, source_url, ordinal, item, detail, text, filters, search_vector)
         select x.dataset, x.id, x.category, x.state, x.title, x.source_url, x.ordinal, x.item, coalesce(x.detail, '{}'), coalesce(x.text, ''),
                coalesce(x.filters, '{}'), to_tsvector('simple', coalesce(x.text, ''))
         from jsonb_to_recordset($1::jsonb) as x(dataset text, id text, category text, state text, title text, source_url text,
              ordinal bigint, item jsonb, detail jsonb, text text, filters jsonb)`,
        [JSON.stringify(batch)],
      );
    }
  }
  console.log(`overlay: ${ds} ${lines.length} rows`);
}

// ------------------------------------------------------------------ PostgREST subset → SQL
const ident = (s) => {
  if (!/^[a-z_][a-z0-9_]*$/.test(s)) throw new Error(`bad identifier ${s}`);
  return `"${s}"`;
};
/** col, col->a->b, col->>a → [sql, outputName] */
function colExpr(raw) {
  const parts = raw.split(/(->>|->)/);
  let sql = ident(parts[0]);
  let name = parts[0];
  for (let i = 1; i < parts.length; i += 2) {
    const key = parts[i + 1];
    sql += /^\d+$/.test(key) ? `${parts[i]}${key}` : `${parts[i]}'${key.replace(/'/g, "''")}'`;
    name = key;
  }
  return [sql, name];
}
function splitTop(s) {
  const out = [];
  let depth = 0;
  let cur = "";
  for (const ch of s) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  if (cur) out.push(cur);
  return out;
}
function selectSql(sel) {
  if (!sel || sel === "*") return "*";
  return splitTop(sel)
    .map((item) => {
      if (item === "*") return "*";
      const m = /^([a-z_][a-z0-9_]*):(.+)$/.exec(item);
      const [sql, name] = colExpr(m ? m[2] : item);
      return `${sql} as ${ident(m ? m[1] : name.replace(/[^a-z0-9_]/gi, "_").toLowerCase())}`;
    })
    .join(", ");
}
const listValues = (v) =>
  splitTop(v.replace(/^\(|\)$/g, "")).map((x) => x.replace(/^"(.*)"$/, "$1"));

function whereSql(params, args) {
  const conds = [];
  for (const [key, value] of params) {
    if (["select", "order", "limit", "offset"].includes(key)) continue;
    if (key === "or" || key === "and") throw new Error(`overlay does not support ${key}=`);
    const [col] = colExpr(key);
    const m = /^(not\.)?([a-z]+)(?:\(([a-z]+)\))?\.(.*)$/s.exec(value);
    if (!m) throw new Error(`bad filter ${key}=${value}`);
    const [, not, op, cfg, val] = m;
    let c;
    const p = (v) => {
      args.push(v);
      return `$${args.length}`;
    };
    switch (op) {
      case "eq": c = `${col}::text = ${p(val)}`; break;
      case "neq": c = `${col}::text <> ${p(val)}`; break;
      case "gt": case "gte": case "lt": case "lte": {
        const sym = { gt: ">", gte: ">=", lt: "<", lte: "<=" }[op];
        c = /^-?\d+(\.\d+)?$/.test(val) ? `${col} ${sym} ${p(val)}::numeric` : `${col}::text ${sym} ${p(val)}`;
        break;
      }
      case "in": c = `${col}::text = any(${p(listValues(val))}::text[])`; break;
      case "cs": c = val.startsWith("{") && key === "filters" ? `${col} @> ${p(val)}::jsonb` : val.startsWith("[") || val.startsWith("{\"") ? `${col} @> ${p(val)}::jsonb` : `${col} @> ${p(val)}::text[]`; break;
      case "ov": c = `${col} && ${p(val)}::text[]`; break;
      case "is": c = `${col} is ${val === "null" ? "null" : val === "true" ? "true" : "false"}`; break;
      case "ilike": case "like": c = `${col}::text ${op} ${p(val.replace(/\*/g, "%"))}`; break;
      case "fts": c = `${col} @@ to_tsquery(${p(cfg || "simple")}::regconfig, ${p(val)})`; break;
      case "plfts": c = `${col} @@ plainto_tsquery(${p(cfg || "simple")}::regconfig, ${p(val)})`; break;
      case "phfts": c = `${col} @@ phraseto_tsquery(${p(cfg || "simple")}::regconfig, ${p(val)})`; break;
      case "wfts": c = `${col} @@ websearch_to_tsquery(${p(cfg || "simple")}::regconfig, ${p(val)})`; break;
      default: throw new Error(`overlay does not support operator ${op}`);
    }
    conds.push(not ? `not (${c})` : c);
  }
  return conds.length ? `where ${conds.join(" and ")}` : "";
}
function orderSql(order) {
  if (!order) return "";
  return (
    "order by " +
    order
      .split(",")
      .map((o) => {
        const [c, ...mods] = o.split(".");
        const [sql] = colExpr(c);
        return [sql, mods.includes("desc") ? "desc" : "asc", mods.includes("nullsfirst") ? "nulls first" : mods.includes("nullslast") ? "nulls last" : ""].join(" ");
      })
      .join(", ")
  );
}
async function runSelect(table, params, rangeHeader, wantCount) {
  const args = [];
  const where = whereSql(params, args);
  let limit = params.get("limit") ? Number(params.get("limit")) : null;
  let offset = params.get("offset") ? Number(params.get("offset")) : 0;
  const rm = rangeHeader ? /^(\d+)-(\d+)$/.exec(rangeHeader) : null;
  if (rm) {
    offset = Number(rm[1]);
    limit = Math.min(limit ?? Infinity, Number(rm[2]) - Number(rm[1]) + 1);
  }
  const sql = `select ${selectSql(params.get("select"))} from public.${ident(table)} ${where} ${orderSql(params.get("order"))}${limit != null && Number.isFinite(limit) ? ` limit ${limit}` : ""}${offset ? ` offset ${offset}` : ""}`;
  const rows = (await db.query(sql, args)).rows;
  let total = null;
  if (wantCount) total = (await db.query(`select count(*)::int as n from public.${ident(table)} ${where}`, args)).rows[0].n;
  return { rows, total, offset };
}


// ------------------------------------------------------------------ js engine (PostgREST subset over parsed rows)
function pathOf(raw) {
  const parts = raw.split(/(->>|->)/);
  if (!/^[a-z_][a-z0-9_]*$/.test(parts[0])) throw new Error(`bad identifier ${parts[0]}`);
  const steps = [];
  for (let i = 1; i < parts.length; i += 2) steps.push({ text: parts[i] === "->>", key: parts[i + 1] });
  return { col: parts[0], steps, name: steps.length ? steps[steps.length - 1].key : parts[0] };
}
function valueAt(row, raw) {
  const { col, steps } = pathOf(raw);
  let v = row[col];
  for (const st of steps) {
    v = v == null || typeof v !== "object" ? null : Array.isArray(v) ? v[Number(st.key)] : v[st.key];
    if (v === undefined) v = null;
    if (st.text && v != null && typeof v !== "string") v = JSON.stringify(v);
  }
  return v === undefined ? null : v;
}
const words = (row) => (row._words ??= new Set(String(row.text ?? "").toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []));
function tsMatch(row, op, val) {
  const ws = words(row);
  const terms =
    op === "fts"
      ? val.split(/[&|]/).map((t) => t.trim().replace(/^!/, ""))
      : (val.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []);
  return terms.every((t) => {
    const prefix = t.endsWith(":*");
    const w = t.replace(/:\*$/, "").toLowerCase();
    if (!prefix) return ws.has(w);
    for (const x of ws) if (x.startsWith(w)) return true;
    return false;
  });
}
function predicate(key, value) {
  const m = /^(not\.)?([a-z]+)(?:\(([a-z]+)\))?\.(.*)$/s.exec(value);
  if (!m) throw new Error(`bad filter ${key}=${value}`);
  const [, not, op, , val] = m;
  const num = (x) => (x !== null && x !== "" && !Number.isNaN(Number(x)) ? Number(x) : null);
  let f;
  switch (op) {
    case "eq": f = (r) => { const v = valueAt(r, key); return v != null && String(v) === val; }; break;
    case "neq": f = (r) => { const v = valueAt(r, key); return v != null && String(v) !== val; }; break;
    case "gt": case "gte": case "lt": case "lte": f = (r) => {
      const v = valueAt(r, key);
      if (v == null) return false;
      const a = num(v) != null && num(val) != null ? num(v) : String(v);
      const b = num(v) != null && num(val) != null ? num(val) : val;
      return op === "gt" ? a > b : op === "gte" ? a >= b : op === "lt" ? a < b : a <= b;
    }; break;
    case "in": { const set = new Set(listValues(val)); f = (r) => { const v = valueAt(r, key); return v != null && set.has(String(v)); }; break; }
    case "cs": {
      if (val.startsWith("{\"") || val.startsWith("[")) {
        const want = JSON.parse(val);
        const contains = (have, need) => {
          if (Array.isArray(need)) return Array.isArray(have) && need.every((n) => have.some((h) => contains(h, n)));
          if (need && typeof need === "object") return have && typeof have === "object" && Object.entries(need).every(([k, n]) => contains(have[k], n));
          return have === need;
        };
        f = (r) => contains(valueAt(r, key), want);
      } else {
        const want = listValues(val.replace(/^\{|\}$/g, ""));
        f = (r) => { const v = valueAt(r, key); return Array.isArray(v) && want.every((w) => v.includes(w)); };
      }
      break;
    }
    case "ov": { const want = listValues(val.replace(/^\{|\}$/g, "")); f = (r) => { const v = valueAt(r, key); return Array.isArray(v) && want.some((w) => v.includes(w)); }; break; }
    case "is": f = (r) => { const v = valueAt(r, key); return val === "null" ? v == null : v === (val === "true"); }; break;
    case "ilike": case "like": {
      const re = new RegExp("^" + val.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/[*%]/g, ".*") + "$", op === "ilike" ? "is" : "s");
      f = (r) => { const v = valueAt(r, key); return v != null && re.test(String(v)); };
      break;
    }
    case "fts": case "plfts": case "phfts": case "wfts": f = (r) => tsMatch(r, op, val); break;
    default: throw new Error(`overlay does not support operator ${op}`);
  }
  return not ? (r) => !f(r) : f;
}
function jsSelect(table, params, rangeHeader, wantCount) {
  let rows;
  if (table === "corpus_datasets") rows = CATALOG;
  else {
    const d = params.get("dataset") ?? "";
    const ids = d.startsWith("eq.") ? [d.slice(3)] : d.startsWith("in.") ? listValues(d.slice(3)) : [];
    rows = ids.flatMap((x) => LOCAL.get(x) ?? []);
  }
  for (const [key, value] of params) {
    if (["select", "order", "limit", "offset"].includes(key)) continue;
    if (key === "or" || key === "and") throw new Error(`overlay does not support ${key}=`);
    const pr = predicate(key, value);
    rows = rows.filter(pr);
  }
  const order = params.get("order");
  if (order) {
    const keys = order.split(",").map((o) => {
      const [c, ...mods] = o.split(".");
      return { c, desc: mods.includes("desc") };
    });
    rows = [...rows].sort((a, b) => {
      for (const k of keys) {
        const x = valueAt(a, k.c);
        const y = valueAt(b, k.c);
        if (x === y) continue;
        if (x == null) return 1;
        if (y == null) return -1;
        const r = x < y ? -1 : 1;
        return k.desc ? -r : r;
      }
      return 0;
    });
  }
  const total = rows.length;
  let limit = params.get("limit") ? Number(params.get("limit")) : Infinity;
  let offset = params.get("offset") ? Number(params.get("offset")) : 0;
  const rm = rangeHeader ? /^(\d+)-(\d+)$/.exec(rangeHeader) : null;
  if (rm) {
    offset = Number(rm[1]);
    limit = Math.min(limit, Number(rm[2]) - Number(rm[1]) + 1);
  }
  rows = rows.slice(offset, offset + limit);
  const sel = params.get("select");
  const items = !sel || sel === "*" ? null : splitTop(sel);
  const project = (r) => {
    if (!items) {
      const { _words, ...rest } = r;
      return rest;
    }
    const out = {};
    for (const item of items) {
      if (item === "*") {
        const { _words, ...rest } = r;
        Object.assign(out, rest);
        continue;
      }
      const m = /^([a-z_][a-z0-9_]*):(.+)$/.exec(item);
      const raw = m ? m[2] : item;
      out[m ? m[1] : pathOf(raw).name] = valueAt(r, raw);
    }
    return out;
  };
  return { rows: rows.map(project), total: wantCount ? total : null, offset };
}
function jsRpc(fn, args) {
  if (fn === "corpus_detail") {
    for (const d of args.p_datasets ?? []) {
      const r = (LOCAL.get(d) ?? []).find((x) => x.id === args.p_id);
      if (!r) continue;
      const text = String(r.text ?? "");
      const shown = args.p_full ? text : text.slice(0, 60000);
      return { ...(r.detail ?? {}), text: shown, text_characters: text.length, text_preview_characters: shown.length, text_truncated: shown.length < text.length };
    }
    return null;
  }
  const snap = path.join(RPC_SNAPSHOTS, `${fn}.json`);
  return fs.existsSync(snap) ? JSON.parse(fs.readFileSync(snap, "utf8")) : null;
}

// ------------------------------------------------------------------ routing
const targetsMine = (table, params) => {
  if (table === "corpus_records") {
    const d = params.get("dataset");
    if (!d) return "no";
    if (d.startsWith("eq.")) return MINE.has(d.slice(3)) ? "all" : "no";
    if (d.startsWith("in.")) {
      const v = listValues(d.slice(3));
      return v.every((x) => MINE.has(x)) ? "all" : v.some((x) => MINE.has(x)) ? "some" : "no";
    }
    return "no";
  }
  if (table === "corpus_datasets") {
    const id = params.get("id");
    if (id?.startsWith("eq.")) return MINE.has(id.slice(3)) ? "all" : "no";
    if (id?.startsWith("in.")) {
      const v = listValues(id.slice(3));
      return v.every((x) => MINE.has(x)) ? "all" : v.some((x) => MINE.has(x)) ? "some" : "no";
    }
    return "some"; // a catalog listing: production rows plus the overlay's
  }
  return "no";
};

async function forward(req, body) {
  const hdrs = {};
  for (const k of ["apikey", "authorization", "accept", "content-type", "prefer", "range", "accept-profile", "content-profile"])
    if (req.headers[k]) hdrs[k] = req.headers[k];
  const res = await fetch(upstream + req.url, { method: req.method, headers: hdrs, ...(body ? { body } : {}) });
  const out = Buffer.from(await res.arrayBuffer());
  const h = { "content-type": res.headers.get("content-type") || "application/json" };
  if (res.headers.get("content-range")) h["content-range"] = res.headers.get("content-range");
  return { status: res.status, headers: h, body: out };
}
const send = (res, r) => {
  res.writeHead(r.status, r.headers);
  res.end(r.body);
};
const json = (status, data, extra = {}) => ({
  status,
  headers: { "content-type": "application/json", ...extra },
  body: Buffer.from(JSON.stringify(data)),
});

http
  .createServer(async (req, res) => {
    try {
      const u = new URL(req.url, "http://overlay");
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const body = chunks.length ? Buffer.concat(chunks) : null;
      const rpc = /^\/rest\/v1\/rpc\/([a-z0-9_]+)$/.exec(u.pathname);
      if (req.method === "POST" && rpc) {
        const args = body ? JSON.parse(body.toString("utf8")) : {};
        const mineDetail =
          rpc[1] === "corpus_detail" && Array.isArray(args.p_datasets) && args.p_datasets.every((d) => MINE.has(d));
        if ((RPCS.has(rpc[1]) || mineDetail) && ENGINE === "js") return send(res, json(200, jsRpc(rpc[1], args)));
        if (RPCS.has(rpc[1]) || mineDetail) {
          const names = Object.keys(args);
          const call = `select public.${ident(rpc[1])}(${names.map((n, i) => `${ident(n)} => $${i + 1}`).join(", ")}) as r`;
          const r = await db.query(call, names.map((n) => args[n]));
          return send(res, json(200, r.rows[0]?.r ?? null));
        }
        return send(res, await forward(req, body));
      }
      if (req.method !== "GET" && req.method !== "HEAD") return send(res, json(405, { message: "overlay is read-only" }));
      const t = /^\/rest\/v1\/([a-z_]+)$/.exec(u.pathname);
      if (!t) return send(res, await forward(req, null));
      const table = t[1];
      const which = targetsMine(table, u.searchParams);
      if (which === "no") return send(res, await forward(req, null));
      const wantCount = /count=exact/.test(req.headers["prefer"] || "");
      const local =
        ENGINE === "js"
          ? jsSelect(table, u.searchParams, req.headers["range"], wantCount)
          : await runSelect(table, u.searchParams, req.headers["range"], wantCount);
      if (which === "all") {
        const end = local.offset + local.rows.length - 1;
        const cr = wantCount ? `${local.rows.length ? `${local.offset}-${end}` : "*"}/${local.total}` : null;
        return send(res, json(200, local.rows, cr ? { "content-range": cr } : {}));
      }
      // mixed: upstream rows first, then the overlay's
      const up = await forward(req, null);
      if (up.status >= 300) return send(res, up);
      const merged = [...JSON.parse(up.body.toString("utf8")), ...local.rows];
      return send(res, json(200, merged));
    } catch (e) {
      console.error("overlay error:", String(e).slice(0, 300));
      send(res, json(500, { message: String(e).slice(0, 300) }));
    }
  })
  .listen(port, "127.0.0.1", () => console.log(`overlay listening on ${port} (${MINE.size} datasets, ${ENGINE} engine)`));
