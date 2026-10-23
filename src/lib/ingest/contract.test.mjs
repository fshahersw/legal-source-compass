// Offline PostgreSQL contract test for database/contracts/ingest-v1.sql (pglite). No credentials, network or live corpus.
//   node --test src/lib/ingest/contract.test.mjs
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
const SQL = await fs.readFile("database/contracts/ingest-v1.sql", "utf8");

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

const BASE_SHA = "a".repeat(64);
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

const frRow = (id, ordinal, { year = "2026", type = "Notice", title = `Document ${id}` } = {}) => ({
  dataset: "federal_register_history",
  id: String(id),
  category: "federal_register_history",
  state: "",
  county_geoids: [],
  title,
  source_url: `https://www.federalregister.gov/d/${year}-${id}`,
  ...(ordinal === undefined ? {} : { ordinal }),
  item: { id: String(id), title, cells: { published: `${year}-10-23` } },
  detail: { title, facts: [["Type", type]] },
  text: `${title} ${type}`,
  filters: { _listing: ["yes"], type: [type], year: [year], agency: ["1"] },
});

const cpscRow = (n, { title = `Recall ${n}`, units = "About 100" } = {}) => ({
  dataset: "agency_safety_cpsc_recalls_api",
  id: `cpsc-api:${n}`,
  category: "agency_safety_cpsc_recalls_api",
  state: "",
  title,
  source_url: `https://www.cpsc.gov/Recalls/2026/recall-${n}`,
  item: { id: `cpsc-api:${n}`, title, cells: { units } },
  detail: { id: `cpsc-api:${n}`, title, facts: [["Units", units]] },
  text: `${n} ${title}`,
  filters: { _listing: ["yes"], year: ["2026"] },
});

