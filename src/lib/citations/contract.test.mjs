// Isolated PostgreSQL contract tests for database/contracts/citations-v2.sql (with documents-v1.sql, which it reads).
// No credentials, network or live corpus: a throwaway in-memory PGlite database with the corpus objects the contracts
// read, filled with synthetic rows. The citations loaded are the canonical extractor's own output for the shared golden
// fixture (src/lib/citations/fixtures/golden.json), so the loader is tested against real engine rows.
// Run: node --test src/lib/citations/contract.test.mjs   (from the repository root)
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";

const runtime =
  process.env.PUBLISHER_CODE_PGLITE ??
  path.resolve("private/tools/publisher-code-contract-tests/node_modules/@electric-sql/pglite/dist/index.js");
const { PGlite } = await import(pathToFileURL(runtime).href);
const sha = (v) => createHash("sha256").update(v).digest("hex");
const golden = JSON.parse(await fs.readFile(path.resolve("src/lib/citations/fixtures/golden.json"), "utf8"));
const goldenText = (id) => golden.texts.find((t) => t.id === id);
const VERSION = "citations-v2/test.1";

const MOCK = `
create role anon; create role authenticated; create role service_role;
create schema corpus_ingest;
create table corpus_ingest.pdf_document_assets (source_system text not null, native_document_id text not null, native_case_id text,
  sha256 text not null, provider_flags jsonb not null default '{}');
create table corpus_ingest.pdf_texts (sha256 text primary key, status text, page_count integer, pages_with_text integer,
  ocr_pending_pages integer, chars bigint, engine text, engine_version text, pages jsonb, text_sha256 text, extractor_version text,
  extracted_at timestamptz, registered_at timestamptz, note text);
create table corpus_ingest.pdf_text_pages (sha256 text, page integer, text text, primary key (sha256, page));
create table public.corpus_records (dataset text, id text, title text, item jsonb, detail jsonb, filters jsonb, primary key (dataset, id));
create or replace function public.corpus_pdf_availability_v1(p_source_system text, p_provider_flags jsonb)
returns text language sql immutable set search_path = '' as $$
  select case when p_provider_flags -> 'is_available' = 'true'::jsonb and p_provider_flags -> 'is_sealed' = 'false'::jsonb then 'open' else 'held' end
$$;
create schema caselaw;
create table caselaw.cases (cluster_id bigint primary key, case_name text, cite_keys text[]);
create function caselaw.cite_key(p text) returns text language sql immutable set search_path = '' as $$
  select regexp_replace(lower(coalesce(p, '')), '[^[:alnum:]]+', '', 'g') $$;
`;

// byte sets: one page per golden text (D1, D2 open in MDL 2738 / court njd; D3 the two-page golden document in MDL 3166 /
// cand; D4 held (sealed flag); S5 indexed bytes with no listed document)
const SETS = {
  D1: { pages: ["short-forms", "usc-lists", "cfr", "register-statutes", "local-rules"], mdl: "2738", court: "njd", open: true, filed: "2021-05-04" },
  D2: { pages: ["short-forms", "constitutions", "federal-rules", "state-statutes", "mdl-docket"], mdl: "2738", court: "njd", open: true, filed: "2023-01-09" },
  D3: { document: "pages", mdl: "3166", court: "cand", open: true, filed: "2025-02-01" },
  D4: { pages: ["short-forms"], mdl: "2738", court: "njd", open: false, filed: "2022-07-07" },
};

function setPages(name) {
  const s = SETS[name];
  if (s.document) {
    const d = golden.documents.find((x) => x.id === s.document);
    return d.pages.map((text, i) => ({ page: i + 1, text, expected: d.expected[i] }));
  }
  return s.pages.map((id, i) => ({ page: i + 1, text: goldenText(id).text, expected: goldenText(id).expected }));
}

