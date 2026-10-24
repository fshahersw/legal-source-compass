/**
 * Pure helpers for the Sources directory: dataset categories (by exact id and id prefix, never by guessing from content),
 * the in-app pages that read each dataset (traced from the code that queries it), official portals named in each dataset's
 * recorded source statement, and task workflows that link to existing pages.
 */

export type CategoryId =
  | "courts"
  | "judges"
  | "matters"
  | "firms"
  | "law"
  | "enforcement"
  | "safety"
  | "medical"
  | "companies"
  | "consumer"
  | "states"
  | "sources"
  | "other";

export type Category = { id: CategoryId; label: string; blurb: string };

export const CATEGORIES: readonly Category[] = [
  {
    id: "courts",
    label: "Courts & caseload",
    blurb:
      "Court directory, structure and addresses, federal caseload statistics and CourtListener collection measures.",
  },
  {
    id: "judges",
    label: "Judges",
    blurb:
      "Judge directory, FJC biographies, CourtListener people, crosswalks and bench analytics.",
  },
  {
    id: "matters",
    label: "MDLs, matters & dockets",
    blurb: "JPML MDLs, the matter registry, master dockets, docket documents and MDL analytics.",
  },
  {
    id: "firms",
    label: "Law firms & counsel",
    blurb: "Counsel on MDL master dockets, firm profiles, networks and the counsel directory.",
  },
  {
    id: "law",
    label: "Law & government",
    blurb:
      "eCFR and CFR text, the Federal Register, public laws, state codes, citations and limitation periods.",
  },
  {
    id: "enforcement",
    label: "Agencies, enforcement & settlements",
    blurb:
      "EPA, OSHA, DOJ, FTC, SEC and FDA enforcement, NPDB actions, official settlement pages, settlement notices and source catalogs.",
  },
  {
    id: "safety",
    label: "Product safety & recalls",
    blurb:
      "FDA, CPSC and NHTSA recalls and enforcement reports, SaferProducts reports, NEISS injury estimates and recall patterns.",
  },
  {
    id: "medical",
    label: "Drugs, devices & adverse events",
    blurb:
      "Drug and device approvals and classifications, shortages, FAERS, MAUDE and CAERS adverse-event series, malpractice payments.",
  },
  {
    id: "companies",
    label: "Companies, securities & payments",
    blurb:
      "SEC company intelligence for MDL defendants, securities class actions and Open Payments.",
  },
  {
    id: "consumer",
    label: "Consumer complaints & protection",
    blurb: "CFPB complaints and reports, FTC Consumer Sentinel, Do Not Call and refunds.",
  },
  {
    id: "states",
    label: "States, counties & metrics",
    blurb: "State metrics profiles, national series and the county directory.",
  },
  {
    id: "sources",
    label: "Source directories & captures",
    blurb:
      "The legal source directory, saved pages and documents, focused captures and coverage labels.",
  },
  { id: "other", label: "Other", blurb: "Datasets not yet assigned to a category." },
];

