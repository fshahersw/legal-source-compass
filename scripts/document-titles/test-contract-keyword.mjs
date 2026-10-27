// Exercises database/contracts/document-titles-v3-keyword-release.sql installed over v1 (the production state) on a throwaway in-memory
// PGlite database with synthetic rows: a v1 run withholds titles with reason policy_withheld; v3's keyword-release run titles them, corrects
// the basis of a row that stays unresolved, rejects every row it must not touch, verifies, rolls back a closed run to the exact post-v1
// state, and the rollback file restores the v1 functions. PGLITE_DIR=/tmp/pgt node test-contract-keyword.mjs
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { pathToFileURL, fileURLToPath } from "node:url";
const dir = process.env.PGLITE_DIR ?? "/tmp/pgt";
const { PGlite } = await import(pathToFileURL(`${dir}/node_modules/@electric-sql/pglite/dist/index.js`).href);
const here = fileURLToPath(new URL("./", import.meta.url));
const sql = (f) => readFileSync(here + "../../database/contracts/" + f, "utf8");
const db = new PGlite();
await db.exec(readFileSync(here + "fixtures/mock-schema.sql", "utf8"));
await db.exec(sql("document-titles-v1.sql"));

const mk = (id, name) => ({
  dataset: "court_documents", id, title: `${name} (title not yet extracted)`, source_url: `https://www.example.uscourts.gov/${name}`,
  item: { id, cells: { document: `${name} (title not yet extracted)` }, title: `${name} (title not yet extracted)`, badges: [] },
  detail: { id, title: `${name} (title not yet extracted)`, facts: [["Title extracted from first page text", "no"]] },
  text: `${id} ${name} (title not yet extracted) rest`,
});
const names = { "k-1": "seal-checklist.pdf", "k-2": "cc1640inst.pdf", "k-3": "go22.pdf", "o-1": "other.pdf", "p-1": "plain.pdf" };
for (const [id, name] of Object.entries(names)) {
  const r = mk(id, name);
  await db.query("insert into public.corpus_records(dataset,id,title,source_url,item,detail,text) values ($1,$2,$3,$4,$5,$6,$7)", [r.dataset, r.id, r.title, r.source_url, r.item, r.detail, r.text]);
}
await db.exec("insert into public.corpus_datasets values ('court_documents',5)");
const sha = (c) => c.repeat(64);
const call = async (op, args = {}) => (await db.query("select public.corpus_admin_title_projection_v1($1,$2::jsonb) r", [op, JSON.stringify(args)])).rows[0].r;
const get = async (id) => (await db.query("select * from public.corpus_records where id=$1", [id])).rows[0];
const snap = async () => (await db.query("select md5(string_agg(to_jsonb(r)::text,'|' order by id)) m from public.corpus_records r")).rows[0].m;
const v1row = (id, reason) => ({ dataset: "court_documents", id, old_title: `${names[id]} (title not yet extracted)`, new_title: `${names[id]} (title not recorded)`, method: "not_recorded", reason, source_id: `corpus-originals:${sha("a")}`, file_name: names[id] });

// v1 (production): three titles withheld for keywords, one unresolved for another reason; p-1 stays a placeholder.
await call("open_run");
assert.equal((await call("plan", { rows: [v1row("k-1", "policy_withheld"), v1row("k-2", "policy_withheld"), v1row("k-3", "policy_withheld"), v1row("o-1", "multiple_title_blocks")] })).planned, 4);
assert.equal((await call("apply", { limit: 100, dry: false })).applied, 4);
await call("close_run");
const stale = (await call("open_run")).run; // like production run 9508f609: opened, never used
await db.exec(sql("document-titles-v3-keyword-release.sql"));
await db.exec(sql("document-titles-v3-keyword-release.sql")); // idempotent install
const postV1 = await snap();

await assert.rejects(call("open_run", { stage: "keyword_release" }), /different stage; close it first/);
await assert.rejects(call("open_run", { stage: "anything" }), /Unknown stage/);
assert.equal((await call("close_run")).closed, stale);
const run = (await call("open_run", { stage: "keyword_release" })).run;
assert.equal((await call("open_run", { stage: "keyword_release" })).run, run, "open_run is idempotent");
await assert.rejects(call("open_run"), /different stage/);