/** The load payload the batch runner and the nightly function build from engine output (antecedent -> page number + seq). */
function payload(sha256, pages) {
  return pages.map((p) => ({
    src: "pdf",
    src_id: sha256,
    page: p.page,
    citations: p.expected.map((c, seq) => ({
      seq,
      kind: c.kind,
      form: c.form,
      short: c.short,
      short_status: c.short_status,
      start: c.start,
      end: c.end,
      matched: c.matched,
      key: c.key,
      normalized: c.normalized,
      pin: c.pin,
      group: c.group,
      name: c.name,
      antecedent:
        c.antecedent === null || c.antecedent === undefined
          ? null
          : typeof c.antecedent === "number"
            ? { page: p.page, seq: c.antecedent }
            : { page: pages[c.antecedent.page].page, seq: c.antecedent.index },
      fields: c.fields,
    })),
  }));
}

async function seed(db) {
  const rec = (dataset, id, { title = null, item = null, detail = null, filters = null } = {}) =>
    db.query("insert into public.corpus_records(dataset,id,title,item,detail,filters) values ($1,$2,$3,$4,$5,$6)", [
      dataset, id, title, item, detail, filters,
    ]);
  await rec("us_code_sections", "42:1983", { title: "42 U.S.C. § 1983 Civil action for deprivation of rights" });
  await rec("us_code_sections", "28:1332", { title: "28 U.S.C. § 1332 Diversity of citizenship" });
  await rec("ecfr_sections_full", "cfr:21:314.50", { title: "21 CFR 314.50 Content and format of an NDA." });
  await rec("ecfr_sections_full", "cfr:21:part-11", { title: "21 CFR Part 11—Electronic Records" });
  await rec("federal_regulations_parts", "cfr:21:314", { title: "21 CFR part 314" });
  await rec("federal_regulations_sections", "cfr:12:1026.18", { title: "Content of disclosures." });
  await rec("mdls", "2738", { title: "In re Talc" });
  await rec("federal_register_history", "1001", {
    title: "A rule", detail: { facts: [["Citation", "85 FR 12340 (pages 12340-12360)"]] }, item: { cells: { citation: "85 FR 12340" } },
  });
  await rec("federal_register_history", "1002", { title: "Another rule", item: { cells: { citation: "91 FR 66990" } } });
  await rec("public_laws_enacted", "stat-124-119", { title: "Pub. L. 111–148", item: { cells: { law: "Pub. L. 111–148" } } });
  await rec("court_rule_sections", "us-frcp:0020", { title: "Rule 12", item: { rule_section: { number: "12", label: "Rule 12" } }, filters: { doc: ["us-frcp"] } });
  await rec("court_rule_sections", "us-fre:0050", { title: "Rule 702", item: { rule_section: { number: "702", label: "Rule 702" } }, filters: { doc: ["us-fre"] } });
  await rec("court_rule_sections", "njd-combined:0009", { title: "Civ. RULE 7.1", item: { rule_section: { number: "7.1", label: "Civ. RULE 7.1" } }, filters: { doc: ["njd-combined"] } });
  await rec("court_rule_sections", "njd-combined:0125", { title: "Cr. RULE 7.1", item: { rule_section: { number: "7.1", label: "Cr. RULE 7.1" } }, filters: { doc: ["njd-combined"] } });
  await rec("court_rule_sections", "cand-civil:0030", { title: "Civil L.R. 7-3", item: { rule_section: { number: "7-3", label: "7-3" } }, filters: { doc: ["cand-civil"] } });
  await rec("state_constitution_sections", "ca-const:0008", {
    title: "California Const. Article I, Section 7", item: { constitution_section: { state: "CA", article: "I", section: "7" } },
  });
  await rec("state_statutes_test", "ca-bpc-17200", { title: "Cal. Bus. & Prof. Code § 17200" });
  await db.query("insert into caselaw.cases values (1, 'Bell Atlantic Corp. v. Twombly', array['550us544','127sct1955']), (2, 'Ashcroft v. Iqbal', array['556us662']), (3, 'Twin A', array['1f3d2']), (4, 'Twin B', array['1f3d2'])");

  for (const [name, s] of Object.entries(SETS)) {
    const h = sha(`bytes ${name}`);
    s.sha = h;
    s.id = "d_" + sha(`doc ${name}`).slice(0, 24);
    for (const p of setPages(name))
      await db.query("insert into corpus_ingest.pdf_text_pages(sha256,page,text) values ($1,$2,$3)", [h, p.page, p.text]);
    await db.query(
      "insert into corpus_ingest.pdf_document_assets(source_system,native_document_id,native_case_id,sha256,provider_flags) values ('courtlistener',$1,'c',$2,$3)",
      [`n-${name}`, h, s.open ? { is_available: true, is_sealed: false } : { is_available: true, is_sealed: true }],
    );
    await db.query("insert into documents.page_sets(sha256,fingerprint,status,pages,build) values ($1,'f','indexed',$2,'t')", [h, setPages(name).length]);
    await db.query(
      `insert into documents.documents(id,source_system,native_document_id,native_case_id,sha256,collection,dataset,record_id,listed_by,mdl,court_id,filed_date,title,text_status,build)
       values ($1,'courtlistener',$2,'c',$3,'docket_filings','mdls',$4,'registry_pdf_case_id',$4,$5,$6,$7,'text_layer','t')`,
      [s.id, `n-${name}`, h, s.mdl, s.court, s.filed, `Filing ${name}`],
    );
  }
  // indexed bytes that no listed document serves
  await db.query("insert into documents.page_sets(sha256,fingerprint,status,pages,build) values ($1,'f','indexed',1,'t')", [sha("bytes S5")]);
  await db.query("insert into corpus_ingest.pdf_text_pages(sha256,page,text) values ($1,1,'See 42 U.S.C. § 1983.')", [sha("bytes S5")]);
}

