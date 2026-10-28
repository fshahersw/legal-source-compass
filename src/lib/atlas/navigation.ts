/**
 * The platform's information architecture (owner decision 2026-10-23 evening): nine sidebar sections, two utilities
 * below them, contextual tabs per section (at most seven, each a distinct kind of page), the section every route
 * belongs to, and the breadcrumb trail Section › sub-area › entity. Pure; the shell renders what this decides.
 */
import { sectionOf } from "@/lib/external/groups";

export type PrimarySection =
  | "overview"
  | "places"
  | "courts"
  | "litigation"
  | "law"
  | "enforcement"
  | "safety"
  | "companies"
  | "insights";
export type UtilitySection = "sources" | "saved";
export type NavigationSection = PrimarySection | UtilitySection;

export type NavigationItem = {
  id: NavigationSection;
  to: string;
  label: string;
  /** One sentence for the drawer, hub pages and the overview briefing. */
  description: string;
};

/** Exactly nine sidebar sections, in this order (owner decision 2026-10-23 evening). */
export const PRIMARY_NAVIGATION: readonly NavigationItem[] = [
  {
    id: "overview",
    to: "/",
    label: "Overview",
    description: "The national map and a briefing across the platform.",
  },
  {
    id: "places",
    to: "/places",
    label: "Places",
    description:
      "States, counties and cities, with their courts, law, litigation and Census figures.",
  },
  {
    id: "courts",
    to: "/courts",
    label: "Courts & judges",
    description: "Every court and judge, caseloads, vacancies and court and judge comparisons.",
  },
  {
    id: "litigation",
    to: "/litigation",
    label: "Litigation",
    description:
      "Case law, MDLs and mass torts, dockets, securities class actions, law firms and settlements.",
  },
  {
    id: "law",
    to: "/law",
    label: "Law & government",
    description:
      "Federal and state law, legislation and Congress, rulemaking, time limits and agencies.",
  },
  {
    id: "enforcement",
    to: "/enforcement",
    label: "Enforcement",
    description: "Agency enforcement actions, exclusions, oversight reports and merger review.",
  },
  {
    id: "safety",
    to: "/safety",
    label: "Products & safety",
    description:
      "Recalls, adverse events, injury estimates, consumer reports, approvals and product signals.",
  },
  {
    id: "companies",
    to: "/companies",
    label: "Companies",
    description: "Company profiles from SEC filings and industry payments to clinicians.",
  },
  {
    id: "insights",
    to: "/insights",
    label: "Insights",
    description: "Metrics, trends, rankings, maps and signals across the platform's data.",
  },
];

/** The utilities below the nine sections. */
export const UTILITY_NAVIGATION: readonly NavigationItem[] = [
  {
    id: "sources",
    to: "/sources",
    label: "Sources",
    description:
      "Where every dataset comes from: directory, library, catalog, coverage and registry.",
  },
  {
    id: "saved",
    to: "/saved-sources",
    label: "Saved work",
    description: "Sources you saved, reviews, imports and exports in this browser.",
  },
];

const ALL_SECTIONS: readonly NavigationItem[] = [...PRIMARY_NAVIGATION, ...UTILITY_NAVIGATION];
const SECTION_BY_ID = new Map(ALL_SECTIONS.map((s) => [s.id, s]));

export function sectionItem(id: NavigationSection): NavigationItem {
  return SECTION_BY_ID.get(id)!;
}

/** Parsed URL search, as the router hands it over (values may be strings, numbers or anything else). */
export type SearchParams = Readonly<Record<string, unknown>> | undefined;

export type ContextNavigationItem = {
  to: string;
  label: string;
  /** Query a tab opens with (tabs that are views of one page, e.g. /safety?view=neiss). */
  search?: Readonly<Record<string, string>> | undefined;
};

/** `path` without trailing slashes; the root (and an empty path) is "/". */
export const normalizePath = (path: string) => path.replace(/\/+$/, "") || "/";

const at = (path: string, base: string) => path === base || path.startsWith(base + "/");
const param = (search: SearchParams, key: string): string | undefined => {
  const v = search?.[key];
  return typeof v === "string" && v ? v : typeof v === "number" ? String(v) : undefined;
};
/** The dataset of /records/<dataset>/<id> or /data/<dataset> (not /data/tables/...). */
const datasetOfPath = (path: string): string | undefined => {
  const m = /^\/(?:records|data)\/([a-z0-9_]{1,80})(?:\/|$)/.exec(path);
  return m && m[1] !== "tables" ? m[1] : undefined;
};

// ------------------------------------------------------------------------------------------------ record placement

export type RecordPlacement = { section: NavigationSection; tab?: string };

const ENFORCEMENT_EXCLUSIONS = new Set(["sam_exclusions", "oig_leie_exclusions"]);
const ENFORCEMENT_OVERSIGHT = /^(oversight_|osc_|doj_oig_reports$)/;
const ENFORCEMENT_MERGER = /^ftc_hsr_/;
const ENFORCEMENT =
  /^(ftc_|sec_enforcement_actions$|sec_broker_dealers$|sec_investment_advisers$|sec_adviser_statistics$|frb_|doj_|epa_echo_|regulatory_epa_|regulatory_cpsc_|osha_|cfpb_|enforcement_)/;
