// Isolated PostgreSQL contract tests for database/contracts/lawviz-v1.sql. No credentials, network or live corpus:
// a throwaway in-memory PGlite database with the corpus tables the contract reads, filled with synthetic rows.
// Run: node --test src/lib/lawviz/contract.test.mjs   (from the repository root)
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
const CONTRACT = await fs.readFile(path.resolve("database/contracts/lawviz-v1.sql"), "utf8");
const SCHEDULE = await fs.readFile(
  path.resolve("database/contracts/lawviz-v1-schedule.sql"),
  "utf8",
);

const MOCK = `
create role anon; create role authenticated; create role service_role;
create table public.corpus_datasets (id text primary key, label text, ready boolean, metadata jsonb);
create table public.corpus_records (dataset text not null, id text not null, title text, source_url text,
  ordinal bigint, item jsonb, detail jsonb, text text, filters jsonb, primary key (dataset, id));`;

const today = new Date().toISOString().slice(0, 10);
const nextYear = `${Number(today.slice(0, 4)) + 1}-01-02`;

async function seed(db) {
  let ord = 0;
  const rec = (
    dataset,
    id,
    { title = null, item = null, detail = null, filters = null, text = null, url = null } = {},
  ) =>
    db.query(
      "insert into public.corpus_records(dataset,id,title,source_url,ordinal,item,detail,text,filters) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)",
      [dataset, id, title, url, ++ord, item, detail, text, filters],
    );
  // ---------------------------------------------------------------- U.S. Code
  await rec("us_code_titles", "1", {
    title: "Title 1. General Provisions",
    detail: {
      usc_title: {
        label: "Title 1",
        name: "General Provisions",
        outline: [
          [0, null, 0, "title", "Title 1—", "GENERAL PROVISIONS", null, 3, 0],
          [1, 0, 1, "chapter", "CHAPTER 1—", "RULES OF CONSTRUCTION", null, 2, 2],
          [2, 0, 1, "chapter", "CHAPTER 2—", "ACTS AND RESOLUTIONS", null, 1, 1],
        ],
      },
    },
  });
  await rec("us_code_titles", "26", {
    title: "Title 26. Internal Revenue Code",
    detail: {
      usc_title: {
        label: "Title 26",
        name: "Internal Revenue Code",
        outline: [
          [0, null, 0, "title", "Title 26—", "INTERNAL REVENUE CODE", null, 650, 0],
          [1, 0, 1, "subtitle", "Subtitle A—", "Income Taxes", null, 650, 0],
          [2, 1, 2, "chapter", "CHAPTER 1—", "NORMAL TAXES AND SURTAXES", null, 650, 0],
        ],
      },
    },
  });
  await rec("us_code_titles", "50a", {
    title: "Title 50 Appendix. War and National Defense",
    detail: {
      usc_title: { label: "Title 50 Appendix", name: "War and National Defense", outline: [] },
    },
  });
  const usc = (id, container, text, extra = {}) =>
    rec("us_code_sections", id, {
      title: `x ${id}`,
      text,
      item: {
        cells: {
          citation: `${id.split(":")[0]} U.S.C. § ${id.split(":")[1]}`,
          heading: `Heading ${id}`,
        },
      },
      filters: { kind: ["section"], status: ["none"], container, ...extra },
    });
  await usc("1:1", ["1:0", "1:1"], "a".repeat(100));
  await usc("1:2", ["1:0", "1:1"], "b".repeat(50));
  await usc("1:3", ["1:0", "1:2"], "c".repeat(10), { status: ["repealed"] });
  await usc("1:4", [], "dd"); // no container: the title's "not in a chapter" group
  // 650 sections in one chapter nested under a subtitle (binned in the atlas)
  for (let i = 1; i <= 650; i++) await usc(`26:${i}`, ["26:0", "26:1", "26:2"], "x".repeat(i % 7));
  const law = (id, enacted) =>
    rec("public_laws_enacted", id, {
      title: `Law ${id}`,
      detail: { law: { label: `Pub. L. ${id}`, enacted, congress: 1, kind: "Public law" } },
    });
  await law("pl-1-1", "1950-01-01");
  await law("pl-1-2", "2001-06-30");
  await law("pl-1-3", "0001-01-01"); // impossible date: not recorded
  await law("pl-1-4", "2020-05-05");
  await law("pl-1-5", nextYear); // after the refresh day: not recorded
  const link = (sec, lawId, kinds) =>
    rec("us_code_amendment_links", `${sec}|${lawId}|${kinds.join("+")}`, {
      detail: { link: { section: sec, law: lawId, kinds } },
      filters: { section: [sec], law: [lawId] },
    });
  await link("1:1", "pl-1-1", ["source_credit"]);
  await link("1:1", "pl-1-2", ["amendment_note"]);
  await link("1:1", "pl-1-4", ["law_text"]); // not a Code-change kind: ignored
  await link("1:2", "pl-1-3", ["source_credit"]); // impossible date only: not recorded
  await link("1:3", "pl-1-4", ["status_note"]);
  await link("1:4", "pl-1-5", ["source_credit"]); // future only: not recorded
  // ---------------------------------------------------------------- CFR
  const path21 = [
    ["title", "21", "Title 21—Food and Drugs"],
    ["chapter", "I", "Chapter I—Food and Drug Administration"],
  ];
  await rec("ecfr_sections_full", "cfr:21:101.1", {
    title: "21 CFR 101.1 Principal display panel.",
    item: {
      cells: {
        kind: "section",
        part: "101",
        identifier: "101.1",
        characters: 1000,
        reserved: false,
        title_number: "21",
      },
    },
    filters: { title: ["21"], part: ["101"], chapter: ["I"], kind: ["section"] },
  });
  await rec("ecfr_sections_full", "cfr:21:101.2", {
    title: "21 CFR 101.2 Information panel.",
    item: {
      cells: {
        kind: "section",
        part: "101",
        identifier: "101.2",
        characters: 3000,
        reserved: false,
        title_number: "21",
      },
    },
    filters: { title: ["21"], part: ["101"], chapter: ["I"], kind: ["section"] },
  });
  await rec("ecfr_sections_full", "cfr:21:101.3", {
    title: "21 CFR 101.3 [Reserved]",
    item: {
      cells: {
        kind: "section",
        part: "101",
        identifier: "101.3",
        characters: 0,
        reserved: true,
        title_number: "21",
      },
    },
    filters: { title: ["21"], part: ["101"], chapter: ["I"], kind: ["section"] },
  });
  await rec("ecfr_sections_full", "cfr:21:7.1", {
    title: "21 CFR 7.1 Scope.",
    item: {
      cells: { kind: "section", part: "7", identifier: "7.1", characters: 500, title_number: "21" },
    },
    filters: { title: ["21"], part: ["7"], chapter: ["I"], kind: ["section"] },
  });
  await rec("ecfr_sections_full", "cfr:21:part-101", {
    title: "21 CFR Part 101—Food Labeling",
    item: {
      cells: {
        kind: "part",
        part: "101",
        identifier: "101",
        title_number: "21",
        sections: 3,
        as_of: "2026-10-21",
      },
    },
    detail: { path: path21 },
    filters: { title: ["21"], part: ["101"], chapter: ["I"], kind: ["part"] },
  });
  await rec("ecfr_sections_full", "cfr:21:part-2", {
    title: "21 CFR Part 2 [Reserved]",
    item: {
      cells: { kind: "part", part: "2", identifier: "2", title_number: "21", reserved: true },
    },
    detail: { path: path21 },
    filters: { title: ["21"], part: ["2"], chapter: ["I"], kind: ["part"] },
  });
  const ver = (id, part, latest, versions) =>
    rec("ecfr_section_versions", id, {
      title: `21 CFR ${id.split(":")[2]} title`,
      item: { cells: { identifier: id.split(":")[2], latest_date: latest, removed: false } },
      detail: { versions },
      filters: { title: ["21"], part: [part] },
    });
  const v = (date, substantive, fr = []) => ({ date, amendment_date: date, substantive, fr });
  await ver("cfr:21:101.1", "101", "2023-03-24", [
    v("2016-12-19", true, [
      { citation: "81 FR 91716", url: "https://www.federalregister.gov/d/2016-29997" },
    ]),
    v("2023-03-24", true, [
      { citation: "88 FR 17710", url: "https://www.federalregister.gov/d/2023-05418" },
    ]),
    v("2023-03-24", false),
  ]);
  await ver("cfr:21:101.2", "101", "2019-01-01", [v("2019-01-01", true)]);
  await ver("cfr:21:101.9", "101", "2024-01-01", [v("2018-02-02", true), v("2024-01-01", true)]); // removed section
  // ---------------------------------------------------------------- Federal Register
  const fr = (id, published, type, cfrPair, agency) =>
    rec("federal_register_history", id, {
      title: `FR document ${id}`,
      url: `https://www.federalregister.gov/d/${id}`,
      item: { cells: { published, type, citation: `88 FR ${id}` } },
      filters: { cfr_pair: cfrPair, agency },
    });
  await fr("1001", "2023-03-24", "Rule", ["21:101"], ["199"]);
  await fr("1002", "2022-07-01", "Proposed Rule", ["21:101", "21:7"], ["199", "221"]);
  await fr("1003", "2022-07-01", "Notice", ["40:52"], ["145"]);
  await fr("1004", "Not recorded", "Notice", ["21:101"], ["199"]);
  await fr("1005", "2022-07-05", "Notice", [], ["466"]);
  // ---------------------------------------------------------------- bills
  const bill = (id, congress, type, policy, milestone, lawNum) =>
    rec("congress_bills", id, {
      item: { cells: { policy_area: policy } },
      filters: {
        congress: [String(congress)],
        type: [type],
        policy_area: policy ? [policy] : [],
        milestone,
        law: lawNum ? [lawNum] : [],
      },
    });
  await bill("117-hr-1", 117, "hr", "Health", ["introduced"]);
  await bill("117-hr-2", 117, "hr", "Health", ["introduced", "reported", "passed_house"]);
  await bill(
    "117-hr-3",
    117,
    "hr",
    "Health",
    ["introduced", "reported", "passed_house", "passed_senate", "to_president", "became_law"],
    "117-9",
  );
  await bill(
    "117-s-4",
    117,
    "s",
    "",
    ["introduced", "passed_senate", "passed_house", "became_law"],
    "117-10",
  );
  await bill("117-s-5", 117, "s", "Taxation", ["passed_senate"]); // introduction not recorded
  await bill("107-hr-6", 107, "hr", "Health", ["introduced"]); // outside 108–119
  await rec("public_laws_enacted", "stat-135-1", {
    detail: { law: { congress: 117, kind: "Public law", enacted: "2021-03-11" } },
  });
  await rec("public_laws_enacted", "stat-135-2", {
    detail: { law: { congress: 117, kind: "Public law", enacted: "2021-03-12" } },
  });
  // ---------------------------------------------------------------- calendar sources
  await rec("agency_safety_cpsc_recalls_api", "c1", { item: { cells: { date: "2022-07-01" } } });
  await rec("agency_safety_cpsc_recalls_api", "c2", { item: { cells: { date: "2022-07-01" } } });
  await rec("agency_safety_cpsc_recalls_api", "c3", { item: { cells: { date: "2022-07-09" } } });
  await rec("agency_safety_openfda_drug_enforcement", "d1", {
    filters: { report_date: "2022-07-06" },
  });
  await rec("agency_safety_openfda_food_enforcement", "f1", {
    filters: { report_date: "2022-07-06" },
  });
  await rec("sec_enforcement_actions", "s1", { item: { cells: { date: "2021-12-31" } } });
  await rec("ftc_hsr_early_terminations", "h1", {
    item: { cells: { date: "2022-01-03" } },
    filters: { kind: ["notice"] },
  });
  await rec("ftc_hsr_early_terminations", "h2", {
    item: { cells: { date: "2022-01-03" } },
    filters: { kind: ["fiscal_year"] },
  });
  await rec("doj_press_releases_2022", "doj-pr:a", { item: { cells: { date: "2022-03-01" } } });
  await rec("doj_press_releases_2022", "doj-pr:b", { item: { cells: { date: "Not recorded" } } });
  await rec("doj_press_releases", "doj-index:component:x", {
    item: { cells: { date: "2022-03-01" } },
  });
  await db.query(
    "insert into public.corpus_datasets(id, ready) values ('doj_press_releases_2022', true), ('doj_press_releases', true)",
  );
}

