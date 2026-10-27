// Isolated PostgreSQL contract tests for database/contracts/documents-v2-docket-scope.sql (applied over documents-v1.sql,
// with the live availability rule corpus-pdf-availability-v2.sql) and its rollback. No credentials, network or live
// corpus: a throwaway in-memory PGlite database with synthetic rows.
// Run: node --test src/lib/documents/contract-docket-scope.test.mjs   (from the repository root)
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
const read = (f) => fs.readFile(path.resolve("database/contracts", f), "utf8");

const MOCK = `
create role anon; create role authenticated; create role service_role;
create schema corpus_ingest;
create table corpus_ingest.pdf_document_assets (source_system text not null, native_document_id text not null, native_case_id text,
  sha256 text not null, durable_url text, provider_flags jsonb not null default '{}', origins jsonb not null default '[]',
  verified_at timestamptz not null default now());
create table corpus_ingest.pdf_objects (sha256 text primary key, bytes bigint);
create table corpus_ingest.pdf_texts (sha256 text primary key, status text, page_count integer, pages_with_text integer,
  ocr_pending_pages integer, chars bigint, text_sha256 text, extractor_version text, extracted_at timestamptz);
create table corpus_ingest.pdf_text_pages (sha256 text, page integer, text text, chars integer generated always as (char_length(text)) stored,
  engine text, primary key (sha256, page));
create table corpus_ingest.local_pdf_asset_occurrences (local_occurrence_id text, sha256 text, source_seal_status text);
create table public.corpus_records (dataset text, id text, title text, item jsonb, detail jsonb, filters jsonb, primary key (dataset, id));`;

const S = {
  L: sha("L: listed MDL master-docket order"),
  T: sha("T: terminated MDL master docket filing"),
  U: sha("U: unlisted civil docket"),
  A: sha("A: appellate docket"),
  O: sha("O: official court page of an unregistered MDL"),
  X: sha("X: ambiguous case id"),
  M: sha("M: listed and unlisted association"),
  Z: sha("Z: sealed by the source"),
  Q: sha("Q: locally sealed"),
  N: sha("N: no case id"),
  P: sha("P: locator only"),
};