const COMPANIES = /^company_/;
const SAFETY =
  /^(agency_safety_|agency_science_documents$|fsis_|neiss_|saferproducts_|recall_patterns$|fda_|npdb_)/;
const LITIGATION_SETTLEMENTS = /^(settlements$|settlement_)/;
const LITIGATION_SECURITIES = /^scac_/;
const LITIGATION_FIRMS = /^(firm_|counsel_directory$|mdl_counsel$)/;
const LITIGATION_DOCKETS = /^(cl_docket_metadata$|sw_docket_)/;
const LITIGATION = /^(mdl|jpml_|sw_|seeger$|verdict_reports$|expert_rulings$|state_proceedings$)/;
const PLACES =
  /^(census_|county_profiles$|city_profiles$|counties$|state_metrics_|state_cross_analysis$|county_legal_activity$)/;
const LAW_LEGISLATION =
  /^(congress_|state_bills$|public_laws|crs_reports$|govinfo_(hearings|committee_prints|bill_versions|gao_reports)$|gao_legal_decisions$)/;
const LAW_FEDERAL = /^(us_code_|ecfr_|federal_regulations_|federal_register_history$|federal$)/;
const LAW_STATE =
  /^(state_code|state_constitution|state_regulation_|court_rule_|indiana_code$|sd_statutes$|provider_laws$)/;
const LAW_TIME_LIMITS = /^(limitation_periods$|statutory_limitations_review$)/;
const LAW_AGENCIES = /^(fr_agency_|agency_budget_trends$|agency_spending_by_state$)/;
const LAW_RULEMAKING =
  /^(unified_agenda_pipeline$|regulatory_federal_register_activity$|regulations_gov_)/;
const COURTS_JUDGES = /^(judge|judicial_|cl_people$)/;

/**
 * The section (and tab id) of a record or dataset page, decided by its dataset id alone: explicit families first,
 * then the corpus grouping (groups.ts). Unknown datasets have no section.
 */
export function recordPlacement(dataset: string): RecordPlacement | null {
  if (ENFORCEMENT_EXCLUSIONS.has(dataset)) return { section: "enforcement", tab: "exclusions" };
  if (ENFORCEMENT_OVERSIGHT.test(dataset)) return { section: "enforcement", tab: "oversight" };
  if (ENFORCEMENT_MERGER.test(dataset)) return { section: "enforcement", tab: "merger" };
  if (ENFORCEMENT.test(dataset)) return { section: "enforcement", tab: "actions" };
  if (COMPANIES.test(dataset)) return { section: "companies", tab: "directory" };
  if (SAFETY.test(dataset)) return { section: "safety", tab: "collections" };
  if (LITIGATION_SETTLEMENTS.test(dataset)) return { section: "litigation", tab: "settlements" };
  if (LITIGATION_SECURITIES.test(dataset)) return { section: "litigation", tab: "securities" };
  if (LITIGATION_FIRMS.test(dataset)) return { section: "litigation", tab: "firms" };
  if (LITIGATION_DOCKETS.test(dataset)) return { section: "litigation", tab: "dockets" };
  if (LITIGATION.test(dataset)) return { section: "litigation", tab: "mdls" };
  if (PLACES.test(dataset)) return { section: "places" };
  if (LAW_LEGISLATION.test(dataset)) return { section: "law", tab: "legislation" };
  if (LAW_FEDERAL.test(dataset)) return { section: "law", tab: "federal" };
  if (LAW_STATE.test(dataset)) return { section: "law", tab: "state" };
  if (LAW_TIME_LIMITS.test(dataset)) return { section: "law", tab: "limits" };
  if (LAW_AGENCIES.test(dataset)) return { section: "law", tab: "agencies" };
  if (LAW_RULEMAKING.test(dataset)) return { section: "law", tab: "rulemaking" };
  if (COURTS_JUDGES.test(dataset)) return { section: "courts", tab: "judges" };
  switch (sectionOf(dataset)) {
    case "courts":
      return { section: "courts", tab: "courts" };
    case "judges":
      return { section: "courts", tab: "judges" };
    case "matters":
      return { section: "litigation", tab: "mdls" };
    case "law":
      return { section: "law" };
    case "safety":
      return { section: "safety", tab: "collections" };
    case "sources":
      return { section: "sources", tab: "datasets" };
    default:
      return null;
  }
}

const recordIn = (section: NavigationSection, tab?: string) => (path: string) => {
  const dataset = datasetOfPath(path);
  if (!dataset) return false;
  const placed = recordPlacement(dataset);
  return !!placed && placed.section === section && (tab === undefined || placed.tab === tab);
};

// ------------------------------------------------------------------------------------------------ sections and tabs

