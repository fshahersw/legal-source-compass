import { createFileRoute, Link } from "@tanstack/react-router";
import { SectionPage, dsSearch } from "@/components/corpus/SectionPage";
import { pageHead } from "@/lib/corpus/head";

export const Route = createFileRoute("/matters/")({
  validateSearch: dsSearch,
  head: () =>
    pageHead(
      "Matters",
      "MDLs, dockets, case inventories, counsel, settlements, verdicts and expert rulings.",
    ),
  component: MattersPage,
});

function MattersPage() {
  const { ds } = Route.useSearch();
  return (
    <SectionPage
      section="matters"
      path="/matters"
      ds={ds}
      callout={
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-primary/25 bg-primary/5 px-4 py-3 text-[13px]">
          <span>
            <span className="font-semibold">Seeger Weiss matters hub.</span>{" "}
            <span className="text-muted-foreground">
              Priority MDLs, Tier 1 first, with master docket, cases, docket entries, verified
              documents and counsel for each.
            </span>
          </span>
          <Link
            to="/matters/seeger-weiss"
            className="font-medium text-primary underline-offset-2 hover:underline"
          >
            Open the hub
          </Link>
        </div>
      }
    />
  );
}
