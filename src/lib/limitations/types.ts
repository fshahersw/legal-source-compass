export const CLAIM_TYPES = [
  "personal_injury",
  "product_liability",
  "wrongful_death",
  "medical_malpractice",
  "contract_written",
  "contract_oral",
  "fraud",
  "property_damage",
  "defamation",
  "intentional_tort",
  "breach_of_warranty",
  "legal_malpractice",
] as const;
/** Claim types added in release 2026-10-08.1; their cells read "Not recorded" until an official-text entry exists. */
export const CLAIM_TYPES_ADDED_2026_10_08: readonly ClaimType[] = [
  "defamation",
  "intentional_tort",
  "breach_of_warranty",
  "legal_malpractice",
];
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
  defamation: "Defamation (libel / slander)",
  intentional_tort: "Intentional tort (assault, battery, false imprisonment)",
  breach_of_warranty: "Breach of warranty (sale of goods)",
  legal_malpractice: "Legal malpractice",
};

/**
 * Result of re-fetching an official source after its capture. "evidence" means the literal statutory
 * passages the release relies on from that source (rule excerpt, period words, tolling and repose text).
 */
export const SOURCE_CURRENCY_STATUSES = [
  "confirmed_unchanged",
  "confirmed_evidence_intact",
  "evidence_lost",
  "not_rechecked",
] as const;
export type SourceCurrencyStatus = (typeof SOURCE_CURRENCY_STATUSES)[number];
/**
 * Provenance of a recheck made against the publisher's current section text as landed by the full-code
 * intake (reviewed, projection on). Every value is copied from the intake's own coverage record.
 */
export type CodeCaptureProvenance = {
  jurisdiction: string;
  publisher: string;
  /** Intake run that landed the text the passages were matched against. */
  runId: string | null;
  manifestSha256: string | null;
  landedAt: string | null;
  /** Native ids (`ST:<citation path>`) of the sections whose text was searched. */
  sectionNativeIds: string[];
  /** Official page URLs the intake recorded for those sections. */
  sourceUrls: string[];
};
export type SourceCurrency = {
  checkedAt: string;
  status: SourceCurrencyStatus;
  /**
   * How the fresh copy was obtained: "direct" is a fresh fetch of the source URL; "official_code_capture" is
   * the same publisher's current section text as landed by the full-code intake; "proxied" is the same
   * official URL re-read through a fetch proxy (extracted text, proxy response retained as the raw copy);
   * "none" when no route yielded a copy from the review environment.
   */
  route: "direct" | "official_code_capture" | "proxied" | "none";
  detail: string;
  httpStatus?: number;
  rawSha256?: string;
  textSha256?: string;
  /** Private content-addressed copy of the fresh official response, when one was retrieved. */
  rawStorageKey?: string;
  /** Bundle text of the fresh copy when the page changed; the source's own textPath stays the verified capture. */
  freshTextPath?: string;
  /** Present only when route is "official_code_capture". */
  codeCapture?: CodeCaptureProvenance;
  /**
   * Present only on a direct-route verdict for a composite source (a builder-made concatenation of other
   * sources' official pages): the component source ids whose own text-identical direct re-reads the verdict
   * is derived from. The composite itself was not fetched again.
   */
  componentSourceIds?: string[];
  /**
   * A second, passage-level comparison made through the proxy route when the page-level verdict above came
   * another way (or compared no passage): the same official URL as the proxy returned it, retained byte-for-byte,
   * holding every quoted passage then relied on from this source. It never changes `status` or `route`.
   */
  passageRecheck?: PassageRecheck;
};

export type PassageRecheck = {
  checkedAt: string;
  route: "proxied";
  proxy: string;
  rawSha256: string;
  textSha256?: string;
  rawStorageKey: string;
  freshTextPath?: string;
  /** Number of quoted passages compared; every one was found (a missing passage records no passageRecheck). */
  passages: number;
  detail: string;
};

