import { exceptionInventory, type ExceptionItem } from "@/lib/limitations/exceptionReview";
import type { LimitationRule, LimitationsSnapshot } from "@/lib/limitations/types";
import { crossReferenceFacts, type CrossReferenceFacts } from "./ruleAuthority";

export type TollingNoteCategory = "incapacity" | "concealment" | "class_action";

/** The release's own tolling notes routed to a screening category (exceptionInventory's routing), with section links. */
export function tollingNotesFor(
  snapshot: LimitationsSnapshot,
  rule: LimitationRule,
  category: TollingNoteCategory,
): { note: ExceptionItem; link: CrossReferenceFacts | null }[] {
  return exceptionInventory(snapshot, rule)
    .filter((n) => n.kind === "tolling" && n.categories.includes(category))
    .map((note) => {
      // Exact position and citation: a reordered note never inherits another note's link.
      const link = rule.crossReferenceLinks?.find(
        (l) => l.kind === "tolling" && l.index === note.index && l.citation === note.citation,
      );
      return { note, link: link ? crossReferenceFacts(rule.jurisdiction, link) : null };
    });
}

/** Supreme Court class-tolling decisions held in the case-law layer (cluster ids checked against caselaw.cases). */
export const CLASS_TOLLING_CASES = [
  {
    cluster: "108909",
    name: "American Pipe & Construction Co. v. Utah",
    cite: "414 U.S. 538 (1974)",
  },
  { cluster: "110963", name: "Crown, Cork & Seal Co. v. Parker", cite: "462 U.S. 345 (1983)" },
  {
    cluster: "4403797",
    name: "California Public Employees' Retirement System v. ANZ Securities, Inc.",
    cite: "582 U.S. 497 (2017)",
  },
  { cluster: "4506001", name: "China Agritech, Inc. v. Resh", cite: "584 U.S. 732 (2018)" },
] as const;

export const CLASS_TOLLING_SENTENCE =
  "Whether class-action tolling reaches a state-law claim, and whether it reaches repose, depends on the governing law; nothing is computed.";
