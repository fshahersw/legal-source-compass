/** Offline release builder. No browser/runtime imports this module or derives law from a keyword. */
import { createHash } from "node:crypto";
import { validateTollingPolicies } from "../tollingPolicy";
import { parseCivilDate } from "../engine";
import type { LimitationsSnapshot, TollingPolicy } from "../types";

const scopes = [
  {
    state: "CA",
    effectiveFrom: "2015-01-01",
    ruleId: "ca-personal_injury-baseline-20261002",
    sourceId: "bf-ca-ccp-ch3-ch4",
    years: 2,
    citation: "Cal. Code Civ. Proc. §§ 335.1, 352(a)–(b), 357–358",
    ranges: [
      ["352.", "352.1."],
      ["357.", "359."],
    ],
    required: [
      "under the age of majority",
      "time of the disability is not part",
      "public entity",
      "unless it existed when his right of action accrued",
      "two or more disabilities coexist",
    ],
  },
  {
    state: "IL",
    effectiveFrom: "2015-01-01",
    ruleId: "il-personal_injury-general-review-20261002",
    sourceId: "bf-il-13-211",
    years: 2,
    citation: "735 ILCS 5/13-202 and 13-211(a)",
    ranges: [["(a)", "(b)"]],
    required: [
      "at the time the cause of action accrued",
      "under the age of 18 years",
      "within 2 years after",
      "Sections 13-201 through 13-210",
    ],
  },
  {
    state: "NY",
    effectiveFrom: "2019-02-15",
    ruleId: "ny-personal_injury-baseline-20261002",
    sourceId: "bf-ny-cplr208",
    years: 3,
    citation: "N.Y. C.P.L.R. §§ 208(a), 214(5)",
    ranges: [["§ 208.", "(b)"]],
    required: [
      "at the time the cause of action accrues",
      "three years after the disability ceases",
      "whichever event first occurs",
      "except, in any action other than for medical, dental or podiatric malpractice",
      "under a disability due to infancy",
      "penalty or forfeiture",
    ],
  },
] as const;
const normalize = (s: string) => s.replace(/\s+/g, " ").trim();
const sha = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");

export function addMinorityPolicies(
  input: LimitationsSnapshot,
  texts: ReadonlyMap<string, string>,
  reviewedOn: string,
) {
  if (!parseCivilDate(reviewedOn)) throw new Error("Invalid policy construction date");
  const snapshot = structuredClone(input);
  const changes: { ruleId: string; policyId: string; sourceSha256: string; operation: string }[] =
    [];
  for (const spec of scopes) {
    const matches = snapshot.rules.filter((r) => r.id === spec.ruleId);
    if (matches.length !== 1)
      throw new Error("Expected exactly one existing baseline for " + spec.state);
    const rule = matches[0]!;
    if (
      rule.jurisdiction !== spec.state ||
      rule.claimType !== "personal_injury" ||
      (rule.subtype ?? "general") !== "general" ||
      rule.calculation ||
      rule.period?.unit !== "calendar_years" ||
      rule.period.amount !== spec.years
    )
      throw new Error("Reviewed baseline identity/period changed; re-review policy scope");
    const source = snapshot.sources.find((s) => s.id === spec.sourceId);
    const text = texts.get(spec.sourceId);
    if (
      !source ||
      text === undefined ||
      sha(text) !== source.sha256 ||
      !rule.sourceIds.includes(source.id)
    )
      throw new Error("Required policy evidence hash or rule link differs: " + spec.sourceId);
    const quoted = spec.ranges.map(([start, end]) => {
      // Section markers are only a locator. Every operative predicate is checked against the exact retained excerpt below.
      const from = text.indexOf(start);
      const to = text.indexOf(end, from + start.length);
      if (from < 0 || to < 0 || to <= from)
        throw new Error("Missing exact policy evidence boundaries: " + spec.sourceId);
      return text.slice(from, to).trim();
    });
    const searchable = normalize(quoted.join("\n"));
    for (const phrase of spec.required)
      if (!searchable.includes(phrase))
        throw new Error("Policy evidence no longer contains reviewed predicate: " + phrase);
    const policy: TollingPolicy = {
      id: `${spec.state.toLowerCase()}-ordinary-injury-minority-v1`,
      schemaVersion: "1.0.0",
      kind: "minority_at_accrual",
      operation: "period_after_majority",
      period: { amount: spec.years, unit: "calendar_years" },
      reviewedOn,
      effectiveFrom: spec.effectiveFrom,
      scopeRuleId: rule.id,
      jurisdiction: rule.jurisdiction,
      claimType: rule.claimType,
      subtype: "general",
      conditions: [
        "The claimant was under the legally applicable age of majority when this ordinary personal-injury cause accrued, and majority has since been attained. The correct legal majority date is supplied and independently confirmed, not derived by this model.",
        "The claimant is living. No coexisting incapacity, incarceration, military protection, death, estate or other disability changes the analysis.",
        "This policy is limited to an ordinary private-party personal-injury claim. It does not cover governmental defendants or claims presentation, malpractice, childhood sexual abuse, products/latent injuries, penalties, forfeitures, sheriff escape actions, derivative claims or an independent statute of repose.",
        "The reviewer has confirmed the governing statutory version and claim classification. The policy applies only the cited minority provision; it neither determines accrual nor revives a claim under an unrelated savings or revival law.",
        "Every other issue in the guided review is explicitly reported not applicable. Concurrent tolling, stays, prior filings, class actions, contracts and choice-of-law issues require separate treatment; their durations are never stacked automatically.",
        "The calculated anniversary does not establish a court-specific filing cutoff. Holidays, closures, service and commencement requirements remain to be confirmed.",
      ],
      evidence: quoted.map((quote) => ({
        sourceId: source.id,
        sha256: source.sha256,
        citation: spec.citation,
        quote,
      })),
    };
    if (
      rule.tollingPolicies?.length &&
      JSON.stringify(rule.tollingPolicies) !== JSON.stringify([policy])
    )
      throw new Error(
        "Existing policy differs; do not overwrite an earlier policy without a versioned review",
      );
    rule.tollingPolicies = [policy];
    changes.push({
      ruleId: rule.id,
      policyId: policy.id,
      sourceSha256: source.sha256,
      operation: policy.operation,
    });
  }
  validateTollingPolicies(snapshot.rules, snapshot.sources);
  return { snapshot, changes };
}
