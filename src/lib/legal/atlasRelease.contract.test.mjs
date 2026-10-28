// Isolated PostgreSQL contract test for database/contracts/legal-atlas-approve-api-v1.sql (+ rollback) and
// legal-atlas-rin-lineage-v1.sql, applied over legal-atlas-v3.generated.sql. A throwaway in-memory PGlite
// database with synthetic rows; no credentials, network or live corpus.
// Run: node --test src/lib/legal/atlasRelease.contract.test.mjs   (from the repository root; needs the private
// PGlite runtime, or PUBLISHER_CODE_PGLITE pointing at @electric-sql/pglite/dist/index.js)
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const runtime =
  process.env.PUBLISHER_CODE_PGLITE ??
  path.resolve("private/tools/publisher-code-contract-tests/node_modules/@electric-sql/pglite/dist/index.js");
const { PGlite } = await import(pathToFileURL(runtime).href);

const read = (name) => fs.readFile(path.resolve("database/contracts", name), "utf8");
const V = "a".repeat(64);
const RUN = "00000000-0000-4000-8000-000000000001";
const INPUT = "b".repeat(64);

function record(type, id, extra = {}) {
  const fr = ["fr_document", "rule_proceeding", "agency"].includes(type);
  return {
    id, type,
    id_authority: fr ? "federal_register" : "courtlistener",
    title: `${type} ${id}`, title_source: "api", jurisdiction: "US", court_id: null,
    date: "2024-01-02", date_type: type === "fr_document" ? "published" : "filed",
    source_url: extra.source_url ?? `https://example.gov/${type}/${id}`,
    source_name: fr ? "Federal Register" : "CourtListener",
    licence: "Public domain", retrieved_at: "2026-10-02T00:00:00Z", version: V, confidence: 1,
    extraction_method: "api", identifiers: {}, attributes: extra.attributes ?? {},
  };
}
const key = (p) => JSON.stringify([p.id_authority, p.type, p.id, p.version]);

