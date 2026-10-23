// Offline contract tests for database/contracts/state-law-inforce-v1.sql (state-law-inforce/1). Isolated PostgreSQL
// (pglite): no credentials, network or live corpus access. Synthetic editions; the normalisation and citation-pattern
// vectors come from scripts/state_law/norm_vectors.json, which the Python library (canonical) also checks.
import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const runtime =
  process.env.PUBLISHER_CODE_PGLITE ??
  path.resolve(
    "private/tools/publisher-code-contract-tests/node_modules/@electric-sql/pglite/dist/index.js",
  );
const { PGlite } = await import(pathToFileURL(runtime).href);
const SQL_FILE = "database/contracts/state-law-inforce-v1.sql";
const VECTORS = JSON.parse(await fs.readFile("scripts/state_law/norm_vectors.json", "utf8"));

const sha = (text) => crypto.createHash("sha256").update(text, "utf8").digest("hex");
const SRC = "a".repeat(64);

function edition(state, id, codes, counts, extra = {}) {
  return {
    schema: "state-law-edition/1",
    edition_id: id,
    state,
    code_name: `${state} code`,
    publisher: `${state} Legislature`,
    publisher_url: `https://law.${state.toLowerCase()}.example.gov/`,
    official_source: true,
    access: "html",
    edition_label: "The 2026 Test Statutes",
    currency_statement: "Current through the 2026 Regular Session.",
    currency_source_url: `https://law.${state.toLowerCase()}.example.gov/`,
    currency_through: null,
    source_last_modified: null,
    retrieved_from: "2026-10-24T00:00:00Z",
    retrieved_to: "2026-10-24T01:00:00Z",
    codes,
    counts,
    files: {},
    parser: `${state.toLowerCase()}-test/1`,
    lib: "state-law-lib/1",
    sample: null,
    terms_note: "",
    update_cadence: "annual",
    ...extra,
  };
}

function node(state, edId, code, nodeId, parentId, level, number, heading, ordinal) {
  return {
    schema: "state-law-node/1",
    node_id: nodeId,
    edition_id: edId,
    state,
    code,
    parent_id: parentId,
    level,
    label: level === "code" ? heading : level[0].toUpperCase() + level.slice(1),
    number,
    heading,
    ordinal,
    source_url: null,
  };
}

function normNumber(n) {
  return VECTORS.norm_number.find((v) => v.input === n)?.expected ?? n.toLowerCase().replace(/\s+/g, "");
}

function section(state, edId, code, number, text, nodeId, ordinal, opts = {}) {
  const sid = `${state}:${code}:${number.replace(/\s+/g, "")}${opts.version ? `@${opts.version}` : ""}`;
  return {
    schema: "state-law-section/1",
    section_id: sid,
    edition_id: edId,
    state,
    code,
    number,
    number_norm: normNumber(number),
    version: opts.versionLabel ?? null,
    citation: opts.citation ?? `${code} § ${number}`,
    heading: opts.heading ?? null,
    text,
    history: opts.history ?? null,
    status: opts.status ?? "in_force",
    status_basis: opts.basis ?? (opts.status && opts.status !== "in_force" ? "publisher_marker" : "current_compilation"),
    status_marker: opts.marker ?? null,
    effective: { start: opts.start ?? null, end: null, note: null },
    node_id: nodeId,
    path: [],
    ordinal,
    source: {
      url: `https://law.${state.toLowerCase()}.example.gov/${number}`,
      retrieved_at: "2026-10-24T00:30:00Z",
      sha256: SRC,
      bytes: 100,
      method: "publisher_page",
      member: null,
    },
    text_sha256: sha(text),
    parser: `${state.toLowerCase()}-test/1`,
  };
}

