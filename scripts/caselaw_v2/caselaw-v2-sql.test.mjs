// Offline contract test for database/contracts/caselaw-v2.sql on top of caselaw-read-v1.sql. No credentials, network or
// live corpus: a throwaway in-memory PGlite database, synthetic courts/cases/objects, the contract's own RPCs.
// Run: node --test scripts/caselaw_v2/caselaw-v2-sql.test.mjs   (from the repository root)
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";

const runtime =
  process.env.PUBLISHER_CODE_PGLITE ??
  path.resolve("private/tools/publisher-code-contract-tests/node_modules/@electric-sql/pglite/dist/index.js");
const { PGlite } = await import(pathToFileURL(runtime).href);
const V1 = await fs.readFile(path.resolve("database/contracts/caselaw-read-v1.sql"), "utf8");
const V2 = await fs.readFile(path.resolve("database/contracts/caselaw-v2.sql"), "utf8");
const sha = (t) => createHash("sha256").update(t, "utf8").digest("hex");
const KEY = (t, s) => `caselaw/read/2026-09-30/t${t}/v2/u05/t${t}-u05-000${s}-${"a".repeat(12)}.jsonl.gz`;

async function rpc(db, fn, args = {}) {
  const names = Object.keys(args);
  const sql = `select public.${fn}(${names.map((n, i) => `${n} => $${i + 1}`).join(", ")}) as r`;
  const vals = names.map((n) => {
    const v = args[n];
    return v !== null && typeof v === "object" && !Array.isArray(v) ? JSON.stringify(v) : v;
  });
  return (await db.query(sql, vals)).rows[0].r;
}

async function setup() {
  const db = new PGlite();
  await db.exec("create role anon; create role authenticated; create role service_role;");
  await db.exec(V1);
  // stage-2 rows of tiers 1-3 through the v1 loader (before v2 is applied, as in production)
  await rpc(db, "caselaw_load_courts_v1", {
    p_rows: JSON.stringify([
      { court_id: "scotus", tier: 1, full_name: "Supreme Court of the United States", short_name: "Supreme Court", cases: 1 },
      { court_id: "tex", tier: 3, full_name: "Texas Supreme Court", short_name: "Tex.", cases: 1 },
    ]),
  });
  await rpc(db, "caselaw_load_cases_v1", {
    p_build: "full-1",
    p_rows: JSON.stringify([
      { cluster_id: 1, tier: 1, court_id: "scotus", date_filed: "1973-01-22", case_name: "Roe v. Wade", citations: ["410 U.S. 113", "93 S. Ct. 705"], cited_by: 900 },
      { cluster_id: 2, tier: 3, court_id: "tex", date_filed: "2004-05-01", case_name: "Smith v. Jones", citations: ["140 S.W.3d 1"], cited_by: 5 },
    ]),
  });
  await db.exec(V2);
  return db;
}

