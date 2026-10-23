// Live verification of the insights layer (read-only). Run after the lead applied database/contracts/insights-v1.sql and
// `select insights.refresh_all('initial');`:
//
//   . private/scratch/env.sh && node scripts/insights/verify_insights.mjs [--per-family 12] [--json <out.json>]
//
// For every metric family it samples facts through the read RPCs (insights_catalog_v1, insights_latest_v1,
// insights_series_v1) and recomputes each one independently from public.corpus_records over PostgREST, in JavaScript:
// a second code path that shares nothing with the SQL refresh functions. It prints one line per mismatch and a summary,
// and exits 1 when anything does not match. Credentials come only from the environment (EXTERNAL_SUPABASE_URL,
// EXTERNAL_SUPABASE_KEY, as the app reads them) and are never printed. Nothing is written.
//
// Not re-derived here (stated in the output): caselaw facts (caselaw.cases is not exposed over PostgREST; the script
// prints the SQL cross-check for psql) and the national cfr_section_versions totals (a full scan of 250,000 records).
//
// Before the layer is installed, `--probe "metric|type|id|period,..."` prints the REST recomputation of given facts only,
// e.g. --probe "doj_press_releases|nation|US|2024" (expected 20,533 on the corpus of 2026-10-23).
import fs from "node:fs/promises";

const BASE = (process.env.EXTERNAL_SUPABASE_URL ?? "").replace(/\/$/, "");
const KEY = process.env.EXTERNAL_SUPABASE_KEY ?? "";
if (!BASE || !KEY) {
  console.error(
    "EXTERNAL_SUPABASE_URL and EXTERNAL_SUPABASE_KEY must be set (source private/scratch/env.sh).",
  );
  process.exit(2);
}
const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const PER_FAMILY = Number(opt("--per-family", "12"));
const JSON_OUT = opt("--json", null);

