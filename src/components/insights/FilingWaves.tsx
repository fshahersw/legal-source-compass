/**
 * /insights/signals "New-filing waves": gross federal filings carrying each product-liability MDL's number (FJC IDB),
 * aligned on the MDL's first fiscal year with 10+ filings. Beside the JPML growth chart, which shows net pending.
 */
import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  ChartFrame,
  LineTrend,
  metricFormatter,
  type ChartStatus,
  type PeriodAxis,
} from "@/components/charts";
import { AiSummary, AskAiButton, buildSectionContext, type FigureInput } from "@/components/kit";
import { getFilingWaves } from "@/lib/insights/filingWaves.functions";
import {
  COHORT_MIN_CASES,
  FJC_MDL_SOURCE,
  MAX_OFFSET,
  START_MIN,
  cohortMedian,
  defaultSelection,
  indexToPeak,
  type Wave,
} from "@/lib/insights/filingWaves";
import { Segmented } from "./controls";

const filingWavesQuery = {
  queryKey: ["insights", "filing-waves"] as const,
  queryFn: () => getFilingWaves(),
  staleTime: 10 * 60 * 1000,
  retry: 1,
};

const count = metricFormatter("count");
const pct = metricFormatter("percent");
/** Five MDL lines plus the cohort median fill the six-slot categorical palette. */
const MAX_SELECTED = 5;
const shortName = (w: Wave) => {
  const t = w.title
    ?.replace(/^IN RE:?\s*/i, "")
    .replace(/\s+(Products? Liability|Marketing, Sales Practices).*$/i, "");
  return `MDL ${w.mdl}${t ? ` ${t.slice(0, 40)}` : ""}`;
};

