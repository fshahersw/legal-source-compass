import { createFileRoute } from "@tanstack/react-router";
import { Undo2 } from "lucide-react";
import { useMemo } from "react";

import { AppShell } from "@/components/atlas/AppShell";
import { EmptyBundleState } from "@/components/atlas/EmptyBundleState";
import { LibraryBrowser } from "@/components/atlas/LibraryBrowser";
import { Button } from "@/components/ui/button";
import { reviewCounts } from "@/lib/atlas/review";
import { useAtlas } from "@/lib/atlas/store";

export const Route = createFileRoute("/review-queue")({
  head: () => ({
    meta: [
      { title: "Review Queue — Legal Source Atlas" },
      {
        name: "description",
        content:
          "Work through imported litigation sources and record browser-local review decisions with mandatory reasons, timestamps and undo.",
      },
      { property: "og:title", content: "Review Queue — Legal Source Atlas" },
      {
        property: "og:description",
        content: "Browser-local review overlay for imported litigation source records.",
      },
    ],
  }),
  component: ReviewQueueView,
});

function ReviewQueueView() {
  const { bundle, overlays, lastReview, undoLastReview } = useAtlas();
  const sources = bundle?.sources ?? [];
  const counts = useMemo(() => reviewCounts(overlays), [overlays]);

  return (
    <AppShell
      breadcrumbs={[{ label: "Atlas", to: "/" }, { label: "Review Queue" }]}
      title="Review Queue"
      description="Local triage of imported sources. Open any row to record a decision — a reason is required and each decision is timestamped in this browser."
      actions={
        lastReview ? (
          <Button size="sm" variant="outline" onClick={undoLastReview}>
            <Undo2 className="size-3.5" /> Undo last decision
          </Button>
        ) : null
      }
    >
      {sources.length === 0 ? (
        <EmptyBundleState view="The review queue" />
      ) : (
        <>
          <div className="mb-4 grid gap-3 sm:grid-cols-4">
            {[
              { label: "Decisions recorded", value: counts.total },
              { label: "Accepted", value: counts.accepted },
              { label: "Rejected", value: counts.rejected },
              { label: "Needs follow-up", value: counts.needs_follow_up },
            ].map((stat) => (
              <div
                key={stat.label}
                className="rounded-lg border border-border bg-surface p-3 shadow-card"
              >
                <div className="eyebrow">{stat.label}</div>
                <div className="mt-0.5 font-display text-2xl">{stat.value.toLocaleString()}</div>
              </div>
            ))}
          </div>

          <p className="mb-4 rounded-md border border-warning/40 bg-warning/10 p-3 text-[12px] leading-relaxed text-warning-foreground">
            Review decisions here are a <strong>browser-local overlay</strong>. They are stored only in
            this browser, are kept entirely separate from the imported curation and promotion records,
            and are not a verification of the live source.
          </p>

          <LibraryBrowser sources={sources} scope="review-queue" />
        </>
      )}
    </AppShell>
  );
}
