/**
 * Docket flow (CJRA): a judge's semiannual CJRA counts as an annotated line, with the JPML transfer dates of the
 * judge's pending MDLs marked. Answers "is this judge's backlog growing, and is it MDL inventory?". Unlisted reports are
 * gaps, never 0; the counts are judge-reported lists, not a measure of speed or quality.
 */
import { useState } from "react";
import {
  AnnotatedTrend,
  ChartCard,
  periodTable,
  trendTakeaway,
} from "@/components/charts/recharts";
import { metricFormatter } from "@/components/charts/format";
import { Segmented } from "@/components/insights/controls";
import type { JudgeCrossProfile } from "@/lib/external/judgeCross.functions";
import { CJRA_LABELS, CJRA_SOURCE, type JudgeCjra } from "@/lib/external/judgeCjra.functions";
import { civil3yIncludesMdl, cjraSeries, fmtCount, mdlEvents, shortDate } from "./judgeGlanceView";

type Key = "motions_6m" | "civil_3y";
const count = metricFormatter("count");

export function JudgeDocketHealthCard({
  cjra,
  cross,
}: {
  cjra: JudgeCjra;
  cross: JudgeCrossProfile | null;
}) {
  const [key, setKey] = useState<Key>("motions_6m");
  const built = cjraSeries(cjra, key);
  const other: Key = key === "motions_6m" ? "civil_3y" : "motions_6m";
  const hasOther = !!cjraSeries(cjra, other);
  if (!built && !hasOther) return null;
  const events = built ? mdlEvents(cross, built.axis.keys) : [];
  const keys = built?.axis.keys ?? [];
  const period = keys.length ? `${shortDate(keys[0]!)} to ${shortDate(keys.at(-1)!)}` : undefined;
  const label = CJRA_LABELS[key];
  const title =
    (built &&
      trendTakeaway(
        label,
        built.series.points.map((p) => ({ label: shortDate(p.key), value: p.value })),
        fmtCount,
      )) ||
    `${label}, by CJRA report`;
  const notes = cjra.notes.filter((n) => n.column === key);
  const sources = [
    { label: CJRA_SOURCE.label, url: cjra.sourceUrl ?? CJRA_SOURCE.url },
    ...(cross
      ? [{ label: "JPML pending MDL report", url: "https://www.jpml.uscourts.gov/pending-mdls-0" }]
      : []),
  ];
  return (
    <ChartCard
      variant="editorial"
      title={title}
      subtitle={`${label} · cases or motions · semiannual CJRA reports${period ? ` · ${period}` : ""}`}
      status={
        built
          ? { kind: "ready" }
          : { kind: "empty", reason: "Fewer than two reports list a value for this measure." }
      }
      sources={sources}
      {...(period ? { period } : {})}
      actions={
        <Segmented
          label="CJRA measure"
          value={key}
          onChange={(v) => setKey(v)}
          options={[
            { id: "motions_6m", label: "Motions > 6 months" },
            { id: "civil_3y", label: "Civil > 3 years" },
          ]}
        />
      }
      table={
        built
          ? periodTable(
              built.series.points.map((p) => ({ report: shortDate(p.key), value: p.value })),
              "report",
              [{ key: "value", label }],
              fmtCount,
              { caption: `${label}, ${cjra.name}, by CJRA report`, xLabel: "Report date" },
            )
          : undefined
      }
      about={
        <div className="space-y-2">
          <p>
            Each point is one semiannual CJRA report (March 31 and September 30). Judges list their
            own motions pending more than six months and civil cases pending more than three years;
            the counts are lists, not a measure of speed or quality. A report that does not list
            this judge is a gap, not zero.
          </p>
          {civil3yIncludesMdl(cjra, cross) ? (
            <p>
              Civil cases over three years include MDL member cases, and districts report them
              differently, so this count is not comparable across judges.
            </p>
          ) : null}
          {events.length ? (
            <p>
              Marked: the JPML transfer date of the judge&apos;s largest pending MDLs, drawn at the
              next report.
            </p>
          ) : null}
          {cjra.roles.length > 1 ? (
            <p>The reports list this person under more than one role ({cjra.roles.join(", ")}).</p>
          ) : null}
          {notes.length ? (
            <div>
              <p className="font-medium">Report footnotes</p>
              <ul className="list-disc pl-4">
                {[...new Map(notes.map((n) => [n.text, n])).values()].slice(0, 6).map((n) => (
                  <li key={n.text}>
                    {n.text}{" "}
                    <span className="text-muted-foreground">(first {shortDate(n.period)})</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      }
    >
      {built ? (
        <AnnotatedTrend
          series={[built.series]}
          axis={built.axis}
          formatter={count}
          form="line"
          events={events}
          callouts={["peak"]}
          partialLabel={false}
          ariaLabel={`${label} per CJRA report for ${cjra.name}`}
          height={260}
        />
      ) : null}
    </ChartCard>
  );
}