export function FilingWaves() {
  const q = useQuery(filingWavesQuery);
  const [mode, setMode] = useState<"filings" | "index">("filings");
  const [picked, setPicked] = useState<number[] | null>(null);
  const waves = useMemo(() => q.data?.waves ?? [], [q.data]);
  const selected = (picked ?? defaultSelection(waves)).slice(0, MAX_SELECTED);
  const shown = waves.filter((w) => selected.includes(w.mdl));
  const median = useMemo(() => cohortMedian(waves), [waves]);
  const maxOffset = Math.min(
    MAX_OFFSET,
    Math.max(0, ...shown.map((w) => w.points.length - 1), median.length - 1),
  );
  const axis: PeriodAxis = {
    keys: Array.from({ length: maxOffset + 1 }, (_, i) => String(i)),
    label: (k) => `Year ${k} (fiscal years since the first with ${START_MIN}+ filings)`,
    tick: (k) => `Y${k}`,
  };
  const series = [
    ...shown.map((w) => {
      const idx = indexToPeak(w);
      return {
        id: String(w.mdl),
        label: shortName(w),
        points: w.points.map((p, i) => ({
          key: String(p.offset),
          value: mode === "filings" ? p.cases : (idx[i] ?? null),
          partial: p.partial,
        })),
      };
    }),
    ...(mode === "filings"
      ? [
          {
            id: "median",
            label: `Median of ${waves.length} product-liability MDLs`,
            points: median.map((m) => ({ key: String(m.offset), value: m.median, n: m.n })),
          },
        ]
      : []),
  ];
  const partialFy = q.data?.partialFy ?? null;
  const status: ChartStatus = q.isPending
    ? { kind: "loading" }
    : q.isError
      ? { kind: "error", onRetry: () => void q.refetch() }
      : !waves.length
        ? { kind: "empty", reason: "No product-liability MDL with 500+ cases is recorded." }
        : { kind: "ready" };
  const toggle = (mdl: number) =>
    setPicked((cur) => {
      const base = cur ?? selected;
      if (base.includes(mdl)) return base.filter((m) => m !== mdl);
      return base.length >= MAX_SELECTED ? base : [...base, mdl];
    });
  const figures: FigureInput[] = shown.flatMap((w) => [
    { label: `${shortName(w)}: year 0`, value: `FY${w.startFy}` },
    ...w.points.slice(0, 4).map((p) => ({
      label: `${shortName(w)}: filings in year ${p.offset}`,
      value: p.cases,
      unit: "cases",
      period: `FY${p.fy}`,
      ...(p.partial ? { note: "partial fiscal year" } : {}),
    })),
    {
      label: `${shortName(w)}: peak complete year`,
      value: w.peak ? w.peak.cases : null,
      unit: "cases",
      ...(w.peak ? { period: `FY${w.peak.fy}` } : {}),
    },
  ]);
  const context = q.data
    ? buildSectionContext({
        id: "filing-waves",
        title: "New-filing waves of product-liability MDLs",
        scope: "Federal civil cases carrying the MDL number, aligned on year 0",
        period: `FY data through ${q.data.dataThrough ?? "Not recorded"}${partialFy ? `; FY${partialFy} partial` : ""}`,
        source: FJC_MDL_SOURCE.label,
        figures: [
          ...median.slice(0, 4).map((m) => ({
            label: `Cohort median filings in year ${m.offset}`,
            value: m.median,
            unit: "cases",
            note: `n = ${m.n} MDLs`,
          })),
          ...figures,
        ],
        maxFigures: 40,
      })
    : null;
  return (
    <div id="waves" className="scroll-mt-16 space-y-3">
      <ChartFrame
        title="New filings in product-liability MDLs, by years since the first sizeable year"
        unit={
          mode === "filings"
            ? "cases filed per fiscal year"
            : "% of the MDL's own peak complete year"
        }
        period={q.data?.dataThrough ? `FJC data through ${q.data.dataThrough}` : undefined}
        sources={[FJC_MDL_SOURCE]}
        status={status}
        headingLevel="h2"
        minHeight={300}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Segmented
              label="Scale"
              value={mode}
              onChange={setMode}
              options={[
                { id: "filings", label: "Filings" },
                { id: "index", label: "% of own peak" },
              ]}
            />
            <AskAiButton
              sectionId="filing-waves"
              title="New-filing waves"
              context={context}
              size="icon"
              questions={[
                "Which of these MDLs is adding cases fastest for its age?",
                "How does gross filing differ from the JPML pending count?",
              ]}
            />
          </div>
        }
        notes={[
          `Gross arrivals: every federal civil case carrying the MDL number, by fiscal year of filing (FJC IDB). This is a historical association, not current MDL membership, and not the JPML's net pending count.`,
          `Year 0 is the MDL's first fiscal year with at least ${START_MIN} such filings, so one stray early case does not set the start. A later year with none counts as 0.`,
          `Product-liability MDLs: at least half of their cases carry a product-liability nature of suit. The median line covers those with ${COHORT_MIN_CASES}+ cases, complete fiscal years only.`,
          partialFy
            ? `FY${partialFy} is partial (the file ends before September 30): dashed, never used as a peak, left out of the median.`
            : "Every fiscal year shown is complete.",
          "Single giant dockets dwarf the rest; use % of own peak to compare shapes.",
        ]}
        footnotes={
          q.data
            ? [
                `${q.data.mdlsRead} MDLs read; ${q.data.productMdls} product-liability; ${waves.length} with ${COHORT_MIN_CASES}+ cases aligned.`,
              ]
            : undefined
        }
        table={
          waves.length
            ? {
                caption: "Product-liability MDLs aligned on year 0",
                columns: [
                  { label: "MDL" },
                  { label: "Year 0", align: "right" },
                  { label: "Year 0 filings", align: "right" },
                  { label: "Year 1 filings", align: "right" },
                  { label: "Peak complete year", align: "right" },
                  { label: "Cases in all", align: "right" },
                ],
                rows: waves.map((w) => ({
                  key: String(w.mdl),
                  cells: [
                    <Link
                      key="l"
                      to="/matters/lens/$mdl"
                      params={{ mdl: String(w.mdl) }}
                      className="text-primary hover:underline"
                    >
                      {shortName(w)}
                    </Link>,
                    `FY${w.startFy}`,
                    count.full(w.points[0]?.cases ?? null),
                    w.points[1]
                      ? `${count.full(w.points[1].cases)}${w.points[1].partial ? " (partial)" : ""}`
                      : "Not recorded",
                    w.peak ? `${count.full(w.peak.cases)} (FY${w.peak.fy})` : "Not recorded",
                    count.full(w.cases),
                  ],
                })),
              }
            : undefined
        }
      >
        {shown.length || median.length ? (
          <LineTrend
            series={series}
            axis={axis}
            formatter={mode === "filings" ? count : pct}
            unit={mode === "filings" ? "cases" : undefined}
            ariaLabel="New filings by years since each MDL's first sizeable year"
            height={300}
            highlight={null}
            colorSlot={(id, i) => (id === "median" ? MAX_SELECTED : Math.min(i, MAX_SELECTED - 1))}
          />
        ) : null}
      </ChartFrame>
      {waves.length ? (
        <fieldset className="flex flex-wrap gap-1.5 text-[11px]">
          <legend className="mb-1 text-muted-foreground">
            MDLs drawn (up to {MAX_SELECTED}; newest year 0 first)
          </legend>
          {waves.slice(0, 18).map((w) => {
            const on = selected.includes(w.mdl);
            return (
              <button
                key={w.mdl}
                type="button"
                aria-pressed={on}
                onClick={() => toggle(w.mdl)}
                className={
                  on
                    ? "rounded border border-primary bg-primary/10 px-2 py-0.5 text-foreground"
                    : "rounded border border-border px-2 py-0.5 text-muted-foreground hover:bg-muted"
                }
              >
                {shortName(w)} · FY{w.startFy}
              </button>
            );
          })}
        </fieldset>
      ) : null}
      <AiSummary context={context} />
    </div>
  );
}
