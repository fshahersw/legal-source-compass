import { createFileRoute } from "@tanstack/react-router";
import { SectionHub } from "@/components/atlas/hub/SectionHub";
import { PlacesMap } from "@/components/corpus/PlacesMap";
import { parseMapSearch, type MapSearch } from "@/components/places/mapSearch";
import { pageHead } from "@/lib/corpus/head";

export const Route = createFileRoute("/places/")({
  validateSearch: (search: Record<string, unknown>): MapSearch => parseMapSearch(search),
  head: () =>
    pageHead(
      "Places",
      "Interactive U.S. state and county map of federal civil filings, MDL actions, judges, enforcement, complaints and Census figures.",
    ),
  component: () => <PlacesMap after={<SectionHub section="places" deferred />} />,
});
