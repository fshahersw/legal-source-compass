import { createFileRoute, useNavigate } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AppShell } from "@/components/atlas/AppShell";
import { DatasetCodeBrowser } from "@/components/corpus/DatasetCodeBrowser";
import { ExternalError } from "@/components/corpus/ExternalBadge";
import { FullCodeEntry } from "@/components/corpus/FullCodeEntry";
import { InForceCodeBrowser } from "@/components/law/InForceCodeBrowser";
import { ProductLiabilityProvisions } from "@/components/law/ProductLiabilityProvisions";
import { PRODUCT_LIABILITY_QUERY } from "@/components/law/lawQueries";
import { ProjectionCodeBrowser } from "@/components/corpus/ProjectionCodeBrowser";
import { TexasCodeBrowser } from "@/components/corpus/TexasCodeBrowser";
import { pageHead } from "@/lib/corpus/head";
import { stateByUsps } from "@/lib/corpus/geo";
import { getStateCodeEntry } from "@/lib/law/stateCode.functions";
import { listStateLawEditions } from "@/lib/law/stateLaw.functions";
import { NODE_ID_MAX, SECTION_ID_MAX } from "@/lib/law/stateLawContract";
import { parseHierarchyPath, type HierarchyStep } from "@/lib/law/stateCodeContract";

type CodeSearch = {
  view?: "inforce" | "captured" | undefined;
  node?: string | undefined;
  sec?: string | undefined;
  lq?: string | undefined;
  code?: string | undefined;
  chapter?: string | undefined;
  section?: string | undefined;
  title?: string | undefined;
  q?: string | undefined;
  path?: string | undefined;
};

const text = (value: unknown, max: number) => {
  const raw =
    typeof value === "string"
      ? value
      : typeof value === "number" && Number.isFinite(value)
        ? String(value)
        : "";
  const trimmed = raw.trim();
  return trimmed ? trimmed.slice(0, max) : undefined;
};

export const Route = createFileRoute("/law_/codes/$state")({
  validateSearch: (search: Record<string, unknown>): CodeSearch => ({
    view:
      search["view"] === "inforce" || search["view"] === "captured" ? search["view"] : undefined,
    node: text(search["node"], NODE_ID_MAX),
    sec: text(search["sec"], SECTION_ID_MAX),
    lq: text(search["lq"], 200),
    code: text(search["code"], 40),
    chapter: text(search["chapter"], 400),
    section: text(search["section"], 512),
    title: text(search["title"], 200),
    q: text(search["q"], 120),
    path: (() => {
      const steps = parseHierarchyPath(search["path"]);
      return steps.length ? JSON.stringify(steps) : undefined;
    })(),
  }),
  head: ({ params }) => {
    const name = stateByUsps.get(params.state.toUpperCase())?.name ?? params.state;
    return pageHead(`${name} code`, `Full code for ${name}.`);
  },
  component: StateCodePage,
});

function StateCodePage() {
  const { state } = Route.useParams();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: "/law/codes/$state" });
  const usps = state.toUpperCase();
  const place = stateByUsps.get(usps);
  const listFn = useServerFn(getStateCodeEntry);
  const codes = useQuery({
    queryKey: ["state-code-entry", usps],
    queryFn: () => listFn({ data: { state: usps } }),
    staleTime: 60_000,
    enabled: !!place,
  });
  const listing = codes.data?.find((row) => row.state === usps);
  const crumbs = [
    { label: "Home", to: "/" },
    { label: "Law & regulation", to: "/law" },
    { label: "State codes", to: "/law/codes" },
    { label: place?.name ?? usps },
  ];

  const go = (next: {
    title?: string | undefined;
    chapter?: string | undefined;
    section?: string | undefined;
  }) => {
    void navigate({
      search: {
        view: search.view,
        code: search.code,
        q: search.q,
        path: search.path,
        title: next.title,
        chapter: next.chapter,
        section: next.section,
      },
    });
  };

  const editionsFn = useServerFn(listStateLawEditions);
  const editions = useQuery({
    queryKey: ["state-law-editions"],
    queryFn: () => editionsFn(),
    staleTime: 60_000,
    enabled: !!place,
  });
  const inForce = editions.data?.editions.find((e) => e.state === usps) ?? null;
  // Deep links into a captured edition (section/path/code/chapter/title) keep opening that edition.
  const legacy = !!(search.section || search.path || search.code || search.chapter || search.title);
  const view = search.view ?? (inForce && !legacy ? "inforce" : "captured");

  let body: ReactNode;
  if (!place)
    body = (
      <p className="text-sm text-muted-foreground">No U.S. state or DC has the code “{state}”.</p>
    );
  else if (codes.isLoading)
    body = <p className="text-sm text-muted-foreground">Loading full code status…</p>;
  else if (codes.error) body = <ExternalError error={codes.error} />;
  else if (!listing) body = <FullCodeEntry state={usps} />;
  else if (listing.kind === "projection") {
    const steps = parseHierarchyPath(search.path);
    body = (
      <ProjectionCodeBrowser
        listing={listing}
        path={steps}
        section={search.section}
        onNavigate={(next) => {
          void navigate({
            search: {
              view: search.view,
              q: search.q,
              path: next.path.length ? JSON.stringify(next.path) : undefined,
              section: next.section,
            },
          });
        }}
      />
    );
  } else if (listing.kind === "snapshot") {
    body = (
      <TexasCodeBrowser
        state={listing.state}
        edition={listing.edition}
        currency={listing.currency}
        note={listing.note}
        initial={{ code: search.code, chapter: search.chapter, section: search.section }}
      />
    );
  } else {
    body = (
      <DatasetCodeBrowser
        listing={listing}
        title={search.title}
        chapter={search.chapter}
        section={search.section}
        onNavigate={go}
      />
    );
  }

  const tabs = inForce ? (
    <div role="tablist" aria-label="Code views" className="mb-4 flex gap-1 border-b border-border">
      {(
        [
          ["inforce", "In force (official publisher)"],
          ["captured", "Captured editions"],
        ] as const
      ).map(([key, label]) => (
        <button
          key={key}
          type="button"
          role="tab"
          aria-selected={view === key}
          className={`-mb-px border-b-2 px-3 py-2 text-sm ${view === key ? "border-primary font-medium" : "border-transparent text-muted-foreground hover:text-foreground"}`}
          onClick={() =>
            void navigate({
              search: key === "inforce" ? { view: "inforce" } : { view: "captured", q: search.q },
            })
          }
        >
          {label}
        </button>
      ))}
    </div>
  ) : null;

  return (
    <AppShell
      breadcrumbs={crumbs}
      title={
        view === "inforce" && inForce
          ? inForce.codeName
          : (listing?.codeName ?? `${place?.name ?? usps} code`)
      }
    >
      {tabs}
      {place && view === "inforce" && inForce && !search.sec && !search.node && !search.lq ? (
        <ProductLiabilityProvisions
          state={usps}
          stateName={place.name}
          onOpen={(sec) => void navigate({ search: { view: "inforce", sec } })}
          onSeeAll={() =>
            void navigate({ search: { view: "inforce", lq: PRODUCT_LIABILITY_QUERY } })
          }
        />
      ) : null}
      {place && view === "inforce" && inForce ? (
        <InForceCodeBrowser
          state={usps}
          nav={{ node: search.node, sec: search.sec, lq: search.lq }}
          onNavigate={(next) =>
            void navigate({
              search: { view: "inforce", node: next.node, sec: next.sec, lq: next.lq },
            })
          }
        />
      ) : (
        body
      )}
    </AppShell>
  );
}
