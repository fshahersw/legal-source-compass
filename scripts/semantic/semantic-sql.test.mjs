// Offline contract test for database/contracts/semantic-v1.sql. No credentials, network or live corpus access.
//
// The bundled PGlite has no pgvector, so the vector-specific parts are replaced by a stand-in with the same SQL surface:
// extensions.halfvec (text '[x,y,...]'), vector_dims, the <=> cosine-distance operator and avg(halfvec). What this test proves is
// the contract's own logic (tables, constraints, ranking, per-record dedupe, related excluding the record itself, the load/prune/
// purge RPCs, grants and function settings) on 1024-dimension vectors. What it cannot prove: pgvector's halfvec storage and
// rounding, the HNSW index (its statement is checked textually and removed), and iterative-scan behaviour. Those need the real
// extension (the lead enables it, applies the file, and runs the status and a search call).
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
const contractPath = path.resolve("database/contracts/semantic-v1.sql");

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

const HNSW =
  /create index if not exists chunks_embedding_hnsw on semantic\.chunks using hnsw \(embedding extensions\.halfvec_cosine_ops\) with \(m = 16, ef_construction = 64\);/;

async function install(db) {
  const sql = await fs.readFile(contractPath, "utf8");
  assert.match(sql, HNSW, "the contract must create an HNSW index with halfvec_cosine_ops");
  assert.match(sql, /create extension if not exists vector with schema extensions;/);
  assert.match(sql, /embedding extensions\.halfvec\(1024\) not null/);
  await db.exec("create role anon; create role authenticated; create role service_role;");
  await db.exec(SHIM);
  const shimmed = sql
    .replace(HNSW, "")
    .replace("create extension if not exists vector with schema extensions;", "")
    .replaceAll("extensions.halfvec(1024)", "extensions.halfvec");
  await db.exec(shimmed);
  return sql;
}

const DIMS = 1024;
const vec = (entries) => {
  const a = new Array(DIMS).fill(0);
  for (const [i, v] of Object.entries(entries)) a[Number(i)] = v;
  return `[${a.join(",")}]`;
};
const sha = (n) => n.toString(16).padStart(64, "0");
const row = (record_id, chunk_no, embedding, extra = {}) => ({
  record_id,
  chunk_no,
  chunk_total: extra.chunk_total ?? 1,
  char_start: 0,
  char_end: 100,
  text_sha256: sha(record_id.length * 100 + chunk_no),
  title: extra.title ?? `Title ${record_id}`,
  href: extra.href ?? `/law/x/${record_id}`,
  source_url: extra.source_url ?? "https://example.gov/x",
  snippet: `Snippet of ${record_id} ${chunk_no}`,
  embedding,
});

async function setup() {
  const db = new PGlite();
  const sql = await install(db);
  const rpc = async (name, args = {}) => {
    const keys = Object.keys(args);
    const r = await db.query(
      `select public.${name}(${keys.map((k, i) => `${k} => $${i + 1}`).join(",")}) result`,
      keys.map((k) =>
        typeof args[k] === "object" && !Array.isArray(args[k]) ? JSON.stringify(args[k]) : args[k],
      ),
    );
    return r.rows[0].result;
  };
  const corpus = (dataset, extra = {}) =>
    rpc("semantic_load_corpus_v1", {
      p_row: JSON.stringify({
        dataset,
        label: dataset,
        index_version: "si-1",
        composed: false,
        records: 1,
        chunks: 1,
        capped_records: 0,
        built_at: "2026-10-23T12:00:00Z",
        source_digest: "abc",
        ...extra,
      }),
    });
  const load = (dataset, rows) =>
    rpc("semantic_load_v1", { p_dataset: dataset, p_rows: JSON.stringify(rows) });
  return { db, sql, rpc, corpus, load };
}

async function seed(t) {
  for (const d of ["us_code_sections", "ecfr_sections_full", "congress_bills", "crs_reports"])
    await t.corpus(d);
  await t.load("us_code_sections", [
    row("15:78u-6", 0, vec({ 0: 1 }), { chunk_total: 2 }),
    row("15:78u-6", 1, vec({ 1: 1 }), { chunk_total: 2 }),
    row("28:1407", 0, vec({ 0: 0.9, 2: 0.1 })),
    row("42:1983", 0, vec({ 0: 0.8, 7: 0.2 }), { chunk_total: 2 }),
    row("42:1983", 1, vec({ 0: 0.99, 8: 0.01 }), { chunk_total: 2 }),
  ]);
  await t.load("ecfr_sections_full", [row("cfr:17:240.10b-5", 0, vec({ 0: 1, 3: 0.5 }))]);
  await t.load("congress_bills", [row("117-hr-1", 0, vec({ 5: 1 }))]);
  await t.load("crs_reports", [row("R12345", 0, vec({ 0: 1, 1: 1 }))]);
}