const EXPLICIT: Readonly<Record<string, CategoryId>> = {
  cl_people: "judges",
  clb_judge_dockets: "judges",
  clb_bench_cohorts: "judges",
  clb_disclosure_coverage: "judges",
  clb_judge_disclosures: "judges",
  court_cjra_judges: "judges",
  fjc_appeals_outcomes: "courts",
  fjc_criminal_districts: "courts",
  fjc_bankruptcy_districts: "courts",
  judicial_vacancies: "courts",
  judicial_nominations: "judges",
  judicial_confirmation_votes: "judges",
  cl_docket_metadata: "matters",
  fjc_civil_mdls: "matters",
  jpml_pending_history_mdls: "matters",
  jpml_pending_history_months: "matters",
  jpml_statistics_extra: "matters",
  jpml_pending_snapshots: "matters",
  jpml_mdl_pending_series: "matters",
  jpml_transferee_series: "matters",
  jpml_quarterly_caseload: "matters",
  jpml_series_index: "matters",
  expert_rulings: "matters",
  verdict_reports: "matters",
  state_proceedings: "matters",
  mdl_counsel: "firms",
  mdl_appearances: "firms",
  counsel_directory: "firms",
  jpml_html_reference: "law",
  regulatory_federal_register_activity: "law",
  provider_laws: "law",
  indiana_code: "law",
  sd_statutes: "law",
  public_laws: "law",
  us_code_titles: "law",
  us_code_sections: "law",
  us_code_release_points: "law",
  us_code_amendment_links: "law",
  public_laws_enacted: "law",
  state_codes: "law",
  limitation_periods: "law",
  statutory_limitations_review: "law",
  econ_state_judgment_rates: "law",
  census_acs_cvap_counties: "states",
  mass_tort_authority_evidence: "law",
  settlements: "enforcement",
  settlement_notices: "enforcement",
  settlement_claims_official: "enforcement",
  ftc_enforcement_actions: "enforcement",
  ftc_cases: "enforcement",
  ftc_hsr_early_terminations: "enforcement",
  ftc_hsr_filings: "enforcement",
  sec_broker_dealers: "enforcement",
  sec_investment_advisers: "enforcement",
  sec_adviser_statistics: "enforcement",
  frb_enforcement_actions: "enforcement",
  sec_enforcement_actions: "enforcement",
  sam_exclusions: "enforcement",
  congress_bills: "law",
  congress_members: "law",
  congress_committees: "law",
  ecfr_parallel_authorities: "law",
  ecfr_subject_index: "law",
  ecfr_agencies: "law",
  crs_reports: "law",
  state_bills: "law",
  oig_leie_exclusions: "enforcement",
  oversight_reports: "enforcement",
  oversight_trends: "enforcement",
  doj_oig_reports: "enforcement",
  osc_public_files: "enforcement",
  osc_publications: "enforcement",
  doj_cep_resolutions: "enforcement",
  doj_document_index: "enforcement",
  fsis_recalls: "safety",
  fsis_enforcement_quarterly: "enforcement",
  ussc_sentencing_districts: "courts",
  eousa_caseload_annual: "courts",
  enforcement_data_sources_catalog: "enforcement",
  agency_safety_fda_warning_letters: "enforcement",
  agency_safety_openfda_crl: "enforcement",
  npdb_adverse_actions: "enforcement",
  npdb_state_board_compliance: "enforcement",
  regulatory_cpsc_aggregates: "safety",
  recall_patterns: "safety",
  agency_safety_openfda_drugsfda: "medical",
  agency_safety_openfda_device_pma: "medical",
  agency_safety_openfda_drug_shortages: "medical",
  agency_science_documents: "medical",
  company_adverse_manufacturers: "medical",
  counties: "states",
  county_litigation: "courts",
  federal: "courts",
  uscourts_pages: "courts",
  sources: "sources",
  saved_pages: "sources",
  source_documents: "sources",
  large_text_assets: "sources",
  focused: "sources",
  seeger: "sources",
};

/** Ordered prefix rules after the explicit ids. */
const PREFIXES: readonly [string, CategoryId][] = [
  ["agency_safety_openfda_device_classification", "medical"],
  ["agency_safety_", "safety"],
  ["saferproducts_", "safety"],
  ["neiss_", "safety"],
  ["fda_", "medical"],
  ["npdb_malpractice", "medical"],
  ["courts_db", "courts"],
  ["court_", "courts"],
  ["gov_domains", "states"],
  ["uscourts_tables_", "courts"],
  ["clb_", "courts"],
  ["fcms_", "courts"],
  ["fjc_civil_", "courts"],
  ["judge", "judges"],
  ["firm_", "firms"],
  ["mdl", "matters"],
  ["sw_", "matters"],
  ["ecfr_", "law"],
  ["federal_regulations_", "law"],
  ["federal_register", "law"],
  ["citation_", "law"],
  ["regulatory_epa_", "enforcement"],
  ["epa_echo_", "enforcement"],
  ["osha_", "enforcement"],
  ["doj_atr_", "enforcement"],
  ["doj_press_releases", "enforcement"],
  ["company_", "companies"],
  ["scac_", "companies"],
  ["cfpb_", "consumer"],
  ["ftc_", "consumer"],
  ["state_metrics_", "states"],
  ["econ_", "states"],
  ["coverage_", "sources"],
];

export function categoryOf(datasetId: string): CategoryId {
  const explicit = EXPLICIT[datasetId];
  if (explicit) return explicit;
  for (const [prefix, id] of PREFIXES) if (datasetId.startsWith(prefix)) return id;
  return "other";
}

export function categoryLabel(id: CategoryId): string {
  return CATEGORIES.find((c) => c.id === id)?.label ?? "Other";
}

