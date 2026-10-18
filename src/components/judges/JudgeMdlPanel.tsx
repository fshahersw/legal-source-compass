import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { getJudgeCrossProfile, type JudgeCrossProfile } from "@/lib/external/judgeCross.functions";
import { COVERAGE_LABEL, fmtInt } from "./judgeCrossView";

/** Compact MDL-experience panel for a judge page; renders nothing when no exact cross-analysis link exists. */
export function JudgeMdlPanel({ judgeId }: { judgeId: string }) {
  const q = useQuery({
    queryKey: ["judge-cross-profile", judgeId],
    queryFn: () => getJudgeCrossProfile({ data: { id: judgeId } }),
    staleTime: 10 * 60 * 1000,
  });
  if (q.isLoading)
    return (
      <div
        className="mb-5 h-28 animate-pulse rounded-lg border border-border bg-muted/40"
        aria-busy="true"
        aria-label="Loading MDL experience"
      />
    );
  if (q.isError)
    return (
      <p role="alert" className="mb-5 text-xs text-muted-foreground">
        MDL experience could not be loaded.
      </p>
    );
  return q.data ? <Panel p={q.data} /> : null;
}

function Panel({ p }: { p: JudgeCrossProfile }) {
  const [showHistory, setShowHistory] = useState(false);
  const cov = p.coverage;
  const history = showHistory ? p.historical : p.historical.slice(0, 5);
  return (
    <section
      className="mb-5 rounded-lg border border-border bg-surface"
      aria-label="MDL experience"
    >
      <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border/70 px-4 py-2.5">
        <h2 className="font-sans text-sm font-semibold">MDL experience</h2>
        <Link
          to="/judges/analytics"
          className="text-xs text-muted-foreground underline underline-offset-2"
        >
          Compare all MDL judges
        </Link>
      </header>
      <dl className="grid grid-cols-2 gap-px bg-border/60 text-sm sm:grid-cols-4">
        {[
          ["Pending MDLs", String(p.pending.length), p.asOf ? `JPML ${p.asOf}` : undefined],
          [
            "Actions pending",
            fmtInt(p.pendingActions),
            p.sharePct !== null
              ? `${p.sharePct}% of all pending; rank ${p.rank ?? "—"}`
              : undefined,
          ],
          [
            "Terminated MDLs",
            String(p.historical.length),
            `${fmtInt(p.historicalActions)} actions`,
          ],
          ["Actions handled", fmtInt(p.totalActions), "pending MDL totals + terminated"],
        ].map(([label, value, note]) => (
          <div key={label} className="bg-surface px-4 py-2">
            <dt className="text-xs text-muted-foreground">{label}</dt>
            <dd className="font-mono font-semibold tabular-nums">{value}</dd>
            {note ? <dd className="text-[11px] text-muted-foreground">{note}</dd> : null}
          </div>
        ))}
      </dl>
      {p.pending.length ? (
        <ul className="divide-y divide-border/60 border-t border-border/70 text-xs">
          {p.pending.map((m) => (
            <li key={m.mdl} className="flex items-baseline gap-2 px-4 py-1.5">
              <Link
                to="/matters/lens/$mdl"
                params={{ mdl: String(m.mdl) }}
                className="shrink-0 font-mono text-primary hover:underline"
              >
                MDL {m.mdl}
              </Link>
              <span className="min-w-0 flex-1 truncate" title={m.title}>
                {m.title.replace(/^IN RE:\s*/i, "")}
              </span>
              <span className="shrink-0 font-mono tabular-nums">{fmtInt(m.pending)} pending</span>
            </li>
          ))}
        </ul>
      ) : null}
      {p.historical.length ? (
        <div className="border-t border-border/70 px-4 py-2 text-xs">
          <div className="mb-1 text-[11px] text-muted-foreground">
            Terminated MDLs (JPML, through FY2025)
          </div>
          <ul className="space-y-0.5">
            {history.map((h) => (
              <li key={`${h.mdl}:${h.year}`} className="flex items-baseline gap-2">
                <span className="w-10 shrink-0 font-mono text-[11px] text-muted-foreground">
                  {h.year}
                </span>
                <span className="min-w-0 flex-1 truncate" title={h.caption}>
                  MDL {h.mdl} · {h.caption}
                </span>
                <span className="shrink-0 font-mono tabular-nums text-muted-foreground">
                  {fmtInt(h.actions)}
                </span>
              </li>
            ))}
          </ul>
          {p.historical.length > 5 ? (
            <button
              type="button"
              className="mt-1 text-[11px] text-primary hover:underline"
              onClick={() => setShowHistory((v) => !v)}
            >
              {showHistory ? "Show fewer" : `Show all ${p.historical.length}`}
            </button>
          ) : null}
        </div>
      ) : null}
      {cov ? (
        <p className="border-t border-border/70 px-4 py-2 text-[11px] text-muted-foreground">
          <span className="font-medium text-foreground">Financial disclosures: </span>
          {COVERAGE_LABEL[cov.status] ?? cov.status}
          {cov.yearsChecked.length
            ? ` · report years ${cov.yearsChecked.join(", ")} · ${fmtInt(cov.linesChecked)} investment lines`
            : ""}{" "}
          ·{" "}
          {p.matches.length ? (
            <Link
              to="/judges/analytics"
              hash="disclosures"
              className="text-warning-foreground underline underline-offset-2"
            >
              {p.matches.length} name match{p.matches.length === 1 ? "" : "es"} — requires review,
              not a finding
            </Link>
          ) : (
            "no exact name match with a party in this judge’s products-liability MDLs"
          )}
        </p>
      ) : null}
    </section>
  );
}