const one = async (db, sql, params = []) => (await db.query(sql, params)).rows[0];
const rpc = async (db, fn, ...args) => {
  const ph = args.map((_, i) => `$${i + 1}`).join(",");
  return (await one(db, `select public.${fn}(${ph}) as v`, args)).v;
};

let db;
let run;
test.before(async () => {
  db = new PGlite();
  await db.exec(MOCK);
  await db.exec("set check_function_bodies = off");
  await db.exec(await fs.readFile(path.resolve("database/contracts/documents-v1.sql"), "utf8"));
  await db.exec("set check_function_bodies = on");
  const sql = await fs.readFile(path.resolve("database/contracts/citations-v2.sql"), "utf8");
  await db.exec(sql);
  await db.exec(sql); // idempotent
  await seed(db);
});

test("contract shape: functions are service-role only, tables closed to clients", async () => {
  const fns = (await db.query(
    "select p.oid::regprocedure::text sig, p.prosecdef, p.proconfig from pg_proc p join pg_namespace n on n.oid = p.pronamespace where (n.nspname = 'public' and p.proname like 'citations\\_%') or n.nspname = 'citations'",
  )).rows;
  assert.ok(fns.length >= 26);
  for (const f of fns) {
    assert.deepEqual(f.proconfig, ["search_path=\"\""], f.sig);
    for (const role of ["anon", "authenticated", "public"]) {
      if (role === "public") continue;
      assert.equal((await one(db, "select has_function_privilege($1, $2, 'execute') ok", [role, f.sig])).ok, false, `${role} ${f.sig}`);
    }
    assert.equal((await one(db, "select has_function_privilege('service_role', $1, 'execute') ok", [f.sig])).ok, true, f.sig);
    if (f.sig.startsWith("citations_") || f.sig.includes("citations_")) assert.equal(f.prosecdef, true, f.sig);
  }
  for (const t of ["runs", "page_state", "occurrences", "authorities", "edges", "fr_index", "pl_index"])
    assert.equal((await one(db, "select has_table_privilege('anon', $1, 'select') ok", [`citations.${t}`])).ok, false, t);
  assert.equal((await one(db, "select has_schema_privilege('anon', 'citations', 'usage') ok")).ok, false);
});