type Owner = (path: string, search: SearchParams) => boolean;
type TabSpec = ContextNavigationItem & {
  id: string;
  /** One plain-language line (at most 14 words) shown under the label in the header menu. */
  description: string;
  /** Destinations with the same group id open together in one dropdown panel (see SECTION_GROUPS). */
  group?: string;
  owns: Owner;
};
type SectionSpec = {
  id: NavigationSection;
  tabs: readonly TabSpec[];
  /** Pages of the section that no tab owns (entity pages, legacy addresses). */
  extra?: Owner;
  /** Pages of the section that carry no tab strip. */
  noStrip?: (path: string) => boolean;
};

const COURT_PAGES_IN_OTHER_SECTIONS = ["/courts/collection", "/courts/securities", "/courts/firms"];
const LAW_PAGES_IN_OTHER_SECTIONS = ["/law/enforcement", "/law/monitoring"];
const isStatePage = (path: string) =>
  /^\/places\/[^/]+/.test(path) && !at(path, "/places/analytics");
const enforcementTab = (tab: string | undefined) => (path: string, search: SearchParams) =>
  path === "/enforcement" && param(search, "tab") === tab;
const safetyView = (path: string, search: SearchParams) => {
  if (path !== "/safety") return null;
  const view = param(search, "view");
  if (view === "list" || param(search, "agency") || param(search, "ds")) return "collections";
  if (view === "neiss" || view === "reports") return view;
  return "overview";
};
const lawScope = (search: SearchParams) => param(search, "scope");

/**
 * Sections in resolution order: the first section that owns a path is its section. Pages whose path sits under
 * another section's prefix (e.g. /courts/collection under Litigation, /law/monitoring under Products & safety) are
 * claimed by the earlier section.
 */
