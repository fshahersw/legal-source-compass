import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/atlas/AppShell";
import { ApiLawBrowser } from "@/components/apiLaw/ApiLawBrowser";
import { validateBrowserSearch, type BrowserSearch } from "@/components/apiLaw/browserSearch";
import { DatasetSwitch } from "@/components/apiLaw/DatasetSwitch";
import { LegislationTabs } from "@/components/legislation/LegislationTabs";
import { pageHead } from "@/lib/corpus/head";

const KINDS = [
  {
    value: "nominations",
    label: "Nominations",
    dataset: "congress_nominations",
    placeholder: "A nominee, position or organization, or a citation (PN1423)",
    columns: [
      ["organization", "Organization"],
      ["received", "Received"],
      ["latest_action", "Latest action"],
    ],
  },
  {
    value: "treaties",
    label: "Treaty documents",
    dataset: "congress_treaties",
    placeholder: "Words in a treaty title, or a document number (Treaty Doc. 119-2)",
    columns: [
      ["topic", "Topic"],
      ["transmitted", "Transmitted"],
      ["in_force", "In force"],
    ],
  },
] as const;
type Kind = (typeof KINDS)[number]["value"];
type Search = BrowserSearch & { kind?: Kind | undefined };

/** Law & government › Legislation › Senate nominations and treaty documents (Congress.gov). */
export const Route = createFileRoute("/law_/legislation/nominations")({
  validateSearch: (s: Record<string, unknown>): Search => {
    const kind = KINDS.find((k) => k.value === s["kind"]) ?? KINDS[0];
    return {
      ...validateBrowserSearch(kind.dataset, s),
      kind: kind === KINDS[0] ? undefined : kind.value,
    };
  },
  head: () =>
    pageHead(
      "Nominations and treaties",
      "Presidential nominations and treaty documents before the Senate, from the Congress.gov API, updated daily; judicial nominees link to judges only on an exact match.",
    ),
  component: Page,
});

function Page() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const kind = KINDS.find((k) => k.value === (search.kind ?? "nominations")) ?? KINDS[0];
  return (
    <AppShell
      title="Legislation"
      description="Presidential nominations and treaty documents the Senate received, with their latest actions as Congress.gov publishes them."
      breadcrumbs={[
        { label: "Home", to: "/" },
        { label: "Law & regulation", to: "/law" },
        { label: "Legislation", to: "/law/legislation" },
        { label: "Nominations & treaties" },
      ]}
    >
      <LegislationTabs active="nominations" />
      <DatasetSwitch<Kind>
        label="Record kind"
        options={KINDS}
        value={kind.value}
        onChange={(k) =>
          void navigate({
            search: k === "nominations" ? {} : { kind: k },
            replace: true,
            resetScroll: false,
          })
        }
      />
      <ApiLawBrowser
        key={kind.dataset}
        dataset={kind.dataset}
        search={search}
        onSearch={(next) =>
          void navigate({
            search: { ...next, kind: search.kind },
            replace: true,
            resetScroll: false,
          })
        }
        placeholder={kind.placeholder}
        columns={kind.columns.map(([a, b]) => [a, b] as [string, string])}
      />
    </AppShell>
  );
}