test("ingest/1 contract", { timeout: 180000 }, async (t) => {
  const db = new PGlite();
  const one = async (sql, args = []) => (await db.query(sql, args)).rows[0];
  const rpc = async (name, args = []) =>
    (
      await one(
        `select public.${name}(${args.map((_, i) => `$${i + 1}`).join(",")}) as result`,
        args,
      )
    ).result;
  const records = async (dataset) =>
    (
      await db.query(
        "select id, ordinal, title, item, xmin::text as xmin from public.corpus_records where dataset = $1 order by ordinal",
        [dataset],
      )
    ).rows;
  const catalog = async (dataset) =>
    one("select * from public.corpus_datasets where id = $1", [dataset]);
  try {
    await db.exec(CORPUS);
    await db.query(
      "insert into public.corpus_datasets (id, label, ready, expected_records, imported_records, manifest_sha256, metadata) values ($1, 'FR', true, 3, 3, $2, $3), ('agency_safety_cpsc_recalls_api', 'CPSC', true, 2, 2, $2, $4)",
      [
        "federal_register_history",
        BASE_SHA,
        frMeta(),
        { listing: { total: 2, filters: [] }, summary: { grain: "recall" } },
      ],
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
    for (const [n, ord] of [
      ["100", 0],
      ["101", 1],
    ]) {
      const r = cpscRow(n);
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

    await t.test("applies twice; the schedule block waits for pg_cron and pg_net", async () => {
      await db.exec(SQL);
      await db.exec(SQL);
      const n = await one("select count(*)::int as n from ingest.sources");
      assert.equal(n.n, 6);
      const jobs = await one("select count(*)::int as n from pg_namespace where nspname = 'cron'");
      assert.equal(jobs.n, 0);
    });

    await t.test("re-applying keeps a source the lead enabled", async () => {
      await db.exec("update ingest.sources set enabled = true where id = 'cpsc_recalls'");
      await db.exec(SQL);
      assert.equal(
        (await one("select enabled from ingest.sources where id = 'cpsc_recalls'")).enabled,
        true,
      );
      assert.equal(
        (await one("select enabled from ingest.sources where id = 'federal_register'")).enabled,
        false,
      );
    });

    await t.test("functions are callable by service_role only", async () => {
      for (const fn of [
        "public.ingest_upsert_v1(uuid,jsonb)",
        "public.insights_freshness_v1()",
        "public.ingest_open_run_v1(text,text)",
        "public.ingest_check_trigger_v1(text)",
      ]) {
        for (const role of ["anon", "authenticated"]) {
          assert.equal(
            (await one(`select has_function_privilege('${role}', '${fn}', 'execute') as ok`)).ok,
            false,
            `${role} ${fn}`,
          );
        }
        assert.equal(
          (await one(`select has_function_privilege('service_role', '${fn}', 'execute') as ok`)).ok,
          true,
        );
      }
      assert.equal(
        (await one("select has_schema_privilege('anon', 'ingest', 'usage') as ok")).ok,
        false,
      );
    });

    await t.test(
      "trigger secret: generated once in Vault, checked by digest, refused without Vault",
      async () => {
        const check = async (token) =>
          (await one("select public.ingest_check_trigger_v1($1) as ok", [token])).ok;
        // no Vault here yet: nothing matches, and the file still loads
        assert.equal(await check("a".repeat(64)), false);
        // a minimal stand-in for Supabase Vault (name, secret; decrypted view; create_secret)
        await db.exec(`
        create schema vault;
        create table vault.secrets (name text unique, secret text not null, description text);
        create view vault.decrypted_secrets as select name, secret as decrypted_secret from vault.secrets;
        create function vault.create_secret(p_secret text, p_name text, p_description text) returns uuid
          language sql as $$ insert into vault.secrets values (p_name, p_secret, p_description); select gen_random_uuid() $$;`);
        await db.exec(SQL);
        const first = (
          await one("select secret from vault.secrets where name = 'ingest_cron_secret'")
        ).secret;
        assert.match(first, /^[0-9a-f]{64}$/);
        await db.exec(SQL); // re-applying keeps the secret
        assert.equal(
          (await one("select secret from vault.secrets where name = 'ingest_cron_secret'")).secret,
          first,
        );
        assert.equal(await check(first), true);
        assert.equal(await check(first.slice(0, 63) + (first.endsWith("0") ? "1" : "0")), false);
        assert.equal(await check(first.slice(0, 31)), false);
        assert.equal(await check(null), false);
        await db.exec("drop schema vault cascade");
      },
    );

    await t.test("freshness before any run: never_run", async () => {
      const f = await rpc("insights_freshness_v1");
      assert.equal(f.length, 6);
      const fr = f.find((x) => x.source === "federal_register");
      assert.deepEqual(fr, {
        source: "federal_register",
        dataset: "federal_register_history",
        lastRunAt: null,
        lastSuccessAt: null,
        newRecords: null,
        status: "never_run",
        message: "Not scheduled yet",
      });
      assert.equal(f.find((x) => x.source === "cpsc_recalls").message, "Scheduled; no run yet");
    });

    let frRun;
    await t.test(
      "open: a scheduled run needs the source enabled; one open run per source",
      async () => {
        assert.deepEqual(await rpc("ingest_open_run_v1", ["federal_register", "schedule"]), {
          skipped: "disabled",
          source: "federal_register",
        });
        const opened = await rpc("ingest_open_run_v1", ["federal_register", "manual"]);
        frRun = opened.run_id;
        assert.equal(opened.dataset, "federal_register_history");
        assert.equal(opened.records, 3);
        assert.equal(opened.ordinal_min, -2);
        assert.equal(opened.ordinal_max, 0);
        assert.equal(opened.mode, "insert_only");
        assert.deepEqual(await rpc("ingest_open_run_v1", ["federal_register", "manual"]), {
          skipped: "busy",
          source: "federal_register",
        });
        await assert.rejects(
          rpc("ingest_open_run_v1", ["nope", "manual"]),
          /unknown ingest source/,
        );
      },
    );

    await t.test("record-shape checks reject the whole batch and write nothing", async () => {
      const good = frRow(13, -3);
      const cases = [
        [{ ...good, dataset: "agency_safety_cpsc_recalls_api" }, /dataset differs/],
        [{ ...good, id: "x13", item: { ...good.item, id: "x13" } }, /id does not match/],
        [{ ...good, category: "agency_safety" }, /category differs/],
        [{ ...good, source_url: "https://example.gov/x?api_key=SECRET" }, /source_url|credential/],
        [
          { ...good, detail: { links: [{ url: "https://api.example.gov/v1?key=abc" }] } },
          /credential/,
        ],
        [{ ...good, extra: 1 }, /unexpected key/],
        [{ ...good, item: { ...good.item, id: "999" } }, /item\.id differs/],
        [{ ...good, filters: [] }, /filters is not an object/],
        [{ ...good, source_url: "javascript:alert(1)" }, /not an http/],
      ];
      for (const [bad, pattern] of cases) {
        await assert.rejects(rpc("ingest_upsert_v1", [frRun, [good, bad]]), pattern);
      }
      await assert.rejects(rpc("ingest_upsert_v1", [frRun, [good, good]]), /duplicate ids/);
      await assert.rejects(rpc("ingest_upsert_v1", [frRun, []]), /1 to 500/);
      assert.equal((await records("federal_register_history")).length, 3);
      const run = await one("select inserted, updated, unchanged from ingest.runs where id = $1", [
        frRun,
      ]);
      assert.deepEqual(run, { inserted: 0, updated: 0, unchanged: 0 });
    });

    await t.test(
      "explicit ordinals: unused and below the first ordinal at open (prepend)",
      async () => {
        await assert.rejects(rpc("ingest_upsert_v1", [frRun, [frRow(13, -2)]]), /already used/);
        await assert.rejects(rpc("ingest_upsert_v1", [frRun, [frRow(13, 5)]]), /not below/);
      },
    );

    await t.test(
      "insert-only: new rows inserted, identical rows untouched, changed held rows kept",
      async () => {
        const before = await records("federal_register_history");
        const changed = frRow(10, -2, { title: "Rewritten title" });
        const res = await rpc("ingest_upsert_v1", [
          frRun,
          [frRow(14, -4, { year: "2027", type: "Rule" }), frRow(13, -3), frRow(11, -1), changed],
        ]);
        assert.deepEqual(res, { received: 4, inserted: 2, updated: 0, unchanged: 1, held: 1 });
        const after = await records("federal_register_history");
        assert.deepEqual(
          after.map((r) => [r.id, Number(r.ordinal)]),
          [
            ["14", -4],
            ["13", -3],
            ["10", -2],
            ["11", -1],
            ["12", 0],
          ],
        );
        const keep10 = after.find((r) => r.id === "10");
        assert.equal(keep10.title, "Document 10");
        assert.equal(keep10.xmin, before.find((r) => r.id === "10").xmin, "held row not rewritten");
        assert.equal(
          after.find((r) => r.id === "11").xmin,
          before.find((r) => r.id === "11").xmin,
          "identical row not rewritten",
        );
        const run = await one(
          "select inserted, updated, unchanged, held, notes from ingest.runs where id = $1",
          [frRun],
        );
        assert.deepEqual(run.notes.held_existing_ids, ["10"]);
      },
    );

    await t.test(
      "catalog: counts from stored rows, counted filters moved by written values, rolling-update marker",
      async () => {
        const c = await catalog("federal_register_history");
        assert.equal(Number(c.expected_records), 5);
        assert.equal(Number(c.imported_records), 5);
        assert.equal(c.manifest_sha256, BASE_SHA);
        assert.equal(c.ready, true);
        const m = c.metadata;
        assert.equal(m.listing.total, 5);
        assert.equal(m.listing_modes.default.total, 5);
        assert.deepEqual(m.summary, {
          records: 5,
          listing_records: 5,
          native_default_records: 5,
          artifacts: 7,
        });
        const opts = (name, list = m.listing.filters) => list.find((f) => f.name === name).options;
        assert.deepEqual(opts("type"), [
          { count: 3, label: "Notice", value: "Notice" },
          { count: 2, label: "Rule", value: "Rule" },
        ]);
        assert.deepEqual(opts("year"), [
          { count: 1, label: "2027", value: "2027" },
          { count: 4, label: "2026", value: "2026" },
        ]);
        assert.deepEqual(opts("agency"), [{ count: 5, label: "Agency 1", value: "1" }]);
        assert.deepEqual(opts("year", m.listing_modes.default.filters), [
          { count: 1, label: "2027", value: "2027" },
          { count: 4, label: "2026", value: "2026" },
        ]);
        assert.equal(m.manifest.kind, "rolling_update");
        assert.equal(m.manifest.last_run_id, frRun);
        assert.equal(m.manifest.base_manifest_sha256, BASE_SHA);
        assert.equal(m.manifest.runs_applied, 1);
        assert.equal(m.manifest.records_inserted_since_base, 2);
        assert.equal(m.manifest.records, 5);
        const sum = await one(
          "select sum((o->>'count')::int)::int as n from public.corpus_datasets d, jsonb_array_elements(d.metadata->'listing'->'filters') f, jsonb_array_elements(f->'options') o where d.id = 'federal_register_history' and f->>'name' = 'year'",
        );
        assert.equal(sum.n, 5, "year option counts add up to the stored rows");
      },
    );

    await t.test(
      "catalog note: listing qualification and one continuation entry per run (federal_register only)",
      async () => {
        await assert.rejects(rpc("ingest_catalog_note_v1", [frRun, { other: 1 }]), /note keys/);
        const res = await rpc("ingest_catalog_note_v1", [
          frRun,
          {
            qualification: "Federal Register documents published 1994-01-03 to 2027-10-23 ...",
            continuation: { published_through: "2027-10-23", records_added: 999 },
          },
        ]);
        assert.deepEqual(res, { applied: true, records_added: 2 });
        const m = (await catalog("federal_register_history")).metadata;
        assert.match(m.listing.qualification, /to 2027-10-23/);
        assert.match(m.listing_modes.default.qualification, /to 2027-10-23/);
        assert.equal(m.continuations.length, 1);
        assert.equal(m.continuations[0].records_added, 2, "records_added is the run's own count");
        assert.deepEqual(m.continuations[0].runs, [frRun]);
        await assert.rejects(
          rpc("ingest_catalog_note_v1", [frRun, { qualification: "again" }]),
          /already wrote/,
        );
      },
    );

    await t.test(
      "finish: cursor kept for ok, error text never carries a key, requests without credentials",
      async () => {
        await assert.rejects(
          rpc("ingest_finish_run_v1", [
            frRun,
            "ok",
            4,
            1,
            0,
            { through: "2026-10-23" },
            null,
            [{ url: "https://x.gov/a?api_key=1" }],
            {},
          ]),
          /without credentials/,
        );
        const done = await rpc("ingest_finish_run_v1", [
          frRun,
          "ok",
          4,
          1,
          3,
          { through: "2026-10-23" },
          null,
          [
            {
              url: "https://www.federalregister.gov/api/v1/documents.json?page=1",
              status: 200,
              bytes: 10,
              sha256: "b".repeat(64),
            },
          ],
          { late: [] },
        ]);
        assert.equal(done.status, "ok");
        assert.equal(done.inserted, 2);
        assert.equal(done.held, 2);
        assert.equal(
          done.unchanged,
          4,
          "1 found identical by the database + 3 compared by the function",
        );
        assert.equal(done.records_before, 3);
        assert.equal(done.records_after, 5);
        assert.deepEqual(
          (await one("select cursor from ingest.cursors where source = 'federal_register'")).cursor,
          { through: "2026-10-23" },
        );
        await assert.rejects(
          rpc("ingest_finish_run_v1", [frRun, "ok", 1, 0, 0, null, null, null, null]),
          /already ok/,
        );
        await assert.rejects(rpc("ingest_upsert_v1", [frRun, [frRow(15, -5)]]), /not running/);
      },
    );

    await t.test("insights refresh: not installed, ok, failed, skipped", async () => {
      assert.equal((await rpc("ingest_refresh_insights_v1", [frRun])).status, "not_installed");
      await db.exec(
        "create schema insights; create table insights.calls (datasets text[]); create function insights.refresh_for_datasets(p_datasets text[]) returns jsonb language sql as $$ insert into insights.calls values (p_datasets) returning jsonb_build_object('metrics', 2) $$;",
      );
      const ok = await rpc("ingest_refresh_insights_v1", [frRun]);
      assert.equal(ok.status, "ok");
      assert.deepEqual(ok.datasets, ["federal_register_history"]);
      assert.deepEqual((await one("select datasets from insights.calls")).datasets, [
        "federal_register_history",
      ]);
      await db.exec(
        "create or replace function insights.refresh_for_datasets(p_datasets text[]) returns jsonb language plpgsql as $$ begin raise exception 'metric failed key=abc'; end $$;",
      );
      const failed = await rpc("ingest_refresh_insights_v1", [frRun]);
      assert.equal(failed.status, "failed");
      assert.match(failed.error, /metric failed key=\[removed\]/);
      assert.equal(
        (
          await one("select insights_refresh->>'status' as s from ingest.runs where id = $1", [
            frRun,
          ])
        ).s,
        "failed",
      );
      await db.exec("drop schema insights cascade");
    });

    await t.test(
      "upsert source: append ordinals, identical rows untouched, changed rows updated in place",
      async () => {
        const opened = await rpc("ingest_open_run_v1", ["cpsc_recalls", "schedule"]);
        assert.ok(opened.run_id);
        const before = await records("agency_safety_cpsc_recalls_api");
        const res = await rpc("ingest_upsert_v1", [
          opened.run_id,
          [cpscRow("100"), cpscRow("101", { units: "About 200" }), cpscRow("102"), cpscRow("103")],
        ]);
        assert.deepEqual(res, { received: 4, inserted: 2, updated: 1, unchanged: 1, held: 0 });
        const after = await records("agency_safety_cpsc_recalls_api");
        assert.deepEqual(
          after.map((r) => [r.id, Number(r.ordinal)]),
          [
            ["cpsc-api:100", 0],
            ["cpsc-api:101", 1],
            ["cpsc-api:102", 2],
            ["cpsc-api:103", 3],
          ],
        );
        assert.equal(after[0].xmin, before[0].xmin);
        assert.equal(after[1].item.cells.units, "About 200");
        const c = await catalog("agency_safety_cpsc_recalls_api");
        assert.equal(Number(c.imported_records), 4);
        assert.equal(c.metadata.listing.total, 4);
        assert.deepEqual(c.metadata.summary, { grain: "recall" });
        assert.equal(c.metadata.manifest.records_updated_since_base, 1);
        const second = await rpc("ingest_upsert_v1", [opened.run_id, [cpscRow("104")]]);
        assert.equal(second.inserted, 1);
        assert.equal(
          (await catalog("agency_safety_cpsc_recalls_api")).metadata.manifest.runs_applied,
          1,
          "same run counted once",
        );
        const fin = await rpc("ingest_finish_run_v1", [
          opened.run_id,
          "failed",
          5,
          0,
          0,
          { from: "x" },
          "HTTP 500 from https://h.gov/a?api_key=SECRET&x=1",
          [],
          {},
        ]);
        assert.equal(fin.status, "failed");
        const run = await one("select error, cursor_after from ingest.runs where id = $1", [
          opened.run_id,
        ]);
        assert.equal(run.error, "HTTP 500 from https://h.gov/a?api_key=[removed]&x=1");
        assert.equal(run.cursor_after, null, "a failed run keeps the cursor it started from");
        assert.equal(
          (await one("select count(*)::int as n from ingest.cursors where source = 'cpsc_recalls'"))
            .n,
          0,
        );
      },
    );

    await t.test(
      "prepend without explicit ordinals: each batch newest first below the minimum",
      async () => {
        await db.query(
          "insert into public.corpus_datasets (id, label, metadata) values ('agency_safety_openfda_drug_enforcement', 'drug', '{}')",
        );
        const row = (n) => ({
          dataset: "agency_safety_openfda_drug_enforcement",
          id: `openfda:drug/enforcement:D-${n}-2026`,
          category: "agency_safety",
          state: "IL",
          title: `D-${n}`,
          source_url: "",
          item: { id: `openfda:drug/enforcement:D-${n}-2026` },
          detail: {},
          text: "",
          filters: {},
        });
        const opened = await rpc("ingest_open_run_v1", ["openfda_drug_enforcement", "manual"]);
        await rpc("ingest_upsert_v1", [opened.run_id, [row(2), row(1)]]); // older batch first
        await rpc("ingest_upsert_v1", [opened.run_id, [row(4), row(3)]]);
        const after = await records("agency_safety_openfda_drug_enforcement");
        assert.deepEqual(
          after.map((r) => r.title),
          ["D-4", "D-3", "D-2", "D-1"],
        );
        const c = await catalog("agency_safety_openfda_drug_enforcement");
        assert.equal(Number(c.imported_records), 4);
        await rpc("ingest_finish_run_v1", [
          opened.run_id,
          "partial",
          4,
          0,
          0,
          { report_date: "2026-10-01" },
          "page limit",
          [],
          {},
        ]);
      },
    );

    await t.test("an abandoned run is closed as failed when the next one opens", async () => {
      await db.exec(
        "insert into ingest.runs (source, dataset, started_at) values ('ftc_hsr', 'ftc_hsr_early_terminations', now() - interval '1 hour')",
      );
      await db.query(
        "insert into public.corpus_datasets (id, label, metadata) values ('ftc_hsr_early_terminations', 'hsr', '{}')",
      );
      const opened = await rpc("ingest_open_run_v1", ["ftc_hsr", "manual"]);
      assert.ok(opened.run_id);
      const old = await one(
        "select status, error from ingest.runs where source = 'ftc_hsr' and id <> $1",
        [opened.run_id],
      );
      assert.equal(old.status, "failed");
      assert.match(old.error, /abandoned/);
      await rpc("ingest_finish_run_v1", [
        opened.run_id,
        "ok",
        0,
        0,
        0,
        { created: "2026-10-22" },
        null,
        [],
        {},
      ]);
    });

    await t.test("freshness: ok, failed, partial note, stale", async () => {
      const f = Object.fromEntries((await rpc("insights_freshness_v1")).map((x) => [x.source, x]));
      assert.equal(f.federal_register.status, "ok");
      assert.equal(f.federal_register.newRecords, 2);
      assert.match(f.federal_register.lastSuccessAt, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/);
      assert.equal(f.federal_register.message, null);
      assert.equal(f.cpsc_recalls.status, "failed");
      assert.match(
        f.cpsc_recalls.message,
        /^Last run failed: HTTP 500 from https:\/\/h\.gov\/a\?api_key=\[removed\]/,
      );
      assert.equal(f.cpsc_recalls.lastSuccessAt, null);
      assert.equal(f.openfda_drug_enforcement.status, "ok");
      assert.match(f.openfda_drug_enforcement.message, /page limit/);
      assert.equal(f.ftc_hsr.status, "ok");
      assert.equal(f.ftc_hsr.newRecords, 0);
      assert.equal(f.openfda_food_enforcement.status, "never_run");
      await db.exec(
        "update ingest.runs set started_at = started_at - interval '10 days', finished_at = finished_at - interval '10 days' where source = 'federal_register'",
      );
      const g = Object.fromEntries((await rpc("insights_freshness_v1")).map((x) => [x.source, x]));
      assert.equal(g.federal_register.status, "stale");
      assert.match(g.federal_register.message, /^No successful run since \d{4}-\d\d-\d\d$/);
    });

    await t.test("distinct text values for dataset-wide builder rules", async () => {
      await db.exec(
        "update public.corpus_records set item = item || jsonb_build_object('recall', jsonb_build_object('countries_raw', jsonb_build_array('China', 'Viet Nam (parts)'))) where id = 'cpsc-api:100'",
      );
      await db.exec(
        "update public.corpus_records set item = item || jsonb_build_object('recall', jsonb_build_object('countries_raw', jsonb_build_array('China'))) where id = 'cpsc-api:101'",
      );
      assert.deepEqual(
        await rpc("ingest_distinct_text_v1", [
          "agency_safety_cpsc_recalls_api",
          ["recall", "countries_raw"],
        ]),
        ["China", "Viet Nam (parts)"],
      );
      await assert.rejects(
        rpc("ingest_distinct_text_v1", ["court_spine", ["x"]]),
        /not an ingest dataset/,
      );
    });
  } finally {
    await db.close();
  }
});