async function seed(db) {
  const rec = (dataset, id, { item = null, detail = null, filters = null } = {}) =>
    db.query(
      "insert into public.corpus_records(dataset,id,item,detail,filters) values ($1,$2,$3,$4,$5)",
      [dataset, id, item, detail, filters],
    );
  await rec("sw_matters_v1", "sw-matter:2738", {
    detail: {
      registry: { mdl: "2738", pdf_case_ids: ["njd-3:2016-md-02738", "paed-2:2012-md-02323"] },
    },
  });
  await rec("sw_matters_v1", "sw-matter:3060", {
    detail: { registry: { mdl: "3060", pdf_case_ids: ["paed-2:2012-md-02323"] } },
  });
  await rec("mdls", "2738", { detail: { cl_court_id: "njd", master_docket: "3:16-md-2738" } });
  await rec("mdls", "3060", { detail: { cl_court_id: "ilnd", master_docket: "1:23-cv-818" } });
  for (const c of ["njd", "cand", "ilnd", "ilsd", "ca2"]) await rec("court_spine", c);
  await rec("sw_docket_documents_v1", "sw-doc:docketbird:cand-5:2018-md-02827-00010", {
    item: {
      cells: {
        date_filed: "2019-03-04",
        description: "ORDER granting final approval",
        entry_number: 10,
      },
    },
    filters: { native_id: "cand-5:2018-md-02827-00010" },
  });

  const asset = (source, doc, kase, s, flags, extra = {}) =>
    db.query(
      "insert into corpus_ingest.pdf_document_assets(source_system,native_document_id,native_case_id,sha256,provider_flags,durable_url,origins,verified_at) values ($1,$2,$3,$4,$5,$6,$7,$8)",
      [
        source,
        doc,
        kase,
        s,
        flags,
        extra.url ?? null,
        extra.origins ?? [],
        extra.at ?? "2026-10-01T00:00:00Z",
      ],
    );
  const db1 = { restricted: false, downloaded: 1 };
  await asset("docketbird", "njd-3:2016-md-02738-00001", "njd-3:2016-md-02738", S.L, db1);
  await asset("docketbird", "cand-5:2018-md-02827-00010", "cand-5:2018-md-02827", S.T, db1);
  await asset("docketbird", "ilnd-1:2024-cv-06795-00001", "ilnd-1:2024-cv-06795", S.U, {});
  await asset("docketbird", "ca2-2024-01250-00035", "ca2-2024-01250", S.A, {});
  await asset("courtlistener", "910001", "16284915", S.U, { is_available: true });
  await asset(
    "official-court",
    "https://www.ilsd.uscourts.gov/mdl3004/cmo1.pdf",
    "3:21-md-3004-njr",
    S.O,
    {},
    {
      url: "https://www.ilsd.uscourts.gov/mdl3004/cmo1.pdf",
      origins: [
        {
          retrieved_at: "2026-10-01T00:00:00Z",
          listing: {
            printed_title: "Case Management Order No. 1",
            date_iso: "2021-06-10",
            doc_kind: "case_management_order",
            court_id: "ilsd",
            url: "https://www.ilsd.uscourts.gov/mdl3004/cmo1.pdf",
          },
        },
      ],
    },
  );
  await asset("docketbird", "paed-2:2012-md-02323-00001", "paed-2:2012-md-02323", S.X, db1);
  // one document, two associations: the listed one wins (verified earlier), the unlisted one is newer
  await asset("docketbird", "njd-3:2016-md-02738-00002", "njd-3:2016-md-02738", S.M, db1, {
    at: "2026-09-01T00:00:00Z",
  });
  await asset("docketbird", "njd-3:2016-md-02738-00002", "njd-3:2017-cv-01111", S.M, db1, {
    at: "2026-10-20T00:00:00Z",
  });
  await asset("courtlistener", "910002", "16284915", S.Z, { is_available: true, is_sealed: true });
  await asset("docketbird", "ilnd-1:2024-cv-06795-00002", "ilnd-1:2024-cv-06795", S.Q, {});
  await asset("official-court", "https://www.njd.uscourts.gov/x.pdf", null, S.N, {});
  await asset("courtlistener-public-locator", "777", "16284915", S.P, {});
  await db.query(
    "insert into corpus_ingest.local_pdf_asset_occurrences values ('l1', $1, 'locally_flagged_sealed')",
    [S.Q],
  );
  for (const s of Object.values(S)) {
    await db.query("insert into corpus_ingest.pdf_objects values ($1, 1000)", [s]);
    await db.query(
      "insert into corpus_ingest.pdf_texts values ($1,'complete',1,1,0,40,null,'pdf-text/2','2026-10-01T00:00:00Z')",
      [s],
    );
  }
  const page = (s, text) =>
    db.query(
      "insert into corpus_ingest.pdf_text_pages(sha256,page,text,engine) values ($1,1,$2,'pdf-text-layer')",
      [s, text],
    );
  await page(S.L, "ORDER on talc bellwether selection");
  await page(
    S.T,
    "Case 5:18-md-02827-EJD Document 10 Filed 03/04/19 Page 1 of 1\nORDER granting final approval of the throttling settlement",
  );
  await page(S.U, "MEMORANDUM opinion on the paraquat preemption defense");
  await page(S.A, "Appellate brief on the hernia mesh preemption defense");
  await page(S.O, "CASE MANAGEMENT ORDER NO. 1 for the paraquat litigation");
  await page(S.X, "concussion settlement notice");
  await page(S.M, "stipulation regarding the talc deposition protocol");
  await page(S.Z, "sealed exhibit text that must not be served");
  await page(S.Q, "locally sealed text that must not be served");
  await page(S.N, "a court page document without a case id");
  await page(S.P, "a public locator document");
}