test("key shapes, roman numerals and district courts", async () => {
  const k = async (kind, key) => (await one(db, "select citations.key_ok($1,$2) ok", [kind, key])).ok;
  assert.equal(await k("case", "case:550:U.S.:544"), true);
  assert.equal(await k("case", "case:2021:IL App (4th):190114"), true);
  assert.equal(await k("usc", "usc:42:1331:1332"), true);
  assert.equal(await k("usc", "usc-ch:43:46"), true);
  assert.equal(await k("cfr", "cfr:26:1.501(c)(3)-1"), true);
  assert.equal(await k("cfr", "cfr-part:21:11"), false);
  assert.equal(await k("state_statute", "state-stat:CA:busprof:17200"), true);
  assert.equal(await k("mdl", "mdl:0"), false);
  assert.equal(await k("case", "usc:42:1983"), false);
  assert.equal((await one(db, "select citations.roman_int('XIV') a, citations.roman_int('iv') b, citations.roman_int('12') c, citations.roman_int('X1') d")).a, 14);
  const r = await one(db, "select citations.roman_int('iv') b, citations.roman_int('X1') d");
  assert.equal(r.b, 4);
  assert.equal(r.d, null);
  const courts = await one(db,
    "select citations.court_from_slug('ndcalciv') a, citations.court_from_slug('dnj') b, citations.court_from_slug('sdny') c, citations.court_from_slug('dmd') d, citations.court_from_slug('edpa') e, citations.court_from_slug('xyz') f");
  assert.deepEqual(courts, { a: "cand", b: "njd", c: "nysd", d: "mdd", e: "paed", f: null });
});

test("run ledger: one running run per kind", async () => {
  run = (await rpc(db, "citations_open_run_v2", "batch", "manual", VERSION)).run_id;
  await assert.rejects(rpc(db, "citations_open_run_v2", "batch", "manual", VERSION), /already running/);
  await assert.rejects(rpc(db, "citations_open_run_v2", "batch", "manual", "Bad Version!"), /Invalid run/);
});

test("pending pages: whole open byte sets, newest first, nothing for a held set's absence of documents", async () => {
  const p = await rpc(db, "citations_pending_pages_v2", VERSION, 10, 600);
  const shas = p.documents.map((d) => d.sha256);
  // D4's document exists (text served) but its availability is held: pages are still extracted (display is checked on read)
  assert.ok(shas.includes(SETS.D1.sha) && shas.includes(SETS.D3.sha));
  assert.ok(!shas.includes(sha("bytes S5")), "bytes that no document serves are not extracted");
  const d3 = p.documents.find((d) => d.sha256 === SETS.D3.sha);
  assert.deepEqual(d3.pages.map((x) => x.page), [1, 2]);
  assert.equal(p.remaining, 4);
  const capped = await rpc(db, "citations_pending_pages_v2", VERSION, 10, 1);
  assert.equal(capped.documents.length, 1);
});

test("load: engine rows are accepted only where the stored text holds them", async () => {
  for (const name of Object.keys(SETS)) {
    const pages = setPages(name);
    const res = await rpc(db, "citations_load_v2", run, VERSION, JSON.stringify(payload(SETS[name].sha, pages)));
    assert.deepEqual(res.rejected, {}, name);
    assert.equal(res.accepted, pages.reduce((n, p) => n + p.expected.length, 0), name);
  }
  const bad = payload(SETS.D1.sha, setPages("D1")).slice(0, 1);
  const c0 = bad[0].citations[0];
  bad[0].citations = [
    { ...c0, seq: 0 },
    { ...c0, seq: 1, matched: c0.matched + "x" },
    { ...c0, seq: 2, key: "usc:42:1983" },
    { ...c0, seq: 3, form: "full", key: null },
    { ...c0, seq: 4, start: -1 },
  ];
  const res = await rpc(db, "citations_load_v2", run, VERSION, JSON.stringify(bad));
  assert.equal(res.accepted, 1);
  assert.deepEqual(res.rejected, { text_mismatch: 1, bad_key: 2, bad_offsets: 1 });
  const notIndexed = await rpc(db, "citations_load_v2", run, VERSION,
    JSON.stringify([{ src: "pdf", src_id: sha("never indexed"), page: 1, citations: [] }]));
  assert.deepEqual(notIndexed.rejected, { bytes_not_indexed: 1 });
  // the bad batch replaced page 1 of D1: reload it
  await rpc(db, "citations_load_v2", run, VERSION, JSON.stringify(payload(SETS.D1.sha, setPages("D1")).slice(0, 1)));
  const occ = await one(db, "select count(*)::int n from citations.occurrences where src_id = $1 and page = 1", [SETS.D1.sha]);
  assert.equal(occ.n, goldenText("short-forms").expected.length);
  const ante = await one(db, "select antecedent from citations.occurrences where src_id = $1 and page = 2 and matched = '550 U.S. at 556'", [SETS.D3.sha]);
  assert.deepEqual(ante.antecedent, { page: 1, seq: 0 });
  const pending = await rpc(db, "citations_pending_pages_v2", VERSION, 10, 600);
  assert.equal(pending.remaining, 0);
  assert.equal((await rpc(db, "citations_pending_pages_v2", "citations-v2/next", 10, 600)).remaining, 4);
});

