import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, ExternalLink } from "lucide-react";
import { useState } from "react";
import {
  getCourtStructure,
  type CourtRef,
  type CourtStructure,
} from "@/lib/external/courtStructure.functions";

const CHILDREN_SHOWN = 24;

function CourtLink({ r }: { r: CourtRef }) {
  const inactive = r.active === false ? " (inactive)" : "";
  return r.page ? (
    <Link
      to="/courts/$id"
      params={{ id: r.id }}
      className="text-primary underline-offset-2 hover:underline"
    >
      {r.name}
      {inactive}
    </Link>
  ) : (
    <span title="No court page for this court">
      {r.name}
      {inactive}
    </span>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] text-muted-foreground">{label}</dt>
      <dd className="m-0 text-[13px] leading-snug break-words">{children}</dd>
    </div>
  );
}

const status = (s: CourtStructure) =>
  s.active === true ? "Active" : s.active === false ? "Inactive" : "Not recorded";

function periodsText(s: CourtStructure) {
  const starts = s.periods.map((p) => p.start).filter(Boolean);
  const ends = s.periods.map((p) => p.end).filter(Boolean);
  return {
    began: starts[0] ?? "Not recorded",
    ended: ends.length ? ends[ends.length - 1]! : null,
    reorganized: s.periods.flatMap((p) => p.reorganizations),
  };
}

/** Courts-DB metadata and court structure for a court page. Renders nothing for a court Courts-DB does not list. */
export function CourtStructurePanel({ courtId }: { courtId: string }) {
  const [allChildren, setAllChildren] = useState(false);
  const q = useQuery({
    queryKey: ["court-structure", courtId],
    queryFn: () => getCourtStructure({ data: { id: courtId } }),
    staleTime: 30 * 60 * 1000,
  });
  if (q.isLoading)
    return (
      <div
        className="mb-5 h-24 animate-pulse rounded-lg border border-border bg-muted/40"
        aria-busy="true"
        aria-label="Loading court structure"
      />
    );
  if (q.isError)
    return (
      <p
        role="alert"
        className="mb-5 flex flex-wrap items-center gap-2 rounded-lg border border-border px-4 py-3 text-xs text-muted-foreground"
      >
        Court structure could not be loaded.
        <button
          type="button"
          onClick={() => void q.refetch()}
          className="rounded text-primary underline focus-visible:outline-2 focus-visible:outline-ring"
        >
          Retry
        </button>
      </p>
    );
  const s = q.data;
  if (!s) return null;
  const { began, ended, reorganized } = periodsText(s);
  const route = s.appealTo ?? s.circuit;
  const children = allChildren ? s.children : s.children.slice(0, CHILDREN_SHOWN);
  return (
    <section
      aria-label="Court structure"
      className="mb-5 rounded-xl border border-border bg-card shadow-xs"
    >
      <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border/70 px-4 py-3">
        <h2 className="m-0 text-heading font-semibold text-foreground">Court structure</h2>
        <p className="m-0 text-xs text-muted-foreground">
          {s.system} · {s.level}
          {s.location ? ` · ${s.location}` : ""}
        </p>
      </header>
      <div className="space-y-3 px-4 py-3">
        <dl className="m-0 grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-3 lg:grid-cols-6">
          <Fact label="Level">{s.level}</Fact>
          <Fact label="Type">{s.type}</Fact>
          <Fact label="Status">{status(s)}</Fact>
          <Fact label="Began">{began}</Fact>
          <Fact label={ended ? "Ended" : "Reorganised"}>
            {ended ?? (reorganized.length ? reorganized.join(", ") : "Not recorded")}
          </Fact>
          <Fact label="Citation form">{s.citationString ?? s.abbreviation ?? "Not recorded"}</Fact>
        </dl>

        {s.parentChain.length || route ? (
          <div className="flex flex-col gap-1.5 text-[13px]">
            {s.parentChain.length ? (
              <p className="m-0 flex flex-wrap items-center gap-x-1.5 gap-y-1">
                <span className="text-xs text-muted-foreground">Part of</span>
                {s.parentChain.map((r, i) => (
                  <span key={r.id} className="inline-flex items-center gap-1.5">
                    {i ? <ArrowRight className="size-3 text-muted-foreground" aria-hidden /> : null}
                    <CourtLink r={r} />
                  </span>
                ))}
                {s.siblings ? (
                  <span className="text-xs text-muted-foreground">
                    · with {s.siblings.toLocaleString("en-US")} other court
                    {s.siblings === 1 ? "" : "s"} in this group
                  </span>
                ) : null}
              </p>
            ) : null}
            {route ? (
              <p className="m-0 flex flex-wrap items-center gap-x-1.5">
                <span className="text-xs text-muted-foreground">Appeals go to</span>
                <CourtLink r={route} />
              </p>
            ) : null}
          </div>
        ) : null}

        {s.children.length ? (
          <div>
            <p className="m-0 mb-1.5 text-xs text-muted-foreground">
              Courts grouped under this court ({s.children.length.toLocaleString("en-US")})
            </p>
            <ul className="m-0 flex list-none flex-wrap gap-1.5 p-0">
              {children.map((r) => (
                <li
                  key={r.id}
                  className="rounded-md border border-border/70 px-2 py-1 text-xs leading-snug"
                >
                  <CourtLink r={r} />
                </li>
              ))}
            </ul>
            {s.children.length > CHILDREN_SHOWN ? (
              <button
                type="button"
                onClick={() => setAllChildren((v) => !v)}
                className="mt-1.5 rounded text-xs text-primary underline focus-visible:outline-2 focus-visible:outline-ring"
              >
                {allChildren
                  ? "Show fewer"
                  : `Show all ${s.children.length.toLocaleString("en-US")}`}
              </button>
            ) : null}
          </div>
        ) : null}

        {s.appealedFrom.length ? (
          <div>
            <p className="m-0 mb-1.5 text-xs text-muted-foreground">
              Courts recorded as appealing here ({s.appealedFrom.length})
            </p>
            <ul className="m-0 flex list-none flex-wrap gap-1.5 p-0">
              {s.appealedFrom.map((r) => (
                <li
                  key={r.id}
                  className="rounded-md border border-border/70 px-2 py-1 text-xs leading-snug"
                >
                  <CourtLink r={r} />
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {s.divisions.length || s.otherNames.length ? (
          <dl className="m-0 grid gap-x-6 gap-y-2 sm:grid-cols-2">
            {s.divisions.length ? (
              <Fact label={`Divisions${s.divisionType ? ` (by ${s.divisionType})` : ""}`}>
                {s.divisions.join(" · ")}
              </Fact>
            ) : null}
            {s.otherNames.length ? (
              <Fact label="Other names">{s.otherNames.join(" · ")}</Fact>
            ) : null}
          </dl>
        ) : null}
        {s.notes ? <p className="m-0 text-xs text-muted-foreground">Note: {s.notes}</p> : null}
      </div>
      <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-border/70 px-4 py-2 text-[11px] leading-relaxed text-muted-foreground">
        <span>
          From{" "}
          <a
            href="https://free.law/projects/courts-db/"
            target="_blank"
            rel="noreferrer"
            className="underline hover:text-foreground"
          >
            {s.credit}
          </a>
          . Dates and the appeal route are shown only where it records them.
        </span>
        {s.website ? (
          <a
            href={s.website}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-primary underline-offset-2 hover:underline"
          >
            Court website <ExternalLink className="size-3" aria-hidden />
          </a>
        ) : null}
      </footer>
    </section>
  );
}
