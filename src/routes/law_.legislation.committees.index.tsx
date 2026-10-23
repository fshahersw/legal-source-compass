import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/atlas/AppShell";
import {
  CommitteeSearch,
  type CommitteeSearchParams,
} from "@/components/legislation/CommitteeSearch";
import { LegislationTabs } from "@/components/legislation/LegislationTabs";
import { pageHead } from "@/lib/corpus/head";
import { COMMITTEE_CHAMBERS } from "@/lib/external/congressMembers";

const pick = (v: unknown, re: RegExp, max = 200) =>
  typeof v === "string" && v.length <= max && re.test(v) ? v : undefined;

export const Route = createFileRoute("/law_/legislation/committees/")({
  validateSearch: (s: Record<string, unknown>): CommitteeSearchParams => ({
    q: typeof s["q"] === "string" && s["q"].trim() ? s["q"].slice(0, 200) : undefined,
    status: s["status"] === "former" ? "former" : s["status"] === "all" ? "all" : undefined,
    chamber:
      typeof s["chamber"] === "string" &&
      (COMMITTEE_CHAMBERS as readonly string[]).includes(s["chamber"])
        ? (s["chamber"] as "house" | "senate" | "joint")
        : undefined,
    level:
      s["level"] === "committee"
        ? "committee"
        : s["level"] === "subcommittee"
          ? "subcommittee"
          : undefined,
    type: pick(s["type"], /^[A-Za-z ]{3,40}$/, 40),
    congress: pick(s["congress"], /^([1-9]\d?|1[01]\d)$/),
    page:
      typeof s["page"] === "number" &&
      Number.isInteger(s["page"]) &&
      s["page"] >= 1 &&
      s["page"] <= 200
        ? s["page"]
        : undefined,
  }),
  head: () =>
    pageHead(
      "Congressional committees",
      "House, Senate and joint committees and subcommittees, current and historical, from the Congress.gov API: type, parent, name history and the Congresses that list each.",
    ),
  component: CommitteesIndexPage,
});

function CommitteesIndexPage() {
  const search = Route.useSearch();
  return (
    <AppShell
      breadcrumbs={[
        { label: "Home", to: "/" },
        { label: "Law & regulation", to: "/law" },
        { label: "Legislation", to: "/law/legislation" },
        { label: "Committees" },
      ]}
      title="Congressional committees"
      description="House, Senate and joint committees and their subcommittees, current and historical, with type, parent, name history and the Congresses that list each."
    >
      <LegislationTabs active="committees" />
      <CommitteeSearch search={search} />
      <p className="mt-4 max-w-[90ch] text-[11px] leading-4 text-muted-foreground">
        Committees come from the Congress.gov API (Library of Congress), exactly as it publishes
        them. The API publishes no committee membership, so none is shown; no other source is used
        for it.
      </p>
    </AppShell>
  );
}