async function loadV2(db) {
  await rpc(db, "caselaw_load_courts_v2", {
    p_rows: JSON.stringify([
      { court_id: "texapp", tier: 4, full_name: "Court of Appeals of Texas", short_name: "Tex. App.", level: "SA", system: "state", jurisdiction: "TX", in_use: true },
      { court_id: "nysd", tier: 5, full_name: "District Court, S.D. New York", short_name: "S.D.N.Y.", level: "FD", system: "federal", jurisdiction: "NY", in_use: true },
      { court_id: "tax", tier: 6, full_name: "United States Tax Court", short_name: "Tax Ct.", level: "FS", system: "federal", jurisdiction: null },
      // an existing court: metadata updated, tier kept
      { court_id: "tex", tier: 7, full_name: "Texas Supreme Court", short_name: "Tex.", level: "S", system: "state", jurisdiction: "TX" },
    ]),
  });
  const ids = await rpc(db, "caselaw_load_objects_v1", {
    p_rows: JSON.stringify([
      { key: KEY(4, 0), kind: "read", bytes: 1000, sha256: "b".repeat(64) },
      { key: KEY(5, 0), kind: "read", bytes: 1000, sha256: "c".repeat(64) },
    ]),
  });
  const cases = [
    { cluster_id: 101, tier: 4, court_id: "texapp", date_filed: "2016-03-01", case_name: "Brown v. Green", case_name_full: "Robert Brown v. Gail Green",
      docket_number: "01-15-00001-CV", precedential_status: "Published", citation_count: 3, citations: ["480 S.W.3d 10"], judges: "Keyes",
      cited_by: 4, cited_by_cases: 3, cap_file: null, source: "C" },
    { cluster_id: 102, tier: 4, court_id: "texapp", date_filed: "2016-07-01", case_name: "In re Estate of White", citations: ["480 S.W.3d 10"],
      cited_by: 0, cited_by_cases: 0 },
    { cluster_id: 103, tier: 5, court_id: "nysd", date_filed: "1984-04-13", case_name: "Morgan v. Schipa", citations: ["585 F. Supp. 245"],
      cited_by: 8, cited_by_cases: 7, cap_file: "law.free.cap.f-supp.585/245.7857950.json", source: "LU" },
    { cluster_id: 104, tier: 6, court_id: "tax", date_filed: "2001-01-01", case_name: "Taxpayer v. Commissioner", citations: ["2021-Ohio-1234", "17 T.C. 5"],
      cited_by: 1, cited_by_cases: 1 },
    { cluster_id: 105, tier: 5, court_id: "nysd", date_filed: "2019-02-02", case_name: "Appx Case", citations: ["800 F. App'x 12"], cited_by: 0, cited_by_cases: 0 },
  ];
  assert.equal(await rpc(db, "caselaw_load_cases_v2", { p_build: "v2-1", p_rows: JSON.stringify(cases) }), 5);
  return { ids, cases };
}

test("tiers 4-7, v1 behaviour kept, idempotent install", async () => {
  const db = await setup();
  await db.exec(V2); // applying twice changes nothing
  await loadV2(db);
  const t = await db.query("select tier, count(*)::int n from caselaw.cases group by 1 order by 1");
  assert.deepEqual(t.rows, [{ tier: 1, n: 1 }, { tier: 3, n: 1 }, { tier: 4, n: 2 }, { tier: 5, n: 2 }, { tier: 6, n: 1 }]);
  await assert.rejects(db.query("update caselaw.cases set tier = 8 where cluster_id = 101"), /cases_tier_v2/);
  // v1 search still serves tiers 1-3 only; v1 courts too
  const v1 = await rpc(db, "caselaw_search_v1", { p_q: null, p_sort: "cited" });
  assert.deepEqual(v1.rows.map((r) => r.cluster_id), [1, 2]);
  const v1c = await rpc(db, "caselaw_courts_v1");
  assert.ok(v1c.every((c) => c.tier <= 3));
  // an existing court keeps its tier, gains metadata
  const tex = await db.query("select tier, level, jurisdiction from caselaw.courts where court_id = 'tex'");
  assert.deepEqual(tex.rows[0], { tier: 3, level: "S", jurisdiction: "TX" });
  // v2 loader refuses tiers 1-3 and rows without cited_by
  await assert.rejects(rpc(db, "caselaw_load_cases_v2", { p_build: "v2-1", p_rows: JSON.stringify([{ cluster_id: 9, tier: 3, court_id: "tex", case_name: "x", cited_by: 0, cited_by_cases: 0 }]) }), /tiers 4-7/);
  await assert.rejects(rpc(db, "caselaw_load_cases_v2", { p_build: "v2-1", p_rows: JSON.stringify([{ cluster_id: 9, tier: 4, court_id: "texapp", case_name: "x" }]) }), /cited_by/);
  // reloading identical rows changes nothing
  const again = await db.query("select count(*)::int n from caselaw.cases where build = 'v2-1'");
  assert.equal(again.rows[0].n, 5);
});