async function fresh() {
  const db = new PGlite();
  await db.exec(MOCK);
  await seed(db);
  await db.exec(CONTRACT);
  return db;
}
const one = async (db, sql, params = []) => (await db.query(sql, params)).rows[0];

test("contract text avoids the statement forms the lead's SQL tool cannot run", () => {
  assert.doesNotMatch(CONTRACT, /;\s*(delete|drop|truncate)\b/i);
  assert.doesNotMatch(CONTRACT, /^\s*drop\s/im);
  assert.doesNotMatch(SCHEDULE, /;\s*(delete|drop|truncate)\b/i);
  for (const m of CONTRACT.matchAll(/create or replace function (public\.lawviz_[a-z0-9_]+)\(/g)) {
    const body = CONTRACT.slice(
      m.index,
      CONTRACT.indexOf("$$", CONTRACT.indexOf("$$", m.index) + 2),
    );
    assert.match(
      body,
      /security definer set search_path = ''/,
      `${m[1]} must be security definer with empty search_path`,
    );
  }
});

test("applies twice (idempotent) and grants only service_role", async () => {
  const db = await fresh();
  await db.exec(CONTRACT);
  for (const fn of [
    "public.lawviz_atlas_v1(text,text,bigint,bigint)",
    "public.lawviz_part_lineage_v1(text,text,text[])",
    "public.lawviz_bill_flow_v1()",
    "public.lawviz_calendar_v1(text,integer)",
    "public.lawviz_refresh_v1(text,text)",
    "public.lawviz_status_v1()",
  ]) {
    for (const role of ["anon", "authenticated"])
      assert.equal(
        (await one(db, `select has_function_privilege('${role}', '${fn}', 'execute') ok`)).ok,
        false,
        `${role} ${fn}`,
      );
    assert.equal(
      (await one(db, `select has_function_privilege('service_role', '${fn}', 'execute') ok`)).ok,
      true,
      fn,
    );
  }
  assert.equal(
    (await one(db, "select has_schema_privilege('anon', 'lawviz', 'usage') ok")).ok,
    false,
  );
  await db.close();
});

test("U.S. Code atlas: exact recency, medians, groups and totals", async () => {
  const db = await fresh();
  const r = (await one(db, "select public.lawviz_refresh_v1('t1', 'usc') r")).r;
  assert.equal(r.families[0].detail.sections, 654);
  const node = async (id) =>
    one(db, "select * from lawviz.atlas_nodes where corpus='usc' and id=$1", [id]);
  const s1 = await node("1:1");
  assert.equal(s1.parent, "usc/1/c1");
  assert.equal(s1.num, "§ 1");
  assert.equal(s1.chars, 100);
  // latest of the Code-change kinds (2001-06-30); the law_text link (2020) is ignored
  assert.equal(s1.last_change.toISOString().slice(0, 10), "2001-06-30");
  assert.equal(s1.median_year, 2001);
  const s2 = await node("1:2");
  assert.equal(s2.recorded, 0, "an impossible enactment date is not recorded");
  assert.equal(s2.last_change, null);
  const s3 = await node("1:3");
  assert.equal(s3.status, "repealed");
  assert.equal((await node("1:4")).parent, "usc/1/c_");
  assert.equal((await node("1:4")).recorded, 0, "a future date is not recorded");
  const c1 = await node("usc/1/c1");
  assert.equal(c1.kind, "chapter");
  assert.equal(c1.num, "CHAPTER 1");
  assert.equal(c1.label, "RULES OF CONSTRUCTION");
  assert.equal(c1.sections, 2);
  assert.equal(c1.recorded, 1);
  assert.equal(c1.chars, 150);
  const grp = await node("usc/1/c_");
  assert.equal(grp.kind, "group");
  assert.equal(grp.label, "Not in a chapter");
  const t1 = await node("usc/1");
  assert.equal(t1.sections, 4);
  assert.equal(t1.recorded, 2);
  assert.equal(t1.median_year, 2001); // years 2001 and 2020 -> percentile_disc(0.5) = 2001
  assert.equal(t1.children, 3);
  const t26c = await node("usc/26/c2");
  assert.equal(t26c.kind, "chapter", "the chapter is chosen over the shallower subtitle");
  const empty = await node("usc/50a");
  assert.equal(empty.sections, 0);
  assert.equal(empty.ord, 501);
  const root = await node("usc");
  assert.equal(root.sections, 654);
  assert.equal(root.children, 3);
  // refreshing again replaces, never duplicates
  await one(db, "select public.lawviz_refresh_v1('t2', 'usc')");
  assert.equal(
    (await one(db, "select count(*)::int n from lawviz.atlas_nodes where corpus='usc'")).n,
    654 + 4 + 3 + 1,
  );
  await db.close();
});

test("atlas RPC: focus, path, grandchildren, bins and ranges", async () => {
  const db = await fresh();
  await one(db, "select public.lawviz_refresh_v1('t1', 'all')");
  const atlas = async (...a) =>
    (
      await one(db, "select public.lawviz_atlas_v1($1,$2,$3,$4) r", [
        a[0],
        a[1] ?? null,
        a[2] ?? null,
        a[3] ?? null,
      ])
    ).r;
  const root = await atlas("usc");
  assert.equal(root.status, "ok");
  assert.equal(root.children.length, 3);
  assert.equal(root.grandchildren_included, true);
  assert.equal(root.grandchildren.length, 3 + 1); // title 1: 3 groups, title 26: 1 chapter
  const t1 = await atlas("usc", "usc/1");
  assert.deepEqual(
    t1.path.map((p) => p[0]),
    ["usc"],
  );
  assert.equal(t1.grandchildren.length, 4);
  const ch = await atlas("usc", "usc/26/c2");
  assert.equal(ch.binned, true);
  assert.ok(ch.children.length <= 48 && ch.children.length > 20);
  assert.equal(
    ch.children.reduce((a, c) => a + c[5], 0),
    650,
  );
  const bin = ch.children[0];
  assert.equal(bin[2], "range");
  const range = await atlas("usc", "usc/26/c2", bin[12], bin[13]);
  assert.equal(range.children.length, bin[10]);
  assert.equal(range.binned, false);
  assert.deepEqual(range.range, [bin[12], bin[13]]);
  assert.equal((await atlas("usc", "usc/99")).status, "not_found");
  assert.equal((await atlas("bad")).status, "invalid");
  assert.equal((await atlas("usc", "usc/1", 5, null)).status, "invalid");
  const cfr = await atlas("cfr");
  assert.equal(cfr.children[0][3], "Title 21");
  assert.equal(cfr.children[0][4], "Food and Drugs");
  await db.close();
});

test("CFR atlas: parts with and without records, reserved, version recency", async () => {
  const db = await fresh();
  await one(db, "select public.lawviz_refresh_v1('t1', 'cfr')");
  const node = async (id) =>
    one(db, "select * from lawviz.atlas_nodes where corpus='cfr' and id=$1", [id]);
  const s = await node("cfr:21:101.1");
  assert.equal(s.parent, "cfr/21/p/101");
  assert.equal(s.num, "§ 101.1");
  assert.equal(s.label, "Principal display panel.");
  assert.equal(s.last_change.toISOString().slice(0, 10), "2023-03-24");
  assert.equal((await node("cfr:21:101.3")).status, "reserved");
  assert.equal((await node("cfr:21:101.3")).recorded, 0, "no version record: not recorded");
  const p101 = await node("cfr/21/p/101");
  assert.equal(p101.label, "Food Labeling");
  assert.equal(p101.parent, "cfr/21/c/I");
  assert.equal(p101.sections, 3);
  assert.equal(p101.chars, 4000);
  assert.equal(p101.recorded, 2);
  assert.equal(p101.median_year, 2019);
  const p2 = await node("cfr/21/p/2");
  assert.equal(p2.sections, 0);
  assert.equal(p2.status, "reserved");
  assert.equal(p2.label, "[Reserved]");
  const p7 = await node("cfr/21/p/7");
  assert.equal(p7.parent, "cfr/21/c/I", "a part with no record takes its sections' chapter");
  const ch = await node("cfr/21/c/I");
  assert.equal(ch.label, "Food and Drug Administration");
  assert.equal(ch.children, 3);
  assert.equal(ch.sections, 4);
  assert.equal((await node("cfr/21")).label, "Food and Drugs");
  assert.equal((await node("cfr")).sections, 4);
  await db.close();
});

test("part lineage: exact CFR pair, version lanes, statutes and missing ids", async () => {
  const db = await fresh();
  const lin = async (t, p, usc) =>
    (await one(db, "select public.lawviz_part_lineage_v1($1,$2,$3) r", [t, p, usc])).r;
  const r = await lin("21", "101", ["1:1", "1:3", "9:999"]);
  assert.equal(r.status, "ok");
  assert.equal(r.part_record.title, "21 CFR Part 101—Food Labeling");
  assert.equal(r.fr.total, 3);
  assert.equal(r.fr.undated, 1);
  assert.equal(r.fr.docs.length, 2);
  assert.deepEqual(r.fr.months, [
    ["2022-07", "Proposed Rule", 1],
    ["2023-03", "Rule", 1],
  ]);
  assert.equal(r.fr.complete, true);
  assert.equal(r.versions.sections, 3);
  assert.equal(r.versions.selection, "all");
  // substantive dates only, distinct per section and day
  assert.deepEqual(r.versions.dates, [
    ["2016-12-19", 1],
    ["2018-02-02", 1],
    ["2019-01-01", 1],
    ["2023-03-24", 1],
    ["2024-01-01", 1],
  ]);
  const lane = r.versions.lanes.find((l) => l[0] === "cfr:21:101.1");
  assert.equal(lane[4], 2);
  assert.deepEqual(lane[5][1], [
    "2023-03-24",
    [["88 FR 17710", "https://www.federalregister.gov/d/2023-05418"]],
  ]);
  assert.deepEqual(
    r.statutes.map((s) => s[0]),
    ["1:1", "1:3"],
  );
  const laws11 = r.statutes[0][5];
  assert.deepEqual(
    laws11.map((l) => l[0]),
    ["pl-1-1", "pl-1-2"],
    "only Code-change kinds, oldest first",
  );
  assert.deepEqual(r.missing, ["9:999"]);
  assert.equal((await lin("21", "7", [])).fr.total, 1);
  assert.equal((await lin("99", "1", [])).status, "invalid");
  assert.equal((await lin("21", "101", ["x"])).status, "invalid");
  assert.equal(
    (
      await lin(
        "21",
        "101",
        Array.from({ length: 25 }, (_, i) => `1:${i}`),
      )
    ).status,
    "invalid",
  );
  const none = await lin("21", "999", []);
  assert.equal(none.empty, true);
  assert.equal(none.part_record, null);
  await db.close();
});

test("bill flow: recorded milestones only, 108th–119th Congress", async () => {
  const db = await fresh();
  await one(db, "select public.lawviz_refresh_v1('t1', 'bills')");
  const r = (await one(db, "select public.lawviz_bill_flow_v1() r")).r;
  assert.equal(r.status, "ok");
  const total = r.rows.reduce((a, x) => a + x[7], 0);
  assert.equal(total, 5, "the 107th Congress bill is outside the range");
  const law = r.rows.filter((x) => x[6]);
  assert.equal(
    law.reduce((a, x) => a + x[7], 0),
    2,
  );
  assert.equal(
    law.reduce((a, x) => a + x[8], 0),
    2,
  );
  const noIntro = r.rows.find((x) => x[3] === false);
  assert.equal(noIntro[2], "Taxation");
  assert.ok(r.policy_areas.includes(""), "a missing policy area is kept as not recorded");
  assert.deepEqual(r.public_laws, { 117: 2 });
  await db.close();
});

test("calendar: coverage windows, zero vs not recorded, undated counts", async () => {
  const db = await fresh();
  await one(db, "select public.lawviz_refresh_v1('t1', 'calendar')");
  const cal = async (a, y) =>
    (await one(db, "select public.lawviz_calendar_v1($1,$2) r", [a, y])).r;
  const all = await cal("all", 2022);
  assert.equal(all.status, "ok");
  const ids = all.series.map((s) => s[0]);
  assert.deepEqual(ids, [
    "fr_all",
    "cpsc_recalls",
    "fda_all",
    "sec_actions",
    "ftc_hsr",
    "doj_press",
  ]);
  const days = (s) => all.days.filter((d) => d[0] === s).map((d) => [d[1], d[2]]);
  assert.deepEqual(days("cpsc_recalls"), [
    ["2022-07-01", 2],
    ["2022-07-09", 1],
  ]);
  assert.deepEqual(days("fda_all"), [["2022-07-06", 2]]);
  assert.deepEqual(days("ftc_hsr"), [["2022-01-03", 1]], "only notices are counted");
  assert.deepEqual(
    days("doj_press"),
    [["2022-03-01", 1]],
    "the index dataset is not a press-release year",
  );
  const doj = all.series.find((s) => s[0] === "doj_press");
  assert.equal(doj[6], 1, "undated releases are counted apart");
  assert.deepEqual(doj[9], ["doj_press_releases_2022"]);
  const cpsc = all.series.find((s) => s[0] === "cpsc_recalls");
  assert.equal(cpsc[3], "2022-07-01");
  assert.equal(cpsc[4], "2022-07-09");
  assert.equal(cpsc[5], 3);
  const fda = await cal("fda", 2022);
  assert.deepEqual(
    fda.series.map((s) => s[0]),
    ["fr_199", "fda_drug", "fda_device", "fda_food"],
  );
  const device = fda.series.find((s) => s[0] === "fda_device");
  assert.equal(device[3], null, "a series with no dated record has no coverage window");
  const frFda = fda.days.filter((d) => d[0] === "fr_199");
  assert.deepEqual(
    frFda.map((d) => [d[1], d[2]]),
    [["2022-07-01", 1]],
  );
  assert.equal((await cal("xyz", 2022)).status, "invalid");
  assert.ok(all.months.some((m) => m[0] === "sec_actions" && m[1] === "2021-12" && m[2] === 1));
  await db.close();
});

test("status reports each family's latest build", async () => {
  const db = await fresh();
  await one(db, "select public.lawviz_refresh_v1('n20261023', 'all')");
  const s = (await one(db, "select public.lawviz_status_v1() r")).r;
  assert.deepEqual(
    s.families.map((f) => f.family),
    ["bills", "calendar", "cfr", "usc"],
  );
  assert.ok(s.families.every((f) => f.build === "n20261023" && f.finished_at));
  await assert.rejects(() => db.query("select public.lawviz_refresh_v1('Bad Build')"));
  await db.close();
});