const FS_CODES = [
  {
    code: "FS",
    name: "Florida Statutes",
    citation_template: "Fla. Stat. § {n}",
    patterns: VECTORS.patterns.find((p) => p.state === "FL").patterns.map((p) => ({ regex: p.regex, number: p.number })),
  },
];
const CA_PATTERNS = VECTORS.patterns.find((p) => p.state === "CA").patterns;
const CA_CODES = ["CIV", "PEN"].map((code) => ({
  code,
  name: code,
  citation_template: code === "CIV" ? "Cal. Civ. Code § {n}" : "Cal. Penal Code § {n}",
  patterns: CA_PATTERNS.filter((p) => p.code === code).map((p) => ({ regex: p.regex, number: p.number })),
}));

function floridaEdition(id, extraText = "") {
  const ed = "FL:FS";
  const t8 = "FL:FS/title:VIII";
  const c95 = "FL:FS/title:VIII/chapter:95";
  const nodes = [
    node("FL", id, "FS", ed, null, "code", null, "Florida Statutes", 0),
    node("FL", id, "FS", t8, ed, "title", "VIII", "LIMITATIONS", 1),
    node("FL", id, "FS", c95, t8, "chapter", "95", "LIMITATIONS OF ACTIONS; ADVERSE POSSESSION", 2),
  ];
  const sections = [
    section("FL", id, "FS", "95.03", "Any provision in a contract fixing the period of time is void.", c95, 0, {
      heading: "Contracts shortening time.",
      citation: "Fla. Stat. § 95.03",
    }),
    section("FL", id, "FS", "95.05", "", c95, 1, {
      heading: "Repealed by s. 1, ch. 74-382.",
      status: "repealed",
      marker: "Repealed by s. 1, ch. 74-382.",
      citation: "Fla. Stat. § 95.05",
    }),
    section(
      "FL",
      id,
      "FS",
      "95.11",
      `Actions other than for recovery of real property shall be commenced as follows:\n(1) WITHIN TWENTY YEARS.—An action on a judgment.${extraText}`,
      c95,
      2,
      { heading: "Limitations other than for the recovery of real property.", citation: "Fla. Stat. § 95.11" },
    ),
    section("FL", id, "FS", "95.111", "Old limitations text for publication service.", c95, 3, {
      version: 1,
      versionLabel: "(Text effective until July 1, 2027)",
      citation: "Fla. Stat. § 95.111",
    }),
    section("FL", id, "FS", "95.111", "New limitations text for publication service.", c95, 4, {
      version: 2,
      versionLabel: "(Text effective July 1, 2027)",
      status: "future_effective",
      marker: "effective July 1, 2027",
      start: "2027-07-01",
      citation: "Fla. Stat. § 95.111",
    }),
  ];
  return { edition: edition("FL", id, FS_CODES, { sections: sections.length, nodes: nodes.length, by_status: {} }), nodes, sections };
}

function californiaEdition(id) {
  const nodes = [
    node("CA", id, "CIV", "CA:CIV", null, "code", null, "Civil Code", 0),
    node("CA", id, "PEN", "CA:PEN", null, "code", null, "Penal Code", 1),
  ];
  const sections = [
    section("CA", id, "CIV", "187", "A civil code section numbered 187 for testing.", "CA:CIV", 0, {
      citation: "Cal. Civ. Code § 187",
    }),
    section("CA", id, "PEN", "187", "Murder is the unlawful killing of a human being with malice aforethought.", "CA:PEN", 1, {
      citation: "Cal. Penal Code § 187",
    }),
  ];
  return { edition: edition("CA", id, CA_CODES, { sections: 2, nodes: 2, by_status: {} }), nodes, sections };
}

