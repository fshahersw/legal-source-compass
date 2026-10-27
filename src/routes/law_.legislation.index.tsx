import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/atlas/AppShell";
import {
  LegislationSearch,
  type LegislationSearchParams,
} from "@/components/legislation/LegislationSearch";
import { LegislationTabs } from "@/components/legislation/LegislationTabs";
import { BillFlow } from "@/components/lawviz/BillFlow";
import { CivilJusticeWatch } from "@/components/legislation/CivilJusticeWatch";
import { CongressAttention } from "@/components/legislation/CongressAttention";
import { legislationWatchQuery } from "@/components/legislation/legislationWatchQuery";
import { SectionIndex } from "@/components/kit";
import { pageHead } from "@/lib/corpus/head";
import { BILL_TYPES, CONGRESS, SESSION, STATE } from "@/lib/external/legislation";

const pick = (v: unknown, re: RegExp, max = 200) =>
  typeof v === "string" && v.length <= max && re.test(v) ? v : undefined;

export const Route = createFileRoute("/law_/legislation/")({
  validateSearch: (s: Record<string, unknown>): LegislationSearchParams => ({
    scope: s["scope"] === "state" ? "state" : s["scope"] === "federal" ? "federal" : undefined,
    q: typeof s["q"] === "string" && s["q"].trim() ? s["q"].slice(0, 200) : undefined,
    congress: pick(s["congress"], CONGRESS),
    type:
      typeof s["type"] === "string" && (BILL_TYPES as readonly string[]).includes(s["type"])
        ? s["type"]
        : undefined,
    status: pick(s["status"], /^[a-z_]{2,30}$/),
    policy: pick(s["policy"], /^[\p{L}\p{N} ,&'()./-]{2,120}$/u),
    state: pick(s["state"], STATE),
    session: pick(s["session"], SESSION),
    page:
      typeof s["page"] === "number" &&
      Number.isInteger(s["page"]) &&
      s["page"] >= 1 &&
      s["page"] <= 200
        ? s["page"]
        : undefined,
  }),
  loader: ({ context }) => {
    void context.queryClient.prefetchQuery(legislationWatchQuery);
  },
  head: () =>
    pageHead(
      "Legislation",
      "Federal bills and resolutions of the 108th–119th Congress from GovInfo Bill Status, and state bills of the current and preceding regular session from Open States, with official links.",
    ),
  component: LegislationIndexPage,
});

function LegislationIndexPage() {
  const search = Route.useSearch();
  const searching = Object.values(search).some((v) => v !== undefined);
  return (
    <AppShell
      breadcrumbs={[
        { label: "Home", to: "/" },
        { label: "Law & regulation", to: "/law" },
        { label: "Legislation" },
      ]}
      title="Legislation"
      description="Bills and resolutions in Congress since 2003 and in every state legislature's current and preceding regular session, with sponsors, actions, status and the official pages."
    >
      <LegislationTabs active="bills" />
      {searching ? null : (
        <>
          <SectionIndex
            items={[
              { id: "civil-justice-watch", label: "Civil-justice watch" },
              { id: "congress-attention", label: "Congress and mass torts" },
              { id: "bill-search", label: "Search bills" },
            ]}
          />
          <div className="stack-block mb-8">
            <CivilJusticeWatch />
            <CongressAttention />
          </div>
          <h2 id="bill-search" className="mb-3 scroll-mt-16 text-heading text-foreground">
            Search bills
          </h2>
        </>
      )}
      <LegislationSearch search={search} />
      {search.scope !== "state" ? (
        <div className="mt-6">
          <BillFlow />
        </div>
      ) : null}
      <p className="mt-4 max-w-[90ch] text-[11px] leading-4 text-muted-foreground">
        Federal measures come from the U.S. Government Publishing Office's Bill Status files (public
        domain); status is derived only from published action codes. State bills come from Open
        States public data (public domain dedication), which collects them from each legislature's
        website; each bill links to the legislature's own page. Members of Congress and committees
        come from the Congress.gov API; a bill's sponsor links to the member's page only on an exact
        Bioguide ID match.
      </p>
    </AppShell>
  );
}
