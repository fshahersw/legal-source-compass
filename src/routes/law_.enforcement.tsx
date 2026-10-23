import { createFileRoute, redirect } from "@tanstack/react-router";
import { resolveEnforcementLocation } from "@/lib/atlas/legacyRoutes";

/**
 * Former address of the Enforcement page. Enforcement is its own section now (/enforcement); every former query is
 * mapped to its new place (?tab=cpsc → Actions by agency › CPSC, ?actions=sec → Actions by agency › SEC, ?state=CA →
 * EPA in California, ?tab=rulemaking → Law & government › Rulemaking, settlements → Litigation › Settlements).
 */
type LegacySearch = {
  tab?: string | undefined;
  actions?: string | undefined;
  state?: string | undefined;
  agency?: string | undefined;
};
const text = (v: unknown) => (typeof v === "string" && v.length <= 40 ? v : undefined);

export const Route = createFileRoute("/law_/enforcement")({
  // Kept so links written for the former page still type-check; the values only feed the redirect.
  validateSearch: (raw: Record<string, unknown>): LegacySearch => ({
    tab: text(raw["tab"]),
    actions: text(raw["actions"]),
    state: text(raw["state"]),
    agency: text(raw["agency"]),
  }),
  beforeLoad: ({ location }) => {
    const target = resolveEnforcementLocation(location.search as Record<string, unknown>);
    throw redirect({ to: target.to, search: target.search as never, replace: true });
  },
});
