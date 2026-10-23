import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/atlas/AppShell";
import { AgenciesForTitlePanel, CfrAgencyIndex } from "@/components/authorities/AgencyPanels";
import { AuthoritiesForPartPanel } from "@/components/authorities/AuthoritiesForPartPanel";
import { RegulationsUnderSectionPanel } from "@/components/authorities/RegulationsUnderSectionPanel";
import { SubjectsForPartPanel } from "@/components/authorities/SubjectsForPartPanel";
import { pageHead } from "@/lib/corpus/head";

type PreviewSearch = { usc?: string | undefined; cfr?: string | undefined };

const pair = (v: unknown, fallback: string): string =>
  typeof v === "string" && /^[0-9a]{1,3}\/[A-Za-z0-9._-]{1,40}$/.test(v) ? v : fallback;

/** Preview of the statute <-> regulation panels and the agency panels, on corpus data. */
export const Route = createFileRoute("/prototypes/authorities")({
  validateSearch: (search: Record<string, unknown>): PreviewSearch => ({
    usc: typeof search["usc"] === "string" ? pair(search["usc"], "42/1395hh") : undefined,
    cfr: typeof search["cfr"] === "string" ? pair(search["cfr"], "21/314") : undefined,
  }),
  head: () =>
    pageHead(
      "Statute and regulation panels",
      "Preview of the panels that connect U.S. Code sections to the CFR parts that cite them.",
    ),
  component: Page,
});

function Page() {
  const search = Route.useSearch();
  const [uscTitle, uscKey] = (search.usc ?? "42/1395hh").split("/") as [string, string];
  const [cfrTitle, cfrPart] = (search.cfr ?? "21/314").split("/") as [string, string];
  return (
    <AppShell
      breadcrumbs={[
        { label: "Home", to: "/" },
        { label: "Prototypes", to: "/prototypes" },
        { label: "Statute and regulation panels" },
      ]}
      title="Statute and regulation panels"
      description="The panels for U.S. Code section pages, CFR part pages and the CFR agency index, as they would appear when mounted."
    >
      <p
        role="note"
        className="mb-4 rounded-md border border-border bg-muted/40 px-3 py-2 text-[12px] text-muted-foreground"
      >
        Preview of components that are not mounted yet. Change the examples with{" "}
        <code>?usc=42/1395hh&amp;cfr=21/314</code> (title / section and title / part).
      </p>
      <div className="grid gap-4 xl:grid-cols-2">
        <div className="min-w-0 space-y-3">
          <h2 className="eyebrow m-0">
            {uscTitle} U.S.C. § {uscKey}
          </h2>
          <RegulationsUnderSectionPanel title={uscTitle} sectionKey={uscKey} />
          <h2 className="eyebrow m-0 pt-2">Title {cfrTitle}</h2>
          <AgenciesForTitlePanel title={cfrTitle} />
        </div>
        <div className="min-w-0 space-y-3">
          <h2 className="eyebrow m-0">
            {cfrTitle} CFR part {cfrPart}
          </h2>
          <AuthoritiesForPartPanel title={cfrTitle} part={cfrPart} />
          <SubjectsForPartPanel title={cfrTitle} part={cfrPart} />
        </div>
      </div>
      <div className="mt-4">
        <CfrAgencyIndex />
      </div>
    </AppShell>
  );
}
