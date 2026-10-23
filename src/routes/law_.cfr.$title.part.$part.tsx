import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ExternalLink } from "lucide-react";
import { useMemo, useState } from "react";
import { AppShell } from "@/components/atlas/AppShell";
import { ExternalError } from "@/components/corpus/ExternalBadge";
import { CfrBlocks, CfrNotes } from "@/components/regulatory/CfrText";
import { AuthoritiesForPartPanel } from "@/components/authorities/AuthoritiesForPartPanel";
import { SubjectsForPartPanel } from "@/components/authorities/SubjectsForPartPanel";
import { pageHead } from "@/lib/corpus/head";
import { CFR_PART, CFR_TITLE, listHeading, type CfrListItem } from "@/lib/external/ecfrFull";
import { getCfrPart } from "@/lib/external/ecfrFull.functions";

export const Route = createFileRoute("/law_/cfr/$title/part/$part")({
  head: ({ params }) =>
    pageHead(
      `${params.title} CFR part ${params.part}`,
      `Sections and appendices of ${params.title} CFR part ${params.part} with their headings, from the eCFR.`,
    ),
  component: CfrPartPage,
});

function CfrPartPage() {
  const { title, part } = Route.useParams();
  const fn = useServerFn(getCfrPart);
  const valid = CFR_TITLE.test(title) && CFR_PART.test(part);
  const q = useQuery({
    queryKey: ["cfr-part", title, part],
    queryFn: () => fn({ data: { title, part } }),
    enabled: valid,
    staleTime: 10 * 60 * 1000,
  });
  const [filter, setFilter] = useState("");
  const items = useMemo(() => q.data?.items ?? [], [q.data]);
  const groups = useMemo(() => {
    const f = filter.trim().toLowerCase();
    const out: { subpart: string | null; label: string | null; items: CfrListItem[] }[] = [];
    for (const it of items) {
      if (f && !it.title.toLowerCase().includes(f) && !it.identifier.toLowerCase().includes(f))
        continue;
      const last = out[out.length - 1];
      if (last && last.subpart === it.subpart) last.items.push(it);
      else out.push({ subpart: it.subpart, label: it.subpartLabel, items: [it] });
    }
    return out;
  }, [items, filter]);
  const p = q.data?.part ?? null;
  const shownCount = groups.reduce((n, g) => n + g.items.length, 0);
  return (
    <AppShell
      breadcrumbs={[
        { label: "Home", to: "/" },
        { label: "Law & regulation", to: "/law" },
        { label: "Code of Federal Regulations", to: "/law/cfr" },
        { label: `Title ${title}`, to: `/law/cfr/${title}` },
        { label: `Part ${part}` },
      ]}
      title={`${title} CFR part ${part}`}
      {...(p?.heading ? { description: p.heading } : {})}
    >
      {!valid ? (
        <p className="text-[13px] text-muted-foreground">
          This is not a CFR part this collection can look up.
        </p>
      ) : q.isLoading ? (
        <div
          className="h-48 animate-pulse rounded-lg border border-border bg-muted/40"
          aria-busy="true"
          aria-label="Loading"
        />
      ) : q.error ? (
        <ExternalError error={q.error} />
      ) : !p && !items.length ? (
        <p className="text-[13px] text-muted-foreground">
          No part {part} is recorded in title {title} of the current eCFR.{" "}
          <Link to="/law/cfr/$title" params={{ title }} className="text-primary underline">
            Parts of title {title}
          </Link>
        </p>
      ) : (
        <div className="space-y-4">
          {p ? (
            <section
              aria-label="Part"
              className="rounded-lg border border-border bg-surface px-4 py-3 text-[12px]"
            >
              <p className="m-0 leading-relaxed">
                {p.path
                  .filter((x) => x.type !== "title")
                  .map((x) => x.label)
                  .join(" · ")}
              </p>
              <p className="m-0 mt-1 text-muted-foreground">
                {(p.sections ?? items.length).toLocaleString("en-US")} sections and appendices
                {p.range ? ` (${p.range})` : ""} · eCFR up to date as of {p.asOf}
                {p.reserved ? " · reserved" : ""}
              </p>
              {p.ecfrUrl ? (
                <a
                  href={p.ecfrUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-1 inline-flex items-center gap-1 text-primary hover:underline"
                >
                  Official eCFR <ExternalLink className="size-3" aria-hidden />
                </a>
              ) : null}
            </section>
          ) : null}
          {p?.notes.length ? (
            <CfrNotes notes={p.notes} title="Authority, source and notes for this part" />
          ) : null}
          <AuthoritiesForPartPanel title={title} part={part} />
          <SubjectsForPartPanel title={title} part={part} />
          {p?.blocks.length ? (
            <section
              aria-label="Text printed for the part"
              className="rounded-lg border border-border bg-surface p-4"
            >
              <h2 className="eyebrow mb-2">Text printed for the part</h2>
              <CfrBlocks blocks={p.blocks} label="Part text" />
            </section>
          ) : null}
          {items.length ? (
            <section aria-label="Sections" className="rounded-lg border border-border bg-surface">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/70 px-4 py-2">
                <h2 className="m-0 text-sm font-semibold">Sections and appendices</h2>
                <input
                  aria-label="Filter sections"
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  placeholder="Filter by number or heading"
                  className="w-full max-w-xs rounded-md border border-input bg-background px-2.5 py-1 text-xs"
                />
              </div>
              {groups.length ? (
                groups.map((g, k) => (
                  <div key={`${g.subpart ?? "none"}-${k}`}>
                    {g.subpart ? (
                      <h3 className="m-0 border-b border-border/70 bg-muted/30 px-4 py-1.5 text-[12px] font-semibold text-muted-foreground">
                        {g.label ?? `Subpart ${g.subpart}`}
                      </h3>
                    ) : null}
                    <ul className="m-0 list-none divide-y divide-border/60 p-0">
                      {g.items.map((it) => (
                        <li key={it.id} className="px-4 py-1.5 text-[13px]">
                          <Link
                            to="/law/cfr/$title/$section"
                            params={{ title, section: it.identifier }}
                            search={it.id.includes("@part-") ? { part } : {}}
                            className={
                              it.reserved
                                ? "text-muted-foreground hover:underline"
                                : "hover:underline"
                            }
                          >
                            <span className="mr-2 font-medium tabular-nums">
                              {it.kind === "section" ? `§ ${it.identifier}` : ""}
                            </span>
                            {listHeading(it, title)}
                          </Link>
                          {it.reserved && !/reserved/i.test(listHeading(it, title)) ? (
                            <span className="ml-2 text-[11px] text-muted-foreground">Reserved</span>
                          ) : null}
                          {it.kind === "appendix" ? (
                            <span className="ml-2 text-[11px] text-muted-foreground">Appendix</span>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))
              ) : (
                <p className="m-0 px-4 py-3 text-[13px] text-muted-foreground">
                  No section matches “{filter}”.
                </p>
              )}
              <p className="m-0 border-t border-border/70 px-4 py-2 text-[11px] text-muted-foreground">
                {shownCount.toLocaleString("en-US")} of {items.length.toLocaleString("en-US")} shown
                {q.data?.dropped ? ` · ${q.data.dropped} stored rows could not be read` : ""}
                {q.data?.truncated ? " · the list was cut at 6,000 rows" : ""}
              </p>
            </section>
          ) : (
            <p className="text-[13px] text-muted-foreground">
              No sections are recorded under this part.
            </p>
          )}
        </div>
      )}
    </AppShell>
  );
}