const kw = (id, extra) => ({ dataset: "court_documents", id, old_title: `${names[id]} (title not recorded)`, source_id: `corpus-originals:${sha("a")}`, file_name: names[id], ...extra });
const plan = await call("plan", { rows: [
  kw("k-1", { new_title: "SEALING CHECKLIST", method: "first_page_title_block", source_text_sha256: sha("c") }),
  kw("k-2", { new_title: "cc1640inst.pdf (title not recorded)", method: "not_recorded", reason: "heading_is_instructions_label" }),
  kw("k-3", { new_title: "go22.pdf (title not recorded)", method: "not_recorded", reason: "policy_withheld" }),
  kw("o-1", { new_title: "Not withheld for keywords", method: "first_page_title_block", source_text_sha256: sha("c") }),
  { ...kw("p-1", { new_title: "Placeholder row", method: "first_page_title_block", source_text_sha256: sha("c") }), old_title: "plain.pdf (title not yet extracted)" },
] });
assert.equal(plan.planned, 2);
assert.equal(plan.stage, "keyword_release");
assert.deepEqual(plan.rejected.map((x) => `${x.id}:${x.why}`).sort(), ["k-3:not_recorded_must_keep_label_and_give_real_reason", "o-1:not_a_keyword_release_row", "p-1:not_a_keyword_release_row"]);
const k3h1 = await call("plan", { rows: [kw("k-3", { new_title: "GENERAL ORDER NO. 22", method: "first_h1_markdown", source_text_sha256: sha("c") })] });
assert.equal(k3h1.rejected[0].why, "method_not_in_keyword_release");

assert.equal((await call("apply", { limit: 100, dry: true })).would_apply, 2);
assert.equal(await snap(), postV1, "dry run writes nothing");
assert.equal((await call("apply", { limit: 100, dry: false })).applied, 2);
const k1 = await get("k-1");
assert.equal(k1.title, "SEALING CHECKLIST");
assert.equal(k1.item.title, k1.title); assert.equal(k1.detail.title, k1.title); assert.ok(k1.text.startsWith("k-1 SEALING CHECKLIST rest"));
assert.ok(k1.item.badges.includes("Title extracted from first page"));
const f1 = Object.fromEntries(k1.detail.facts);
assert.match(f1["Title basis"], /^Typeset title block on the first page of the saved PDF/);
assert.match(f1["Title basis"], /read 2026-10-27\. Released 2026-10-27:/);
assert.equal(f1["Title extracted from first page text"], "yes");
assert.equal(f1["File name (from the source address)"], "seal-checklist.pdf");
const k2 = await get("k-2");
assert.equal(k2.title, "cc1640inst.pdf (title not recorded)");
assert.match(Object.fromEntries(k2.detail.facts)["Title basis"], /^Not recorded: the most prominent first-page heading is the form's instructions label, not the document's title\. Checked 2026-10-27/);
assert.equal((await get("k-3")).title, "go22.pdf (title not recorded)");
const ledger = (await db.query("select issue,count(*)::int n from corpus_ingest.cleanup_decisions group by 1 order by 1")).rows;
assert.deepEqual(ledger, [{ issue: "doc_titles_20261006_project_title", n: 4 }, { issue: "doc_titles_20261027_keyword_release", n: 2 }]);
const ev = (await db.query("select evidence from corpus_ingest.cleanup_decisions where issue='doc_titles_20261027_keyword_release' and record_id='k-1'")).rows[0].evidence;
assert.equal(ev.contract, "document-titles/2026-10-27.1"); assert.equal(ev.stage, "keyword_release");
const st = await call("status");
assert.equal(st.stage, "keyword_release"); assert.equal(st.policy_withheld_still_labelled, 2);
const v = await call("verify");
assert.equal(v.applied_without_ledger, 0); assert.equal(v.applied_title_mismatch, 0); assert.equal(v.applied_row_changed_since_apply, 0); assert.equal(v.counter_mismatch, 0);

await call("close_run");
await assert.rejects(db.exec(sql("document-titles-v3-keyword-release.rollback.sql")), /still applied/);
assert.deepEqual(await call("rollback", { dry: true, run }), { dry: true, restored: 2, held_changed_since_apply: 0 });
assert.equal((await call("rollback", { dry: false, run })).restored, 2);
assert.equal(await snap(), postV1, "rollback restores the exact post-v1 state");
await db.exec(sql("document-titles-v3-keyword-release.rollback.sql"));
const fns = (await db.query("select string_agg(proname, ',' order by proname) f from pg_proc where proname like 'title_projection%'")).rows[0].f;
assert.ok(!fns.includes("keyword_eligible") && !fns.includes("issue_v2"), fns);
const runAfter = (await call("open_run")).run; // v1 function restored: plain open_run works again
assert.ok(runAfter);
console.log("document-titles keyword-release contract: all assertions passed");
