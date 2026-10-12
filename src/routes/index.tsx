import { createFileRoute } from "@tanstack/react-router";
import { PlacesMap } from "@/components/corpus/PlacesMap";
import { pageHead } from "@/lib/corpus/head";

export const Route = createFileRoute("/")({
  head: () =>
    pageHead(
      "States & courts",
      "Explore U.S. states, courts, judicial profiles, law and regulatory sources.",
    ),
  component: () => <PlacesMap home />,
});
