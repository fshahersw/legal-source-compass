import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/atlas/AppShell";
import { LegislationTabs } from "@/components/legislation/LegislationTabs";
import { MemberSearch, type MemberSearchParams } from "@/components/legislation/MemberSearch";
import { pageHead } from "@/lib/corpus/head";
import { MEMBER_CHAMBERS, PARTY_PATTERN, USPS } from "@/lib/external/congressMembers";

const pick = (v: unknown, re: RegExp, max = 200) =>
  typeof v === "string" && v.length <= max && re.test(v) ? v : undefined;

export const Route = createFileRoute("/law_/legislation/members/")({
  validateSearch: (s: Record<string, unknown>): MemberSearchParams => ({
    q: typeof s["q"] === "string" && s["q"].trim() ? s["q"].slice(0, 200) : undefined,
    status: s["status"] === "former" ? "former" : s["status"] === "all" ? "all" : undefined,
    chamber:
      typeof s["chamber"] === "string" &&
      (MEMBER_CHAMBERS as readonly string[]).includes(s["chamber"])
        ? (s["chamber"] as "senate" | "house")
        : undefined,
    state: pick(s["state"], USPS),
    party: pick(s["party"], PARTY_PATTERN, 60),
    congress: pick(s["congress"], /^(6[89]|[7-9]\d|1[01]\d)$/),
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
      "Members of Congress",
      "Current and former members of the Senate and House from the Congress.gov API: terms by Congress, party history, official website and the bills each sponsored, as published.",
    ),
  component: MembersIndexPage,
});

function MembersIndexPage() {
  const search = Route.useSearch();
  return (
    <AppShell
      breadcrumbs={[
        { label: "Home", to: "/" },
        { label: "Law & regulation", to: "/law" },
        { label: "Legislation", to: "/law/legislation" },
        { label: "Members of Congress" },
      ]}
      title="Members of Congress"
      description="Every member Congress.gov lists, current and historical: terms by Congress, party history, official website and the bills each sponsored or cosponsored, as published."
    >
      <LegislationTabs active="members" />
      <MemberSearch search={search} />
      <p className="mt-4 max-w-[90ch] text-[11px] leading-4 text-muted-foreground">
        Members, terms and parties come from the Congress.gov API (Library of Congress), exactly as
        it publishes them; nothing is inferred. The Bioguide ID is the Biographical Directory's
        identifier. Party shown is the latest entry of the API's party history. Committee membership
        is not published by the API and is not shown.
      </p>
    </AppShell>
  );
}
