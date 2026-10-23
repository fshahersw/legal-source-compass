// Isolated PostgreSQL contract tests for database/contracts/documents-v1.sql. No credentials, network or live corpus:
// a throwaway in-memory PGlite database with the corpus objects the contract reads, filled with synthetic rows.
// Run: node --test src/lib/documents/contract.test.mjs   (from the repository root)
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

// The live availability rule (pg_get_functiondef, 2026-10-23), verbatim.
const AVAILABILITY = `
create or replace function public.corpus_pdf_availability_v1(p_source_system text, p_provider_flags jsonb)
returns text language sql immutable set search_path = '' as $$
  select case
    when p_provider_flags -> 'withheld_by_policy' = 'true'::jsonb then 'held'
    when p_source_system = 'docketbird'
      and p_provider_flags -> 'restricted' = 'false'::jsonb
      and p_provider_flags -> 'downloaded' in ('1'::jsonb, 'true'::jsonb) then 'open'
    when p_source_system = 'courtlistener'
      and p_provider_flags -> 'is_available' = 'true'::jsonb
      and p_provider_flags -> 'is_sealed' = 'false'::jsonb then 'open'
    when p_source_system = 'official-court'
      and p_provider_flags -> 'sealing_related_locator_held' = 'false'::jsonb then 'open'
    when p_source_system = 'govinfo'
      and p_provider_flags -> 'sealing_related_locator_held' = 'false'::jsonb then 'open'
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

const S = {
  A: sha("bytes A: order with citations"),
  B: sha("bytes B: sealed exhibit"),
  C: sha("bytes C: derived MDL order"),
  D: sha("bytes D: motion to dismiss"),
  E: sha("bytes E: withheld entry"),
  F: sha("bytes F: locally sealed"),
  G: sha("bytes G: not extracted"),
  H: sha("bytes H: no text layer"),
  I: sha("bytes I: CMO on court page"),
  J: sha("bytes J: ambiguous case id"),
  K: sha("bytes K: not listed"),
};
const PAGE_A1 =
  "Case 3:16-md-02738-MAS-RLS Document 101 Filed 10/05/16 Page 1 of 2 PageID: 55\nORDER\nPlaintiffs rely on 42 U.S.C. § 1983 and Obergefell v. Hodges, 576 U.S. 644 (2015). See also 21 C.F.R. § 314.50 and MDL No. 2738.";
const PAGE_A2 =
  "Case 3:16-md-02738-MAS-RLS Document 101 Filed 10/05/16 Page 2 of 2 PageID: 56\nThe settlement fund of $5,000,000 is approved.";
const PAGE_C1 =
  "Case 3:25-md-03166-RS Document 30 Filed 06/02/25 Page 1 of 1\nCASE MANAGEMENT ORDER regarding the bellwether schedule.";
const PAGE_D1 =
  "MEMORANDUM in support of the motion to dismiss for lack of personal jurisdiction under 28 U.S.C. § 1407.";

async function seed(db) {
  const rec = (dataset, id, { title = null, item = null, detail = null, filters = null } = {}) =>
    db.query(
      "insert into public.corpus_records(dataset,id,title,item,detail,filters) values ($1,$2,$3,$4,$5,$6)",
      [dataset, id, title, item, detail, filters],
    );
  await rec("sw_matters_v1", "sw-matter:2738", {
    detail: {
      registry: {
        mdl: "2738",
        pdf_case_ids: ["njd-3:2016-md-02738", "6245245", "paed-2:2012-md-02323"],
      },
    },
  });
  await rec("sw_matters_v1", "sw-matter:3060", {
    detail: { registry: { mdl: "3060", pdf_case_ids: ["paed-2:2012-md-02323"] } },
  });
  await rec("mdls", "2738", {
    detail: {
      cl_court_id: "njd",
      master_docket: "3:16-md-2738",
      judge_links: [{ links: [{ url: "#judge/2bd1f904b1639f16cc7e65e218c52997" }] }],
    },
  });
  await rec("mdls", "3166", { detail: { cl_court_id: "cand", master_docket: "3:25-md-3166" } });
  await rec("mdls", "3060", { detail: { cl_court_id: "ilnd", master_docket: "1:23-cv-818" } });
  for (const c of ["njd", "cand", "ilnd"]) await rec("court_spine", c, { title: c });
  await rec("sw_matter_dockets_v1", "sw-md:2738:njd", {
    item: { cells: { docket_number: "3:16-md-02738" } },
    filters: {
      court_id: "njd",
      native_case_id: ["njd-3:2016-md-02738", "6245245", "MDL No. 2738"],
    },
  });
  await rec("sw_docket_documents_v1", "sw-doc:docketbird:njd-3:2016-md-02738-00001", {
    item: {
      cells: {
        date_filed: "2016-10-05",
        description: "ORDER regarding the scope of the MDL",
        entry_number: 1,
        court_url: "https://ecf.njd.uscourts.gov/doc1/1",
      },
    },
    filters: { native_id: "njd-3:2016-md-02738-00001" },
  });
  await rec("sw_docket_entries_v1", "sw-entry:courtlistener:1", {
    item: {
      cells: {
        document_ids: ["900001"],
        date_filed: "2020-01-02",
        description: "MOTION to Dismiss",
        entry_number: 12,
        held: false,
      },
    },
  });
  await rec("sw_docket_entries_v1", "sw-entry:courtlistener:2", {
    item: {
      cells: {
        document_ids: ["900002"],
        date_filed: "2020-02-02",
        description: null,
        description_withheld: "sealed_or_restricted_text",
        held: false,
      },
    },
  });
  for (const [id, t] of [
    ["42:1983", "42 U.S.C. § 1983"],
    ["28:1407", "28 U.S.C. § 1407"],
  ])
    await rec("us_code_sections", id, { title: t });
  await rec("federal_regulations_parts", "cfr:21:314", { title: "Applications for FDA approval" });

  const asset = (source, doc, kase, s, flags, extra = {}) =>
    db.query(
      "insert into corpus_ingest.pdf_document_assets(source_system,native_document_id,native_case_id,sha256,provider_flags,durable_url,origins) values ($1,$2,$3,$4,$5,$6,$7)",
      [source, doc, kase, s, flags, extra.url ?? null, extra.origins ?? []],
    );
  const open = { restricted: false, downloaded: 1 };
  await asset("docketbird", "njd-3:2016-md-02738-00001", "njd-3:2016-md-02738", S.A, open);
  await asset("docketbird", "njd-3:2016-md-02738-00099", "njd-3:2016-md-02738", S.A, open); // same bytes, second listing
  await asset("docketbird", "njd-3:2016-md-02738-00002-001", "njd-3:2016-md-02738", S.B, open);
  await asset("docketbird", "cand-3:2025-md-03166-00030", "cand-3:2025-md-03166", S.C, open);
  await asset("docketbird", "njd-3:2016-md-02738-00003", "njd-3:2016-md-02738", S.G, {
    restricted: false,
    downloaded: 0,
  }); // held
  await asset("docketbird", "ilnd-1:2024-cv-06795-00001", "ilnd-1:2024-cv-06795", S.K, open); // not listed
  await asset("courtlistener", "900001", "6245245", S.D, { is_available: true, is_sealed: false });
  await asset("courtlistener", "900002", "6245245", S.E, { is_available: true, is_sealed: false });
  await asset("courtlistener-public-locator", "777", "6245245", S.A, {
    sealing_related_locator_held: false,
  });
  await asset(
    "official-court",
    "https://www.njd.uscourts.gov/cmo1.pdf",
    "MDL 2738",
    S.I,
    { sealing_related_locator_held: false },
    {
      url: "https://www.njd.uscourts.gov/cmo1.pdf",
      origins: [
        {
          retrieved_at: "2026-10-01T00:00:00Z",
          listing: {
            printed_title: "Case Management Order No. 1",
            date_iso: "2017-01-01",
            doc_kind: "case_management_order",
            court_id: "njd",
            url: "https://www.njd.uscourts.gov/cmo1.pdf",
          },
        },
      ],
    },
  );
  await asset("docketbird", "njd-3:2016-md-02738-00004", "njd-3:2016-md-02738", S.F, open);
  await asset("docketbird", "njd-3:2016-md-02738-00005", "njd-3:2016-md-02738", S.G, open);
  await asset("docketbird", "njd-3:2016-md-02738-00006", "njd-3:2016-md-02738", S.H, open);
  await asset("docketbird", "paed-2:2012-md-02323-00001", "paed-2:2012-md-02323", S.J, open);
  await db.query(
    "insert into corpus_ingest.local_pdf_asset_occurrences(local_occurrence_id,sha256,source_system,source_seal_status,private_quarantine_required) values ('l1',$1,'local-matter-bundle-pdf','locally_flagged_sealed',true)",
    [S.F],
  );
  for (const s of Object.values(S))
    await db.query(
      "insert into corpus_ingest.pdf_objects(sha256,bytes,bucket,storage_key) values ($1,1000,'corpus-originals',$2)",
      [s, `pdf/${s}`],
    );
  const texts = async (s, status, pages, pendingOcr = 0) => {
    await db.query(
      "insert into corpus_ingest.pdf_texts(sha256,status,page_count,pages_with_text,ocr_pending_pages,chars,engine,extractor_version,extracted_at) values ($1,$2,$3,$4,$5,$6,'pdf-text-layer','pdf-text/2','2026-10-01T00:00:00Z')",
      [
        s,
        status,
        pages.length + pendingOcr,
        pages.length,
        pendingOcr,
        pages.reduce((n, p) => n + p.length, 0),
      ],
    );
    for (const [i, t] of pages.entries())
      await db.query(
        "insert into corpus_ingest.pdf_text_pages(sha256,page,text,engine) values ($1,$2,$3,'pdf-text-layer')",
        [s, i + 1, t],
      );
  };
  await texts(S.A, "complete", [PAGE_A1, PAGE_A2]);
  await texts(S.B, "complete", [
    "EXHIBIT 4 confidential settlement letter",
    "FILED UNDER SEAL pursuant to the protective order",
  ]);
  await texts(S.C, "complete", [PAGE_C1]);
  await texts(S.D, "complete", [PAGE_D1]);
  await texts(S.E, "complete", ["Motion to dismiss text that must not be served"]);
  await texts(S.F, "complete", ["locally sealed text"]);
  await texts(S.H, "partial_ocr_pending", [], 3);
  await texts(S.I, "complete", ["CASE MANAGEMENT ORDER NO. 1 governing the bellwether process"]);
  await texts(S.J, "complete", ["ambiguous listing"]);
  await texts(S.K, "complete", ["dismiss not listed"]);
}

async function caselaw(db) {
  await db.exec(await fs.readFile("database/contracts/caselaw-read-v1.sql", "utf8"));
  const kase = (id, cites) =>
    db.query(
      `insert into caselaw.cases(cluster_id,tier,court_id,case_name,citations,cite_keys,name_tsv,build)
       values ($1,1,'scotus','Synthetic v. Case',$2,(select array_agg(caselaw.cite_key(x)) from unnest($2::text[]) x),''::tsvector,'t')`,
      [id, cites],
    );
  await kase(123, ["576 U.S. 644", "135 S. Ct. 2584"]);
  await kase(200, ["1 F.3d 1"]);
  await kase(201, ["1 F.3d 1"]);
}

test("documents/1 contract", { timeout: 180000 }, async (t) => {
  const db = new PGlite();
  const one = async (sql, args = []) => (await db.query(sql, args)).rows[0];
  const rpc = async (name, args = []) =>
    (
      await db.query(
        `select public.${name}(${args.map((_, i) => `$${i + 1}`).join(",")}) as r`,
        args,
      )
    ).rows[0].r;
  try {
    await db.exec(MOCK);
    await caselaw(db);
    await seed(db);
    const contract = await fs.readFile("database/contracts/documents-v1.sql", "utf8");
    await db.exec(contract);
    await db.exec(contract); // idempotent

    await t.test("eligibility: open associations of listed case ids only", async () => {
      const r = await rpc("documents_refresh_v1", ["b1"]);
      assert.equal(r.documents, 9);
      assert.deepEqual(r.excluded_bytes_flags, { local_seal_flag: 1 });
      const rows = (
        await db.query(
          "select source_system, native_document_id, listed_by, mdl, text_status from documents.documents order by 1,2",
        )
      ).rows;
      const ids = rows.map((x) => x.native_document_id);
      for (const absent of [
        "njd-3:2016-md-02738-00003", // held: not downloaded
        "ilnd-1:2024-cv-06795-00001", // open, but no published page lists its case
        "777", // courtlistener-public-locator is never open
        "njd-3:2016-md-02738-00004", // locally flagged sealed bytes
        "paed-2:2012-md-02323-00001", // case id listed for two MDLs
      ])
        assert.ok(!ids.includes(absent), absent);
      const by = Object.fromEntries(rows.map((x) => [x.native_document_id, x]));
      assert.equal(by["cand-3:2025-md-03166-00030"].listed_by, "derived_master_docket");
      assert.equal(by["cand-3:2025-md-03166-00030"].mdl, "3166");
      assert.equal(by["https://www.njd.uscourts.gov/cmo1.pdf"].listed_by, "court_mdl_label");
      assert.equal(by["900002"].text_status, "withheld_policy");
      assert.equal(by["njd-3:2016-md-02738-00005"].text_status, "not_extracted");
      assert.equal(by["njd-3:2016-md-02738-00006"].text_status, "no_text_layer");
      assert.equal(by["njd-3:2016-md-02738-00001"].text_status, "pending_index");
      assert.equal(
        (await rpc("documents_refresh_v1", ["b1"])).changed,
        0,
        "an unchanged refresh rewrites nothing",
      );
    });

    await t.test("metadata comes from published rows, with its basis", async () => {
      const d = await one(
        "select * from documents.documents where native_document_id = 'njd-3:2016-md-02738-00001'",
      );
      assert.equal(d.title, "ORDER regarding the scope of the MDL");
      assert.equal(d.doc_type, "order");
      assert.equal(d.court_id, "njd");
      assert.equal(d.docket_number, "3:16-md-02738");
      assert.equal(d.entry_number, 1);
      assert.match(d.date_basis, /^Docket sheet/);
      assert.equal(
        d.published_record,
        "sw_docket_documents_v1/sw-doc:docketbird:njd-3:2016-md-02738-00001",
      );
      const cl = await one("select * from documents.documents where native_document_id = '900001'");
      assert.equal(cl.doc_type, "motion");
      assert.equal(String(cl.filed_date.toISOString()).slice(0, 10), "2020-01-02");
      const cmo = await one(
        "select * from documents.documents where source_system = 'official-court'",
      );
      assert.equal(cmo.collection, "court_mdl_pages");
      assert.equal(cmo.title, "Case Management Order No. 1");
      assert.equal(cmo.doc_type, "order");
      const held = await one(
        "select title, withheld_reason from documents.documents where native_document_id = '900002'",
      );
      assert.equal(held.title, null);
      assert.equal(held.withheld_reason, "entry_withheld");
    });

    await t.test(
      "pages: display rule withholds every page of the bytes; ECF header dates fold in",
      async () => {
        let r;
        do r = await rpc("documents_build_pages_v1", ["b1", 2]);
        while (r.remaining > 0);
        const b = await one(
          "select status, policy_page from documents.page_sets where sha256 = $1",
          [S.B],
        );
        assert.deepEqual(b, { status: "withheld_policy", policy_page: 2 });
        assert.equal(
          (await one("select count(*)::int n from documents.pages where sha256 = $1", [S.B])).n,
          0,
        );
        assert.equal(
          (await one("select count(*)::int n from documents.pages where sha256 = $1", [S.E])).n,
          0,
          "entry-withheld bytes never indexed",
        );
        assert.equal(
          (await one("select count(*)::int n from documents.pages where sha256 = $1", [S.A])).n,
          2,
        );
        const ecf = (await one("select ecf from documents.page_sets where sha256 = $1", [S.C])).ecf;
        assert.equal(ecf.filed, "2025-06-02");
        assert.equal(ecf.docket, "3:25-md-03166");
        await rpc("documents_refresh_v1", ["b2"]);
        const c = await one(
          "select filed_date::text f, date_basis, docket_number, text_status from documents.documents where sha256 = $1",
          [S.C],
        );
        assert.deepEqual(c, {
          f: "2025-06-02",
          date_basis: "ECF header printed on page 1",
          docket_number: "3:25-md-03166",
          text_status: "text_layer",
        });
        assert.equal(
          (
            await one(
              "select text_status, withheld_reason from documents.documents where sha256 = $1",
              [S.B],
            )
          ).withheld_reason,
          "page_text_policy",
        );
      },
    );

    await t.test("ECF header and helpers", async () => {
      const e = async (s) =>
        (await one("select documents.ecf_header($1, date '2026-10-23') r", [s])).r;
      assert.equal(
        (await e("Case: 1:23-cv-00818 Document #: 1138 Filed: 02/09/24 Page 1 of 5 PageID #:12"))
          .filed,
        "2024-02-09",
      );
      assert.equal(
        (await e("Case MDL No. 3166 Document 1-1 Filed 06/02/25 Page 1 of 3")).case,
        "MDL No. 3166",
      );
      assert.equal(
        (
          await e(
            "Case: 2:18-md-02846-EAS-KAJ Doc #: 904 Filed: 07/07/25 Page: 3 of 3 PAGEID #: 9643",
          )
        ).docket,
        "2:18-md-02846",
      );
      assert.equal(
        (await e("CASE 0:22-md-03031-JRT-JFD Doc. 1609 Filed 07/16/26 Page 13 of 48")).of,
        48,
      );
      const fl = await e(
        "Case 9:20-md-02924-RLR Document 7361 Entered on FLSD Docket 10/25/2024 Page 7 of 9",
      );
      assert.deepEqual([fl.filed, fl.date_kind], ["2024-10-25", "entered"]);
      assert.equal(
        await e("Case 1:23-cv-00818 Document 1 Filed 02/30/24 Page 1 of 5"),
        null,
        "impossible date",
      );
      assert.equal(
        await e("Case 1:23-cv-00818 Document 1 Filed 02/03/29 Page 1 of 5"),
        null,
        "future date",
      );
      const k = async (s) => (await one("select documents.docket_key($1) r", [s])).r;
      assert.equal(await k("3:16-md-2738"), "3:16-md-02738");
      assert.equal(await k("1:2023-cv-818-ABC"), "1:23-cv-00818");
      assert.equal(await k("3:16-cv-123456"), "3:16-cv-123456");
      assert.equal(await k("MDL 2738"), null);
      const w = async (s) => (await one("select documents.withheld_text($1) r", [s])).r;
      assert.equal(await w("Motion to file under seal"), true);
      assert.equal(await w("The ex parte application"), true);
      assert.equal(await w("REDACTED"), true);
      assert.equal(await w("The unsealed order"), false, "word bounded");
      assert.equal(await w("Bellwether schedule"), false);
    });

    await t.test(
      "search: page-numbered snippets, filters, held and withheld text never served",
      async () => {
        const s = await rpc("documents_search_v1", ["dismiss"]);
        assert.equal(s.mode, "text");
        const ids = s.rows.map((r) => r.native_document_id);
        assert.deepEqual(
          ids,
          ["900001"],
          "withheld (900002), not listed (K) and indexed-elsewhere bytes are not hits",
        );
        assert.equal(s.rows[0].snippets[0].page, 1);
        assert.match(s.rows[0].snippets[0].text, /\[\[dismiss\]\]/);
        const m = await rpc("documents_search_v1", ["order", null, "3166"]);
        assert.deepEqual(
          m.rows.map((r) => r.mdl),
          ["3166"],
        );
        const sealed = await rpc("documents_search_v1", ["confidential settlement"]);
        assert.equal(
          sealed.rows.length,
          0,
          "bytes withheld by the display rule are not searchable",
        );
        const browse = await rpc("documents_search_v1", [
          null,
          "njd",
          null,
          "2016-01-01",
          "2020-12-31",
        ]);
        assert.equal(browse.mode, "browse");
        assert.ok(
          browse.rows.every(
            (r) =>
              r.court_id === "njd" && r.filed_date >= "2016-01-01" && r.filed_date <= "2020-12-31",
          ),
        );
        assert.ok(browse.facets.type.length > 0);
        const typed = await rpc("documents_search_v1", [null, null, null, null, null, "motion"]);
        assert.deepEqual(
          typed.rows.map((r) => r.native_document_id),
          ["900001"],
        );
        await assert.rejects(
          rpc("documents_search_v1", [null, null, null, null, null, null, "relevance"]),
          /Invalid sort/,
        );
        await assert.rejects(rpc("documents_search_v1", ["x", "NJD"]), /Invalid court/);
        const page = await rpc("documents_search_v1", [
          null,
          null,
          "2738",
          null,
          null,
          null,
          "newest",
          2,
          0,
        ]);
        assert.equal(page.rows.length, 2);
        assert.equal(page.has_more, true);
        // an association that stops being open drops out at read time, before any refresh
        await db.query(
          "update corpus_ingest.pdf_document_assets set provider_flags = provider_flags || '{\"withheld_by_policy\": true}' where native_document_id = '900001'",
        );
        const again = await rpc("documents_search_v1", ["dismiss"]);
        assert.equal(again.rows.length, 0);
        assert.equal(again.dropped_unavailable, 1);
        assert.equal(
          await rpc("documents_document_v1", [
            (await one("select id from documents.documents where native_document_id='900001'")).id,
          ]),
          null,
        );
        await db.query(
          "update corpus_ingest.pdf_document_assets set provider_flags = provider_flags - 'withheld_by_policy' where native_document_id = '900001'",
        );
      },
    );

    await t.test(
      "extraction exchange: export only indexed text; load checks offsets against the stored page",
      async () => {
        const ex = await rpc("documents_export_pages_v1", ["", 50]);
        const shas = new Set(ex.pages.map((p) => p.sha256));
        assert.ok(shas.has(S.A) && shas.has(S.C) && shas.has(S.D) && shas.has(S.I));
        for (const no of [S.B, S.E, S.F, S.J, S.K]) assert.ok(!shas.has(no));
        const at = (text, needle) => {
          const i = [...text].join("").indexOf(needle);
          return {
            start: [...text.slice(0, i)].length,
            end: [...text.slice(0, i)].length + [...needle].length,
          };
        };
        const row = (s, page, text, needle, kind, key, extra = {}) => ({
          sha256: s,
          page,
          ...at(text, needle),
          matched: needle,
          kind,
          key,
          ...extra,
        });
        const rows = [
          row(S.A, 1, PAGE_A1, "42 U.S.C. § 1983", "usc", "usc:42:1983", {
            normalized: "42 U.S.C. § 1983",
          }),
          row(S.A, 1, PAGE_A1, "576 U.S. 644", "case_citation", "case:576 U.S. 644"),
          row(S.A, 1, PAGE_A1, "21 C.F.R. § 314.50", "cfr", "cfr:21:314.50"),
          row(S.A, 1, PAGE_A1, "MDL No. 2738", "mdl_number", "mdl:2738"),
          row(S.A, 2, PAGE_A2, "$5,000,000", "dollar_amount", null, {
            value: { amount: 5000000, sentence: "The settlement fund of $5,000,000 is approved." },
          }),
          row(S.D, 1, PAGE_D1, "28 U.S.C. § 1407", "usc", "usc:28:1407"),
          {
            sha256: S.D,
            page: 1,
            start: 0,
            end: 10,
            matched: "MEMORANDUM",
            kind: "case_citation",
            key: "case:1 F.3d 1",
          },
          {
            sha256: S.D,
            page: 1,
            start: 0,
            end: 10,
            matched: "MEMORANDUX",
            kind: "date",
            key: null,
          },
          { sha256: S.B, page: 1, start: 0, end: 7, matched: "EXHIBIT", kind: "date", key: null },
          { sha256: S.A, page: 1, start: 0, end: 4, matched: "Case", kind: "usc", key: "usc:bad" },
          { sha256: S.A, page: 9, start: 0, end: 4, matched: "Case", kind: "date", key: null },
          row(S.A, 1, PAGE_A1, "MDL No. 2738", "state_code", "x"),
        ];
        // a key no stored section has (at its own offset; the key of an extraction is never guessed)
        rows.push(row(S.A, 1, PAGE_A1, "1983 and", "usc", "usc:99:1"));
        const r = await rpc("documents_load_extractions_v1", ["b2", JSON.stringify(rows)]);
        assert.equal(r.accepted, 9);
        assert.deepEqual(r.rejected, {
          text_mismatch: 1,
          bytes_not_indexed: 1,
          bad_key: 1,
          no_such_page: 1,
        });
      },
    );

    await t.test("resolution is exact; ambiguous and absent keys stay unlinked", async () => {
      let r;
      do r = await rpc("documents_resolve_v1", [3]);
      while (r.pending > 0);
      const res = Object.fromEntries(
        (
          await db.query(
            "select key, resolution, target_type, target_id from documents.extractions where key is not null",
          )
        ).rows.map((x) => [x.key, x]),
      );
      assert.deepEqual(res["usc:42:1983"].target_id, "usc:42:1983");
      assert.equal(res["usc:99:1"].resolution, "unresolved");
      assert.equal(res["cfr:21:314.50"].target_id, "cfr:21:314");
      assert.equal(res["case:576 U.S. 644"].target_id, "caselaw/123");
      assert.equal(res["case:1 F.3d 1"].resolution, "ambiguous");
      assert.equal(res["mdl:2738"].target_type, "mdl");
      assert.equal(
        res["x"].resolution,
        "unresolved",
        "state code citations are not resolved in documents/1",
      );
      assert.equal(
        (await one("select resolution from documents.extractions where kind = 'dollar_amount'"))
          .resolution,
        "not_applicable",
      );
    });

    await t.test("links and entity reads", async () => {
      const l = await rpc("documents_link_v1");
      assert.ok(l.links >= 8);
      const usc = await rpc("documents_for_entity_v1", ["law_unit", "usc:42:1983", 5]);
      assert.equal(usc.total, 2, "both listings of the same bytes cite it");
      assert.deepEqual(
        usc.by_year,
        [[2016, 2]],
        "one date from its published row, one from its ECF header",
      );
      assert.equal(usc.undated, 0);
      assert.equal(usc.recent[0].first_page, 1);
      const kase = await rpc("documents_for_entity_v1", ["case", "123", 5]);
      assert.equal(kase.total, 2);
      const court = await rpc("documents_for_entity_v1", ["court", "cand", 5]);
      assert.equal(court.total, 1);
      const judge = await rpc("documents_for_entity_v1", [
        "judge",
        "2bd1f904b1639f16cc7e65e218c52997",
        5,
      ]);
      assert.equal(judge.total, 8);
      const mdl = await rpc("documents_for_entity_v1", ["mdl", "3166", 5]);
      assert.deepEqual(mdl.by_year, [[2025, 1]]);
      await assert.rejects(
        rpc("documents_for_entity_v1", ["law_unit", "usc:42:1983; drop", 5]),
        /Invalid id/,
      );
      const docId = (
        await one(
          "select id from documents.documents where native_document_id='njd-3:2016-md-02738-00001'",
        )
      ).id;
      const out = await rpc("documents_links_v1", ["record", `documents/${docId}`]);
      const rel = new Set(out.map((x) => `${x.relation}:${x.to.type}:${x.to.id}`));
      for (const want of [
        "cites:law_unit:usc:42:1983",
        "cites:law_unit:cfr:21:314",
        "cites:record:caselaw/123",
        "mentions:mdl:2738",
        "listed_in:mdl:2738",
        "filed_in:court:njd",
      ])
        assert.ok(rel.has(want), want);
      assert.ok(
        out.every((x) => x.from.type === "record" && x.evidence && x.sourceDataset === "documents"),
      );
      const into = await rpc("documents_links_v1", ["law_unit", "usc:42:1983"]);
      assert.equal(into.length, 2);
      const doc = await rpc("documents_document_v1", [docId]);
      assert.equal(doc.extractions.usc, 2);
      const uscLink = doc.links.find((l) => l.to_id === "usc:42:1983");
      assert.equal(
        uscLink.cited_as,
        "42 U.S.C. § 1983",
        "a link carries the citation as the filing writes it",
      );
      assert.deepEqual([doc.amounts[0].page, doc.amounts[0].value.amount], [2, 5000000]);
      const same = await rpc("documents_document_v1", [
        (
          await one(
            "select id from documents.documents where native_document_id='njd-3:2016-md-02738-00099'",
          )
        ).id,
      ]);
      assert.equal(
        same.amounts[0].value.amount,
        5000000,
        "the same bytes listed twice carry the same extractions",
      );
      assert.equal(same.date_basis, "ECF header printed on page 1");
    });

    await t.test(
      "a document whose listing disappears leaves the layer with its links and text",
      async () => {
        await db.query(
          "update public.corpus_records set detail = jsonb_set(detail, '{registry,pdf_case_ids}', '[\"6245245\"]') where id = 'sw-matter:2738'",
        );
        const r = await rpc("documents_refresh_v1", ["b3"]);
        assert.ok(r.removed >= 5);
        assert.equal(
          (
            await one(
              "select count(*)::int n from documents.links l join documents.documents d on d.id = l.document_id where d.sha256 = $1",
              [S.A],
            )
          ).n,
          0,
        );
        assert.equal(
          (await one("select count(*)::int n from documents.pages where sha256 = $1", [S.A])).n,
          0,
        );
        assert.equal(
          (await one("select count(*)::int n from documents.extractions where sha256 = $1", [S.A]))
            .n,
          0,
        );
        assert.equal(
          (await one("select count(*)::int n from documents.links")).n,
          (
            await one(
              "select count(*)::int n from documents.links l join documents.documents d on d.id = l.document_id",
            )
          ).n,
        );
      },
    );

    await t.test("grants and function posture", async () => {
      const fns = (
        await db.query(
          "select p.oid::regprocedure::text f, p.prosecdef, p.proconfig from pg_proc p join pg_namespace n on n.oid = p.pronamespace where (n.nspname = 'public' and p.proname like 'documents\\_%') or n.nspname = 'documents'",
        )
      ).rows;
      assert.ok(fns.length >= 20);
      for (const f of fns) {
        assert.deepEqual(f.proconfig, ['search_path=""'], f.f);
        for (const role of ["anon", "authenticated", "public"]) {
          if (role === "public") continue;
          assert.equal(
            (await one("select has_function_privilege($1, $2, 'execute') r", [role, f.f])).r,
            false,
            `${role} ${f.f}`,
          );
        }
        assert.equal(
          (await one("select has_function_privilege('service_role', $1, 'execute') r", [f.f])).r,
          true,
          f.f,
        );
        if (f.f.startsWith("documents_")) assert.equal(f.prosecdef, true, f.f);
      }
      for (const tbl of ["documents", "pages", "page_sets", "extractions", "links", "builds"])
        assert.equal(
          (await one("select has_table_privilege('anon', $1, 'select') r", [`documents.${tbl}`])).r,
          false,
        );
    });
  } finally {
    await db.close();
  }
});
