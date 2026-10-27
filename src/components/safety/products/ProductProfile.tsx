/**
 * One product, device code or MDL product group (/safety/products/$id): headline counts, the monthly signal timeline
 * (reports, seriousness or event type, recalls, complaints), reactions or device problems (all-time ranking and a
 * period × term heatmap), the record list (MAUDE reports or NHTSA complaints) and the MDL links with their evidence,
 * every series with its exact source query. Reports are never presented as proof of causation.
 */
import { useMemo } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { BookOpen, FileText, LineChart, ListTree } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ChartFrame, Heatmap, LineTrend, RankedBars, metricFormatter } from "@/components/charts";
import { Kpi, LoadingBlock, Panel, SourceLink, StateNote } from "@/components/enforcement/parts";
import {
  basisLabel,
  formatCount,
  formatMonth,
  KIND_LABELS,
  mainSeries,
  primaryDim,
  recentChange,
  recordSource,
  seriesGroups,
  seriesLabel,
  sourceLabel,
  sourceShort,
  termMatrix,
  timeline,
  TYPE_LABELS,
  windowStart,
  type Grain,
  type SafetySubjectProfile,
  type SubjectSeries,
} from "./productModel";
import { subjectQuery, termPeriodsQuery } from "./queries";
import { RecordList } from "./RecordList";
import { ViewTabs } from "./ViewTabs";
import { ReportingContext } from "./ReportingContext";
import { RisingReactions } from "./RisingReactions";

export type ProfileTab = "overview" | "terms" | "records" | "sources";
const COUNT = metricFormatter("count");
const PERIODS_SHOWN = 16;
// the heatmap's label gutter is at most 180 px wide: longer MedDRA terms are shortened there (full term in the id)
const shortTerm = (s: string) => (s.length > 25 ? `${s.slice(0, 24).trimEnd()}…` : s);

export function ProductProfile({
  id,
  tab,
  grain,
  group,
  onChange,
}: {
  id: string;
  tab: ProfileTab;
  grain: Grain;
  group: string | undefined;
  onChange: (next: { tab?: ProfileTab; grain?: Grain; group?: string }) => void;
}) {
  const q = useQuery(subjectQuery(id));
  if (q.isLoading) return <LoadingBlock label="Loading the product" />;
  if (q.error)
    return (
      <StateNote
        tone="error"
        action={
          <Button size="sm" variant="outline" onClick={() => void q.refetch()}>
            Retry
          </Button>
        }
      >
        The product could not be loaded.
      </StateNote>
    );
  if (q.data === null || q.data === undefined)
    return (
      <StateNote>
        No product is recorded under “{id}”, or product signal data are not loaded yet.{" "}
        <Link to="/safety/products" className="text-primary hover:underline">
          All products
        </Link>
      </StateNote>
    );
  return <Profile p={q.data} tab={tab} grain={grain} group={group} onChange={onChange} />;
}

