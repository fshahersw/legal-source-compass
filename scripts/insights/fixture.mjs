// Synthetic corpus fixture for the insights contract tests. Item shapes copy real corpus records (read-only SQL against
// the corpus, 2026-10-23); every value here is synthetic. No credentials, network or live corpus access.

const rec = (dataset, id, { title = id, state = "", source_url = null, item = {}, detail = {}, filters = {} } = {}) => ({
  dataset,
  id,
  title,
  state,
  source_url,
  item,
  detail,
  filters,
});

const ust = (court, table, periods, data, extra = {}) => ({
  ust: {
    v: 1,
    scope: extra.scope ?? "district",
    court,
    table: table.toUpperCase(),
    tableKey: table,
    title: `Synthetic table ${table}`,
    periods: periods.map(([end, months], i) => ({ end, months, pub: "JB", src: i })),
    cols: Object.keys(data).map((k) => ({ k, label: k, unit: "count" })),
    data,
    dash: extra.dash ?? {},
    nat: extra.nat ?? {},
    natDash: extra.natDash ?? {},
    circuitId: extra.circuitId ?? null,
    src: periods.map(([end]) => ({ end, pub: "JB", url: "https://www.uscourts.gov/data-news/data-tables", fmt: "xlsx" })),
  },
});

export const DATASETS = [
  { id: "judge_profiles_fjc", metadata: { summary: { as_of: "2026-10-19" } } },
  { id: "epa_echo_case_series", metadata: { summary: { latest_complete_fy: "2025", file_date: "2026-10-17" } } },
  {
    id: "state_bills",
    metadata: { summary: { dump: { last_modified: "Thu, 01 Oct 2026 01:54:34 GMT", retrieved_at: "2026-10-23T02:18:15Z" } } },
  },
  { id: "doj_press_releases_2024", metadata: {} },
  { id: "doj_press_releases_2025", metadata: {} },
];

const census = (level, usps, geoid, name, series, years) => ({
  id: geoid,
  kind: "census_acs",
  census: { kind: "census_acs", level, usps, geoid, name, years, series, latest: {}, period: "2024" },
});