/** Pages a person can open. Literal paths so links stay type-checked against the route tree. */
export type AppPath =
  | "/"
  | "/courts"
  | "/courts/analytics"
  | "/courts/caseload"
  | "/courts/collection"
  | "/courts/firms"
  | "/courts/securities"
  | "/courts/vacancies"
  | "/judges"
  | "/judges/analytics"
  | "/matters"
  | "/matters/analytics"
  | "/matters/intel"
  | "/matters/cases"
  | "/matters/seeger-weiss"
  | "/law"
  | "/law/codes"
  | "/law/monitoring"
  | "/enforcement"
  | "/law/legislation"
  | "/agencies"
  | "/safety"
  | "/safety/signals"
  | "/companies"
  | "/companies/payments"
  | "/places/analytics"
  | "/limitations"
  | "/limitations/statutory"
  | "/law/calculators"
  | "/people"
  | "/insights/research"
  | "/search"
  | "/data"
  | "/sources/library"
  | "/sources/catalog"
  | "/sources/coverage"
  | "/saved-sources"
  | "/analytics";

export type AppLink = { to: AppPath; label: string };

const P = {
  courts: { to: "/courts", label: "Court pages" },
  courtAnalytics: { to: "/courts/analytics", label: "Court analytics" },
  caseload: { to: "/courts/caseload", label: "Caseload" },
  collection: { to: "/courts/collection", label: "Collection" },
  firms: { to: "/courts/firms", label: "Law firms" },
  securities: { to: "/courts/securities", label: "Securities suits" },
  vacancies: { to: "/courts/vacancies", label: "Judicial vacancies" },
  judges: { to: "/judges", label: "Judge pages" },
  judgeAnalytics: { to: "/judges/analytics", label: "Judge analytics" },
  matters: { to: "/matters", label: "Matters" },
  mdlAnalytics: { to: "/matters/analytics", label: "MDL analytics" },
  mdlIntel: { to: "/matters/intel", label: "MDL intelligence" },
  cases: { to: "/matters/cases", label: "Cases" },
  law: { to: "/law", label: "Law & government" },
  codes: { to: "/law/codes", label: "State codes" },
  enforcement: { to: "/enforcement", label: "Enforcement" },
  legislation: { to: "/law/legislation", label: "Legislation" },
  agencies: { to: "/agencies", label: "Agencies" },
  safety: { to: "/safety", label: "Products & safety" },
  signals: { to: "/safety/signals", label: "Safety signals" },
  companies: { to: "/companies", label: "Companies" },
  payments: { to: "/companies/payments", label: "Industry payments" },
  stateAnalytics: { to: "/places/analytics", label: "State analytics" },
  states: { to: "/", label: "State pages" },
  limitations: { to: "/limitations", label: "Time limits" },
  calculators: { to: "/law/calculators", label: "Litigation calculators" },
  people: { to: "/people", label: "People" },
  insights: { to: "/insights/research", label: "Research" },
  library: { to: "/sources/library", label: "Source library" },
} as const satisfies Record<string, AppLink>;

