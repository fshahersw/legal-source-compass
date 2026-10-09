import {
  decisionResolved,
  type ReviewDecisions,
  type ReviewFactor,
  type ReviewGroup,
} from "./reviewInventory";

export type ReviewFilter = "all" | "attention" | "instructions" | "resolved";

/** Display-only filtering. Never removes a requirement from the actual assessment. */
export function filterReviewFactors(
  factors: readonly ReviewFactor[],
  decisions: ReviewDecisions,
  query: string,
  filter: ReviewFilter,
): ReviewFactor[] {
  const words = query
    .normalize("NFKC")
    .toLocaleLowerCase("en-US")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  return factors.filter((factor) => {
    const decision = decisions[factor.id];
    if (filter === "attention" && decisionResolved(factor, decision)) return false;
    if (filter === "resolved" && !decisionResolved(factor, decision)) return false;
    if (filter === "instructions" && decision?.status !== "instruction") return false;
    const content =
      `${factor.label}\n${factor.citation ?? ""}\n${factor.text}\n${decision?.note ?? ""}`
        .normalize("NFKC")
        .toLocaleLowerCase("en-US");
    return words.every((word) => content.includes(word));
  });
}

/** Select a next action without guessing the answer or skipping a blocking issue. */
export function nextReviewFactor(
  factors: readonly ReviewFactor[],
  decisions: ReviewDecisions,
  after?: string,
): ReviewFactor | null {
  const start = after ? factors.findIndex((factor) => factor.id === after) + 1 : 0;
  for (let offset = 0; offset < factors.length; offset++) {
    const factor = factors[(start + offset) % factors.length]!;
    if (!decisionResolved(factor, decisions[factor.id])) return factor;
  }
  return null;
}

/** Only the explicit group action can record group acknowledgement. No existing answer is erased. */
export function acknowledgeUnanswered(
  factors: readonly ReviewFactor[],
  decisions: ReviewDecisions,
  group: ReviewGroup,
): ReviewDecisions {
  const next = { ...decisions };
  for (const factor of factors) {
    if (factor.group === group && !Object.hasOwn(next, factor.id)) {
      next[factor.id] = {
        status: "no_effect",
        note: "Explicit group acknowledgement: reviewed with no additional unresolved effect beyond recorded instructions.",
      };
    }
  }
  return next;
}
