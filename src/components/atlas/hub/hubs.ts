/**
 * What each section's landing shows: a few headline record counts and a link into every sub-area. Every number is the
 * record count the corpus catalog stores for one named dataset (corpus_datasets.imported_records, read through the
 * existing listDatasets server function); counts are never added across datasets, and a dataset missing from the
 * catalog drops its figure instead of showing a guess. The label says what one record is.
 */
import type { PrimarySection } from "@/lib/atlas/navigation";

export type HubCount = { dataset: string; label: string };
export type HubLink = {
  to: string;
  search?: Record<string, string>;
  label: string;
  description: string;
  counts?: readonly HubCount[];
  /** The link leads to another section (shown with that section's name). */
  elsewhere?: PrimarySection;
};
export type HubSpec = { kpis: readonly HubCount[]; links: readonly HubLink[] };

export const HUBS: Readonly<Record<Exclude<PrimarySection, "insights">, HubSpec>> = {
  overview: {
    kpis: [
      { dataset: "court_spine", label: "Courts in the court directory" },
      { dataset: "judges", label: "Judges in the judge directory" },
      { dataset: "cl_docket_metadata", label: "Federal dockets with recorded metadata" },
      { dataset: "congress_bills", label: "Bills and resolutions in Congress since 2003" },
      { dataset: "sec_enforcement_actions", label: "SEC enforcement actions" },
      { dataset: "agency_safety_cpsc_recalls_api", label: "CPSC recalls" },
    ],
    links: [
      {
        to: "/places",
        label: "Places",
        description: "States, counties and cities on the map, then each state's full page.",
        counts: [{ dataset: "county_profiles", label: "county profiles" }],
        elsewhere: "places",
      },
      {
        to: "/courts",
        label: "Courts & judges",
        description: "Every court and judge, caseloads, vacancies and comparisons.",
        counts: [{ dataset: "court_spine", label: "courts" }],
        elsewhere: "courts",
      },
      {
        to: "/litigation",
        label: "Litigation",
        description:
          "Case law, MDLs and mass torts, dockets, securities suits, firms, settlements.",
        counts: [{ dataset: "mdls", label: "MDLs in the JPML collection" }],
        elsewhere: "litigation",
      },
      {
        to: "/law",
        label: "Law & government",
        description: "U.S. Code, CFR, state law, legislation, rulemaking, time limits, agencies.",
        counts: [{ dataset: "us_code_sections", label: "U.S. Code sections" }],
        elsewhere: "law",
      },
      {
        to: "/enforcement",
        label: "Enforcement",
        description: "Agency actions, exclusions, oversight reports and merger review.",
        counts: [{ dataset: "oversight_reports", label: "Inspector General reports" }],
        elsewhere: "enforcement",
      },
      {
        to: "/safety",
        label: "Products & safety",
        description: "Recalls, adverse events, injury estimates, consumer reports and signals.",
        counts: [{ dataset: "agency_safety_nhtsa_recalls", label: "NHTSA recalls" }],
        elsewhere: "safety",
      },
      {
        to: "/companies",
        label: "Companies",
        description: "MDL defendants from their SEC filings, and industry payments to clinicians.",
        counts: [{ dataset: "company_sec_profiles", label: "company profiles" }],
        elsewhere: "companies",
      },
      {
        to: "/insights",
        label: "Insights",
        description: "Metrics, trends, rankings, maps and signals across the platform's data.",
        elsewhere: "insights",
      },
    ],
  },
  places: {
    kpis: [
      { dataset: "state_metrics_profiles", label: "State metric profiles" },
      { dataset: "county_profiles", label: "County profiles" },
      { dataset: "city_profiles", label: "City and place profiles" },
      { dataset: "county_legal_activity", label: "Counties with legal-activity figures" },
    ],
    links: [
      {
        to: "/places/analytics",
        label: "Compare",
        description: "States side by side: rankings, per-capita figures and cross-state analysis.",
        counts: [{ dataset: "state_cross_analysis", label: "cross-state analysis rows" }],
      },
      {
        to: "/places",
        search: { layer: "counties" },
        label: "County map",
        description: "Shade the counties by any metric that has county figures.",
        counts: [{ dataset: "county_profiles", label: "county profiles" }],
      },
    ],
  },
  courts: {
    kpis: [
      { dataset: "court_spine", label: "Courts in the court directory" },
      { dataset: "judges", label: "Judges in the judge directory" },
      { dataset: "judge_profiles_fjc", label: "Article III judges" },
      { dataset: "judicial_nominations", label: "Nominations to federal judgeships, 1981–2026" },
      {
        dataset: "judicial_vacancies",
        label: "Vacancy, emergency and confirmation records, 1981–2026",
      },
    ],
    links: [
      {
        to: "/judges",
        label: "Judges",
        description: "Judicial profiles by court system, state and court, including past service.",
        counts: [{ dataset: "judges", label: "judges" }],
      },
      {
        to: "/courts/caseload",
        label: "Caseload",
        description: "Federal civil caseload from the FJC Integrated Database.",
        counts: [{ dataset: "fjc_civil_districts", label: "district courts, FY1988–FY2026" }],
      },
      {
        to: "/courts/vacancies",
        label: "Vacancies",
        description: "Current and future vacancies, judicial emergencies and confirmations.",
        counts: [{ dataset: "judicial_vacancies", label: "vacancy records" }],
      },
      {
        to: "/courts/analytics",
        label: "Compare courts",
        description: "District courts side by side: filings, terminations, pending and timing.",
        counts: [{ dataset: "fcms_court_profiles", label: "court-period caseload profiles" }],
      },
      {
        to: "/judges/analytics",
        label: "Compare judges",
        description: "MDL transferee judges and their dockets.",
      },
    ],
  },
  litigation: {
    kpis: [
      { dataset: "cl_docket_metadata", label: "Federal dockets with recorded metadata" },
      { dataset: "mdls", label: "MDLs in the JPML collection" },
      { dataset: "firm_profiles", label: "Law firms on MDL master dockets" },
      { dataset: "settlement_claims_official", label: "Settlements confirmed on official pages" },
      { dataset: "settlement_notices", label: "Settlement notices" },
    ],
    links: [
      {
        to: "/cases",
        label: "Case law",
        description:
          "Supreme Court, federal appeals and state high-court opinions: name, citation and text search, with a citator.",
      },
      {
        to: "/matters/analytics",
        label: "MDLs & mass torts",
        description:
          "Pending MDLs over time, centralization, transferee courts, and one lens per MDL number.",
        counts: [
          { dataset: "jpml_pending_history_mdls", label: "MDLs in the JPML pending history" },
        ],
      },
      {
        to: "/courts/collection",
        label: "Dockets",
        description:
          "CourtListener's docket collection by year, court, state and nature of suit; citations and disclosures.",
        counts: [{ dataset: "clb_docket_master", label: "docket statistics rows" }],
      },
      {
        to: "/litigation/documents",
        label: "Court filings",
        description:
          "Full-text search of the MDL filings the matter pages list: open filings only, with sealed or redacted material left out.",
      },
      {
        to: "/courts/securities",
        label: "Securities class actions",
        description:
          "Federal securities class action filings since 1996: years, circuits, sectors, outcomes and settlements.",
      },
      {
        to: "/courts/firms",
        label: "Law firms",
        description: "Who appears on MDL master dockets, on which side, with and against whom.",
        counts: [{ dataset: "firm_profiles", label: "law firms" }],
      },
      {
        to: "/litigation/settlements",
        label: "Settlements",
        description:
          "Class settlements confirmed on official pages, with deadlines and courts, and published settlement notices.",
        counts: [
          { dataset: "settlement_claims_official", label: "confirmed settlements" },
          { dataset: "settlement_notices", label: "notices" },
        ],
      },
      {
        to: "/matters",
        label: "Matters workspace",
        description:
          "Priority MDLs with master dockets, member cases, docket entries, documents and counsel.",
        counts: [{ dataset: "mdl_case_inventory", label: "MDL case inventory rows" }],
      },
      {
        to: "/registry",
        label: "Case registry",
        description: "Verified matters with parties, attorneys, outcomes and docket documents.",
      },
    ],
  },
  law: {
    kpis: [
      { dataset: "us_code_sections", label: "U.S. Code sections" },
      { dataset: "ecfr_sections_full", label: "CFR sections, full current text" },
      { dataset: "congress_bills", label: "Bills and resolutions in Congress since 2003" },
      { dataset: "state_bills", label: "State bills, current and preceding session" },
      { dataset: "state_constitution_sections", label: "State constitution sections" },
      { dataset: "court_rule_sections", label: "Court rules, rule by rule" },
    ],
    links: [
      {
        to: "/law",
        search: { scope: "federal" },
        label: "Federal law",
        description:
          "The United States Code, the Code of Federal Regulations and federal record sets.",
        counts: [
          { dataset: "us_code_sections", label: "U.S. Code sections" },
          { dataset: "ecfr_sections_full", label: "CFR sections" },
        ],
      },
      {
        to: "/law",
        search: { scope: "states" },
        label: "State law",
        description:
          "State codes, constitutions, administrative codes and court rules, state by state.",
        counts: [
          { dataset: "state_constitution_sections", label: "constitution sections" },
          { dataset: "state_regulation_index", label: "administrative-code entries" },
        ],
      },
      {
        to: "/law/legislation",
        label: "Legislation & Congress",
        description: "Federal and state bills, members of Congress and committees.",
        counts: [
          { dataset: "congress_bills", label: "federal bills" },
          { dataset: "congress_members", label: "members of Congress" },
        ],
      },
      {
        to: "/law/rulemaking",
        label: "Rulemaking",
        description:
          "Federal Register rules, proposed rules and notices by agency, and the Unified Agenda.",
        counts: [{ dataset: "unified_agenda_pipeline", label: "Unified Agenda actions" }],
      },
      {
        to: "/limitations",
        label: "Time limits",
        description:
          "Statutes of limitation with cited rules, a guided calculator and state coverage.",
        counts: [{ dataset: "limitation_periods", label: "limitation periods" }],
      },
      {
        to: "/agencies",
        label: "Agencies",
        description:
          "Federal agencies: structure, CFR footprint, rulemaking, budgets and enforcement.",
        counts: [{ dataset: "fr_agency_profiles", label: "agency profiles" }],
      },
    ],
  },
  enforcement: {
    kpis: [
      { dataset: "sec_enforcement_actions", label: "SEC enforcement actions" },
      { dataset: "ftc_cases", label: "FTC cases and proceedings" },
      {
        dataset: "frb_enforcement_actions",
        label: "Federal Reserve enforcement actions, 1989–2026",
      },
      {
        dataset: "regulatory_epa_cases",
        label: "EPA cases with a federal penalty of $100,000 or more",
      },
      { dataset: "oig_leie_exclusions", label: "HHS-OIG exclusions (LEIE)" },
      { dataset: "oversight_reports", label: "Inspector General reports" },
    ],
    links: [
      {
        to: "/enforcement",
        search: { tab: "actions" },
        label: "Actions by agency",
        description:
          "DOJ, FTC, SEC, Federal Reserve, EPA, OSHA, CPSC and CFPB: each agency's own published actions and data.",
        counts: [
          { dataset: "sec_enforcement_actions", label: "SEC actions" },
          { dataset: "ftc_cases", label: "FTC cases" },
        ],
      },
      {
        to: "/enforcement",
        search: { tab: "exclusions" },
        label: "Exclusions",
        description:
          "Debarred, suspended and excluded individuals and entities (SAM.gov, HHS-OIG LEIE).",
        counts: [
          { dataset: "sam_exclusions", label: "SAM.gov exclusions" },
          { dataset: "oig_leie_exclusions", label: "LEIE exclusions" },
        ],
      },
      {
        to: "/enforcement",
        search: { tab: "oversight" },
        label: "Oversight reports",
        description:
          "Inspector General reports, DOJ OIG reports and Office of Special Counsel files.",
        counts: [
          { dataset: "oversight_reports", label: "IG reports" },
          { dataset: "doj_oig_reports", label: "DOJ OIG reports" },
        ],
      },
      {
        to: "/enforcement",
        search: { tab: "merger" },
        label: "Merger review",
        description: "Hart-Scott-Rodino filings and early termination notices from the FTC.",
        counts: [{ dataset: "ftc_hsr_early_terminations", label: "early termination notices" }],
      },
      {
        to: "/enforcement",
        search: { tab: "sources" },
        label: "Agency data sources",
        description: "Every enforcement data source, what it covers and where it is published.",
        counts: [{ dataset: "enforcement_data_sources_catalog", label: "catalogued sources" }],
      },
      {
        to: "/litigation/settlements",
        label: "Settlements",
        description: "Confirmed settlements and settlement notices are in Litigation.",
        counts: [{ dataset: "settlement_claims_official", label: "confirmed settlements" }],
        elsewhere: "litigation",
      },
      {
        to: "/law/rulemaking",
        label: "Federal rulemaking",
        description: "Rules, proposed rules and notices by agency are in Law & government.",
        elsewhere: "law",
      },
    ],
  },
  safety: {
    kpis: [
      { dataset: "agency_safety_cpsc_recalls_api", label: "CPSC recalls" },
      {
        dataset: "agency_safety_nhtsa_recalls",
        label: "NHTSA vehicle and equipment recalls since 2010",
      },
      { dataset: "agency_safety_openfda_drug_enforcement", label: "FDA drug enforcement reports" },
      {
        dataset: "agency_safety_openfda_device_enforcement",
        label: "FDA device enforcement reports",
      },
      { dataset: "agency_safety_openfda_food_enforcement", label: "FDA food enforcement reports" },
      { dataset: "fsis_recalls", label: "FSIS recalls and public health alerts, 2014–2026" },
    ],
    links: [
      {
        to: "/law/monitoring",
        label: "Regulatory intelligence",
        description:
          "Recall patterns, repeat-recall firms, FDA analytics and regulatory source changes.",
        counts: [{ dataset: "recall_patterns", label: "recall-pattern rows" }],
      },
      {
        to: "/safety",
        search: { view: "neiss" },
        label: "Injuries (NEISS)",
        description:
          "Weighted national estimates of emergency-department-treated product injuries.",
        counts: [{ dataset: "neiss_product_estimates", label: "product codes with estimates" }],
      },
      {
        to: "/safety",
        search: { view: "reports" },
        label: "Consumer reports",
        description: "Unverified consumer reports published on SaferProducts.gov, by product.",
        counts: [{ dataset: "saferproducts_products", label: "product classifications" }],
      },
      {
        to: "/safety/signals",
        label: "Signals",
        description:
          "Mass-tort products next to adverse events, recalls and complaints; report growth.",
        counts: [
          { dataset: "agency_safety_mass_tort_signals", label: "mass-tort product signals" },
        ],
      },
      {
        to: "/safety/products",
        label: "Products & devices",
        description:
          "Monthly FDA adverse-event and device reports, reactions, recalls and complaints for MDL-named products, drugs and devices.",
        counts: [{ dataset: "safety_mdl_products", label: "MDL product groups" }],
      },
      {
        to: "/safety",
        search: { view: "list" },
        label: "Collections",
        description: "Every recall, enforcement, approval and classification collection by agency.",
        counts: [
          { dataset: "agency_safety_openfda_drugsfda", label: "Drugs@FDA approvals" },
          { dataset: "agency_safety_openfda_device_pma", label: "device PMA approvals" },
        ],
      },
    ],
  },
  companies: {
    kpis: [
      { dataset: "company_sec_profiles", label: "Companies profiled from their SEC filings" },
      { dataset: "company_sec_mdl_links", label: "Company–MDL links from SEC filings" },
      {
        dataset: "company_payments_manufacturers",
        label: "Manufacturers in the Open Payments ranking",
      },
      { dataset: "company_adverse_manufacturers", label: "Manufacturers matched to MAUDE reports" },
    ],
    links: [
      {
        to: "/companies/payments",
        label: "Industry payments",
        description:
          "What drug and device manufacturers paid clinicians, 2017–2025 (CMS Open Payments).",
        counts: [{ dataset: "company_payments_manufacturers", label: "manufacturers" }],
      },
    ],
  },
};