/** Traced from the server functions and components that read each dataset. Prefix keys end with "*". */
const USED_ON: Readonly<Record<string, readonly AppLink[]>> = {
  court_spine: [P.courts],
  courts_db: [P.courts],
  court_locations: [P.courts],
  court_images: [P.courts],
  court_analytics: [P.courts],
  court_stats_national: [P.courtAnalytics],
  court_stats_circuits: [P.courtAnalytics],
  court_stats_district_nos: [P.courtAnalytics, P.courts],
  court_stats_district_times: [P.courtAnalytics, P.courts],
  "uscourts_tables_*": [P.courts],
  "fjc_civil_*": [P.caseload],
  clb_court_profiles: [P.courts],
  clb_court_flows: [P.courts, P.collection],
  clb_court_benches: [P.courts],
  clb_district_crossview: [P.courts, P.collection],
  clb_docket_master: [P.collection],
  clb_top_cited: [P.collection],
  clb_bulk_schema: [P.collection],
  clb_disclosure_coverage: [P.collection],
  clb_judge_dockets: [P.judges, P.courts],
  clb_bankruptcy_courts: [P.courts],
  clb_oral_arguments: [P.courts],
  clb_appellate_timing: [P.courts],
  clb_appellate_panels: [P.courts, P.judges],
  clb_judge_disclosures: [P.judges],
  clb_top_cited_parentheticals: [P.collection],
  clb_unmatched_citations: [P.collection],
  cl_people: [P.judges, P.courts],
  judges: [P.judges],
  judge_profiles_fjc: [P.judges],
  fjc_appeals_outcomes: [P.courts],
  fjc_criminal_districts: [P.courts],
  fjc_bankruptcy_districts: [P.courts],
  judicial_vacancies: [P.vacancies, P.courts],
  judicial_nominations: [P.judges],
  judicial_confirmation_votes: [P.judges],
  judge_cl_crosswalk: [P.judges],
  "judge_cross_*": [P.judgeAnalytics],
  firm_profiles: [P.firms],
  firm_network: [P.firms],
  firm_matter_overview: [P.firms],
  scac_statistics: [P.securities],
  scac_trend_alignment: [P.securities],
  mdls: [P.matters, P.mdlAnalytics],
  sw_matters_v1: [P.matters],
  sw_matter_dockets_v1: [P.matters],
  sw_docket_entries_v1: [P.matters],
  sw_matter_parties_v1: [P.matters],
  sw_docket_documents_v1: [P.matters],
  mdl_analytics: [P.mdlAnalytics, P.companies],
  mdl_terminated_history: [P.mdlAnalytics, P.companies],
  "mdl_intel_*": [P.mdlIntel],
  mdl_counsel: [P.matters, P.people],
  counsel_directory: [P.people],
  seeger: [P.matters],
  limitation_periods: [P.limitations, P.law],
  statutory_limitations_review: [P.limitations, P.law],
  state_codes: [P.codes],
  federal_register_history: [P.agencies, P.law],
  regulatory_federal_register_activity: [P.enforcement],
  citation_index: [P.insights],
  "regulatory_epa_*": [P.enforcement],
  "osha_*": [P.enforcement],
  settlement_notices: [P.enforcement],
  enforcement_data_sources_catalog: [P.enforcement],
  settlements: [P.enforcement],
  settlement_claims_official: [P.enforcement],
  sam_exclusions: [P.enforcement],
  congress_bills: [P.legislation],
  congress_members: [P.legislation, P.states],
  congress_committees: [P.legislation],
  judge_court_pages: [P.judges, P.courts],
  judge_practice_documents: [P.judges],
  judge_court_coverage: [P.courts],
  "gov_domains*": [P.states, P.stateAnalytics],
  ecfr_parallel_authorities: [P.law],
  ecfr_subject_index: [P.law],
  ecfr_agencies: [P.law],
  crs_reports: [P.legislation],
  state_bills: [P.legislation, P.states],
  oig_leie_exclusions: [P.enforcement],
  oversight_reports: [P.enforcement],
  oversight_trends: [P.enforcement],
  doj_oig_reports: [P.enforcement],
  osc_public_files: [P.enforcement],
  osc_publications: [P.enforcement],
  doj_cep_resolutions: [P.enforcement],
  doj_document_index: [P.enforcement],
  sec_broker_dealers: [P.enforcement, P.companies],
  sec_investment_advisers: [P.enforcement, P.companies],
  sec_adviser_statistics: [P.enforcement, P.companies],
  frb_enforcement_actions: [P.enforcement, P.companies],
  fsis_recalls: [P.safety, P.enforcement],
  fsis_enforcement_quarterly: [P.enforcement],
  ussc_sentencing_districts: [P.courts],
  eousa_caseload_annual: [P.courts],
  "us_code_*": [P.law],
  public_laws_enacted: [P.law],
  "doj_press_releases*": [P.enforcement],
  ftc_enforcement_actions: [P.enforcement, P.companies],
  ftc_cases: [P.enforcement, P.companies],
  ftc_hsr_early_terminations: [P.enforcement, P.companies],
  ftc_hsr_filings: [P.enforcement],
  sec_enforcement_actions: [P.enforcement, P.companies],
  "cfpb_complaints_*": [P.enforcement, P.states],
  agency_safety_cpsc_recalls_api: [P.enforcement],
  regulatory_cpsc_aggregates: [P.enforcement],
  agency_safety_insights: [P.safety],
  agency_safety_mass_tort_signals: [P.signals],
  "saferproducts_*": [P.safety],
  "neiss_*": [P.safety],
  "company_sec_*": [P.companies],
  "company_payments_*": [P.payments],
  company_adverse_manufacturers: [P.payments],
  "state_metrics_*": [P.stateAnalytics, P.states],
  epa_echo_case_series: [P.states],
  epa_echo_state_programs: [P.states],
  npdb_malpractice_states: [P.states],
  "ftc_*": [P.states],
  counties: [P.states],
  "econ_*": [P.calculators],
  company_federal_awards: [P.companies],
  census_acs_cvap_counties: [P.insights],
  sources: [P.library],
};

