import { Link, createFileRoute } from "@tanstack/react-router";
import { FileCheck2, Handshake } from "lucide-react";
import { AppShell } from "@/components/atlas/AppShell";
import { SectionIndex } from "@/components/kit";
import { OfficialSettlements } from "@/components/enforcement/actions/OfficialSettlements";
import { officialSettlementsQuery } from "@/components/enforcement/actions/actionsView";
import {
  SettlementNotices,
  settlementNoticesQuery,
} from "@/components/enforcement/SettlementNotices";
import { normalizeSettlementsSearch, type SettlementsSearch } from "@/lib/atlas/legacyRoutes";
import { pageHead } from "@/lib/corpus/head";
import { cn } from "@/lib/utils";

/**
 * Litigation › Settlements: settlements confirmed on an official page (formerly Enforcement › Confirmed settlements)
 * and published settlement notices (formerly Enforcement › Settlement notices), one view each.
 */
export const Route = createFileRoute("/litigation/settlements")({
  validateSearch: (raw: Record<string, unknown>): SettlementsSearch =>
    normalizeSettlementsSearch(raw),
  loaderDeps: ({ search }) => ({ view: search.view }),
  loader: ({ context, deps }) => {
    const warm =
      deps.view === "notices"
        ? context.queryClient.prefetchQuery(settlementNoticesQuery)
        : context.queryClient.prefetchQuery(officialSettlementsQuery);
    return typeof window === "undefined" ? warm : undefined;
  },
  head: () =>
    pageHead(
      "Settlements",
      "Open claim deadlines first, with settlement fund totals kept apart from per-claimant amounts, as confirmed on official settlement pages; plus settlement notices with their official sources.",
    ),
  component: Page,
});

const VIEWS = [
  {
    id: undefined,
    label: "Confirmed on official pages",
    Icon: FileCheck2,
    title: "Settlements confirmed on official pages",
  },
  { id: "notices", label: "Settlement notices", Icon: Handshake, title: "Settlement notices" },
] as const;

function Page() {
  const search = Route.useSearch();
  const current = VIEWS.find((v) => v.id === search.view) ?? VIEWS[0];
  return (
    <AppShell
      title="Settlements"
      description="Open claim deadlines and typed amounts from official settlement pages."
      breadcrumbs={search.view ? [{ label: current.label }] : []}
    >
      {current.id === "notices" ? null : (
        <SectionIndex
          items={[
            { id: "settlement-deadlines", label: "Claim deadlines" },
            { id: "settlement-amounts", label: "Settlement amounts" },
          ]}
        />
      )}
      <div className="space-y-3">
        <nav
          aria-label="Settlement views"
          className="flex max-w-full gap-1 overflow-x-auto rounded-md border border-border bg-surface p-1"
        >
          {VIEWS.map(({ id, label, Icon }) => (
            <Link
              key={label}
              to="/litigation/settlements"
              search={id ? { view: id } : {}}
              replace
              resetScroll={false}
              aria-current={current.id === id ? "page" : undefined}
              className={cn(
                "flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded px-3 py-1.5 text-xs transition-colors focus-visible:outline-2 focus-visible:outline-ring",
                current.id === id
                  ? "bg-primary font-semibold text-primary-foreground"
                  : "text-muted-foreground hover:bg-muted",
              )}
            >
              <Icon className="size-3.5" aria-hidden />
              {label}
            </Link>
          ))}
        </nav>
        <h2 className="sr-only">{current.title}</h2>
        {current.id === "notices" ? <SettlementNotices /> : <OfficialSettlements />}
      </div>
    </AppShell>
  );
}
