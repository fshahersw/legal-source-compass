import { addCivilPeriod, periodLabel } from "../engine";
import {
  CLAIM_LABELS,
  type ClaimType,
  type LimitationRule,
  type PeriodUnit,
  type RuleProvenance,
} from "../types";
import type { CaptureMeta, MatrixEntryInput } from "./entries";
import { buildEntryRuleConditions } from "./ruleConditions";

/** Capture metadata as written by scripts/limitations/backfill/capture.py (plus seed/render markers). */
export type EntryCaptureMeta = CaptureMeta & {
  seededFrom?: string;
  rendered?: boolean;
  route?: { kind: "proxied"; proxy: string };
  uaFallback?: boolean;
};

export const UNIT: Record<string, PeriodUnit> = {
  years: "calendar_years",
  months: "calendar_months",
  days: "calendar_days",
};

export type ClockKind =
  | "act_or_omission"
  | "last_act_or_omission"
  | "injury_date"
  | "substantial_completion"
  | "first_delivery";

/** Entries begin a repose trigger with one canonical phrase; older entries are matched by their wording. */
export const reposeTrigger = (text: string): ClockKind | null => {
  const t = text.toLowerCase().trim();
  if (t.startsWith("the last act or omission") || /^last act/.test(t) || /\blast act\b/.test(t))
    return "last_act_or_omission";
  if (t.startsWith("the date of injury")) return "injury_date";
  if (t.startsWith("substantial completion")) return "substantial_completion";
  if (t.startsWith("first delivery or sale")) return "first_delivery";
  if (t.startsWith("the act or omission")) return "act_or_omission";
  if (
    /act or omission|act, omission|act or failure|date of the (act|omission)|act complained|perpetration of the (fraud|act)/.test(
      t,
    )
  )
    return "act_or_omission";
  if (
    /first (purchase|sale|delivery)|delivery (of the product )?to (its |the )?(first|initial)|initial purchas(e|er)|first purchaser|time of delivery|date of delivery/.test(
      t,
    )
  )
    return "first_delivery";
  return null;
};

export function provenanceFromEntry(
  entry: MatrixEntryInput,
  retrievedAt: string,
  crossCheckSourceIds: string[],
): RuleProvenance {
  return {
    citation: entry.citation,
    excerpt: entry.excerpt,
    periodEvidence: entry.periodEvidence,
    accrualKind: entry.accrual.kind as RuleProvenance["accrualKind"],
    accrualText: entry.accrual.text?.trim() || "Not recorded",
    tolling: (entry.tolling ?? []).map((t) => ({ text: t.text, citation: t.citation })),
    repose: (entry.repose ?? []).map((r) => ({
      years: r.years,
      citation: r.citation,
      trigger: r.trigger,
      effectiveFrom: r.effectiveFrom,
    })),
    lastAmended: {
      text: entry.lastAmended?.text?.trim() || "Not recorded",
      date: entry.lastAmended?.date ?? null,
    },
    effectiveDate: entry.effectiveDate ?? null,
    retrievedAt,
    entryStatus: entry.status as "verified" | "flagged",
    confidence: entry.confidence as RuleProvenance["confidence"],
    confidenceNote: entry.confidenceNote,
    flags: entry.flags ?? [],
    crossCheckSourceIds,
  };
}

/** A third-party extraction, cached page or search snippet is a lower evidence route even with cross-checks. */
export function isIntermediaryOnlyCapture(meta: EntryCaptureMeta): boolean {
  return (
    Boolean(meta.intermediary) &&
    /tavily|firecrawl|webfetch|web-fetch|websearch|search-engine|snippet|cached|proxied/i.test(
      String(meta.extraction ?? ""),
    )
  );
}

export type EntryRuleResult =
  | { rule: LimitationRule; baseline: boolean }
  | { rejected: string };

/**
 * Build the `rules.json` record for one mechanically verified matrix entry. Mirrors the production builder:
 * a rule computes only when the entry is verified, its accrual kind is modellable and every repose clock is
 * either modelled (trigger + printed effective date) or merely recorded; everything else is research-only.
 */
