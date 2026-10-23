import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useMemo, type ReactNode } from "react";
import { TIER_PLURAL } from "@/lib/external/caselaw";
import { cn } from "@/lib/utils";
import { courtsQuery, coverageQuery } from "./caseQueries";
import { fmtInt, NOT_RECORDED, stateLabel } from "./caseFormat";
import { Problem, Skeleton } from "./CaseSearchPage";
import { tierTotals, type DirectoryState } from "./courtCaseLaw";

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "rounded-md border border-border px-2 py-0.5 text-[12px]",
        active ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-muted",
      )}
    >
      {children}
    </button>
  );
}

export function CourtDirectory({
  s,
  nav,
}: {
  s: DirectoryState;
  nav: (n: DirectoryState) => void;
}) {
  const q = useQuery(courtsQuery);
  const cov = useQuery(coverageQuery);
  const all = useMemo(() => q.data ?? [], [q.data]);
  const totals = useMemo(() => tierTotals(all), [all]);
  const inTier = all.filter((c) => !s.tier || c.tier === s.tier);
  const states = [
    ...new Set(inTier.map((c) => c.jurisdiction).filter((j): j is string => !!j)),
  ].sort((a, b) => stateLabel(a).localeCompare(stateLabel(b)));
  const shown = inTier
    .filter((c) => !s.jur || c.jurisdiction === s.jur)
    .sort((a, b) => a.tier - b.tier || b.cases - a.cases || a.name.localeCompare(b.name));
  if (q.isLoading) return <Skeleton />;
  if (q.isError)
    return (
      <Problem onRetry={() => void q.refetch()}>The list of courts could not be loaded.</Problem>
    );
  if (!all.length) return <Problem>No court with case law is recorded yet.</Problem>;
  const indexed = new Map((cov.data?.tiers ?? []).map((t) => [t.tier, t] as const));
  const partial = all.some((c) => c.casesWithText == null);
  return (
    <div className="space-y-4">
      <section className="overflow-x-auto rounded-md border border-border">
        <table className="w-full min-w-[40rem] text-xs">
          <caption className="sr-only">Case law held, by court level</caption>
          <thead className="bg-muted/40 text-left text-[11px] text-muted-foreground">
            <tr>
              <th className="px-3 py-1.5 font-medium">Court level</th>
              <th className="px-2 py-1.5 text-right font-medium">Courts</th>
              <th className="px-2 py-1.5 text-right font-medium">Cases</th>
              <th className="px-2 py-1.5 text-right font-medium">With opinion text</th>
              <th className="px-3 py-1.5 font-medium">Text search here</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/60">
            {totals.map((t) => {
              const ix = indexed.get(t.tier);
              return (
                <tr key={t.tier}>
                  <td className="px-3 py-1.5">
                    <button
                      type="button"
                      onClick={() => nav({ tier: t.tier })}
                      className="font-medium text-primary hover:underline"
                    >
                      {TIER_PLURAL[t.tier]}
                    </button>
                  </td>
                  <td className="px-2 py-1.5 text-right font-mono tabular-nums">
                    {fmtInt(t.courts)}
                  </td>
                  <td className="px-2 py-1.5 text-right font-mono tabular-nums">
                    {fmtInt(t.cases)}
                  </td>
                  <td className="whitespace-nowrap px-2 py-1.5 text-right font-mono tabular-nums">
                    {fmtInt(t.withText)}
                  </td>
                  <td className="px-3 py-1.5 text-muted-foreground">
                    {cov.isLoading
                      ? "…"
                      : ix
                        ? ix.scope === "full"
                          ? "Every word"
                          : `First ${fmtInt(ix.prefixWords)} words of each opinion`
                        : "Not indexed (CourtListener full text)"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {partial ? (
          <p className="border-t border-border/60 px-3 py-1.5 text-[11px] text-muted-foreground">
            Opinion-text counts are not recorded for some courts yet; their totals show “
            {NOT_RECORDED}”.
          </p>
        ) : null}
      </section>
      <div className="flex flex-wrap items-center gap-1.5">
        <Chip active={!s.tier} onClick={() => nav({ jur: s.jur })}>
          Every level
        </Chip>
        {totals.map((t) => (
          <Chip
            key={t.tier}
            active={s.tier === t.tier}
            onClick={() => nav({ tier: t.tier, jur: undefined })}
          >
            {TIER_PLURAL[t.tier]}
          </Chip>
        ))}
        <label className="ml-auto flex items-center gap-1 text-[11px] text-muted-foreground">
          State
          <select
            value={s.jur ?? ""}
            onChange={(e) => nav({ ...s, jur: e.target.value || undefined })}
            className="h-7 rounded-md border border-border bg-background px-2 text-[12px] text-foreground"
          >
            <option value="">Any state</option>
            {states.map((j) => (
              <option key={j} value={j}>
                {stateLabel(j)}
              </option>
            ))}
          </select>
        </label>
      </div>
      {shown.length ? (
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full min-w-[44rem] text-xs">
            <caption className="sr-only">Courts</caption>
            <thead className="bg-muted/40 text-left text-[11px] text-muted-foreground">
              <tr>
                <th className="px-3 py-1.5 font-medium">Court</th>
                <th className="px-2 py-1.5 font-medium">Level</th>
                <th className="px-2 py-1.5 font-medium">State</th>
                <th className="px-2 py-1.5 text-right font-medium">Cases</th>
                <th className="px-3 py-1.5 text-right font-medium">With text</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {shown.slice(0, 600).map((c) => (
                <tr key={c.courtId}>
                  <td className="px-3 py-1.5">
                    <Link
                      to="/cases/courts/$courtId"
                      params={{ courtId: c.courtId }}
                      className="font-medium text-primary hover:underline"
                    >
                      {c.name}
                    </Link>
                  </td>
                  <td className="px-2 py-1.5 text-muted-foreground">{TIER_PLURAL[c.tier]}</td>
                  <td className="whitespace-nowrap px-2 py-1.5 text-muted-foreground">
                    {c.jurisdiction ? stateLabel(c.jurisdiction) : NOT_RECORDED}
                  </td>
                  <td className="px-2 py-1.5 text-right font-mono tabular-nums">
                    {fmtInt(c.cases)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-1.5 text-right font-mono tabular-nums">
                    {fmtInt(c.casesWithText)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {shown.length > 600 ? (
            <p className="border-t border-border/60 px-3 py-1.5 text-[11px] text-muted-foreground">
              The 600 courts with the most cases are listed; choose a state to see the others.
            </p>
          ) : null}
        </div>
      ) : (
        <Problem>No court matches these filters.</Problem>
      )}
      <p className="text-[11px] text-muted-foreground">
        Courts and their levels as CourtListener records them (bulk data, snapshot 2026-09-30); a
        court's state is shown when every courthouse CourtListener lists for it is in that state.
        Counts are cases held here (opinion clusters with at least one opinion; cases CourtListener
        blocks from search engines are never loaded).
      </p>
    </div>
  );
}