const SECTIONS: readonly SectionSpec[] = [
  {
    id: "enforcement",
    tabs: [
      {
        id: "overview",
        to: "/enforcement",
        label: "Overview",
        description: "Headline enforcement figures and what changed across agencies.",
        owns: enforcementTab(undefined),
      },
      {
        id: "actions",
        to: "/enforcement",
        search: { tab: "actions" },
        label: "Actions by agency",
        description: "Each agency's own published actions: DOJ, SEC, FTC, EPA and more.",
        owns: (p, s) => enforcementTab("actions")(p, s) || recordIn("enforcement", "actions")(p),
      },
      {
        id: "exclusions",
        to: "/enforcement",
        search: { tab: "exclusions" },
        label: "Exclusions",
        description: "People and companies barred from federal health and contracting programs.",
        group: "checks",
        owns: (p, s) =>
          enforcementTab("exclusions")(p, s) || recordIn("enforcement", "exclusions")(p),
      },
      {
        id: "oversight",
        to: "/enforcement",
        search: { tab: "oversight" },
        label: "Oversight reports",
        description: "Inspector General reports, DOJ OIG reports and Special Counsel files.",
        group: "checks",
        owns: (p, s) =>
          enforcementTab("oversight")(p, s) || recordIn("enforcement", "oversight")(p),
      },
      {
        id: "merger",
        to: "/enforcement",
        search: { tab: "merger" },
        label: "Merger review",
        description: "Merger filings and early termination notices from the FTC.",
        group: "checks",
        owns: (p, s) => enforcementTab("merger")(p, s) || recordIn("enforcement", "merger")(p),
      },
      {
        id: "sources",
        to: "/enforcement",
        search: { tab: "sources" },
        label: "Agency data sources",
        description: "Where each enforcement dataset comes from and what it covers.",
        group: "checks",
        owns: enforcementTab("sources"),
      },
    ],
    extra: (p) => at(p, "/enforcement") || at(p, "/law/enforcement") || recordIn("enforcement")(p),
  },
  {
    id: "safety",
    tabs: [
      {
        id: "overview",
        to: "/safety",
        label: "Overview",
        description: "Recalls, adverse events and safety flags at a glance.",
        owns: (p, s) => safetyView(p, s) === "overview",
      },
      {
        id: "intelligence",
        to: "/law/monitoring",
        label: "Regulatory intelligence",
        description: "Recall patterns, repeat-recall firms and changes in agency sources.",
        group: "signals",
        owns: (p) => at(p, "/law/monitoring"),
      },
      {
        id: "neiss",
        to: "/safety",
        search: { view: "neiss" },
        label: "Injuries (NEISS)",
        description: "National estimates of emergency-room injuries from consumer products.",
        group: "injuries",
        owns: (p, s) => safetyView(p, s) === "neiss",
      },
      {
        id: "reports",
        to: "/safety",
        search: { view: "reports" },
        label: "Consumer reports",
        description: "Unverified consumer reports on SaferProducts.gov, by product.",
        group: "injuries",
        owns: (p, s) => safetyView(p, s) === "reports",
      },
      {
        id: "signals",
        to: "/safety/signals",
        label: "Signals",
        description: "Mass-tort products next to rising adverse events, recalls and complaints.",
        group: "signals",
        owns: (p) => at(p, "/safety/signals"),
      },
      {
        id: "products",
        to: "/safety/products",
        label: "Products & devices",
        description: "Adverse-event and device reports, reactions and recalls for named products.",
        group: "browse",
        owns: (p) => at(p, "/safety/products") || at(p, "/safety/companies"),
      },
      {
        id: "collections",
        to: "/safety",
        search: { view: "list" },
        label: "Collections",
        description: "Every recall, enforcement and approval dataset, by agency.",
        group: "browse",
        owns: (p, s) => safetyView(p, s) === "collections" || recordIn("safety")(p),
      },
    ],
    extra: (p) => at(p, "/safety"),
  },
  {
    id: "litigation",
    tabs: [
      {
        id: "overview",
        to: "/litigation",
        label: "Overview",
        description: "Mass torts, class actions, firms and settlements at a glance.",
        owns: (p) => p === "/litigation",
      },
      {
        id: "cases",
        to: "/cases",
        label: "Case law",
        description: "Supreme Court, appeals and state high-court opinions, with a citator.",
        group: "cases",
        owns: (p) => at(p, "/cases"),
      },
      {
        id: "mdls",
        to: "/matters/analytics",
        label: "MDLs & mass torts",
        description: "Pending MDLs over time, transferee courts, and one page per MDL.",
        group: "mass",
        owns: (p) =>
          at(p, "/matters") ||
          p === "/mdls" ||
          at(p, "/prototypes/mdl") ||
          recordIn("litigation", "mdls")(p),
      },
      {
        id: "dockets",
        to: "/courts/collection",
        label: "Dockets",
        description: "The docket collection by year, court and nature of suit.",
        group: "cases",
        owns: (p) =>
          at(p, "/courts/collection") ||
          at(p, "/registry") ||
          at(p, "/sources/analysis") ||
          at(p, "/sources/docket-documents") ||
          at(p, "/litigation/documents") ||
          recordIn("litigation", "dockets")(p),
      },
      {
        id: "securities",
        to: "/courts/securities",
        label: "Securities class actions",
        description: "Federal securities class actions since 1996, with outcomes and settlements.",
        group: "mass",
        owns: (p) => at(p, "/courts/securities") || recordIn("litigation", "securities")(p),
      },
      {
        id: "firms",
        to: "/courts/firms",
        label: "Law firms",
        description: "Who appears on MDL master dockets, on which side.",
        owns: (p, s) =>
          at(p, "/courts/firms") ||
          (p === "/people" && param(s, "kind") === "mdl_counsel") ||
          recordIn("litigation", "firms")(p),
      },
      {
        id: "settlements",
        to: "/litigation/settlements",
        label: "Settlements",
        description: "Confirmed class settlements with deadlines, courts and published notices.",
        group: "mass",
        owns: (p) => at(p, "/litigation/settlements") || recordIn("litigation", "settlements")(p),
      },
    ],
    extra: (p) => at(p, "/litigation") || recordIn("litigation")(p),
  },
  {
    id: "courts",
    tabs: [
      {
        id: "courts",
        to: "/courts",
        label: "Courts",
        description: "Find any federal, state or tribal court and open its page.",
        owns: (p) =>
          (at(p, "/courts") && !COURT_PAGES_IN_OTHER_SECTIONS.some((x) => at(p, x))) ||
          at(p, "/prototypes/court") ||
          recordIn("courts", "courts")(p),
      },
      {
        id: "judges",
        to: "/judges",
        label: "Judges",
        description: "Judge profiles by court, with appointment and past service.",
        owns: (p) =>
          at(p, "/judges") ||
          p === "/people" ||
          at(p, "/prototypes/judge") ||
          recordIn("courts", "judges")(p),
      },
      {
        id: "docket-health",
        to: "/courts/docket-health",
        label: "Docket health",
        description:
          "Filings against terminations, pending cases, time to disposition and MDL dockets.",
        group: "caseload",
        owns: (p) => at(p, "/courts/docket-health"),
      },
      {
        id: "caseload",
        to: "/courts/caseload",
        label: "Caseload",
        description: "Federal civil caseload by district court, from the FJC.",
        group: "caseload",
        owns: (p) => at(p, "/courts/caseload"),
      },
      {
        id: "vacancies",
        to: "/courts/vacancies",
        label: "Vacancies",
        description: "Current and future vacancies, judicial emergencies and confirmations.",
        group: "caseload",
        owns: (p) => at(p, "/courts/vacancies"),
      },
      {
        id: "compare-courts",
        to: "/courts/analytics",
        label: "Compare courts",
        description: "District courts side by side: filings, pending cases and timing.",
        group: "compare",
        owns: (p) => at(p, "/courts/analytics"),
      },
      {
        id: "compare-judges",
        to: "/judges/analytics",
        label: "Compare judges",
        description: "MDL transferee judges and their dockets, side by side.",
        group: "compare",
        owns: (p) => at(p, "/judges/analytics"),
      },
    ],
  },
  {
    id: "places",
    tabs: [
      {
        id: "map",
        to: "/places",
        label: "Map",
        description: "Shade states and counties by any metric, then open a place.",
        owns: (p) => p === "/places",
      },
      {
        id: "compare",
        to: "/places/analytics",
        label: "Compare",
        description: "States side by side: rankings and per-capita figures.",
        owns: (p) => at(p, "/places/analytics"),
      },
    ],
    extra: (p) => at(p, "/places") || recordIn("places")(p),
    noStrip: isStatePage,
  },
  {
    id: "overview",
    tabs: [],
    extra: (p) => p === "/" || at(p, "/overview"),
  },
  {
    id: "law",
    tabs: [
      {
        id: "overview",
        to: "/law",
        label: "Overview",
        description: "Federal law, state law, legislation and agencies at a glance.",
        owns: (p, s) => p === "/law" && lawScope(s) !== "federal" && lawScope(s) !== "states",
      },
      {
        id: "federal",
        to: "/law",
        search: { scope: "federal" },
        label: "Federal law",
        description: "The U.S. Code and the Code of Federal Regulations, section by section.",
        group: "law",
        owns: (p, s) =>
          (p === "/law" && lawScope(s) === "federal") ||
          at(p, "/law/uscode") ||
          at(p, "/law/cfr") ||
          p === "/laws" ||
          recordIn("law", "federal")(p),
      },
      {
        id: "state",
        to: "/law",
        search: { scope: "states" },
        label: "State law",
        description: "State codes, constitutions, regulations and court rules.",
        group: "law",
        owns: (p, s) =>
          (p === "/law" && lawScope(s) === "states") ||
          at(p, "/law/codes") ||
          at(p, "/law/constitutions") ||
          at(p, "/law/regulations") ||
          recordIn("law", "state")(p),
      },
      {
        id: "legislation",
        to: "/law/legislation",
        label: "Legislation & Congress",
        description: "Federal and state bills, members of Congress and committees.",
        group: "gov",
        owns: (p) => at(p, "/law/legislation") || recordIn("law", "legislation")(p),
      },
      {
        id: "rulemaking",
        to: "/law/rulemaking",
        label: "Rulemaking",
        description: "Federal Register rules, proposed rules and the Unified Agenda.",
        group: "gov",
        owns: (p) => at(p, "/law/rulemaking") || recordIn("law", "rulemaking")(p),
      },
      {
        id: "limits",
        to: "/limitations",
        label: "Time limits",
        description: "Statutes of limitation with cited rules and a guided calculator.",
        owns: (p) => at(p, "/limitations") || recordIn("law", "limits")(p),
      },
      {
        id: "agencies",
        to: "/agencies",
        label: "Agencies",
        description: "Federal agencies: structure, rules, budgets and enforcement.",
        group: "gov",
        owns: (p) => at(p, "/agencies") || recordIn("law", "agencies")(p),
      },
    ],
    extra: (p) =>
      (at(p, "/law") && !LAW_PAGES_IN_OTHER_SECTIONS.some((x) => at(p, x))) || recordIn("law")(p),
  },
  {
    id: "companies",
    tabs: [
      {
        id: "directory",
        to: "/companies",
        label: "Directory",
        description: "Companies tied to MDLs, profiled from their SEC filings.",
        owns: (p) =>
          (at(p, "/companies") && !at(p, "/companies/payments")) || recordIn("companies")(p),
      },
      {
        id: "payments",
        to: "/companies/payments",
        label: "Industry payments",
        description: "What drug and device makers paid clinicians, 2017 to 2025.",
        owns: (p) => at(p, "/companies/payments"),
      },
    ],
  },
  {
    /** The former /analytics pages redirect into this section and light the tab that replaced them. */
    id: "insights",
    tabs: [
      {
        id: "overview",
        to: "/insights",
        label: "Overview",
        description: "Headline figures across the platform and what moved most.",
        owns: (p) => p === "/insights" || p === "/analytics" || at(p, "/insights/stories"),
      },
      {
        id: "explore",
        to: "/insights/explore",
        label: "Explore",
        description: "Put any two metrics side by side across states or MDLs.",
        group: "analyse",
        owns: (p) => at(p, "/insights/explore"),
      },
      {
        id: "trends",
        to: "/insights/trends",
        label: "Trends",
        description: "Follow one metric over time for up to six places.",
        group: "analyse",
        owns: (p) =>
          at(p, "/insights/trends") ||
          at(p, "/analytics/enforcement") ||
          at(p, "/analytics/safety"),
      },
      {
        id: "rankings",
        to: "/insights/rankings",
        label: "Rankings & maps",
        description: "Rank and map any metric for any period.",
        group: "analyse",
        owns: (p) => at(p, "/insights/rankings"),
      },
      {
        id: "signals",
        to: "/insights/signals",
        label: "Signals",
        description: "Time to MDL termination, growth after centralization and clusters.",
        owns: (p) => at(p, "/insights/signals"),
      },
      {
        id: "today",
        to: "/insights/today",
        label: "Insights of the day",
        description: "One computed insight per section each day, with its figures.",
        group: "research",
        owns: (p) => at(p, "/insights/today") || at(p, "/analytics/insights"),
      },
      {
        id: "research",
        to: "/insights/research",
        label: "Research",
        description: "State comparisons, judge and case analysis and citation paths.",
        group: "research",
        owns: (p) => at(p, "/insights/research"),
      },
    ],
    extra: (p) => at(p, "/insights") || at(p, "/analytics"),
  },
  {
    id: "sources",
    tabs: [
      {
        id: "directory",
        to: "/sources",
        label: "Directory",
        description: "Every dataset and where it comes from.",
        owns: (p) => p === "/sources",
      },
      {
        id: "library",
        to: "/sources/library",
        label: "Library",
        description: "Browse source documents and records in the library.",
        group: "browse",
        owns: (p) =>
          at(p, "/sources/library") ||
          at(p, "/sources/detail") ||
          ["/categories", "/jurisdictions", "/source-families", "/endpoint-explorer"].includes(p),
      },
      {
        id: "catalog",
        to: "/sources/catalog",
        label: "Catalog",
        description: "The catalog of sources, endpoints and update schedules.",
        group: "browse",
        owns: (p) => at(p, "/sources/catalog"),
      },
      {
        id: "coverage",
        to: "/sources/coverage",
        label: "Coverage",
        description: "What each source covers by place, period and record type.",
        group: "coverage",
        owns: (p) => at(p, "/sources/coverage"),
      },
      {
        id: "registry",
        to: "/sources/registry",
        label: "Registry",
        description: "The source registry with status, rights and checks.",
        group: "coverage",
        owns: (p) => at(p, "/sources/registry") || at(p, "/sources/registry-v22"),
      },
      {
        id: "datasets",
        to: "/data",
        label: "Datasets",
        description: "Every dataset with its record count, fields and filters.",
        group: "browse",
        // Dataset pages of other sections are claimed by their section before this tab is consulted.
        owns: (p) => at(p, "/data") || at(p, "/source-datasets") || recordIn("sources")(p),
      },
    ],
    extra: (p) => at(p, "/sources"),
  },
  {
    id: "saved",
    tabs: [
      {
        id: "saved",
        to: "/saved-sources",
        label: "Saved sources",
        description: "Sources you bookmarked or reviewed in this browser.",
        owns: (p) => at(p, "/saved-sources"),
      },
      {
        id: "exports",
        to: "/data-exports",
        label: "Imports & exports",
        description: "Import a saved bundle or export your work.",
        owns: (p) => at(p, "/data-exports"),
      },
    ],
  },
];
const SPEC_BY_ID = new Map(SECTIONS.map((s) => [s.id, s]));