export function ruleFromEntry(input: {
  state: string;
  entry: MatrixEntryInput;
  primaryId: string;
  crossIds: string[];
  primaryRetrievedAt: string;
  ruleVersion: string;
  idStamp: string;
  replaced?: LimitationRule | null;
}): EntryRuleResult {
  const { state, entry, primaryId, crossIds, ruleVersion, idStamp } = input;
  const replaced = input.replaced ?? null;
  const variant = entry.variant ?? "general";
  if (!entry.period) return { rejected: "entry has no period" };
  const unit = UNIT[entry.period.unit];
  if (!unit) return { rejected: `unsupported period unit ${entry.period.unit}` };
  const provenance = provenanceFromEntry(
    entry,
    input.primaryRetrievedAt,
    [...new Set(crossIds)].filter((id) => id !== primaryId),
  );
  const repose = entry.repose ?? [];
  const productClaim =
    entry.claimType === "product_liability" ||
    entry.claimType === "breach_of_warranty" ||
    /product/.test(variant);
  const kinds = repose.map((r) => {
    const k = reposeTrigger(r.trigger);
    return k === "first_delivery" && !productClaim ? null : k;
  });
  /**
   * A bar is computed when its start is a supported clock and either its effective date is printed or the
   * entry declares it general to the claim (then it is applied as current law and disclosed as undated).
   * A substantial-completion bar is never computed without a printed date: it reaches only construction claims.
   */
  const computable = (r: (typeof repose)[number], k: ClockKind | null) =>
    k !== null &&
    (r.effectiveFrom !== null || (r.applies === "general" && k !== "substantial_completion"));
  const reposeModelled = repose.length > 0 && repose.every((r, i) => computable(r, kinds[i]!));
  const reposeRecordedNotComputed = repose.length > 0 && !reposeModelled;
  const limbs = entry.periodLimbs ?? [];
  const legacySingle =
    limbs.length === 0 &&
    repose.length === 1 &&
    reposeModelled &&
    repose[0]!.effectiveFrom !== null &&
    ["act_or_omission", "last_act_or_omission", "first_delivery"].includes(kinds[0]!);
  const needsClocks = limbs.length > 0 || (reposeModelled && !legacySingle);
  const trigger = legacySingle ? (kinds[0] as ClockKind) : null;
  const accrualOk = [
    "accrual",
    "discovery",
    "occurrence",
    "breach",
    "treatment_end",
    "other",
    "death",
    "not_recorded",
  ].includes(entry.accrual.kind);
  const baseline =
    entry.status === "verified" &&
    accrualOk &&
    (repose.length === 0 || reposeModelled || reposeRecordedNotComputed);
  const notes = buildEntryRuleConditions(
    entry,
    provenance,
    baseline,
    repose,
    reposeRecordedNotComputed,
  );
  const rule: LimitationRule = {
    id: `${state.toLowerCase()}-${entry.claimType}-${variant}-bf${idStamp}`.replaceAll("_", "-"),
    schemaVersion: "1.0.0",
    ruleVersion,
    jurisdiction: state,
    claimType: entry.claimType as ClaimType,
    ruleKind: "limitations",
    computation: baseline ? "baseline_only" : "research_only",
    basis: entry.basis ?? "claim_specific",
    reviewStatus: "statutory_text_verified",
    period: { amount: entry.period.amount, unit },
    provenance,
    sourceIds: [...new Set([primaryId, ...crossIds, ...(replaced?.sourceIds ?? [])])],
    ...(replaced?.caseReferenceIds?.length ? { caseReferenceIds: replaced.caseReferenceIds } : {}),
    pinpoint: entry.citation,
    scope: `${CLAIM_LABELS[entry.claimType as ClaimType]}${variant === "general" ? "" : ` (${variant.replaceAll("_", " ")})`}: as stated in the cited provision; special statutory claims excluded.`,
    accrualBasis: entry.accrual.kind === "death" ? "death" : "confirmed_accrual",
    conditions: [...new Set([...notes, ...(replaced?.conditions ?? [])])],
    exclusions: [
      "Governmental defendants, special statutory claims and intentional / sexual-abuse claims unless the cited provision expressly covers them",
      "Unresolved minority, disability, concealment, tolling, class action, previous filing, service, borrowing or choice-of-law issues",
    ],
    effectiveFrom: entry.effectiveDate ?? null,
    effectiveThrough: null,
    validity:
      entry.status === "verified"
        ? "Statutory text verified against the official capture; no comprehensive operative-law or case-specific review completed"
        : "Recorded with open issues (see conditions); no date is issued from a flagged entry",
    historicalApplicability:
      provenance.lastAmended.text === "Not recorded"
        ? "Not recorded; historical amendments and transitional applicability must be confirmed"
        : `Official history note: ${provenance.lastAmended.text}`,
    summary:
      entry.basis === "general_period"
        ? `${periodLabel({ amount: entry.period.amount, unit })} general civil period (${entry.citation}), applied to this claim because no provision naming it was found in the reviewed official text; subject to the cited scope and exceptions.`
        : `${periodLabel({ amount: entry.period.amount, unit })} statutory baseline (${entry.citation}), subject to the cited scope and exceptions.`,
    warnings: [
      "This is an unadjusted calendar anniversary, not a verified last day for filing.",
      "Court holidays, closure, commencement/service requirements and local filing cutoffs are not computed.",
      ...(entry.basis === "general_period"
        ? [
            "No provision naming this claim was found in the reviewed official text: the cited general civil period is applied to it. Confirm that mapping before relying on the date.",
          ]
        : []),
    ],
    ...(variant === "general" ? {} : { subtype: variant }),
    ...(baseline && legacySingle
      ? {
          calculation: {
            mode: "accrual_repose_min" as const,
            reposeYears: repose[0]!.years,
            reposeTrigger: trigger as "last_act_or_omission" | "act_or_omission" | "first_delivery",
            reposeEffectiveFrom: repose[0]!.effectiveFrom!,
          },
        }
      : {}),
    ...(baseline && needsClocks
      ? {
          calculation: {
            mode: "clocks_min" as const,
            ...(limbs.length
              ? {
                  limbs: limbs.map((l) => ({ amount: l.amount, unit: UNIT[l.unit]!, from: l.from })),
                  combine: entry.periodCombine!,
                }
              : {
                  limbs: [
                    {
                      amount: entry.period.amount,
                      unit,
                      from: entry.accrual.kind === "death" ? ("death" as const) : ("accrual" as const),
                    },
                  ],
                }),
            clocks: reposeModelled
              ? repose.map((r, i) => ({
                  years: r.years,
                  from: kinds[i] as ClockKind,
                  effectiveFrom: r.effectiveFrom,
                  startBasis:
                    r.effectiveFrom === null
                      ? ("not_recorded" as const)
                      : ("printed_effective_date" as const),
                }))
              : [],
          },
        }
      : {}),
  };
  if (!addCivilPeriod("2000-06-15", rule.period!.amount, unit))
    return { rejected: "period not representable" };
  return { rule, baseline };
}