async function setup() {
  const db = new PGlite();
  await db.exec("create role anon; create role authenticated; create role service_role;");
  await db.exec(await read("legal-atlas-v3.generated.sql"));
  await db.exec(await read("legal-atlas-approve-api-v1.sql"));
  await db.exec(await read("legal-atlas-rin-lineage-v1.sql"));
  await db.query("insert into legal_atlas.ingest_runs(run_id,schema_version,source_manifest) values($1,'legal-atlas/3.1','{}')", [RUN]);
  await db.query("insert into legal_atlas.staging(input_key,run_id,source_name,source_record,candidate_records,schema_errors) values($1,$2,'t','{}','[]','[]')", [INPUT, RUN]);

  const prorule = record("fr_document", "2023-00001", { source_url: "https://www.federalregister.gov/d/2023-00001",
    attributes: { fr_document_type: "PRORULE", paragraphs: { regulation_id_numbers: "[\"1234-AB12\"]" }, native: { citation: "88 FR 1" } } });
  const rule = record("fr_document", "2024-00002", { source_url: "https://www.federalregister.gov/d/2024-00002",
    attributes: { fr_document_type: "RULE", paragraphs: { regulation_id_numbers: "[\"1234-AB12\"]" }, native: { citation: "89 FR 2" } } });
  const notice = record("fr_document", "2024-00003", { source_url: "https://www.federalregister.gov/d/2024-00003",
    attributes: { fr_document_type: "NOTICE", paragraphs: { regulation_id_numbers: "[\"1234-AB12\"]" } } });
  const rp1 = { ...record("rule_proceeding", "1234-AB12"), version: "1".repeat(64),
    attributes: { native: { regulation_id_number_info: { "1234-AB12": { title: "Widget Safety Standard" } } } } };
  const rp2 = { ...record("rule_proceeding", "1234-AB12"), version: "2".repeat(64), date: "2024-01-03" };
  const rp3 = { ...record("rule_proceeding", "1234-AB12"), version: "3".repeat(64) };
  const attorney = record("attorney", "77", { attributes: { native: { email: "x@example.com", phone: "555" } } });
  const sealedEntry = record("docket_entry", "88", { attributes: { native: { recap_documents: [{ is_sealed: true }, { is_sealed: false }] } } });
  const openEntry = record("docket_entry", "89", { attributes: { native: { recap_documents: [{ is_sealed: false }] } } });
  const judge = record("judge", "99", { attributes: {} });
  judge.identifiers = { courtlistener_person_id: "99" };
  const all = [prorule, rule, notice, rp1, rp2, rp3, attorney, sealedEntry, openEntry, judge];
  for (const p of all) {
    const errs = (await db.query("select legal_atlas.record_errors($1::jsonb) e", [p])).rows[0].e;
    assert.deepEqual(errs, [], `${p.type} fixture invalid: ${errs}`);
    await db.query(
      "insert into legal_atlas.records(record_key,input_key,type,id,version,payload) values(legal_atlas.ref_key($1::jsonb),$2,($1::jsonb->>'type')::legal_atlas.entity_type,$1::jsonb->>'id',$1::jsonb->>'version',$1::jsonb)",
      [p, INPUT],
    );
  }
  const edge = async (k, type, from, to, extra = {}) =>
    db.query(
      `insert into legal_atlas.edges(edge_key,type,from_key,to_key,source_key,from_type,to_type,extraction_method,confidence,source_url,source_date,evidence)
       values($1,$2::legal_atlas.edge_type,$3::jsonb,$4::jsonb,$3::jsonb,($3::jsonb->>1)::legal_atlas.entity_type,($4::jsonb->>1)::legal_atlas.entity_type,'api',1,$5,$6,$7::jsonb)`,
      [k.repeat(64), type, key(from), key(to), extra.url ?? from.source_url, from.date, extra.evidence ?? { paragraph_id: "regulation_id_numbers" }],
    );
  await edge("1", "proposes", prorule, rp1);
  await edge("2", "finalizes", rule, rp2);
  await edge("3", "finalizes", notice, rp3); // NOTICE cannot finalize: structural check keeps it pending
  await edge("4", "proposes", prorule, rp2, { url: "https://www.federalregister.gov/d/other" }); // source_url mismatch
  await edge("5", "proposes", prorule, rp3, { evidence: { paragraph_id: "missing_paragraph" } }); // evidence absent
  return { db, attorney, sealedEntry, openEntry };
}

const types = ["fr_document", "rule_proceeding", "attorney", "docket_entry", "judge"];