/**
 * Routes that belong to no section on purpose: sign-in, password reset, global search results, the API, and the
 * index of design prototypes (each prototype itself sits in its section).
 */
export const UNSECTIONED_UTILITIES: readonly string[] = [
  "/auth",
  "/reset-password",
  "/search",
  "/prototypes",
  "/api",
];

function specFor(path: string, search: SearchParams): SectionSpec | null {
  const p = normalizePath(path);
  // A record or dataset page belongs to its dataset's section; a dataset page of no known section stays with
  // Sources (the dataset inventory), a record of no known section has none.
  const dataset = datasetOfPath(p);
  if (dataset) {
    const placed = recordPlacement(dataset);
    if (placed) return SPEC_BY_ID.get(placed.section)!;
    return at(p, "/data") ? SPEC_BY_ID.get("sources")! : null;
  }
  for (const spec of SECTIONS)
    if (spec.tabs.some((t) => t.owns(p, search)) || spec.extra?.(p, search)) return spec;
  return null;
}

/** The section a page belongs to, or null for an unsectioned utility page. */
export function navigationSection(path: string, search?: SearchParams): NavigationSection | null {
  return specFor(path, search)?.id ?? null;
}

const strip = (t: TabSpec): ContextNavigationItem =>
  t.search ? { to: t.to, label: t.label, search: t.search } : { to: t.to, label: t.label };

