/**
 * Recall and adverse-event trends on the product-safety pages, drawn with the Analytics hub's cards: the landing page
 * shows each agency's recalls by year, and an agency's page shows that agency's own series next to its record kinds.
 */
import { HubTrend, TrendGrid } from "@/components/trends/ProfileTrend";
import { LANDING_RECALL_BLOCKS, safetyAgencyBlockIds } from "./safetyBlocks";

export function SafetyRecallTrends() {
  return (
    <section aria-label="Recalls by year" className="space-y-2">
      <div>
        <h3 className="text-sm font-semibold leading-5">Recalls by year</h3>
        <p className="text-[11px] text-muted-foreground">
          What each agency published, by year. One recall can cover many products and units, and the
          agencies count and classify recalls differently, so the series are not comparable with
          each other.
        </p>
      </div>
      <TrendGrid columns={2}>
        {LANDING_RECALL_BLOCKS.map((id) => (
          <HubTrend key={id} id={id} />
        ))}
      </TrendGrid>
    </section>
  );
}

/** An agency page's own series; nothing for an agency without one. */
export function SafetyAgencyTrends({ agency }: { agency: string }) {
  const ids = safetyAgencyBlockIds(agency);
  if (!ids.length) return null;
  return (
    <section aria-label={`${agency} trends`} className="space-y-2">
      <h3 className="text-sm font-semibold leading-5">{agency} by year</h3>
      <TrendGrid>
        {ids.map((id) => (
          <HubTrend key={id} id={id} />
        ))}
      </TrendGrid>
    </section>
  );
}