test("resolve: exact keys only, every state distinguished", async () => {
  assert.equal((await rpc(db, "citations_build_index_v2", "fr", "", 1000)).written, 2);
  assert.equal((await rpc(db, "citations_build_index_v2", "pl", "", 1000)).written, 1);
  await db.query("insert into citations.authorities(key, kind, normalized) values ('case:1:F.3d:2','case','1 F.3d 2') on conflict do nothing");
  const r = await rpc(db, "citations_resolve_v2", 5000, run);
  assert.equal(r.pending, 0);
  const a = async (key) => one(db, "select resolution, reason, target_dataset, target_id, link_type, link_id, candidates from citations.authorities where key = $1", [key]);
  assert.deepEqual(await a("usc:42:1983"), { resolution: "resolved", reason: "exact_section", target_dataset: "us_code_sections", target_id: "42:1983", link_type: "law_unit", link_id: "usc:42:1983", candidates: null });
  assert.equal((await a("cfr:40:63.10:63.15")).reason, "range");
  assert.equal((await a("usc:50a:4305")).resolution, "not_in_corpus");
  assert.deepEqual(await a("case:550:U.S.:544"), { resolution: "resolved", reason: "exact_citation", target_dataset: "caselaw", target_id: "1", link_type: "record", link_id: "caselaw/1", candidates: null });
  assert.equal((await a("case:1:F.3d:2")).resolution, "ambiguous");
  assert.deepEqual((await a("case:1:F.3d:2")).candidates, ["3", "4"]);
  const cfr = await a("cfr:21:314.50");
  assert.equal(cfr.target_dataset, "ecfr_sections_full");
  assert.equal(cfr.link_id, "cfr:21:314");
  assert.equal((await a("cfr-part:21:11")).target_id, "cfr:21:part-11");
  assert.equal((await a("cfr:12:1026.18")).target_dataset, "federal_regulations_sections");
  assert.deepEqual([(await a("fr:85:12345")).resolution, (await a("fr:85:12345")).reason, (await a("fr:85:12345")).target_id], ["resolved", "page_within_document", "1001"]);
  assert.equal((await a("fr:91:67000")).resolution, "not_in_corpus");
  assert.equal((await a("pl:111:148")).target_id, "stat-124-119");
  assert.equal((await a("stat:124:119")).target_id, "stat-124-119");
  assert.equal((await a("pl:119:99")).resolution, "not_in_corpus");
  assert.equal((await a("const-us:art-1:sec-8:cl-3")).reason, "us_constitution_not_in_corpus");
  assert.equal((await a("const:CA:art-1:sec-7")).target_id, "ca-const:0008");
  assert.equal((await a("rule:frcp:12")).target_id, "us-frcp:0020");
  assert.equal((await a("local-rule:ndcalciv:7-3")).target_id, "cand-civil:0030");
  assert.equal((await a("local-rule:dnj:7.1")).target_id, "njd-combined:0009");
  assert.equal((await a("local-rule::7.1")).reason, "court_not_named");
  assert.deepEqual([(await a("mdl:2738")).link_type, (await a("mdl:2738")).link_id], ["mdl", "2738"]);
  const st = await a("state-stat:CA:busprof:17200");
  assert.deepEqual([st.resolution, st.reason], ["unresolved", "unresolved_target_missing"]);
});

