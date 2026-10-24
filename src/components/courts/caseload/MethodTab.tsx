import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { int, shareOf, signedPct } from "@/components/analysis/analysisFormat";
import { CoverageBar, type CoverageSegment } from "@/components/analysis/CoverageBar";
import { HowToRead } from "@/components/analysis/HowToRead";
import { Kpi, LoadingBlock, Panel, SourceLink, StateNote } from "@/components/enforcement/parts";
import type { CaseloadMethod, Comparison } from "@/lib/external/courtCaseload.functions";
import { RetryNote } from "./CaseloadParts";
import { fyLabel, longDate, NOT_RECORDED, pct } from "./caseloadFormat";
import { methodQuery } from "./caseloadQueries";

export function MethodTab() {
  const q = useQuery(methodQuery);
  if (q.isLoading) return <LoadingBlock label="Loading the method and checks" />;
  if (q.isError)
    return (
      <RetryNote onRetry={() => void q.refetch()}>
        The method and validation notes could not be loaded.
      </RetryNote>
    );
  if (!q.data) return <StateNote>The method notes have not been published yet.</StateNote>;
  return <Body m={q.data} />;
}

/** Segments of a comparison bar: exact, within 1% but not exact, and further apart. */
function comparisonSegments(c: Comparison): CoverageSegment[] {
  const within = c.withinOnePct;
  if (within == null)
    return [
      { key: "exact", label: "Exact", value: c.exact, tone: "strong" },
      { key: "other", label: "Not exact", value: c.compared - c.exact, tone: "none" },
    ];
  return [
    { key: "exact", label: "Exact", value: c.exact, tone: "strong" },
    {
      key: "near",
      label: "Within 1% or 1 case, not exact",
      value: within - c.exact,
      tone: "partial",
    },
    { key: "far", label: "More than 1% apart", value: c.compared - within, tone: "weak" },
  ];
}

