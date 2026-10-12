import type { ClaimType } from "@/lib/limitations/types";

export type ResearchNavigation = {
  state: string;
  claim?: ClaimType;
  view: "calculator" | "coverage" | "sources";
};

/** Keep a calculator's local case mounted while its evidence is inspected. */
export function researchNavigation(
  session: ResearchNavigation | null,
  next: ResearchNavigation,
  fromCalculator = false,
): {
  session: ResearchNavigation | null;
  route: ResearchNavigation | null;
  resetCalculator: boolean;
} {
  const sameCase = session?.state === next.state && session.claim === next.claim;
  if ((fromCalculator && next.view !== "calculator") || sameCase) {
    return { session: next, route: null, resetCalculator: false };
  }
  return { session: null, route: next, resetCalculator: true };
}
