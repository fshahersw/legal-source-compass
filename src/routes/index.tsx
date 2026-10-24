import { createFileRoute } from "@tanstack/react-router";
import { OverviewBriefing, OverviewSections } from "@/components/atlas/hub/OverviewBriefing";
import { PlacesMap } from "@/components/corpus/PlacesMap";
import { parseMapSearch, type MapSearch } from "@/components/places/mapSearch";
import { pageHead } from "@/lib/corpus/head";

export const Route = createFileRoute("/")({
  validateSearch: (search: Record<string, unknown>): MapSearch => parseMapSearch(search),
  head: () =>
    pageHead(
      "Overview",
      "The national map of courts, litigation, law, enforcement and Census figures, with a briefing across courts, litigation, law, enforcement, products and companies.",
    ),
  component: () => <PlacesMap home before={<OverviewBriefing />} after={<OverviewSections />} />,
});
