/**
 * The blocks of the Analytics overview (/analytics): which trends it shows, how they are grouped, what each one
 * counts and which detailed page it links to. Client-safe, so the page can lay out and label every block before any
 * data arrives. The data itself comes from `getAnalyticsBlock` (overview.functions.ts).
 */

export type BlockGroupId =
  "courts" | "enforcement" | "safety" | "consumer" | "rulemaking" | "judiciary";

export type BlockDetailLink = {
  /** In-app path, no query string. */
  to: string;
  search?: Record<string, string>;
  label: string;
};

export type BlockDef = {
  id: string;
  group: BlockGroupId;
  /** Says what is counted. */
  title: string;
  /** Short name of the measure for aria labels and the "show data" table caption. */
  measure: string;
  detail: BlockDetailLink;
};

export const BLOCK_GROUPS: readonly { id: BlockGroupId; title: string; lede: string }[] = [
  {
    id: "courts",
    title: "Federal courts and litigation",
    lede: "Civil and criminal filings, multidistrict litigation and securities class actions, by year.",
  },
  {
    id: "enforcement",
    title: "Enforcement activity",
    lede: "What federal agencies published or recorded each year. Counts are of published items, not of every action taken.",
  },
  {
    id: "safety",
    title: "Recalls and adverse events",
    lede: "Recalls by agency and adverse-event reports. Reports are submissions, not confirmed causes.",
  },
  {
    id: "consumer",
    title: "Consumer complaints",
    lede: "Complaints and reports consumers filed with federal agencies. They are not findings of wrongdoing.",
  },
  {
    id: "rulemaking",
    title: "Rulemaking and legislation",
    lede: "Federal Register documents and bills introduced and enacted in Congress.",
  },
  {
    id: "judiciary",
    title: "Federal judiciary",
    lede: "Judgeships vacant and nominations received by the Senate.",
  },
];

export const BLOCKS: readonly BlockDef[] = [
  {
    id: "federal-civil",
    group: "courts",
    title: "Federal civil cases filed and terminated",
    measure: "civil cases",
    detail: { to: "/courts/caseload", label: "Federal civil caseload" },
  },
  {
    id: "federal-criminal",
    group: "courts",
    title: "Federal criminal defendants filed and terminated",
    measure: "criminal defendants",
    detail: { to: "/records/fjc_criminal_districts/national", label: "National criminal record" },
  },
  {
    id: "mdl-pending",
    group: "courts",
    title: "Actions pending in multidistrict litigation, end of fiscal year",
    measure: "actions pending in MDLs",
    detail: { to: "/matters/analytics", label: "MDL analytics" },
  },
  {
    id: "securities-class-actions",
    group: "courts",
    title: "Federal securities class action filings",
    measure: "securities class action filings",
    detail: { to: "/courts/securities", label: "Securities suits" },
  },
  {
    id: "doj-press",
    group: "enforcement",
    title: "Department of Justice press releases published",
    measure: "DOJ press releases",
    detail: { to: "/law/enforcement", search: { actions: "doj" }, label: "DOJ press releases" },
  },
  {
    id: "sec-releases",
    group: "enforcement",
    title: "SEC litigation releases and administrative proceedings published",
    measure: "SEC releases",
    detail: { to: "/law/enforcement", search: { actions: "sec" }, label: "SEC actions" },
  },
  {
    id: "ftc-actions",
    group: "enforcement",
    title: "FTC actions listed in its enforcement data sets",
    measure: "FTC actions",
    detail: { to: "/law/enforcement", search: { actions: "ftc" }, label: "FTC cases and actions" },
  },
  {
    id: "epa-cases",
    group: "enforcement",
    title: "EPA civil enforcement cases opened",
    measure: "EPA cases opened",
    detail: { to: "/law/enforcement", label: "EPA enforcement" },
  },
  {
    id: "osha-inspections",
    group: "enforcement",
    title: "OSHA inspections",
    measure: "OSHA inspections",
    detail: { to: "/law/enforcement", search: { tab: "osha" }, label: "Workplace safety (OSHA)" },
  },
  {
    id: "cpsc-recalls",
    group: "safety",
    title: "Consumer product recalls announced by CPSC",
    measure: "CPSC recalls",
    detail: { to: "/law/enforcement", search: { tab: "cpsc" }, label: "CPSC recalls" },
  },
  {
    id: "nhtsa-recalls",
    group: "safety",
    title: "Vehicle and equipment recall campaigns (NHTSA)",
    measure: "NHTSA recall campaigns",
    detail: { to: "/safety", search: { agency: "NHTSA" }, label: "NHTSA safety records" },
  },
  {
    id: "fsis-recalls",
    group: "safety",
    title: "Meat, poultry and egg product recalls (USDA FSIS)",
    measure: "FSIS recalls",
    detail: { to: "/safety", label: "Product safety" },
  },
  {
    id: "fda-recalls",
    group: "safety",
    title: "FDA recall enforcement-report entries (drug, device, food)",
    measure: "FDA recall enforcement-report entries",
    detail: { to: "/safety", search: { agency: "FDA" }, label: "FDA safety records" },
  },
  {
    id: "faers",
    group: "safety",
    title: "Drug adverse-event reports received by FDA (FAERS)",
    measure: "FAERS reports",
    detail: { to: "/law/monitoring", label: "Regulatory intelligence" },
  },
  {
    id: "caers",
    group: "safety",
    title: "Food, supplement and cosmetic adverse-event reports (FDA CAERS)",
    measure: "CAERS reports",
    detail: { to: "/law/monitoring", label: "Regulatory intelligence" },
  },
  {
    id: "cfpb-complaints",
    group: "consumer",
    title: "Consumer complaints received by the CFPB",
    measure: "CFPB complaints",
    detail: { to: "/law/enforcement", search: { tab: "cfpb" }, label: "CFPB complaints" },
  },
  {
    id: "ftc-sentinel",
    group: "consumer",
    title: "Consumer Sentinel reports received by the FTC",
    measure: "Consumer Sentinel reports",
    detail: { to: "/data/ftc_sentinel_national", label: "Consumer Sentinel dataset" },
  },
  {
    id: "federal-register",
    group: "rulemaking",
    title: "Federal Register final rules and proposed rules published",
    measure: "Federal Register rules and proposed rules",
    detail: { to: "/agencies", label: "Federal agencies" },
  },
  {
    id: "congress-bills",
    group: "rulemaking",
    title: "Bills and joint resolutions introduced, and bills that became law",
    measure: "bills and joint resolutions",
    detail: { to: "/data/congress_bills", label: "Congressional bills dataset" },
  },
  {
    id: "judicial-vacancies",
    group: "judiciary",
    title: "Federal judgeships vacant, by monthly vacancy list",
    measure: "judicial vacancies listed",
    detail: { to: "/courts/vacancies", label: "Judicial vacancies" },
  },
  {
    id: "judicial-nominations",
    group: "judiciary",
    title: "Judicial nominations received by the Senate, and confirmed",
    measure: "judicial nominations",
    detail: { to: "/courts/vacancies", label: "Judicial vacancies" },
  },
];

export const BLOCK_IDS = BLOCKS.map((b) => b.id) as [string, ...string[]];

export function blocksInGroup(group: BlockGroupId): BlockDef[] {
  return BLOCKS.filter((b) => b.group === group);
}

export function blockDef(id: string): BlockDef | undefined {
  return BLOCKS.find((b) => b.id === id);
}
