// Isolated PostgreSQL contract tests for database/contracts/documents-v2-sources.sql (RECAP filings found through the
// CourtListener public locator join the court-filings layer). No credentials, network or live corpus: a throwaway
// in-memory PGlite database with the corpus objects the contract reads, filled with synthetic rows.
// Run: node --test src/lib/documents/contract-v2-sources.test.mjs   (from the repository root)
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";

const runtime =
  process.env.PUBLISHER_CODE_PGLITE ??
  path.resolve(
    "private/tools/publisher-code-contract-tests/node_modules/@electric-sql/pglite/dist/index.js",
  );
const { PGlite } = await import(pathToFileURL(runtime).href);
const sha = (v) => createHash("sha256").update(v).digest("hex");

// The live availability rule (corpus-pdf-availability-v2 as deployed 2026-10-27, fail closed on non-boolean flags).
const AVAILABILITY = `
create or replace function public.corpus_pdf_availability_v1(p_source_system text, p_provider_flags jsonb)
returns text language sql immutable set search_path = '' as $$
  select case
    when exists (
      select 1 from unnest(array['withheld_by_policy', 'is_sealed', 'restricted', 'sealing_related_locator_held']) k
      where coalesce(p_provider_flags -> k, 'null'::jsonb) not in ('false'::jsonb, 'null'::jsonb)
    ) then 'held'
    when p_source_system in ('docketbird', 'courtlistener', 'courtlistener-public-locator', 'official-court', 'govinfo') then 'open'
    else 'held'
  end
$$;`;

const MOCK = `
create role anon; create role authenticated; create role service_role;
create schema corpus_ingest;
create table corpus_ingest.pdf_document_assets (source_system text not null, native_document_id text not null, native_case_id text,
  sha256 text not null, source_record_sha256 text not null default md5(random()::text), queue_sha256 text, durable_url text,
  provider_flags jsonb not null default '{}', origins jsonb not null default '[]', verified_at timestamptz not null default now(),
  registered_at timestamptz not null default now());
create table corpus_ingest.pdf_objects (sha256 text primary key, sha1 text, bytes bigint, bucket text, storage_key text);
create table corpus_ingest.pdf_texts (sha256 text primary key, status text, page_count integer, pages_with_text integer,
  ocr_pending_pages integer, chars bigint, engine text, engine_version text, pages jsonb, text_sha256 text, extractor_version text,
  extracted_at timestamptz, registered_at timestamptz, note text);
create table corpus_ingest.pdf_text_pages (sha256 text, page integer, text text, chars integer generated always as (char_length(text)) stored,
  engine text, ocr_confidence real, truncated boolean default false,
  tsv tsvector generated always as (to_tsvector('simple'::regconfig, text)) stored, primary key (sha256, page));
create table corpus_ingest.local_pdf_asset_occurrences (local_occurrence_id text, sha256 text, source_system text,
  source_seal_status text, private_quarantine_required boolean, public_projection_allowed boolean);
create table public.corpus_records (dataset text, id text, title text, item jsonb, detail jsonb, filters jsonb, primary key (dataset, id));
${AVAILABILITY}`;

const LOC = "courtlistener-public-locator";
const DOCKET = "6245245"; // CourtListener docket id of the registry's MDL 2738 docket
const recap = (entry, att, suffix = "") =>
  `https://storage.courtlistener.com/recap/gov.uscourts.njd.333000/gov.uscourts.njd.333000.${entry}.${att}${suffix}.pdf`;
const S = Object.fromEntries(
  [
    "main101",
    "att101",
    "keyword102",
    "sealed103",
    "contact104",
    "ambiguous105",
    "cl106",
    "noentry107",
    "flat110",
    "heldLocator",
    "restrictedElsewhere",
    "unlisted",
    "localSeal",
  ].map((k) => [k, sha(`bytes ${k}`)]),
);
const PAGE_101 =
  "Case 3:16-md-02738-MAS-RLS Document 101 Filed 06/26/24 Page 1 of 1 PageID: 9\nORDER granting the motion to compel talc testing records.";