async function setup() {
  const db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create schema corpus_ingest;
    create table corpus_ingest.publisher_code_objects_v2 (sha256 text primary key, bytes bigint, kind text, object_key text);
    create table corpus_ingest.publisher_code_object_sources_v2 (sha256 text, source_url text, retrieved_at timestamptz,
      http_status integer, retrieval_method text, jurisdiction text);`);
  const sql = await fs.readFile(SQL_FILE, "utf8");
  await db.exec(sql);
  await db.exec(sql); // idempotent re-apply
  return db;
}

test("state-law-inforce/1 contract", { timeout: 300000 }, async () => {
  const db = await setup();
  const one = async (q, args = []) => (await db.query(q, args)).rows[0];
  const rpc = async (name, args = []) =>
    (await one(`select public.${name}(${args.map((_, i) => `$${i + 1}`).join(",")}) as r`, args)).r;
  const fails = async (q, args, pattern) => {
    await assert.rejects(() => db.query(q, args), pattern);
  };

  // --- normaliser parity with the Python library ---------------------------------------------------
  for (const v of VECTORS.norm_number)
    assert.equal((await one("select state_law.norm_number_v1($1) as r", [v.input])).r, v.expected, `norm_number ${v.input}`);
  for (const v of VECTORS.norm_cite)
    assert.deepEqual((await one("select state_law.norm_cite_v1($1) as r", [v.input])).r, v.expected, `norm_cite ${v.input}`);
  for (const v of VECTORS.patterns) {
    const norm = (await one("select (state_law.norm_cite_v1($1))[1] as r", [v.input])).r;
    const got = [];
    for (const p of v.patterns) {
      const hit = (
        await one(
          `select case when $1 ~ ('^(?:' || $2 || ')$')
             then state_law.norm_number_v1(regexp_replace($1, '^(?:' || $2 || ')$', $3)) end as r`,
          [norm, p.regex, p.number],
        )
      ).r;
      if (hit !== null && !got.some(([c, n]) => c === p.code && n === hit)) got.push([p.code, hit]);
    }
    assert.deepEqual(got, v.expected, `patterns ${v.state} ${v.input}`);
  }

  // --- loader gates ----------------------------------------------------------------------------------
  const fl = floridaEdition("fl-20261024");
  await fails("select public.state_law_begin_edition_v1($1)", [{ ...fl.edition, sample: { limit: 40 } }], /full run/);
  assert.equal((await rpc("state_law_begin_edition_v1", [fl.edition])).replayed, false);
  assert.equal((await rpc("state_law_begin_edition_v1", [fl.edition])).replayed, true);
  await fails(
    "select public.state_law_begin_edition_v1($1)",
    [{ ...fl.edition, currency_statement: "different" }],
    /different manifest/,
  );
  await rpc("state_law_load_nodes_v1", ["fl-20261024", fl.nodes]);
  const tampered = { ...fl.sections[0], text: "Tampered text." };
  await fails("select public.state_law_load_sections_v1($1, $2)", ["fl-20261024", [tampered]], /invalid state-law-section/);
  const badNorm = { ...fl.sections[0], number_norm: "95-03" };
  await fails("select public.state_law_load_sections_v1($1, $2)", ["fl-20261024", [badNorm]], /invalid state-law-section/);
  await fails("select public.state_law_activate_edition_v1($1)", ["fl-20261024"], /counts differ/);
  assert.equal((await rpc("state_law_load_sections_v1", ["fl-20261024", fl.sections])).inserted, 5);
  assert.equal((await rpc("state_law_load_sections_v1", ["fl-20261024", fl.sections])).inserted, 0);
  const act = await rpc("state_law_activate_edition_v1", ["fl-20261024", "first load"]);
  assert.equal(act.sections, 5);
  assert.equal(act.superseded, null);

  // --- reads -----------------------------------------------------------------------------------------
  const states = await rpc("state_law_states_v1");
  assert.equal(states.length, 1);
  assert.equal(states[0].currency_statement, "Current through the 2026 Regular Session.");
  const root = await rpc("state_law_tree_v1", ["FL", null, 500, 0]);
  assert.deepEqual(root.children.map((c) => [c.node_id, c.sections]), [["FL:FS", 5]]);
  const ch = await rpc("state_law_tree_v1", ["FL", "FL:FS/title:VIII/chapter:95", 2, 0]);
  assert.equal(ch.total_sections, 5);
  assert.equal(ch.sections.length, 2);
  assert.equal(ch.truncated, true);
  assert.deepEqual(ch.breadcrumb.map((b) => b.node_id), ["FL:FS", "FL:FS/title:VIII"]);
  assert.equal((await rpc("state_law_tree_v1", ["FL", "FL:FS/title:IX", 10, 0])).reason, "unknown_node");
  assert.equal((await rpc("state_law_tree_v1", ["TX", null, 10, 0])).reason, "no_edition");

  const sec = await rpc("state_law_section_v1", ["FL", "FL:FS:95.11"]);
  assert.equal(sec.section.citation, "Fla. Stat. § 95.11");
  assert.equal(sec.prev.section_id, "FL:FS:95.05");
  assert.equal(sec.next.section_id, "FL:FS:95.111@1");
  assert.equal(sec.breadcrumb.length, 3);
  const v1 = await rpc("state_law_section_v1", ["FL", "FL:FS:95.111@1"]);
  assert.deepEqual(v1.other_versions.map((v) => v.section_id), ["FL:FS:95.111@2"]);
  assert.equal((await rpc("state_law_section_v1", ["FL", "FL:FS:1.01"])).reason, "unknown_section");

  // --- resolver (shared with CITE) -------------------------------------------------------------------
  const r1 = await rpc("state_law_resolve_v1", ["FL", "Fla. Stat. § 95.11(3)(a)"]);
  assert.equal(r1.result, "resolved");
  assert.equal(r1.section_id, "FL:FS:95.11");
  assert.equal(r1.pinpoint, "(3)(a)");
  assert.equal((await rpc("state_law_resolve_v1", ["FL", "F.S. 95.11"])).section_id, "FL:FS:95.11");
  assert.equal((await rpc("state_law_resolve_v1", ["FL", "95.11"])).section_id, "FL:FS:95.11");
  const unresolved = await rpc("state_law_resolve_v1", ["FL", "Fla. Stat. § 95.12"]);
  assert.equal(unresolved.result, "unresolved", "a missing section is never mapped to a neighbour");
  assert.deepEqual(unresolved.candidates, []);
  const versions = await rpc("state_law_resolve_v1", ["FL", "Fla. Stat. § 95.111"]);
  assert.equal(versions.result, "resolved");
  assert.equal(versions.section_id, "FL:FS:95.111@1");
  assert.deepEqual(versions.candidates.map((c) => c.section_id), ["FL:FS:95.111@2"]);
  assert.equal((await rpc("state_law_resolve_v1", ["FL", "Fla. Stat. § 95.05"])).status, "repealed");
  assert.equal((await rpc("state_law_resolve_v1", ["ZZZ", "x"])).result, "unknown_state");
  assert.equal((await rpc("state_law_resolve_v1", ["TX", "Tex. Civ. Prac. & Rem. Code § 16.003"])).result, "no_edition");

  const ca = californiaEdition("ca-20261024");
  await rpc("state_law_begin_edition_v1", [ca.edition]);
  await rpc("state_law_load_nodes_v1", ["ca-20261024", ca.nodes]);
  await rpc("state_law_load_sections_v1", ["ca-20261024", ca.sections]);
  await rpc("state_law_activate_edition_v1", ["ca-20261024"]);
  const bare = await rpc("state_law_resolve_v1", ["CA", "187"]);
  assert.equal(bare.result, "ambiguous");
  assert.deepEqual(bare.candidates.map((c) => c.section_id).sort(), ["CA:CIV:187", "CA:PEN:187"]);
  const pen = await rpc("state_law_resolve_v1", ["CA", "Pen. Code, § 187, subd. (a)"]);
  assert.equal(pen.result, "resolved");
  assert.equal(pen.section_id, "CA:PEN:187");
  assert.equal(pen.pinpoint, "(a)");
  assert.equal((await rpc("state_law_resolve_v1", ["FL", "Cal. Penal Code § 187"])).result, "unresolved");

  // --- search ------------------------------------------------------------------------------------------
  const s1 = await rpc("state_law_search_v1", ["FL", "contract period void", 10, 0, null]);
  assert.equal(s1.total, 1);
  assert.equal(s1.hits[0].section_id, "FL:FS:95.03");
  assert.match(s1.hits[0].snippet, /⟦/);
  const s2 = await rpc("state_law_search_v1", ["FL", "limitations", 10, 0, "future_effective"]);
  assert.deepEqual(s2.hits.map((h) => h.section_id), ["FL:FS:95.111@2"]);
  const s3 = await rpc("state_law_search_v1", ["FL", "Fla. Stat. § 95.11", 10, 0, null]);
  assert.equal(s3.exact.section_id, "FL:FS:95.11");
  assert.equal((await rpc("state_law_search_v1", ["FL", "a", 10, 0, null])).total, 0);
  await fails("select public.state_law_search_v1('FL', 'x y', 5, 0, 'bogus')", [], /unknown status/);

  // --- supersede and purge -----------------------------------------------------------------------------
  const fl2 = floridaEdition("fl-20261101", " Amended.");
  await rpc("state_law_begin_edition_v1", [fl2.edition]);
  await rpc("state_law_load_nodes_v1", ["fl-20261101", fl2.nodes]);
  await rpc("state_law_load_sections_v1", ["fl-20261101", fl2.sections]);
  const act2 = await rpc("state_law_activate_edition_v1", ["fl-20261101"]);
  assert.equal(act2.superseded, "fl-20261024");
  assert.match((await rpc("state_law_section_v1", ["FL", "FL:FS:95.11"])).section.text, /Amended\.$/);
  await fails("select public.state_law_purge_edition_v1('fl-20261101', 2)", [], /active edition/);
  let purge;
  let rounds = 0;
  do {
    purge = await rpc("state_law_purge_edition_v1", ["fl-20261024", 2]);
    rounds += 1;
  } while (!purge.done && rounds < 20);
  assert.equal(purge.done, true);
  assert.ok(rounds >= 3, "purge is bounded per call");
  assert.equal((await one("select count(*)::int as n from state_law.sections where edition_id = 'fl-20261024'")).n, 0);
  assert.equal((await one("select count(*)::int as n from state_law.editions where edition_id = 'fl-20261024'")).n, 0);
  assert.equal((await rpc("state_law_withdraw_edition_v1", ["ca-20261024", "test withdrawal"])).was, "active");
  assert.equal((await rpc("state_law_resolve_v1", ["CA", "Cal. Penal Code § 187"])).result, "no_edition");

  // --- retained-original manifest ----------------------------------------------------------------------
  await db.exec(`insert into corpus_ingest.publisher_code_objects_v2 values
      ('${"b".repeat(64)}', 10, 'publisher_original', 'state-codes/sha256/bb/${"b".repeat(64)}'),
      ('${"c".repeat(64)}', 5, 'unit_text_derivative', 'state-codes/sha256/cc/${"c".repeat(64)}');
    insert into corpus_ingest.publisher_code_object_sources_v2 values
      ('${"b".repeat(64)}', 'https://www.azleg.gov/ars/12/00542.htm', '2026-10-07T17:56:32Z', 200, 'publisher_page', 'AZ'),
      ('${"c".repeat(64)}', 'https://www.azleg.gov/ars/12/00542.htm', '2026-10-07T17:56:32Z', 200, 'publisher_page', 'AZ');`);
  const kept = await rpc("state_law_retained_sources_v1", ["AZ", null, 10]);
  assert.equal(kept.count, 1, "only publisher originals");
  assert.equal(kept.rows[0].sha256, "b".repeat(64));
  assert.equal((await rpc("state_law_retained_sources_v1", ["AZ", "https://www.azleg.gov/ars/12/00542.htm", 10])).count, 0);

  // --- grants ------------------------------------------------------------------------------------------
  await db.exec("set role anon");
  await fails("select public.state_law_states_v1()", [], /permission denied/);
  await fails("select count(*) from state_law.sections", [], /permission denied/);
  await db.exec("reset role");
  await db.exec("set role service_role");
  assert.ok(Array.isArray(await rpc("state_law_states_v1")));
  await db.exec("reset role");
});
