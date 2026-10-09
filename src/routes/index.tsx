import { createFileRoute } from "@tanstack/react-router";
import { PlacesMap } from "@/components/corpus/PlacesMap";
import { pageHead } from "@/lib/corpus/head";

export const Route = createFileRoute("/")({
  head: () =>
    pageHead(
      "State legal research atlas",
      "Explore U.S. states, courts, judicial profiles, law and regulatory sources.",
    ),
  component: () => <PlacesMap home />,
});
