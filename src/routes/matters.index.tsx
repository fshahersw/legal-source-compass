import { createFileRoute, Link } from "@tanstack/react-router";
import { SectionPage, dsSearch } from "@/components/corpus/SectionPage";
import { pageHead } from "@/lib/corpus/head";

export const Route = createFileRoute("/matters/")({
  validateSearch: dsSearch,
  head: () =>
    pageHead("Matters", "Browse multidistrict litigations, cases, dockets and documents."),
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
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-primary bg-primary p-4 text-primary-foreground shadow-card">
          <span className="min-w-0">
            <span className="block font-display text-xl font-semibold">
              Seeger Weiss priority matters
            </span>
            <span className="mt-1 block text-[13px] text-primary-foreground/85">
              Cases, docket entries, available documents, and counsel.
            </span>
          </span>
          <Link
            to="/matters/seeger-weiss"
            className="rounded-md border border-primary-foreground/40 px-3 py-2 text-[13px] font-semibold hover:bg-primary-foreground/10"
          >
            Browse priority matters
          </Link>
        </div>
      }
    />
  );
}