export const RECORDS = [
  // ---------------------------------------------------------------------------------------------- Census
  rec("census_pop_estimates", "US", {
    title: "United States",
    item: {
      census: {
        kind: "census_pep",
        level: "us",
        usps: "",
        geoid: "US",
        series: {
          v2019: { pop: { 2018: 1000000, 2019: 1001000 }, base: { 2010: 999000 } },
          v2025: { pop: { 2020: 1002000, 2021: 1003000, 2024: 1010000, 2025: 1012000 }, base: { 2020: 1001500 } },
        },
      },
    },
  }),
  rec("census_pop_estimates", "06", {
    title: "California",
    state: "CA",
    item: {
      census: {
        kind: "census_pep",
        level: "state",
        usps: "CA",
        geoid: "06",
        series: {
          v2019: { pop: { 2019: 400000 } },
          v2025: { pop: { 2020: 400100, 2021: 400200, 2022: 400300, 2023: 400400, 2024: 400500, 2025: 400600 } },
        },
      },
    },
  }),
  rec("census_pop_estimates", "36", {
    title: "New York",
    state: "NY",
    item: { census: { kind: "census_pep", level: "state", usps: "NY", geoid: "36", series: { v2025: { pop: { 2024: 200000, 2025: 200100 } } } } },
  }),
  rec("census_pop_estimates", "06037", {
    title: "Los Angeles County, California",
    state: "CA",
    item: { census: { kind: "census_pep", level: "county", usps: "CA", geoid: "06037", series: { v2025: { pop: { 2024: 100000 } } } } },
  }),
  rec("census_pop_estimates", "06001", {
    title: "Alameda County, California",
    state: "CA",
    item: { census: { kind: "census_pep", level: "county", usps: "CA", geoid: "06001", series: { v2025: { pop: { 2024: "n/a" } } } } },
  }),
  rec("counties", "06037", { title: "Los Angeles County" }),
  rec("census_acs1_states", "US", {
    title: "United States",
    item: census("us", "", "US", "United States", { median_hh_income: { 2019: [65712, 118], 2021: [69717, 134] } }, [2019, 2021]),
  }),
  rec("census_acs1_states", "06", {
    title: "California",
    state: "CA",
    item: census(
      "state",
      "CA",
      "06",
      "California",
      {
        median_hh_income: { 2019: [80440, 313], 2021: [84907, 542] },
        uninsured: { 2019: [7.698, 0.095], 2021: [null, null, "-666666666"] },
        poverty_rate: { 2019: [11.8, 0.2], 2021: [12.3, 0.2] },
        bachelors_plus: { 2021: [36.2, 0.3] },
        unemployment_rate: { 2021: [7.1, 0.1] },
        median_home_value: { 2021: [648100, 1900] },
        pop: { 2019: [39512223, null, "c"] },
      },
      [2019, 2021],
    ),
  }),
  rec("census_acs_counties", "06037", {
    title: "Los Angeles County, California",
    state: "CA",
    item: census(
      "county",
      "CA",
      "06037",
      "Los Angeles County, California",
      { median_hh_income: { 2023: [87760, 463], 2024: [90112, 392] }, poverty_rate: { 2024: [13.736, 0.18] } },
      [2023, 2024],
    ),
  }),
  rec("census_cbp_states", "US", {
    title: "United States",
    item: {
      census: {
        kind: "census_cbp",
        level: "us",
        usps: "",
        geoid: "US",
        name: "United States",
        years: [2022, 2023],
        latest_year: 2023,
        series: { "00": { 2022: [8000000, 130000000, 9000000000], 2023: [8100000, 131000000, 9500000000] } },
      },
    },
  }),
  rec("census_cbp_states", "06", {
    title: "California",
    state: "CA",
    item: {
      census: {
        kind: "census_cbp",
        level: "state",
        usps: "CA",
        geoid: "06",
        name: "California",
        years: [2022, 2023],
        latest_year: 2023,
        series: {
          "00": { 2022: [1023181, null, 1361755461, { emp: "D" }], 2023: [1029689, 16405436, 1429217482] },
          11: { 2023: [2033, 27780, 1643350] },
        },
      },
    },
  }),
  rec("census_cbp_counties", "06037", {
    title: "Los Angeles County, California",
    state: "CA",
    item: {
      census: {
        kind: "census_cbp",
        level: "county",
        usps: "CA",
        geoid: "06037",
        name: "Los Angeles County, California",
        years: [2023],
        latest_year: 2023,
        series: { "00": { 2023: [250000, 4000000, null, { pay: "S" }] } },
      },
    },
  }),

  // ---------------------------------------------------------------------------------------------- courts
  ...[
    ["cand", "District Court, N.D. California", "CA", "FD"],
    ["nysd", "District Court, S.D. New York", "NY", "FD"],
    ["canb", "United States Bankruptcy Court, N.D. California", "CA", "FB"],
    ["cal", "California Supreme Court", "CA", "S"],
    ["scotus", "Supreme Court of the United States", "", "F"],
    ["ca9", "Court of Appeals for the Ninth Circuit", "", "F"],
    ["ca2", "Court of Appeals for the Second Circuit", "", "F"],
  ].map(([id, title, state, type]) =>
    rec("court_spine", id, { title, state, item: { id, cells: { court: title } }, filters: { type: [type], state: state ? [state] : [] } }),
  ),
  rec("fjc_civil_national", "US:summary", {
    title: "United States",
    item: {
      profile: {
        latest_fy: 2025,
        partial_fy: 2026,
        series: [
          { fy: 2024, filings: 291016, terminations: 396635, pending_end: 536358, median_days: 364, partial: false },
          { fy: 2026, filings: 276610, terminations: 229735, pending_end: 479410, median_days: 148, partial: true },
        ],
      },
    },
  }),
  rec("fjc_civil_states", "CA", {
    state: "CA",
    item: {
      profile: {
        state: "CA",
        series: [
          { fy: 2024, filings: 40000, terminations: 41000, pending_end: 50000, median_days: 300, partial: false },
          { fy: 2024, filings: 99999, terminations: 1, pending_end: 1, median_days: 1, partial: false },
          { fy: 2025, filings: 40100, terminations: 41100, pending_end: 49000, median_days: 310, partial: false },
        ],
      },
    },
  }),
  rec("fjc_civil_states", "GU", {
    state: "GU",
    item: { profile: { state: "GU", series: [{ fy: 2024, filings: 100, terminations: 90, pending_end: 80, median_days: 200, partial: false }] } },
  }),
  rec("fjc_civil_districts", "cand", {
    state: "CA",
    item: {
      profile: {
        name: "District Court, N.D. California",
        series: [{ fy: 2024, filings: 8353, terminations: 9000, pending_end: 7000, median_days: null, partial: false }],
      },
    },
    filters: { circuit: ["ca9"] },
  }),
  rec("fjc_criminal_districts", "national", {
    item: { series: [{ fy: 2025, filed: 79129, terminated: 82135, pending: 109022, partial: false }] },
  }),
  rec("fjc_criminal_districts", "district:cand", {
    item: { court_id: "cand", series: [{ fy: 2026, filed: 508, terminated: 308, pending: 1247, partial: true }] },
  }),
  rec("uscourts_tables_district", "cand:c", {
    item: ust(
      "cand",
      "c",
      [
        ["2024-09-30", 12],
        ["2025-03-31", 12],
      ],
      { "filed/y0": [8341, 8500], "terminated/y0": [9000, null], "pending/y0": [7000, 7100] },
      {
        dash: { "terminated/y0": [1] },
        nat: { "filed/y0": [291016, 300000], "terminated/y0": [396635, 380000], "pending/y0": [536358, 520000] },
        circuitId: "ca9",
      },
    ),
  }),
  rec("uscourts_tables_district", "nysd:c", {
    item: ust(
      "nysd",
      "c",
      [
        ["2024-09-30", 12],
        ["2025-03-31", 12],
      ],
      { "filed/y0": [12000, 12100], "terminated/y0": [11000, 11100], "pending/y0": [15000, 15100] },
      { nat: { "filed/y0": [291016, 300001], "terminated/y0": [396635, 380000], "pending/y0": [536358, 520000] }, circuitId: "ca2" },
    ),
  }),
  rec("uscourts_tables_district", "latest:c", { item: { ust: { v: 1, scope: "district", court: null, periods: [], cols: [], data: {} } } }),
  rec("uscourts_tables_district", "cand:c-5", {
    item: ust(
      "cand",
      "c-5",
      [["2024-09-30", 12]],
      { "total_cases/number_of_cases": [9000], "total_cases/median_time_interval_in_months": [10.1] },
      { nat: { "total_cases/number_of_cases": [300000], "total_cases/median_time_interval_in_months": [8.3] } },
    ),
  }),
  rec("uscourts_tables_district", "cand:c-6", {
    item: ust(
      "cand",
      "c-6",
      [["2025-09-30", 0]],
      {
        total: [7000],
        "length_of_time_pending/3_years_or_more/number": [1113],
        "length_of_time_pending/3_years_or_more/percent": [15.9],
      },
      {
        nat: {
          "length_of_time_pending/3_years_or_more/number": [90000],
          "length_of_time_pending/3_years_or_more/percent": [16.8],
        },
      },
    ),
  }),
  rec("uscourts_tables_district", "cand:x-1a", {
    item: ust(
      "cand",
      "x-1a",
      [["2025-09-30", 12]],
      { judgeships: [14], "weighted_filings_per_judgeship/total": [650] },
      { nat: { judgeships: [677], "weighted_filings_per_judgeship/total": [523] } },
    ),
  }),
  rec("uscourts_tables_district", "cand:c-11", {
    item: ust("cand", "c-11", [["2025-09-30", 12]], { ym1_total: [1945], y0_total: [3311] }, { nat: { y0_total: [45713] } }),
  }),
  rec("uscourts_tables_circuit", "ca9:c", {
    item: ust("ca9", "c", [["2024-09-30", 12]], { "filed/y0": [40000], "terminated/y0": [41000], "pending/y0": [52000] }, { scope: "circuit" }),
  }),
  rec("uscourts_tables_circuit", "ca9:b", {
    item: ust(
      "ca9",
      "b",
      [["2024-09-30", 12]],
      { "filed/y0": [10000], "terminated/y0": [9800], "pending/y0": [8000] },
      { scope: "appeals", nat: { "filed/y0": [39987], "terminated/y0": [41000], "pending/y0": [33000] } },
    ),
  }),
  rec("uscourts_tables_circuit", "ca2:b", {
    item: ust(
      "ca2",
      "b",
      [["2024-09-30", 12]],
      { "filed/y0": [4000], "terminated/y0": [4100], "pending/y0": [3000] },
      { scope: "appeals", nat: { "filed/y0": [39987], "terminated/y0": [41000], "pending/y0": [33000] } },
    ),
  }),
  rec("uscourts_tables_bankruptcy", "cand:f", {
    item: ust("cand", "f", [["2025-06-30", 12]], { "filed/y0": [6763] }, { scope: "bankruptcy", nat: { "filed/y0": [500000] } }),
  }),
  rec("uscourts_tables_bankruptcy", "arcomb:f", {
    item: ust("arcomb", "f", [["2025-06-30", 12]], { "filed/y0": [5000] }, { scope: "bankruptcy", nat: { "filed/y0": [500000] } }),
  }),
  rec("judicial_vacancies", "national", {
    item: {
      series: [
        { month: "2026-08", reports: { vacancies: "parsed" }, vacancies_listed: 45 },
        { month: "2026-09", reports: { vacancies: "unread" }, vacancies_listed: null },
      ],
    },
  }),
  rec("judge_profiles_fjc", "13761857", {
    title: "Adam Ben Abelson",
    filters: { court: ["cand"], courts_served: ["cand"], sitting: ["yes"], judge_profile: ["abc123"], cl_person: ["2955"] },
  }),
  rec("judge_profiles_fjc", "1002", {
    title: "Synthetic Judge Two",
    filters: { court: ["nysd"], courts_served: ["cand", "nysd"], sitting: ["yes"], judge_profile: ["missing1"], cl_person: ["10140"] },
  }),
  rec("judge_profiles_fjc", "1000", {
    title: "Synthetic Judge Retired",
    filters: { court: ["nysd"], courts_served: ["nysd"], sitting: ["no"], cl_person: [] },
  }),
  rec("judges", "abc123", { title: "Adam Ben Abelson" }),

  // ---------------------------------------------------------------------------------------------- litigation
  rec("mdls", "2738", {
    item: {
      id: "mdl:2738",
      title: "IN RE: Synthetic Talc Products Liability Litigation",
      status: "pending",
      as_of: "2026-10-01",
      cl_court_id: "cand",
      actions_pending: 69340,
    },
    filters: { cl_person_id: "2955" },
  }),
  rec("mdls", "2846", {
    item: { title: "IN RE: Synthetic Mesh Litigation", status: "pending", as_of: "2026-10-01", cl_court_id: "cand", actions_pending: 23324 },
    filters: { cl_person_id: "999" },
  }),
  rec("mdls", "3001", {
    item: { title: "IN RE: Synthetic Unplaced Litigation", status: "pending", as_of: "2026-10-01", cl_court_id: null, actions_pending: 10 },
  }),
  rec("mdls", "1000", {
    item: { title: "IN RE: Synthetic Closed Litigation", status: "terminated", as_of: "2026-10-01", cl_court_id: "nysd", actions_pending: 0 },
  }),
  rec("jpml_pending_history_mdls", "2738", {
    item: {
      history: {
        title: "IN RE: Synthetic Talc Products Liability Litigation",
        series: [
          { month: "2026-09", report_date: "2026-09-01", pending: 69000, total: 71000 },
          { month: "2026-10", report_date: "2026-10-01", pending: 69340, total: 72024 },
        ],
      },
    },
    filters: { court: ["cand"] },
  }),
  rec("jpml_pending_history_mdls", "2846", {
    item: {
      history: {
        title: "IN RE: Synthetic Mesh Litigation",
        series: [
          { month: "2026-09", report_date: "2026-09-01", pending: null, total: 29000 },
          { month: "2026-10", report_date: "2026-10-01", pending: 23324, total: 30000 },
        ],
      },
    },
    filters: { court: ["cand"] },
  }),
  rec("jpml_statistics_extra", "summary:overview", {
    item: {
      overview: {
        series: [
          { fy: 1992, pending: 1000, period_months: 15 },
          { fy: 2025, pending: 197118, period_months: 12 },
        ],
      },
    },
  }),
  rec("mdl_intel_jpml_stats", "year:2024", { item: { stats: { year: 2024, motions_granted: 24, printed: { motions_granted: "24" } } } }),
  rec("scac_statistics", "year:2024", { item: { cells: { kind: "year", year: 2024, filings: 225, partial: false } } }),
  rec("scac_statistics", "year:2025", { item: { cells: { kind: "year", year: 2025, filings: 129, partial: true } } }),

  // ---------------------------------------------------------------------------------------------- enforcement
  rec("doj_press_releases_2024", "a", { item: { release: { date: "2024-03-01" } }, filters: { state: ["CA"] } }),
  rec("doj_press_releases_2024", "b", { item: { release: { date: "2024-05-01" } }, filters: { state: [] } }),
  rec("doj_press_releases_2024", "c", { item: { release: { date: "2024-06-01" } }, filters: { state: ["AA"] } }),
  rec("doj_press_releases_2025", "d", { item: { release: { date: "2025-02-10" } }, filters: { state: ["CA"] } }),
  rec("sec_enforcement_actions", "lr-1", { item: { sec_action: { date: "2025-06-01" } }, filters: { type: ["litigation_release"], year: ["2025"] } }),
  rec("sec_enforcement_actions", "lr-2", { item: { sec_action: { date: "2025-01-01" } }, filters: { type: ["litigation_release"], year: ["2025"] } }),
  rec("sec_enforcement_actions", "ap-1", { item: { sec_action: { date: "2024-12-31" } }, filters: { type: ["administrative_proceeding"], year: ["2024"] } }),
  rec("ftc_enforcement_actions", "m-1", { item: { ftc_action: { date: "2024-04-04" } }, filters: { kind: ["merger"], year: ["2024"] } }),
  rec("ftc_enforcement_actions", "x-1", { item: { ftc_action: { date: "2024-04-05" } }, filters: { kind: ["other"], year: ["2024"] } }),
  rec("ftc_enforcement_actions", "p-1", { item: { ftc_action: { date: "2025-01-05" } }, filters: { kind: ["bcp_penalty"], year: ["2025"] } }),
  rec("frb_enforcement_actions", "summary:overview", { item: { overview: { actions: 2 } }, filters: { kind: ["summary"] } }),
  rec("frb_enforcement_actions", "frb:1", { item: { cells: { effective: "2026-10-08" }, frb_action: { year: "2026" } }, filters: { year: ["2026"] } }),
  rec("frb_enforcement_actions", "frb:2", { item: { cells: { effective: "2025-03-01" }, frb_action: { year: "2025" } }, filters: { year: ["2025"] } }),
  rec("epa_echo_case_series", "epa-echo-series:US:2024", { item: { cells: { fy: 2024, opened: 3148, fed_penalty: 1721297229.76 } } }),
  rec("epa_echo_case_series", "epa-echo-series:US:2026", { item: { cells: { fy: 2026, opened: 1000, fed_penalty: 5 } } }),
  rec("epa_echo_case_series", "epa-echo-series:state:CA:2024", { item: { cells: { fy: 2024, opened: 329, fed_penalty: 30234990.46 } } }),
  rec("epa_echo_case_series", "epa-echo-series:state:XX:2024", { item: { cells: { fy: 2024, opened: 7, fed_penalty: 1 } } }),
  rec("epa_echo_case_series", "epa-echo-series:US:all", { item: { cells: { fy: "all", opened: 9 } } }),
  rec("osha_inspections_states", "osha-state:CA", {
    item: {
      profile: {
        code: "CA",
        latest_complete_fy: 2025,
        years: [
          { fy: 2025, inspections: 7492, current_penalty: 37915766.06 },
          { fy: 2026, inspections: 8712, current_penalty: 22395894.77 },
        ],
      },
    },
  }),
  rec("osha_inspections_states", "osha-state:OTHER", { item: { profile: { years: [{ fy: 2025, inspections: 3 }] } } }),
  rec("osha_inspections_national", "osha-national:FY2025", { item: { year: { fy: 2025, inspections: 74123, current_penalty: 1000 } } }),
  rec("oig_leie_exclusions", "leie:1", { item: { cells: { excluded: "2020-03-19", state: "CA" } } }),
  rec("oig_leie_exclusions", "leie:2", { item: { cells: { excluded: "2020-05-01", state: "CA" } } }),
  rec("oig_leie_exclusions", "leie:3", { item: { cells: { excluded: "2021-01-01", state: "NY" } } }),
  rec("oig_leie_exclusions", "leie:4", { item: { cells: { excluded: "2021-02-02", state: "" } } }),
  rec("oversight_trends", "national", {
    item: {
      cells: { last: "2026-10-22" },
      trend: { name: "All Offices of Inspector General", years: [{ year: 2025, reports: 3000 }, { year: 2026, reports: 2000 }] },
    },
  }),
  rec("oversight_trends", "oig:americorps-office-inspector-general", {
    item: { trend: { name: "AmeriCorps Office of Inspector General", as_of: "2026-10-22", years: [{ year: 2025, reports: 12 }] } },
  }),

  // ---------------------------------------------------------------------------------------------- safety
  rec("regulatory_cpsc_aggregates", "cpsc-agg:overview", { item: { agg: { kind: "overview" } } }),
  rec("regulatory_cpsc_aggregates", "cpsc-agg:year:2024", { item: { agg: { kind: "year", year: 2024, recalls: 305, partial: false } } }),
  rec("regulatory_cpsc_aggregates", "cpsc-agg:year:2026", { item: { agg: { kind: "year", year: 2026, recalls: 485, partial: true } } }),
  rec("agency_safety_nhtsa_recalls", "n1", { item: { kind: "recall" }, filters: { date: "2025-03-01", year: ["2025"] } }),
  rec("agency_safety_nhtsa_recalls", "n2", { item: { kind: "recall" }, filters: { date: "2025-11-30", year: ["2025"] } }),
  rec("agency_safety_nhtsa_recalls", "n3", { item: { kind: "recall" }, filters: { date: "2026-01-15", year: ["2026"] } }),
  rec("fsis_recalls", "f1", { item: { cells: { date: "2025-01-01", kind: "Recall", class: "I" } } }),
  rec("fsis_recalls", "f2", { item: { cells: { date: "2025-02-01", kind: "Recall", class: "II" } } }),
  rec("fsis_recalls", "f3", { item: { cells: { date: "2025-03-01", kind: "Public health alert", class: "PHA" } } }),
  rec("fsis_recalls", "f4", { item: { cells: { date: "2026-10-17", kind: "Recall", class: "III" } } }),
  rec("agency_safety_openfda_drug_enforcement", "d1", { filters: { report_date: "2025-05-05" } }),
  rec("agency_safety_openfda_drug_enforcement", "d2", { filters: { report_date: "2025-06-06" } }),
  rec("agency_safety_openfda_device_enforcement", "v1", { filters: { report_date: "2024-01-01" } }),
  rec("fda_faers_national_series", "all_years", {
    item: {
      data_through: "2026-06-30",
      series: [
        { year: 2025, reports: 1000, partial: false },
        { year: 2026, reports: 500, partial: true },
      ],
    },
  }),
  rec("fda_faers_product_series", "1871", {
    source_url: "https://api.fda.gov/drug/event.json?search=patient.drug.medicinalproduct:%22AVANDIA%22&count=receivedate",
    item: { product: "Rosiglitazone (Avandia)", mdl: 1871, series: [{ year: 2024, reports: 2082, partial: false }] },
  }),
  rec("fda_device_event_series", "national", { item: { series: [{ year: 2024, reports: 3000, death: 1, injury: 2, malfunction: 3 }] } }),
  rec("fda_device_event_series", "2197", {
    source_url: "https://api.fda.gov/device/event.json?search=device.brand_name:%22ASR%22&count=date_received",
    item: { product: "DePuy ASR hip implant", series: [{ year: 2024, reports: 10 }] },
  }),
  rec("fda_caers_series", "year-2025", { item: { kind: "caers_year", point: { year: 2025, reports: 6308, partial: false } } }),
  rec("fda_caers_series", "all_years", { item: { kind: "caers_total", total: 9 } }),
  rec("neiss_national_years", "2025", {
    item: { cells: { year: 2025, cases: 410201, estimate: 16485413, ci_low: 13919499, ci_high: 19051327 } },
  }),
  rec("neiss_national_years", "series", { item: { cells: { year: "1997-2025", estimate: 1 } } }),
  rec("saferproducts_reports_series", "sp-pub-2011", { item: { cells: { period: "2011 (partial)", reports: 4540 } } }),
  rec("saferproducts_reports_series", "sp-pub-2012", { item: { cells: { period: "2012", reports: 5000 } } }),

  // ---------------------------------------------------------------------------------------------- companies
  rec("company_sec_profiles", "0000001800", { title: "ABBOTT LABORATORIES" }),
  rec("company_sec_financials", "0000001800", {
    title: "ABBOTT LABORATORIES — XBRL financial series",
    item: {
      name: "ABBOTT LABORATORIES",
      annual: {
        revenue: [{ fy: 2024, frame: "CY2024", start: "2024-01-01", end: "2024-12-31", unit: "USD", value: 41950000000 }],
        net_income: [
          { fy: 2024, frame: "CY2024", start: "2024-01-01", end: "2024-12-31", unit: "USD", value: 13400000000 },
          { fy: 2023, frame: "CY2023", start: "2023-01-01", end: "2023-12-31", unit: "USD", value: 5000 },
          { fy: 2023, frame: "CY2023", start: "2023-01-01", end: "2023-12-31", unit: "USD", value: 5001 },
        ],
      },
    },
  }),
  rec("company_payments_manufacturers", "op-100000000286", {
    title: "PFIZER INC.",
    item: {
      payments: {
        years: [{ year: 2017, general: 47273365.94, research: 455309857.98, generalRecords: 588507, researchRecords: 47566 }],
      },
    },
  }),

  // ---------------------------------------------------------------------------------------------- law and government
  rec("fr_agency_profiles", "538", { title: "Synthetic Department", filters: { parent: [] } }),
  rec("fr_agency_profiles", "54", { title: "Synthetic Agency", filters: { parent: ["538"] } }),
  rec("fr_agency_trends", "federal-register", {
    item: { trends: { asOf: "2026-10-19", yearly: { ALL: { 2025: 30000, 2026: 25000 }, RULE: { 2025: 3000 }, PRORULE: { 2025: 2000 } } } },
  }),
  rec("fr_agency_trends", "54", { item: { trends: { asOf: "2026-10-19", yearly: { ALL: { 2025: 12 }, RULE: {}, PRORULE: { 2025: 1 } } } } }),
  rec("ecfr_section_versions", "cfr:1:10.10", {
    item: { cells: { title_number: "1" } },
    detail: {
      versions: [
        { date: "2015-12-18", substantive: true },
        { date: "2022-12-29", substantive: true },
        { date: "2022-06-01", substantive: false },
      ],
    },
  }),
  rec("ecfr_section_versions", "cfr:40:1.1", {
    item: { cells: { title_number: "40" } },
    detail: {
      versions: [
        { date: "2017-02-01", substantive: true },
        { date: "2026-09-01", substantive: true },
      ],
    },
  }),
  rec("congress_bills", "119-hr-1", { item: { cells: { introduced: "2025-03-05" } }, filters: { type: ["hr"] } }),
  rec("congress_bills", "119-s-1", { item: { cells: { introduced: "2025-04-01" } }, filters: { type: ["s"] } }),
  rec("congress_bills", "119-hres-1", { item: { cells: { introduced: "2025-05-01" } }, filters: { type: ["hres"] } }),
  rec("congress_bills", "119-hjres-1", { item: { cells: { introduced: "2026-01-10" } }, filters: { type: ["hjres"] } }),
  rec("public_laws_enacted", "stat-139-1", { item: { cells: { enacted: "2025-06-12" } }, filters: { kind: ["Public law"] } }),
  rec("public_laws_enacted", "stat-64-1", { item: { cells: { enacted: "1950-06-12" } }, filters: { kind: ["Public act (chapter)"] } }),
  rec("state_bills", "ca-1", { state: "CA", filters: { state: ["CA"], session_role: ["current"] } }),
  rec("state_bills", "ca-2", { state: "CA", filters: { state: ["CA"], session_role: ["current"] } }),
  rec("state_bills", "ca-3", { state: "CA", filters: { state: ["CA"], session_role: ["preceding"] } }),
  rec("state_bills", "ny-1", { state: "NY", filters: { state: ["NY"], session_role: ["current"] } }),

  // ---------------------------------------------------------------------------------------------- consumer
  rec("cfpb_complaints_states", "cfpb-state:CA", {
    item: {
      state_profile: {
        code: "CA",
        years: [
          { year: "2024", complaints: 12345, complete: true },
          { year: "2026", complaints: 529804, complete: false },
        ],
      },
    },
  }),
  rec("cfpb_complaints_states", "cfpb-state:AA", { item: { state_profile: { years: [{ year: "2024", complaints: 5, complete: true }] } } }),
  rec("cfpb_complaints_states", "cfpb-states:analytics", { item: { rankings: {} } }),
  rec("cfpb_complaints_national", "cfpb-national:all", {
    item: { national: { years: [{ year: "2024", complaints: 2000000, complete: true }] } },
  }),
  rec("ftc_sentinel_states", "CA-2024", { state: "CA", item: { metrics: { fraud_other_reports: 506727, identity_theft_reports: 139665 } } }),
  rec("ftc_sentinel_national", "US-2024", { item: { reports: { total: 6471708, fraud: 2600678 } } }),
  rec("ftc_sentinel_national", "US-series", { item: { cells: { year: "2001-2024" } } }),
  rec("ftc_dnc_states", "CA-FY2025", { state: "CA", item: { metrics: { complaints: 304497, registrations: 28923788 } } }),
  rec("ftc_dnc_states", "CA-FY2026", { state: "CA", item: { metrics: { complaints: 1000 } } }),
];

/** Caselaw clusters: [cluster_id, court_id, date_filed, date_approx, cited_by]. */
export const CASES = [
  [1, "cand", "2024-05-01", false, 10],
  [2, "cand", "2024-07-01", false, 5],
  [3, "cand", "2026-03-01", false, 0],
  [4, "cal", "2024-01-02", true, 99],
  [5, "cal", "2025-12-31", false, 7],
];