test("resolvers owned by other contracts are used once installed, and their answers are verified", async () => {
  await db.exec(`create function public.state_law_resolve_v1(p_state text, p_citation text) returns jsonb language sql as $$
    select case when p_citation like '%17200%' then jsonb_build_object('status','resolved','dataset','state_statutes_test','record_id','ca-bpc-17200')
                when p_citation like '%340.8%' then jsonb_build_object('status','resolved','dataset','state_statutes_test','record_id','nope')
                when p_citation like '%2A:58C%' then jsonb_build_object('status','ambiguous','candidates', jsonb_build_array('x','y'))
                else null end $$`);
  const q = await rpc(db, "citations_requeue_v2", null, "unresolved_target_missing");
  assert.ok(q.requeued >= 10);
  await rpc(db, "citations_resolve_v2", 5000, null);
  const a = async (key) => one(db, "select resolution, reason, target_dataset, target_id from citations.authorities where key = $1", [key]);
  assert.deepEqual(await a("state-stat:CA:busprof:17200"), { resolution: "resolved", reason: "resolver", target_dataset: "state_statutes_test", target_id: "ca-bpc-17200" });
  assert.deepEqual(await a("state-stat:CA:civproc:340.8"), { resolution: "unresolved", reason: "resolver_target_not_found", target_dataset: null, target_id: null });
  assert.equal((await a("state-stat:NJ:stat:2A:58C-2")).resolution, "ambiguous");
  assert.equal((await a("state-stat:FL:stat:95.11")).reason, "resolver_no_match");
  // a case-law resolver answering a set of rows naming two clusters
  await db.exec(`create function public.caselaw_resolve_v2(p_citation text) returns table(cluster_id bigint, status text) language sql as $$
    select x, 'resolved' from unnest(case when p_citation = '556 U.S. 662' then array[2::bigint] else array[3::bigint, 4::bigint] end) x $$`);
  await rpc(db, "citations_requeue_v2", "case", null);
  await rpc(db, "citations_resolve_v2", 5000, null);
  assert.deepEqual(await a("case:556:U.S.:662"), { resolution: "resolved", reason: "resolver", target_dataset: "caselaw", target_id: "2" });
  assert.equal((await a("case:550:U.S.:544")).resolution, "ambiguous");
  await db.exec("drop function public.caselaw_resolve_v2(text)");
  await rpc(db, "citations_requeue_v2", "case", null);
  await rpc(db, "citations_resolve_v2", 5000, null);
  assert.equal((await a("case:550:U.S.:544")).target_id, "1");
});

