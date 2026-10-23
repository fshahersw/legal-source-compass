// Offline contract tests for database/contracts/insights-v1.sql (insights/1). Isolated PostgreSQL (pglite): no
// credentials, network or live corpus access. The fixture (./fixture.mjs) copies real record shapes with synthetic values.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { CASES, DATASETS, RECORDS } from "./fixture.mjs";

const runtime =
  process.env.PUBLISHER_CODE_PGLITE ??
  path.resolve("private/tools/publisher-code-contract-tests/node_modules/@electric-sql/pglite/dist/index.js");
const { PGlite } = await import(pathToFileURL(runtime).href);
const SQL_FILE = "database/contracts/insights-v1.sql";

/** count x 100,000 / pop, rounded half-up to 4 decimals, computed exactly with integers (independent of the SQL). */
function rate(count, pop) {
  const num = BigInt(count) * 100000n * 10000n;
  const den = BigInt(pop);
  let q = num / den;
  if ((num % den) * 2n >= den) q += 1n;
  const s = q.toString().padStart(5, "0");
  return `${s.slice(0, -4)}.${s.slice(-4)}`;
}

async function setup() {
  const db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create table public.corpus_datasets (id text primary key, label text, ready boolean default true, metadata jsonb,
      manifest_sha256 text);
    create table public.corpus_records (dataset text not null, id text not null, category text, state text, title text,
      source_url text, ordinal integer, item jsonb, detail jsonb, text text, filters jsonb, primary key (dataset, id));
    create schema caselaw;
    create table caselaw.cases (cluster_id bigint primary key, court_id text not null, date_filed date,
      date_approx boolean not null default false, cited_by integer not null default 0);`);
  for (const d of DATASETS)
    await db.query("insert into public.corpus_datasets (id, label, metadata) values ($1, $1, $2)", [d.id, d.metadata]);
  let ordinal = 0;
  for (const r of RECORDS)
    await db.query(
      `insert into public.corpus_records (dataset, id, category, state, title, source_url, ordinal, item, detail, filters)
       values ($1, $2, $1, $3, $4, $5, $6, $7, $8, $9)`,
      [r.dataset, r.id, r.state, r.title, r.source_url, ordinal++, r.item, r.detail, r.filters],
    );
  for (const c of CASES)
    await db.query("insert into caselaw.cases values ($1, $2, $3, $4, $5)", c);
  await db.exec(await fs.readFile(SQL_FILE, "utf8"));
  return db;
}

test("insights/1 contract", { timeout: 300000 }, async (t) => {
  const db = await setup();
  const one = async (sql, args = []) => (await db.query(sql, args)).rows[0];
  const rpc = async (name, args = []) =>
    (await one(`select public.${name}(${args.map((_, i) => `$${i + 1}`).join(",")}) as r`, args)).r;
  const fact = (metric, type, id, period) =>
    one(
      `select value::text as value, moe::text as moe, n::text as n, partial, not_recorded_reason as reason,
              period_start::text as start, period_end::text as end
       from insights.facts where metric_id = $1 and entity_type = $2 and entity_id = $3 and period = $4`,
      [metric, type, id, period],
    );
  const expectValue = async (metric, type, id, period, value, extra = {}) => {
    const f = await fact(metric, type, id, period);
    assert.ok(f, `missing fact ${metric} ${type}:${id} ${period}`);
    assert.equal(f.value, value, `${metric} ${type}:${id} ${period}`);
    assert.equal(f.reason, null, `${metric} ${type}:${id} ${period} has a value and no reason`);
    for (const [k, v] of Object.entries(extra)) assert.equal(f[k], v, `${metric} ${type}:${id} ${period} ${k}`);
  };
  const expectGap = async (metric, type, id, period, reasonPattern) => {
    const f = await fact(metric, type, id, period);
    assert.ok(f, `missing gap fact ${metric} ${type}:${id} ${period}`);
    assert.equal(f.value, null, `${metric} ${type}:${id} ${period} must be null, never zero`);
    assert.match(f.reason ?? "", reasonPattern);
  };
  const expectAbsent = async (metric, type, id, period) =>
    assert.equal(await fact(metric, type, id, period), undefined, `${metric} ${type}:${id} ${period} must not exist`);

  let first;
  await t.test("registry: at least 60 metrics over all eight topics, every field present", async () => {
    const m = await one(
      `select count(*)::int n, count(distinct topic)::int topics, count(distinct family)::int families,
              bool_and(label <> '' and unit <> '' and numerator <> '' and method <> '' and jsonb_array_length(source_links) > 0
                       and cardinality(source_datasets) > 0) complete,
              bool_and((format = 'rate_per_100k') = (denominator is not null and denominator ~ 'Census')) rates_have_census
       from insights.metrics`,
    );
    assert.ok(m.n >= 60, `${m.n} metrics`);
    assert.equal(m.topics, 8);
    assert.equal(m.complete, true);
    assert.equal(m.rates_have_census, true);
    const fams = await one(
      "select count(*)::int n from insights.families f where f.id <> 'entities' and not exists (select 1 from insights.metrics m where m.family = f.id)",
    );
    assert.equal(fams.n, 0, "every fact family has metrics");
  });

  await t.test("refresh_all succeeds for every family and records a run each", async () => {
    first = (await one("select insights.refresh_all('test') r")).r;
    for (const run of first.runs) assert.equal(run.status, "succeeded", `${run.family}: ${run.error ?? ""}`);
    assert.equal(first.status, "succeeded");
    const runs = await one("select count(*)::int n, bool_and(status = 'succeeded' and finished_at is not null) ok from insights.runs");
    assert.equal(runs.n, first.runs.length);
    assert.equal(runs.ok, true);
    const empty = await one(
      "select string_agg(id, ',') ids from insights.metrics where coverage_facts = 0 and id not in ('fda_food_enforcement_reports')",
    );
    assert.equal(empty.ids, null, "every metric (except the one with no fixture rows) has facts");
  });

  await t.test("entity spine: published ids, parents and in-app pages only where they exist", async () => {
    const e = async (type, id) =>
      one("select label, parent_type, parent_id, keys, href from insights.entities where entity_type = $1 and entity_id = $2", [type, id]);
    assert.deepEqual(await e("state", "CA"), {
      label: "California",
      parent_type: "nation",
      parent_id: "US",
      keys: { usps: "CA", fips: "06" },
      href: "/places/CA",
    });
    assert.equal((await e("state", "GU")).href, null, "no places page for Guam");
    assert.equal((await e("county", "06037")).href, "/places/CA/06037");
    assert.equal((await e("county", "06001")).href, null, "county missing from the county directory has no page");
    assert.equal((await e("county", "06037")).parent_id, "CA");
    assert.deepEqual(await e("court", "cand"), {
      label: "District Court, N.D. California",
      parent_type: "circuit",
      parent_id: "ca9",
      keys: { court_id: "cand", court_type: "FD" },
      href: "/courts/cand",
    });
    assert.equal((await e("court", "canb")).parent_id, "CA");
    assert.equal((await e("court", "scotus")).parent_type, "nation");
    assert.equal((await e("circuit", "ca9")).href, "/courts/ca9");
    assert.equal((await e("judge", "13761857")).href, "/judges/abc123");
    assert.equal((await e("judge", "1002")).href, null, "judge page that does not exist is not linked");
    assert.equal((await e("judge", "13761857")).parent_id, "cand");
    assert.equal((await e("mdl", "2738")).href, "/matters/lens/2738");
    assert.equal((await e("mdl", "2738")).parent_id, "cand");
    assert.equal((await e("company", "0000001800")).href, "/companies/0000001800");
    assert.deepEqual((await e("company", "op-100000000286")).keys, { open_payments_id: "100000000286" });
    assert.equal((await e("company", "op-100000000286")).href, null);
    assert.equal((await e("agency", "54")).parent_id, "538");
    assert.equal((await e("agency", "54")).href, "/agencies/54");
    assert.equal((await e("agency", "oig:americorps-office-inspector-general")).label, "AmeriCorps Office of Inspector General");
    assert.match((await e("product", "faers:1871")).keys.openfda_search, /^https:\/\/api\.fda\.gov\//);
    assert.equal((await e("law_unit", "cfr:40")).href, "/law/cfr/40");
    const links = (await db.query("select from_type, from_id, to_type, to_id, relation, evidence from insights.links order by 1,2,3,4,5")).rows;
    assert.deepEqual(
      links.filter((l) => l.from_type === "mdl"),
      [
        { from_type: "mdl", from_id: "1000", to_type: "court", to_id: "nysd", relation: "transferee_court", evidence: "publisher_stated" },
        { from_type: "mdl", from_id: "2738", to_type: "court", to_id: "cand", relation: "transferee_court", evidence: "publisher_stated" },
        { from_type: "mdl", from_id: "2738", to_type: "judge", to_id: "13761857", relation: "transferee_judge", evidence: "exact_id" },
        { from_type: "mdl", from_id: "2846", to_type: "court", to_id: "cand", relation: "transferee_court", evidence: "publisher_stated" },
      ],
      "a judge link only on an exact CourtListener person id, never by name",
    );
    assert.ok(links.some((l) => l.from_id === "1002" && l.relation === "served_on" && l.to_id === "cand"));
    assert.ok(links.some((l) => l.from_id === "1002" && l.relation === "sits_on" && l.to_id === "nysd"));
    assert.ok(!links.some((l) => l.from_id === "1000" && l.relation === "sits_on"), "a judge no longer sitting has no sits_on link");
  });

  await t.test("places: population, ACS with MOE and gaps, CBP with withheld figures", async () => {
    await expectValue("pop_resident", "nation", "US", "2019", "1001000");
    await expectValue("pop_resident", "nation", "US", "2020", "1002000", { start: "2020-01-01", end: "2020-12-31" });
    await expectValue("pop_resident", "county", "06037", "2024", "100000");
    await expectAbsent("pop_resident", "county", "06001", "2024");
    await expectValue("acs1_median_household_income", "state", "CA", "2019", "80440", { moe: "313" });
    await expectValue("acs1_median_household_income", "nation", "US", "2021", "69717", { moe: "134" });
    await expectGap("acs1_median_household_income", "state", "CA", "2020", /no standard 2020 ACS 1-year/);
    await expectGap("acs1_uninsured_rate", "state", "CA", "2021", /did not publish/);
    await expectGap("acs1_bachelors_or_higher", "state", "CA", "2019", /No estimate is stored/);
    await expectValue("acs5_median_household_income", "county", "06037", "2024", "90112", {
      moe: "392",
      start: "2020-01-01",
      end: "2024-12-31",
    });
    await expectGap("acs5_poverty_rate", "county", "06037", "2023", /No estimate is stored/);
    await expectValue("cbp_establishments", "state", "CA", "2022", "1023181");
    await expectGap("cbp_employees", "state", "CA", "2022", /flag D/);
    await expectValue("cbp_annual_payroll", "state", "CA", "2023", "1429217482000");
    await expectGap("cbp_annual_payroll", "county", "06037", "2023", /flag S/);
    await expectValue("cbp_employees", "nation", "US", "2023", "131000000");
  });

  await t.test("courts (FJC): fiscal years, partial year, first duplicate wins, per-capita with the same year's population", async () => {
    await expectValue("fjc_civil_filed", "nation", "US", "FY2024", "291016", { start: "2023-10-01", end: "2024-09-30", partial: false });
    await expectValue("fjc_civil_filed", "nation", "US", "FY2026", "276610", { partial: true });
    await expectValue("fjc_civil_filed", "state", "CA", "FY2024", "40000");
    await expectValue("fjc_civil_median_days", "nation", "US", "FY2024", "364", { n: "396635" });
    await expectGap("fjc_civil_median_days", "court", "cand", "FY2024", /Not recorded in the FJC series/);
    await expectValue("fjc_civil_filed_per_100k", "state", "CA", "FY2024", rate(40000, 400500), { n: "40000" });
    await expectValue("fjc_civil_filed_per_100k", "state", "CA", "FY2025", rate(40100, 400600));
    await expectValue("fjc_civil_filed_per_100k", "nation", "US", "FY2024", rate(291016, 1010000));
    await expectGap("fjc_civil_filed_per_100k", "nation", "US", "FY2026", /No Census population estimate/);
    await expectGap("fjc_civil_filed_per_100k", "state", "GU", "FY2024", /No Census population estimate/);
    await expectValue("fjc_criminal_filed", "nation", "US", "FY2025", "79129");
    await expectValue("fjc_criminal_filed", "court", "cand", "FY2026", "508", { partial: true });
  });

  await t.test("courts (U.S. Courts tables): printed values, dashes, national totals only when consistent", async () => {
    await expectValue("usc_civil_filed", "court", "cand", "2024-09-30", "8341", { start: "2023-10-01" });
    await expectValue("usc_civil_filed", "nation", "US", "2024-09-30", "291016");
    await expectGap("usc_civil_filed", "nation", "US", "2025-03-31", /differs between the court records/);
    await expectGap("usc_civil_terminated", "court", "cand", "2025-03-31", /prints a dash/);
    await expectValue("usc_civil_terminated", "nation", "US", "2025-03-31", "380000", { start: "2024-04-01" });
    await expectValue("usc_civil_filed", "circuit", "ca9", "2024-09-30", "40000");
    await expectValue("usc_civil_median_months", "court", "cand", "2024-09-30", "10.1", { n: "9000" });
    await expectValue("usc_civil_median_months", "nation", "US", "2024-09-30", "8.3", { n: "300000" });
    await expectValue("usc_civil_pending_3yr_pct", "court", "cand", "2025-09-30", "15.9", {
      n: "1113",
      start: "2025-09-30",
      end: "2025-09-30",
    });
    await expectValue("usc_civil_pending_3yr_pct", "nation", "US", "2025-09-30", "16.8", { n: "90000" });
    await expectValue("usc_weighted_filings_per_judgeship", "court", "cand", "2025-09-30", "650");
    await expectValue("usc_judgeships", "nation", "US", "2025-09-30", "677");
    await expectValue("usc_product_liability_filed", "court", "cand", "2025-09-30", "3311");
    await expectValue("usc_appeals_filed", "circuit", "ca9", "2024-09-30", "10000");
    await expectValue("usc_appeals_filed", "nation", "US", "2024-09-30", "39987");
    await expectValue("usc_bankruptcy_filed", "court", "cand", "2025-06-30", "6763");
    await expectValue("usc_bankruptcy_filed", "nation", "US", "2025-06-30", "500000");
    await expectAbsent("usc_bankruptcy_filed", "court", "arcomb", "2025-06-30");
  });

  await t.test("judiciary: vacancy months read in full only; sitting judges by current court", async () => {
    await expectValue("judicial_vacancies", "nation", "US", "2026-08", "45", { start: "2026-08-01", end: "2026-08-31" });
    await expectGap("judicial_vacancies", "nation", "US", "2026-09", /not read in full/);
    await expectValue("fjc_sitting_judges", "court", "cand", "2026-10-19", "1");
    await expectValue("fjc_sitting_judges", "nation", "US", "2026-10-19", "2");
  });

  await t.test("litigation: MDL report snapshots, national sums only when every MDL prints a count, case law", async () => {
    await expectValue("mdl_actions_pending", "mdl", "2738", "2026-10-01", "69340");
    await expectGap("mdl_actions_pending", "mdl", "2846", "2026-09-01", /no pending count/);
    await expectValue("mdl_actions_pending", "nation", "US", "2026-10-01", String(69340 + 23324), { n: "2" });
    await expectGap("mdl_actions_pending", "nation", "US", "2026-09-01", /no printed pending count/);
    await expectValue("mdl_pending_mdls", "nation", "US", "2026-09-01", "2");
    await expectValue("mdl_actions_total", "mdl", "2738", "2026-10-01", "72024");
    await expectValue("mdl_court_actions_pending", "court", "cand", "2026-10-01", String(69340 + 23324), { n: "2" });
    await expectValue("mdl_court_pending_mdls", "court", "cand", "2026-10-01", "2");
    await expectAbsent("mdl_court_pending_mdls", "court", "nysd", "2026-10-01");
    await expectValue("jpml_fy_actions_pending", "nation", "US", "FY2025", "197118");
    await expectValue("jpml_motions_granted", "nation", "US", "2024", "24");
    await expectValue("scac_filings", "nation", "US", "2025", "129", { partial: true });
    await expectValue("caselaw_opinion_clusters", "court", "cand", "2024", "2", { partial: false });
    await expectValue("caselaw_citations_received", "court", "cand", "2024", "15", { n: "2" });
    await expectValue("caselaw_opinion_clusters", "court", "cand", "2026", "1", { partial: true });
    await expectValue("caselaw_opinion_clusters", "nation", "US", "2024", "2", { partial: false });
    await expectAbsent("caselaw_opinion_clusters", "court", "cal", "2024");
  });

  await t.test("enforcement: counts by year, partial latest year, states only from the state list", async () => {
    await expectValue("doj_press_releases", "nation", "US", "2024", "3", { partial: false });
    await expectValue("doj_press_releases", "nation", "US", "2025", "1", { partial: true });
    await expectValue("doj_state_press_releases", "state", "CA", "2024", "1");
    assert.equal((await one("select count(*)::int n from insights.facts where entity_id = 'AA'")).n, 0);
    await expectValue("sec_litigation_releases", "nation", "US", "2025", "2", { partial: true });
    await expectValue("sec_administrative_proceedings", "nation", "US", "2024", "1", { partial: false });
    await expectValue("ftc_enforcement_actions", "nation", "US", "2024", "1");
    await expectValue("frb_enforcement_actions", "nation", "US", "2026", "1", { partial: true });
    await expectValue("epa_cases_opened", "nation", "US", "FY2024", "3148", { partial: false });
    await expectValue("epa_cases_opened", "nation", "US", "FY2026", "1000", { partial: true });
    await expectValue("epa_federal_penalties", "state", "CA", "FY2024", "30234990.46");
    await expectAbsent("epa_cases_opened", "state", "XX", "FY2024");
    await expectValue("osha_inspections", "state", "CA", "FY2025", "7492", { partial: false });
    await expectValue("osha_current_penalties", "state", "CA", "FY2026", "22395894.77", { partial: true });
    await expectValue("osha_inspections", "nation", "US", "FY2025", "74123");
    await expectValue("leie_exclusions", "nation", "US", "2021", "2", { partial: true });
    await expectValue("leie_exclusions", "state", "CA", "2020", "2", { partial: false });
    await expectValue("oversight_reports", "nation", "US", "2026", "2000", { partial: true });
    await expectValue("oversight_reports", "agency", "oig:americorps-office-inspector-general", "2025", "12");
  });

  await t.test("safety: recalls, enforcement reports, adverse events per product, NEISS estimate with its sample n", async () => {
    await expectValue("cpsc_recalls", "nation", "US", "2026", "485", { partial: true });
    await expectValue("nhtsa_recall_campaigns", "nation", "US", "2025", "2", { partial: false });
    await expectValue("nhtsa_recall_campaigns", "nation", "US", "2026", "1", { partial: true });
    await expectValue("fsis_recalls", "nation", "US", "2025", "2");
    await expectValue("fsis_public_health_alerts", "nation", "US", "2025", "1");
    await expectValue("fda_drug_enforcement_reports", "nation", "US", "2025", "2", { partial: true });
    await expectValue("fda_device_enforcement_reports", "nation", "US", "2024", "1");
    await expectValue("faers_reports", "nation", "US", "2026", "500", { partial: true });
    await expectValue("faers_reports", "product", "faers:1871", "2024", "2082");
    await expectValue("maude_reports", "product", "maude:2197", "2024", "10");
    await expectValue("caers_reports", "nation", "US", "2025", "6308");
    await expectValue("neiss_injury_estimate", "nation", "US", "2025", "16485413", { n: "410201", moe: null });
    await expectValue("saferproducts_reports", "nation", "US", "2011", "4540", { partial: true });
    await expectValue("saferproducts_reports", "nation", "US", "2012", "5000", { partial: false });
  });

  await t.test("companies, law and government, consumer", async () => {
    await expectValue("sec_revenue", "company", "0000001800", "2024", "41950000000");
    await expectGap("sec_net_income", "company", "0000001800", "2023", /Different values/);
    await expectValue("open_payments_general", "company", "op-100000000286", "2017", "47273365.94", { n: "588507" });
    await expectValue("fr_documents", "agency", "54", "2025", "12");
    await expectValue("fr_documents", "nation", "US", "2026", "25000", { partial: true });
    await expectAbsent("fr_final_rules", "agency", "54", "2025");
    await expectValue("cfr_section_versions", "law_unit", "cfr:1", "2022", "1");
    await expectAbsent("cfr_section_versions", "law_unit", "cfr:1", "2015");
    await expectValue("cfr_section_versions", "law_unit", "cfr:40", "2017", "1", { partial: true });
    await expectValue("cfr_section_versions", "nation", "US", "2022", "1", { partial: false });
    await expectValue("congress_bills_introduced", "nation", "US", "2025", "2");
    await expectValue("public_laws_enacted", "nation", "US", "2025", "1");
    await expectAbsent("public_laws_enacted", "nation", "US", "1950");
    await expectValue("state_bills_current_session", "state", "CA", "2026-10-01", "2");
    await expectValue("cfpb_complaints", "state", "CA", "2026", "529804", { partial: true });
    await expectValue("cfpb_complaints_per_100k", "state", "CA", "2024", rate(12345, 400500), { n: "12345" });
    await expectValue("cfpb_complaints_per_100k", "nation", "US", "2024", rate(2000000, 1010000));
    await expectGap("cfpb_complaints_per_100k", "state", "CA", "2026", /No Census population estimate/);
    await expectValue("ftc_sentinel_fraud_other_reports", "state", "CA", "2024", "506727");
    await expectValue("ftc_sentinel_fraud_other_per_100k", "state", "CA", "2024", rate(506727, 400500));
    await expectValue("ftc_sentinel_reports", "nation", "US", "2024", "6471708");
    await expectValue("ftc_dnc_complaints_per_100k", "state", "CA", "FY2025", rate(304497, 400600));
    await expectGap("ftc_dnc_complaints_per_100k", "state", "CA", "FY2026", /No Census population estimate/);
  });

  await t.test("read RPC shapes follow contract.ts", async () => {
    const catalog = await rpc("insights_catalog_v1");
    assert.ok(catalog.length >= 60);
    const keys = Object.keys(catalog[0]).sort();
    assert.deepEqual(keys, [
      "caveats", "coverage", "denominator", "description", "direction", "entity_types", "format", "id", "label", "method",
      "numerator", "period_type", "refreshed_at", "source_datasets", "source_links", "topic", "unit",
    ]);
    const pop = catalog.find((m) => m.id === "pop_resident");
    assert.deepEqual(Object.keys(pop.coverage).sort(), ["entities", "facts", "from", "to"]);
    assert.ok(pop.coverage.facts > 0 && pop.refreshed_at);

    const series = await rpc("insights_series_v1", ["fjc_civil_filed", "nation", ["US"], null, null]);
    assert.deepEqual(series.map((f) => f.period), ["FY2024", "FY2026"]);
    assert.deepEqual(Object.keys(series[0]).sort(), [
      "entity_id", "entity_type", "metric_id", "moe", "n", "not_recorded_reason", "partial", "period", "period_end",
      "period_start", "value",
    ]);
    assert.equal(series[0].value, 291016);
    assert.equal(series[0].period_start, "2023-10-01");
    const windowed = await rpc("insights_series_v1", ["pop_resident", "nation", null, "2019", "2020"]);
    assert.deepEqual(windowed.map((f) => f.period), ["2019", "2020"]);

    const snap = await rpc("insights_snapshot_v1", ["acs1_median_household_income", "state", "2020"]);
    assert.equal(snap.length, 1);
    assert.equal(snap[0].value, null);
    assert.match(snap[0].not_recorded_reason, /2020/);

    const latest = await rpc("insights_latest_v1", ["fjc_civil_filed", "nation"]);
    assert.equal(latest.length, 1);
    assert.equal(latest[0].period, "FY2024", "latest complete period, never the partial one");

    const cross = await rpc("insights_cross_v1", ["pop_resident", "cfpb_complaints", "state", "2024", "2024"]);
    assert.deepEqual(cross, [{ entity_id: "CA", label: "California", x: 400500, y: 12345, period_x: "2024", period_y: "2024" }]);
    const crossPartial = await rpc("insights_cross_v1", ["pop_resident", "cfpb_complaints", "state", "2024", "2026"]);
    assert.deepEqual(crossPartial, [], "partial periods are not paired");

    const ent = await rpc("insights_entity_v1", ["state", "CA"]);
    assert.deepEqual(ent.entity, {
      type: "state",
      id: "CA",
      label: "California",
      parent: { type: "nation", id: "US" },
      keys: { usps: "CA", fips: "06" },
      href: "/places/CA",
    });
    assert.ok(ent.facts.every((f) => !f.partial && f.value !== null));
    assert.ok(ent.facts.some((f) => f.metric_id === "pop_resident" && f.period === "2025"));
    assert.ok(ent.children.some((c) => c.type === "county" && c.id === "06037"));
    assert.equal(await rpc("insights_entity_v1", ["state", "ZZ"]), null);

    const links = await rpc("insights_links_v1", ["court", "cand", null, 200]);
    assert.deepEqual(Object.keys(links[0]).sort(), ["evidence", "from", "relation", "source_dataset", "source_record_id", "to"]);
    assert.ok(links.some((l) => l.relation === "transferee_court" && l.from.id === "2738"));
    const only = await rpc("insights_links_v1", ["court", "cand", "sits_on", 200]);
    assert.ok(only.length >= 1 && only.every((l) => l.relation === "sits_on"));

    await assert.rejects(rpc("insights_series_v1", ["no_such_metric", "nation", null, null, null]), /Unknown metric/);
    await assert.rejects(rpc("insights_series_v1", ["pop_resident", "court", null, null, null]), /no facts for this entity type/);
    await assert.rejects(rpc("insights_links_v1", ["court", "cand", null, 5000]), /Limit/);
  });

  await t.test("idempotent: a second refresh over unchanged sources changes nothing", async () => {
    const dump = async () =>
      JSON.stringify([
        (await db.query("select * from insights.facts order by metric_id, entity_type, entity_id, period")).rows,
        (await db.query("select * from insights.entities order by entity_type, entity_id")).rows,
        (await db.query("select * from insights.links order by 1,2,3,4,5,6,7")).rows,
      ]);
    const before = await dump();
    const second = (await one("select insights.refresh_all('test-again') r")).r;
    assert.equal(second.status, "succeeded");
    for (const run of second.runs) {
      assert.equal(run.inserted, 0, `${run.family} inserted`);
      assert.equal(run.updated, 0, `${run.family} updated`);
      assert.equal(run.deleted, 0, `${run.family} deleted`);
      assert.equal(run.unchanged, run.staged, `${run.family} unchanged`);
    }
    assert.equal(await dump(), before);
  });

  await t.test("refresh_for_datasets refreshes only the families reading those datasets", async () => {
    await db.query(
      `update public.corpus_records set item = jsonb_set(item, '{agg,recalls}', '306')
       where dataset = 'regulatory_cpsc_aggregates' and id = 'cpsc-agg:year:2024'`,
    );
    await db.query("delete from public.corpus_records where dataset = 'scac_statistics' and id = 'year:2024'");
    const res = (await one("select insights.refresh_for_datasets(array['regulatory_cpsc_aggregates', 'not_a_dataset']) r")).r;
    assert.deepEqual(res.families, ["safety"]);
    assert.deepEqual(res.unmatched_datasets, ["not_a_dataset"]);
    assert.equal(res.runs[0].updated, 1);
    await expectValue("cpsc_recalls", "nation", "US", "2024", "306");
    await expectValue("scac_filings", "nation", "US", "2024", "225"); // mdl family not refreshed yet
    const doj = (await one("select insights.refresh_for_datasets(array['doj_press_releases_2025']) r")).r;
    assert.deepEqual(doj.families, ["enforcement"], "partitioned datasets match the family's pattern");
    const scac = (await one("select insights.refresh_for_datasets(array['scac_statistics']) r")).r;
    assert.deepEqual(scac.families, ["mdl"]);
    assert.equal(scac.runs[0].deleted, 1);
    await expectAbsent("scac_filings", "nation", "US", "2024");
    const viaRpc = await rpc("insights_refresh_for_datasets_v1", [["census_pop_estimates"]]);
    assert.deepEqual(viaRpc.families, ["entities", "places", "courts_fjc", "consumer"], "entity spine first, then per-capita families");
  });

  await t.test("a failing family keeps its previous facts and records the error", async () => {
    await db.query(
      `insert into public.corpus_records (dataset, id, item) values ('fjc_civil_districts', 'zzzd',
        '{"profile": {"series": [{"fy": 2024, "filings": 1, "terminations": 1, "pending_end": 1, "median_days": 1}]}}')`,
    );
    const before = await fact("fjc_civil_filed", "court", "cand", "FY2024");
    const res = (await one("select insights.refresh_courts_fjc('test') r")).r;
    assert.equal(res.status, "failed");
    assert.match(res.error, /entity missing from the spine: court:zzzd/);
    assert.deepEqual(await fact("fjc_civil_filed", "court", "cand", "FY2024"), before);
    const run = await one("select status, error from insights.runs where id = $1", [res.run]);
    assert.equal(run.status, "failed");
    assert.match(run.error, /^23503: /);
    await db.query("delete from public.corpus_records where dataset = 'fjc_civil_districts' and id = 'zzzd'");
    assert.equal((await one("select insights.refresh_courts_fjc('test') r")).r.status, "succeeded");
  });

  await t.test("grants: anon and authenticated cannot read or refresh; service_role can", async () => {
    for (const role of ["anon", "authenticated"]) {
      await db.exec(`set role ${role}`);
      try {
        await assert.rejects(db.query("select public.insights_catalog_v1()"), /permission denied/);
        await assert.rejects(db.query("select public.insights_refresh_for_datasets_v1(array['mdls'])"), /permission denied/);
        await assert.rejects(db.query("select insights.refresh_all()"), /permission denied/);
        await assert.rejects(db.query("select * from insights.facts limit 1"), /permission denied/);
      } finally {
        await db.exec("reset role");
      }
    }
    await db.exec("set role service_role");
    try {
      const r = await db.query("select jsonb_array_length(public.insights_catalog_v1()) n");
      assert.ok(r.rows[0].n >= 60);
      await assert.rejects(db.query("select * from insights.facts limit 1"), /permission denied/);
      await assert.rejects(db.query("select insights.schedule_nightly()"), /permission denied/);
    } finally {
      await db.exec("reset role");
    }
    const sec = await one(
      `select bool_and(p.prosecdef) definer, bool_and(coalesce(array_to_string(p.proconfig, ',') like '%search_path=%', false)) pinned
       from pg_proc p where p.proname like 'insights\\_%\\_v1'`,
    );
    assert.equal(sec.definer, true);
    assert.equal(sec.pinned, true);
  });

  await t.test("pg_cron helper refuses where pg_cron is not installed; reloading the file is idempotent", async () => {
    await assert.rejects(db.query("select insights.schedule_nightly()"), /pg_cron is not installed/);
    const n = (await one("select count(*)::int n from insights.facts")).n;
    await db.exec(await fs.readFile(SQL_FILE, "utf8"));
    assert.equal((await one("select count(*)::int n from insights.facts")).n, n);
    assert.equal((await one("select count(*)::int n from insights.geo_states")).n, 56);
  });

  await db.close();
});
