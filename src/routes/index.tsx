import { createFileRoute } from "@tanstack/react-router";
import { PlacesMap } from "@/components/corpus/PlacesMap";
import { pageHead } from "@/lib/corpus/head";

export const Route = createFileRoute("/")({
  head: () => pageHead("U.S. litigation map", "Map-first atlas of U.S. courts, judges, MDLs, law, agencies and litigation research sources."),
  component: () => <PlacesMap home />,
});