test("attach opinions: merge by id, type order, idempotent, registered objects only", async () => {
  const db = await setup();
  await loadV2(db);
  const row = (id, type, s) => ({ id, type, author: "Keyes", per_curiam: false, key: KEY(4, 0), s, n: 100 });
  let r = await rpc(db, "caselaw_attach_opinions_v2", { p_build: "v2-1", p_rows: JSON.stringify([{ cluster_id: 101, opinions: [row(1002, "040dissent", 100)] }]) });
  assert.equal(r.cases_changed, 1);
  r = await rpc(db, "caselaw_attach_opinions_v2", { p_build: "v2-1", p_rows: JSON.stringify([{ cluster_id: 101, opinions: [row(1001, "020lead", 0)] }]) });
  assert.equal(r.cases_changed, 1);
  r = await rpc(db, "caselaw_attach_opinions_v2", { p_build: "v2-1", p_rows: JSON.stringify([{ cluster_id: 101, opinions: [row(1001, "020lead", 0)] }]) });
  assert.deepEqual([r.cases_changed, r.unchanged], [0, 1]);
  const c = await rpc(db, "caselaw_case_v2", { p_cluster_id: 101 });
  assert.deepEqual(c.opinions.map((o) => [o.id, o.type, o.key]), [[1001, "020lead", KEY(4, 0)], [1002, "040dissent", KEY(4, 0)]]);
  assert.equal(c.jurisdiction, "TX");
  assert.equal(c.court_level, "SA");
  assert.equal(c.tier, 4);
  // unknown object key
  await assert.rejects(rpc(db, "caselaw_attach_opinions_v2", { p_build: "v2-1", p_rows: JSON.stringify([{ cluster_id: 101, opinions: [{ ...row(1003, "030concurrence", 200), key: KEY(7, 9) }] }]) }), /not registered/);
  // a tier 1-3 case or a missing case is never touched
  r = await rpc(db, "caselaw_attach_opinions_v2", { p_build: "v2-1", p_rows: JSON.stringify([{ cluster_id: 2, opinions: [row(5, "010combined", 0)] }, { cluster_id: 999, opinions: [row(6, "010combined", 0)] }]) });
  assert.equal(r.missing_case, 2);
  // counts per court
  await rpc(db, "caselaw_refresh_court_counts_v2");
  const k = await db.query("select cases, cases_with_text from caselaw.courts where court_id = 'texapp'");
  assert.deepEqual(k.rows[0], { cases: 2, cases_with_text: 1 });
  const status = await rpc(db, "caselaw_status_v2");
  assert.equal(status.tiers["4"].with_text, 1);
});

test("search v2: tiers, jurisdiction, system, citation mode with alias", async () => {
  const db = await setup();
  await loadV2(db);
  let s = await rpc(db, "caselaw_search_v2", { p_q: "brown", p_tiers: [4, 5] });
  assert.deepEqual(s.rows.map((r) => r.cluster_id), [101]);
  assert.equal(s.rows[0].jurisdiction, "TX");
  s = await rpc(db, "caselaw_search_v2", { p_jurisdiction: "NY", p_sort: "cited" });
  assert.deepEqual(s.rows.map((r) => r.cluster_id), [103, 105]);
  s = await rpc(db, "caselaw_search_v2", { p_system: "state", p_sort: "oldest" });
  assert.deepEqual(s.rows.map((r) => r.cluster_id), [2, 101, 102]);
  s = await rpc(db, "caselaw_search_v2", { p_q: "585 F. Supp. 245" });
  assert.equal(s.mode, "citation");
  assert.deepEqual(s.rows.map((r) => r.cluster_id), [103]);
  s = await rpc(db, "caselaw_search_v2", { p_q: "800 Fed. Appx. 12" }); // alias: Fed. Appx. -> F. App'x
  assert.deepEqual(s.rows.map((r) => r.cluster_id), [105]);
  await assert.rejects(rpc(db, "caselaw_search_v2", { p_tiers: [8] }), /Invalid tier/);
  await assert.rejects(rpc(db, "caselaw_search_v2", { p_jurisdiction: "Texas" }), /Invalid jurisdiction/);
});

