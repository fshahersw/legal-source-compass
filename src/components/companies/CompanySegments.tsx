import { useQuery } from "@tanstack/react-query";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ChartUnavailable } from "@/components/fda-analytics/FdaCharts";
import { chartDateLabel, FDA_COLORS } from "@/components/fda-analytics/chartView";
import { Panel } from "@/components/enforcement/parts";
import { money } from "./companyData";
import { companySegmentsQuery } from "./companyQueries";
import {
  checkText,
  latestMix,
  SEGMENT_KIND_LABEL,
  segmentSeries,
  subtotalMembers,
  type Grain,
  type SegmentAxis,
  type SegmentsProfile,
} from "./companyStatements";
import { GrainToggle } from "./CompanyFinancials";
import { LoadingBlocks, Notice, SourceLine } from "./CompanyUi";

const axisTick = { fontSize: 11, fill: "var(--muted-foreground)" };
const KIND_ORDER = { segment: 0, product: 1, geography: 2 } as const;

export function SegmentsTab({
  cik,
  grain,
  onGrain,
  currency,
}: {
  cik: string;
  grain: Grain;
  onGrain: (g: Grain) => void;
  /** The statements' reporting currency; instance unit ids are filer-chosen labels, not currencies. */
  currency: string | null;
}) {
  const q = useQuery(companySegmentsQuery(cik));
  if (q.isLoading) return <LoadingBlocks label="Loading segments" tiles={0} />;
  if (q.isError)
    return (
      <Notice tone="error">
        Segment data could not be loaded. {q.error instanceof Error ? q.error.message : ""}
      </Notice>
    );
  if (!q.data)
    return (
      <Notice>
        No business-segment, product or geographic breakdown is tagged in the XBRL instance
        documents of this registrant&rsquo;s latest annual and quarterly reports.
      </Notice>
    );
  return <Segments p={q.data} grain={grain} onGrain={onGrain} currency={currency} />;
}

function Segments({
  p,
  grain,
  onGrain,
  currency,
}: {
  p: SegmentsProfile;
  grain: Grain;
  onGrain: (g: Grain) => void;
  currency: string | null;
}) {
  const axes = [...p.axes].sort(
    (a, b) =>
      (a.measure === "revenue" ? 0 : 1) - (b.measure === "revenue" ? 0 : 1) ||
      KIND_ORDER[a.kind] - KIND_ORDER[b.kind],
  );
  const anyQuarterly = axes.some((a) => a.quarterly);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3 rounded-md border border-border bg-surface px-3 py-2">
        <GrainToggle grain={grain} onGrain={onGrain} quarterly={anyQuarterly} />
        <span className="text-[11px] text-muted-foreground">
          Members as tagged in the filings; parts are compared with the consolidated total and
          differences are shown, not adjusted.
        </span>
      </div>
      {axes.map((a) => (
        <AxisPanel key={`${a.axis}:${a.measure}`} axis={a} grain={grain} currency={currency} />
      ))}
      <SourceLine>
        Source: the registrant&rsquo;s XBRL instance documents{" "}
        {p.filingsUsed.map((f, i) => (
          <span key={f.accn}>
            {i ? "; " : ""}
            <a
              href={f.url}
              target="_blank"
              rel="noreferrer"
              className="text-primary hover:underline"
            >
              {f.form} filed {f.date}
            </a>
          </span>
        ))}
        {p.retrieved ? ` (retrieved ${p.retrieved})` : ""}. Member names come from each
        filing&rsquo;s label linkbase; the latest filing wins where periods overlap. Shares in the
        mix are of the members&rsquo; sum.
      </SourceLine>
    </div>
  );
}