export const RULE_CURRENCY_STATUSES = [
  "confirmed",
  "partially_confirmed",
  "evidence_lost",
  "not_rechecked",
] as const;
export type RuleCurrencyStatus = (typeof RULE_CURRENCY_STATUSES)[number];
/** Roll-up of the currency checks of every source a rule's literal evidence is drawn from. */
export type RuleCurrency = {
  checkedAt: string;
  status: RuleCurrencyStatus;
  detail: string;
  /** Sources whose fresh official copy still contains the rule's evidence. */
  confirmedSourceIds: string[];
  /** Sources that could not be re-read from the review environment. */
  uncheckedSourceIds: string[];
  /** Sources whose fresh official copy no longer contains the rule's evidence. */
  lostSourceIds: string[];
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
  /** Further official captures the note relies on (e.g. the holiday-definition section). */
  supportingSourceIds?: string[];
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

/**
 * What a limitations rule's period actually rests on. "claim_specific" means the cited provision names this
 * claim (or a category that plainly contains it) in the official text. "general_period" means the state's
 * general civil or tort limitation statute is the closest provision found and no provision naming this claim
 * exists in the reviewed official text: the period is quoted literally, but mapping it onto the claim is a
 * judgement the site is making, not a statement the statute makes. Absent on rules released before the
 * field existed — every one of those named the claim.
 */
export const RULE_BASES = ["claim_specific", "general_period"] as const;
export type RuleBasis = (typeof RULE_BASES)[number];
export const RULE_BASIS_LABELS: Record<RuleBasis, string> = {
  claim_specific: "A statute names this claim",
  general_period: "General period — no claim-specific statute found",
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
  /** Copied from the rule behind the cell: claim-specific or the general period standing in. */
  basis?: RuleBasis;
  ruleId?: string;
  reason?: string;
  grade?: VerificationGrade;
  variants?: ClaimVariantCoverage[];
};

/**
 * One alternative period of a two-limb statute ("three years from injury or one year from discovery").
 * `act_or_omission` runs from the incident / act complained of (the same date a repose clock of that kind uses).
 */
export type PeriodLimb = {
  amount: number;
  unit: PeriodUnit;
  from: "accrual" | "discovery" | "injury_date" | "death" | "act_or_omission";
};
export const PERIOD_LIMB_STARTS: readonly PeriodLimb["from"][] = [
  "accrual",
  "discovery",
  "injury_date",
  "death",
  "act_or_omission",
];

/**
 * An independent outer bar. Each clock needs its own start date. `effectiveFrom` is the printed date the
 * bar took effect; when the captured text does not print one, it is null and `startBasis` must say
 * "not_recorded": the bar is then applied to every start date (it can only shorten the result) and the
 * calculator states that the historical start of the bar is unverified.
 */
export type ReposeClock = {
  years: number;
  from:
    | "act_or_omission"
    | "last_act_or_omission"
    | "injury_date"
    | "substantial_completion"
    | "first_delivery";
  effectiveFrom: string | null;
  startBasis?: "printed_effective_date" | "not_recorded";
  effectiveThrough?: string;
};

/** Rule fields a ledgered correction may change. Identity, citation and provenance fields are never corrected in place. */
export const RULE_CORRECTION_FIELDS = [
  "effectiveFrom",
  "effectiveThrough",
  "calculation",
  "computation",
  "historicalApplicability",
  "conditions",
  "warnings",
  "accrualBasis",
] as const;
export type RuleCorrectionField = (typeof RULE_CORRECTION_FIELDS)[number];

/**
 * A reviewed, ledgered change to one field of a previously released rule. The builder refuses a correction
 * whose `from` value no longer matches the live rule or whose evidence quote is not in the cited source text.
 */
export type RuleCorrection = {
  appliedInVersion: string;
  field: RuleCorrectionField;
  from: unknown;
  to: unknown;
  reason: string;
  evidenceSourceId: string;
  evidenceQuote: string;
  /** A condition appended to the rule as part of this correction (e.g. a limb the calculator still cannot model). */
  note?: string;
};

/**
 * Quoted official text attached, by ledger, to a rule that was released before provenance was recorded.
 * The builder refuses an attachment whose quotes are not literal passages of the cited stored text or whose
 * period words do not state the rule's own period; it never replaces provenance a rule already carries.
 */
export type RuleEvidenceAttachment = {
  appliedInVersion: string;
  reason: string;
  evidenceSourceId: string;
};

/**
 * Where the section a tolling or repose note cites is held in the corpus (the publisher's current code text,
 * full-code intake), and whether every period or age the note states is printed in that section's text.
 * The note itself (`provenance.tolling[index]` / `provenance.repose[index]`) is never changed by a link;
 * `termCheck` is a consistency check on the note's numbers, not a reading of the statute.
 */
export type CrossReferenceLink = {
  kind: "tolling" | "repose";
  /** Position in `provenance.tolling` / `provenance.repose`. */
  index: number;
  /** Copied from the note so a reordered note can never silently inherit another note's link. */
  citation: string;
  checkedAt: string;
  /** How many sections the citation names; `sections` holds the ones that resolved to operative text. */
  sectionsNamed: number;
  sections: { nativeId: string; textSha256: string }[];
  termCheck: "all_present" | "not_all_present" | "none_to_check";
  /**
   * Each period or age the note states. `foundIn` names another same-state section the note itself cites
   * (e.g. "subject to the cap in 5-230") when the term is printed there rather than in the cited section.
   */
  terms: { term: string; found: boolean; foundIn?: string }[];
  intakeRunId: string | null;
};

/** A source-bound computational policy carried inside the versioned private rule bundle. */
export type TollingPolicy = {
  id: string;
  schemaVersion: "1.0.0";
  kind: "minority_at_accrual";
  operation: "period_after_majority";
  period: { amount: number; unit: "calendar_years" };
  reviewedOn: string;
  /** Conservative earliest supported accrual date, not a claim about all prior law. */
  effectiveFrom: string;
  scopeRuleId: string;
  jurisdiction: string;
  claimType: ClaimType;
  subtype: string;
  conditions: string[];
  evidence: { sourceId: string; sha256: string; citation: string; quote: string }[];
};
export type LimitationRule = {
  tollingPolicies?: TollingPolicy[];
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
  /** What the period rests on. Absent means claim_specific: every rule released before this field existed named the claim. */
  basis?: RuleBasis;
  reviewStatus: "statutory_text_verified";
  period: { amount: number; unit: PeriodUnit } | null;
  provenance?: RuleProvenance;
  verification?: RuleVerification;
  currency?: RuleCurrency;
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
  /** Reviewed field changes applied to this rule after its first release, oldest first. */
  corrections?: RuleCorrection[];
  /** Set when `provenance` was attached by ledger after the rule's first release rather than recorded with it. */
  evidenceAttachment?: RuleEvidenceAttachment;
  /** Tolling / repose notes resolved to the publisher's current section text held in the corpus. */
  crossReferenceLinks?: CrossReferenceLink[];
  subtype?: string;
  calculation?: {
    mode: "discovery_min" | "diagnosis" | "death_cause_min" | "accrual_repose_min" | "clocks_min";
    /** clocks_min: one or two period limbs combined by `combine`, then capped by every repose clock. */
    limbs?: PeriodLimb[];
    combine?: "earlier" | "later";
    clocks?: ReposeClock[];
    /**
     * clocks_min: the limb start the rule's `effectiveFrom`/`effectiveThrough` window is tested against when
     * the statute defines its own reach by one event (e.g. "injury occurring on or after ..."). Must be the
     * `from` of a listed limb. Absent, every limb start must fall inside the window.
     */
    windowFrom?: PeriodLimb["from"];
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
  currency?: SourceCurrency;
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
  /**
   * Set when the state was reviewed for a last-day counting rule and none could be recorded from official
   * text (gated publisher, rule that reaches only court-fixed periods, unreachable publisher). The reason is
   * shown wherever a weekend last day would otherwise pass in silence. Mutually exclusive with timeComputation.
   */
  timeComputationNotRecorded?: { reason: string; reviewedOn: string };
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
  injuryDate?: string;
  substantialCompletionDate?: string;
  reposeActDate?: string;
  reposeApplicabilityConfirmed?: boolean;
  governingLawConfirmed: boolean;
  accrualConfirmed: boolean;
  applicabilityConfirmed: boolean;
  exceptionReview: "unresolved" | "no_unresolved_issues";
  issues: SpecialIssue[];
};
/**
 * Why a Saturday/Sunday anniversary was left unadjusted: the state's recorded counting rule is flagged (its
 * reach to limitation periods is not established, or it does not cover that weekday), or no rule is recorded.
 * Never present when adjustedDate is set.
 */
export type WeekendNotice =
  | {
      kind: "flagged_rule";
      weekday: "Saturday" | "Sunday";
      /** "flagged": on file but not applied; "verified": applied, but it does not extend weekends. */
      ruleStatus: "verified" | "flagged";
      citation: string;
      note: string;
      extendsWhenLastDayIsWeekend: boolean;
    }
  | {
      /** The recorded label does not establish the needed source currency or outer-limit scope. */
      kind: "source_unverified" | "scope_unverified";
      weekday: "Saturday" | "Sunday";
      citation: string;
      note: string;
    }
  | { kind: "no_rule"; weekday: "Saturday" | "Sunday"; reason: string | null };
export type BaselineResult = {
  status: "baseline" | "needs_review" | "invalid";
  date: string | null;
  /** Next weekday when the anniversary is a Saturday or Sunday and the state's recorded rule extends it. */
  adjustedDate?: { date: string; citation: string; holidaysComputed: false } | null;
  /** Set when the anniversary is a Saturday or Sunday and no verified rule moved it. */
  weekendNotice?: WeekendNotice | null;
  rule: LimitationRule | null;
  reasons: string[];
  steps: { text: string; sourceIds: string[]; pinpoint: string }[];
  /**
   * Set only when the entered date falls outside this rule's statutory window and exactly one sibling
   * baseline rule (same state, claim type, accrual basis and window event) has a window covering it.
   * The caller may offer that fact pattern; the engine never switches rules by itself.
   */
  suggestedSubtype?: string | null;
};