test("resolve: resolved, ambiguous, unresolved, pins, parallels, neutral, aliases, filters", async () => {
  const db = await setup();
  await loadV2(db);
  const res = (c, extra = {}) => rpc(db, "caselaw_resolve_v2", { p_citation: c, ...extra });
  let r = await res("410 U.S. 113");
  assert.equal(r.status, "resolved");
  assert.equal(r.cluster_id, 1);
  r = await res("Roe v. Wade, 410 U.S. 113, 120 (1973)".replace("Roe v. Wade, ", ""));
  assert.equal(r.status, "resolved");
  assert.equal(r.parsed.pin, "120");
  assert.equal(r.parsed.year, 1973);
  r = await res("410 U. S. 113, 93 S. Ct. 705, 35 L. Ed. 2d 147");
  assert.equal(r.status, "resolved");
  assert.equal(r.parsed.parallel_ignored, 2);
  r = await res("480 S.W.3d 10");
  assert.equal(r.status, "ambiguous");
  assert.deepEqual(r.candidates.map((c) => c.cluster_id).sort(), [101, 102]);
  assert.equal(r.cluster_id, null);
  r = await res("480 S.W.3d 10", { p_year: 2016, p_court: "texapp" });
  assert.equal(r.status, "ambiguous"); // both are 2016 Texas App. cases: never chosen
  r = await res("480 S.W.3d 10 (Tex. App. 2016)", {});
  assert.equal(r.parsed.court, "Tex. App.");
  r = await res("140 S.W.3rd 1");
  assert.equal(r.status, "resolved");
  assert.equal(r.cluster_id, 2);
  r = await res("800 Fed. Appx. 12");
  assert.deepEqual([r.status, r.matched_via, r.cluster_id], ["resolved", "reporter_alias", 105]);
  r = await res("2021-Ohio-1234");
  assert.deepEqual([r.status, r.cluster_id], ["resolved", 104]);
  r = await res("999 F.3d 1");
  assert.deepEqual([r.status, r.reason], ["unresolved", "not_held"]);
  r = await res("Id. at 5");
  assert.deepEqual([r.status, r.reason], ["unresolved", "not_a_citation"]);
  r = await res("410 U.S. 113", { p_year: 1980 });
  assert.deepEqual([r.status, r.reason], ["unresolved", "filtered_out"]);
  const many = await rpc(db, "caselaw_resolve_many_v2", { p_citations: ["410 U.S. 113", "999 F.3d 1"] });
  assert.deepEqual(many.map((x) => x.status), ["resolved", "unresolved"]);
});

