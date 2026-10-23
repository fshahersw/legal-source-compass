// Offline end-to-end test of database/contracts/semantic-refresh-v1.sql driven by the real refresh core
// (supabase/functions/semantic-refresh/refresh.ts) with a fake embedding service. No credentials, network or live data.
//
// PGlite has no pgvector, so (as in semantic-sql.test.mjs) the vector type is a text domain with the same SQL surface;
// what this proves: the contract's own logic (projection = Python prune, trigger capture, sweep, prune, pending, known
// keys, budget reservations against the daily and global caps, cache, apply/remove/no_doc with grace and guards, corpora
// counts, grants) and that the TypeScript core and the SQL agree end to end on the golden fixture rows. What it cannot
// prove: pgvector storage and the HNSW index (checked live by the runbook's verification queries).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const runtime =
  process.env.PUBLISHER_CODE_PGLITE ??
  path.resolve(
    "private/tools/publisher-code-contract-tests/node_modules/@electric-sql/pglite/dist/index.js",
  );
const { PGlite } = await import(pathToFileURL(runtime).href);
const { runRefresh, planRecord } =
  await import("../../supabase/functions/semantic-refresh/refresh.ts");

const golden = JSON.parse(await fs.readFile("src/lib/semantic/fixtures/chunk-golden.json", "utf8"));
const sample = JSON.parse(
  await fs.readFile("src/lib/semantic/fixtures/semantic-rows.json", "utf8"),
);

const SHIM = `
create schema extensions;
create domain extensions.halfvec as text;
create function extensions.hv_arr(v text) returns float8[] language sql immutable as $$ select string_to_array(trim(both '[]' from v), ',')::float8[] $$;
create function extensions.vector_dims(v extensions.halfvec) returns integer language sql immutable as $$ select cardinality(extensions.hv_arr(v)) $$;
create function extensions.hv_cos(a extensions.halfvec, b extensions.halfvec) returns float8 language sql immutable as $$
  select 1 - sum(x * y) / nullif(sqrt(sum(x * x)) * sqrt(sum(y * y)), 0) from unnest(extensions.hv_arr(a), extensions.hv_arr(b)) t(x, y) $$;
create operator extensions.<=> (leftarg = extensions.halfvec, rightarg = extensions.halfvec, function = extensions.hv_cos);
create function extensions.hv_ne(a extensions.halfvec, b extensions.halfvec) returns boolean language sql immutable as $$ select extensions.hv_arr(a) <> extensions.hv_arr(b) $$;
create operator extensions.<> (leftarg = extensions.halfvec, rightarg = extensions.halfvec, function = extensions.hv_ne);
create function extensions.hv_avg_step(s float8[], v extensions.halfvec) returns float8[] language sql immutable as $$
  select case when s is null then extensions.hv_arr(v) || 1::float8
    else (select array_agg(a + b order by i) from unnest(s[1:cardinality(s) - 1], extensions.hv_arr(v)) with ordinality t(a, b, i)) || (s[cardinality(s)] + 1) end $$;
create function extensions.hv_avg_final(s float8[]) returns extensions.halfvec language sql immutable as $$
  select ('[' || array_to_string((select array_agg(a / s[cardinality(s)] order by i) from unnest(s[1:cardinality(s) - 1]) with ordinality t(a, i)), ',') || ']')::extensions.halfvec $$;
create aggregate extensions.avg(extensions.halfvec) (sfunc = extensions.hv_avg_step, stype = float8[], finalfunc = extensions.hv_avg_final);
`;
const CORPUS = `
create table public.corpus_datasets (id text primary key, label text not null default '', ready boolean not null default true);
create table public.corpus_records (
  dataset text not null, id text not null, category text not null default 'x', state text, county_geoids text[] not null default '{}',
  title text not null default '', source_url text, ordinal bigint not null default 0, item jsonb not null default '{}',
  detail jsonb not null default '{}', text text not null default '', filters jsonb not null default '{}', primary key (dataset, id));
`;
const HNSW =
  /create index if not exists chunks_embedding_hnsw on semantic\.chunks using hnsw \(embedding extensions\.halfvec_cosine_ops\) with \(m = 16, ef_construction = 64\);/;
const DATASETS = [
  "us_code_sections",
  "ecfr_sections_full",
  "crs_reports",
  "congress_bills",
  "oversight_reports",
  "doj_oig_reports",
  "ftc_publications_index",
  "caselaw_scotus",
];

const shim = (sql) =>
  sql
    .replace(HNSW, "")
    .replace("create extension if not exists vector with schema extensions;", "")
    .replaceAll("extensions.halfvec(1024)", "extensions.halfvec");

