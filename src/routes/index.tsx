import { createFileRoute } from "@tanstack/react-router";
import { OverviewBriefing, OverviewSections } from "@/components/atlas/hub/OverviewBriefing";
import { PlacesMap } from "@/components/corpus/PlacesMap";
import { parseMapSearch, type MapSearch } from "@/components/places/mapSearch";

const OVERVIEW_DESCRIPTION =
  "The national map of courts, litigation, law, enforcement and Census figures, with a briefing across courts, litigation, law, enforcement, products and companies.";

export const Route = createFileRoute("/")({
  validateSearch: (search: Record<string, unknown>): MapSearch => parseMapSearch(search),
  head: () => ({
    meta: [
      { title: "Overview" },
      { name: "description", content: OVERVIEW_DESCRIPTION },
      { property: "og:title", content: "Overview" },
      { property: "og:description", content: OVERVIEW_DESCRIPTION },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: () => <PlacesMap home before={<OverviewBriefing />} after={<OverviewSections />} />,
});