test("semantic contract: structure, grants and settings", { timeout: 120000 }, async () => {
  const { db, sql } = await setup();
  try {
    assert.doesNotMatch(sql, /voyage/i, "the contract must not name the embedding provider");
    const fns = (
      await db.query(
        `select p.proname, p.prosecdef, coalesce(p.proconfig @> array['search_path=""'], false) pinned from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname like 'semantic\\_%' order by 1`,
      )
    ).rows;
    assert.deepEqual(
      fns.map((f) => f.proname),
      [
        "semantic_load_corpus_v1",
        "semantic_load_v1",
        "semantic_prune_v1",
        "semantic_purge_v1",
        "semantic_related_v1",
        "semantic_search_v1",
        "semantic_status_v1",
      ],
    );
    for (const f of fns) {
      assert.equal(f.prosecdef, true, `${f.proname} must be SECURITY DEFINER`);
      assert.equal(f.pinned, true, `${f.proname} must pin an empty search_path`);
    }
    for (const role of ["anon", "authenticated"]) {
      for (const f of fns) {
        const oid = (
          await db.query(
            `select p.oid::regprocedure::text sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = $1`,
            [f.proname],
          )
        ).rows[0].sig;
        assert.equal(
          (await db.query(`select has_function_privilege($1, $2, 'execute') ok`, [role, oid]))
            .rows[0].ok,
          false,
          `${role} must not execute ${f.proname}`,
        );
        assert.equal(
          (await db.query(`select has_function_privilege('service_role', $1, 'execute') ok`, [oid]))
            .rows[0].ok,
          true,
        );
      }
      assert.equal(
        (await db.query(`select has_schema_privilege($1, 'semantic', 'usage') ok`, [role])).rows[0]
          .ok,
        false,
      );
      assert.equal(
        (await db.query(`select has_table_privilege($1, 'semantic.chunks', 'select') ok`, [role]))
          .rows[0].ok,
        false,
      );
    }
    assert.equal(
      (
        await db.query(
          `select relrowsecurity r from pg_class where oid = 'semantic.chunks'::regclass`,
        )
      ).rows[0].r,
      true,
    );
  } finally {
    await db.close();
  }
});

test("semantic contract: load, reload, prune and purge", { timeout: 120000 }, async () => {
  const t = await setup();
  try {
    await t.corpus("us_code_sections");
    const rows = [
      row("a", 0, vec({ 0: 1 }), { chunk_total: 2 }),
      row("a", 1, vec({ 1: 1 }), { chunk_total: 2 }),
      row("b", 0, vec({ 2: 1 })),
    ];
    assert.deepEqual(await t.load("us_code_sections", rows), { rows: 3, written: 3, unchanged: 0 });
    assert.deepEqual(
      await t.load("us_code_sections", rows),
      { rows: 3, written: 0, unchanged: 3 },
      "an identical reload writes nothing",
    );
    const changed = [{ ...rows[0], snippet: "A new snippet" }, rows[1], rows[2]];
    assert.deepEqual(await t.load("us_code_sections", changed), {
      rows: 3,
      written: 1,
      unchanged: 2,
    });
    const moved = [row("a", 0, vec({ 0: 1, 9: 0.2 })), rows[1], rows[2]];
    assert.equal(
      (await t.load("us_code_sections", moved)).written,
      1,
      "a changed embedding is written",
    );
    // a record that now keeps fewer passages loses the rest
    assert.equal(
      await t.rpc("semantic_prune_v1", { p_dataset: "us_code_sections", p_counts: { a: 1, b: 1 } }),
      1,
    );
    assert.equal((await t.db.query("select count(*)::int n from semantic.chunks")).rows[0].n, 2);
    // constraints: unknown dataset, in-app links only, hash shape, offsets
    await assert.rejects(t.load("nope", [row("x", 0, vec({ 0: 1 }))]), /foreign key|violates/i);
    await assert.rejects(
      t.load("us_code_sections", [row("x", 0, vec({ 0: 1 }), { href: "//evil.example" })]),
      /violates check/i,
    );
    await assert.rejects(
      t.load("us_code_sections", [row("x", 0, vec({ 0: 1 }), { href: "https://evil.example/x" })]),
      /violates check/i,
    );
    await assert.rejects(
      t.load("us_code_sections", [{ ...row("x", 0, vec({ 0: 1 })), text_sha256: "zz" }]),
      /violates check/i,
    );
    await assert.rejects(
      t.load("us_code_sections", [{ ...row("x", 0, vec({ 0: 1 })), char_end: 0 }]),
      /violates check/i,
    );
    await assert.rejects(t.load("us_code_sections", []), /Invalid passage batch/);
    assert.equal(
      (await t.load("us_code_sections", [row("n", 0, vec({ 4: 1 }), { source_url: "" })])).written,
      1,
    );
    assert.equal(
      (await t.db.query("select source_url from semantic.chunks where record_id = 'n'")).rows[0]
        .source_url,
      null,
      "an empty source url is stored as null",
    );
    // purge removes a dataset in bounded steps
    assert.equal(
      await t.rpc("semantic_purge_v1", { p_dataset: "us_code_sections", p_limit: 2 }),
      2,
    );
    assert.equal(
      await t.rpc("semantic_purge_v1", { p_dataset: "us_code_sections", p_limit: 2 }),
      1,
    );
    assert.equal(
      await t.rpc("semantic_purge_v1", { p_dataset: "us_code_sections", p_limit: 2 }),
      0,
    );
  } finally {
    await t.db.close();
  }
});