async function seed(db) {
  const rec = (dataset, id, { item = null, detail = null, filters = null } = {}) =>
    db.query("insert into public.corpus_records(dataset,id,item,detail,filters) values ($1,$2,$3,$4,$5)", [
      dataset,
      id,
      item,
      detail,
      filters,
    ]);
  await rec("sw_matters_v1", "sw-matter:2738", {
    detail: { registry: { mdl: "2738", pdf_case_ids: [DOCKET] } },
  });
  await rec("mdls", "2738", { detail: { cl_court_id: "njd", master_docket: "3:16-md-2738" } });
  await rec("court_spine", "njd");
  await rec("sw_matter_dockets_v1", "sw-md:2738:njd", {
    item: { cells: { docket_number: "3:16-md-02738" } },
    filters: { court_id: "njd", native_case_id: [DOCKET] },
  });
  const entry = (n, cells, suffix = "") =>
    rec("sw_docket_entries_v1", `sw-entry:courtlistener:${n}${suffix}`, {
      item: { cells: { entry_number: n, native_docket_id: DOCKET, held: false, documents_sealed: 0, ...cells } },
      filters: { native_docket_id: DOCKET, native_id: `${n}${suffix}` },
    });
  await entry(101, { description: "ORDER granting the motion to compel", date_filed: "2024-06-26" });
  // the builder's keyword flag on a description: not a source seal
  await entry(102, {
    description: null,
    description_withheld: "sealed_or_restricted_text",
    held: true,
    date_filed: "2024-06-27",
  });
  // CourtListener reports a sealed document on this entry: evidence about another attachment, not the file that exists
  await entry(103, {
    description: null,
    description_withheld: "sealed_document",
    held: true,
    documents_sealed: 1,
    date_filed: "2024-06-28",
  });
  await entry(104, {
    description: null,
    description_withheld: "contact_or_access_data",
    date_filed: "2024-06-29",
  });
  // two published rows carry entry number 105: not matched
  await entry(105, { description: "NOTICE one", date_filed: "2024-07-01" }, "a");
  await entry(105, { description: "NOTICE two", date_filed: "2024-07-02" }, "b");
  await entry(106, { description: "MOTION to dismiss", date_filed: "2024-07-03", document_ids: ["900106"] });

  const asset = (source, doc, kase, s, flags) =>
    db.query(
      "insert into corpus_ingest.pdf_document_assets(source_system,native_document_id,native_case_id,sha256,provider_flags,durable_url) values ($1,$2,$3,$4,$5,$6)",
      [source, doc, kase, s, flags, source === LOC ? doc : null],
    );
  const loc = { sealing_related_locator_held: false, public_pdf_link_observed: true };
  await asset(LOC, recap(101, 0), DOCKET, S.main101, loc);
  await asset(LOC, recap(101, 2), DOCKET, S.att101, loc);
  await asset(LOC, recap(102, 0), DOCKET, S.keyword102, loc);
  await asset(LOC, recap(103, 0), DOCKET, S.sealed103, loc);
  await asset(LOC, recap(112, 0), DOCKET, S.sealed103, loc); // same bytes as the sealed entry's file
  await asset(LOC, recap(104, 0), DOCKET, S.contact104, loc);
  await asset(LOC, recap(105, 0), DOCKET, S.ambiguous105, loc);
  await asset("courtlistener", "900106", DOCKET, S.cl106, { is_available: true, is_sealed: false });
  await asset(LOC, recap(106, 0), DOCKET, S.cl106, loc); // same bytes the CourtListener listing serves
  await asset(LOC, recap(107, 0, "_1"), DOCKET, S.noentry107, loc);
  await asset(
    LOC,
    "https://storage.courtlistener.com/recap/gov.uscourts.njd.333000.110.0.pdf",
    DOCKET,
    S.flat110,
    loc,
  );
  await asset(LOC, recap(120, 0), DOCKET, S.heldLocator, { ...loc, is_sealed: true });
  await asset(LOC, recap(121, 0), DOCKET, S.restrictedElsewhere, loc);
  await asset("docketbird", "njd-3:2016-md-02738-00121", "njd-3:2016-md-02738", S.restrictedElsewhere, {
    restricted: true,
  });
  await asset(LOC, recap(122, 0), DOCKET, S.localSeal, loc);
  await db.query(
    "insert into corpus_ingest.local_pdf_asset_occurrences(local_occurrence_id,sha256,source_system,source_seal_status) values ('l1',$1,'local-matter-bundle-pdf','locally_flagged_sealed')",
    [S.localSeal],
  );
  await asset(LOC, recap(130, 0), "99999", S.unlisted, loc); // no published page lists this docket
  for (const s of Object.values(S))
    await db.query(
      "insert into corpus_ingest.pdf_objects(sha256,bytes,bucket,storage_key) values ($1,1000,'corpus-originals',$2)",
      [s, `pdf/${s}`],
    );
  await db.query(
    "insert into corpus_ingest.pdf_texts(sha256,status,page_count,pages_with_text,ocr_pending_pages,chars,engine,extractor_version,extracted_at) values ($1,'complete',1,1,0,$2,'pdf-text-layer','pdf-text/2','2026-10-01T00:00:00Z')",
    [S.main101, PAGE_101.length],
  );
  await db.query(
    "insert into corpus_ingest.pdf_text_pages(sha256,page,text,engine) values ($1,1,$2,'pdf-text-layer')",
    [S.main101, PAGE_101],
  );
}