test("link: edges per document, mentions apart, court-less local rules read in the filing's court", async () => {
  const r = await rpc(db, "citations_link_v2", null, "", 500, run);
  assert.equal(r.done, true);
  const e = async (doc, key) => one(db, "select relation, mentions, full_mentions, short_mentions, first_page, pages, pins from citations.edges where citing_id = $1 and key = $2", [doc, key]);
  const tw = await e(SETS.D1.id, "case:550:U.S.:544");
  assert.equal(tw.relation, "cites");
  assert.equal(tw.full_mentions, 1);
  assert.equal(tw.short_mentions, 4);
  assert.ok(tw.pins.includes("556") && tw.pins.includes("678"));
  assert.equal((await e(SETS.D2.id, "mdl:2738")).relation, "mentions");
  assert.equal((await e(SETS.D2.id, "docket:3:16-md-02738")).relation, "mentions");
  assert.ok(await e(SETS.D1.id, "local-rule:@njd:7.1"));
  assert.equal(await e(SETS.D1.id, "local-rule::7.1"), undefined);
  const d3 = await e(SETS.D3.id, "usc:42:1983");
  assert.deepEqual([d3.mentions, d3.pages], [2, [1, 2]]);
  await rpc(db, "citations_resolve_v2", 5000, run);
  const lr = await one(db, "select resolution, target_id, normalized from citations.authorities where key = 'local-rule:@njd:7.1'");
  assert.deepEqual(lr, { resolution: "resolved", target_id: "njd-combined:0009", normalized: "Local Rule 7.1 (njd)" });
  // relinking replaces, never duplicates
  const before = (await one(db, "select count(*)::int n from citations.edges")).n;
  await rpc(db, "citations_link_v2", [SETS.D1.sha], "", 500, null);
  assert.equal((await one(db, "select count(*)::int n from citations.edges")).n, before);
  const fin = await rpc(db, "citations_finish_run_v2", run, "ok", JSON.stringify({ note: "test" }), null);
  assert.equal(fin.status, "ok");
  assert.ok(fin.pages_loaded >= 13 && fin.authorities_resolved > 0 && fin.documents_linked === 4);
});

test("read RPCs: document, cited-by, top authorities, co-citation, profile, map, links, status", async () => {
  const doc = await rpc(db, "citations_document_v2", SETS.D1.id, 200);
  assert.equal(doc.text_served, true);
  assert.equal(doc.pages_extracted, 5);
  const tw = doc.authorities.find((x) => x.key === "case:550:U.S.:544");
  assert.equal(tw.target.dataset, "caselaw");
  assert.equal(tw.node, "caselaw/1");
  assert.equal(await rpc(db, "citations_document_v2", SETS.D4.id, 200), null, "held documents are not served");
  await assert.rejects(rpc(db, "citations_document_v2", "x", 10), /Invalid document/);

  const cb = await rpc(db, "citations_cited_by_v2", "usc:42:1983", null, null, 25, 0);
  assert.equal(cb.documents, 2, "D1 and D3 cite § 1983; D4 is held");
  assert.deepEqual(cb.by_mdl, [["2738", 1], ["3166", 1]]);
  const byRecord = await rpc(db, "citations_cited_by_v2", null, "caselaw", "1", 25, 0);
  assert.equal(byRecord.documents, 3);
  assert.deepEqual(byRecord.by_year, [[2021, 1], [2023, 1], [2025, 1]]);
  await assert.rejects(rpc(db, "citations_cited_by_v2", "usc:42:1983", "caselaw", "1", 25, 0), /Name a key/);

  const top = await rpc(db, "citations_top_authorities_v2", "2738", null, 10);
  assert.equal(top.documents_with_citations, 2);
  assert.equal(top.authorities[0].node, "caselaw/1");
  assert.equal(top.authorities[0].documents, 2);
  assert.ok(!top.authorities.some((x) => x.kind === "mdl" || x.kind === "docket"), "mentions are not cited authorities");

  const co = await rpc(db, "citations_cocitations_v2", "case:550:U.S.:544", null, 25, 1, 60);
  assert.ok(co.co_cited.some((x) => x.node === "caselaw/2"));
  const pairs = await rpc(db, "citations_cocitations_v2", null, "2738", 10, 2, 60);
  assert.ok(pairs.pairs.length >= 1);
  assert.equal(pairs.pairs[0].documents_together, 2);

  const prof = await rpc(db, "citations_authority_v2", "case:550:U.S.:544", null, null);
  assert.equal(prof.first_filed, "2021-05-04");
  assert.equal(prof.last_filed, "2025-02-01");
  assert.ok(prof.occurrences >= 10);

  const map = await rpc(db, "citations_map_v2", "2738", null, 10, 10);
  const ids = new Set(map.nodes.map((n) => n.id));
  assert.ok(map.nodes.some((n) => n.type === "document") && map.nodes.some((n) => n.type === "authority"));
  for (const l of map.links) assert.ok(ids.has(l.source) && ids.has(l.target), JSON.stringify(l));
  assert.equal(map.documents_total, 2);

  // documents.links-shaped view: mentions are the edge counts, never multiplied by the pages an edge spans
  const dl = (await db.query("select document_id, to_type, to_id, relation, mentions, first_page, pages from citations.document_links order by 1,2,3,4")).rows;
  const d3 = dl.find((r) => r.document_id === SETS.D3.id && r.to_id === "usc:42:1983");
  assert.deepEqual([d3.mentions, d3.first_page, d3.pages], [2, 1, [1, 2]], "an edge on two pages counts its mentions once");
  for (const r of dl) {
    const direct = await one(db, `select sum(e.mentions)::int n, min(e.first_page) f from citations.edges e join citations.authorities a
      on a.key = e.key and a.resolution = 'resolved' and a.link_type = $2 and a.link_id = $3
      where e.citing_type = 'document' and e.citing_id = $1 and e.relation = $4`, [r.document_id, r.to_type, r.to_id, r.relation]);
    assert.deepEqual([r.mentions, r.first_page], [direct.n, direct.f], JSON.stringify(r));
  }
  assert.ok(dl.some((r) => r.pages.length > 1), "the fixture has a link spanning several pages");

  const links = await rpc(db, "citations_links_v2", "record", `documents/${SETS.D1.id}`, null, 100);
  assert.ok(links.some((l) => l.to.type === "law_unit" && l.to.id === "usc:42:1983" && l.relation === "cites"));
  assert.ok(links.some((l) => l.to.type === "record" && l.to.id === "caselaw/1"));
  const inbound = await rpc(db, "citations_links_v2", "mdl", "2738", "mentions", 100);
  assert.deepEqual(inbound.map((l) => l.from.id), [`documents/${SETS.D2.id}`]);

  const st = await rpc(db, "citations_status_v2");
  assert.equal(st.byte_sets_extracted, 4);
  assert.equal(st.resolvers.state_law_resolve_v1, true);
  assert.equal(st.resolvers.caselaw_resolve_v2, false);
});