function AxisPanel({
  axis,
  grain,
  currency,
}: {
  axis: SegmentAxis;
  grain: Grain;
  currency: string | null;
}) {
  const shown: Grain = axis[grain] ? grain : axis.annual ? "annual" : "quarterly";
  const partition = subtotalMembers(axis, shown);
  const subtotals = partition.members;
  const exclude = new Set(subtotals);
  const series = segmentSeries(axis, shown, 5, exclude);
  const mix = latestMix(axis, shown, exclude);
  const labelOf = new Map(axis.members.map((m) => [m.member, m.label]));
  const last = (axis[shown]?.periods.length ?? 1) - 1;
  const fmt = (v: number) => money(v, currency);
  const periodChecks = axis.checks.filter((c) =>
    axis[shown]?.periods.some((p) => p.start === c.start && p.end === c.end),
  );
  const compared = periodChecks.filter((c) => c.status !== "no_total");
  const matched = compared.filter((c) => c.status === "matches").length;
  const measure = axis.measure === "revenue" ? "revenue" : "operating income";
  return (
    <Panel
      title={`${SEGMENT_KIND_LABEL[axis.kind]}: ${measure}`}
      subtitle={`${axis.members.length} member${axis.members.length === 1 ? "" : "s"} · ${axis.concept} · ${shown === "annual" ? "fiscal years" : "quarters"}${shown !== grain ? " (no quarterly breakdown tagged)" : ""}`}
      footnote={
        <>
          {checkText(mix?.check ?? null, fmt)}{" "}
          {compared.length
            ? `Across the ${compared.length} period${compared.length === 1 ? "" : "s"} with a consolidated total, ${matched} match within 1%.`
            : ""}
          {subtotals.length && mix ? (
            <>
              {" "}
              Not stacked:{" "}
              {subtotals
                .map((m) => {
                  const v = axis[shown]?.values[m]?.[last] ?? null;
                  return `${labelOf.get(m) ?? m}${v !== null ? ` (${fmt(v)})` : ""}`;
                })
                .join(" and ")}
              {subtotals.length === 1 ? ", a subtotal" : ", subtotals"} of other members: without{" "}
              {subtotals.length === 1 ? "it" : "them"} the members sum to {fmt(mix.sum)} in the
              latest period and match the consolidated total in {partition.matched} of{" "}
              {partition.compared} periods that report one (earlier periods can come from filings
              that list other members).
            </>
          ) : null}
        </>
      }
    >
      <div className="grid gap-0 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        {series && series.rows.length ? (
          <div className="h-64 px-2 py-2">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={series.rows} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
                <CartesianGrid stroke="var(--border)" vertical={false} />
                <XAxis
                  dataKey="end"
                  tick={axisTick}
                  tickFormatter={(v: string) =>
                    shown === "annual" ? v.slice(0, 4) : chartDateLabel(v)
                  }
                  interval="preserveStartEnd"
                  minTickGap={12}
                />
                <YAxis tick={axisTick} tickFormatter={fmt} width={60} />
                <ReferenceLine y={0} stroke="var(--border)" />
                <Tooltip
                  formatter={(v: number) => fmt(v)}
                  labelFormatter={(l) => `Period ending ${String(l)}`}
                />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                {series.keys.map((k, i) => (
                  <Bar
                    key={k.key}
                    dataKey={k.key}
                    name={k.label}
                    stackId="s"
                    fill={
                      k.key === "other"
                        ? "var(--muted-foreground)"
                        : FDA_COLORS[i % FDA_COLORS.length]
                    }
                    fillOpacity={k.key === "other" ? 0.45 : 1}
                    isAnimationActive={false}
                  />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <ChartUnavailable reason="No values for this grain." />
        )}
        <div className="border-t border-border/60 px-3 py-2 lg:border-l lg:border-t-0">
          {mix ? (
            <>
              <p className="mb-1.5 text-[11px] text-muted-foreground">
                Latest mix, period ending {mix.period.end}
              </p>
              <ul className="space-y-1.5">
                {mix.items.slice(0, 10).map((x) => (
                  <li key={x.member} className="text-xs">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="min-w-0 truncate" title={x.member}>
                        {x.label}
                      </span>
                      <span className="shrink-0 tabular-nums">
                        {fmt(x.value)}
                        {x.share !== null ? (
                          <span className="ml-1 text-muted-foreground">{x.share.toFixed(1)}%</span>
                        ) : null}
                      </span>
                    </div>
                    {x.share !== null ? (
                      <div className="mt-0.5 h-1 overflow-hidden rounded bg-muted" aria-hidden>
                        <div
                          className="h-full rounded bg-primary"
                          style={{ width: `${Math.min(100, x.share)}%` }}
                        />
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
              {mix.items.length > 10 ? (
                <p className="mt-1 text-[11px] text-muted-foreground">
                  {mix.items.length - 10} more members in the chart&rsquo;s &ldquo;Other&rdquo;
                  band.
                </p>
              ) : null}
            </>
          ) : (
            <p className="text-xs text-muted-foreground">No latest-period values.</p>
          )}
        </div>
      </div>
    </Panel>
  );
}
