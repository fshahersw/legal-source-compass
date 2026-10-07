// Exercises database/contracts/document-titles-v2-ocr.sql on top of v1 on a throwaway in-memory PGlite database with synthetic rows:
// v1 run labels an image-only row "title not recorded"; v2 OCR run titles it, updates another unresolved row's basis, rejects ineligible rows,
// keeps the v1 ledger row, verifies, and rolls back to the exact post-v1 state.
// PGLITE_DIR=/tmp/pgt node test-contract-ocr.mjs
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
const dir = process.env.PGLITE_DIR ?? "/tmp/pgt";
const { PGlite } = await import(pathToFileURL(`${dir}/node_modules/@electric-sql/pglite/dist/index.js`).href);
const here = new URL("./", import.meta.url).pathname;
const db = new PGlite();
await db.exec(readFileSync(here + "fixtures/mock-schema.sql", "utf8"));
await db.exec(readFileSync(here + "../../database/contracts/document-titles-v1.sql", "utf8"));

const mk = (id, name) => ({
  dataset: "court_documents", id, title: `${name} (title not yet extracted)`, source_url: `https://example.gov/${name}`,
  item: { id, cells: { document: `${name} (title not yet extracted)` }, title: `${name} (title not yet extracted)`, badges: [] },
  detail: { id, title: `${name} (title not yet extracted)`, facts: [["Title extracted from first page text", "no"]] },
  text: `${id} ${name} (title not yet extracted) rest`,
});
for (const r of [mk("i-1", "scan1.pdf"), mk("i-2", "scan2.pdf"), mk("i-3", "scan3.pdf"), mk("i-4", "other.pdf")])
  await db.query("insert into public.corpus_records(dataset,id,title,source_url,item,detail,text) values ($1,$2,$3,$4,$5,$6,$7)", [r.dataset, r.id, r.title, r.source_url, r.item, r.detail, r.text]);
await db.exec("insert into public.corpus_datasets values ('court_documents',4)");
const sha = (c) => c.repeat(64);
const call = async (op, args = {}) => (await db.query("select public.corpus_admin_title_projection_v1($1,$2::jsonb) r", [op, JSON.stringify(args)])).rows[0].r;
const get = async (id) => (await db.query("select * from public.corpus_records where id=$1", [id])).rows[0];
const v1row = (id, name, reason) => ({ dataset: "court_documents", id, old_title: `${name} (title not yet extracted)`, new_title: `${name} (title not recorded)`, method: "not_recorded", reason, source_id: `corpus-originals:${sha("a")}`, file_name: name });

await call("open_run");
assert.equal((await call("plan", { rows: [v1row("i-1", "scan1.pdf", "no_text_layer"), v1row("i-2", "scan2.pdf", "no_text_layer"), v1row("i-3", "scan3.pdf", "no_text_layer"), v1row("i-4", "other.pdf", "multiple_title_blocks")] })).planned, 4);
assert.equal((await call("apply", { limit: 100, dry: false })).applied, 4);
await call("close_run");
await db.exec(readFileSync(here + "../../database/contracts/document-titles-v2-ocr.sql", "utf8"));
await db.exec(readFileSync(here + "../../database/contracts/document-titles-v2-ocr.sql", "utf8"));
const postV1 = (await db.query("select md5(string_agg(to_jsonb(r)::text,'|' order by id)) m from public.corpus_records r")).rows[0].m;

await call("open_run");
const ocr = (id, name, extra) => ({ dataset: "court_documents", id, old_title: `${name} (title not recorded)`, source_id: `corpus-originals:${sha("a")}`, file_name: name, ...extra });
const plan = await call("plan", { rows: [
  ocr("i-1", "scan1.pdf", { new_title: "ORDER — IN THE SUPREME COURT OF ALABAMA", method: "first_page_ocr_doctype_heading", source_text_sha256: sha("c") }),
  ocr("i-2", "scan2.pdf", { new_title: "scan2.pdf (title not recorded)", method: "not_recorded", reason: "ocr_multiple_title_blocks" }),
  ocr("i-4", "other.pdf", { new_title: "Not eligible Title", method: "first_page_ocr_title_block", source_text_sha256: sha("c") }),
  { ...ocr("i-3", "scan3.pdf", { new_title: "Plain method on a recorded row", method: "first_page_title_block", source_text_sha256: sha("c") }) },
] });
assert.equal(plan.planned, 2);
assert.deepEqual(plan.rejected.map((x) => x.why).sort(), ["not_an_ocr_eligible_row", "title_is_not_a_placeholder"]);
const dry = await call("apply", { limit: 100, dry: true });
assert.equal(dry.would_apply, 2);
assert.equal((await call("apply", { limit: 100, dry: false })).applied, 2);
const i1 = await get("i-1");
assert.equal(i1.title, "ORDER — IN THE SUPREME COURT OF ALABAMA");
assert.equal(i1.item.title, i1.title); assert.equal(i1.detail.title, i1.title); assert.ok(i1.text.startsWith("i-1 ORDER — IN THE SUPREME COURT OF ALABAMA rest"));
const f1 = Object.fromEntries(i1.detail.facts);
assert.match(f1["Title basis"], /^Read by OCR \(rapidocr-onnxruntime 1\.4\.4, 200 dpi, owner-authorised 2026-10-07\)/);
assert.match(f1["Title basis"], new RegExp(`OCR text SHA-256 ${sha("c")}`));
assert.equal(f1["Title extracted from first page text"], "yes (OCR of the page image)");
assert.ok(i1.item.badges.includes("Title extracted from first page"));
const i2 = await get("i-2");
assert.equal(i2.title, "scan2.pdf (title not recorded)");
assert.match(Object.fromEntries(i2.detail.facts)["Title basis"], /OCR of the first-page image \(the saved PDF has no text layer\) does not give an unambiguous title \(multiple_title_blocks\)/);
const ledger = (await db.query("select issue,count(*)::int n from corpus_ingest.cleanup_decisions group by 1 order by 1")).rows;
assert.deepEqual(ledger, [{ issue: "doc_titles_20261006_project_title", n: 4 }, { issue: "doc_titles_20261007_ocr_title", n: 2 }]);
const v = await call("verify");
assert.equal(v.applied_without_ledger, 0); assert.equal(v.applied_title_mismatch, 0); assert.equal(v.applied_row_changed_since_apply, 0);
assert.equal((await call("rollback", { dry: false })).restored, 2);
assert.equal((await db.query("select md5(string_agg(to_jsonb(r)::text,'|' order by id)) m from public.corpus_records r")).rows[0].m, postV1, "rollback restores the exact post-v1 state");
console.log("document-titles OCR contract: all assertions passed");