export function usedOn(datasetId: string): readonly AppLink[] {
  const exact = USED_ON[datasetId];
  if (exact) return exact;
  for (const [key, links] of Object.entries(USED_ON))
    if (key.endsWith("*") && datasetId.startsWith(key.slice(0, -1))) return links;
  return [];
}

export type SourceDataset = {
  id: string;
  label: string;
  records: number | null;
  sourceText: string | null;
  /** URLs written in the dataset's recorded source statement. */
  sourceUrls: string[];
  /** http(s) source URLs on the dataset's first records (portal list only; not the dataset's stated source). */
  recordUrls?: string[] | undefined;
  updatedAt: string | null;
};

/** Whole-word, case-insensitive match of every term against label, id, category and source statement. */
export function matchesQuery(text: string, q: string): boolean {
  const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return true;
  const hay = text.toLowerCase();
  return terms.every((t) => hay.includes(t));
}

export function datasetHaystack(d: SourceDataset): string {
  return [d.label, d.id, categoryLabel(categoryOf(d.id)), d.sourceText ?? "", ...d.sourceUrls].join(
    " ",
  );
}

export function groupByCategory(rows: readonly SourceDataset[]) {
  const out = new Map<CategoryId, SourceDataset[]>();
  for (const c of CATEGORIES) out.set(c.id, []);
  for (const d of rows) out.get(categoryOf(d.id))!.push(d);
  for (const list of out.values())
    list.sort((a, b) => (b.records ?? -1) - (a.records ?? -1) || a.label.localeCompare(b.label));
  return out;
}

const URL_RE = /https?:\/\/[^\s"'<>()[\]{},]+/g;

/** http(s) URLs written in a source statement, trailing punctuation trimmed, credentials refused, de-duplicated. */
export function extractUrls(text: string, limit = 12): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(URL_RE)) {
    const raw = m[0].replace(/[.;:]+$/, "");
    try {
      const u = new URL(raw);
      if ((u.protocol !== "https:" && u.protocol !== "http:") || u.username || u.password) continue;
      if (!out.includes(u.toString())) out.push(u.toString());
    } catch {
      continue;
    }
    if (out.length >= limit) break;
  }
  return out;
}

export type PortalKind = "courts" | "federal" | "state" | "research" | "other";

export const PORTAL_KINDS: readonly { id: PortalKind; label: string }[] = [
  { id: "courts", label: "Courts and judiciary" },
  { id: "federal", label: "Federal agencies" },
  { id: "state", label: "State and local government" },
  { id: "research", label: "Research and nonprofit publishers" },
  { id: "other", label: "Other publishers and downloads" },
];

/** Known names for hosts; anything else is shown as its host. */
const PORTAL_NAMES: Readonly<Record<string, string>> = {
  "uscourts.gov": "U.S. Courts",
  "jpml.uscourts.gov": "Judicial Panel on Multidistrict Litigation",
  "supremecourt.gov": "Supreme Court of the United States",
  "fjc.gov": "Federal Judicial Center",
  "open.fda.gov": "openFDA",
  "api.fda.gov": "openFDA API",
  "fda.gov": "U.S. Food and Drug Administration",
  "cpsc.gov": "Consumer Product Safety Commission",
  "saferproducts.gov": "SaferProducts.gov (CPSC)",
  "nhtsa.gov": "National Highway Traffic Safety Administration",
  "echo.epa.gov": "EPA ECHO",
  "epa.gov": "Environmental Protection Agency",
  "data.dol.gov": "Department of Labor data catalog",
  "osha.gov": "OSHA",
  "justice.gov": "Department of Justice",
  "federalregister.gov": "Federal Register",
  "ecfr.gov": "eCFR",
  "govinfo.gov": "GovInfo",
  "consumerfinance.gov": "Consumer Financial Protection Bureau",
  "files.consumerfinance.gov": "CFPB downloads",
  "ftc.gov": "Federal Trade Commission",
  "npdb.hrsa.gov": "National Practitioner Data Bank",
  "openpaymentsdata.cms.gov": "CMS Open Payments",
  "cms.gov": "Centers for Medicare & Medicaid Services",
  "sec.gov": "SEC EDGAR",
  "data.sec.gov": "SEC EDGAR data",
  "efts.sec.gov": "SEC EDGAR full-text search",
  "census.gov": "U.S. Census Bureau",
  "courtlistener.com": "CourtListener (Free Law Project)",
  "com-courtlistener-storage.s3-us-west-2.amazonaws.com": "CourtListener bulk data",
  "free.law": "Free Law Project",
  "securities.stanford.edu": "Stanford Securities Class Action Clearinghouse",
};

