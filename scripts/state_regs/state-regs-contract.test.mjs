// Offline PostgreSQL contract test for database/contracts/state-regs-v1.sql (pglite). No credentials, network or corpus.
//   node --test scripts/state_regs/state-regs-contract.test.mjs
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
const INGEST = await fs.readFile("database/contracts/ingest-v1.sql", "utf8");
const SQL = await fs.readFile("database/contracts/state-regs-v1.sql", "utf8");
const PATTERNS = JSON.parse(await fs.readFile("scripts/state_regs/cite_patterns.json", "utf8"));
const VECTORS = JSON.parse(await fs.readFile("scripts/state_regs/cite_vectors.json", "utf8"));

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

const SHA = "a".repeat(64);
const code = (state, extra = {}) => ({
  state,
  code_name: `${state} Administrative Code`,
  cite_form: null,
  publisher: `${state} publisher`,
  code_url: `https://example.gov/${state}`,
  access: "html",
  status: "official_free",
  blocked_reason: null,
  acquisition: { text: "sample" },
  probe: { result: "ok", robots: { allowed: true } },
  terms_url: null,
  currency: null,
  edition: null,
  register_name: `${state} Register`,
  register_url: `https://example.gov/${state}/register`,
  register_freq: "weekly",
  register_note: null,
  ...extra,
});
const node = (id, parent, ordinal, extra = {}) => ({
  id,
  state: id.slice(0, 2).toUpperCase(),
  parent_id: parent,
  level: parent ? "chapter" : "title",
  num: id.split(":")[1],
  heading: `Heading ${id}`,
  agency: "Agency",
  citation: null,
  source_url: `https://example.gov/${id}`,
  ordinal,
  rule_count: null,
  ...extra,
});
const rule = (state, citation, cite_key, node_id, ordinal, text, extra = {}) => ({
  id: `${state.toLowerCase()}:${cite_key}`,
  state,
  node_id,
  number: citation.split(" ").pop(),
  citation,
  cite_key,
  heading: `Rule ${citation}`,
  agency: "Agency",
  text,
  history: "History: filed",
  authority: null,
  status: "active",
  emergency: null,
  effective_date: "2025-07-10",
  adopted_date: null,
  register_citation: null,
  source_url: `https://example.gov/${state}/${cite_key}`,
  edition: null,
  currency: null,
  retrieved_at: "2026-10-23T19:00:00Z",
  raw_sha256: SHA,
  text_sha256: null,
  text_check: { text: "confirmed" },
  ordinal,
  ...extra,
});