/** The section's tab strip for a page (empty where the page carries none). */
export function contextualNavigation(path: string, search?: SearchParams): ContextNavigationItem[] {
  const p = normalizePath(path);
  const spec = specFor(p, search);
  if (!spec || spec.noStrip?.(p)) return [];
  return spec.tabs.map(strip);
}

// ------------------------------------------------------------------------------------------------ header menu

type GroupCopy = { label: string; description: string };

/**
 * The dropdown panels of each section: the id a tab names in `group`, the panel's title and one line (at most 14
 * words) for its feature tile. Destinations without a group are direct links.
 */
const SECTION_GROUPS: Partial<Record<NavigationSection, Readonly<Record<string, GroupCopy>>>> = {
  enforcement: {
    checks: {
      label: "Checks & oversight",
      description: "Exclusion lists, oversight findings, merger review and data sources.",
    },
  },
  safety: {
    signals: {
      label: "Signals & intelligence",
      description: "Where product problems are rising, and which firms keep recalling.",
    },
    injuries: {
      label: "Injuries & reports",
      description: "Estimated injuries and what consumers report about products.",
    },
    browse: {
      label: "Browse data",
      description: "Look up products and devices, or open every collection.",
    },
  },
  litigation: {
    cases: {
      label: "Cases & dockets",
      description: "Court opinions and the docket records behind them.",
    },
    mass: {
      label: "Mass litigation",
      description: "MDLs, securities class actions and settlements.",
    },
  },
  courts: {
    caseload: {
      label: "Caseload",
      description: "How busy the federal courts are, and where judgeships are open.",
    },
    compare: {
      label: "Compare",
      description: "Courts or judges side by side on the same measures.",
    },
  },
  law: {
    law: {
      label: "Federal & state law",
      description: "Statutes, regulations and court rules, section by section.",
    },
    gov: {
      label: "Congress & agencies",
      description: "Bills, rulemaking and the agencies that issue rules.",
    },
  },
  insights: {
    analyse: { label: "Analyse", description: "Compare, follow, rank and map any metric." },
    research: { label: "Research", description: "The research workbench and the daily insights." },
  },
  sources: {
    browse: { label: "Browse", description: "Open the library, the catalog or any dataset." },
    coverage: {
      label: "Coverage & registry",
      description: "What each source covers, and the status of every source.",
    },
  },
};