test(
  "semantic contract: search ranks the best passage per record and honours filters",
  { timeout: 120000 },
  async () => {
    const t = await setup();
    try {
      await seed(t);
      const out = await t.rpc("semantic_search_v1", { p_embedding: vec({ 0: 1 }), p_limit: 10 });
      assert.equal(out.index_version, "si-1");
      const ids = out.results.map((r) => `${r.dataset}/${r.record_id}`);
      assert.deepEqual(ids, [
        "us_code_sections/15:78u-6",
        "us_code_sections/42:1983",
        "us_code_sections/28:1407",
        "ecfr_sections_full/cfr:17:240.10b-5",
        "crs_reports/R12345",
        "congress_bills/117-hr-1",
      ]);
      assert.deepEqual(
        out.results.map((r) => r.rank),
        [1, 2, 3, 4, 5, 6],
      );
      assert.equal(new Set(ids).size, ids.length, "one result per record");
      const sec = out.results.find((r) => r.record_id === "42:1983");
      assert.equal(sec.chunk_no, 1, "the nearer passage of a record represents it");
      assert.equal(out.results[0].distance, 0);
      assert.ok(out.results[1].distance > 0 && out.results[1].distance < 0.01);
      assert.equal(out.results.at(-1).distance, 1);
      for (const r of out.results) {
        assert.deepEqual(Object.keys(r).sort(), [
          "char_end",
          "char_start",
          "chunk_no",
          "chunk_total",
          "dataset",
          "distance",
          "href",
          "rank",
          "record_id",
          "snippet",
          "source_url",
          "title",
        ]);
      }
      const only = await t.rpc("semantic_search_v1", {
        p_embedding: vec({ 0: 1 }),
        p_datasets: ["ecfr_sections_full", "crs_reports"],
        p_limit: 10,
      });
      assert.deepEqual(
        only.results.map((r) => r.dataset),
        ["ecfr_sections_full", "crs_reports"],
      );
      const one = await t.rpc("semantic_search_v1", { p_embedding: vec({ 0: 1 }), p_limit: 0 });
      assert.equal(one.results.length, 1, "a limit below 1 is raised to 1");
      const none = await t.rpc("semantic_search_v1", {
        p_embedding: vec({ 0: 1 }),
        p_datasets: ["not_a_dataset"],
      });
      assert.deepEqual(none.results, []);
      await assert.rejects(
        t.rpc("semantic_search_v1", { p_embedding: vec({ 0: 1 }), p_datasets: [] }),
        /at least one dataset/,
      );
      await assert.rejects(
        t.rpc("semantic_search_v1", { p_embedding: "[1,2,3]" }),
        /1024 dimensions/,
      );
    } finally {
      await t.db.close();
    }
  },
);

