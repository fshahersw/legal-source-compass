import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/atlas/AppShell";
import { ApiLawBrowser } from "@/components/apiLaw/ApiLawBrowser";
import { validateBrowserSearch, type BrowserSearch } from "@/components/apiLaw/browserSearch";
import { DatasetSwitch } from "@/components/apiLaw/DatasetSwitch";
import { LegislationTabs } from "@/components/legislation/LegislationTabs";
import { pageHead } from "@/lib/corpus/head";

const KINDS = [
  {
    value: "decisions",
    label: "Legal decisions",
    dataset: "gao_legal_decisions",
    placeholder: "Words in a protester or agency name, or a decision number (B-423574.2)",
    columns: [
      ["b_number", "Decision"],
      ["published", "Published"],
      ["summary", "Summary as published"],
    ],
  },
  {
    value: "archive",
    label: "Reports and decisions, 1994-2008",
    dataset: "govinfo_gao_reports",
    placeholder: "Words in a title, or a report number (GAO-08-823)",
    columns: [
      ["class", "Class"],
      ["issued", "Issued"],
    ],
  },
] as const;
type Kind = (typeof KINDS)[number]["value"];
type Search = BrowserSearch & { kind?: Kind | undefined };

/** Law & government › Legislation › GAO bid protest and Comptroller General decisions (gao.gov feed; GovInfo archive). */
export const Route = createFileRoute("/law_/legislation/gao")({
  validateSearch: (s: Record<string, unknown>): Search => {
    const kind = KINDS.find((k) => k.value === s["kind"]) ?? KINDS[0];
    return {
      ...validateBrowserSearch(kind.dataset, s),
      kind: kind === KINDS[0] ? undefined : kind.value,
    };
  },
  head: () =>
    pageHead(
      "GAO legal decisions",
      "GAO bid protest decisions and Comptroller General decisions from GAO's Legal Products feed, and GAO reports and decisions of 1994-2008 from GovInfo.",
    ),
  component: Page,
});

function Page() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const kind = KINDS.find((k) => k.value === (search.kind ?? "decisions")) ?? KINDS[0];
  return (
    <AppShell
      title="Legislation"
      description="The Government Accountability Office, Congress's audit agency, decides bid protests and appropriations-law questions. New decisions arrive from GAO's feed; GovInfo holds the 1994-2008 archive."
      breadcrumbs={[
        { label: "Home", to: "/" },
        { label: "Law & regulation", to: "/law" },
        { label: "Legislation", to: "/law/legislation" },
        { label: "GAO decisions" },
      ]}
    >
      <LegislationTabs active="gao" />
      <DatasetSwitch<Kind>
        label="Collection"
        options={KINDS}
        value={kind.value}
        onChange={(k) =>
          void navigate({
            search: k === "decisions" ? {} : { kind: k },
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
      <p className="mt-4 text-[12px] text-muted-foreground">
        gao.gov asks automated readers to wait 420 seconds between requests, so its decision history
        is not copied here; new decisions are collected from the feed forward, and every record
        links to its page on gao.gov.
      </p>
    </AppShell>
  );
}
