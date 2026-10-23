import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { AppShell } from "@/components/atlas/AppShell";
import { ExternalError } from "@/components/corpus/ExternalBadge";
import { pageHead } from "@/lib/corpus/head";
import { CFR_TITLE } from "@/lib/external/ecfrFull";
import { getCfrCollection, getCfrTitleParts } from "@/lib/external/ecfrFull.functions";
import { AgenciesForTitlePanel } from "@/components/authorities/AgencyPanels";

export const Route = createFileRoute("/law_/cfr/$title/")({
  head: ({ params }) =>
    pageHead(
      `CFR title ${params.title}`,
      `Parts of title ${params.title} of the Code of Federal Regulations, from the eCFR.`,
    ),
  component: CfrTitlePage,
});

function CfrTitlePage() {
  const { title } = Route.useParams();
  const valid = CFR_TITLE.test(title);
  const partsFn = useServerFn(getCfrTitleParts);
  const collFn = useServerFn(getCfrCollection);
  const q = useQuery({
    queryKey: ["cfr-title-parts", title],
    queryFn: () => partsFn({ data: { title } }),
    enabled: valid,
    staleTime: 10 * 60 * 1000,
  });
  const coll = useQuery({
    queryKey: ["cfr-collection"],
    queryFn: () => collFn(),
    staleTime: 10 * 60 * 1000,
  });
  const name = coll.data?.titles.find((t) => t.title === title)?.name ?? null;
  const [filter, setFilter] = useState("");
  const f = filter.trim().toLowerCase();
  const parts = (q.data?.parts ?? []).filter((p) => !f || p.title.toLowerCase().includes(f));
  return (
    <AppShell
      breadcrumbs={[
        { label: "Home", to: "/" },
        { label: "Law & regulation", to: "/law" },
        { label: "Code of Federal Regulations", to: "/law/cfr" },
        { label: `Title ${title}` },
      ]}
      title={`CFR title ${title}`}
      {...(name ? { description: name } : {})}
    >
      {valid ? (
        <div className="mb-4">
          <AgenciesForTitlePanel title={title} />
        </div>
      ) : null}
      {!valid ? (
        <p className="text-[13px] text-muted-foreground">CFR titles are numbered 1 to 50.</p>
      ) : q.isLoading ? (
        <div
          className="h-48 animate-pulse rounded-lg border border-border bg-muted/40"
          aria-busy="true"
          aria-label="Loading"
        />
      ) : q.error ? (
        <ExternalError error={q.error} />
      ) : !q.data?.parts.length ? (
        <p className="text-[13px] text-muted-foreground">
          No parts are recorded for title {title}
          {title === "35" ? " (title 35 is reserved)" : ""}.{" "}
          <Link to="/law/cfr" className="text-primary underline">
            All titles
          </Link>
        </p>
      ) : (
        <section aria-label="Parts" className="rounded-lg border border-border bg-surface">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/70 px-4 py-2">
            <h2 className="m-0 text-sm font-semibold">Parts</h2>
            <input
              aria-label="Filter parts"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter by number or heading"
              className="w-full max-w-xs rounded-md border border-input bg-background px-2.5 py-1 text-xs"
            />
          </div>
          <ul className="m-0 list-none divide-y divide-border/60 p-0">
            {parts.map((p) => (
              <li
                key={p.id}
                className="flex items-baseline justify-between gap-3 px-4 py-1.5 text-[13px]"
              >
                <Link
                  to="/law/cfr/$title/part/$part"
                  params={{ title, part: p.identifier }}
                  className={
                    p.reserved ? "text-muted-foreground hover:underline" : "hover:underline"
                  }
                >
                  {p.title.replace(new RegExp(`^${title} CFR `), "")}
                </Link>
                <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
                  {p.reserved
                    ? "Reserved"
                    : p.sections !== null
                      ? `${p.sections.toLocaleString("en-US")} ${p.sections === 1 ? "section" : "sections"}`
                      : ""}
                </span>
              </li>
            ))}
          </ul>
          {!parts.length ? (
            <p className="m-0 px-4 py-3 text-[13px] text-muted-foreground">
              No part matches “{filter}”.
            </p>
          ) : null}
          <p className="m-0 border-t border-border/70 px-4 py-2 text-[11px] text-muted-foreground">
            {parts.length.toLocaleString("en-US")} of {q.data.parts.length.toLocaleString("en-US")}{" "}
            parts
            {q.data.dropped ? ` · ${q.data.dropped} stored rows could not be read` : ""}
          </p>
        </section>
      )}
    </AppShell>
  );
}