test(
  "semantic contract: related records exclude the record itself",
  { timeout: 120000 },
  async () => {
    const t = await setup();
    try {
      await seed(t);
      const rel = await t.rpc("semantic_related_v1", {
        p_dataset: "us_code_sections",
        p_record_id: "15:78u-6",
        p_limit: 5,
      });
      assert.equal(rel.indexed, true);
      assert.equal(rel.passages_used, 2);
      const ids = rel.results.map((r) => `${r.dataset}/${r.record_id}`);
      assert.ok(
        !ids.includes("us_code_sections/15:78u-6"),
        "the record is never its own related item",
      );
      assert.equal(
        ids[0],
        "crs_reports/R12345",
        "the record whose passage matches the mean of both passages comes first",
      );
      assert.equal(rel.results[0].distance, 0);
      const filtered = await t.rpc("semantic_related_v1", {
        p_dataset: "us_code_sections",
        p_record_id: "15:78u-6",
        p_datasets: ["congress_bills"],
      });
      assert.deepEqual(
        filtered.results.map((r) => r.record_id),
        ["117-hr-1"],
      );
      const missing = await t.rpc("semantic_related_v1", {
        p_dataset: "us_code_sections",
        p_record_id: "99:99",
      });
      assert.deepEqual(missing, { indexed: false, index_version: "si-1", results: [] });
      await assert.rejects(
        t.rpc("semantic_related_v1", {
          p_dataset: "us_code_sections",
          p_record_id: "15:78u-6",
          p_datasets: [],
        }),
        /at least one dataset/,
      );
    } finally {
      await t.db.close();
    }
  },
);

test(
  "semantic contract: status reports coverage and never the provider",
  { timeout: 120000 },
  async () => {
    const t = await setup();
    try {
      await seed(t);
      const status = await t.rpc("semantic_status_v1");
      assert.equal(status.index_version, "si-1");
      const usc = status.datasets.find((d) => d.dataset === "us_code_sections");
      assert.equal(usc.loaded_chunks, 5);
      assert.deepEqual(Object.keys(usc).sort(), [
        "built_at",
        "capped_records",
        "chunks",
        "composed",
        "dataset",
        "label",
        "loaded_chunks",
        "records",
      ]);
      assert.doesNotMatch(JSON.stringify(status), /voyage|model/i);
      // anon cannot call it
      await t.db.exec("set role anon");
      await assert.rejects(t.db.query("select public.semantic_status_v1()"), /permission denied/);
      await t.db.exec("reset role");
      await t.db.exec("set role service_role");
      assert.ok((await t.db.query("select public.semantic_status_v1() s")).rows[0].s);
      await t.db.exec("reset role");
    } finally {
      await t.db.close();
    }
  },
);

test(
  "semantic contract: small filtered sets are answered exactly, with the same ranking as the index path",
  { timeout: 120000 },
  async () => {
    const t = await setup();
    try {
      await seed(t);
      const sig = "semantic.nearest_v1(extensions.halfvec,text[],text,text,integer)";
      for (const role of ["anon", "authenticated", "service_role"])
        assert.equal(
          (await t.db.query(`select has_function_privilege($1, $2, 'execute') ok`, [role, sig]))
            .rows[0].ok,
          false,
          `${role} must not call the nearest-passages helper directly`,
        );
      // the record's own dataset is in the filter: it is still never its own related item
      const exact = await t.rpc("semantic_related_v1", {
        p_dataset: "us_code_sections",
        p_record_id: "15:78u-6",
        p_datasets: ["us_code_sections"],
      });
      assert.deepEqual(
        exact.results.map((r) => r.record_id),
        ["42:1983", "28:1407"],
      );
      const exactSearch = await t.rpc("semantic_search_v1", {
        p_embedding: vec({ 0: 1 }),
        p_datasets: ["us_code_sections"],
      });
      // recorded chunk counts above the exact-scan bound send the same request through the index path
      await t.corpus("us_code_sections", { chunks: 30000 });
      const indexed = await t.rpc("semantic_related_v1", {
        p_dataset: "us_code_sections",
        p_record_id: "15:78u-6",
        p_datasets: ["us_code_sections"],
      });
      assert.deepEqual(indexed.results, exact.results);
      const indexedSearch = await t.rpc("semantic_search_v1", {
        p_embedding: vec({ 0: 1 }),
        p_datasets: ["us_code_sections"],
      });
      assert.deepEqual(indexedSearch.results, exactSearch.results);
      assert.deepEqual(
        exactSearch.results.map((r) => r.record_id),
        ["15:78u-6", "42:1983", "28:1407"],
      );
    } finally {
      await t.db.close();
    }
  },
);
