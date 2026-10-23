// Offline PostgreSQL contract test for database/contracts/api-law-v1.sql and insights-government2-v1.sql (pglite), run
// over the built samples in private/build/w1025_api-law (skipped per dataset when a build is absent). No credentials,
// network or live corpus.
//   node --test scripts/api_law/api-law-contract.test.mjs
//   API_LAW_WRITE_SNAPSHOT=1 also writes the overview RPC result to private/build/w1025_api-law/ui/rpc/ (used by the
//   local UI overlay, scripts/api_law/ui/overlay_rest.mjs).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { pathToFileURL } from "node:url";

const runtime =
  process.env.PUBLISHER_CODE_PGLITE ??
  path.resolve("private/tools/publisher-code-contract-tests/node_modules/@electric-sql/pglite/dist/index.js");
const { PGlite } = await import(pathToFileURL(runtime).href);
const INGEST = fs.readFileSync("database/contracts/ingest-v1.sql", "utf8");
const API_LAW = fs.readFileSync("database/contracts/api-law-v1.sql", "utf8");
const GOV2_PATH = "database/contracts/insights-government2-v1.sql";
const BUILD = "private/build/w1025_api-law";
const SAMPLE = 300;

// Production shapes of the two corpus tables (as in src/lib/ingest/contract.test.mjs).
const CORPUS = `
create role anon; create role authenticated; create role service_role;
create table public.corpus_datasets (id text primary key, label text not null, ready boolean not null default false,
  expected_records bigint not null default 0, imported_records bigint not null default 0, manifest_sha256 text,
  metadata jsonb not null default '{}', updated_at timestamptz not null default now());
create table public.corpus_records (dataset text not null references public.corpus_datasets(id), id text not null,
  category text not null check (category <> all (array['', 'unknown', 'uncategorized'])), state text,
  county_geoids text[] not null default '{}', title text not null default '', source_url text, ordinal bigint not null default 0,
  item jsonb not null, detail jsonb not null default '{}', text text not null default '', filters jsonb not null default '{}',
  search_vector tsvector, primary key (dataset, id));
`;

const SOURCES = {
  regulations_gov_documents: ["regulations_gov_documents", "ingest-regulations-gov"],
  regulations_gov_dockets: ["regulations_gov_dockets", "ingest-regulations-gov"],
  sec_enforcement: ["sec_enforcement_actions", "ingest-sec-enforcement"],
  doj_press_releases_2026: ["doj_press_releases_2026", "ingest-doj-press-releases"],
  doj_press_releases_2027: ["doj_press_releases_2027", "ingest-doj-press-releases"],
  congress_amendments: ["congress_amendments", "ingest-congress-gov"],
  congress_nominations: ["congress_nominations", "ingest-congress-gov"],
  congress_treaties: ["congress_treaties", "ingest-congress-gov"],
  congress_committee_reports: ["congress_committee_reports", "ingest-congress-gov"],
  govinfo_bill_versions: ["govinfo_bill_versions", "ingest-govinfo"],
  govinfo_hearings: ["govinfo_hearings", "ingest-govinfo"],
  govinfo_committee_prints: ["govinfo_committee_prints", "ingest-govinfo"],
  govinfo_gao_reports: ["govinfo_gao_reports", "ingest-govinfo"],
  gao_legal_decisions: ["gao_legal_decisions", "ingest-gao-legal"],
};

function builtFiles() {
  const out = new Map();
  if (!fs.existsSync(BUILD)) return out;
  for (const dir of fs.readdirSync(BUILD)) {
    const d = path.join(BUILD, dir);
    if (!fs.statSync(d).isDirectory()) continue;
    for (const f of fs.readdirSync(d))
      if (f.endsWith(".header.json")) {
        const rows = path.join(d, f.replace(/\.header\.json$/, ".rows.jsonl.gz"));
        if (fs.existsSync(rows)) out.set(f.replace(/\.header\.json$/, ""), { header: path.join(d, f), rows });
      }
  }
  return out;
}
const readRows = (file, limit) =>
  zlib
    .gunzipSync(fs.readFileSync(file))
    .toString("utf8")
    .split("\n")
    .filter(Boolean)
    .slice(0, limit)
    .map((l) => JSON.parse(l));

