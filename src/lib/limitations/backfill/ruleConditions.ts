import type { MatrixEntryInput } from "./entries";
import type { RuleProvenance } from "../types";

/** Build `rules.json` `conditions[]` from a verified matrix entry and its provenance block. */
export function buildEntryRuleConditions(
  entry: MatrixEntryInput,
  provenance: RuleProvenance,
  baseline: boolean,
  repose: MatrixEntryInput["repose"],
  reposeRecordedNotComputed: boolean,
): string[] {
  const notes = [
    entry.accrual.kind === "not_recorded"
      ? "The cited provision does not state when the claim accrues (Not recorded). The accrual date must be confirmed under controlling case law before relying on any date."
      : `Accrual under the cited rule: ${provenance.accrualText}`,
    ...(repose.length && !baseline
      ? repose.map(
          (r) =>
            `Statute of repose not computed here: ${r.years} years (${r.citation}); trigger: ${r.trigger}.`,
        )
      : []),
    ...provenance.tolling.map(
      (t) => `Statutory tolling (not applied by the calculator): ${t.text} (${t.citation}).`,
    ),
    ...(entry.blockers ?? [])
      .filter(
        (b) =>
          !baseline ||
          !/calculator.?model|not (be )?modell?able|cannot be modell?ed|death-(triggered|based) accrual|runs from (delivery|first)|does not run from|not .?act or omission/i.test(
            `${b.issue} ${b.why}`,
          ),
      )
      .map((b) =>
        baseline
          ? `Open item (does not prevent a date): ${b.issue}. ${b.why}`
          : `Cannot issue a date: ${b.issue}. ${b.why}`,
      ),
    ...(entry.crossChecks ?? []).map(
      (c) => `Related provision or cross-check (capture ${c.captureId}): ${c.note}`,
    ),
    ...provenance.flags.map((f) => `Flag: ${f}`),
  ];
  return [...new Set(notes)];
}
