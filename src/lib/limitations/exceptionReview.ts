import type { BaselineInput, LimitationRule, LimitationsSnapshot } from "./types";

/** Question ordering is navigation, never a decision about the meaning of a statute. */
export const SCREENING_QUESTIONS = [
  {
    id: "minority",
    group: "The claimant",
    label: "Was the claimant a minor when the claim accrued?",
    hint: "Minority is separate from legal incapacity, death, and special claims.",
    terms: /minor|infan|under (?:the age of )?18|majority|age of eighteen/i,
  },
  {
    id: "incapacity",
    group: "The claimant",
    label: "Incapacity or a disability other than minority?",
    hint: "Include incapacity at accrual, later incapacity, and coexisting disabilities; minority is reviewed separately.",
    terms: /incapac|disabil|insan|competenc/i,
  },
  {
    id: "military",
    group: "The claimant",
    label: "Military service or wartime protection?",
    hint: "Military service, protected dependants, wartime restrictions or federal protection.",
    terms: /military|servicemember|service member|war(?:time)?\b|SCRA/i,
  },
  {
    id: "confinement",
    group: "The claimant",
    label: "Incarceration or criminal proceedings?",
    hint: "Include detention, compelled confession, prosecution and crime-victim provisions.",
    terms: /imprison|incarcer|confess|criminal|convict|detention|crime/i,
  },
  {
    id: "concealment",
    group: "Discovery and conduct",
    label: "Concealment, fraud, or conduct preventing suit?",
    hint: "Fraudulent concealment, estoppel, duress and equitable tolling need their own review.",
    terms: /conceal|estoppel|duress|fraud|equitable/i,
  },
  {
    id: "discovery",
    group: "Discovery and conduct",
    label: "An unresolved discovery or continuing-wrong question?",
    hint: "Latent injuries, toxic exposure, foreign objects, continuing treatment or representation.",
    terms: /discover|latent|toxic|foreign object|continu(?:ing|ous)|representation|treatment/i,
  },
  {
    id: "absence",
    group: "Discovery and conduct",
    label: "A defendant absent, concealed, or using another identity?",
    hint: "Do not infer tolling from residence alone; service and constitutional limits may matter.",
    terms: /absen|out.of.state|nonresident|false name|return to/i,
  },
  {
    id: "prior_action",
    group: "Earlier proceedings",
    label: "An earlier lawsuit, dismissal, appeal, or refiling?",
    hint: "Savings statutes, service, nonsuit, relation back and claim identity may change the analysis.",
    terms: /refil|prior|previous|dismiss|nonsuit|savings?|terminat|appeal|relation.back/i,
  },
  {
    id: "class_action",
    group: "Earlier proceedings",
    label: "A class action, MDL, registry, or mass-action order?",
    hint: "A registry entry or master complaint is not assumed to preserve an individual claim.",
    terms: /class.action|MDL|multidistrict|registry|master complaint/i,
  },
  {
    id: "bankruptcy",
    group: "Earlier proceedings",
    label: "Bankruptcy, an injunction, or another stay?",
    hint: "A stay does not automatically mean every limitations or repose period pauses.",
    terms: /bankrupt|injunction|stay|stayed|statutory prohibition/i,
  },
  {
    id: "agreement",
    group: "Agreements and special claims",
    label: "A tolling agreement, arbitration, or contractual time limit?",
    hint: "Exact language, signatories, start/end dates, scope and enforceability must be established.",
    terms: /agreement|arbitrat|contractual|written agreement|shorten|waiver/i,
  },
  {
    id: "government",
    group: "Agreements and special claims",
    label: "A government entity, public employee, or public-claim notice?",
    hint: "Administrative presentation and notice deadlines are distinct clocks.",
    terms:
      /government|public entit|public employ|municipal|notice.of.claim|claim presentation|sovereign/i,
  },
  {
    id: "special_claim",
    group: "Agreements and special claims",
    label: "A special claim or defendant not covered by this selected branch?",
    hint: "For example sexual abuse, malpractice, statutory penalties, products or derivative claims; choose No only when this exact branch covers it.",
    terms:
      /sexual|malpractice|special|statutory claim|penalt|forfeiture|derivative|consortium|product|warrant/i,
  },
  {
    id: "death",
    group: "Scope and final checks",
    label: "Any unresolved death, estate, or representative-capacity issue?",
    hint: "Choose No only when the selected claim branch already covers the issue. A personal-injury toll is not automatically a wrongful-death or survival deadline.",
    terms: /death|died|deceas|estate|representative|survival|homicide/i,
  },
  {
    id: "foreign_law",
    group: "Scope and final checks",
    label: "An unresolved other-state, transfer, or borrowing-law issue?",
    hint: "Forum, residence and governing law may differ.",
    terms: /borrow|choice.of.law|foreign|transfer|direct.fil|another state|other.state/i,
  },
  {
    id: "repose",
    group: "Scope and final checks",
    label: "An unresolved repose cap, revival law, or transition issue?",
    hint: "An extension of limitations does not by itself extend an independent outer bar.",
    terms: /repose|reviv|transition|retroactiv|amendment|effective|outer/i,
  },
  {
    id: "other",
    group: "Scope and final checks",
    label: "Any other exception, emergency order, or unresolved qualification?",
    hint: "Includes provisions not classified above. Review the entire recorded rule below; this screen is not a complete survey of all law.",
    terms: /emergency|closure|other|unresolved|qualification/i,
  },
] as const;
export type ScreeningId = (typeof SCREENING_QUESTIONS)[number]["id"];
export type ScreeningAnswer = "yes" | "no" | "unsure";
export type ScreeningAnswers = Partial<Record<ScreeningId, ScreeningAnswer>>;
export type ExceptionItem = {
  id: string;
  ruleId: string;
  kind: "condition" | "exclusion" | "warning" | "tolling" | "repose" | "flag";
  index: number;
  text: string;
  citation: string | null;
  categories: ScreeningId[];
  sourceIds: string[];
};