test("text index by tier: prefix and full scopes, full-text search across tiers", async () => {
  const db = await setup();
  await loadV2(db);
  const op = (id, type, s) => ({ id, type, per_curiam: false, key: KEY(4, 0), s, n: 100 });
  await rpc(db, "caselaw_attach_opinions_v2", { p_build: "v2-1", p_rows: JSON.stringify([
    { cluster_id: 101, opinions: [op(1001, "020lead", 0)] },
    { cluster_id: 103, opinions: [{ ...op(3001, "010combined", 0), key: KEY(5, 0) }] }]) });
  const long = Array.from({ length: 3000 }, (_, i) => (i === 2500 ? "zygomorphic" : `word${i % 50}`)).join(" ");
  const t1 = "The *12 appellant argued negligence per se under the statute.";
  let r = await rpc(db, "caselaw_load_text_v2", { p_build: "v2-1", p_scope: "prefix", p_prefix_words: 1000, p_rows: JSON.stringify([
    { opinion_id: 1001, cluster_id: 101, text: t1, text_sha256: sha(t1), blank: [[4, 3]] },
    { opinion_id: 3001, cluster_id: 103, text: long, text_sha256: sha(long) }]) });
  assert.deepEqual([r.rows, r.missing], [2, 0]);
  let f = await rpc(db, "caselaw_fulltext_v2", { p_q: "negligence" });
  assert.deepEqual(f.rows.map((x) => x.cluster_id), [101]);
  f = await rpc(db, "caselaw_fulltext_v2", { p_q: "zygomorphic" }); // word 2,501: outside a 1,000-word prefix
  assert.equal(f.rows.length, 0);
  r = await rpc(db, "caselaw_load_text_v2", { p_build: "v2-1", p_scope: "full", p_rows: JSON.stringify([
    { opinion_id: 3001, cluster_id: 103, text: long, text_sha256: sha(long) }]) });
  assert.equal(r.rows, 1);
  f = await rpc(db, "caselaw_fulltext_v2", { p_q: "zygomorphic", p_tiers: [5], p_jurisdiction: "NY" });
  assert.deepEqual(f.rows.map((x) => x.cluster_id), [103]);
  f = await rpc(db, "caselaw_fulltext_v2", { p_q: "zygomorphic", p_tiers: [4] });
  assert.equal(f.rows.length, 0);
  // the star-page marker "*12" was blanked before indexing: its number is not a word of the opinion
  f = await rpc(db, "caselaw_fulltext_v2", { p_q: "12" });
  assert.equal(f.rows.length, 0);
  f = await rpc(db, "caselaw_fulltext_v2", { p_q: '"appellant argued"' });
  assert.deepEqual(f.rows.map((x) => x.cluster_id), [101]);
  // reloading the same text is a no-op; a wrong hash is refused
  r = await rpc(db, "caselaw_load_text_v2", { p_build: "v2-1", p_scope: "full", p_rows: JSON.stringify([
    { opinion_id: 3001, cluster_id: 103, text: long, text_sha256: sha(long) }]) });
  assert.equal(r.unchanged, 1);
  await assert.rejects(rpc(db, "caselaw_load_text_v2", { p_build: "v2-1", p_scope: "full", p_rows: JSON.stringify([
    { opinion_id: 3001, cluster_id: 103, text: long, text_sha256: sha("other") }]) }), /does not match/);
  const parts = await db.query("select count(*)::int n from caselaw.text_v2 where opinion_id = 3001");
  assert.equal(parts.rows[0].n, 1); // 3,000 words: one 8,000-word part
});

test("court pages and grants", async () => {
  const db = await setup();
  await loadV2(db);
  const y = await rpc(db, "caselaw_court_years_v2", { p_court: "texapp" });
  assert.deepEqual(y.years, [[2016, 2, 0]]);
  const c = await rpc(db, "caselaw_court_cases_v2", { p_court: "texapp", p_year: 2016, p_sort: "oldest", p_limit: 1 });
  assert.deepEqual([c.rows.map((r) => r.cluster_id), c.has_more], [[101], true]);
  await assert.rejects(rpc(db, "caselaw_court_cases_v2", { p_court: "Tex App" }), /Invalid court/);
  const g = await db.query(`select p.proname, has_function_privilege('anon', p.oid, 'execute') anon,
      has_function_privilege('authenticated', p.oid, 'execute') auth, has_function_privilege('service_role', p.oid, 'execute') svc,
      p.prosecdef, p.proconfig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname like 'caselaw\\_%\\_v2'`);
  assert.ok(g.rows.length >= 14);
  for (const r of g.rows) {
    assert.equal(r.anon, false, r.proname);
    assert.equal(r.auth, false, r.proname);
    assert.equal(r.svc, true, r.proname);
    assert.equal(r.prosecdef, true, r.proname);
    assert.deepEqual(r.proconfig, ['search_path=""'], r.proname);
  }
});

test("statement shape for the lead's SQL tool", () => {
  assert.ok(!/;\s*(truncate|delete|drop)\b/i.test(V2), "no ';' directly followed by truncate/delete/drop");
  assert.ok(!/^\s*drop\s/im.test(V2), "no bare DROP statements");
});