async function setup() {
  const db = new PGlite();
  await db.exec("create role anon; create role authenticated; create role service_role;");
  await db.exec(SHIM);
  await db.exec(CORPUS);
  await db.exec(shim(await fs.readFile("database/contracts/semantic-v1.sql", "utf8")));
  const contract = await fs.readFile("database/contracts/semantic-refresh-v1.sql", "utf8");
  await db.exec(shim(contract));
  const types = new Map();
  const procs = await db.query(
    `select p.proname, p.proargnames, array(select format_type(t, null) from unnest(p.proargtypes) t) as types
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname like 'semantic_%'`,
  );
  for (const p of procs.rows)
    types.set(p.proname, Object.fromEntries((p.proargnames ?? []).map((a, i) => [a, p.types[i]])));
  const arr = (xs) =>
    `{${xs.map((x) => `"${String(x).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`).join(",")}}`;
  const rpc = async (name, args = {}) => {
    const t = types.get(name);
    assert.ok(t, `no function ${name}`);
    const keys = Object.keys(args);
    const values = keys.map((k) => {
      const v = args[k];
      if (v === null || v === undefined) return null;
      if (t[k] === "jsonb") return JSON.stringify(v);
      if (t[k] === "text[]") return arr(v);
      return v;
    });
    const r = await db.query(
      `select public.${name}(${keys.map((k, i) => `${k} => $${i + 1}::${t[k]}`).join(",")}) as result`,
      values,
    );
    return r.rows[0].result;
  };
  const one = async (sql, params = []) => (await db.query(sql, params)).rows[0];
  const all = async (sql, params = []) => (await db.query(sql, params)).rows;
  return { db, rpc, one, all, contract };
}

const vecOf = (key) => {
  const a = new Array(1024).fill(0);
  a[0] = parseInt(key.slice(0, 4), 16) / 65536;
  a[1] = parseInt(key.slice(4, 8), 16) / 65536;
  return `[${a.join(",")}]`;
};

function fakeEmbedder() {
  const calls = [];
  return {
    calls,
    embed: async (texts) => {
      calls.push(texts.length);
      const { embedKey } = await import("../../src/lib/semantic/chunking.ts");
      const vectors = [];
      for (const t of texts) vectors.push(vecOf(await embedKey(t, "m", "document")));
      return { vectors, tokens: texts.reduce((n, t) => n + Math.ceil(t.length / 4), 0) };
    },
  };
}

const rowOf = (r) => ({
  ...r,
  text: r.text ?? "",
  title: r.title ?? "",
  item: r.item ?? {},
  detail: r.detail ?? {},
});

async function insertRow(t, r, ordinal = 0) {
  const x = rowOf(r);
  await t.db.query(
    `insert into public.corpus_records (dataset, id, title, source_url, ordinal, item, detail, text) values ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8)
     on conflict (dataset, id) do update set title = excluded.title, source_url = excluded.source_url, item = excluded.item, detail = excluded.detail, text = excluded.text`,
    [
      x.dataset,
      x.id,
      x.title,
      x.source_url ?? null,
      ordinal,
      JSON.stringify(x.item),
      JSON.stringify(x.detail),
      x.text,
    ],
  );
}

/** The batch build's state for the fixture rows: corpus rows, corpora, passages as load.py stores them, keys seeded. */
async function batchBuilt(t) {
  for (const d of [...DATASETS, "us_code_titles"])
    await t.db.query("insert into public.corpus_datasets (id) values ($1) on conflict do nothing", [
      d,
    ]);
  for (const [i, r] of sample.us_code_titles.entries())
    await insertRow(t, { ...r, title: "", text: "" }, r.ordinal ?? i);
  for (const [i, r] of sample.rows.entries()) await insertRow(t, r, i);
  for (const d of DATASETS) {
    const rows = golden.rows.filter((g) => g.dataset === d && g.doc);
    await t.rpc("semantic_load_corpus_v1", {
      p_row: {
        dataset: d,
        label: d,
        index_version: "si-1",
        composed: false,
        records: rows.length,
        chunks: rows.reduce((n, g) => n + g.chunks.length, 0),
        capped_records: rows.filter((g) => g.chunks[0].chunk_total > g.chunks.length).length,
        built_at: "2026-10-23T12:00:00Z",
        source_digest: null,
      },
    });
    const load = [];
    const seed = [];
    for (const g of rows)
      for (const c of g.chunks) {
        load.push({
          record_id: g.id,
          chunk_no: c.chunk_no,
          chunk_total: c.chunk_total,
          char_start: c.start,
          char_end: c.end,
          text_sha256: c.text_sha256,
          title: g.doc.title,
          href: g.doc.href,
          source_url: g.doc.source_url ?? "",
          snippet: c.snippet,
          embedding: vecOf(c.embed_key),
        });
        seed.push({ r: g.id, n: c.chunk_no, t: c.text_sha256, k: c.embed_key });
      }
    if (load.length) {
      await t.rpc("semantic_load_v1", { p_dataset: d, p_rows: load });
      const s = await t.rpc("semantic_refresh_seed_keys_v1", { p_dataset: d, p_rows: seed });
      assert.equal(s.matched, seed.length, `${d}: every key seeds onto its stored passage`);
    }
  }
  await t.db.exec("delete from semantic.refresh_queue"); // the inserts above queued every row; the baseline is tested explicitly
}