export function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

export function portalName(host: string): string {
  if (PORTAL_NAMES[host]) return PORTAL_NAMES[host];
  return host.endsWith(".uscourts.gov") ? `${host} (U.S. Courts)` : host;
}

const STATES = new Set(
  "al ak az ar ca co ct de dc fl ga hi id il in ia ks ky la me md ma mi mn ms mo mt ne nv nh nj nm ny nc nd oh ok or pa ri sc sd tn tx ut vt va wa wv wi wy".split(
    " ",
  ),
);

/** State hosts: <code>.gov, *.<code>.gov and *.state.<code>.us for a U.S. state or D.C. code. */
function isStateHost(host: string): boolean {
  const gov = /(?:^|\.)([a-z]{2})\.gov$/.exec(host);
  if (gov && STATES.has(gov[1]!)) return true;
  const us = /(?:^|\.)(?:state\.)?([a-z]{2})\.us$/.exec(host);
  return Boolean(us && STATES.has(us[1]!));
}

export function portalKind(host: string): PortalKind {
  if (/(^|\.)uscourts\.gov$|(^|\.)supremecourt\.gov$|(^|\.)fjc\.gov$/.test(host)) return "courts";
  if (isStateHost(host)) return "state";
  if (/\.gov$/.test(host)) return "federal";
  if (
    /courtlistener|free\.law|stanford\.edu|\.edu$|\.org$/.test(host) ||
    host.endsWith("amazonaws.com")
  )
    return "research";
  return "other";
}

export type Portal = {
  /** The host, or COURT_SITES for the individual court websites grouped together. */
  host: string;
  name: string;
  kind: PortalKind;
  /** Every host in the portal (one, or each court site in the group). */
  hosts: string[];
  urls: string[];
  datasets: { id: string; label: string }[];
};

/** Individual court websites (cand.uscourts.gov, ca9.uscourts.gov, …) are listed as one portal. */
export const COURT_SITES = "court-sites.uscourts.gov";

function portalKey(host: string): string {
  return host.endsWith(".uscourts.gov") && !PORTAL_NAMES[host] ? COURT_SITES : host;
}

/** Portals from each dataset's stated source URLs and, when given, URLs on its first records. */
export function buildPortals(rows: readonly SourceDataset[]): Portal[] {
  const map = new Map<string, Portal>();
  for (const d of rows) {
    for (const url of [...d.sourceUrls, ...(d.recordUrls ?? [])]) {
      const host = hostOf(url);
      if (!host) continue;
      const key = portalKey(host);
      let p = map.get(key);
      if (!p) {
        p =
          key === COURT_SITES
            ? {
                host: key,
                name: "Individual federal court websites",
                kind: "courts",
                hosts: [],
                urls: [],
                datasets: [],
              }
            : {
                host,
                name: portalName(host),
                kind: portalKind(host),
                hosts: [],
                urls: [],
                datasets: [],
              };
        map.set(key, p);
      }
      if (!p.hosts.includes(host)) p.hosts.push(host);
      if (!p.urls.includes(url) && p.urls.length < 6) p.urls.push(url);
      if (!p.datasets.some((x) => x.id === d.id)) p.datasets.push({ id: d.id, label: d.label });
    }
  }
  for (const p of map.values()) p.hosts.sort();
  return [...map.values()].sort(
    (a, b) => b.datasets.length - a.datasets.length || a.name.localeCompare(b.name),
  );
}

export type Workflow = {
  id: string;
  title: string;
  question: string;
  steps: AppLink[];
  categories: CategoryId[];
};

