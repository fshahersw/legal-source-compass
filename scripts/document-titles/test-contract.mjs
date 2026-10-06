// Exercises database/contracts/document-titles-v1.sql on a throwaway in-memory PGlite database with synthetic rows:
// plan -> dry run -> apply -> idempotent re-apply -> verify -> md5 guard (edited row skipped) -> exact rollback.
// Needs `@electric-sql/pglite` (not a repo dependency): npm i --prefix /tmp/pgt @electric-sql/pglite; PGLITE_DIR=/tmp/pgt node test-contract.mjs
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
const dir = process.env.PGLITE_DIR ?? "/tmp/pgt";
const { PGlite } = await import(pathToFileURL(`${dir}/node_modules/@electric-sql/pglite/dist/index.js`).href);
const here = new URL("./", import.meta.url).pathname;
const db = new PGlite();
await db.exec(readFileSync(here + "fixtures/mock-schema.sql", "utf8"));
await db.exec(readFileSync(here + "../../database/contracts/document-titles-v1.sql", "utf8"));

const courtRow = (id, name, extra = {}) => ({
  dataset: "court_documents", id, title: `${name} (title not yet extracted)`, source_url: `https://example.gov/files/${name}`,
  item: { id, cells: { document: `${name} (title not yet extracted)`, doc_type: "Court form" }, title: `${name} (title not yet extracted)`, badges: ["No court match"] },
  detail: { id, title: `${name} (title not yet extracted)`, facts: [["Document type", "Court form"], ["Title extracted from first page text", "no"], ["Bytes", "10"]] },
  text: `${id} ${name} (title not yet extracted) Court form qualification`, ...extra,
});
const rows = [
  courtRow("cd-1", "a.pdf"), courtRow("cd-2", "b.pdf"), courtRow("cd-3", "c.pdf"), courtRow("cd-4", "d.pdf"),
  { dataset: "saved_pages", id: "sp-1", title: "(untitled)", source_url: "https://x.org/a", item: { id: "sp-1", title: "(untitled)", cells: {} }, detail: { title: "(untitled)", facts: [["Site", "x.org"]] }, text: "sp-1 (untitled) rest" },
  { dataset: "saved_pages", id: "sp-2", title: "Already has a title", source_url: "https://x.org/b", item: { title: "Already has a title" }, detail: { facts: [] }, text: "x" },
];
for (const r of rows) await db.query("insert into public.corpus_records(dataset,id,title,source_url,item,detail,text) values ($1,$2,$3,$4,$5,$6,$7)", [r.dataset, r.id, r.title, r.source_url, r.item, r.detail, r.text]);
await db.exec("insert into public.corpus_datasets values ('court_documents',4),('saved_pages',2)");
const snapshot = async () => (await db.query("select md5(string_agg(to_jsonb(r)::text,'|' order by dataset,id)) m from public.corpus_records r")).rows[0].m;
const call = async (op, args = {}) => (await db.query("select public.corpus_admin_title_projection_v1($1,$2::jsonb) r", [op, JSON.stringify(args)])).rows[0].r;
const sha = (c) => c.repeat(64);

const before = await snapshot();
await assert.rejects(call("plan", { rows: [] }), /No open document-titles run/);
const run = (await call("open_run")).run;
assert.equal((await call("open_run")).run, run, "open_run is idempotent");

const plan = await call("plan", { rows: [
  { dataset: "court_documents", id: "cd-1", old_title: "a.pdf (title not yet extracted)", new_title: "Motion for Admission Pro Hac Vice", method: "first_page_title_block", source_id: `corpus-originals:${sha("a")}`, source_text_sha256: sha("b"), file_name: "a.pdf" },
  { dataset: "court_documents", id: "cd-2", old_title: "b.pdf (title not yet extracted)", new_title: "b.pdf (title not recorded)", method: "not_recorded", reason: "multiple_title_blocks", source_id: `corpus-originals:${sha("c")}`, file_name: "b.pdf" },
  { dataset: "court_documents", id: "cd-3", old_title: "WRONG (title not yet extracted)", new_title: "X", method: "first_page_title_block", source_id: `corpus-originals:${sha("a")}`, source_text_sha256: sha("b") },
  { dataset: "court_documents", id: "cd-4", old_title: "d.pdf (title not yet extracted)", new_title: "Edited meanwhile", method: "first_page_title_block", source_id: `corpus-originals:${sha("d")}`, source_text_sha256: sha("e"), file_name: "d.pdf" },
  { dataset: "saved_pages", id: "sp-1", old_title: "(untitled)", new_title: "AMERICANS WITH DISABILITIES ACT", method: "first_h1_markdown", source_id: "saved_pages:sp-1", source_text_sha256: sha("f") },
  { dataset: "saved_pages", id: "sp-2", old_title: "Already has a title", new_title: "Nope", method: "first_h1_markdown", source_id: "saved_pages:sp-2", source_text_sha256: sha("f") },
  { dataset: "other", id: "z", old_title: "t", new_title: "n", method: "first_h1_markdown" },
] });
assert.equal(plan.planned, 4);
assert.deepEqual(plan.rejected.map((x) => x.why).sort(), ["dataset_not_in_scope", "title_changed_since_derivation", "title_is_not_a_placeholder"]);
assert.equal((await call("plan", { rows: [{ dataset: "court_documents", id: "cd-1", old_title: "a.pdf (title not yet extracted)", new_title: "Z", method: "first_page_title_block", source_id: `corpus-originals:${sha("a")}`, source_text_sha256: sha("b") }] })).planned, 0, "re-plan never overwrites a planned row");

