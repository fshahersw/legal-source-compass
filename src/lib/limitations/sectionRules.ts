import { exactCitationPaths, statuteNativeId } from "@/lib/law/exactCitationPath";
import { periodLabel } from "./engine";
import { CLAIM_LABELS, type LimitationsSnapshot } from "./types";

/** A Time Limits rule that names one full-code section, and how that link was established. */
export type SectionRuleLink = {
  ruleId: string;
  claimType: string;
  claimLabel: string;
  subtype: string | null;
  ruleKind: string;
  computation: "baseline_only" | "research_only";
  pinpoint: string;
  period: string | null;
  effectiveFrom: string | null;
  effectiveThrough: string | null;
  summary: string;
  /**
   * "citation": the rule's own pinpoint names exactly this section.
   * "captured_text": the rule's quoted passages were found in this section's current official text.
   */
  matchedBy: ("citation" | "captured_text")[];
};

/**
 * Rules citing a section, by exact citation path or by a recorded code-capture recheck of that
 * section. Nothing is inferred from headings, chapters or similar numbers.
 */
export function rulesCitingSection(
  snapshot: Pick<LimitationsSnapshot, "rules" | "sources">,
  state: string,
  nativeId: string,
): SectionRuleLink[] {
  const usps = state.toUpperCase();
  const sourcesById = new Map(snapshot.sources.map((source) => [source.id, source]));
  const links: SectionRuleLink[] = [];
  for (const rule of snapshot.rules) {
    if (rule.jurisdiction !== usps) continue;
    const matchedBy: SectionRuleLink["matchedBy"] = [];
    const paths = exactCitationPaths(usps, rule.pinpoint) ?? [];
    if (paths.some((path) => statuteNativeId(usps, path) === nativeId)) matchedBy.push("citation");
    const captured = rule.sourceIds.some((id) => {
      const capture = sourcesById.get(id)?.currency?.codeCapture;
      return !!capture && capture.sectionNativeIds.includes(nativeId);
    });
    if (captured) matchedBy.push("captured_text");
    if (!matchedBy.length) continue;
    links.push({
      ruleId: rule.id,
      claimType: rule.claimType,
      claimLabel: CLAIM_LABELS[rule.claimType] ?? rule.claimType,
      subtype: rule.subtype ?? null,
      ruleKind: rule.ruleKind,
      computation: rule.computation,
      pinpoint: rule.pinpoint,
      period: rule.period ? periodLabel(rule.period) : null,
      effectiveFrom: rule.effectiveFrom,
      effectiveThrough: rule.effectiveThrough,
      summary: rule.summary,
      matchedBy,
    });
  }
  return links.sort(
    (a, b) =>
      a.claimLabel.localeCompare(b.claimLabel) ||
      (a.effectiveFrom ?? "").localeCompare(b.effectiveFrom ?? "") ||
      a.ruleId.localeCompare(b.ruleId),
  );
}
