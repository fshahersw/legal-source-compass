import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/atlas/AppShell";
import { ApiLawBrowser } from "@/components/apiLaw/ApiLawBrowser";
import { validateBrowserSearch, type BrowserSearch } from "@/components/apiLaw/browserSearch";
import { DatasetSwitch } from "@/components/apiLaw/DatasetSwitch";
import { LegislationTabs } from "@/components/legislation/LegislationTabs";
import { pageHead } from "@/lib/corpus/head";

const KINDS = [
  {
    value: "reports",
    label: "Committee reports",
    dataset: "congress_committee_reports",
    placeholder: "Words in a report title, or a citation (H. Rept. 119-851)",
    columns: [
      ["issued", "Issued"],
      ["bills", "Bills"],
      ["committees", "Committees"],
    ],
    hidden: ["committee", "bill"],
  },
  {
    value: "hearings",
    label: "Hearings",
    dataset: "govinfo_hearings",
    placeholder: "Words in a hearing title, or a package ID (CHRG-119hhrg65550)",
    columns: [
      ["held", "Held"],
      ["class", "Chamber"],
      ["congress", "Congress"],
    ],
    hidden: ["committee"],
  },
  {
    value: "prints",
    label: "Committee prints",
    dataset: "govinfo_committee_prints",
    placeholder: "Words in a print title, or a package ID (CPRT-119HPRT64571)",
    columns: [
      ["issued", "Issued"],
      ["class", "Chamber"],
      ["congress", "Congress"],
    ],
    hidden: [],
  },
] as const;
type Kind = (typeof KINDS)[number]["value"];
type Search = BrowserSearch & { kind?: Kind | undefined };

/** Law & government › Legislation › Committee reports (Congress.gov), hearings and committee prints (GovInfo). */
export const Route = createFileRoute("/law_/legislation/reports")({
  validateSearch: (s: Record<string, unknown>): Search => {
    const kind = KINDS.find((k) => k.value === s["kind"]) ?? KINDS[0];
    return {
      ...validateBrowserSearch(kind.dataset, s),
      kind: kind === KINDS[0] ? undefined : kind.value,
    };
  },
  head: () =>
    pageHead(
      "Committee reports and hearings",
      "Committee reports from the Congress.gov API and published hearings and committee prints from GovInfo, updated daily, with official PDF and text links.",
    ),
  component: Page,
});

function Page() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const kind = KINDS.find((k) => k.value === (search.kind ?? "reports")) ?? KINDS[0];
  return (
    <AppShell
      title="Legislation"
      description="Committee reports as Congress.gov lists them, and the hearings and committee prints GovInfo publishes, each with its official text."
      breadcrumbs={[
        { label: "Home", to: "/" },
        { label: "Law & regulation", to: "/law" },
        { label: "Legislation", to: "/law/legislation" },
        { label: "Reports & hearings" },
      ]}
    >
      <LegislationTabs active="reports" />
      <DatasetSwitch<Kind>
        label="Document kind"
        options={KINDS}
        value={kind.value}
        onChange={(k) =>
          void navigate({
            search: k === "reports" ? {} : { kind: k },
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
        hiddenFilters={[...kind.hidden]}
        columns={kind.columns.map(([a, b]) => [a, b] as [string, string])}
      />
    </AppShell>
  );
}
