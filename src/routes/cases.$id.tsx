import { createFileRoute, Link } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/atlas/AppShell";
import { caseQuery } from "@/components/caselaw/caseQueries";
import { CaseView } from "@/components/caselaw/CaseView";
import { DocumentsPanel } from "@/components/documents/DocumentsPanel";
import { citeLine, fmtDay } from "@/components/caselaw/caseFormat";
import { pageHead } from "@/lib/corpus/head";

const parseId = (s: string) =>
  /^[1-9]\d{0,9}$/.test(s) && Number(s) <= 2_000_000_000 ? Number(s) : null;

type S = { tab?: string | undefined };

export const Route = createFileRoute("/cases/$id")({
  validateSearch: (s: Record<string, unknown>): S =>
    typeof s["tab"] === "string" && /^(citator|authorities|op-[1-9]\d{0,9})$/.test(s["tab"])
      ? { tab: s["tab"] }
      : {},
  loader: async ({ context, params }) => {
    const id = parseId(params.id);
    return id == null ? null : context.queryClient.ensureQueryData(caseQuery(id));
  },
  head: ({ loaderData }) => {
    const r = loaderData?.record;
    if (!r) return pageHead("Case", "Case law from CourtListener's bulk data.");
    const t = citeLine(r.caseName, r.citations, r.dateFiled);
    return pageHead(
      t,
      `${t}: ${r.court}, filed ${fmtDay(r.dateFiled)}. Opinion text with reporter page numbers, citator and cited authorities.`,
    );
  },
  component: CasePage,
  pendingComponent: () => (
    <div className="space-y-2 p-6" aria-busy="true" aria-label="Loading the case">
      <div className="h-6 w-2/3 animate-pulse rounded bg-muted/60" />
      <div className="h-24 animate-pulse rounded bg-muted/50" />
      <div className="h-96 animate-pulse rounded bg-muted/40" />
    </div>
  ),
  errorComponent: () => (
    <p role="alert" className="p-6 text-[13px]">
      This case could not be loaded. Try again shortly.
    </p>
  ),
});

function NotFound() {
  return (
    <AppShell
      breadcrumbs={[
        { label: "Home", to: "/" },
        { label: "Law & regulation", to: "/law" },
        { label: "Case law", to: "/cases" },
        { label: "Not found" },
      ]}
      title="Case not found"
    >
      <p className="text-[13px] text-muted-foreground">
        No case with this id is held here (cases of every court level are held when CourtListener
        has an opinion for them; cases it blocks from search engines are never shown).{" "}
        <Link to="/cases" className="text-primary hover:underline">
          Search case law
        </Link>
        .
      </p>
    </AppShell>
  );
}

function CasePage() {
  const { id: raw } = Route.useParams();
  const id = parseId(raw);
  if (id == null) return <NotFound />;
  return <Loaded id={id} />;
}

function Loaded({ id }: { id: number }) {
  const { data } = useSuspenseQuery(caseQuery(id));
  const { tab } = Route.useSearch();
  const navigate = Route.useNavigate();
  if (!data.available || !data.record) return <NotFound />;
  const r = data.record;
  return (
    <AppShell
      breadcrumbs={[
        { label: "Home", to: "/" },
        { label: "Law & regulation", to: "/law" },
        { label: "Case law", to: "/cases" },
        { label: r.tierLabel, to: "/cases", search: { tier: String(r.tier) } },
        { label: r.caseName.length > 60 ? `${r.caseName.slice(0, 57)}…` : r.caseName },
      ]}
      title={r.caseName}
      description={[r.citations[0], r.courtShort ?? r.court, fmtDay(r.dateFiled)]
        .filter(Boolean)
        .join(" · ")}
    >
      <CaseView
        key={r.clusterId}
        page={data}
        initialTab={tab}
        onTab={(t) => void navigate({ search: { tab: t }, replace: true, resetScroll: false })}
      />
      <DocumentsPanel type="case" id={String(r.clusterId)} quiet className="mt-6" />
    </AppShell>
  );
}