test("insights family 'citations' (insights-citations-v1.sql) counts the graph for spine entities", async () => {
  await db.exec("set check_function_bodies = off");
  await db.exec(await fs.readFile(path.resolve("database/contracts/insights-v1.sql"), "utf8"));
  await db.exec("set check_function_bodies = on");
  await db.exec(await fs.readFile(path.resolve("database/contracts/insights-citations-v1.sql"), "utf8"));
  await db.exec(await fs.readFile(path.resolve("database/contracts/insights-citations-v1.sql"), "utf8")); // idempotent
  for (const [t, id] of [["mdl", "2738"], ["mdl", "3166"], ["court", "njd"]])
    await db.query("insert into insights.entities(entity_type, entity_id, label, source_dataset) values ($1,$2,$3,'test')", [t, id, id]);
  const r = (await one(db, "select insights.refresh_citations('test') v")).v;
  assert.equal(r.status, "succeeded", JSON.stringify(r));
  const f = (await db.query("select metric_id, entity_type, entity_id, period, value::int v, n::int n from insights.facts order by 1,2,3,4")).rows;
  const get = (m, t, id, p) => f.find((x) => x.metric_id === m && x.entity_type === t && x.entity_id === id && (p === undefined || x.period === p));
  // MDL 2738: D1 (2021) and D2 (2023) cite; D4 is held and not counted
  assert.deepEqual([get("citations_filings_citing", "mdl", "2738", "2021").v, get("citations_filings_citing", "mdl", "2738", "2021").n], [1, 1]);
  assert.equal(get("citations_filings_citing", "court", "njd", "2023").v, 1);
  assert.equal(get("citations_filings_citing", "court", "cand", "2025"), undefined, "cand is not in the spine");
  assert.equal(get("citations_decisions_cited", "mdl", "2738").v, 2);
  assert.ok(get("citations_provisions_cited", "mdl", "2738").v >= 5);
  const again = (await one(db, "select insights.refresh_citations('test') v")).v;
  assert.equal(again.unchanged, f.length);
});