/** The header strip shows at most this many top-level items; related destinations share a dropdown panel. */
export const MAX_MENU_ITEMS = 4;

export type MenuLink = {
  /** tabKey of the destination (its path plus query). */
  key: string;
  to: string;
  search?: Readonly<Record<string, string>> | undefined;
  label: string;
  description: string;
  /** aria-current of this destination for the page being shown. */
  current: "page" | "true" | undefined;
};
export type MenuItem =
  | ({ kind: "link"; active: boolean } & MenuLink)
  | {
      kind: "group";
      key: string;
      label: string;
      description: string;
      /** The destinations in the panel, in order; the first is the panel's feature tile. */
      items: MenuLink[];
      /** The page being shown is one of the panel's destinations. */
      active: boolean;
    };

/**
 * The section's header menu for a page: at most four items, each a direct link or a dropdown panel of grouped
 * destinations, every destination of the section exactly once, in tab order (a panel sits where its first member
 * is). Empty where the page carries no menu (the map home, a state page). Pure.
 */
export function sectionMenu(path: string, search?: SearchParams): MenuItem[] {
  const p = normalizePath(path);
  const spec = specFor(p, search);
  if (!spec || spec.noStrip?.(p)) return [];
  const activeKey = activeContextualPath(p, search);
  const copy = SECTION_GROUPS[spec.id] ?? {};
  const out: MenuItem[] = [];
  const groups = new Map<string, Extract<MenuItem, { kind: "group" }>>();
  for (const tab of spec.tabs) {
    const item = strip(tab);
    const key = tabKey(item);
    const link: MenuLink = {
      key,
      to: item.to,
      ...(item.search ? { search: item.search } : {}),
      label: item.label,
      description: tab.description,
      current: ariaCurrent(p, item.to, key === activeKey, search, item.search),
    };
    const group = tab.group ? copy[tab.group] : undefined;
    if (!tab.group || !group) {
      out.push({ kind: "link", active: key === activeKey, ...link });
      continue;
    }
    let panel = groups.get(tab.group);
    if (!panel) {
      panel = {
        kind: "group",
        key: `${spec.id}:${tab.group}`,
        label: group.label,
        description: group.description,
        items: [],
        active: false,
      };
      groups.set(tab.group, panel);
      out.push(panel);
    }
    panel.items.push(link);
    if (key === activeKey) panel.active = true;
  }
  return out;
}

/** Every destination of a menu, panels flattened, in order. */
export function menuLinks(items: readonly MenuItem[]): MenuLink[] {
  return items.flatMap((i) => (i.kind === "group" ? i.items : [i]));
}

/** Stable identity of a tab: its path plus its query, e.g. "/safety?view=neiss". */
export function tabKey(item: ContextNavigationItem): string {
  const q = item.search ? new URLSearchParams(Object.entries(item.search)).toString() : "";
  return q ? `${item.to}?${q}` : item.to;
}

/** The section tab that owns a page (whether or not the page shows the strip), or null when none does. */
export function activeContextualTab(
  path: string,
  search?: SearchParams,
): (ContextNavigationItem & { id: string }) | null {
  const p = normalizePath(path);
  const spec = specFor(p, search);
  if (!spec) return null;
  const owners = spec.tabs.filter((t) => t.owns(p, search));
  if (!owners.length) return null;
  // Predicates are written to be exclusive; on an overlap the most specific address wins.
  const best = owners.reduce((a, b) => (tabKey(b).length > tabKey(a).length ? b : a));
  return { ...strip(best), id: best.id };
}

/** The key (see tabKey) of the lit tab, or null. */
export function activeContextualPath(path: string, search?: SearchParams): string | null {
  const tab = activeContextualTab(path, search);
  return tab ? tabKey(tab) : null;
}

const cleanSearch = (search: SearchParams): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(search ?? {})) {
    const value = typeof v === "string" ? v : typeof v === "number" ? String(v) : undefined;
    if (value) out[k] = value;
  }
  return out;
};
const sameSearch = (a: SearchParams, b: SearchParams) => {
  const x = cleanSearch(a);
  const y = cleanSearch(b);
  const keys = Object.keys(x);
  return keys.length === Object.keys(y).length && keys.every((k) => x[k] === y[k]);
};