test("documents/2 docket scope", { timeout: 180000 }, async (t) => {
  const db = new PGlite();
  const one = async (sql, args = []) => (await db.query(sql, args)).rows[0];
  const rows = async (sql, args = []) => (await db.query(sql, args)).rows;
  const rpc = async (name, args = []) =>
    (
      await db.query(
        `select public.${name}(${args.map((_, i) => `$${i + 1}`).join(",")}) as r`,
        args,
      )
    ).rows[0].r;
  const byDoc = async () =>
    Object.fromEntries(
      (await rows("select * from documents.documents")).map((d) => [d.native_document_id, d]),
    );
  try {
    await db.exec(MOCK);
    await db.exec(await read("corpus-pdf-availability-v2.sql"));
    await db.exec(await read("caselaw-read-v1.sql"));
    await seed(db);
    await db.exec(await read("documents-v1.sql"));

    let before;
    await t.test("v1 scope: only listed case ids", async () => {
      const r = await rpc("documents_refresh_v1", ["v1"]);
      assert.equal(r.documents, 2);
      before = await byDoc();
      assert.deepEqual(Object.keys(before).sort(), [
        "njd-3:2016-md-02738-00001",
        "njd-3:2016-md-02738-00002",
      ]);
    });

    await t.test("v2 applies over v1, twice", async () => {
      const v2 = await read("documents-v2-docket-scope.sql");
      await db.exec(v2);
      await db.exec(v2);
      const nn = await one(
        "select is_nullable from information_schema.columns where table_schema = 'documents' and table_name = 'documents' and column_name = 'mdl'",
      );
      assert.equal(nn.is_nullable, "YES");
    });

    await t.test(
      "open filings of unlisted dockets enter on their own case id, without an MDL",
      async () => {
        const r = await rpc("documents_refresh_v1", ["v2"]);
        const d = await byDoc();
        assert.equal(r.documents, 8);
        assert.equal(r.without_mdl, 6);
        for (const absent of [
          "910002", // the source reports it sealed (held by the availability rule)
          "ilnd-1:2024-cv-06795-00002", // bytes locally flagged sealed
          "https://www.njd.uscourts.gov/x.pdf", // no case id recorded
          "777", // courtlistener-public-locator is not a documents-layer source
        ])
          assert.ok(!(absent in d), absent);
        for (const id of [
          "cand-5:2018-md-02827-00010",
          "ilnd-1:2024-cv-06795-00001",
          "ca2-2024-01250-00035",
          "910001",
          "https://www.ilsd.uscourts.gov/mdl3004/cmo1.pdf",
          "paed-2:2012-md-02323-00001",
        ]) {
          assert.equal(d[id].listed_by, "native_case_id", id);
          assert.equal(d[id].mdl, null, `${id}: an MDL is never inferred`);
          assert.equal(d[id].dataset, "docket", id);
          assert.equal(d[id].record_id, d[id].native_case_id, id);
        }
        // listed rows are unchanged
        for (const id of Object.keys(before))
          for (const k of [
            "mdl",
            "listed_by",
            "dataset",
            "record_id",
            "native_case_id",
            "court_id",
            "docket_number",
          ])
            assert.equal(d[id][k], before[id][k], `${id}.${k}`);
        assert.equal(
          d["njd-3:2016-md-02738-00002"].native_case_id,
          "njd-3:2016-md-02738",
          "listed association preferred",
        );
      },
    );

    await t.test("metadata of docket rows uses exact bases only", async () => {
      const d = await byDoc();
      const t5 = d["cand-5:2018-md-02827-00010"];
      assert.deepEqual(
        [t5.court_id, t5.docket_number, t5.entry_number, t5.title],
        ["cand", "5:18-md-02827", 10, "ORDER granting final approval"],
      );
      assert.equal(t5.court_basis, "Court prefix of the DocketBird case id");
      const ap = d["ca2-2024-01250-00035"];
      assert.equal(
        ap.court_id,
        "ca2",
        "court prefix of the case id when the directory has that exact id",
      );
      assert.equal(ap.docket_number, null);
      const cl = d["910001"];
      assert.equal(cl.court_id, null, "no published docket row: court not recorded");
      const off = d["https://www.ilsd.uscourts.gov/mdl3004/cmo1.pdf"];
      assert.deepEqual(
        [off.court_id, off.docket_number, off.docket_basis, off.collection, off.doc_type],
        ["ilsd", "3:21-md-03004", "Case number on the court's page", "court_mdl_pages", "order"],
      );
      await assert.rejects(
        db.query(
          "update documents.documents set mdl = '2827' where native_document_id = 'cand-5:2018-md-02827-00010'",
        ),
        /documents_docket_scope_check/,
      );
      await assert.rejects(
        db.query(
          "update documents.documents set listed_by = 'native_case_id' where native_document_id = 'njd-3:2016-md-02738-00001'",
        ),
        /documents_docket_scope_check/,
      );
    });

    await t.test(
      "docket rows are indexed, searched, linked to their court and never to an MDL",
      async () => {
        let r;
        do r = await rpc("documents_build_pages_v1", ["v2", 3]);
        while (r.remaining > 0);
        await rpc("documents_refresh_v1", ["v2b"]);
        const s = await rpc("documents_search_v1", ["preemption defense"]);
        assert.deepEqual(s.rows.map((x) => x.native_document_id).sort(), [
          "910001",
          "ca2-2024-01250-00035",
          "ilnd-1:2024-cv-06795-00001",
        ]);
        assert.ok(s.rows.every((x) => x.mdl === null && x.listed_by === "native_case_id"));
        const all = await rpc("documents_search_v1", []);
        assert.equal(all.total, 8);
        assert.deepEqual(all.facets.mdl, [["2738", 2]], "MDL facet counts only rows with an MDL");
        const mdl = await rpc("documents_search_v1", [null, null, "2738"]);
        assert.equal(mdl.total, 2);
        const id = (
          await one(
            "select id from documents.documents where native_document_id = 'cand-5:2018-md-02827-00010'",
          )
        ).id;
        const links = await rpc("documents_links_v1", ["record", `documents/${id}`]);
        assert.deepEqual(
          links.map((l) => `${l.relation}:${l.to.type}:${l.to.id}`),
          ["filed_in:court:cand"],
        );
        const doc = await rpc("documents_document_v1", [id]);
        assert.deepEqual(
          [doc.dataset, doc.record_id, doc.mdl, doc.listed_by, doc.text_status],
          ["docket", "cand-5:2018-md-02827", null, "native_case_id", "text_layer"],
        );
        const court = await rpc("documents_for_entity_v1", ["court", "cand", 5]);
        assert.equal(court.total, 1);
        const st = await rpc("documents_status_v1");
        assert.equal(st.mdls, 1);
        assert.equal(st.documents, 8);
      },
    );

    await t.test("rollback restores the v1 scope and constraints", async () => {
      await db.exec(await read("documents-v2-docket-scope.rollback.sql"));
      const d = await byDoc();
      assert.deepEqual(Object.keys(d).sort(), Object.keys(before).sort());
      const nn = await one(
        "select is_nullable from information_schema.columns where table_schema = 'documents' and table_name = 'documents' and column_name = 'mdl'",
      );
      assert.equal(nn.is_nullable, "NO");
      assert.equal(
        (
          await one(
            "select count(*)::int n from documents.pages p where not exists (select 1 from documents.documents d where d.sha256 = p.sha256)",
          )
        ).n,
        0,
        "text of removed rows is dropped",
      );
      await assert.rejects(
        db.query(
          "update documents.documents set listed_by = 'native_case_id' where native_document_id = 'njd-3:2016-md-02738-00001'",
        ),
        /documents_listed_by_check/,
      );
      // and v2 applies again cleanly after a rollback
      await db.exec(await read("documents-v2-docket-scope.sql"));
      assert.equal((await rpc("documents_refresh_v1", ["v2c"])).documents, 8);
    });

    await t.test("grants and function posture", async () => {
      for (const f of [
        "public.documents_refresh_v1(text)",
        "public.documents_search_v1(text,text,text,date,date,text,text,integer,integer)",
        "public.documents_for_entity_v1(text,text,integer)",
        "public.documents_links_v1(text,text,text,integer)",
      ]) {
        for (const role of ["anon", "authenticated"])
          assert.equal(
            (await one("select has_function_privilege($1, $2, 'execute') r", [role, f])).r,
            false,
            `${role} ${f}`,
          );
        assert.equal(
          (await one("select has_function_privilege('service_role', $1, 'execute') r", [f])).r,
          true,
          f,
        );
        const p = await one(
          "select prosecdef, proconfig from pg_proc where oid = $1::regprocedure",
          [f],
        );
        assert.equal(p.prosecdef, true, f);
        assert.deepEqual(p.proconfig, ['search_path=""'], f);
      }
    });
  } finally {
    await db.close();
  }
});