await db.query("update public.corpus_records set detail = jsonb_set(detail,'{facts}', detail->'facts' || '[[\"Edited\",\"yes\"]]'::jsonb) where id = 'cd-4'");
const afterEdit = await snapshot();
const dry = await call("apply", { limit: 100, dry: true });
assert.equal(dry.would_apply, 3); assert.equal(dry.skipped, 1);
assert.equal(await snapshot(), afterEdit, "dry run writes nothing");
const applied = await call("apply", { limit: 100, dry: false });
assert.equal(applied.applied, 3); assert.equal(applied.skipped, 1); assert.equal(applied.remaining_planned, 0);
assert.equal((await call("apply", { limit: 100, dry: false })).applied, 0, "idempotent");

const get = async (id) => (await db.query("select * from public.corpus_records where id=$1", [id])).rows[0];
const cd1 = await get("cd-1");
assert.equal(cd1.title, "Motion for Admission Pro Hac Vice");
assert.equal(cd1.item.title, cd1.title); assert.equal(cd1.item.cells.document, cd1.title); assert.equal(cd1.detail.title, cd1.title);
assert.ok(cd1.item.badges.includes("Title extracted from first page"));
assert.ok(cd1.text.startsWith("cd-1 Motion for Admission Pro Hac Vice Court form"));
const f1 = Object.fromEntries(cd1.detail.facts);
assert.equal(f1["Title extracted from first page text"], "yes"); assert.equal(f1["File name (from the source address)"], "a.pdf");
assert.match(f1["Title basis"], new RegExp(`file SHA-256 ${sha("a")}; text SHA-256 ${sha("b")}`)); assert.equal(f1["Document date"].slice(0, 12), "Not recorded");
assert.equal(cd1.detail.facts.filter((f) => f[0] === "Title extracted from first page text").length, 1, "fact upserted, not duplicated");
const cd2 = await get("cd-2");
assert.equal(cd2.title, "b.pdf (title not recorded)");
assert.match(Object.fromEntries(cd2.detail.facts)["Title basis"], /^Not recorded: the first page has several equally prominent heading blocks/);
assert.equal(Object.fromEntries(cd2.detail.facts)["Title extracted from first page text"], "no");
assert.equal((await get("sp-1")).title, "AMERICANS WITH DISABILITIES ACT");
const cd4 = await get("cd-4");
assert.equal(cd4.title, "d.pdf (title not yet extracted)", "edited row left alone");
assert.equal((await db.query("select count(*)::int n from corpus_ingest.cleanup_decisions where issue='doc_titles_20261006_project_title'")).rows[0].n, 3);
const v = await call("verify");
assert.equal(v.applied_without_ledger, 0); assert.equal(v.applied_title_mismatch, 0); assert.equal(v.applied_row_changed_since_apply, 0); assert.equal(v.counter_mismatch, 0);
const st = await call("status");
assert.deepEqual(st.placeholders_remaining, { court_documents: 2 });

const dryRb = await call("rollback", { dry: true });
assert.equal(dryRb.restored, 3);
await db.query("update public.corpus_records set title = title || ' (hand edit)' where id = 'cd-2'");
const rb = await call("rollback", { dry: false });
assert.equal(rb.restored, 2); assert.equal(rb.held_changed_since_apply, 1);
await db.query("update public.corpus_records set title = 'b.pdf (title not recorded)' where id = 'cd-2'");
assert.equal((await call("rollback", { dry: false })).restored, 1);
await db.query("update public.corpus_records set detail = jsonb_set(detail,'{facts}', (select jsonb_agg(f) from jsonb_array_elements(detail->'facts') f where f->>0 <> 'Edited')) where id = 'cd-4'");
assert.equal(await snapshot(), before, "rollback restores every row exactly");
await call("close_run");
console.log("document-titles contract: all assertions passed");