const headers = () => {
  const h = { apikey: KEY, Accept: "application/json" };
  if (!KEY.startsWith("sb_")) h.Authorization = `Bearer ${KEY}`;
  return h;
};
let requests = 0;
async function rest(path, extra = {}) {
  requests += 1;
  const res = await fetch(`${BASE}/rest/v1/${path}`, { headers: { ...headers(), ...extra } });
  if (!res.ok) throw new Error(`GET ${path.split("?")[0]} failed (${res.status})`);
  return res;
}
const get = async (path) => (await rest(path)).json();
async function count(path) {
  const res = await rest(`${path}&select=id`, { Prefer: "count=exact", Range: "0-0" });
  const cr = res.headers.get("content-range") ?? "";
  const total = Number(cr.split("/")[1]);
  if (!Number.isFinite(total)) throw new Error(`no count for ${path.split("?")[0]}`);
  return total;
}
async function rpc(fn, body) {
  requests += 1;
  const res = await fetch(`${BASE}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: { ...headers(), "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`rpc ${fn} failed (${res.status})`);
  return res.json();
}
const enc = encodeURIComponent;
const cs = (o) => `filters=cs.${enc(JSON.stringify(o))}`;

const memo = new Map();
const once = (key, fn) => {
  if (!memo.has(key)) memo.set(key, fn());
  return memo.get(key);
};
async function record(dataset, id, select = "id,state,title,source_url,item,detail,filters") {
  return once(`${dataset}|${id}|${select}`, async () => {
    const rows = await get(
      `corpus_records?select=${select}&dataset=eq.${enc(dataset)}&id=eq.${enc(id)}&limit=1`,
    );
    return rows[0] ?? null;
  });
}
const num = (v) =>
  typeof v === "number" && Number.isFinite(v)
    ? v
    : typeof v === "string" && /^-?\d[\d,]*(\.\d+)?$/.test(v)
      ? Number(v.replaceAll(",", ""))
      : null;
const nonNeg = (v) => {
  const n = num(v);
  return n !== null && n >= 0 ? n : null;
};
const yearOf = (period) => Number(period.replace(/^FY/, "").slice(0, 4));

/** count x 100,000 / pop rounded half-up to 4 decimals, with integers (independent of the SQL). */
function rate(cnt, pop) {
  if (
    cnt === null ||
    pop === null ||
    !(pop > 0) ||
    !Number.isInteger(cnt) ||
    !Number.isInteger(pop)
  )
    return null;
  const n = BigInt(cnt) * 100000n * 10000n;
  const d = BigInt(pop);
  let q = n / d;
  if ((n % d) * 2n >= d) q += 1n;
  return Number(q) / 10000;
}

// ------------------------------------------------------------------------------------------------ population
const statePop = () =>
  once("statepop", async () => {
    const rows = await get(
      "corpus_records?select=id,s:item->census->series,usps:item->census->>usps,level:item->census->>level&dataset=eq.census_pop_estimates&id=in.(US," +
        "01,02,04,05,06,08,09,10,11,12,13,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31,32,33,34,35,36,37,38,39,40,41,42,44,45,46,47,48,49,50,51,53,54,55,56,72)",
    );
    const map = new Map();
    for (const r of rows) map.set(r.level === "us" ? "US" : r.usps, r.s);
    return map;
  });
async function population(type, id, year) {
  let s;
  if (type === "county") s = (await record("census_pop_estimates", id))?.item?.census?.series;
  else s = (await statePop()).get(id);
  if (!s) return null;
  const v = year <= 2019 ? s?.v2019?.pop?.[year] : s?.v2025?.pop?.[year];
  const n = year >= 2010 ? num(v) : null;
  return n !== null && n > 0 ? n : null;
}

// ------------------------------------------------------------------------------------------------ recomputers
const R = {}; // metric id -> async (fact) => { value, moe?, n?, partial? } | { skip: reason }

R.pop_resident = async (f) => ({
  value: await population(f.entityType, f.entityId, Number(f.period)),
});

const ACS1 = {
  acs1_median_household_income: "median_hh_income",
  acs1_poverty_rate: "poverty_rate",
  acs1_uninsured_rate: "uninsured",
  acs1_bachelors_or_higher: "bachelors_plus",
  acs1_unemployment_rate: "unemployment_rate",
  acs1_median_home_value: "median_home_value",
};
const ACS5 = {
  acs5_median_household_income: "median_hh_income",
  acs5_poverty_rate: "poverty_rate",
  acs5_uninsured_rate: "uninsured",
  acs5_bachelors_or_higher: "bachelors_plus",
};
async function censusRecord(dataset, f) {
  if (f.entityType === "nation") return record(dataset, "US");
  if (f.entityType === "county") return record(dataset, f.entityId);
  const rows = await once(`${dataset}|state|${f.entityId}`, () =>
    get(
      `corpus_records?select=id,item&dataset=eq.${dataset}&state=eq.${enc(f.entityId)}&item->census->>level=eq.state&limit=2`,
    ),
  );
  return rows.length === 1 ? rows[0] : null;
}
for (const [metric, key] of Object.entries({ ...ACS1, ...ACS5 }))
  R[metric] = async (f) => {
    const r = await censusRecord(
      metric.startsWith("acs5") ? "census_acs_counties" : "census_acs1_states",
      f,
    );
    const fig = r?.item?.census?.series?.[key]?.[f.period];
    if (!Array.isArray(fig)) return { value: null };
    const value = num(fig[0]);
    const moe = value !== null && num(fig[1]) !== null && num(fig[1]) >= 0 ? num(fig[1]) : null;
    return { value, moe };
  };
for (const [metric, idx, mult] of [
  ["cbp_establishments", 0, 1],
  ["cbp_employees", 1, 1],
  ["cbp_annual_payroll", 2, 1000],
])
  R[metric] = async (f) => {
    const r = await censusRecord(
      f.entityType === "county" ? "census_cbp_counties" : "census_cbp_states",
      f,
    );
    const cell = r?.item?.census?.series?.["00"]?.[f.period];
    const v = Array.isArray(cell) ? nonNeg(cell[idx]) : null;
    return { value: v === null ? null : v * mult };
  };

async function fjcSeries(f, kind) {
  if (kind === "criminal") {
    const r = await record(
      "fjc_criminal_districts",
      f.entityType === "nation" ? "national" : `district:${f.entityId}`,
    );
    return r?.item?.series ?? [];
  }
  const r =
    f.entityType === "nation"
      ? await record("fjc_civil_national", "US:summary")
      : await record(
          f.entityType === "state" ? "fjc_civil_states" : "fjc_civil_districts",
          f.entityId,
        );
  return r?.item?.profile?.series ?? [];
}
for (const [metric, key, nkey] of [
  ["fjc_civil_filed", "filings"],
  ["fjc_civil_terminated", "terminations"],
  ["fjc_civil_pending", "pending_end"],
  ["fjc_civil_median_days", "median_days", "terminations"],
])
  R[metric] = async (f) => {
    const e = (await fjcSeries(f, "civil")).find((x) => x?.fy === yearOf(f.period));
    return {
      value: nonNeg(e?.[key]),
      n: nkey ? nonNeg(e?.[nkey]) : null,
      partial: e?.partial === true,
    };
  };
R.fjc_civil_filed_per_100k = async (f) => {
  const e = (await fjcSeries(f, "civil")).find((x) => x?.fy === yearOf(f.period));
  const filed = nonNeg(e?.filings);
  return {
    value: rate(filed, await population(f.entityType, f.entityId, yearOf(f.period))),
    n: filed,
  };
};
for (const [metric, key] of [
  ["fjc_criminal_filed", "filed"],
  ["fjc_criminal_terminated", "terminated"],
])
  R[metric] = async (f) => {
    const e = (await fjcSeries(f, "criminal")).find((x) => x?.fy === yearOf(f.period));
    return { value: nonNeg(e?.[key]), partial: e?.partial === true };
  };

const UST = {
  usc_civil_filed: ["c", "filed/y0", null, 12],
  usc_civil_terminated: ["c", "terminated/y0", null, 12],
  usc_civil_pending: ["c", "pending/y0", null, 12],
  usc_civil_median_months: [
    "c-5",
    "total_cases/median_time_interval_in_months",
    "total_cases/number_of_cases",
    12,
  ],
  usc_civil_pending_3yr_pct: [
    "c-6",
    "length_of_time_pending/3_years_or_more/percent",
    "length_of_time_pending/3_years_or_more/number",
    0,
  ],
  usc_weighted_filings_per_judgeship: ["x-1a", "weighted_filings_per_judgeship/total", null, 12],
  usc_judgeships: ["x-1a", "judgeships", null, 12],
  usc_product_liability_filed: ["c-11", "y0_total", null, 12],
  usc_appeals_filed: ["b", "filed/y0", null, 12],
  usc_appeals_terminated: ["b", "terminated/y0", null, 12],
  usc_appeals_pending: ["b", "pending/y0", null, 12],
  usc_bankruptcy_filed: ["f", "filed/y0", null, 12],
};
function ustValue(u, period, months, col, ncol, field) {
  const i = (u?.periods ?? []).findIndex((p) => p?.end === period && num(p?.months) === months);
  if (i < 0) return undefined;
  const arr = u?.[field]?.[col];
  if (!Array.isArray(arr) || arr.length !== u.periods.length) return { value: null, n: null };
  return { value: num(arr[i]), n: ncol ? num(u?.[field]?.[ncol]?.[i]) : null };
}
for (const [metric, [table, col, ncol, months]] of Object.entries(UST))
  R[metric] = async (f) => {
    const dataset =
      table === "b" || f.entityType === "circuit"
        ? "uscourts_tables_circuit"
        : table === "f"
          ? "uscourts_tables_bankruptcy"
          : "uscourts_tables_district";
    if (f.entityType !== "nation") {
      const r = await record(dataset, `${f.entityId}:${table}`, "id,item");
      return ustValue(r?.item?.ust, f.period, months, col, ncol, "data") ?? { value: null };
    }
    // national total: the same printed total row in three court records must agree
    const rows = await once(`ust-nat|${dataset}|${table}`, () =>
      get(
        `corpus_records?select=id,u:item->ust&dataset=eq.${dataset}&id=like.*${enc(`:${table}`)}&order=id.asc&limit=400`,
      ),
    );
    const vals = rows
      .filter((r) => r.id.split(":")[1] === table && r.u?.court)
      .map((r) => ustValue(r.u, f.period, months, col, ncol, "nat"))
      .filter((v) => v && v.value !== null);
    const distinct = [...new Set(vals.map((v) => v.value))];
    return { value: distinct.length === 1 ? distinct[0] : null, n: vals[0]?.n ?? null };
  };

R.judicial_vacancies = async (f) => {
  const r = await record("judicial_vacancies", "national", "id,item");
  const e = (r?.item?.series ?? []).find((x) => x?.month === f.period);
  return { value: e?.reports?.vacancies === "parsed" ? nonNeg(e?.vacancies_listed) : null };
};
R.fjc_sitting_judges = async (f) => ({
  value: await count(
    `corpus_records?dataset=eq.judge_profiles_fjc&${cs(f.entityType === "nation" ? { sitting: ["yes"] } : { sitting: ["yes"], court: [f.entityId] })}`,
  ),
});

const history = () =>
  once("jpml-history", () =>
    get(
      "corpus_records?select=id,s:item->history->series&dataset=eq.jpml_pending_history_mdls&order=id.asc&limit=1000",
    ),
  );
R.mdl_actions_pending = async (f) => {
  const rows = (await history()).filter((r) => /^\d{1,5}$/.test(r.id));
  const entries = (r) => (r.s ?? []).find((e) => e?.report_date === f.period);
  if (f.entityType === "mdl")
    return { value: nonNeg(entries(rows.find((r) => r.id === f.entityId) ?? {})?.pending) };
  const listed = rows.map(entries).filter(Boolean);
  const vals = listed.map((e) => nonNeg(e.pending));
  return {
    value: vals.every((v) => v !== null) ? vals.reduce((a, b) => a + b, 0) : null,
    n: listed.length,
  };
};
R.mdl_actions_total = async (f) => {
  const r = (await history()).find((x) => x.id === f.entityId);
  return { value: nonNeg((r?.s ?? []).find((e) => e?.report_date === f.period)?.total) };
};
R.mdl_pending_mdls = async (f) => ({
  value: (await history()).filter(
    (r) => /^\d{1,5}$/.test(r.id) && (r.s ?? []).some((e) => e?.report_date === f.period),
  ).length,
});
const registry = (court) =>
  once(`mdls|${court}`, () =>
    get(
      `corpus_records?select=id,p:item->actions_pending,a:item->>as_of&dataset=eq.mdls&item->>cl_court_id=eq.${enc(court)}&item->>status=eq.pending`,
    ),
  );
R.mdl_court_actions_pending = async (f) => {
  const rows = (await registry(f.entityId)).filter(
    (r) => /^\d{1,5}$/.test(r.id) && r.a === f.period,
  );
  const vals = rows.map((r) => nonNeg(r.p));
  return {
    value: vals.every((v) => v !== null) ? vals.reduce((a, b) => a + b, 0) : null,
    n: rows.length,
  };
};
R.mdl_court_pending_mdls = async (f) => ({
  value: (await registry(f.entityId)).filter((r) => /^\d{1,5}$/.test(r.id) && r.a === f.period)
    .length,
});
R.jpml_fy_actions_pending = async (f) => {
  const r = await record("jpml_statistics_extra", "summary:overview", "id,item");
  return {
    value: nonNeg(
      (r?.item?.overview?.series ?? []).find((e) => e?.fy === yearOf(f.period))?.pending,
    ),
  };
};
R.jpml_motions_granted = async (f) => ({
  value: nonNeg(
    (await record("mdl_intel_jpml_stats", `year:${f.period}`, "id,item"))?.item?.stats
      ?.motions_granted,
  ),
});
R.scac_filings = async (f) => {
  const c = (await record("scac_statistics", `year:${f.period}`, "id,item"))?.item?.cells;
  return { value: nonNeg(c?.filings), partial: c?.partial === true };
};
R.caselaw_opinion_clusters = async () => ({
  skip: "caselaw.cases is not exposed over PostgREST (SQL cross-check printed)",
});
R.caselaw_citations_received = R.caselaw_opinion_clusters;

R.doj_press_releases = async (f) => ({
  value: await count(
    `corpus_records?dataset=like.doj_press_releases_2*&item->release->>date=like.${f.period}-*`,
  ),
});
R.doj_state_press_releases = async (f) => ({
  value: await count(
    `corpus_records?dataset=like.doj_press_releases_2*&item->release->>date=like.${f.period}-*&filters->state->>0=eq.${enc(f.entityId)}`,
  ),
});
R.sec_litigation_releases = async (f) => ({
  value: await count(
    `corpus_records?dataset=eq.sec_enforcement_actions&filters->type->>0=eq.litigation_release&filters->year->>0=eq.${f.period}`,
  ),
});
R.sec_administrative_proceedings = async (f) => ({
  value: await count(
    `corpus_records?dataset=eq.sec_enforcement_actions&filters->type->>0=eq.administrative_proceeding&filters->year->>0=eq.${f.period}`,
  ),
});
R.ftc_enforcement_actions = async (f) => ({
  value: await count(
    `corpus_records?dataset=eq.ftc_enforcement_actions&filters->kind->>0=in.(merger,nonmerger,bc_penalty,bcp_penalty)&filters->year->>0=eq.${f.period}`,
  ),
});
R.frb_enforcement_actions = async (f) => ({
  value: await count(
    `corpus_records?dataset=eq.frb_enforcement_actions&item->frb_action=not.is.null&filters->year->>0=eq.${f.period}`,
  ),
});
for (const [metric, key] of [
  ["epa_cases_opened", "opened"],
  ["epa_federal_penalties", "fed_penalty"],
])
  R[metric] = async (f) => {
    const id =
      f.entityType === "nation"
        ? `epa-echo-series:US:${yearOf(f.period)}`
        : `epa-echo-series:state:${f.entityId}:${yearOf(f.period)}`;
    return {
      value: nonNeg((await record("epa_echo_case_series", id, "id,item"))?.item?.cells?.[key]),
    };
  };
for (const [metric, key] of [
  ["osha_inspections", "inspections"],
  ["osha_current_penalties", "current_penalty"],
])
  R[metric] = async (f) => {
    const fy = yearOf(f.period);
    if (f.entityType === "nation")
      return {
        value: nonNeg(
          (await record("osha_inspections_national", `osha-national:FY${fy}`, "id,item"))?.item
            ?.year?.[key],
        ),
      };
    const years =
      (await record("osha_inspections_states", `osha-state:${f.entityId}`, "id,item"))?.item
        ?.profile?.years ?? [];
    return { value: nonNeg(years.find((e) => e?.fy === fy)?.[key]) };
  };
R.leie_exclusions = async (f) => ({
  value: await count(
    `corpus_records?dataset=eq.oig_leie_exclusions&item->cells->>excluded=like.${f.period}-*` +
      (f.entityType === "state" ? `&item->cells->>state=eq.${enc(f.entityId)}` : ""),
  ),
});
R.oversight_reports = async (f) => {
  const r = await record(
    "oversight_trends",
    f.entityType === "nation" ? "national" : f.entityId,
    "id,item",
  );
  return {
    value: nonNeg((r?.item?.trend?.years ?? []).find((e) => e?.year === Number(f.period))?.reports),
  };
};

R.cpsc_recalls = async (f) => {
  const a = (await record("regulatory_cpsc_aggregates", `cpsc-agg:year:${f.period}`, "id,item"))
    ?.item?.agg;
  return { value: nonNeg(a?.recalls), partial: a?.partial === true };
};
R.nhtsa_recall_campaigns = async (f) => ({
  value: await count(
    `corpus_records?dataset=eq.agency_safety_nhtsa_recalls&item->>kind=eq.recall&filters->year->>0=eq.${f.period}`,
  ),
});
R.fsis_recalls = async (f) => ({
  value: await count(
    `corpus_records?dataset=eq.fsis_recalls&item->cells->>kind=eq.Recall&item->cells->>class=in.(I,II,III)&item->cells->>date=like.${f.period}-*`,
  ),
});
R.fsis_public_health_alerts = async (f) => ({
  value: await count(
    `corpus_records?dataset=eq.fsis_recalls&item->cells->>kind=eq.${enc("Public health alert")}&item->cells->>date=like.${f.period}-*`,
  ),
});
for (const [metric, dataset] of [
  ["fda_drug_enforcement_reports", "agency_safety_openfda_drug_enforcement"],
  ["fda_device_enforcement_reports", "agency_safety_openfda_device_enforcement"],
  ["fda_food_enforcement_reports", "agency_safety_openfda_food_enforcement"],
])
  R[metric] = async (f) => ({
    value: await count(
      `corpus_records?dataset=eq.${dataset}&filters->>report_date=like.${f.period}-*`,
    ),
  });
async function adverseSeries(f, nationalDataset, nationalId, productDataset) {
  const r =
    f.entityType === "nation"
      ? await record(nationalDataset, nationalId, "id,item")
      : await record(productDataset, f.entityId.split(":")[1], "id,item");
  const e = (r?.item?.series ?? []).find((x) => x?.year === Number(f.period));
  return { value: nonNeg(e?.reports), partial: e?.partial === true };
}
R.faers_reports = (f) =>
  adverseSeries(f, "fda_faers_national_series", "all_years", "fda_faers_product_series");
R.maude_reports = (f) =>
  adverseSeries(f, "fda_device_event_series", "national", "fda_device_event_series");
R.caers_reports = async (f) => {
  const rows = await once("caers", () =>
    get(
      "corpus_records?select=id,p:item->point&dataset=eq.fda_caers_series&item->>kind=eq.caers_year",
    ),
  );
  const p = rows.map((r) => r.p).find((x) => x?.year === Number(f.period));
  return { value: nonNeg(p?.reports), partial: p?.partial === true };
};
R.neiss_injury_estimate = async (f) => {
  const c = (await record("neiss_national_years", f.period, "id,item"))?.item?.cells;
  return { value: nonNeg(c?.estimate), n: nonNeg(c?.cases) };
};
R.saferproducts_reports = async (f) => {
  const c = (await record("saferproducts_reports_series", `sp-pub-${f.period}`, "id,item"))?.item
    ?.cells;
  return { value: nonNeg(c?.reports), partial: /partial/i.test(c?.period ?? "") };
};

for (const [metric, key] of [
  ["sec_revenue", "revenue"],
  ["sec_net_income", "net_income"],
])
  R[metric] = async (f) => {
    const list = (
      (await record("company_sec_financials", f.entityId, "id,item"))?.item?.annual?.[key] ?? []
    ).filter((e) => e?.frame === `CY${f.period}` && (e?.unit ?? "USD") === "USD");
    const vals = [...new Set(list.map((e) => num(e.value)))];
    return { value: vals.length === 1 && vals[0] !== null ? vals[0] : null };
  };
for (const [metric, key, nkey] of [
  ["open_payments_general", "general", "generalRecords"],
  ["open_payments_research", "research", "researchRecords"],
])
  R[metric] = async (f) => {
    const e = (
      (await record("company_payments_manufacturers", f.entityId, "id,item"))?.item?.payments
        ?.years ?? []
    ).find((x) => x?.year === Number(f.period));
    return { value: nonNeg(e?.[key]), n: nonNeg(e?.[nkey]) };
  };

for (const [metric, key] of [
  ["fr_documents", "ALL"],
  ["fr_final_rules", "RULE"],
  ["fr_proposed_rules", "PRORULE"],
])
  R[metric] = async (f) => {
    const r = await record(
      "fr_agency_trends",
      f.entityType === "nation" ? "federal-register" : f.entityId,
      "id,item",
    );
    return { value: nonNeg(r?.item?.trends?.yearly?.[key]?.[f.period]) };
  };
R.cfr_section_versions = async (f) => {
  if (f.entityType === "nation")
    return { skip: "national total needs a scan of every section (checked by title)" };
  const title = f.entityId.split(":")[1];
  const total = await count(
    `corpus_records?dataset=eq.ecfr_section_versions&item->cells->>title_number=eq.${title}`,
  );
  if (total > 6000)
    return { skip: `title ${title} has ${total} sections (sampled titles stay under 6,000)` };
  let n = 0;
  for (let start = 0; start < total; start += 1000) {
    const res = await rest(
      `corpus_records?select=id,v:detail->versions&dataset=eq.ecfr_section_versions&item->cells->>title_number=eq.${title}&order=id.asc`,
      { Range: `${start}-${start + 999}` },
    );
    for (const r of await res.json())
      for (const v of Array.isArray(r.v) ? r.v : [])
        if (
          v?.substantive === true &&
          /^\d{4}-\d{2}-\d{2}$/.test(v?.date ?? "") &&
          v.date >= "2017-01-03" &&
          v.date.startsWith(`${f.period}-`)
        )
          n += 1;
  }
  return { value: n };
};
R.congress_bills_introduced = async (f) => ({
  value: await count(
    `corpus_records?dataset=eq.congress_bills&filters->type->>0=in.(hr,s,hjres,sjres)&item->cells->>introduced=like.${f.period}-*`,
  ),
});
R.public_laws_enacted = async (f) => ({
  value: await count(
    `corpus_records?dataset=eq.public_laws_enacted&filters->kind->>0=eq.${enc("Public law")}&item->cells->>enacted=like.${f.period}-*`,
  ),
});
R.state_bills_current_session = async (f) => ({
  value: await count(
    `corpus_records?dataset=eq.state_bills&filters->state->>0=eq.${enc(f.entityId)}&filters->session_role->>0=eq.current`,
  ),
});

async function cfpbYear(f) {
  const r =
    f.entityType === "nation"
      ? (await record("cfpb_complaints_national", "cfpb-national:all", "id,item"))?.item?.national
      : (await record("cfpb_complaints_states", `cfpb-state:${f.entityId}`, "id,item"))?.item
          ?.state_profile;
  return (r?.years ?? []).find((e) => String(e?.year) === f.period);
}
R.cfpb_complaints = async (f) => {
  const e = await cfpbYear(f);
  return { value: nonNeg(e?.complaints), partial: e ? e.complete !== true : undefined };
};
R.cfpb_complaints_per_100k = async (f) => {
  const c = nonNeg((await cfpbYear(f))?.complaints);
  return { value: rate(c, await population(f.entityType, f.entityId, Number(f.period))), n: c };
};
const sentinel = (f) => record("ftc_sentinel_states", `${f.entityId}-${f.period}`, "id,item");
R.ftc_sentinel_fraud_other_reports = async (f) => ({
  value: nonNeg((await sentinel(f))?.item?.metrics?.fraud_other_reports),
});
R.ftc_sentinel_identity_theft_reports = async (f) => ({
  value: nonNeg((await sentinel(f))?.item?.metrics?.identity_theft_reports),
});
R.ftc_sentinel_fraud_other_per_100k = async (f) => {
  const c = nonNeg((await sentinel(f))?.item?.metrics?.fraud_other_reports);
  return { value: rate(c, await population("state", f.entityId, Number(f.period))), n: c };
};
R.ftc_sentinel_reports = async (f) => ({
  value: nonNeg(
    (await record("ftc_sentinel_national", `US-${f.period}`, "id,item"))?.item?.reports?.total,
  ),
});
const dnc = (f) => record("ftc_dnc_states", `${f.entityId}-${f.period}`, "id,item");
R.ftc_dnc_complaints = async (f) => ({ value: nonNeg((await dnc(f))?.item?.metrics?.complaints) });
R.ftc_dnc_complaints_per_100k = async (f) => {
  const c = nonNeg((await dnc(f))?.item?.metrics?.complaints);
  return { value: rate(c, await population("state", f.entityId, yearOf(f.period))), n: c };
};

// ------------------------------------------------------------------------------------------------ sampling and comparison
// metric families as in the SQL registry (insights.metrics.family; the catalog RPC does not carry it)
const FAMILY_PREFIXES = [
  ["places", /^(pop_|acs1_|acs5_|cbp_)/],
  ["courts_fjc", /^fjc_(civil|criminal)_/],
  ["courts_tables", /^usc_/],
  ["judiciary", /^(judicial_vacancies|fjc_sitting_judges)$/],
  ["mdl", /^(mdl_|jpml_|scac_)/],
  ["caselaw", /^caselaw_/],
  [
    "enforcement",
    /^(doj_|sec_(litigation|administrative)|ftc_enforcement|frb_|epa_|osha_|leie_|oversight_)/,
  ],
  ["safety", /^(cpsc_|nhtsa_|fsis_|fda_|faers_|maude_|caers_|neiss_|saferproducts_)/],
  ["companies", /^(sec_revenue|sec_net_income|open_payments_)/],
  ["government", /^(fr_|cfr_|congress_|public_laws_|state_bills_)/],
  ["consumer", /^(cfpb_|ftc_sentinel_|ftc_dnc_)/],
];
const familyOf = (id) => FAMILY_PREFIXES.find(([, re]) => re.test(id))?.[0] ?? "other";
const same = (a, b) =>
  a === null || a === undefined
    ? b === null || b === undefined
    : b !== null && b !== undefined && Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a));

function evenly(list, k) {
  if (list.length <= k) return list;
  return Array.from(
    { length: k },
    (_, i) => list[Math.round((i * (list.length - 1)) / Math.max(1, k - 1))],
  );
}

async function main() {
  const catalog = await rpc("insights_catalog_v1", {});
  if (!Array.isArray(catalog) || !catalog.length)
    throw new Error(
      "insights_catalog_v1 returned no metrics: apply the SQL and run refresh_all first",
    );
  const families = new Map();
  for (const m of catalog) {
    const key = familyOf(m.id);
    if (!families.has(key)) families.set(key, []);
    families.get(key).push(m);
  }
  const results = [];
  const mismatches = [];
  const skipped = [];
  for (const [family, metrics] of families) {
    const perMetric = Math.max(2, Math.ceil(PER_FAMILY / metrics.length));
    for (const m of metrics) {
      const recompute = R[m.id];
      if (!recompute) {
        skipped.push({ metric: m.id, reason: "no independent recomputation implemented" });
        continue;
      }
      const facts = [];
      for (const type of m.entity_types) {
        const latest = await rpc("insights_latest_v1", { p_metric: m.id, p_entity_type: type });
        facts.push(
          ...evenly(
            latest.sort((a, b) => a.entity_id.localeCompare(b.entity_id)),
            Math.ceil(perMetric / m.entity_types.length),
          ),
        );
        // one full series of the first sampled entity, to include partial and not-recorded periods
        if (latest[0]) {
          const series = await rpc("insights_series_v1", {
            p_metric: m.id,
            p_entity_type: type,
            p_entity_ids: [latest[0].entity_id],
            p_from: null,
            p_to: null,
          });
          facts.push(...series.filter((x) => x.partial || x.value === null).slice(0, 2));
        }
      }
      for (const raw of facts) {
        const f = {
          metricId: raw.metric_id,
          entityType: raw.entity_type,
          entityId: raw.entity_id,
          period: raw.period,
          value: raw.value,
          n: raw.n,
          moe: raw.moe,
          partial: raw.partial,
        };
        let got;
        try {
          got = await recompute(f);
        } catch (e) {
          got = { error: e instanceof Error ? e.message : String(e) };
        }
        if (got.skip) {
          skipped.push({ metric: m.id, reason: got.skip });
          continue;
        }
        const problems = [];
        if (got.error) problems.push(`recompute failed: ${got.error}`);
        else {
          if (!same(got.value, f.value))
            problems.push(`value ${f.value} vs recomputed ${got.value}`);
          if ("moe" in got && !same(got.moe, f.moe)) problems.push(`moe ${f.moe} vs ${got.moe}`);
          if ("n" in got && got.n !== undefined && !same(got.n, f.n))
            problems.push(`n ${f.n} vs ${got.n}`);
          if ("partial" in got && got.partial !== undefined && got.partial !== f.partial)
            problems.push(`partial ${f.partial} vs ${got.partial}`);
        }
        const row = {
          family,
          ...f,
          recomputed: got.value ?? null,
          ok: problems.length === 0,
          problems,
        };
        results.push(row);
        if (problems.length) {
          mismatches.push(row);
          console.log(
            `MISMATCH ${f.metricId} ${f.entityType}:${f.entityId} ${f.period}: ${problems.join("; ")}`,
          );
        }
      }
    }
  }
  const byTopic = {};
  for (const r of results) {
    byTopic[r.family] ??= { checked: 0, mismatches: 0 };
    byTopic[r.family].checked += 1;
    if (!r.ok) byTopic[r.family].mismatches += 1;
  }
  const summary = {
    metrics: catalog.length,
    facts_in_layer: catalog.reduce((s, m) => s + (m.coverage?.facts ?? 0), 0),
    checked: results.length,
    mismatches: mismatches.length,
    by_family: byTopic,
    skipped: [...new Map(skipped.map((s) => [`${s.metric}|${s.reason}`, s])).values()],
    requests,
    caselaw_sql_cross_check:
      "select f.entity_id, f.period, f.value, (select count(*) from caselaw.cases c where c.court_id = f.entity_id and not c.date_approx and extract(year from c.date_filed) = f.period::int) as recount from insights.facts f where f.metric_id = 'caselaw_opinion_clusters' and f.entity_type = 'court' order by f.entity_id, f.period limit 20;",
  };
  console.log(JSON.stringify(summary, null, 2));
  if (JSON_OUT) await fs.writeFile(JSON_OUT, JSON.stringify({ summary, results }, null, 2));
  process.exit(mismatches.length ? 1 : 0);
}

// --probe metric:type:id:period[,...] recomputes the given facts only (no insights RPC needed), to check the REST
// recomputation against hand-run SQL before the layer is installed.
async function probe(spec) {
  for (const item of spec.split(",")) {
    const [metricId, entityType, entityId, period] = item.split("|");
    const recompute = R[metricId];
    if (!recompute) {
      console.log(`${item}: no recomputation`);
      continue;
    }
    const got = await recompute({ metricId, entityType, entityId, period });
    console.log(`${metricId} ${entityType}:${entityId} ${period} -> ${JSON.stringify(got)}`);
  }
  console.log(`requests: ${requests}`);
}

const probeSpec = opt("--probe", null);
(probeSpec ? probe(probeSpec) : main()).catch((e) => {
  console.error(`verify_insights failed: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(2);
});