function Profile({
  p,
  tab,
  grain,
  group,
  onChange,
}: {
  p: SafetySubjectProfile;
  tab: ProfileTab;
  grain: Grain;
  group: string | undefined;
  onChange: (next: { tab?: ProfileTab; grain?: Grain; group?: string }) => void;
}) {
  const dim = primaryDim(p);
  const records = recordSource(p);
  const vehicle = p.subject.kind === "vehicle";
  const tabs = [
    { id: "overview" as const, label: "Timeline", Icon: LineChart },
    // vehicle groups have no reaction or problem counts (NHTSA components are shown on each complaint)
    ...(vehicle
      ? []
      : [
          {
            id: "terms" as const,
            label: dim === "device_problem" ? "Device problems" : "Reactions",
            Icon: ListTree,
            disabled: !dim,
            note: dim ? undefined : "No reaction or problem counts are stored for this product",
          },
        ]),
    {
      id: "records" as const,
      label: records === "nhtsa" ? "Complaints" : "Reports",
      Icon: FileText,
      disabled: !records,
      note: records
        ? undefined
        : "Record-level reports are stored only for MDL device and vehicle groups",
    },
    { id: "sources" as const, label: "MDLs & sources", Icon: BookOpen },
  ];
  const active = tabs.find((t) => t.id === tab && !t.disabled) ? tab : "overview";
  return (
    <div className="min-w-0 space-y-3">
      <Headline p={p} />
      <ViewTabs
        label="Product views"
        idPrefix="safety-product"
        tabs={tabs}
        active={active}
        onSelect={(t) => onChange({ tab: t })}
      />
      <div
        id="safety-product-panel"
        role="tabpanel"
        aria-labelledby={`safety-product-tab-${active}`}
        className="min-w-0 space-y-3"
      >
        {active === "overview" ? (
          <>
            <Timeline p={p} grain={grain} group={group} onChange={onChange} />
            {p.mdls.length ? <ReportingContext p={p} /> : null}
          </>
        ) : null}
        {active === "terms" && dim ? (
          <>
            {dim === "meddra_pt" ? <RisingReactions p={p} /> : null}
            <Terms p={p} dim={dim} />
          </>
        ) : null}
        {active === "records" && records ? (
          <RecordList source={records} subject={p.subject.id} total={p.records[records]} />
        ) : null}
        {active === "sources" ? <Sources p={p} /> : null}
      </div>
    </div>
  );
}

function Headline({ p }: { p: SafetySubjectProfile }) {
  const main = mainSeries(p.series);
  const change = recentChange(main);
  const serious = p.series.find((s) => s.series === "faers_serious");
  const deathInjury = ["maude_death", "maude_injury"].map((x) =>
    p.series.find((s) => s.series === x),
  );
  const crash = p.series.find((s) => s.series === "nhtsa_complaints_crash");
  const share =
    main && serious && main.total > 0
      ? { label: "Marked serious", value: `${((serious.total / main.total) * 100).toFixed(1)}%` }
      : main?.series === "nhtsa_complaints" && crash && main.total > 0
        ? { label: "Reporting a crash", value: `${((crash.total / main.total) * 100).toFixed(1)}%` }
        : main && deathInjury.every(Boolean) && main.total > 0
          ? {
              label: "Death or injury",
              value: `${(((deathInjury[0]!.total + deathInjury[1]!.total) / main.total) * 100).toFixed(1)}%`,
            }
          : null;
  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">
        {TYPE_LABELS[p.subject.subject_type]} · {KIND_LABELS[p.subject.kind] ?? p.subject.kind}
        {p.subject.rank ? ` · rank ${p.subject.rank} by reports` : ""}
        {p.mdls.length ? ` · MDL ${p.mdls.map((m) => m.mdl).join(", ")}` : ""}
      </p>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        <Kpi
          label={main ? `${seriesLabel(main.series)} in the window` : "Reports"}
          value={formatCount(main?.total)}
          note={
            main
              ? `${formatMonth(main.coverage_from)} – ${formatMonth(main.coverage_to)}`
              : undefined
          }
        />
        <Kpi
          label="Last 12 months"
          value={formatCount(change.last12)}
          note={change.prev12 != null ? `previous 12: ${formatCount(change.prev12)}` : undefined}
        />
        <Kpi
          label="Change, 12 months"
          value={
            change.pct == null
              ? "Not recorded"
              : `${change.pct > 0 ? "+" : ""}${change.pct.toFixed(1)}%`
          }
          note={change.pct == null ? "needs 24 months with reports" : undefined}
        />
        <Kpi
          label={
            share?.label ?? (p.subject.kind === "vehicle" ? "Reporting a crash" : "Serious share")
          }
          value={share?.value ?? "Not recorded"}
        />
        <Kpi
          label="Source"
          value={sourceShort(main?.source_id ?? p.subject.source_id) ?? "Not recorded"}
          note={sourceLabel(main?.source_id ?? p.subject.source_id)}
        />
      </div>
      <p className="rounded-md border border-border bg-muted/30 px-3 py-2 text-[11px] leading-4 text-muted-foreground">
        {p.subject.caveat}
      </p>
    </div>
  );
}