test("documents/1 v2 sources: public-locator RECAP filings", { timeout: 180000 }, async (t) => {
  const db = new PGlite();
  const one = async (sql, args = []) => (await db.query(sql, args)).rows[0];
  const rpc = async (name, args = []) =>
    (
      await db.query(
        `select public.${name}(${args.map((_, i) => `$${i + 1}`).join(",")}) as r`,
        args,
      )
    ).rows[0].r;
  const byDoc = async () =>
    Object.fromEntries(
      (await db.query("select * from documents.documents order by native_document_id")).rows.map((r) => [
        r.native_document_id,
        r,
      ]),
    );
  const v2 = await fs.readFile("database/contracts/documents-v2-sources.sql", "utf8");
  const scope = await fs.readFile("database/contracts/documents-v2-scope.sql", "utf8");
  // the body of documents_refresh_v1 in documents-v2-scope.sql, as pg_proc.prosrc stores it
  const scopeLf = scope.split(String.fromCharCode(13)).join("");
  const head = scopeLf.indexOf("create or replace function public.documents_refresh_v1(");
  const open = scopeLf.indexOf("as $$", head) + "as $$".length;
  const scopeRefresh = scopeLf.slice(open, scopeLf.indexOf("$$;", open));
  const before = 1; // 900106: the one non-locator filing of the seed that is open and unflagged
  const rollback = await fs.readFile("database/contracts/documents-v2-sources.rollback.sql", "utf8");
  try {
    await db.exec(MOCK);
    await db.exec(await fs.readFile("database/contracts/caselaw-read-v1.sql", "utf8"));
    await seed(db);
    await db.exec(await fs.readFile("database/contracts/documents-v1.sql", "utf8"));
    await db.exec(scope);

    await t.test("before: the documents/2 scope leaves every locator filing out", async () => {
      const r = await rpc("documents_refresh_v1", ["before"]);
      assert.equal(r.by_collection.docket_filings, before);
      assert.equal((await one("select count(*)::int n from documents.documents where source_system = $1", [LOC])).n, 0);
      await assert.rejects(
        db.query(
          "insert into documents.documents(id,source_system,native_document_id,native_case_id,sha256,collection,dataset,record_id,listed_by,mdl,text_status,build) values ('d_000000000000000000000000',$1,'x','y',$2,'docket_filings','sw_matters_v1','r','registry_pdf_case_id','1','not_extracted','b')",
          [LOC, S.unlisted],
        ),
        /check constraint/,
      );
    });

    await t.test("after: open locator filings of listed dockets join the layer", async () => {
      await db.exec(v2);
      await db.exec(v2); // idempotent
      const r = await rpc("documents_refresh_v1", ["after"]);
      assert.equal(r.locator_bytes_listed_by_other_source, 1);
      assert.deepEqual(r.excluded_bytes_flags, { association_flag: 1, local_seal_flag: 1 });
      const by = await byDoc();
      for (const absent of [
        recap(120, 0), // the locator association itself reports a seal: held by availability
        recap(121, 0), // the same bytes carry a restriction elsewhere
        recap(122, 0), // locally flagged sealed bytes
        recap(106, 0), // the CourtListener listing of the same bytes serves it
      ])
        assert.ok(!(absent in by), absent);
      assert.ok("900106" in by);
      // a docket no published page lists: the locator file enters on its docket, with no MDL (documents/2 scope)
      assert.deepEqual(
        [by[recap(130, 0)].listed_by, by[recap(130, 0)].mdl, by[recap(130, 0)].record_id],
        ["docket_case", null, "99999"],
      );
      const locs = Object.values(by).filter((d) => d.source_system === LOC && d.native_case_id === DOCKET);
      assert.equal(locs.length, 9);
      assert.ok(locs.every((d) => d.collection === "docket_filings" && d.listed_by === "registry_pdf_case_id"));
      assert.ok(locs.every((d) => d.mdl === "2738" && d.court_id === "njd" && d.docket_number === "3:16-md-02738"));
      assert.ok(locs.every((d) => d.source_url === d.native_document_id));
      assert.equal(
        (await rpc("documents_refresh_v1", ["after"])).changed,
        0,
        "an unchanged refresh rewrites nothing",
      );
    });

    await t.test("locator metadata is exact: file-name numbers, unique docket entry, main document title", async () => {
      const by = await byDoc();
      const main = by[recap(101, 0)];
      assert.equal(main.entry_number, 101);
      assert.equal(main.attachment, null);
      assert.equal(main.title, "ORDER granting the motion to compel");
      assert.equal(main.title_basis, "Docket description as published");
      assert.equal(main.doc_type, "order");
      assert.equal(main.filed_date.toISOString().slice(0, 10), "2024-06-26");
      assert.equal(main.date_basis, "Docket entry (published row sw-entry:courtlistener:101)");
      assert.equal(main.published_record, "sw_docket_entries_v1/sw-entry:courtlistener:101");
      assert.equal(main.text_status, "pending_index");
      const att = by[recap(101, 2)];
      assert.deepEqual([att.entry_number, att.attachment, att.title, att.doc_type], [101, 2, null, null]);
      assert.equal(att.filed_date.toISOString().slice(0, 10), "2024-06-26", "an attachment is filed with its entry");
      const amb = by[recap(105, 0)];
      assert.deepEqual([amb.entry_number, amb.title, amb.filed_date, amb.published_record], [105, null, null, null]);
      const none = by[recap(107, 0, "_1")];
      assert.deepEqual([none.entry_number, none.title, none.text_status], [107, null, "not_extracted"]);
      const flat = by["https://storage.courtlistener.com/recap/gov.uscourts.njd.333000.110.0.pdf"];
      assert.equal(flat.entry_number, 110);
    });

    await t.test("text is withheld only on a seal of the file itself, never on an entry-level flag", async () => {
      const by = await byDoc();
      // entry 103 reports a sealed document, but that is another attachment: the file that exists is not withheld
      // (the file's own seal is a provider flag, e.g. recap(120, 0), and leaves it out entirely)
      for (const open of [recap(102, 0), recap(103, 0), recap(112, 0), recap(104, 0)]) {
        assert.equal(by[open].text_status, "not_extracted", `${open}: an entry-level, keyword or contact flag is not a file seal`);
        assert.equal(by[open].withheld_reason, null);
      }
      for (const dated of [recap(102, 0), recap(103, 0), recap(104, 0)])
        assert.equal(by[dated].filed_date.toISOString().slice(0, 7), "2024-06");
      assert.equal(
        (await one("select count(*)::int n from documents.documents where source_system = $1 and text_status = 'withheld_policy'", [LOC])).n,
        0,
      );
    });

    await t.test("locator filings are indexed, searched and served like any other", async () => {
      let r;
      do r = await rpc("documents_build_pages_v1", ["after", 5]);
      while (r.remaining > 0);
      await rpc("documents_refresh_v1", ["after2"]);
      const id = (await one("select id, text_status from documents.documents where sha256 = $1", [S.main101]));
      assert.equal(id.text_status, "text_layer");
      const s = await rpc("documents_search_v1", ["talc testing"]);
      assert.deepEqual(s.rows.map((x) => x.source_system), [LOC]);
      assert.equal(s.rows[0].snippets[0].page, 1);
      const doc = await rpc("documents_document_v1", [id.id]);
      assert.equal(doc.source_system, LOC);
      assert.equal(doc.entry_number, 101);
      const ent = await rpc("documents_for_entity_v1", ["mdl", "2738", 50]);
      assert.equal(ent.total, 10);
    });

    await t.test("grants and function posture", async () => {
      const f = await one(
        "select p.prosecdef, p.proconfig from pg_proc p where p.oid = 'public.documents_refresh_v1(text)'::regprocedure",
      );
      assert.deepEqual([f.prosecdef, f.proconfig], [true, ['search_path=""']]);
      for (const role of ["anon", "authenticated"])
        assert.equal(
          (await one("select has_function_privilege($1, 'public.documents_refresh_v1(text)', 'execute') r", [role])).r,
          false,
        );
      assert.equal(
        (await one("select has_function_privilege('service_role', 'public.documents_refresh_v1(text)', 'execute') r")).r,
        true,
      );
    });

    await t.test("rollback restores the four-source layer", async () => {
      await db.exec(rollback);
      assert.equal((await one("select count(*)::int n from documents.documents where source_system = $1", [LOC])).n, 0);
      assert.equal(
        (await one("select count(*)::int n from documents.links l join documents.documents d on d.id = l.document_id where d.source_system = $1", [LOC])).n,
        0,
      );
      const r = await rpc("documents_refresh_v1", ["rolled"]);
      assert.equal(r.by_collection.docket_filings, before);
      assert.equal((await one("select count(*)::int n from documents.pages where sha256 = $1", [S.main101])).n, 0);
      const src = (await one("select prosrc from pg_proc where oid = 'public.documents_refresh_v1(text)'::regprocedure")).prosrc;
      assert.equal(
        createHash("md5").update(src.replace(/\r\n/g, "\n")).digest("hex"),
        createHash("md5").update(scopeRefresh.replace(/\r\n/g, "\n")).digest("hex"),
        "the documents-v2-scope.sql refresh text",
      );
      await db.exec(v2);
      assert.equal((await rpc("documents_refresh_v1", ["again"])).by_source[LOC], 10);
    });
  } finally {
    await db.close();
  }
});
