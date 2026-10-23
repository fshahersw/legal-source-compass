import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ExternalLink } from "lucide-react";
import { useMemo, useState } from "react";
import {
  courtListenerCaseUrl,
  type Authority,
  type Citator,
  type CitingCase,
} from "@/lib/external/caselaw";
import { cn } from "@/lib/utils";
import { authoritiesQuery, citatorQuery } from "./caseQueries";
import {
  courtBars,
  decadeBars,
  fmtDay,
  fmtInt,
  NOT_RECORDED,
  sortCiting,
  yearOf,
  type CitingSort,
} from "./caseFormat";

function CaseLink({ id, name, held }: { id: number | null; name: string | null; held: boolean }) {
  const label = name ?? NOT_RECORDED;
  if (id && held)
    return (
      <Link to="/cases/$id" params={{ id: String(id) }} className="text-primary hover:underline">
        {label}
      </Link>
    );
  if (id)
    return (
      <a
        href={courtListenerCaseUrl(id, name)}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-0.5 hover:text-primary hover:underline"
        title="Not held here: opens CourtListener"
      >
        {label}
        <ExternalLink className="size-3 shrink-0 text-muted-foreground" aria-hidden />
      </a>
    );
  return <span>{label}</span>;
}

function Loading({ label }: { label: string }) {
  return (
    <div
      className="h-40 animate-pulse rounded-md border border-border bg-muted/50"
      aria-busy="true"
      aria-label={label}
    />
  );
}

function Failed({ onRetry, what }: { onRetry: () => void; what: string }) {
  return (
    <p
      role="alert"
      className="flex flex-wrap items-center gap-2 rounded-md border border-border px-3 py-2 text-[13px] text-muted-foreground"
    >
      The {what} could not be loaded.
      <button
        type="button"
        onClick={onRetry}
        className="rounded text-primary underline focus-visible:outline-2 focus-visible:outline-ring"
      >
        Retry
      </button>
    </p>
  );
}

function useCitator(id: number) {
  return useQuery(citatorQuery(id));
}

