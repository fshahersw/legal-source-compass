export const CLAIM_TYPES = [
  "personal_injury",
  "product_liability",
  "wrongful_death",
  "medical_malpractice",
  "contract_written",
  "contract_oral",
  "fraud",
  "property_damage",
] as const;
export type ClaimType = (typeof CLAIM_TYPES)[number];
export type AuthorityCapture = {
  sha256: string;
  byteLength: number;
  contentType: string;
  retrievedAt: string;
  /** Private content-addressed object holding the exact bytes of the official response. */
  storageBucket?: string;
  storageKey?: string;
};
export const LIMITATION_SOURCE_AUTHORITY_KINDS = [
  "statute",
  "constitution",
  "legislative_history",
  "publisher_guidance",
  "publisher_table",
] as const;
export type LimitationSourceAuthorityKind = (typeof LIMITATION_SOURCE_AUTHORITY_KINDS)[number];
export const CLAIM_LABELS: Record<ClaimType, string> = {
  personal_injury: "Ordinary personal injury",
  product_liability: "Product / mass-tort injury",
  wrongful_death: "Wrongful death",
  medical_malpractice: "Medical malpractice",
  contract_written: "Breach of written contract",
  contract_oral: "Breach of oral contract",
  fraud: "Fraud / misrepresentation",
  property_damage: "Property damage",
};

export type PeriodUnit = "calendar_years" | "calendar_months" | "calendar_days";

/** Primary-source evidence recorded for a backfilled rule. Every field is optional-by-"Not recorded", never guessed. */
export type RuleProvenance = {
  citation: string;
  excerpt: string;
  periodEvidence: string;
  accrualKind:
    | "accrual"
    | "discovery"
    | "occurrence"
    | "death"
    | "treatment_end"
    | "breach"
    | "other"
    | "not_recorded";
  accrualText: string;
  tolling: { text: string; citation: string }[];
  repose: { years: number; citation: string; trigger: string; effectiveFrom: string | null }[];
  lastAmended: { text: string; date: string | null };
  effectiveDate: string | null;
  retrievedAt: string;
  entryStatus: "verified" | "flagged";
  confidence: "high" | "medium" | "low";
  confidenceNote: string;
  flags: string[];
  crossCheckSourceIds: string[];
};

/** State rule for a limitations period whose last day falls on a weekend or legal holiday. */
export type TimeComputationRule = {
  status: "verified" | "flagged";
  extendsWhenLastDayIsWeekend: boolean;
  extendsWhenLastDayIsHoliday: boolean | null;
  citation: string;
  excerpt: string;
  sourceId: string;
  retrievedAt: string;
  note: string;
};

export const VERIFICATION_GRADES = [
  "independently_verified",
  "official_capture_verified",
  "lower_evidence_grade",
] as const;
export type VerificationGrade = (typeof VERIFICATION_GRADES)[number];
export const VERIFICATION_GRADE_LABELS: Record<VerificationGrade, string> = {
  independently_verified: "Independently verified",
  official_capture_verified: "Verified from official capture",
  lower_evidence_grade: "Lower evidence grade",
};

/** How strongly a rule's content was checked against official text. Never implies legal sign-off. */
export type RuleVerification = {
  grade: VerificationGrade;
  basis: string;
  verifiedRuleVersion?: string;
  verifiedOn?: string;
};

export type ClaimCoverageStatus = "baseline" | "research_only" | "flagged" | "not_recorded";
export type ClaimVariantCoverage = {
  subtype: string;
  ruleId: string;
  status: ClaimCoverageStatus;
};

/** Status of the claim type's GENERAL rule. Variants compute only when selected and never stand in for it. */
export type ClaimCoverage = {
  claimType: ClaimType;
  status: ClaimCoverageStatus;
  ruleId?: string;
  reason?: string;
  grade?: VerificationGrade;
  variants?: ClaimVariantCoverage[];
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
  period: { amount: number; unit: PeriodUnit } | null;
  provenance?: RuleProvenance;
  verification?: RuleVerification;
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
    reposeTrigger?: "last_act_or_omission" | "act_or_omission" | "first_delivery";
    reposeEffectiveFrom?: string;
    reposeEffectiveThrough?: string;
  };
};
/** How the official page was obtained. A proxied fetch is used only where the official host blocks direct requests. */
export type FetchRoute = { kind: "direct" | "proxied" | "extraction"; proxy?: string };

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
  authorityKind: LimitationSourceAuthorityKind;
  validity: string;
  historicalApplicability: string;
  rawCapture?: AuthorityCapture;
  fetchRoute?: FetchRoute;
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
  claimCoverage?: ClaimCoverage[];
  timeComputation?: TimeComputationRule;
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
  textScope?: string;
  textPath: string;
  sha256: string;
  byteLength: number;
  capturedAt: string;
  pdfDownloaded: boolean;
  rawCapture?: AuthorityCapture;
  fetchRoute?: FetchRoute;
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
      "Tolling: alleged crimes, emergency orders, concealment, agreements, class actions or bankruptcy",
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
  /** Next weekday when the anniversary is a Saturday or Sunday and the state's recorded rule extends it. */
  adjustedDate?: { date: string; citation: string; holidaysComputed: false } | null;
  rule: LimitationRule | null;
  reasons: string[];
  steps: { text: string; sourceIds: string[]; pinpoint: string }[];
};