test("state-regs/1 contract", { timeout: 180000 }, async (t) => {
  const db = new PGlite();
  const one = async (sql, args = []) => (await db.query(sql, args)).rows[0];
  const rpc = async (name, args = []) =>
    (
      await one(
        `select public.${name}(${args.map((_, i) => `$${i + 1}`).join(",")}) as result`,
        args,
      )
    ).result;
  try {
    await db.exec(CORPUS);
    await db.exec(INGEST);

    await t.test("applies twice", async () => {
      await db.exec(SQL);
      await db.exec(SQL);
      const n = await one("select count(*)::int as n from state_regs.cite_patterns");
      assert.equal(n.n, PATTERNS.patterns.length);
      const src = await one("select mode, ordinal_policy, enabled from ingest.sources where id = 'state_registers'");
      assert.deepEqual(src, { mode: "upsert", ordinal_policy: "prepend", enabled: false });
      const ds = await one("select ready from public.corpus_datasets where id = 'state_register_issues'");
      assert.equal(ds.ready, true);
    });

    await t.test("pattern table equals cite_patterns.json", async () => {
      const rows = (await db.query("select state, ord, pattern, template from state_regs.cite_patterns order by state, ord"))
        .rows;
      const want = [...PATTERNS.patterns]
        .sort((a, b) => (a[0] + a[1]).localeCompare(b[0] + b[1]))
        .map(([state, ord, pattern, template]) => ({ state, ord, pattern, template }));
      assert.deepEqual(rows, want);
    });

    await t.test("SQL cite_key equals the Python vectors", async () => {
      for (const v of VECTORS.vectors) {
        const r = await one("select state_regs.cite_key($1, $2) as k", [v.state, v.citation]);
        assert.equal(r.k, v.key, `${v.state} ${v.citation}`);
      }
    });

    await t.test("loads, is idempotent, and resolves exactly", async () => {
      assert.equal(await rpc("state_reg_load_codes_v1", [JSON.stringify([code("OH"), code("WA"), code("CA", { status: "commercial_only", access: "none", blocked_reason: "vendor" })])]), 3);
      assert.equal(await rpc("state_reg_load_codes_v1", [JSON.stringify([code("OH"), code("WA"), code("CA", { status: "commercial_only", access: "none", blocked_reason: "vendor" })])]), 0);
      const nodes = [node("oh:agency-3745", null, 0), node("oh:chapter-3745-4", "oh:agency-3745", 1, { rule_count: 2 })];
      assert.equal(await rpc("state_reg_load_nodes_v1", ["oh-sample-1", JSON.stringify(nodes)]), 2);
      assert.equal(await rpc("state_reg_load_nodes_v1", ["oh-sample-1", JSON.stringify(nodes)]), 0);
      const rules = [
        rule("OH", "Ohio Adm.Code 3745-4-01", "3745-4-1", "oh:chapter-3745-4", 0, "(A) The purpose of this chapter, credible data rules."),
        rule("OH", "Ohio Adm.Code 3745-4-02", "3745-4-2", "oh:chapter-3745-4", 1, "(A) Definitions of surface water monitoring."),
      ];
      assert.deepEqual(await rpc("state_reg_load_rules_v1", ["oh-sample-1", JSON.stringify(rules)]), { rows: 2, written: 2, unchanged: 0 });
      // same content, later retrieval: nothing is written
      const again = rules.map((r) => ({ ...r, retrieved_at: "2026-10-30T00:00:00Z" }));
      assert.deepEqual(await rpc("state_reg_load_rules_v1", ["oh-sample-1", JSON.stringify(again)]), { rows: 2, written: 0, unchanged: 2 });
      // a cite_key that the SQL function would not produce is refused
      await assert.rejects(
        rpc("state_reg_load_rules_v1", ["oh-sample-1", JSON.stringify([{ ...rules[0], id: "oh:x", cite_key: "x" }])]),
        /cite_key differs/,
      );
      assert.deepEqual(await rpc("state_reg_finish_v1", ["OH"]), { state: "OH", nodes: 2, text_rules: 2 });

      const ok = await rpc("state_reg_resolve_v1", ["OH", "Ohio Admin. Code 3745-4-01"]);
      assert.equal(ok.status, "resolved");
      assert.equal(ok.rule_id, "oh:3745-4-1");
      const miss = await rpc("state_reg_resolve_v1", ["OH", "Ohio Adm.Code 3745-4-03"]);
      assert.equal(miss.status, "unresolved");
      assert.equal(miss.rule_id, undefined);
      assert.equal(miss.reason, "no held rule has this citation");
      const notCite = await rpc("state_reg_resolve_v1", ["OH", "chapter 3745-4"]);
      assert.equal(notCite.status, "unresolved");
      assert.equal(notCite.key, null);
      const wa = await rpc("state_reg_resolve_v1", ["WA", "WAC 173-400-010"]);
      assert.equal(wa.status, "unresolved");
      assert.equal(wa.reason, "no rule text of this state is held");
      assert.equal((await rpc("state_reg_resolve_v1", ["ZZ", "1.1"])).status, "not_covered");
      assert.equal((await rpc("state_reg_resolve_v1", ["ohio", "1.1"])).status, "invalid");
    });

    await t.test("tree, rule, search, codes", async () => {
      const top = await rpc("state_reg_tree_v1", ["OH", null, 50, 0]);
      assert.equal(top.total, 1);
      assert.equal(top.nodes[0].id, "oh:agency-3745");
      assert.equal(top.nodes[0].children, 1);
      const ch = await rpc("state_reg_tree_v1", ["OH", "oh:chapter-3745-4", 50, 0]);
      assert.deepEqual(ch.rules.map((r) => r.id), ["oh:3745-4-1", "oh:3745-4-2"]);
      assert.deepEqual(ch.path.map((p) => p.id), ["oh:agency-3745", "oh:chapter-3745-4"]);
      assert.equal(ch.parent.rules_loaded, 2);
      const r = await rpc("state_reg_rule_v1", ["oh:3745-4-2"]);
      assert.equal(r.rule.text, "(A) Definitions of surface water monitoring.");
      assert.equal(r.rule.tsv, undefined);
      assert.equal(r.prev.id, "oh:3745-4-1");
      assert.equal(r.next, null);
      const s = await rpc("state_reg_search_v1", ["OH", "surface water monitoring", 10, 0]);
      assert.equal(s.total, 1);
      assert.equal(s.hits[0].id, "oh:3745-4-2");
      assert.match(s.hits[0].snippet, /«/);
      const byCite = await rpc("state_reg_search_v1", ["OH", "OAC 3745-4-01", 10, 0]);
      assert.equal(byCite.exact.id, "oh:3745-4-1");
      const codes = await rpc("state_reg_codes_v1");
      assert.deepEqual(codes.map((c) => c.state), ["CA", "OH", "WA"]);
      assert.equal(codes[1].text_rules, 2);
      const status = await rpc("state_reg_status_v1");
      assert.equal(status.rules, 2);
    });

    await t.test("prune removes only the named state's older builds", async () => {
      const newer = [rule("OH", "Ohio Adm.Code 3745-4-01", "3745-4-1", "oh:chapter-3745-4", 0, "(A) Changed text.")];
      await rpc("state_reg_load_rules_v1", ["oh-full-2", JSON.stringify(newer)]);
      await rpc("state_reg_load_nodes_v1", ["oh-full-2", JSON.stringify([node("oh:agency-3745", null, 0), node("oh:chapter-3745-4", "oh:agency-3745", 1, { rule_count: 2, heading: "x" })])]);
      const p = await rpc("state_reg_prune_v1", ["OH", "oh-full-2"]);
      assert.deepEqual(p, { state: "OH", build: "oh-full-2", rules_removed: 1, nodes_removed: 0 });
      // an unchanged rule loaded again under a newer build is kept by the next prune
      await rpc("state_reg_load_rules_v1", ["oh-full-3", JSON.stringify(newer)]);
      assert.deepEqual(await rpc("state_reg_prune_v1", ["OH", "oh-full-3"]), { state: "OH", build: "oh-full-3", rules_removed: 0, nodes_removed: 2 });
      await assert.rejects(rpc("state_reg_prune_v1", ["WA", "oh-full-2"]), /nothing pruned/);
    });

    await t.test("functions are service_role only", async () => {
      for (const f of ["state_reg_codes_v1()", "state_reg_resolve_v1(text, text)", "state_reg_load_rules_v1(text, jsonb)"]) {
        const r = await one(
          `select has_function_privilege('anon', 'public.${f}', 'execute') as anon,
                  has_function_privilege('authenticated', 'public.${f}', 'execute') as auth,
                  has_function_privilege('service_role', 'public.${f}', 'execute') as svc`,
        );
        assert.deepEqual(r, { anon: false, auth: false, svc: true }, f);
      }
      const d = await one(
        "select bool_and(prosecdef) as sd, bool_and(proconfig @> array['search_path=\"\"']) as sp from pg_proc where proname like 'state_reg_%'",
      );
      assert.deepEqual(d, { sd: true, sp: true });
    });
  } finally {
    await db.close();
  }
});
