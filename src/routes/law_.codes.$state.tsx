import { createFileRoute, useNavigate } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AppShell } from "@/components/atlas/AppShell";
import { DatasetCodeBrowser } from "@/components/corpus/DatasetCodeBrowser";
import { ExternalError } from "@/components/corpus/ExternalBadge";
import { ProjectionCodeBrowser } from "@/components/corpus/ProjectionCodeBrowser";
import { TexasCodeBrowser } from "@/components/corpus/TexasCodeBrowser";
import { pageHead } from "@/lib/corpus/head";
import { stateByUsps } from "@/lib/corpus/geo";
import { listStateCodes } from "@/lib/law/stateCode.functions";
import type { HierarchyStep } from "@/lib/law/stateCodeContract";

type CodeSearch = {
  code?: string | undefined;
  chapter?: string | undefined;
  section?: string | undefined;
  title?: string | undefined;
  q?: string | undefined;
  path?: string | undefined;
};

function hierarchyPath(value: unknown): HierarchyStep[] {
  if (typeof value !== "string" || !value.startsWith("[")) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed) || parsed.length > 12) return [];
    const steps: HierarchyStep[] = [];
    for (const item of parsed) {
      if (!item || typeof item !== "object") return [];
      const level = (item as { level?: unknown }).level;
      const number = (item as { number?: unknown }).number;
      if (typeof level !== "string" || !/^[a-z][a-z_]{1,40}$/.test(level)) return [];
      if (number !== null && typeof number !== "string") return [];
      steps.push({ level, number });
    }
    return steps;
  } catch {
    return [];
  }
}

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
    code: text(search["code"], 40),
    chapter: text(search["chapter"], 400),
    section: text(search["section"], 512),
    title: text(search["title"], 200),
    q: text(search["q"], 120),
    path: text(search["path"], 2000),
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
  const listFn = useServerFn(listStateCodes);
  const codes = useQuery({
    queryKey: ["full-state-codes"],
    queryFn: () => listFn(),
    staleTime: 0,
  });
  const listing = codes.data?.find((row) => row.state === usps);
  const crumbs = [
    { label: "Atlas", to: "/" },
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
        code: search.code,
        q: search.q,
        path: search.path,
        title: next.title,
        chapter: next.chapter,
        section: next.section,
      },
    });
  };

  let body: ReactNode;
  if (!place)
    body = (
      <p className="text-sm text-muted-foreground">No U.S. state or DC has the code “{state}”.</p>
    );
  else if (codes.isLoading)
    body = <p className="text-sm text-muted-foreground">Loading full code status…</p>;
  else if (codes.error) body = <ExternalError error={codes.error} />;
  else if (!listing)
    body = (
      <p className="rounded-lg border border-border bg-surface p-4 text-sm text-muted-foreground">
        Not yet captured
      </p>
    );
  else if (listing.kind === "projection") {
    const steps = hierarchyPath(search.path);
    body = (
      <ProjectionCodeBrowser
        listing={listing}
        path={steps}
        section={search.section}
        onNavigate={(next) => {
          void navigate({
            search: {
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

  return (
    <AppShell breadcrumbs={crumbs} title={listing?.codeName ?? `${place?.name ?? usps} code`}>
      {body}
    </AppShell>
  );
}
