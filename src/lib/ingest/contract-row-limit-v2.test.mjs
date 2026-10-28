// Offline PostgreSQL contract test for database/contracts/ingest-row-limit-v2.sql and its rollback (pglite).
// No credentials, network or live corpus.
//   node --test src/lib/ingest/contract-row-limit-v2.test.mjs
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
// Committed form is LF; a Windows checkout may be CRLF, which would change the function-body hash compared below.
const read = async (file) => (await fs.readFile(file, "utf8")).replace(/\r\n/g, "\n");
const V1 = await read("database/contracts/ingest-v1.sql");
const V2 = await read("database/contracts/ingest-row-limit-v2.sql");
const ROLLBACK = await read("database/contracts/ingest-row-limit-v2.rollback.sql");

// Production shapes of the two corpus tables (columns, defaults, keys, the category check).
const CORPUS = `
create role anon; create role authenticated; create role service_role;
create table public.corpus_datasets (id text primary key, label text not null, ready boolean not null default false,
  expected_records bigint not null default 0, imported_records bigint not null default 0, manifest_sha256 text,
  metadata jsonb not null default '{}', updated_at timestamptz not null default now());
create table public.corpus_records (dataset text not null references public.corpus_datasets(id), id text not null,
  category text not null check (category <> all (array['', 'unknown', 'uncategorized'])), state text,
  county_geoids text[] not null default '{}', title text not null default '', source_url text, ordinal bigint not null default 0,
  item jsonb not null, detail jsonb not null default '{}', text text not null default '', filters jsonb not null default '{}',
  search_vector tsvector, primary key (dataset, id));
`;

const frMeta = () => ({
  id: "federal_register_history",
  listing: {
    total: 3,
    filters: [
      { name: "q", type: "search" },
      {
        name: "type",
        type: "select",
        options: [
          { count: 2, label: "Notice", value: "Notice" },
          { count: 1, label: "Rule", value: "Rule" },
        ],
      },
      { name: "year", type: "select", options: [{ count: 3, label: "2026", value: "2026" }] },
      { name: "agency", type: "select", options: [{ count: 3, label: "Agency 1", value: "1" }] },
    ],
  },
  listing_modes: {
    default: {
      total: 3,
      filters: [
        { name: "year", type: "select", options: [{ count: 3, label: "2026", value: "2026" }] },
      ],
    },
  },
  summary: { records: 3, listing_records: 3, native_default_records: 3, artifacts: 7 },
});

const frRow = (id, ordinal) => ({
  dataset: "federal_register_history",
  id: String(id),
  category: "federal_register_history",
  state: "",
  county_geoids: [],
  title: `Document ${id}`,
  source_url: `https://www.federalregister.gov/d/2026-${id}`,
  ...(ordinal === undefined ? {} : { ordinal }),
  item: { id: String(id), title: `Document ${id}`, cells: { published: "2026-10-23" } },
  detail: { title: `Document ${id}`, facts: [["Type", "Notice"]] },
  text: `Document ${id} Notice`,
  filters: { _listing: ["yes"], type: ["Notice"], year: ["2026"], agency: ["1"] },
});

