import { useId, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { MoreToggle } from "@/components/enforcement/parts";
import {
  getClbDistrictGlance,
  type DistrictGlance,
  type GlanceAgreement,
  type GlanceMeasure,
} from "@/lib/external/clbCourt.functions";
import {
  NOT_RECORDED,
  fmtInt,
  glanceFiscalYear,
  measureValue,
  rankText,
  rhoText,
} from "./clbFormat";
import { CollapsibleSection } from "./ClbParts";

/** The 94 federal districts; the query is skipped for every other court id. */
const DISTRICT_ID = /^[a-z]{2,4}d$/;
const STALE = 10 * 60 * 1000;

const clbGlanceQuery = (courtId: string) => ({
  queryKey: ["clb-district-glance", courtId],
  queryFn: () => getClbDistrictGlance({ data: { id: courtId } }),
  staleTime: STALE,
});

/**
 * Official statistics for one federal district lined up with CourtListener's collection
 * (dataset clb_district_crossview). Every measure keeps its own source and period; the agreement
 * strip shows how closely two sources that count the same thing rank the 94 districts.
 */
export function DistrictGlancePanel({ courtId }: { courtId: string }) {
  const enabled = DISTRICT_ID.test(courtId);
  const q = useQuery({ ...clbGlanceQuery(courtId), enabled });
  if (!enabled) return null;
  if (q.isLoading)
    return (
      <div
        className="mb-5 h-40 animate-pulse rounded-lg border border-border bg-muted/40"
        aria-busy="true"
        aria-label="Loading district at a glance"
      />
    );
  if (q.isError)
    return (
      <p
        role="alert"
        className="mb-5 flex flex-wrap items-center gap-2 rounded-lg border border-border px-4 py-3 text-xs text-muted-foreground"
      >
        The district cross-source view could not be loaded.
        <button
          type="button"
          onClick={() => void q.refetch()}
          className="rounded text-primary underline focus-visible:outline-2 focus-visible:outline-ring"
        >
          Retry
        </button>
      </p>
    );
  if (!q.data) return null;
  return <Body g={q.data} />;
}

const MEASURE_LIMIT = 12;

function Body({ g }: { g: DistrictGlance }) {
  const uid = useId();
  const fy = glanceFiscalYear(g.measures);
  const recorded = g.measures.filter((m) => m.value != null).length;
  return (
    <section
      className="mb-5 min-w-0 rounded-xl border border-border bg-card shadow-xs"
      aria-labelledby={`${uid}-title`}
    >
      <div className="flex flex-wrap items-start justify-between gap-2 px-3 py-2">
        <div className="min-w-0">
          <h2 id={`${uid}-title`} className="text-sm font-semibold">
            District at a glance{fy ? `, ${fy}` : ""}
          </h2>
          <p className="text-xs text-muted-foreground">
            Official court statistics beside CourtListener's collection · {fmtInt(recorded)} of{" "}
            {fmtInt(g.measures.length)} measures on record · each row names its source and period
          </p>
        </div>
        <Link
          to="/records/$dataset/$id"
          params={{ dataset: "clb_district_crossview", id: g.courtId }}
          className="rounded-md border border-border px-2.5 py-1 text-xs hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
        >
          Cross-source record
        </Link>
      </div>
      <MeasureTable g={g} />
      {g.agreement.length ? <AgreementStrip pairs={g.agreement} /> : null}
      {g.caveats.length || g.snapshot ? (
        <div className="border-t border-border/70 px-3 py-2">
          <ul className="list-disc space-y-0.5 pl-4 text-[11px] leading-4 text-muted-foreground">
            {g.caveats.map((c) => (
              <li key={c}>{c}</li>
            ))}
            {g.snapshot ? <li>Snapshot of the CourtListener measures: {g.snapshot}.</li> : null}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

function MeasureRow({ m }: { m: GlanceMeasure }) {
  const v = measureValue(m);
  const missing = m.value == null;
  return (
    <tr className="border-t border-border/50 align-top">
      <th scope="row" className="px-3 py-1 text-left font-normal leading-4">
        {m.label}
      </th>
      <td className="whitespace-nowrap px-2 py-1 text-right font-mono tabular-nums">
        {missing ? (
          <span className="font-sans text-muted-foreground">{NOT_RECORDED}</span>
        ) : (
          <>
            {v.text}
            {v.unit ? (
              <span className="font-sans text-[11px] text-muted-foreground"> {v.unit}</span>
            ) : null}
          </>
        )}
      </td>
      <td className="whitespace-nowrap px-2 py-1 text-right font-mono tabular-nums text-muted-foreground">
        {rankText(m)}
      </td>
      <td className="px-3 py-1 leading-4">
        {m.source}
        <span className="text-[11px] text-muted-foreground"> · {m.period}</span>
      </td>
    </tr>
  );
}

function MeasureTable({ g }: { g: DistrictGlance }) {
  const [all, setAll] = useState(false);
  const uid = useId();
  const shown = all ? g.measures : g.measures.slice(0, MEASURE_LIMIT);
  return (
    <div className="border-t border-border/70">
      <div className="overflow-x-auto">
        <table id={uid} className="w-full min-w-[34rem] text-xs">
          <caption className="sr-only">
            Measures for this district with their rank among districts, source and period
          </caption>
          <thead className="text-muted-foreground">
            <tr>
              <th scope="col" className="px-3 py-1.5 text-left font-medium">
                Measure
              </th>
              <th scope="col" className="px-2 py-1.5 text-right font-medium">
                Value
              </th>
              <th
                scope="col"
                className="px-2 py-1.5 text-right font-medium"
                title="Rank among the districts that have the measure; 1 is the highest value"
              >
                Rank (1 = highest)
              </th>
              <th scope="col" className="px-3 py-1.5 text-left font-medium">
                Source · period
              </th>
            </tr>
          </thead>
          <tbody>
            {shown.map((m) => (
              <MeasureRow key={m.key} m={m} />
            ))}
          </tbody>
        </table>
      </div>
      <div className="px-3 pb-2">
        <MoreToggle
          total={g.measures.length}
          limit={MEASURE_LIMIT}
          expanded={all}
          onToggle={() => setAll((v) => !v)}
          controls={uid}
          noun="measures"
        />
      </div>
    </div>
  );
}

function AgreementStrip({ pairs }: { pairs: GlanceAgreement[] }) {
  return (
    <CollapsibleSection
      title="How the sources agree"
      summary={`${pairs.length} pairs that measure the same thing in two sources · rank correlation across ${fmtInt(
        Math.max(...pairs.map((p) => p.n)),
      )} districts`}
      defaultOpen
    >
      <p className="mb-2 text-[11px] leading-4 text-muted-foreground">
        Spearman rank correlation of the two measures across districts, with a 95% interval. It
        compares districts with each other, not this district's own figures; a low value would flag
        a matching problem between the sources.
      </p>
      <ul className="space-y-2.5">
        {pairs.map((p) => (
          <li
            key={p.id}
            className="grid min-w-0 gap-x-4 gap-y-0.5 md:grid-cols-[minmax(0,1fr)_minmax(15rem,21rem)]"
          >
            <div className="min-w-0 text-xs leading-4">
              {p.a.label} <span className="text-muted-foreground">({p.a.source})</span> and{" "}
              {p.b.label} <span className="text-muted-foreground">({p.b.source})</span>
              {p.why ? (
                <p className="mt-0.5 text-[11px] leading-4 text-muted-foreground">{p.why}</p>
              ) : null}
            </div>
            <div className="min-w-0">
              <p className="text-xs leading-4">
                <span className="font-mono font-semibold tabular-nums">ρ {rhoText(p.rho)}</span>
                <span className="text-[11px] text-muted-foreground">
                  {p.strength ? ` · ${p.strength}` : ""} · 95% interval {rhoText(p.ciLow)} to{" "}
                  {rhoText(p.ciHigh)} · n = {fmtInt(p.n)}
                </span>
              </p>
              <RhoScale p={p} />
            </div>
          </li>
        ))}
      </ul>
    </CollapsibleSection>
  );
}

/** A -1..1 scale with the interval as a band and the estimate as a tick; the numbers are printed beside it. */
function RhoScale({ p }: { p: GlanceAgreement }) {
  const at = (v: number) => `${((Math.min(1, Math.max(-1, v)) + 1) / 2) * 100}%`;
  return (
    <div className="relative mt-1 h-1.5 rounded-sm bg-muted" aria-hidden>
      <div
        className="absolute inset-y-0 rounded-sm bg-primary/30"
        style={{
          left: at(p.ciLow),
          width: `${((Math.min(1, p.ciHigh) - Math.max(-1, p.ciLow)) / 2) * 100}%`,
        }}
      />
      <div
        className="absolute -inset-y-0.5 w-0.5 rounded-sm bg-primary"
        style={{ left: at(p.rho) }}
      />
    </div>
  );
}
