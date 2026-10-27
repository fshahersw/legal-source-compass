// Isolated PostgreSQL contract test for database/contracts/citations-status-fix-v1.sql, applied over citations-v2.sql
// (with documents-v1.sql, which it reads). A throwaway in-memory PGlite database with synthetic rows; no credentials,
// network or live corpus. The case-law resolver is mocked with the signature caselaw-v2.sql installs:
// public.caselaw_resolve_v2(p_citation text, p_year integer, p_court text) returning one jsonb object.
// Run: node --test src/lib/courts/citationsStatusFix.contract.test.mjs   (from the repository root; needs the private
// PGlite runtime, or PUBLISHER_CODE_PGLITE pointing at @electric-sql/pglite/dist/index.js)
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

// Answers in the shape caselaw-v2.sql returns (status, reason, cluster_id, candidates of caselaw.candidate objects).
const RESOLVER = `
create function public.caselaw_resolve_v2(p_citation text, p_year integer default null, p_court text default null)
returns jsonb language sql stable as $$
  select case p_citation
    when '556 U.S. 662' then jsonb_build_object('status', 'resolved', 'cluster_id', 2, 'candidates',
      jsonb_build_array(jsonb_build_object('cluster_id', 2, 'case_name', 'Ashcroft v. Iqbal')))
    when '1 F.3d 2' then jsonb_build_object('status', 'ambiguous', 'cluster_id', null, 'candidates',
      jsonb_build_array(jsonb_build_object('cluster_id', 3), jsonb_build_object('cluster_id', 4)))
    when '9 Zz. 9' then jsonb_build_object('status', 'unresolved', 'reason', 'not_a_citation', 'candidates', '[]'::jsonb)
    else jsonb_build_object('status', 'unresolved', 'reason', 'not_held', 'candidates', '[]'::jsonb)
  end
$$;
`;

const one = async (db, sql, args = []) => (await db.query(sql, args)).rows[0];
const resolve = async (db, key) =>
  (await one(db, "select citations.resolve_key($1, null) as v", [key])).v;

let db;
test.before(async () => {
  db = new PGlite();
  await db.exec(MOCK);
  await db.exec("set check_function_bodies = off");
  await db.exec(await fs.readFile(path.resolve("database/contracts/documents-v1.sql"), "utf8"));
  await db.exec("set check_function_bodies = on");
  await db.exec(await fs.readFile(path.resolve("database/contracts/citations-v2.sql"), "utf8"));
  const fix = await fs.readFile(
    path.resolve("database/contracts/citations-status-fix-v1.sql"),
    "utf8",
  );
  await db.exec(fix);
  await db.exec(fix); // idempotent
  await db.query(
    "insert into caselaw.cases values (2, 'Ashcroft v. Iqbal', array['556us662']), (3, 'Twin A', array['1f3d2']), (4, 'Twin B', array['1f3d2']), (5, 'Unparsed', array['9zz9'])",
  );
});

test("status reports the case-law resolver only once its real signature is installed", async () => {
  const before = (await one(db, "select public.citations_status_v2() as v")).v;
  assert.equal(before.resolvers.caselaw_resolve_v2, false);
  await db.exec(RESOLVER);
  const after = (await one(db, "select public.citations_status_v2() as v")).v;
  assert.equal(after.resolvers.caselaw_resolve_v2, true);
});

test("case keys go through the resolver and keep the cite_keys shapes", async () => {
  const ok = await resolve(db, "case:556:U.S.:662");
  assert.equal(ok.resolution, "resolved");
  assert.equal(ok.dataset, "caselaw");
  assert.equal(ok.id, "2");
  assert.equal(ok.resolver, "caselaw_resolve_v2");
  const amb = await resolve(db, "case:1:F.3d:2");
  assert.equal(amb.resolution, "ambiguous");
  assert.deepEqual(amb.candidates, ["3", "4"]);
  const missing = await resolve(db, "case:999:F.4th:99999");
  assert.equal(missing.resolution, "not_in_corpus");
  assert.equal(missing.reason, "resolver_not_found");
});

test("a text the parser does not read as a citation keeps the exact cite_keys path", async () => {
  const r = await resolve(db, "case:9:Zz.:9");
  assert.equal(r.resolver, "cite_keys");
  assert.equal(r.resolution, "resolved");
  assert.equal(r.id, "5");
});

test("functions stay service-role only", async () => {
  for (const sig of ["public.citations_status_v2()", "citations.call_resolver(text,text,text)"]) {
    const r = await one(
      db,
      "select has_function_privilege('anon', $1, 'execute') a, has_function_privilege('service_role', $1, 'execute') s",
      [sig],
    );
    assert.equal(r.a, false, sig);
    assert.equal(r.s, true, sig);
  }
});