test("ingest row limit v2", { timeout: 240000 }, async (t) => {
  const db = new PGlite();
  const one = async (sql, args = []) => (await db.query(sql, args)).rows[0];
  const rpc = async (name, args = []) =>
    (
      await one(
        `select public.${name}(${args.map((_, i) => `$${i + 1}`).join(",")}) as result`,
        args,
      )
    ).result;
  const ids = async () =>
    (
      await db.query(
        "select id from public.corpus_records where dataset = 'federal_register_history' order by id",
      )
    ).rows.map((r) => r.id);
  // ingest.row_problem is what ingest_upsert_v1 asks about every row of a batch.
  const problem = async (row) =>
    (
      await one(
        "select ingest.row_problem($1::jsonb, 'federal_register_history', 'federal_register_history', '^[0-9]+$') as p",
        [JSON.stringify(row)],
      )
    ).p;
  const withText = (id, chars) => ({ ...frRow(id), text: "x".repeat(chars) });
  const jsonbBytes = async (row) =>
    (await one("select octet_length($1::jsonb::text) as n", [JSON.stringify(row)])).n;
  const functionFacts = () =>
    one(`select md5(prosrc) as body, proacl::text as acl, proowner::regrole::text as owner,
      provolatile as volatility, proconfig::text as config, prosecdef as definer,
      pg_get_function_arguments(oid) as args, pg_get_function_result(oid) as result
      from pg_proc where oid = 'ingest.row_problem(jsonb,text,text,text)'::regprocedure`);
  try {
    await db.exec(CORPUS);
    await db.query(
      "insert into public.corpus_datasets (id, label, ready, expected_records, imported_records, manifest_sha256, metadata) values ($1, 'FR', true, 3, 3, $2, $3)",
      ["federal_register_history", "a".repeat(64), frMeta()],
    );
    for (const [i, ord] of [
      [10, -2],
      [11, -1],
      [12, 0],
    ]) {
      const r = frRow(i, ord);
      await db.query(
        "insert into public.corpus_records (dataset, id, category, state, title, source_url, ordinal, item, detail, text, filters) values ($1,$2,$3,'',$4,$5,$6,$7,$8,$9,$10)",
        [
          r.dataset,
          r.id,
          r.category,
          r.title,
          r.source_url,
          ord,
          r.item,
          r.detail,
          r.text,
          r.filters,
        ],
      );
    }
    await db.exec(V1);
    const v1Facts = await functionFacts();
    let run;

    await t.test(
      "v1 alone: one 1.2 MB row is refused and rolls back its whole batch (the 2026-10-27 stall)",
      async () => {
        run = (await rpc("ingest_open_run_v1", ["federal_register", "manual"])).run_id;
        assert.match(await problem(withText(30, 1_200_000)), /^row larger than 1 MB$/);
        assert.equal(await problem(withText(31, 900_000)), null);
        await assert.rejects(
          rpc("ingest_upsert_v1", [run, [frRow(31), withText(30, 1_200_000)]]),
          /row 2 rejected: row larger than 1 MB/,
        );
        assert.deepEqual(
          await ids(),
          ["10", "11", "12"],
          "the normal row beside it was not written",
        );
      },
    );

    await t.test(
      "v2 applies twice and keeps signature, owner, volatility, search_path and grants",
      async () => {
        await db.exec(V2);
        await db.exec(V2);
        const v2Facts = await functionFacts();
        assert.notEqual(v2Facts.body, v1Facts.body);
        assert.deepEqual({ ...v2Facts, body: null }, { ...v1Facts, body: null });
      },
    );

    await t.test(
      "the stalled batch now writes: a 1.2 MB row passes beside a normal one",
      async () => {
        const big = withText(30, 1_200_000);
        assert.equal(await problem(big), null);
        const res = await rpc("ingest_upsert_v1", [run, [frRow(31), big]]);
        assert.equal(res.received, 2);
        assert.equal(res.inserted, 2);
        assert.deepEqual(await ids(), ["10", "11", "12", "30", "31"]);
        const stored = await one(
          "select octet_length(text) as n from public.corpus_records where dataset = 'federal_register_history' and id = '30'",
        );
        assert.equal(stored.n, 1_200_000);
      },
    );

    await t.test("the limit is exactly 20,000,000 bytes of jsonb text", async () => {
      // The largest row the corpus stores today is 17,742,718 bytes, below this limit.
      const overhead = await jsonbBytes(withText(40, 0));
      assert.equal(await problem(withText(40, 20_000_000 - overhead)), null);
      assert.match(await problem(withText(40, 20_000_001 - overhead)), /^row larger than 20 MB$/);
    });

    await t.test("every other check is unchanged", async () => {
      const good = frRow(41);
      assert.equal(await problem(good), null);
      assert.match(await problem("not an object"), /row is not an object/);
      for (const [bad, pattern] of [
        [{ ...good, extra: 1 }, /unexpected key/],
        [{ ...good, id: "x41", item: { ...good.item, id: "x41" } }, /id does not match/],
        [{ ...good, category: "agency_safety" }, /category differs/],
        [{ ...good, filters: [] }, /filters is not an object/],
        [{ ...good, source_url: "javascript:alert(1)" }, /not an http/],
        [{ ...good, source_url: "https://example.gov/x?api_key=SECRET" }, /credential/],
      ]) {
        assert.match(await problem(bad), pattern);
      }
    });

    await t.test("rollback restores the 1 MB guard and the exact v1 function text", async () => {
      await db.exec(ROLLBACK);
      await db.exec(ROLLBACK);
      assert.deepEqual(await functionFacts(), v1Facts);
      assert.match(await problem(withText(50, 1_200_000)), /^row larger than 1 MB$/);
      assert.equal(await problem(withText(51, 900_000)), null);
      await db.exec(V2); // v2 can be applied again after a rollback
      assert.equal(await problem(withText(50, 1_200_000)), null);
    });
  } finally {
    await db.close();
  }
});
