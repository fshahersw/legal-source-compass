import { createFileRoute } from "@tanstack/react-router";
import { PlacesMap } from "@/components/corpus/PlacesMap";
import { parseMapSearch, type MapSearch } from "@/components/places/mapSearch";
import { pageHead } from "@/lib/corpus/head";

export const Route = createFileRoute("/")({
  validateSearch: (search: Record<string, unknown>): MapSearch => parseMapSearch(search),
  head: () =>
    pageHead(
      "States & courts",
      "Explore U.S. states, courts, judicial profiles, law and regulatory sources.",
    ),
  component: () => <PlacesMap home />,
});