/**
 * aria-current for a navigation link: "page" only when the link opens the page being shown (path and query); a
 * section or tab lit for a sub-page (e.g. Courts on /courts/ned) is "true", because ARIA reserves "page" for the
 * current page itself.
 */
export function ariaCurrent(
  path: string,
  to: string,
  active: boolean,
  search?: SearchParams,
  linkSearch?: SearchParams,
): "page" | "true" | undefined {
  if (!active) return undefined;
  return normalizePath(path) === normalizePath(to) && sameSearch(search, linkSearch)
    ? "page"
    : "true";
}

// ------------------------------------------------------------------------------------------------ breadcrumbs

export type Crumb = {
  label: string;
  to?: string | undefined;
  search?: Record<string, string> | undefined;
};

/** Splits a crumb whose `to` carries its own query ("/x?y=1") into path and search. */
function crumbTarget(crumb: Crumb): { to: string; search: Record<string, string> } | null {
  if (crumb.to === undefined || crumb.to === "") return null;
  const [path = "", query = ""] = crumb.to.split("?");
  const search: Record<string, string> = { ...Object.fromEntries(new URLSearchParams(query)) };
  Object.assign(search, crumb.search ?? {});
  return { to: normalizePath(path), search };
}

/** Section landings, plus the former Analytics landing, which pages still name as their parent. */
const SECTION_ROOTS = new Set([...ALL_SECTIONS.map((s) => s.to), "/analytics"]);
/** Labels name the same place regardless of case ("Saved Work" and "Saved work"). */
const same = (a: string | undefined, b: string | undefined) =>
  a !== undefined && b !== undefined && a.toLowerCase() === b.toLowerCase();

/**
 * The breadcrumb trail of a page: Section › sub-area (the lit tab) › the page's own crumbs. A page's crumbs that
 * lead to the root, to another section's page, to the section itself or to the lit tab are dropped (they predate
 * the nine sections or repeat the trail); the last crumb is the current page and carries no link. Unsectioned
 * pages keep their own crumbs.
 */
export function composeBreadcrumbs(
  path: string,
  search: SearchParams,
  crumbs: readonly Crumb[],
): Crumb[] {
  const p = normalizePath(path);
  const sectionId = navigationSection(p, search);
  let out: Crumb[];
  if (!sectionId) {
    out = crumbs.map((c) => (c.label === "Home" ? { ...c, label: "Overview" } : { ...c }));
  } else {
    const section = sectionItem(sectionId);
    const tab = activeContextualTab(p, search);
    const tabIsRoot = !!tab && tab.to === section.to && !tab.search;
    out = [{ label: section.label, to: section.to }];
    if (tab && !tabIsRoot)
      out.push({
        label: tab.label,
        to: tab.to,
        ...(tab.search ? { search: { ...tab.search } } : {}),
      });
    const tabIsCurrent = !!tab && tab.to === p && sameSearch(tab.search, search);
    if (!tabIsCurrent || tabIsRoot)
      for (const [i, c] of crumbs.entries()) {
        const target = crumbTarget(c);
        // A link named like the section or the lit tab repeats the trail (e.g. a former "Sources" crumb to the library).
        if (i < crumbs.length - 1 && (same(c.label, section.label) || same(c.label, tab?.label)))
          continue;
        if (target) {
          if (target.to === "/") continue;
          if (navigationSection(target.to, target.search) !== sectionId) continue;
          if (SECTION_ROOTS.has(target.to) && !Object.keys(target.search).length) continue;
          if (tab && target.to === tab.to && sameSearch(target.search, tab.search)) continue;
          out.push({
            label: c.label,
            to: target.to,
            ...(Object.keys(target.search).length ? { search: target.search } : {}),
          });
        } else if (c.label !== "Home") out.push({ label: c.label });
      }
  }
  // Adjacent crumbs with the same label name one place: keep the later (more specific or current) one.
  const deduped = out.filter((c, i) => !same(out[i + 1]?.label, c.label));
  const last = deduped[deduped.length - 1];
  if (last) deduped[deduped.length - 1] = { label: last.label };
  return deduped;
}

// ------------------------------------------------------------------------------------------------ site directory

export type DirectoryEntry = {
  section: string;
  label: string;
  path: string;
  description: string;
};

/** Every section and tab of the site as plain entries (label, path with its query, description), for the navigator. */
export function siteDirectory(): DirectoryEntry[] {
  const out: DirectoryEntry[] = [];
  for (const s of ALL_SECTIONS)
    out.push({ section: s.label, label: s.label, path: s.to, description: s.description });
  for (const spec of SECTIONS) {
    const section = SECTION_BY_ID.get(spec.id)?.label ?? spec.id;
    for (const t of spec.tabs) {
      const query = t.search
        ? `?${new URLSearchParams(t.search as Record<string, string>).toString()}`
        : "";
      out.push({ section, label: t.label, path: `${t.to}${query}`, description: t.description });
    }
  }
  const seen = new Set<string>();
  return out.filter((e) => (seen.has(e.path) ? false : (seen.add(e.path), true)));
}