function Bars({
  rows,
  caption,
}: {
  rows: { key: string; label: string; n: number; pct: number }[];
  caption: string;
}) {
  return (
    <table className="w-full text-xs">
      <caption className="sr-only">{caption}</caption>
      <tbody className="divide-y divide-border/60">
        {rows.map((r) => (
          <tr key={r.key}>
            <td className="max-w-[16rem] truncate py-1 pr-2" title={r.label}>
              {r.label}
            </td>
            <td className="w-1/2 py-1">
              <span className="block h-1.5 rounded-sm bg-muted" aria-hidden>
                <span
                  className="block h-1.5 rounded-sm bg-primary/60"
                  style={{ width: `${Math.max(1, Math.min(100, r.pct))}%` }}
                />
              </span>
            </td>
            <td className="py-1 pl-2 text-right font-mono tabular-nums">{fmtInt(r.n)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function CitatorPanel({
  id,
  caseName,
  clCount,
}: {
  id: number;
  caseName: string;
  clCount: number | null;
}) {
  const q = useCitator(id);
  if (q.isLoading) return <Loading label="Loading the citator" />;
  if (q.isError) return <Failed onRetry={() => void q.refetch()} what="citator" />;
  const c = q.data?.citator ?? null;
  if (!c || (c.citedByOpinions === 0 && c.parentheticals.length === 0))
    return (
      <p className="rounded-md border border-border px-3 py-2 text-[13px] text-muted-foreground">
        No later opinion in CourtListener's citation map cites {caseName}
        {clCount
          ? ` (CourtListener's own count is ${fmtInt(clCount)}; its map links only the citations it could resolve)`
          : ""}
        .
      </p>
    );
  return <CitatorBody c={c} clCount={clCount} />;
}

function CitatorBody({ c, clCount }: { c: Citator; clCount: number | null }) {
  const [sort, setSort] = useState<CitingSort>("rank");
  const [court, setCourt] = useState<string>("");
  const citing = useMemo(
    () =>
      sortCiting(
        c.citing.filter((r) => !court || r.courtId === court),
        sort,
      ),
    [c.citing, court, sort],
  );
  const courts = useMemo(
    () => [...new Set(c.citing.map((r) => r.courtId).filter((x): x is string => !!x))],
    [c.citing],
  );
  return (
    <div className="space-y-4">
      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[
          ["Citing opinions", fmtInt(c.citedByOpinions)],
          ["Citing cases", fmtInt(c.citedByCases)],
          ["CourtListener count", fmtInt(clCount)],
          ["Parentheticals", fmtInt(c.parentheticalsTotal)],
        ].map(([k, v]) => (
          <div key={k} className="rounded-md border border-border px-3 py-2">
            <dt className="text-[11px] text-muted-foreground">{k}</dt>
            <dd className="font-mono text-[15px] tabular-nums">{v}</dd>
          </div>
        ))}
      </dl>
      <p className="text-[11px] text-muted-foreground">
        From CourtListener's citation map (snapshot 2026-09-30): opinions whose text cites this case
        and that CourtListener could match to it. Blocked cases and the case's own opinions are not
        counted. A citation is not a treatment: it can follow, distinguish or criticise.
      </p>
      {c.citedByOpinions > 0 ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <section className="min-w-0 rounded-md border border-border">
            <h3 className="border-b border-border/60 px-3 py-1.5 text-xs font-semibold">
              Citing opinions by court
            </h3>
            <div className="px-3 py-2">
              <Bars rows={courtBars(c)} caption="Citing opinions by court" />
            </div>
          </section>
          <section className="min-w-0 rounded-md border border-border">
            <h3 className="border-b border-border/60 px-3 py-1.5 text-xs font-semibold">
              Citing opinions by decade
            </h3>
            <div className="px-3 py-2">
              <Bars rows={decadeBars(c)} caption="Citing opinions by decade" />
            </div>
          </section>
        </div>
      ) : null}
      {c.citing.length ? (
        <section className="min-w-0 rounded-md border border-border">
          <div className="flex flex-wrap items-center gap-2 border-b border-border/60 px-3 py-1.5">
            <h3 className="text-xs font-semibold">
              Citing cases
              {c.citedByCases > c.citing.length
                ? ` · first ${fmtInt(c.citing.length)} of ${fmtInt(c.citedByCases)}`
                : ""}
            </h3>
            <label className="ml-auto flex items-center gap-1 text-[11px] text-muted-foreground">
              Court
              <select
                value={court}
                onChange={(e) => setCourt(e.target.value)}
                className="h-7 rounded-md border border-border bg-background px-1 text-[11px] text-foreground"
              >
                <option value="">All</option>
                {courts.map((k) => (
                  <option key={k} value={k}>
                    {c.courts[k] ?? k}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-1 text-[11px] text-muted-foreground">
              Order
              <select
                value={sort}
                onChange={(e) => setSort(e.target.value as CitingSort)}
                className="h-7 rounded-md border border-border bg-background px-1 text-[11px] text-foreground"
              >
                <option value="rank">Most cited first</option>
                <option value="newest">Newest</option>
                <option value="oldest">Oldest</option>
                <option value="depth">Cites it most often</option>
              </select>
            </label>
          </div>
          <div className="max-h-[32rem] overflow-auto">
            <table className="w-full min-w-[40rem] text-xs">
              <caption className="sr-only">Citing cases</caption>
              <thead className="sticky top-0 bg-surface text-left text-[11px] text-muted-foreground">
                <tr>
                  <th className="px-3 py-1 font-medium">Case</th>
                  <th className="px-2 py-1 font-medium">Court</th>
                  <th className="px-2 py-1 font-medium">Filed</th>
                  <th
                    className="px-2 py-1 text-right font-medium"
                    title="Times its opinions cite this case"
                  >
                    Cites
                  </th>
                  <th
                    className="px-3 py-1 text-right font-medium"
                    title="CourtListener citation count of the citing case"
                  >
                    Cited by
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {citing.map((r: CitingCase) => (
                  <tr key={r.clusterId}>
                    <td className="px-3 py-1">
                      <CaseLink id={r.clusterId} name={r.name} held={r.held} />
                      {r.citation ? (
                        <span className="ml-1 text-muted-foreground">{r.citation}</span>
                      ) : null}
                    </td>
                    <td className="px-2 py-1 text-muted-foreground">
                      {r.courtId ? (c.courts[r.courtId] ?? r.courtId) : NOT_RECORDED}
                    </td>
                    <td className="whitespace-nowrap px-2 py-1 tabular-nums">
                      {yearOf(r.date) ?? NOT_RECORDED}
                    </td>
                    <td className="px-2 py-1 text-right font-mono tabular-nums">
                      {fmtInt(r.depth)}
                    </td>
                    <td className="px-3 py-1 text-right font-mono tabular-nums">
                      {fmtInt(r.citationCount)}
                    </td>
                  </tr>
                ))}
                {!citing.length ? (
                  <tr>
                    <td colSpan={5} className="px-3 py-2 text-muted-foreground">
                      No citing case from this court in the list.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
          <p className="border-t border-border/60 px-3 py-1.5 text-[11px] text-muted-foreground">
            Listed: up to 200 citing cases, the most-cited first (CourtListener's count of the
            citing case), then by how often they cite this case, then newest.
          </p>
        </section>
      ) : null}
      <section className="min-w-0 rounded-md border border-border">
        <h3 className="border-b border-border/60 px-3 py-1.5 text-xs font-semibold">
          How later opinions describe it
          {c.parentheticalsTotal > c.parentheticals.length
            ? ` · ${fmtInt(c.parentheticals.length)} of ${fmtInt(c.parentheticalsTotal)}`
            : ""}
        </h3>
        {c.parentheticals.length ? (
          <ul className="divide-y divide-border/60">
            {c.parentheticals.map((p, i) => (
              <li key={`${p.clusterId}-${i}`} className="px-3 py-2 text-[13px]">
                <p>“{p.text}”</p>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  <CaseLink id={p.clusterId} name={p.name} held={p.held} />
                  {p.citation ? `, ${p.citation}` : ""}
                  {p.courtId ? ` · ${c.courts[p.courtId] ?? p.courtId}` : ""}
                  {p.date ? ` · ${fmtDay(p.date)}` : ""}
                </p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="px-3 py-2 text-xs text-muted-foreground">
            No parenthetical descriptions of this case are recorded.
          </p>
        )}
        <p className="border-t border-border/60 px-3 py-1.5 text-[11px] text-muted-foreground">
          Parentheticals as written by the citing courts (CourtListener's extraction), one per group
          of similar wording, highest-scored first.
        </p>
      </section>
    </div>
  );
}

export function AuthoritiesPanel({ id }: { id: number }) {
  const q = useQuery(authoritiesQuery(id));
  const [filter, setFilter] = useState<"all" | "held">("all");
  if (q.isLoading) return <Loading label="Loading cited authorities" />;
  if (q.isError) return <Failed onRetry={() => void q.refetch()} what="cited authorities" />;
  const list: Authority[] = q.data?.authorities?.authorities ?? [];
  const courts = q.data?.authorities?.courts ?? {};
  if (!list.length)
    return (
      <p className="rounded-md border border-border px-3 py-2 text-[13px] text-muted-foreground">
        No case citations are linked in this case's stored text (only citations CourtListener
        resolved to a case are listed).
      </p>
    );
  const rows = filter === "held" ? list.filter((a) => a.held) : list;
  return (
    <section className="min-w-0 rounded-md border border-border">
      <div className="flex flex-wrap items-center gap-2 border-b border-border/60 px-3 py-1.5">
        <h3 className="text-xs font-semibold">{fmtInt(list.length)} cited cases</h3>
        <div className="ml-auto flex gap-1 text-[11px]">
          {(["all", "held"] as const).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setFilter(k)}
              className={cn(
                "rounded-md border border-border px-2 py-0.5",
                filter === k ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-muted",
              )}
              aria-pressed={filter === k}
            >
              {k === "all" ? "All" : "With a page here"}
            </button>
          ))}
        </div>
      </div>
      <div className="max-h-[32rem] overflow-auto">
        <table className="w-full min-w-[40rem] text-xs">
          <caption className="sr-only">Cases cited in this case's opinions</caption>
          <thead className="sticky top-0 bg-surface text-left text-[11px] text-muted-foreground">
            <tr>
              <th className="px-3 py-1 font-medium">Case</th>
              <th className="px-2 py-1 font-medium">Court</th>
              <th className="px-2 py-1 font-medium">Filed</th>
              <th
                className="px-3 py-1 text-right font-medium"
                title="Citation links to it in this case's opinions"
              >
                Links
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/60">
            {rows.map((a, i) => (
              <tr key={`${a.clusterId ?? "x"}-${i}`}>
                <td className="px-3 py-1">
                  <CaseLink id={a.clusterId} name={a.name ?? a.firstText} held={a.held} />
                  {a.citation ? (
                    <span className="ml-1 text-muted-foreground">{a.citation}</span>
                  ) : null}
                </td>
                <td className="px-2 py-1 text-muted-foreground">
                  {a.courtId ? (courts[a.courtId] ?? a.courtId) : NOT_RECORDED}
                </td>
                <td className="whitespace-nowrap px-2 py-1 tabular-nums">
                  {yearOf(a.date) ?? NOT_RECORDED}
                </td>
                <td className="px-3 py-1 text-right font-mono tabular-nums">{fmtInt(a.anchors)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="border-t border-border/60 px-3 py-1.5 text-[11px] text-muted-foreground">
        From the citation links CourtListener placed in this case's opinion text, in date order.
        Links counts the links to each case (when a combined text repeats the separate opinions, it
        is counted once). Citations CourtListener could not resolve to a case, statutes and other
        sources are not listed.
      </p>
    </section>
  );
}