const db = new PGlite();
const one = async (sql, args = []) => (await db.query(sql, args)).rows[0];
const all = async (sql, args = []) => (await db.query(sql, args)).rows;
const BUILT = builtFiles();

async function publish(ds, rows, header) {
  await db.query(
    `insert into public.corpus_datasets (id, label, ready, expected_records, imported_records, metadata)
     values ($1, $2, true, $3, $3, $4) on conflict (id) do nothing`,
    [ds, header?.label ?? ds, rows.length, JSON.stringify({ id: ds, listing: { ...(header?.listing_block ?? {}), total: rows.length } })],
  );
  const withOrd = rows.map((r, i) => ({ ...r, ordinal: i }));
  for (let i = 0; i < withOrd.length; i += 500)
    await db.query(
      `insert into public.corpus_records (dataset, id, category, state, title, source_url, ordinal, item, detail, text, filters, search_vector)
       select x.dataset, x.id, x.category, x.state, x.title, x.source_url, x.ordinal, x.item, coalesce(x.detail, '{}'),
              coalesce(x.text, ''), coalesce(x.filters, '{}'), to_tsvector('simple', coalesce(x.text, ''))
       from jsonb_to_recordset($1::jsonb) as x(dataset text, id text, category text, state text, title text,
            source_url text, ordinal bigint, item jsonb, detail jsonb, text text, filters jsonb)
       on conflict (dataset, id) do nothing`,
      [JSON.stringify(withOrd.slice(i, i + 500))],
    );
}

