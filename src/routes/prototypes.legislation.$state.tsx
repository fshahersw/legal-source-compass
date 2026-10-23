import { createFileRoute, Link } from "@tanstack/react-router";
import { AppShell } from "@/components/atlas/AppShell";
import { BillForLaw } from "@/components/legislation/BillForLaw";
import { StateLegislationPanel } from "@/components/legislation/StateLegislationPanel";
import { pageHead } from "@/lib/corpus/head";
import { STATE } from "@/lib/external/legislation";

/** Preview of the legislation panel for a state page and the originating-bill box for a law page, on live data. */
export const Route = createFileRoute("/prototypes/legislation/$state")({
  head: () =>
    pageHead(
      "Legislation panels",
      "Preview of the state legislation panel and the originating-bill box.",
    ),
  component: Page,
});

function Page() {
  const { state } = Route.useParams();
  const usps = state.toUpperCase();
  return (
    <AppShell
      breadcrumbs={[
        { label: "Home", to: "/" },
        { label: "Prototypes", to: "/prototypes" },
        { label: "Legislation panels" },
      ]}
      title="Legislation panels"
      description="The state page panel and the law page box as they would appear when mounted."
    >
      <p
        role="note"
        className="mb-4 rounded-md border border-border bg-muted/40 px-3 py-2 text-[12px] text-muted-foreground"
      >
        Preview of components that are not mounted yet: the panel for state pages and the
        originating-bill box for public law pages. Every figure is live corpus data.
      </p>
      {STATE.test(usps) ? (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <div className="min-w-0 space-y-3">
            <p className="m-0 text-[12.5px] text-muted-foreground">
              Law page box for Public Law 118-63 and Public Law 117-58:
            </p>
            <BillForLaw congress={118} lawNumber={63} />
            <BillForLaw congress={117} lawNumber={58} />
            <BillForLaw congress={119} lawNumber={9999} />
            <p className="m-0 text-[12px]">
              Other states:{" "}
              {["CA", "TX", "NY", "NE", "DC", "PR"].map((s) => (
                <Link
                  key={s}
                  to="/prototypes/legislation/$state"
                  params={{ state: s }}
                  className="mr-2 text-primary hover:underline"
                >
                  {s}
                </Link>
              ))}
            </p>
          </div>
          <aside className="min-w-0">
            <StateLegislationPanel usps={usps} />
          </aside>
        </div>
      ) : (
        <p className="text-[13px] text-muted-foreground">
          Use a two-letter state code, e.g. /prototypes/legislation/CA.
        </p>
      )}
    </AppShell>
  );
}