function Timeline({
  p,
  grain,
  group,
  onChange,
}: {
  p: SafetySubjectProfile;
  grain: Grain;
  group: string | undefined;
  onChange: (next: { grain?: Grain; group?: string }) => void;
}) {
  const groups = useMemo(() => seriesGroups(p.series), [p.series]);
  const g = groups.find((x) => x.id === group) ?? groups[0];
  const chart = useMemo(
    () => (g ? timeline(p.series, g.series, grain) : null),
    [p.series, g, grain],
  );
  const used = g
    ? (g.series.map((s) => p.series.find((x) => x.series === s)).filter(Boolean) as SubjectSeries[])
    : [];
  if (!g || !chart) return <StateNote>No monthly series is stored for this product yet.</StateNote>;
  const first = used[0]!;
  return (
    <ChartFrame
      title={`${g.label}: ${p.subject.label}`}
      unit={first.unit}
      period={`${formatMonth(first.coverage_from)} – ${formatMonth(first.coverage_to)}, by ${grain === "month" ? "month" : "calendar year"} received`}
      sources={[
        ...new Map(
          used.map((s) => [
            s.query_url,
            {
              label: `${sourceLabel(s.source_id)}: ${seriesLabel(s.series)} query`,
              url: s.query_url,
            },
          ]),
        ).values(),
      ]}
      status={{ kind: "ready" }}
      notes={[
        "Months inside a series' window with no matching report are 0; before the window the source holds no data for this product.",
        grain === "year"
          ? "A year the data only partly cover is dashed."
          : "Switch to years for long spans.",
        used[0]!.caveat,
      ]}
      asOf={`retrieved ${used[0]!.retrieved_at.slice(0, 10)}`}
      actions={
        <div className="flex flex-wrap items-center gap-1.5">
          <label className="sr-only" htmlFor="safety-series-group">
            Series
          </label>
          <select
            id="safety-series-group"
            value={g.id}
            onChange={(e) => onChange({ group: e.target.value })}
            className="h-7 rounded border border-border bg-background px-1.5 text-xs"
          >
            {groups.map((x) => (
              <option key={x.id} value={x.id}>
                {x.label}
              </option>
            ))}
          </select>
          <div
            className="flex rounded border border-border text-xs"
            role="group"
            aria-label="Period"
          >
            {(["year", "month"] as const).map((x) => (
              <button
                key={x}
                type="button"
                aria-pressed={grain === x}
                onClick={() => onChange({ grain: x })}
                className={
                  grain === x
                    ? "bg-muted px-2 py-1 font-medium"
                    : "px-2 py-1 text-muted-foreground hover:bg-muted/50"
                }
              >
                {x === "year" ? "Years" : "Months"}
              </button>
            ))}
          </div>
        </div>
      }
      table={{
        caption: `${g.label} by ${grain}`,
        columns: [
          { label: grain === "month" ? "Month" : "Year" },
          ...chart.series.map((s) => ({ label: s.label, align: "right" as const })),
        ],
        rows: chart.axis.keys.map((k) => ({
          key: k,
          cells: [
            chart.axis.label(k),
            ...chart.series.map((s) =>
              COUNT.full(s.points.find((x) => x.key === k)?.value ?? null),
            ),
          ],
        })),
      }}
    >
      <LineTrend
        series={chart.series}
        axis={chart.axis}
        formatter={COUNT}
        unit={first.unit}
        height={240}
        ariaLabel={`${g.label} for ${p.subject.label}, by ${grain}`}
      />
    </ChartFrame>
  );
}