export function exceptionInventory(
  _snapshot: LimitationsSnapshot,
  rule: LimitationRule,
): ExceptionItem[] {
  const items: ExceptionItem[] = [];
  function add(
    kind: ExceptionItem["kind"],
    values: readonly (string | { text: string; citation: string })[] = [],
  ) {
    values.forEach((value, index) => {
      const text = typeof value === "string" ? value : value.text;
      const matches = SCREENING_QUESTIONS.filter((q) =>
        q.terms.test(text + (typeof value === "string" ? "" : " " + value.citation)),
      ).map((q) => q.id);
      items.push({
        id: `${rule.id}:${kind}:${index}`,
        ruleId: rule.id,
        kind,
        index,
        text,
        citation: typeof value === "string" ? null : value.citation,
        categories: matches.length ? matches : ["other"],
        sourceIds: [...rule.sourceIds],
      });
    });
  }
  add("condition", rule.conditions);
  add("exclusion", rule.exclusions);
  add("warning", rule.warnings);
  add("tolling", rule.provenance?.tolling);
  add(
    "repose",
    rule.provenance?.repose.map((item) => ({
      text: `${item.years} years from ${item.trigger}. Recorded applicability start: ${item.effectiveFrom ?? "Not recorded"}.`,
      citation: item.citation,
    })),
  );
  add("flag", rule.provenance?.flags);
  return items;
}

export function assessExceptions(
  snapshot: LimitationsSnapshot,
  rule: LimitationRule,
  answers: ScreeningAnswers,
  resolved: readonly ScreeningId[] = [],
) {
  const inventory = exceptionInventory(snapshot, rule);
  const unanswered = SCREENING_QUESTIONS.filter((q) => !answers[q.id]);
  // Only the calculation orchestrator may resolve a positive with a source-bound executed policy.
  const unresolved = SCREENING_QUESTIONS.filter(
    (q) => answers[q.id] === "unsure" || (answers[q.id] === "yes" && !resolved.includes(q.id)),
  );
  return {
    inventory,
    unanswered,
    unresolved,
    ready: !unanswered.length && !unresolved.length,
    comprehensiveLawReview: false as const,
  };
}

export function reviewContextKey(
  snapshot: LimitationsSnapshot,
  rule: LimitationRule,
  dates: Partial<BaselineInput>,
): string {
  return JSON.stringify([
    snapshot.ruleVersion,
    rule.id,
    rule.ruleVersion,
    rule.effectiveFrom,
    rule.effectiveThrough,
    Object.entries(dates)
      .filter(([key]) => key.endsWith("Date") || key === "vitalStatus")
      .sort(([a], [b]) => a.localeCompare(b)),
  ]);
}
