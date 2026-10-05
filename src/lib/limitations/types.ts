export const CLAIM_TYPES = ["personal_injury", "product_liability", "wrongful_death"] as const;
export type ClaimType = (typeof CLAIM_TYPES)[number];
export type AuthorityCapture = {
  sha256: string;
  byteLength: number;
  contentType: string;
  retrievedAt: string;
};
export const CLAIM_LABELS: Record<ClaimType, string> = {
  personal_injury: "Ordinary personal injury",
  product_liability: "Product / mass-tort injury",
  wrongful_death: "Wrongful death",
};

export type LimitationRule = {
  id: string;
  schemaVersion: string;
  ruleVersion: string;
  jurisdiction: string;
  claimType: ClaimType;
  ruleKind:
    | "limitations"
    | "repose"
    | "accrual"
    | "tolling"
    | "borrowing"
    | "validity"
    | "counting"
    | "transition";
  computation: "baseline_only" | "research_only";
  reviewStatus: "statutory_text_verified";
  period: { amount: number; unit: "calendar_years" } | null;
  sourceIds: string[];
  pinpoint: string;
  scope: string;
  accrualBasis: "confirmed_accrual" | "death" | "discovery_of_death" | "requires_review";
  conditions: string[];
  exclusions: string[];
  effectiveFrom: string | null;
  effectiveThrough: string | null;
  validity: string;
  historicalApplicability: string;
  summary: string;
  warnings: string[];
  caseReferenceIds?: string[];
  subtype?: string;
  calculation?: {
    mode: "discovery_min" | "diagnosis" | "death_cause_min" | "accrual_repose_min";
    deathCapYears?: number;
    secondaryCapYears?: number;
    requiresExposureWithinDeliveryYears?: number;
    reposeYears?: number;
    reposeTrigger?: "last_act_or_omission" | "act_or_omission";
    reposeEffectiveFrom?: string;
    reposeEffectiveThrough?: string;
  };
};
export type LimitationSource = {
  id: string;
  state: string;
  title: string;
  publisher: string;
  url: string;
  method: string;
  schemaVersion: string;
  capturedAt: string;
  verifiedAt: string;
  textPath: string;
  sha256: string;
  byteLength: number;
  authorityKind: "statute";
  validity: string;
  historicalApplicability: string;
  rawCapture?: AuthorityCapture;
};
export type CoverageRow = {
  state: string;
  name: string;
  sourceStatus: "primary_text_retrieved" | "primary_text_pending";
  sourceIds: string[];
  baselineRuleIds: string[];
  researchRuleIds: string[];
  coverage: "conditional_baselines" | "research_only" | "pending";
  discoverySource: string;
  discoveryLinks: { title: string; url: string }[];
  gaps: string[];
  publisherLinks: { title: string; url: string; status: string }[];
  metadataOnlyReferences: { title: string; url: string; format: string; note: string }[];
};
export type JudicialReference = {
  id: string;
  jurisdiction: string;
  title: string;
  citation: string;
  court: string;
  decidedAt: string;
  pinpoint: string;
  url: string;
  copyPublisher: string;
  officialPdfUrl?: string;
  holding: string;
  applicationLimits: string;
  subsequentTreatment: string;
  textPath: string;
  sha256: string;
  byteLength: number;
  capturedAt: string;
  pdfDownloaded: boolean;
  rawCapture?: AuthorityCapture;
};
export type LimitationsSnapshot = {
  schemaVersion: "1.0.0";
  ruleVersion: string;
  snapshotDate: string;
  reviewMeaning: string;
  dateMeaning: string;
  rules: LimitationRule[];
  sources: LimitationSource[];
  coverage: CoverageRow[];
  cases: JudicialReference[];
};

export const SPECIAL_ISSUES = [
  {
    id: "latent_exposure",
    label: "Unresolved latent disease / toxic exposure / discovery question",
  },
  {
    id: "product_repose",
    label: "Unresolved product delivery / sale, warranty or repose question",
  },
  { id: "disability", label: "Minority, legal disability or servicemember protection" },
  {
    id: "tolling",
    label:
      "Tolling: criminal proceedings, emergency orders, concealment, agreements, class actions or bankruptcy",
  },
  {
    id: "prior_filing",
    label: "Prior filing, dismissal, nonsuit, MDL order or registry submission",
  },
  {
    id: "foreign_law",
    label: "Another state's law, borrowing statute or transfer / direct filing",
  },
  {
    id: "special_claim",
    label: "Government, medical care, intentional act or special statutory claim",
  },
  {
    id: "death_exception",
    label: "Occupational-disease death, homicide, expired underlying claim or representative issue",
  },
] as const;
export type SpecialIssue = (typeof SPECIAL_ISSUES)[number]["id"];
export type BaselineInput = {
  jurisdiction: string;
  claimType: ClaimType;
  accrualDate: string;
  subtype?: string;
  actualDiscoveryDate?: string;
  constructiveDiscoveryDate?: string;
  diagnosisCommunicationDate?: string;
  causeDiscoveryDate?: string;
  deathDate?: string;
  vitalStatus?: "alive" | "deceased" | "unknown";
  firstProductDeliveryDate?: string;
  qualifyingExposureDate?: string;
  reposeActDate?: string;
  reposeApplicabilityConfirmed?: boolean;
  governingLawConfirmed: boolean;
  accrualConfirmed: boolean;
  applicabilityConfirmed: boolean;
  exceptionReview: "unresolved" | "no_unresolved_issues";
  issues: SpecialIssue[];
};
export type BaselineResult = {
  status: "baseline" | "needs_review" | "invalid";
  date: string | null;
  rule: LimitationRule | null;
  reasons: string[];
  steps: { text: string; sourceIds: string[]; pinpoint: string }[];
};
