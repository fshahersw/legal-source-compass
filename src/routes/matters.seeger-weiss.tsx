import { createFileRoute } from "@tanstack/react-router";

import { HubPage } from "@/components/matters/HubPage";
import { pageHead } from "@/lib/corpus/head";

export const Route = createFileRoute("/matters/seeger-weiss")({
  head: () =>
    pageHead(
      "Seeger Weiss matters",
      "Priority MDLs for the firm with what the corpus holds for each: master docket, cases, docket entries, verified documents and counsel.",
    ),
  component: HubPage,
});