async function consistent(t) {
  const rows = await t.all(`select k.dataset, k.records, k.chunks, k.capped_records,
      (select count(*)::int from semantic.chunks c where c.dataset = k.dataset) as n,
      (select count(distinct c.record_id)::int from semantic.chunks c where c.dataset = k.dataset) as r,
      (select count(*)::int from (select c.record_id from semantic.chunks c where c.dataset = k.dataset group by 1 having max(c.chunk_total) > count(*)) x) as capped
    from semantic.corpora k order by 1`);
  for (const x of rows) {
    assert.equal(x.chunks, x.n, `${x.dataset}: corpora.chunks equals the stored passages`);
    assert.equal(x.records, x.r, `${x.dataset}: corpora.records equals the stored records`);
    assert.equal(x.capped_records, x.capped, `${x.dataset}: capped records`);
  }
}

const run = (t, emb, extra = {}) =>
  runRefresh({ rpc: t.rpc, embedder: emb, trigger: "manual", ...extra });
/** The next day: records held for the budget or a setting are read again (their not_before has passed). */
const runNextDay = async (t, emb, extra = {}) => {
  await t.db.exec("update semantic.refresh_queue set not_before = null");
  return run(t, emb, extra);
};

test("contract text: security definer, empty search_path, grants, idempotent DDL, no bare drops", async () => {
  const sql = await fs.readFile("database/contracts/semantic-refresh-v1.sql", "utf8");
  const fns = [
    ...sql.matchAll(/create or replace function public\.(semantic_refresh_[a-z_0-9]+)\(/g),
  ].map((m) => m[1]);
  assert.ok(fns.length >= 14);
  for (const f of fns)
    assert.match(sql, new RegExp(`'public\\.${f}\\(`), `${f} is in the grants block`);
  assert.doesNotMatch(
    sql,
    /;\s*(truncate|delete|drop)\b/i,
    "no ';' directly followed by truncate/delete/drop",
  );
  assert.doesNotMatch(sql, /^\s*drop\s/im, "no bare drop statements");
  assert.doesNotMatch(sql, /voyage/i, "the model's provider is not named");
});

test("installs twice, functions are locked down, specs and projection equal the Python mirror", async () => {
  const t = await setup();
  await t.db.exec(shim(t.contract)); // idempotent
  const procs =
    await t.all(`select p.proname, p.prosecdef, p.proconfig, p.proacl::text as acl from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname like 'semantic_refresh_%'`);
  assert.equal(procs.length, 14);
  for (const p of procs) {
    assert.equal(p.prosecdef, true, p.proname);
    assert.deepEqual(p.proconfig, ['search_path=""'], p.proname);
    assert.match(p.acl, /service_role=X/, p.proname);
    assert.doesNotMatch(p.acl, /(^|[{,])(anon|authenticated)?=X/, p.proname);
  }
  for (const [d, spec] of Object.entries(golden.specs))
    assert.deepEqual((await t.one("select semantic.source_spec($1) s", [d])).s, spec, d);
  await batchBuilt(t);
  for (const g of golden.rows) {
    const got = (
      await t.one(
        `select semantic.source_input(c.dataset, c.id, c.title, c.source_url, c.text, c.item, c.detail,
        semantic.usc_title_map() -> (c.detail -> 'usc' ->> 'title')) p from public.corpus_records c where c.dataset = $1 and c.id = $2`,
        [g.dataset, g.id],
      )
    ).p;
    const input = sample.rows.find((r) => r.dataset === g.dataset && r.id === g.id);
    const want = g.pruned_has_text ? { ...g.pruned, text: input.text } : g.pruned;
    // the fixture's trimmed rows carry no source_url key where the build row had none; the column is then null
    assert.deepEqual(got, want, `${g.dataset} ${g.id}`);
  }
});

test("baseline: every batch-built record is confirmed unchanged without a single embedding request", async () => {
  const t = await setup();
  await batchBuilt(t);
  for (const d of DATASETS) {
    let after = null;
    for (;;) {
      const r = await t.rpc("semantic_refresh_enqueue_v1", {
        p_dataset: d,
        p_after: after,
        p_limit: 4,
      });
      after = r.last_id;
      if (r.done) break;
    }
  }
  assert.equal(
    (await t.one("select count(*)::int n from semantic.refresh_queue")).n,
    sample.rows.length,
  );
  await t.rpc("semantic_refresh_record_usage_v1", {
    p_kind: "seed",
    p_tokens: 392652938,
    p_note: "usage.json",
  });
  const emb = fakeEmbedder();
  const s = await run(t, emb, { limits: { page_records: 7 } });
  assert.equal(s.status, "ok", JSON.stringify(s));
  assert.equal(emb.calls.length, 0);
  assert.equal(s.unknownKeys, 0);
  assert.equal((await t.one("select count(*)::int n from semantic.refresh_queue")).n, 0);
  const ledger = await t.all(
    "select state, count(*)::int n from semantic.refresh_records group by 1 order by 1",
  );
  assert.deepEqual(ledger, [
    { state: "indexed", n: golden.rows.filter((g) => g.doc).length },
    { state: "no_doc", n: golden.rows.filter((g) => !g.doc).length },
  ]);
  await consistent(t);
  // nothing changed: a second sweep over everything finds nothing to do
  await t.db.exec("update semantic.refresh_settings set sweep_rows_per_run = 1000");
  const s2 = await run(t, emb);
  assert.equal(s2.detect.sweep_queued, 0);
  assert.equal(s2.records, 0);
});

test("changes: only new embed strings are embedded; metadata-only and identical writes cost nothing", async () => {
  const t = await setup();
  await batchBuilt(t);
  await t.rpc("semantic_refresh_record_usage_v1", {
    p_kind: "seed",
    p_tokens: 392652938,
    p_note: "usage.json",
  });
  const emb = fakeEmbedder();
  // baseline the ledger first
  for (const d of DATASETS) await t.rpc("semantic_refresh_enqueue_v1", { p_dataset: d });
  await run(t, emb);
  assert.equal(emb.calls.length, 0);

  const multi = golden.rows.find((g) => g.rule === "multi_chunk");
  const before = await t.all(
    "select chunk_no, text_sha256 from semantic.chunks where dataset = $1 and record_id = $2 order by 1",
    [multi.dataset, multi.id],
  );
  // amend the last paragraph of a multi-passage regulation section
  await t.db.query(
    "update public.corpus_records set text = text || '\n(z) A new paragraph added by an amendment.' where dataset = $1 and id = $2",
    [multi.dataset, multi.id],
  );
  // a metadata-only change (source URL is not part of the embedded string) and an identical rewrite
  const crs = golden.rows.find((g) => g.dataset === "crs_reports");
  await t.db.query(
    "update public.corpus_records set source_url = 'https://www.congress.gov/crs-product/X' where dataset = $1 and id = $2",
    [crs.dataset, crs.id],
  );
  const bill = golden.rows.find((g) => g.dataset === "congress_bills");
  await t.db.query(
    "update public.corpus_records set filters = '{\"x\": 1}' where dataset = $1 and id = $2",
    [bill.dataset, bill.id],
  ); // not captured
  await t.db.query("update public.corpus_records set text = text where dataset = $1 and id = $2", [
    bill.dataset,
    bill.id,
  ]); // identical
  const queued = await t.all(
    "select dataset, record_id, reason from semantic.refresh_queue order by 1, 2",
  );
  assert.deepEqual(queued.map((q) => q.record_id).sort(), [crs.id, multi.id].sort());

  const s = await run(t, emb);
  assert.equal(s.status, "ok", JSON.stringify(s));
  assert.equal(emb.calls.length, 1, "one request");
  assert.equal(s.embeddedInputs, 1, "only the passage whose text changed");
  const after = await t.all(
    "select chunk_no, text_sha256 from semantic.chunks where dataset = $1 and record_id = $2 order by 1",
    [multi.dataset, multi.id],
  );
  assert.equal(after.length, before.length);
  assert.deepEqual(after.slice(0, -1), before.slice(0, -1), "unchanged passages untouched");
  assert.notEqual(after.at(-1).text_sha256, before.at(-1).text_sha256);
  assert.equal(
    (
      await t.one("select source_url from semantic.chunks where dataset = $1 and record_id = $2", [
        crs.dataset,
        crs.id,
      ])
    ).source_url,
    "https://www.congress.gov/crs-product/X",
  );
  const usage = await t.rpc("semantic_refresh_status_v1");
  assert.equal(usage.usage.today, s.tokens);
  assert.equal(usage.usage.total, 392652938 + s.tokens);
  assert.ok(s.tokens <= s.reservedUpperBound);
  await consistent(t);
});

test("new records are embedded; removals wait for the grace period, respect the guard, and come back for free", async () => {
  const t = await setup();
  await batchBuilt(t);
  await t.rpc("semantic_refresh_record_usage_v1", {
    p_kind: "seed",
    p_tokens: 1000,
    p_note: "test",
  });
  const emb = fakeEmbedder();
  for (const d of DATASETS) await t.rpc("semantic_refresh_enqueue_v1", { p_dataset: d });
  await run(t, emb);

  // a new oversight report
  await insertRow(t, {
    dataset: "oversight_reports",
    id: "ovr:new",
    title: "Audit of grant oversight at a test agency",
    source_url: "https://www.oversight.gov/report/x",
    item: { oversight: { oig: "Test OIG", description: "Reviewed grant monitoring." } },
  });
  let s = await run(t, emb);
  assert.equal(s.status, "ok");
  assert.equal(s.embeddedInputs, 1);
  assert.equal(
    (
      await t.one(
        "select count(*)::int n from semantic.chunks where dataset = 'oversight_reports' and record_id = 'ovr:new'",
      )
    ).n,
    1,
  );
  await consistent(t);

  // removal: deferred inside the grace period
  const doj = golden.rows.find((g) => g.dataset === "doj_oig_reports");
  await t.db.query("delete from public.corpus_records where dataset = $1 and id = $2", [
    doj.dataset,
    doj.id,
  ]);
  s = await run(t, emb);
  assert.equal(s.applied.doj_oig_reports.deferred, 1);
  assert.equal(
    (
      await t.one(
        "select count(*)::int n from semantic.chunks where dataset = $1 and record_id = $2",
        [doj.dataset, doj.id],
      )
    ).n,
    1,
  );
  // guard: no removals allowed
  await t.db.exec(
    "update semantic.refresh_queue set missing_since = now() - interval '21 hours'; update semantic.refresh_settings set removal_guard_min = 0, removal_guard_fraction = 0",
  );
  s = await run(t, emb);
  assert.equal(s.applied.doj_oig_reports.removal_guard, 1);
  assert.equal(
    (
      await t.one(
        "select count(*)::int n from semantic.chunks where dataset = $1 and record_id = $2",
        [doj.dataset, doj.id],
      )
    ).n,
    1,
  );
  // allowed: removed, vector kept in the cache
  await t.db.exec(
    "update semantic.refresh_settings set removal_guard_min = 100, removal_guard_fraction = 0.02",
  );
  s = await run(t, emb);
  assert.equal(s.applied.doj_oig_reports.removed, 1);
  assert.equal(
    (
      await t.one(
        "select count(*)::int n from semantic.chunks where dataset = $1 and record_id = $2",
        [doj.dataset, doj.id],
      )
    ).n,
    0,
  );
  assert.equal(
    (
      await t.one(
        "select count(*)::int n from semantic.refresh_records where dataset = $1 and record_id = $2",
        [doj.dataset, doj.id],
      )
    ).n,
    0,
  );
  assert.equal(
    (await t.one("select count(*)::int n from semantic.vector_cache where source = 'retired'")).n,
    1,
  );
  await consistent(t);
  // the record comes back: its vector comes from the cache, no request
  const calls = emb.calls.length;
  await insertRow(
    t,
    sample.rows.find((r) => r.dataset === doj.dataset && r.id === doj.id),
  );
  s = await run(t, emb);
  assert.equal(emb.calls.length, calls);
  assert.equal(s.applied.doj_oig_reports.added, 1);
  await consistent(t);
});

test("a collection being republished (deleted, then inserted again unchanged) costs nothing and removes nothing", async () => {
  const t = await setup();
  await batchBuilt(t);
  await t.rpc("semantic_refresh_record_usage_v1", {
    p_kind: "seed",
    p_tokens: 1000,
    p_note: "test",
  });
  const emb = fakeEmbedder();
  for (const d of DATASETS) await t.rpc("semantic_refresh_enqueue_v1", { p_dataset: d });
  await run(t, emb);
  await t.db.exec("delete from public.corpus_records where dataset = 'crs_reports'");
  await t.db.query("update public.corpus_datasets set ready = false where id = 'crs_reports'");
  let s = await run(t, emb); // mid-republish: nothing removed
  assert.equal(s.applied.crs_reports?.removed ?? 0, 0);
  for (const r of sample.rows.filter((x) => x.dataset === "crs_reports")) await insertRow(t, r);
  await t.db.query("update public.corpus_datasets set ready = true where id = 'crs_reports'");
  s = await run(t, emb);
  assert.equal(emb.calls.length, 0);
  assert.equal((await t.one("select count(*)::int n from semantic.refresh_queue")).n, 0);
  assert.equal(
    (await t.one("select count(*)::int n from semantic.chunks where dataset = 'crs_reports'")).n,
    3,
  );
  await consistent(t);
});

test("budget: nothing is embedded before the usage seed; the daily and global caps are hard; partial work resumes", async () => {
  const t = await setup();
  await batchBuilt(t);
  const emb = fakeEmbedder();
  for (const d of DATASETS) await t.rpc("semantic_refresh_enqueue_v1", { p_dataset: d });
  await run(t, emb);
  const add = (id, n) =>
    insertRow(t, {
      dataset: "ftc_publications_index",
      id,
      title: `Report ${id}`,
      source_url: "https://www.ftc.gov/x",
      item: { summary: `Summary ${id} `.repeat(n) },
    });
  await add("r1", 40);
  let s = await run(t, emb);
  assert.equal(s.embeddingStop, "usage_not_seeded");
  assert.equal(emb.calls.length, 0);
  // held for the setting: not read again by the next run of the night (zero-token work behind it goes on)
  const held = await t.one(
    "select not_before > now() + interval '23 hours' as later, last_error from semantic.refresh_queue where record_id = 'r1'",
  );
  assert.deepEqual(held, { later: true, last_error: "usage_not_seeded" });
  assert.equal((await run(t, emb)).records, 0);
  assert.equal(
    (await t.one("select count(*)::int n from semantic.refresh_queue where record_id = 'r1'")).n,
    1,
  );

  await t.rpc("semantic_refresh_record_usage_v1", {
    p_kind: "seed",
    p_tokens: 392652938,
    p_note: "usage.json",
  });
  // the database refuses on its own, whatever the caller packs
  {
    const open = await t.rpc("semantic_refresh_open_run_v1", { p_trigger: "manual" });
    const r1 = await t.rpc("semantic_refresh_reserve_v1", {
      p_run: open.run_id,
      p_dataset: "x",
      p_reserve: 250001,
      p_inputs: 1,
    });
    assert.deepEqual([r1.ok, r1.reason], [false, "daily_cap"]);
    const r2 = await t.rpc("semantic_refresh_reserve_v1", {
      p_run: open.run_id,
      p_dataset: "x",
      p_reserve: 249000,
      p_inputs: 1,
    });
    assert.equal(r2.ok, true);
    assert.equal(r2.daily_remaining, 1000);
    const r3 = await t.rpc("semantic_refresh_reserve_v1", {
      p_run: open.run_id,
      p_dataset: "x",
      p_reserve: 1001,
      p_inputs: 1,
    });
    assert.deepEqual(
      [r3.ok, r3.reason],
      [false, "daily_cap"],
      "an open reservation counts in full",
    );
    const st = await t.rpc("semantic_refresh_settle_v1", {
      p_reservation: r2.reservation_id,
      p_tokens: 300,
    });
    assert.equal(st.daily_remaining, 250000 - 300);
    assert.equal(st.overrun, false);
    await t.db.exec("update semantic.refresh_settings set total_token_cap = 392653500");
    const r4 = await t.rpc("semantic_refresh_reserve_v1", {
      p_run: open.run_id,
      p_dataset: "x",
      p_reserve: 300,
      p_inputs: 1,
    });
    assert.deepEqual([r4.ok, r4.reason], [false, "total_cap"], "392,652,938 + 300 used, 262 left");
    await t.db.exec("update semantic.refresh_settings set total_token_cap = 400000000");
    const r5 = await t.rpc("semantic_refresh_reserve_v1", {
      p_run: open.run_id,
      p_dataset: "x",
      p_reserve: 10,
      p_inputs: 1,
    });
    assert.equal(
      (
        await t.rpc("semantic_refresh_settle_v1", {
          p_reservation: r5.reservation_id,
          p_tokens: 11,
        })
      ).overrun,
      true,
    );
    await t.rpc("semantic_refresh_finish_run_v1", {
      p_run: open.run_id,
      p_status: "ok",
      p_stop_reason: "test",
      p_notes: {},
      p_error: null,
    });
    await t.db.exec("delete from semantic.embedding_usage where kind = 'reservation'");
  }
  await t.db.exec("update semantic.refresh_settings set daily_token_cap = 100");
  s = await runNextDay(t, emb);
  assert.equal(s.embeddingStop, "daily_cap");
  assert.equal(s.status, "partial");
  assert.equal(emb.calls.length, 0);
  // the global cap: 400,000,000 minus what is used leaves less than this record needs
  await t.db.exec(
    "update semantic.refresh_settings set daily_token_cap = 250000, total_token_cap = 392653000",
  );
  s = await runNextDay(t, emb);
  assert.equal(s.embeddingStop, "total_cap");
  assert.equal(emb.calls.length, 0);
  await t.db.exec("update semantic.refresh_settings set total_token_cap = 400000000");
  s = await runNextDay(t, emb);
  assert.equal(s.status, "ok");
  assert.equal(emb.calls.length, 1);
  const st = await t.rpc("semantic_refresh_status_v1");
  assert.ok(st.usage.today <= 250000 && st.usage.total === 392652938 + s.tokens);
  // a reservation is the UTF-8 upper bound; the settled usage is what was billed
  const res = await t.one(
    "select reserved, tokens from semantic.embedding_usage where kind = 'reservation'",
  );
  assert.ok(Number(res.tokens) <= Number(res.reserved));

  // a record needing two requests with room for only one: the first batch is cached, the record waits, the next run
  // (next day) spends only the rest
  await t.db.exec("update semantic.refresh_settings set max_request_inputs = 1");
  await insertRow(t, {
    dataset: "congress_bills",
    id: "119-hr-99999",
    title: "H.R. 99999",
    source_url: "https://www.congress.gov/x",
    detail: {
      bill: {
        display: "H.R. 99999",
        titles: { display: "Test Act" },
        summary: {
          blocks: Array.from({ length: 30 }, (_, i) => ({
            k: "p",
            x: `Paragraph ${i} `.repeat(30),
          })),
        },
      },
    },
  });
  const today = (await t.rpc("semantic_refresh_status_v1")).usage.today;
  const plan = await planRecord(
    (await t.rpc("semantic_refresh_pending_v1", {})).items[0],
    { removal_grace_seconds: 72000, reembed_unseeded: false },
    Date.now(),
  );
  assert.equal(plan.kind, "index");
  assert.ok(plan.rows.length >= 2);
  const first = [...plan.texts.values()][0];
  await t.db.query("update semantic.refresh_settings set daily_token_cap = $1", [
    today + new TextEncoder().encode(first).length + 8,
  ]);
  s = await runNextDay(t, emb);
  assert.equal(s.embeddingStop, "daily_cap");
  assert.equal(s.embeddedInputs, 1);
  assert.equal(
    (await t.one("select count(*)::int n from semantic.chunks where record_id = '119-hr-99999'")).n,
    0,
    "never part of a record",
  );
  assert.equal(
    (await t.one("select count(*)::int n from semantic.vector_cache where source = 'embedded'")).n,
    2,
  );
  await t.db.exec("update semantic.refresh_settings set daily_token_cap = 250000");
  s = await runNextDay(t, emb);
  assert.equal(s.status, "ok");
  assert.equal(s.embeddedInputs, plan.rows.length - 1, "the cached passage is not embedded again");
  assert.equal(
    (await t.one("select count(*)::int n from semantic.chunks where record_id = '119-hr-99999'")).n,
    plan.rows.length,
  );
  await consistent(t);
});

test("U.S. Code title rename queues the title's sections; the drift guard caps heading-only re-embedding", async () => {
  const t = await setup();
  await batchBuilt(t);
  await t.rpc("semantic_refresh_record_usage_v1", {
    p_kind: "seed",
    p_tokens: 1000,
    p_note: "test",
  });
  const emb = fakeEmbedder();
  for (const d of DATASETS) await t.rpc("semantic_refresh_enqueue_v1", { p_dataset: d });
  await run(t, emb);
  await t.db
    .exec(`update public.corpus_records set detail = jsonb_set(detail, '{usc_title,name}', '"Commerce and Trade (renamed)"')
                   where dataset = 'us_code_titles' and detail->'usc_title'->>'number' = '15'`);
  await t.db.exec("update semantic.refresh_settings set drift_guard = 0");
  let s = await run(t, emb);
  assert.equal(s.detect.title_sections_queued, 1);
  assert.equal(emb.calls.length, 0);
  assert.equal(s.holds[0].reason, "heading_drift_guard");
  await t.db.exec("update semantic.refresh_settings set drift_guard = 200");
  s = await runNextDay(t, emb);
  assert.equal(s.status, "ok");
  const n = golden.rows.find((g) => g.id === "15:78u-6").chunks.length;
  assert.equal(s.embeddedInputs, n);
  await consistent(t);
});

test("unseeded passages are held instead of re-embedded; the sweep finds writes the trigger missed", async () => {
  const t = await setup();
  await batchBuilt(t);
  await t.rpc("semantic_refresh_record_usage_v1", {
    p_kind: "seed",
    p_tokens: 1000,
    p_note: "test",
  });
  const emb = fakeEmbedder();
  await t.db.exec("delete from semantic.chunk_keys where dataset = 'oversight_reports'");
  await t.rpc("semantic_refresh_enqueue_v1", { p_dataset: "oversight_reports" });
  let s = await run(t, emb);
  assert.equal(emb.calls.length, 0);
  assert.ok(s.holds.every((h) => h.reason === "keys_not_seeded") && s.holds.length === 2);
  // a write with the trigger disabled is found by the sweep
  for (const d of DATASETS) await t.rpc("semantic_refresh_enqueue_v1", { p_dataset: d });
  await t.db.exec("update semantic.refresh_settings set reembed_unseeded = true");
  await runNextDay(t, emb);
  await t.db.exec(
    "alter table public.corpus_records disable trigger semantic_refresh_enqueue_update",
  );
  const ftc = golden.rows.find((g) => g.dataset === "ftc_publications_index");
  await t.db.query(
    "update public.corpus_records set title = 'Renamed report' where dataset = $1 and id = $2",
    [ftc.dataset, ftc.id],
  );
  await t.db.exec(
    "alter table public.corpus_records enable trigger semantic_refresh_enqueue_update",
  );
  assert.equal((await t.one("select count(*)::int n from semantic.refresh_queue")).n, 0);
  await t.db.exec("update semantic.refresh_settings set sweep_rows_per_run = 1000");
  s = await runNextDay(t, emb);
  assert.ok(s.detect.sweep_queued >= 1);
  assert.equal(
    (
      await t.one("select title from semantic.chunks where dataset = $1 and record_id = $2", [
        ftc.dataset,
        ftc.id,
      ])
    ).title,
    "Renamed report",
  );
  await consistent(t);
});

test("passages lost behind the refresh's back are rebuilt; a refused record does not block the others", async () => {
  const t = await setup();
  await batchBuilt(t);
  await t.rpc("semantic_refresh_record_usage_v1", {
    p_kind: "seed",
    p_tokens: 1000,
    p_note: "test",
  });
  const emb = fakeEmbedder();
  for (const d of DATASETS) await t.rpc("semantic_refresh_enqueue_v1", { p_dataset: d });
  await run(t, emb);
  const crs = golden.rows.find((g) => g.dataset === "crs_reports");
  await t.rpc("semantic_purge_v1", { p_dataset: "oversight_reports", p_limit: 1 });
  await t.db.query("delete from semantic.chunks where dataset = $1 and record_id = $2", [
    crs.dataset,
    crs.id,
  ]);
  await t.db.exec("update semantic.refresh_settings set sweep_rows_per_run = 1000");
  let s = await run(t, emb);
  assert.equal(s.status, "ok");
  assert.equal(s.embeddedInputs, 2, "the purged and the deleted record are embedded again");
  assert.equal(
    (
      await t.one(
        "select count(*)::int n from semantic.chunks where dataset = $1 and record_id = $2",
        [crs.dataset, crs.id],
      )
    ).n,
    1,
  );
  // a record whose source URL the index refuses is an error for itself only
  await t.db.exec("update semantic.refresh_settings set sweep_rows_per_run = 0");
  const doj = golden.rows.find((g) => g.dataset === "doj_oig_reports");
  await t.db.query(
    "update public.corpus_records set source_url = 'ftp://example.gov/x' where dataset = $1 and id = $2",
    [doj.dataset, doj.id],
  );
  const ftc = golden.rows.find((g) => g.dataset === "ftc_publications_index");
  await t.db.query(
    "update public.corpus_records set title = title || ' (2nd ed.)' where dataset = $1 and id = $2",
    [ftc.dataset, ftc.id],
  );
  s = await run(t, emb);
  assert.equal(s.applied.doj_oig_reports.errors, 1);
  assert.equal(s.applied.ftc_publications_index.indexed, 1);
  const q = await t.one(
    "select attempts, last_error from semantic.refresh_queue where dataset = $1 and record_id = $2",
    [doj.dataset, doj.id],
  );
  assert.equal(q.attempts, 1);
  await consistent(t);
});

test("dry run reads only; a run is single and abandoned runs are closed", async () => {
  const t = await setup();
  await batchBuilt(t);
  for (const d of DATASETS) await t.rpc("semantic_refresh_enqueue_v1", { p_dataset: d });
  const before = await t.one(
    "select (select count(*) from semantic.refresh_queue)::int q, (select count(*) from semantic.refresh_runs)::int r",
  );
  const s = await runRefresh({ rpc: t.rpc, embedder: null, trigger: "local", dryRun: true });
  assert.equal(s.status, "ok");
  assert.equal(s.records, before.q);
  const after = await t.one(
    "select (select count(*) from semantic.refresh_queue)::int q, (select count(*) from semantic.refresh_runs)::int r",
  );
  assert.deepEqual(after, before);
  const a = await t.rpc("semantic_refresh_open_run_v1", { p_trigger: "manual" });
  assert.ok(a.run_id);
  assert.deepEqual(await t.rpc("semantic_refresh_open_run_v1", { p_trigger: "manual" }), {
    skipped: "busy",
  });
  assert.deepEqual(await t.rpc("semantic_refresh_open_run_v1", { p_trigger: "schedule" }), {
    skipped: "disabled",
  });
  await t.db.exec("update semantic.refresh_runs set started_at = now() - interval '11 minutes'");
  const b = await t.rpc("semantic_refresh_open_run_v1", { p_trigger: "local" });
  assert.ok(b.run_id, "an edge run open for 10 minutes is abandoned");
  assert.equal(
    (await t.one("select status from semantic.refresh_runs where id = $1", [a.run_id])).status,
    "failed",
  );
  await t.db.exec(
    `update semantic.refresh_runs set started_at = now() - interval '31 minutes' where id = '${b.run_id}'`,
  );
  assert.deepEqual(await t.rpc("semantic_refresh_open_run_v1", { p_trigger: "manual" }), {
    skipped: "busy",
  });
  await t.db.exec(
    `update semantic.refresh_runs set started_at = now() - interval '41 minutes' where id = '${b.run_id}'`,
  );
  assert.ok((await t.rpc("semantic_refresh_open_run_v1", { p_trigger: "manual" })).run_id);
  assert.equal(
    await t.rpc("semantic_refresh_check_trigger_v1", { p_token: "x".repeat(64) }),
    false,
  );
});