test("release approves accurate rows, keeps explicit holds, and serves only structurally valid edges", async () => {
  const { db } = await setup();
  assert.equal((await db.query("select count(*)::int n from legal_atlas.visible_edges")).rows[0].n, 0);
  for (const t of types) {
    const r = (await db.query("select legal_atlas.release_pending_records_v1($1::legal_atlas.entity_type, 1) j", [t])).rows[0].j;
    assert.ok(r.released <= 1, "limit is respected");
    let guard = 0;
    while ((await db.query("select legal_atlas.release_pending_records_v1($1::legal_atlas.entity_type, 1) j", [t])).rows[0].j.released > 0) {
      assert.ok(++guard < 10);
    }
  }
  const holds = (await db.query("select type::text, reason, records::int from legal_atlas.release_holds_v1 order by 1")).rows;
  assert.deepEqual(holds, [
    { type: "attorney", reason: "owner_policy_counsel_contact_fields", records: 1 },
    { type: "docket_entry", reason: "provider_sealed_document", records: 1 },
  ]);
  const e1 = (await db.query("select legal_atlas.release_pending_edges_v1(1) j")).rows[0].j;
  assert.equal(e1.released, 1);
  const e2 = (await db.query("select legal_atlas.release_pending_edges_v1(100) j")).rows[0].j;
  assert.equal(e2.released, 1);
  assert.equal(e2.still_pending, 3);
  const again = (await db.query("select legal_atlas.release_pending_edges_v1(100) j")).rows[0].j;
  assert.equal(again.released, 0, "re-running is a no-op");
  const visible = (await db.query("select type::text from legal_atlas.visible_edges order by type")).rows.map((r) => r.type);
  assert.deepEqual(visible, ["finalizes", "proposes"]);
  const approvedEdges = (await db.query("select count(*)::int n from legal_atlas.edges where review_status='approved'")).rows[0].n;
  assert.equal(approvedEdges, visible.length, "every approved edge is served by visible_edges");
  const ledger = (await db.query("select kind, count(*)::int n from legal_atlas.release_ledger_v1 group by 1 order by 1")).rows;
  assert.deepEqual(ledger, [{ kind: "edge", n: 2 }, { kind: "record", n: 8 }]);

  const lineage = (await db.query("select public.corpus_legal_rin_v1(' 1234-ab12 ') j")).rows[0].j;
  assert.equal(lineage.rin, "1234-AB12");
  assert.equal(lineage.total, 2);
  assert.deepEqual(lineage.documents.map((d) => [d.relation, d.document_number, d.fr_document_type]), [
    ["Proposed Rule document", "2023-00001", "PRORULE"],
    ["Rule document", "2024-00002", "RULE"],
  ]);
  assert.equal(lineage.documents[0].citation, "88 FR 1");
  assert.equal(lineage.counts.prorule_documents, 1);
  assert.equal(lineage.counts.rule_documents, 1);
  assert.equal(lineage.counts.proposes, undefined, "never asserts that a document proposed or finalized the rule");
  assert.deepEqual(lineage.documents.map((d) => d.edge_type), ["proposes", "finalizes"]);
  assert.equal((await db.query("select public.corpus_legal_rin_v1('not a rin') j")).rows[0].j, null);
  assert.equal((await db.query("select public.corpus_legal_rin_v1('9999-ZZ99') j")).rows[0].j.total, 0);
  await db.close();
});

test("rollback returns exactly the ledgered rows to pending and leaves earlier approvals", async () => {
  const { db } = await setup();
  await db.exec("update legal_atlas.records set review_status='approved' where id='99'"); // approved before the release
  for (const t of types) await db.query("select legal_atlas.release_pending_records_v1($1::legal_atlas.entity_type, 100)", [t]);
  await db.query("select legal_atlas.release_pending_edges_v1(100)");
  await db.exec(await read("legal-atlas-approve-api-v1.rollback.sql"));
  const rows = (await db.query("select id, review_status::text s from legal_atlas.records where review_status='approved'")).rows;
  assert.deepEqual(rows, [{ id: "99", s: "approved" }]);
  assert.equal((await db.query("select count(*)::int n from legal_atlas.edges where review_status='approved'")).rows[0].n, 0);
  const left = (await db.query("select count(*)::int n from pg_proc where proname like 'release_pending_%_v1' or proname like 'release_rollback_%_v1'")).rows[0].n;
  assert.equal(left, 0);
  await db.close();
});

test("functions reject unbounded calls and stay service-role only", async () => {
  const { db } = await setup();
  await assert.rejects(db.query("select legal_atlas.release_pending_records_v1('fr_document', 0)"), /Bounded limit/);
  await assert.rejects(db.query("select legal_atlas.release_pending_edges_v1(1000000)"), /Bounded limit/);
  await assert.rejects(db.query("select legal_atlas.release_rollback_records_v1('fr_document', 0)"), /Bounded limit/);
  const definer = (await db.query("select prosecdef from pg_proc where proname = 'corpus_legal_rin_v1'")).rows[0].prosecdef;
  assert.equal(definer, true, "corpus_legal_rin_v1 is SECURITY DEFINER per AGENTS.md");
  const grants = (await db.query(`select p.proname, has_function_privilege('anon', p.oid, 'execute') anon,
      has_function_privilege('service_role', p.oid, 'execute') svc
    from pg_proc p where p.proname in ('release_pending_records_v1','release_pending_edges_v1','release_rollback_records_v1','release_rollback_edges_v1','corpus_legal_rin_v1') order by 1`)).rows;
  for (const g of grants) {
    assert.equal(g.anon, false, `${g.proname} anon`);
    assert.equal(g.svc, true, `${g.proname} service_role`);
  }
  await db.close();
});
