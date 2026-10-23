// Offline test of database/contracts/insights-state-regs-v1.sql (pglite): the family registers, refreshes and stages
// facts only for states in the spine, counting register issues per year and rules held with confirmed text.
//   node --test scripts/state_regs/insights-state-regs.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const runtime =
  process.env.PUBLISHER_CODE_PGLITE ??
  path.resolve("private/tools/publisher-code-contract-tests/node_modules/@electric-sql/pglite/dist/index.js");
const { PGlite } = await import(pathToFileURL(runtime).href);
const read = (f) => fs.readFile(f, "utf8");

test("insights family state_regs", { timeout: 300000 }, async () => {
  const db = new PGlite();
  const one = async (sql, args = []) => (await db.query(sql, args)).rows[0];
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role;
      create table public.corpus_datasets (id text primary key, label text not null, ready boolean not null default false,
        expected_records bigint not null default 0, imported_records bigint not null default 0, manifest_sha256 text,
        metadata jsonb not null default '{}', updated_at timestamptz not null default now());
      create table public.corpus_records (dataset text not null references public.corpus_datasets(id), id text not null,
        category text not null, state text, county_geoids text[] not null default '{}', title text not null default '',
        source_url text, ordinal bigint not null default 0, item jsonb not null, detail jsonb not null default '{}',
        text text not null default '', filters jsonb not null default '{}', search_vector tsvector, primary key (dataset, id));
      create schema caselaw;
      create table caselaw.cases (cluster_id bigint primary key, court_id text not null, date_filed date,
        date_approx boolean not null default false, cited_by integer not null default 0);`);
    await db.exec(await read("database/contracts/insights-v1.sql"));
    await db.exec(await read("database/contracts/ingest-v1.sql"));
    await db.exec(await read("database/contracts/state-regs-v1.sql"));
    const FAMILY = await read("database/contracts/insights-state-regs-v1.sql");
    await db.exec(FAMILY);
    await db.exec(FAMILY); // idempotent

    await db.exec(`insert into insights.entities (entity_type, entity_id, label, source_dataset) values
      ('state', 'TX', 'Texas', 'test'), ('state', 'OH', 'Ohio', 'test')`);
    const issue = (st, id, date, period = null) =>
      db.query(
        `insert into public.corpus_records (dataset, id, category, state, title, source_url, item)
         values ('state_register_issues', $1, 'state_register_issues', $2, 't', 'https://example.gov', $3)`,
        [id, st, { id, register_issue: { state: st, date, period } }],
      );
    await issue("TX", "tx-reg:2026-10-16", "2026-10-16");
    await issue("TX", "tx-reg:2026-10-09", "2026-10-09");
    await issue("TX", "tx-reg:2025-12-26", "2025-12-26");
    await issue("ZZ", "zz-reg:2026-01-01", "2026-01-01"); // not in the spine: no fact
    await one("select public.state_reg_load_codes_v1($1)", [
      JSON.stringify([{ state: "OH", code_name: "Ohio Administrative Code", publisher: "LSC", code_url: "https://codes.ohio.gov",
        access: "html", status: "official_free" }]),
    ]);
    const rule = (n, check) => ({
      id: `oh:3745-4-${n}`, state: "OH", node_id: null, number: `3745-4-0${n}`, citation: `Ohio Adm.Code 3745-4-0${n}`,
      cite_key: `3745-4-${n}`, heading: "h", text: "body", status: "active", source_url: "https://codes.ohio.gov/x",
      retrieved_at: "2026-10-23T00:00:00Z", raw_sha256: "a".repeat(64), text_check: { text: check }, ordinal: n,
    });
    await one("select public.state_reg_load_rules_v1('test-1', $1)", [
      JSON.stringify([rule(1, "confirmed"), rule(2, "confirmed"), rule(3, "partly_confirmed")]),
    ]);

    const res = await one("select insights.refresh_state_regs('test') as r");
    assert.ok(res.r, "refresh returns a result");
    const facts = (
      await db.query(
        "select metric_id, entity_id, period, value::float as value, partial from insights.facts where metric_id like 'state_re%' order by 1, 2, 3",
      )
    ).rows;
    const issues = facts.filter((f) => f.metric_id === "state_register_issues_listed");
    assert.deepEqual(
      issues.map((f) => [f.entity_id, f.period, f.value, f.partial]),
      [
        ["TX", "2025", 1, false],
        ["TX", "2026", 2, true],
      ],
    );
    const held = facts.filter((f) => f.metric_id === "state_reg_rules_held");
    assert.equal(held.length, 1);
    assert.equal(held[0].entity_id, "OH");
    assert.equal(held[0].value, 2);
    const g = await one(
      "select has_function_privilege('anon', 'insights.refresh_state_regs(text)', 'execute') as anon, has_function_privilege('service_role', 'insights.refresh_state_regs(text)', 'execute') as svc",
    );
    assert.deepEqual(g, { anon: false, svc: true });
  } finally {
    await db.close();
  }
});