test("api-law contract", async (t) => {
  await db.exec(CORPUS);
  await db.exec(INGEST);

  await t.test("applies twice; registers the 14 sources disabled with their functions and off-hour schedules", async () => {
    await db.exec(API_LAW);
    await db.exec(API_LAW);
    const rows = await all("select id, dataset, function_name, schedule, enabled, mode, ordinal_policy from ingest.sources order by id");
    const mine = rows.filter((r) => r.id in SOURCES);
    assert.equal(mine.length, Object.keys(SOURCES).length);
    for (const r of mine) {
      assert.deepEqual([r.dataset, r.function_name], SOURCES[r.id], r.id);
      assert.equal(r.enabled, false, `${r.id} starts disabled`);
      assert.equal(r.mode, "upsert");
      assert.match(r.schedule, /^\d{1,2} [0-9,]+ \* \* [0-9*,-]+$/);
      assert.notEqual(r.schedule.split(" ")[0], "0", `${r.id} avoids minute 0`);
    }
    // re-applying keeps an operator's enabled flag
    await db.exec("update ingest.sources set enabled = true where id = 'gao_legal_decisions'");
    await db.exec(API_LAW);
    assert.equal((await one("select enabled from ingest.sources where id = 'gao_legal_decisions'")).enabled, true);
    await db.exec("update ingest.sources set enabled = false where id = 'gao_legal_decisions'");
    // without pg_cron/pg_net the schedule block only notices
    assert.equal((await one("select count(*)::int as n from pg_namespace where nspname = 'cron'")).n, 0);
  });

  await t.test("the overview function is SECURITY DEFINER with an empty search_path, executable by service_role only", async () => {
    const f = await one(`select p.prosecdef, p.proconfig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'api_law_regs_overview_v1'`);
    assert.ok(f, "function exists");
    assert.equal(f.prosecdef, true);
    assert.deepEqual(f.proconfig, ['search_path=""']);
    for (const role of ["anon", "authenticated", "public"]) {
      const r = role === "public" ? "public" : role;
      if (r === "public") continue;
      assert.equal(
        (await one("select has_function_privilege($1, 'public.api_law_regs_overview_v1()', 'execute') as ok", [r])).ok,
        false,
        role,
      );
    }
    assert.equal(
      (await one("select has_function_privilege('service_role', 'public.api_law_regs_overview_v1()', 'execute') as ok")).ok,
      true,
    );
  });

  await t.test("built sample rows pass the ingest row checks of their source", async (tt) => {
    for (const [source, [dataset]] of Object.entries(SOURCES)) {
      const files = BUILT.get(dataset);
      if (!files) continue;
      const rows = readRows(files.rows, SAMPLE);
      const s = await one("select category, id_pattern from ingest.sources where id = $1", [source]);
      const problems = await all(
        `select x->>'id' as id, ingest.row_problem(x, $2, $3, $4) as problem
         from jsonb_array_elements($1::jsonb) x where ingest.row_problem(x, $2, $3, $4) is not null limit 5`,
        [JSON.stringify(rows), dataset, s.category, s.id_pattern],
      );
      assert.deepEqual(problems, [], `${dataset}: ${JSON.stringify(problems)}`);
      const ids = new Set(rows.map((r) => r.id));
      assert.equal(ids.size, rows.length, `${dataset}: unique ids`);
      await tt.test(`${dataset}: ${rows.length} rows ok`, () => {});
    }
  });

  await t.test("a scheduled run over published sample rows: unchanged rows stay, a changed row updates, a new row prepends", async () => {
    const files = BUILT.get("gao_legal_decisions");
    if (!files) return;
    const header = JSON.parse(fs.readFileSync(files.header, "utf8"));
    const rows = readRows(files.rows, SAMPLE);
    await publish("gao_legal_decisions", rows.slice(1), header);
    const open = (await one("select public.ingest_open_run_v1('gao_legal_decisions', 'manual') as r")).r;
    assert.ok(open.run_id);
    const changed = { ...rows[2], title: rows[2].title + " (corrected)", item: { ...rows[2].item, title: rows[2].title + " (corrected)" } };
    const batch = [rows[0], rows[1], changed];
    const up = (await one("select public.ingest_upsert_v1($1::uuid, $2::jsonb) as r", [open.run_id, JSON.stringify(batch)])).r;
    assert.equal(up.inserted, 1);
    assert.equal(up.updated, 1);
    const fin = (
      await one(
        "select public.ingest_finish_run_v1($1::uuid, 'ok', 3, 0, 1, null, null, '[]'::jsonb, '{}'::jsonb) as r",
        [open.run_id],
      )
    ).r;
    assert.equal(fin.status ?? "ok", "ok");
    const first = await one("select id from public.corpus_records where dataset = 'gao_legal_decisions' order by ordinal limit 1");
    assert.equal(first.id, rows[0].id, "the new decision is first");
  });

  await t.test("api_law_regs_overview_v1 over the Regulations.gov samples", async () => {
    const docs = BUILT.get("regulations_gov_documents");
    const dockets = BUILT.get("regulations_gov_dockets");
    if (!docs || !dockets) return;
    await publish("regulations_gov_documents", readRows(docs.rows, 100000), JSON.parse(fs.readFileSync(docs.header, "utf8")));
    await publish("regulations_gov_dockets", readRows(dockets.rows, 100000), JSON.parse(fs.readFileSync(dockets.header, "utf8")));
    const r = (await one("select public.api_law_regs_overview_v1() as r")).r;
    assert.match(r.as_of, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(Array.isArray(r.agencies) && r.agencies.length > 0 && r.agencies.length <= 12);
    for (const a of r.agencies) {
      assert.ok(a.rules + a.proposed_rules + a.notices >= 0);
      assert.ok(a.comments_on_proposed_rules === null || a.comments_on_proposed_rules >= 0);
      assert.ok(a.proposed_rules_counted <= a.proposed_rules, `${a.agency}: counted ≤ proposed rules`);
    }
    for (const d of r.open_for_comment) assert.ok(d.comment_end >= r.as_of, `${d.id} still open`);
    assert.ok(r.open_for_comment.length <= 50);
    assert.ok(r.most_commented_dockets.length <= 20);
    for (let i = 1; i < r.most_commented_dockets.length; i++)
      assert.ok(r.most_commented_dockets[i - 1].posted >= r.most_commented_dockets[i].posted, "most commented first");
    // documents per year and type equal a direct count
    const direct = await all(`select f.y as year, t.t as type, count(*)::int as n
      from public.corpus_records c, jsonb_array_elements_text(c.filters->'year') f(y), jsonb_array_elements_text(c.filters->'type') t(t)
      where c.dataset = 'regulations_gov_documents' group by 1, 2`);
    const key = (x) => `${x.year}|${x.type}`;
    const want = new Map(direct.map((x) => [key(x), x.n]));
    for (const y of r.by_year) assert.equal(y.n, want.get(key(y)), key(y));
    if (process.env.API_LAW_WRITE_SNAPSHOT === "1") {
      fs.mkdirSync(path.join(BUILD, "ui/rpc"), { recursive: true });
      fs.writeFileSync(path.join(BUILD, "ui/rpc/api_law_regs_overview_v1.json"), JSON.stringify(r));
    }
  });

  await t.test("insights government2: registers, refreshes over the samples, matches direct counts, is idempotent", async () => {
    const need = ["regulations_gov_documents", "congress_amendments", "congress_nominations", "congress_committee_reports",
      "govinfo_hearings", "govinfo_bill_versions", "company_sec_legal_proceedings"];
    if (!need.every((d) => BUILT.has(d))) return;
    await db.exec(`create schema if not exists caselaw;
      create table if not exists caselaw.cases (cluster_id bigint primary key, court_id text not null, date_filed date,
        date_approx boolean not null default false, cited_by integer not null default 0);`);
    await db.exec(fs.readFileSync("database/contracts/insights-v1.sql", "utf8"));
    const GOV2 = fs.readFileSync(GOV2_PATH, "utf8");
    await db.exec(GOV2);
    await db.exec(GOV2);
    for (const d of need.slice(1)) {
      const files = BUILT.get(d);
      await publish(d, readRows(files.rows, 100000), JSON.parse(fs.readFileSync(files.header, "utf8")));
    }
    // the spine: the nation, the twelve agencies' Federal Register ids, the CIKs of the 10-K sample (one left out)
    const ciks = [...new Set(readRows(BUILT.get("company_sec_legal_proceedings").rows, 100000).map((r) => r.item.filing.cik))].sort();
    const absentCik = ciks.pop();
    await db.query(
      `insert into insights.entities (entity_type, entity_id, label, source_dataset)
       select * from jsonb_to_recordset($1::jsonb) as x(entity_type text, entity_id text, label text, source_dataset text)
       on conflict do nothing`,
      [JSON.stringify([
        { entity_type: "nation", entity_id: "US", label: "United States", source_dataset: "test" },
        ...["199", "84", "345", "145", "192", "386", "45", "116", "159", "573", "466"].map((id) => ({
          entity_type: "agency", entity_id: id, label: `Agency ${id}`, source_dataset: "test" })),
        ...ciks.map((c) => ({ entity_type: "company", entity_id: c, label: `CIK ${c}`, source_dataset: "test" })),
      ])],
    );
    const res = (await one("select insights.refresh_government2('test') as r")).r;
    assert.equal(res.status, "succeeded", JSON.stringify(res));
    assert.ok(res.staged > 0);
    const facts = await all("select * from insights.facts where metric_id in (select id from insights.metrics where family = 'government2')");
    const by = (m) => facts.filter((f) => f.metric_id === m);
    // proposed rules per agency-year equal a direct count; PHMSA (408) is not in this spine, so it has no fact
    const direct = await all(`select r.filters -> 'agency' ->> 0 as agency, r.filters -> 'year' ->> 0 as y, count(*)::int as n
      from public.corpus_records r where r.dataset = 'regulations_gov_documents' and r.filters -> 'type' ->> 0 = 'proposed_rule'
      group by 1, 2`);
    const fr = { FDA: "199", CPSC: "84", NHTSA: "345", EPA: "145", FTC: "192", OSHA: "386", CMS: "45", DEA: "116", FAA: "159", CFPB: "573", SEC: "466" };
    for (const d of direct) {
      const f = by("regs_proposed_rules_posted").find((x) => x.entity_id === fr[d.agency] && x.period === d.y);
      if (!fr[d.agency]) assert.equal(f, undefined, `${d.agency} is outside the spine`);
      else assert.equal(Number(f.value), d.n, `${d.agency} ${d.y}`);
    }
    assert.ok(!facts.some((f) => f.entity_type === "agency" && f.entity_id === "408"));
    // comments on proposed rules: a sum only when every proposed rule has a count, else a reason
    for (const f of by("regs_comments_on_proposed_rules")) {
      assert.equal(f.value === null, f.not_recorded_reason !== null);
      if (f.value === null) assert.match(f.not_recorded_reason, /^Comment counts read for \d+ of \d+ proposed rules/);
      assert.ok(Number(f.n) > 0);
    }
    // nominations confirmed equal a direct count by the latest action's year
    const conf = await all(`select left(r.item -> 'nomination' -> 'latestAction' ->> 'date', 4) as y, count(*)::int as n
      from public.corpus_records r where r.dataset = 'congress_nominations' and r.filters -> 'status' ->> 0 = 'confirmed'
      group by 1`);
    for (const c of conf)
      assert.equal(Number(by("congress_nominations_confirmed").find((f) => f.period === c.y)?.value), c.n, `confirmed ${c.y}`);
    // the enrolled versions are a subset of all versions in every year
    for (const e of by("bill_enrolled_versions_published")) {
      const all_ = by("bill_text_versions_published").find((f) => f.period === e.period);
      assert.ok(Number(all_.value) >= Number(e.value));
    }
    // 10-K: one fact per company and fiscal period, distinct MDL numbers; the company outside the spine has none
    const tenk = by("company_10k_mdls_mentioned");
    assert.ok(tenk.length > 0);
    assert.ok(!tenk.some((f) => f.entity_id === absentCik));
    for (const f of tenk) {
      const rows = await all(`select r.item -> 'mentions' as m from public.corpus_records r
        where r.dataset = 'company_sec_legal_proceedings' and r.item -> 'filing' ->> 'cik' = $1 and r.item -> 'filing' ->> 'period' = $2
        order by r.item -> 'filing' ->> 'filed' desc limit 1`, [f.entity_id, f.period]);
      const distinct = new Set((rows[0].m ?? []).map((x) => x.mdl_number));
      assert.equal(Number(f.value), distinct.size, `${f.entity_id} ${f.period}`);
      assert.equal(f.period_end.toISOString().slice(0, 10), f.period);
    }
    // hearings: the current and previous year are partial (publication lag)
    const thisYear = new Date().getUTCFullYear();
    for (const f of by("congress_hearings_published"))
      assert.equal(f.partial, Number(f.period) >= thisYear - 1, `hearings ${f.period}`);
    // a second refresh over unchanged sources changes nothing
    const again = (await one("select insights.refresh_government2('test') as r")).r;
    assert.equal(again.status, "succeeded");
    assert.equal(again.inserted, 0);
    assert.equal(again.updated, 0);
    assert.equal(again.deleted, 0);
    // the family is refreshed when the scheduled ingestion names one of its datasets
    const via = (await one("select insights.refresh_for_datasets(array['congress_nominations']) as r")).r;
    assert.ok(via.families.includes("government2"));
    for (const fn of ["insights.facts_government2()", "insights.refresh_government2(text)"])
      assert.equal((await one(`select has_function_privilege('anon', '${fn}', 'execute') as ok`)).ok, false, fn);
  });

});
