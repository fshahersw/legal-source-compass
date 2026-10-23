/**
 * An agency's own published yearly series, drawn with the Analytics hub's cards on the agency profile. The mapping is by
 * exact Federal Register agency id: a card is shown only on the profile of the agency whose own data file it counts, and a
 * department is never given the series of one of its components.
 */
import { HubTrend, TrendGrid } from "@/components/trends/ProfileTrend";
import { agencyBlockIds } from "./agencyBlocks";

export function AgencySeriesCards({ agencyId, label }: { agencyId: number; label: string }) {
  const ids = agencyBlockIds(agencyId);
  if (!ids.length) return null;
  return (
    <section aria-label={`Trends in ${label}'s published data`} className="space-y-2">
      <div>
        <h3 className="text-sm font-semibold leading-5">
          Trends in {label}&rsquo;s published data
        </h3>
        <p className="text-[11px] text-muted-foreground">
          Yearly series from this agency&rsquo;s own data files. Each card names what it counts, its
          period and its source; counts are of published items, not of every action taken.
        </p>
      </div>
      <TrendGrid>
        {ids.map((id) => (
          <HubTrend key={id} id={id} />
        ))}
      </TrendGrid>
    </section>
  );
}