function Body({ m }: { m: CaseloadMethod }) {
  const v = m.vsAo;
  const r = m.recheck;
  const qd = m.quality;
  const cut = longDate(m.through);
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Kpi
          label="Terminations equal the AO's"
          value={
            v?.terminations
              ? `${int(v.terminations.exact)} of ${int(v.terminations.compared)}`
              : NOT_RECORDED
          }
          note={v?.scope ? `District-years compared, ${v.scope}` : "District-years compared"}
        />
        <Kpi
          label="Filings equal the AO's"
          value={
            v?.filings ? `${int(v.filings.exact)} of ${int(v.filings.compared)}` : NOT_RECORDED
          }
          note={
            v?.filings?.withinOnePct != null
              ? `${int(v.filings.withinOnePct)} within 1% or 1 case`
              : "District-years compared"
          }
        />
        <Kpi
          label="Independent recheck"
          value={r ? `${int(r.mismatches)} mismatches` : NOT_RECORDED}
          note={
            r
              ? `${int(r.figures)} figures recomputed by a separate pass over the source file`
              : undefined
          }
          tone={r && r.mismatches > 0 ? "destructive" : undefined}
        />
        <Kpi
          label="Source rows loaded"
          value={qd?.rowsLoaded == null ? NOT_RECORDED : int(qd.rowsLoaded)}
          note={
            qd?.rowsRejected != null
              ? `${int(qd.rowsRejected)} malformed lines rejected by the reader`
              : undefined
          }
        />
      </div>

      <Panel
        id="caseload-vs-ao"
        title="Checked against the AO's published totals"
        subtitle={
          v?.scope
            ? `${v.scope}; each district-year compared with the U.S. Courts Judicial Business tables`
            : "Each district-year compared with the U.S. Courts Judicial Business tables"
        }
        footnote={
          v?.source ? (
            <>
              Compared against: {v.source}. The AO&apos;s published tables remain the reference for
              official counts.
            </>
          ) : (
            "The AO's published tables remain the reference for official counts."
          )
        }
      >
        {v ? (
          <div className="space-y-2 p-3">
            <div className="grid gap-2 lg:grid-cols-3">
              {v.terminations ? (
                <CoverageBar
                  title="Terminations"
                  total={v.terminations.compared}
                  segments={comparisonSegments(v.terminations)}
                  caption="Terminations by statistical year agree with the AO's tables."
                />
              ) : null}
              {v.filings ? (
                <CoverageBar
                  title="Filings"
                  total={v.filings.compared}
                  segments={comparisonSegments(v.filings)}
                  caption={`Exact in ${pct(shareOf(v.filings.exact, v.filings.compared), 0)} of district-years.`}
                />
              ) : null}
              {v.pending ? (
                <CoverageBar
                  title="Pending at year end"
                  total={v.pending.compared}
                  segments={comparisonSegments(v.pending)}
                  caption="Pending inherits the filing differences."
                />
              ) : null}
            </div>
            {v.reading ? <p className="text-xs leading-5">{v.reading}</p> : null}
            {v.worst.length ? (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <caption className="mb-1 text-left text-[11px] text-muted-foreground">
                    Largest filing differences (IDB minus AO)
                  </caption>
                  <thead className="text-left text-[11px] text-muted-foreground">
                    <tr>
                      <th scope="col" className="px-2 py-1.5 font-medium">
                        District
                      </th>
                      <th scope="col" className="px-2 py-1.5 font-medium">
                        Fiscal year
                      </th>
                      <th scope="col" className="px-2 py-1.5 text-right font-medium">
                        Federal caseload data
                      </th>
                      <th scope="col" className="px-2 py-1.5 text-right font-medium">
                        AO table
                      </th>
                      <th scope="col" className="px-2 py-1.5 text-right font-medium">
                        Difference
                      </th>
                      <th scope="col" className="px-2 py-1.5 text-right font-medium">
                        Relative
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/60">
                    {v.worst.map((w) => (
                      <tr key={`${w.courtId}-${w.fy}`}>
                        <td className="px-2 py-1">
                          <Link
                            to="/courts/caseload"
                            search={{ court: w.courtId }}
                            className="font-mono text-primary hover:underline"
                          >
                            {w.courtId}
                          </Link>
                        </td>
                        <td className="px-2 py-1 font-mono">{fyLabel(w.fy)}</td>
                        <td className="px-2 py-1 text-right font-mono">{int(w.idb)}</td>
                        <td className="px-2 py-1 text-right font-mono">{int(w.ao)}</td>
                        <td className="px-2 py-1 text-right font-mono">
                          {w.diff > 0 ? "+" : w.diff < 0 ? "−" : ""}
                          {int(Math.abs(w.diff))}
                        </td>
                        <td className="px-2 py-1 text-right font-mono">
                          {w.ao > 0 ? signedPct((100 * w.diff) / w.ao) : NOT_RECORDED}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </div>
        ) : (
          <StateNote>The comparison with the AO&apos;s totals is {NOT_RECORDED}.</StateNote>
        )}
      </Panel>

      <div className="grid gap-3 lg:grid-cols-2">
        <Panel
          title="Independent recheck"
          subtitle="A second computation of selected figures, written separately from the loader"
        >
          {r ? (
            <dl className="grid gap-x-4 gap-y-1.5 p-3 text-xs sm:grid-cols-[9rem_minmax(0,1fr)]">
              <dt className="font-medium">Figures recomputed</dt>
              <dd className="font-mono">{int(r.figures)}</dd>
              <dt className="font-medium">Mismatches</dt>
              <dd className="font-mono">{int(r.mismatches)}</dd>
              {r.rawRows != null ? (
                <>
                  <dt className="font-medium">Raw rows read</dt>
                  <dd className="font-mono">{int(r.rawRows)}</dd>
                </>
              ) : null}
              {r.method ? (
                <>
                  <dt className="font-medium">Method</dt>
                  <dd className="leading-4 text-muted-foreground">{r.method}</dd>
                </>
              ) : null}
              {r.note ? (
                <>
                  <dt className="font-medium">Note</dt>
                  <dd className="leading-4 text-muted-foreground">{r.note}</dd>
                </>
              ) : null}
            </dl>
          ) : (
            <StateNote>The independent recheck is {NOT_RECORDED}.</StateNote>
          )}
        </Panel>

        <Panel
          title="Data quality counts"
          subtitle="What the loader read and what it could not place"
          footnote="Counts are of source records, not cases in a year. A zero is a recorded zero."
        >
          {qd ? (
            <dl className="grid gap-x-4 gap-y-1 p-3 text-xs sm:grid-cols-[minmax(0,1fr)_auto]">
              <QualityRow label="Source records loaded" value={qd.rowsLoaded} />
              <QualityRow label="Malformed lines rejected by the reader" value={qd.rowsRejected} />
              <QualityRow label="Pending cases" value={qd.pending} />
              <QualityRow label="Terminated cases" value={qd.terminated} />
              <QualityRow
                label="Terminated with a valid duration"
                value={qd.terminatedWithDuration}
              />
              <QualityRow label="Terminated without a disposition" value={qd.missingDisposition} />
              <QualityRow label="Terminated before filed" value={qd.terminatedBeforeFiled} />
              <QualityRow label="Without a nature-of-suit code" value={qd.missingNos} />
              <QualityRow label="Rows with a code not in the codebook" value={qd.unmappedNosRows} />
              <dt className="text-muted-foreground">Filing years in the file</dt>
              <dd className="text-right font-mono">
                {qd.filedRange
                  ? `${fyLabel(qd.filedRange[0])} to ${fyLabel(qd.filedRange[1])}`
                  : NOT_RECORDED}
              </dd>
              <dt className="text-muted-foreground">Termination years in the file</dt>
              <dd className="text-right font-mono">
                {qd.terminatedRange
                  ? `${fyLabel(qd.terminatedRange[0])} to ${fyLabel(qd.terminatedRange[1])}`
                  : NOT_RECORDED}
              </dd>
            </dl>
          ) : (
            <StateNote>Data quality counts are {NOT_RECORDED}.</StateNote>
          )}
        </Panel>
      </div>

      <Panel
        title="Counting rules"
        subtitle="How a case is assigned to a year and how each figure is computed"
      >
        <div className="space-y-2 p-3 text-xs">
          {m.countingRules.length ? (
            <ol className="list-decimal space-y-1 pl-5 leading-5" aria-label="Counting rules">
              {m.countingRules.map((rule) => (
                <li key={rule}>{rule}</li>
              ))}
            </ol>
          ) : (
            <p className="text-muted-foreground">Counting rules are {NOT_RECORDED}.</p>
          )}
          {m.formulas.length ? (
            <dl className="grid gap-x-4 gap-y-1 border-t border-border/60 pt-2 sm:grid-cols-[9rem_minmax(0,1fr)]">
              {m.formulas.map((f) => (
                <FormulaRow key={f.key} name={f.key} text={f.text} />
              ))}
            </dl>
          ) : null}
          {m.groupingNote ? <p className="text-muted-foreground">{m.groupingNote}</p> : null}
          {m.ranksNote ? <p className="text-muted-foreground">{m.ranksNote}</p> : null}
        </div>
      </Panel>

      <Panel title="Source and snapshot" subtitle="Where the figures come from and what they cover">
        <dl className="grid gap-x-4 gap-y-1.5 p-3 text-xs sm:grid-cols-[9rem_minmax(0,1fr)]">
          <dt className="font-medium">Source</dt>
          <dd>{m.source ?? NOT_RECORDED}</dd>
          <dt className="font-medium">Snapshot</dt>
          <dd>
            {m.snapshot ?? NOT_RECORDED}
            {cut && m.partialFy != null ? (
              <span className="text-muted-foreground">
                {" "}
                · {fyLabel(m.partialFy)} is a partial year, through {cut}
              </span>
            ) : null}
          </dd>
          <dt className="font-medium">Latest complete year</dt>
          <dd>{m.latestCompleteFy == null ? NOT_RECORDED : fyLabel(m.latestCompleteFy)}</dd>
          <dt className="font-medium">Links</dt>
          <dd className="flex flex-wrap gap-x-4 gap-y-1">
            {m.sourcePage ? (
              <SourceLink href={m.sourcePage}>Civil data page</SourceLink>
            ) : null}
            {m.sourceFile ? (
              <SourceLink href={m.sourceFile}>Source file (cv88on)</SourceLink>
            ) : null}
            {m.codebook ? <SourceLink href={m.codebook}>Civil codebook</SourceLink> : null}
          </dd>
          <dt className="font-medium">Terms</dt>
          <dd className="text-muted-foreground">{m.terms ?? NOT_RECORDED}</dd>
          {m.mdl?.evidenceRule ? (
            <>
              <dt className="font-medium">MDL numbers</dt>
              <dd className="text-muted-foreground">
                {m.mdl.evidenceRule}
                {m.mdl.nonNumeric
                  ? ` ${int(m.mdl.nonNumeric.records)} case records carry a non-numeric MDL value (${int(m.mdl.nonNumeric.distinctValues)} distinct values); they are excluded, not mapped.`
                  : ""}
              </dd>
            </>
          ) : null}
        </dl>
      </Panel>

      <HowToRead
        title="How to read the checks"
        defaultOpen
        measures={[
          {
            term: "Exact",
            means:
              "The FJC figure for a district and fiscal year equals the AO's published figure for the same district and year.",
          },
          {
            term: "Within 1% or 1 case",
            means:
              "The two figures differ by no more than one percent, or by a single case for a very small district.",
            caveat:
              "Includes the exact matches. Differences go both ways: the FJC figure can be higher or lower.",
          },
          {
            term: "Independent recheck",
            means:
              "A separate program recomputed a set of figures straight from the source file without the database the loader used, from the codebook's definitions.",
            caveat: "It checks the arithmetic of the load, not the court's own data entry.",
          },
          {
            term: "Statistical year",
            means:
              "The AO's fiscal year (October 1 to September 30), named for the year it ends. The year in progress is partial and is never compared or ranked.",
          },
        ]}
      />
    </div>
  );
}

function QualityRow({ label, value }: { label: string; value: number | null }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right font-mono">{value == null ? NOT_RECORDED : int(value)}</dd>
    </>
  );
}

const FORMULA_NAME: Record<string, string> = {
  median_days: "Median days",
  pending_end: "Pending at year end",
  trial_pct: "Trial share",
};

function FormulaRow({ name, text }: { name: string; text: string }) {
  return (
    <>
      <dt className="font-medium">{FORMULA_NAME[name] ?? name.replace(/_/g, " ")}</dt>
      <dd className="leading-4 text-muted-foreground">{text}</dd>
    </>
  );
}
