import { createFileRoute } from "@tanstack/react-router";

import { HubPage } from "@/components/matters/HubPage";
import {
  matterHubPdfQuery,
  matterHubQuery,
  mdlVelocityQuery,
} from "@/components/matters/hub/hubQueries";
import { pageHead } from "@/lib/corpus/head";

export const Route = createFileRoute("/matters/seeger-weiss")({
  // The PDF counts and the JPML series start with the table but never hold the page: only the table is awaited.
  loader: ({ context }) => {
    void context.queryClient.prefetchQuery(matterHubPdfQuery);
    void context.queryClient.prefetchQuery(mdlVelocityQuery);
    return context.queryClient.prefetchQuery(matterHubQuery);
  },
  head: () =>
    pageHead(
      "Seeger Weiss matters",
      "Priority MDLs for the firm: portfolio size, growth and coverage from the JPML reports, then each matter's master docket, cases, docket entries, verified documents and counsel.",
    ),
  component: HubPage,
});
