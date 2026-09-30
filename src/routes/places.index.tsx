import { createFileRoute } from "@tanstack/react-router";
import { PlacesMap } from "@/components/corpus/PlacesMap";
import { pageHead } from "@/lib/corpus/head";

export const Route = createFileRoute("/places/")({
  head: () => pageHead("Places Map", "Interactive U.S. state and county map of litigation research sources and saved case rows."),
  component: () => <PlacesMap />,
});
