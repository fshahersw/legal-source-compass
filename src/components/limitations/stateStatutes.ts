import {
  CLAIM_LABELS,
  CLAIM_TYPES,
  VERIFICATION_GRADE_LABELS,
  type ClaimCoverageStatus,
  type ClaimType,
  type LimitationRule,
  type LimitationSource,
  type LimitationsSnapshot,
} from "@/lib/limitations/types";
import { periodLabel } from "@/lib/limitations/engine";
import {
  NOT_RECORDED,
  ruleCurrencyFacts,
  sourceCurrencyFacts,
  type RuleCurrencyFacts,
  type SourceCurrencyFacts,
} from "./ruleAuthority";

/** One row of the per-state claim matrix. Every value is read from the release; nothing is inferred. */
export type ClaimMatrixRow = {
  claimType: ClaimType;
  label: string;
  status: ClaimCoverageStatus;
  statusLabel: string;
  /** The general rule's period, or "Not recorded". */
  period: string;
  /** Pinpoint citation of the general rule, or null when no rule is recorded. */
  citation: string | null;
  grade: string | null;
  /** Narrow fact-pattern variants and statutory versions recorded beside the general rule. */
  variants: { ruleId: string; name: string; status: ClaimCoverageStatus }[];
  currency: RuleCurrencyFacts | null;
  /** Open issues printed by the release for a flagged entry. */
  flags: string[];
  reason: string | null;
};

export const CLAIM_STATUS_LABELS: Record<ClaimCoverageStatus, string> = {
  baseline: "Date computable",
  research_only: "Period recorded, no date",
  flagged: "Recorded with open issues",
  not_recorded: "Not recorded",
};

const generalRule = (rules: LimitationRule[], state: string, claim: ClaimType) =>
  rules.find(
    (rule) =>
      rule.jurisdiction === state &&
      rule.claimType === claim &&
      (rule.subtype ?? "general") === "general" &&
      (rule.ruleKind === "limitations" || rule.ruleKind === "repose"),
  ) ??
  rules.find(
    (rule) =>
      rule.jurisdiction === state &&
      rule.claimType === claim &&
      (rule.subtype ?? "general") === "general",
  ) ??
  null;

/**
 * The claim matrix for one state: a row per claim type, read from the coverage record when the release
 * carries one, otherwise from the rules themselves. A claim type with no rule reads "Not recorded".
 */
export function claimMatrix(
  snapshot: LimitationsSnapshot,
  state: string,
  variantName: (rule: LimitationRule) => string,
): ClaimMatrixRow[] {
  const coverage = snapshot.coverage.find((row) => row.state === state);
  return CLAIM_TYPES.map((claimType) => {
    const cell = coverage?.claimCoverage?.find((item) => item.claimType === claimType);
    const rule =
      (cell?.ruleId ? snapshot.rules.find((item) => item.id === cell.ruleId) : null) ??
      generalRule(snapshot.rules, state, claimType);
    const status: ClaimCoverageStatus =
      cell?.status ??
      (rule
        ? rule.provenance?.entryStatus === "flagged"
          ? "flagged"
          : rule.computation === "baseline_only"
            ? "baseline"
            : "research_only"
        : "not_recorded");
    const variantRules = snapshot.rules.filter(
      (item) =>
        item.jurisdiction === state &&
        item.claimType === claimType &&
        (item.subtype ?? "general") !== "general",
    );
    const variants = (
      cell?.variants?.length
        ? cell.variants.flatMap((variant) => {
            const found = snapshot.rules.find((item) => item.id === variant.ruleId);
            return found
              ? [{ ruleId: found.id, name: variantName(found), status: variant.status }]
              : [];
          })
        : variantRules.map((item) => ({
            ruleId: item.id,
            name: variantName(item),
            status: (item.provenance?.entryStatus === "flagged"
              ? "flagged"
              : item.computation === "baseline_only"
                ? "baseline"
                : "research_only") as ClaimCoverageStatus,
          }))
    ).filter((v, i, arr) => arr.findIndex((o) => o.ruleId === v.ruleId) === i);
    const grade = cell?.grade ?? rule?.verification?.grade ?? null;
    return {
      claimType,
      label: CLAIM_LABELS[claimType],
      status,
      statusLabel: CLAIM_STATUS_LABELS[status],
      period: rule?.period ? periodLabel(rule.period) : NOT_RECORDED,
      citation: rule ? (rule.provenance?.citation ?? rule.pinpoint) : null,
      grade: grade ? VERIFICATION_GRADE_LABELS[grade] : null,
      variants,
      currency: rule ? ruleCurrencyFacts(rule.currency) : null,
      flags: rule?.provenance?.flags ?? [],
      reason: cell?.reason ?? null,
    };
  });
}

/** One official source of the state with every rule that quotes it. */
export type CitedStatute = {
  source: LimitationSource;
  currency: SourceCurrencyFacts;
  /** Public code sections the recheck searched, when the route was the full-code capture. */
  codeSections: string[];
  citedBy: {
    ruleId: string;
    claimType: ClaimType;
    claimLabel: string;
    variant: string | null;
    ruleKind: LimitationRule["ruleKind"];
    citation: string;
    excerpt: string | null;
    period: string;
  }[];
};

/**
 * The state's sources ordered statutes first, each with the rules that list it. Federal ("US") sources
 * are included only when a rule of the state cites them. Sources no rule cites stay listed, last.
 */
export function citedStatutes(
  snapshot: LimitationsSnapshot,
  state: string,
  variantName: (rule: LimitationRule) => string,
): CitedStatute[] {
  const stateRules = snapshot.rules.filter((rule) => rule.jurisdiction === state);
  const citedIds = new Set(stateRules.flatMap((rule) => rule.sourceIds));
  const sources = snapshot.sources.filter(
    (source) => source.state === state || (source.state === "US" && citedIds.has(source.id)),
  );
  const kindOrder: Record<string, number> = {
    statute: 0,
    constitution: 1,
    publisher_table: 2,
    publisher_guidance: 3,
    legislative_history: 4,
  };
  return sources
    .map((source) => {
      const currency = sourceCurrencyFacts(source.currency);
      return {
        source,
        currency,
        codeSections: currency.codeSections,
        citedBy: stateRules
          .filter((rule) => rule.sourceIds.includes(source.id))
          .map((rule) => ({
            ruleId: rule.id,
            claimType: rule.claimType,
            claimLabel: CLAIM_LABELS[rule.claimType],
            variant: (rule.subtype ?? "general") === "general" ? null : variantName(rule),
            ruleKind: rule.ruleKind,
            citation: rule.provenance?.citation ?? rule.pinpoint,
            excerpt: rule.provenance?.excerpt?.trim() || null,
            period: rule.period ? periodLabel(rule.period) : NOT_RECORDED,
          })),
      };
    })
    .sort(
      (a, b) =>
        Number(b.citedBy.length > 0) - Number(a.citedBy.length > 0) ||
        Number(a.source.state === "US") - Number(b.source.state === "US") ||
        (kindOrder[a.source.authorityKind] ?? 9) - (kindOrder[b.source.authorityKind] ?? 9) ||
        a.source.title.localeCompare(b.source.title),
    );
}

/** Counts shown in the panel header; every number is a count of release records, not a legal claim. */
export function statuteSummary(statutes: CitedStatute[]) {
  const sources = statutes.length;
  const confirmed = statutes.filter((s) => s.currency.tone === "ok").length;
  const lost = statutes.filter((s) => s.currency.tone === "lost").length;
  const unchecked = sources - confirmed - lost;
  return { sources, confirmed, lost, unchecked };
}