function Terms({ p, dim }: { p: SafetySubjectProfile; dim: "meddra_pt" | "device_problem" }) {
  const all = p.breakdowns[dim]!;
  const from = windowStart(p.periods, dim, PERIODS_SHOWN);
  const periods = useQuery(termPeriodsQuery(p.subject.id, dim, from));
  const matrix = useMemo(() => termMatrix(periods.data ?? null), [periods.data]);
  const columns = matrix.columns.slice(-PERIODS_SHOWN);
  const word = dim === "meddra_pt" ? "reaction (MedDRA preferred term)" : "device problem";
  const others = (["patient_problem", "manufacturer", "brand_name"] as const).filter(
    (d) => p.breakdowns[d],
  );
  return (
    <div className="space-y-3">
      <ChartFrame
        title={`Most reported ${dim === "meddra_pt" ? "reactions" : "device problems"}: ${p.subject.label}`}
        unit="reports"
        period={all.period === "all" ? "all reports in the source" : all.period}
        sources={[{ label: `${sourceLabel(p.subject.source_id)} count query`, url: all.query_url }]}
        status={
          all.rows.length
            ? { kind: "ready" }
            : { kind: "empty", reason: "No term counts are stored." }
        }
        notes={[
          `A report can list several ${dim === "meddra_pt" ? "reactions" : "problems"}; each bar counts the reports that list that ${word}.`,
          all.truncated
            ? `The source was asked for the top ${all.limit_n} terms; rarer terms are not listed.`
            : "Every term the source returned is listed.",
          dim === "meddra_pt"
            ? "Serious counts come from a second query with serious = 1; a blank serious count is not recorded."
            : "Problems are as reported; they are not FDA findings.",
        ]}
        table={{
          caption: `Top ${word}s`,
          columns: [
            { label: "Term" },
            { label: "Reports", align: "right" },
            ...(dim === "meddra_pt" ? [{ label: "Serious", align: "right" as const }] : []),
          ],
          rows: all.rows.map((r) => ({
            key: r.term,
            cells: [
              r.term,
              COUNT.full(r.value),
              ...(dim === "meddra_pt" ? [COUNT.full(r.serious)] : []),
            ],
          })),
        }}
      >
        <RankedBars
          items={all.rows.slice(0, 20).map((r) => ({
            id: r.term,
            label: r.term,
            value: r.value,
            note: r.serious != null ? `${r.serious.toLocaleString("en-US")} serious` : undefined,
          }))}
          formatter={COUNT}
          unit="reports"
          ariaLabel={`Most reported terms for ${p.subject.label}`}
          limit={20}
        />
      </ChartFrame>
      <ChartFrame
        title={`Top ${dim === "meddra_pt" ? "reactions" : "problems"} by period: ${p.subject.label}`}
        unit="reports"
        period={
          columns.length
            ? `${columns[0]!.label} – ${columns[columns.length - 1]!.label} (latest ${columns.length} periods)`
            : undefined
        }
        sources={(periods.data?.periods ?? [])
          .slice(-1)
          .map((x) => ({ label: "Latest period query", url: x.query_url }))}
        status={
          periods.isLoading
            ? { kind: "loading" }
            : periods.error
              ? { kind: "error", onRetry: () => void periods.refetch() }
              : !columns.length || !matrix.rows.length
                ? { kind: "empty", reason: "No per-period breakdown is stored for this product." }
                : { kind: "ready" }
        }
        notes={[
          "Rows are the terms with the most recorded reports in the periods shown; columns are the latest periods with reports (quarters, or years for lower-ranked drugs).",
          "Hatched cells are not recorded: that period's query returned only its top terms and this term was not among them. A blank-free 0 means the period's full list did not include it.",
        ]}
      >
        <Heatmap
          rows={matrix.rows.map((r) => ({ id: r.id, label: shortTerm(r.label) }))}
          columns={columns}
          value={matrix.value}
          formatter={COUNT}
          ariaLabel={`Reports per period for the top terms of ${p.subject.label}`}
          cellNote={(t, c) => {
            const s = matrix.serious(t, c);
            return s == null ? undefined : `${s.toLocaleString("en-US")} serious`;
          }}
        />
      </ChartFrame>
      {others.length ? (
        <div className="grid gap-3 lg:grid-cols-3">
          {others.map((d) => (
            <Panel
              key={d}
              title={
                d === "patient_problem"
                  ? "Patient problems"
                  : d === "manufacturer"
                    ? "Makers as reported"
                    : "Brand names as reported"
              }
              subtitle="Top terms, all reports"
              footnote={<SourceLink href={p.breakdowns[d]!.query_url}>count query</SourceLink>}
            >
              <ol className="divide-y divide-border/60 text-xs">
                {p.breakdowns[d]!.rows.slice(0, 10).map((r) => (
                  <li key={r.term} className="flex justify-between gap-2 px-3 py-1">
                    {d === "manufacturer" && r.term.trim().length >= 2 && r.term.length <= 200 ? (
                      <Link
                        to="/safety/companies"
                        search={{ name: r.term.trim() }}
                        className="min-w-0 truncate text-primary hover:underline"
                        title={`Company safety facts recorded under exactly “${r.term}”`}
                      >
                        {r.term}
                      </Link>
                    ) : (
                      <span className="min-w-0 truncate" title={r.term}>
                        {r.term || "Not recorded"}
                      </span>
                    )}
                    <span className="tabular-nums text-muted-foreground">
                      {formatCount(r.value)}
                    </span>
                  </li>
                ))}
              </ol>
            </Panel>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function Sources({ p }: { p: SafetySubjectProfile }) {
  return (
    <div className="space-y-3">
      <Panel
        title="MDLs"
        subtitle="A product is linked to an MDL only when the MDL's official JPML title names it; the matched words and basis are shown."
      >
        {p.mdls.length ? (
          <ul className="divide-y divide-border/60 text-xs">
            {p.mdls.map((m) => (
              <li key={m.mdl} className="space-y-0.5 px-3 py-2">
                <div className="flex flex-wrap items-baseline gap-2">
                  <Link
                    to="/matters/lens/$mdl"
                    params={{ mdl: String(m.mdl) }}
                    className="font-medium text-primary hover:underline"
                  >
                    MDL {m.mdl}
                  </Link>
                  <span>{m.title}</span>
                </div>
                <p className="text-muted-foreground">
                  {basisLabel(m.basis)}: {m.title_tokens.map((t) => `“${t}”`).join(", ")}.{" "}
                  {m.basis_note}{" "}
                  <SourceLink href={m.title_source_url}>
                    {m.title_source_dataset === "mdls"
                      ? "JPML pending report"
                      : "JPML terminated report"}
                  </SourceLink>
                </p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="px-3 py-2 text-xs text-muted-foreground">
            No MDL title names this product.
          </p>
        )}
      </Panel>
      <Panel
        title="Series and their exact queries"
        subtitle="Every count is the number the source returned for this query; months are calendar months of receipt."
      >
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-left text-xs">
            <thead className="border-b border-border text-[11px] uppercase tracking-wide text-muted-foreground">
              <tr>
                <th scope="col" className="px-3 py-1.5 font-medium">
                  Series
                </th>
                <th scope="col" className="px-3 py-1.5 font-medium">
                  Window
                </th>
                <th scope="col" className="px-3 py-1.5 text-right font-medium">
                  Total
                </th>
                <th scope="col" className="px-3 py-1.5 font-medium">
                  Source
                </th>
              </tr>
            </thead>
            <tbody>
              {p.series.map((s) => (
                <tr key={s.series} className="border-b border-border/60 last:border-0">
                  <td className="px-3 py-1.5">{seriesLabel(s.series)}</td>
                  <td className="px-3 py-1.5 text-muted-foreground">
                    {formatMonth(s.coverage_from)} – {formatMonth(s.coverage_to)}
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{formatCount(s.total)}</td>
                  <td className="px-3 py-1.5">
                    <SourceLink href={s.query_url}>{sourceLabel(s.source_id)}</SourceLink>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
      <Panel title="How this product is matched">
        <pre className="overflow-x-auto whitespace-pre-wrap break-words px-3 py-2 font-mono text-[11px] leading-4 text-muted-foreground">
          {JSON.stringify(p.subject.search, null, 1)}
        </pre>
      </Panel>
    </div>
  );
}