export const WORKFLOWS: readonly Workflow[] = [
  {
    id: "product",
    title: "Research a product or company",
    question: "Has this product been recalled, reported or enforced against, and who makes it?",
    steps: [
      { to: "/safety", label: "Product safety: recalls, reports and injury estimates" },
      { to: "/safety/signals", label: "Safety signals across agencies" },
      { to: "/law/monitoring", label: "Regulatory intelligence and recall patterns" },
      { to: "/enforcement", label: "Enforcement actions and settlements" },
      { to: "/companies", label: "Company profiles and SEC filings" },
      { to: "/companies/payments", label: "Industry payments to physicians" },
    ],
    categories: ["safety", "medical", "enforcement", "companies"],
  },
  {
    id: "mdl",
    title: "Review an MDL",
    question: "Where is the litigation, who is on it and how is it moving?",
    steps: [
      { to: "/matters", label: "Matters and master dockets" },
      { to: "/matters/intel", label: "MDL intelligence: JPML orders and court pages" },
      { to: "/matters/analytics", label: "MDL analytics" },
      { to: "/matters/cases", label: "Cases" },
      { to: "/courts/firms", label: "Law firms on MDL dockets" },
    ],
    categories: ["matters", "firms"],
  },
  {
    id: "judge",
    title: "Check a judge",
    question: "Who is the judge, what do they handle and how long do cases take?",
    steps: [
      { to: "/judges", label: "Judge directory and profiles" },
      { to: "/judges/analytics", label: "Judge analytics: MDL load and experience" },
      { to: "/courts", label: "The judge's court page" },
    ],
    categories: ["judges", "courts"],
  },
  {
    id: "court",
    title: "Understand a court",
    question: "How busy is the court, where does it sit and what does it decide?",
    steps: [
      { to: "/courts", label: "Court directory, structure and addresses" },
      { to: "/courts/analytics", label: "Court analytics" },
      { to: "/courts/caseload", label: "Caseload by district and nature of suit" },
      { to: "/courts/collection", label: "Dockets, opinions and citations" },
      { to: "/courts/securities", label: "Securities class actions by circuit" },
      { to: "/courts/vacancies", label: "Judicial vacancies and nominations" },
    ],
    categories: ["courts"],
  },
  {
    id: "deadline",
    title: "Find a deadline",
    question: "What limitation period applies, and what does the statute say?",
    steps: [
      { to: "/limitations", label: "Time limits calculator" },
      { to: "/limitations/statutory", label: "Statutory limitation rules" },
      { to: "/law/codes", label: "State codes" },
    ],
    categories: ["law"],
  },
  {
    id: "law",
    title: "Find the governing law",
    question: "Which statute, regulation or agency document applies?",
    steps: [
      { to: "/law", label: "Law & government overview" },
      { to: "/law/codes", label: "State codes" },
      { to: "/agencies", label: "Agencies and the Federal Register" },
      { to: "/search", label: "Search the corpus" },
    ],
    categories: ["law"],
  },
  {
    id: "state",
    title: "Profile a state",
    question: "How does a state compare on courts, complaints, enforcement and demographics?",
    steps: [
      { to: "/", label: "State map and state pages" },
      { to: "/places/analytics", label: "State analytics" },
      { to: "/enforcement", label: "Consumer complaints and enforcement" },
    ],
    categories: ["states", "consumer"],
  },
  {
    id: "sources",
    title: "Find an original source",
    question: "Where did a record come from, and is there a saved copy?",
    steps: [
      { to: "/sources/library", label: "Source library (URLs)" },
      { to: "/sources/catalog", label: "Source catalog by jurisdiction" },
      { to: "/sources/coverage", label: "Coverage" },
      { to: "/data", label: "Dataset inventory" },
      { to: "/saved-sources", label: "Saved sources" },
    ],
    categories: ["sources"],
  },
];

export const TABS = ["datasets", "portals", "workflows"] as const;
export type SourcesTab = (typeof TABS)[number];

export type SourcesSearch = {
  tab?: SourcesTab | undefined;
  cat?: CategoryId | undefined;
  q?: string | undefined;
};

export function normalizeSourcesSearch(raw: Record<string, unknown>): SourcesSearch {
  const tab = TABS.includes(raw["tab"] as SourcesTab) ? (raw["tab"] as SourcesTab) : undefined;
  const cat = CATEGORIES.some((c) => c.id === raw["cat"]) ? (raw["cat"] as CategoryId) : undefined;
  const q =
    typeof raw["q"] === "string" && raw["q"].trim() && raw["q"].length <= 200
      ? raw["q"]
      : undefined;
  return { tab: tab === "datasets" ? undefined : tab, cat, q };
}
