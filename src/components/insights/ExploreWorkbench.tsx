/**
 * /insights/explore: the cross-metric workbench. Pick two metrics, an entity type and periods: scatter with the
 * least-squares line and the statistics box, the entities farthest above and below the line, the paired data, a
 * screen of one metric against every other (Spearman, Benjamini–Hochberg), a correlation matrix, and a running list of
 * the comparisons made in this tab with multiple-comparison control. The URL holds the state, so a view can be shared.
 */
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeftRight, Trash2 } from "lucide-react";
import type { CrossPoint, EntityType, Fact, MetricDef } from "@/lib/insights/contract";
import {
  ChartFrame,
  Heatmap,
  RankedBars,
  ScatterCorrelation,
  StatsBox,
  formatP,
  metricFormatter,
  periodLabel,
  scatterStats,
} from "@/components/charts";
import { benjaminiHochberg, correlationTest, spearman } from "@/components/charts/stats";
import { Button } from "@/components/ui/button";
import {
  CatalogNotice,
  ENTITY_LABEL,
  Field,
  FixtureBanner,
  MetricSelect,
  Segmented,
  controlClass,
} from "./controls";
import {
  catalogQuery,
  fixturesOn,
  labelsQuery,
  loadCross,
  loadPeriods,
  defaultPeriod,
  loadSnapshot,
} from "./data";

export type ExploreSearch = {
  type?: EntityType | undefined;
  x?: string | undefined;
  y?: string | undefined;
  px?: string | undefined;
  py?: string | undefined;
  log?: "x" | "y" | "xy" | undefined;
  sel?: string | undefined;
};

type SessionEntry = {
  key: string;
  type: EntityType;
  x: string;
  y: string;
  xLabel: string;
  yLabel: string;
  px: string;
  py: string;
  n: number;
  rho: number;
  p: number;
};

const SESSION_KEY = "insights.explore.comparisons";

function readSession(): SessionEntry[] {
  try {
    const raw = window.sessionStorage.getItem(SESSION_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed)
      ? (parsed as SessionEntry[]).filter(
          (e) => typeof e?.key === "string" && typeof e.p === "number",
        )
      : [];
  } catch {
    return [];
  }
}

function writeSession(entries: SessionEntry[]) {
  try {
    window.sessionStorage.setItem(SESSION_KEY, JSON.stringify(entries.slice(-50)));
  } catch {
    // storage unavailable: the list lives for this page view only
  }
}

/** Default pair: the first two rate or percent metrics the entity type has. */
function defaults(metrics: readonly MetricDef[]): [MetricDef | undefined, MetricDef | undefined] {
  const rates = metrics.filter(
    (m) => m.format === "rate_per_100k" || m.format === "percent" || m.format === "ratio",
  );
  const x = rates[0] ?? metrics[0];
  const y =
    rates.find((m) => m.id !== x?.id && m.format === "rate_per_100k") ??
    metrics.find((m) => m.id !== x?.id);
  return [x, y];
}

async function pickPeriod(
  m: MetricDef,
  type: EntityType,
  wanted: string | undefined,
  prefer: string | null,
) {
  const periods = await loadPeriods(m, type);
  if (wanted && periods.includes(wanted)) return { periods, period: wanted };
  if (prefer && periods.includes(prefer)) return { periods, period: prefer };
  return { periods, period: await defaultPeriod(m, type) };
}

export function ExploreWorkbench({
  search,
  set,
}: {
  search: ExploreSearch;
  set: (p: Partial<ExploreSearch>) => void;
}) {
  const catalog = useQuery(catalogQuery);
  const type: EntityType = search.type ?? "state";
  const types = useMemo(() => {
    const s = new Set<EntityType>();
    for (const m of catalog.data?.metrics ?? [])
      for (const t of m.entityTypes) if (t !== "nation") s.add(t);
    return [...s];
  }, [catalog.data]);
  const metrics = useMemo(
    () => (catalog.data?.metrics ?? []).filter((m) => m.entityTypes.includes(type)),
    [catalog.data, type],
  );
  const [dx, dy] = defaults(metrics);
  const mx = metrics.find((m) => m.id === search.x) ?? dx;
  const my =
    metrics.find((m) => m.id === search.y && m.id !== mx?.id) ??
    (dy?.id === mx?.id ? metrics.find((m) => m.id !== mx?.id) : dy);
  const words = ENTITY_LABEL[type];

  const pair = useQuery({
    queryKey: [
      "insights",
      "explore",
      type,
      mx?.id ?? "",
      my?.id ?? "",
      search.px ?? "",
      search.py ?? "",
    ],
    enabled: !!mx && !!my,
    staleTime: 10 * 60 * 1000,
    retry: 1,
    queryFn: async () => {
      const a = await pickPeriod(mx!, type, search.px, null);
      const b = await pickPeriod(my!, type, search.py, a.period);
      if (!a.period || !b.period)
        return {
          points: [] as CrossPoint[],
          px: a.period,
          py: b.period,
          periodsX: a.periods,
          periodsY: b.periods,
        };
      const points = await loadCross(mx!, my!, type, a.period, b.period);
      return { points, px: a.period, py: b.period, periodsX: a.periods, periodsY: b.periods };
    },
  });
  const ids = useMemo(() => (pair.data?.points ?? []).map((p) => p.entityId), [pair.data]);
  const labels = useQuery(labelsQuery(type, ids));
  const logOk = (axis: "x" | "y") =>
    (pair.data?.points ?? []).every((p) => (axis === "x" ? p.x : p.y) > 0);
  const logX = (search.log === "x" || search.log === "xy") && logOk("x");
  const logY = (search.log === "y" || search.log === "xy") && logOk("y");
  const points = useMemo(
    () =>
      (pair.data?.points ?? []).map((p) => ({
        id: p.entityId,
        label: labels.data?.get(p.entityId)?.label ?? p.entityId,
        x: p.x,
        y: p.y,
      })),
    [pair.data, labels.data],
  );
  const stats = useMemo(() => scatterStats(points, logX, logY), [points, logX, logY]);

  // comparisons run in this tab, for multiple-comparison control
  const [session, setSession] = useState<SessionEntry[]>([]);
  useEffect(() => setSession(readSession()), []);
  useEffect(() => {
    if (!mx || !my || !pair.data?.px || !pair.data.py || !stats.spearman) return;
    const key = `${type}|${mx.id}|${my.id}|${pair.data.px}|${pair.data.py}`;
    setSession((prev) => {
      if (prev.some((e) => e.key === key)) return prev;
      const next = [
        ...prev,
        {
          key,
          type,
          x: mx.id,
          y: my.id,
          xLabel: mx.label,
          yLabel: my.label,
          px: pair.data!.px!,
          py: pair.data!.py!,
          n: stats.n,
          rho: stats.spearman!.coefficient,
          p: stats.spearman!.p,
        },
      ];
      writeSession(next);
      return next;
    });
  }, [type, mx, my, pair.data, stats]);
  const qValues = useMemo(() => benjaminiHochberg(session.map((e) => e.p)), [session]);
  const currentKey =
    mx && my && pair.data?.px && pair.data.py
      ? `${type}|${mx.id}|${my.id}|${pair.data.px}|${pair.data.py}`
      : null;
  const currentIdx = session.findIndex((e) => e.key === currentKey);

  const fx = metricFormatter(mx?.format ?? "count");
  const fy = metricFormatter(my?.format ?? "count");
  const plx = (p: string) => (mx ? periodLabel(p, mx.periodType) : p);
  const ply = (p: string) => (my ? periodLabel(p, my.periodType) : p);
  const status =
    catalog.isPending || pair.isPending
      ? { kind: "loading" as const }
      : catalog.isError || pair.isError
        ? {
            kind: "error" as const,
            onRetry: () => void (catalog.isError ? catalog.refetch() : pair.refetch()),
          }
        : !mx || !my
          ? {
              kind: "empty" as const,
              reason: `Fewer than two metrics are published for ${words.many}.`,
            }
          : points.length < 3
            ? {
                kind: "empty" as const,
                reason: `Fewer than three ${words.many} record both values for these periods, so there is nothing to compare.`,
              }
            : { kind: "ready" as const };
  const sources = [...(mx?.sourceLinks ?? []), ...(my?.sourceLinks ?? [])].filter(
    (s, i, all) => all.findIndex((t) => t.url === s.url) === i,
  );
  // scatterStats keeps the input order, so residual i belongs to point i
  const residualItems = stats.fit
    ? points.map((p, i) => ({ id: p.id, label: p.label, value: stats.fit!.residuals[i] ?? null }))
    : [];

  return (
    <div className="space-y-3">
      <div className="grid gap-3 rounded-md border border-border bg-surface p-3 sm:grid-cols-2 lg:grid-cols-[9rem_minmax(0,1fr)_8.5rem_auto_minmax(0,1fr)_8.5rem]">
        <Field label="Compare">
          <select
            className={controlClass}
            value={type}
            onChange={(e) =>
              set({
                type: e.target.value as EntityType,
                x: undefined,
                y: undefined,
                px: undefined,
                py: undefined,
                sel: undefined,
              })
            }
          >
            {(types.length ? types : ["state" as EntityType]).map((t) => (
              <option key={t} value={t}>
                {ENTITY_LABEL[t].many[0]!.toUpperCase() + ENTITY_LABEL[t].many.slice(1)}
              </option>
            ))}
          </select>
        </Field>
        <MetricSelect
          label="Metric X (across)"
          metrics={metrics}
          value={mx?.id}
          onChange={(id) => set({ x: id, px: undefined })}
        />
        <Field label="Period X">
          <select
            className={controlClass}
            value={pair.data?.px ?? ""}
            onChange={(e) => set({ px: e.target.value })}
            disabled={!pair.data?.periodsX.length}
          >
            {[...(pair.data?.periodsX ?? [])].reverse().map((p) => (
              <option key={p} value={p}>
                {plx(p)}
              </option>
            ))}
          </select>
        </Field>
        <div className="flex items-end">
          <Button
            type="button"
            variant="outline"
            size="sm"
            aria-label="Swap X and Y"
            title="Swap X and Y"
            onClick={() =>
              set({
                x: my?.id,
                y: mx?.id,
                px: pair.data?.py ?? undefined,
                py: pair.data?.px ?? undefined,
              })
            }
          >
            <ArrowLeftRight className="size-3.5" aria-hidden />
          </Button>
        </div>
        <MetricSelect
          label="Metric Y (up)"
          metrics={metrics.filter((m) => m.id !== mx?.id)}
          value={my?.id}
          onChange={(id) => set({ y: id, py: undefined })}
        />
        <Field label="Period Y">
          <select
            className={controlClass}
            value={pair.data?.py ?? ""}
            onChange={(e) => set({ py: e.target.value })}
            disabled={!pair.data?.periodsY.length}
          >
            {[...(pair.data?.periodsY ?? [])].reverse().map((p) => (
              <option key={p} value={p}>
                {ply(p)}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <FixtureBanner
        on={
          fixturesOn && [mx?.id, my?.id].some((id) => catalog.data?.origin[id ?? ""] === "fixture")
        }
      />
      <CatalogNotice catalog={catalog.data} />
      <div className="grid items-start gap-3 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <ChartFrame
          title={
            mx && my ? `${my.label} against ${mx.label}, by ${words.one}` : "Two metrics compared"
          }
          unit={mx && my ? `${my.unit} against ${mx.unit}` : undefined}
          period={
            pair.data?.px && pair.data.py
              ? pair.data.px === pair.data.py
                ? plx(pair.data.px)
                : `X ${plx(pair.data.px)}, Y ${ply(pair.data.py)}`
              : undefined
          }
          sources={sources}
          status={status}
          headingLevel="h2"
          minHeight={360}
          actions={
            <Segmented
              label="Axis scale"
              value={logX && logY ? "xy" : logX ? "x" : logY ? "y" : "linear"}
              onChange={(v) => set({ log: v === "linear" ? undefined : (v as "x" | "y" | "xy") })}
              options={[
                { id: "linear", label: "Linear" },
                {
                  id: "x",
                  label: "Log X",
                  disabled: !logOk("x"),
                  title: logOk("x") ? undefined : "Needs every X value above zero",
                },
                {
                  id: "y",
                  label: "Log Y",
                  disabled: !logOk("y"),
                  title: logOk("y") ? undefined : "Needs every Y value above zero",
                },
                { id: "xy", label: "Log both", disabled: !logOk("x") || !logOk("y") },
              ]}
            />
          }
          notes={[
            "Each dot is one entity with a value for both metrics; entities missing either value are left out (n counts only the pairs drawn).",
            "The dashed line is the least-squares fit on the scale shown. Pearson r measures a straight-line association; Spearman ρ measures whether the ranks move together and is less sensitive to a few extreme values.",
            "An association across groups (states, MDLs) says nothing about the people or cases within them, and does not show that one measure causes the other. Rates have different denominators; read each metric's notes.",
            ...(mx?.denominator ? [`X denominator: ${mx.denominator}.`] : []),
            ...(my?.denominator ? [`Y denominator: ${my.denominator}.`] : []),
          ]}
          table={{
            caption: "Paired values",
            columns: [
              { label: words.one[0]!.toUpperCase() + words.one.slice(1) },
              { label: mx?.label ?? "X", align: "right" },
              { label: my?.label ?? "Y", align: "right" },
            ],
            rows: [...points]
              .sort((a, b) => a.label.localeCompare(b.label))
              .map((p) => ({ key: p.id, cells: [p.label, fx.full(p.x), fy.full(p.y)] })),
          }}
        >
          <ScatterCorrelation
            points={points}
            xFormatter={fx}
            yFormatter={fy}
            xLabel={mx?.label ?? "X"}
            yLabel={my?.label ?? "Y"}
            ariaLabel={`${my?.label} against ${mx?.label}`}
            logX={logX}
            logY={logY}
            selected={search.sel ?? null}
            onSelect={(id) => set({ sel: id === search.sel ? undefined : id })}
            height={380}
          />
        </ChartFrame>
        <div className="space-y-3">
          {status.kind === "ready" ? (
            <StatsBox
              stats={stats}
              entityNoun={words.many}
              adjusted={
                currentIdx >= 0 && session.length > 1
                  ? { q: qValues[currentIdx]!, m: session.length }
                  : null
              }
            />
          ) : null}
          <SessionList
            session={session}
            qValues={qValues}
            currentKey={currentKey}
            onClear={() => {
              setSession([]);
              writeSession([]);
            }}
            onOpen={(e) => set({ type: e.type, x: e.x, y: e.y, px: e.px, py: e.py })}
          />
        </div>
      </div>
      {status.kind === "ready" && stats.fit && !logX && !logY ? (
        <ChartFrame
          title={`Distance from the fitted line: ${my?.label}`}
          unit={my?.unit}
          period={pair.data?.py ? ply(pair.data.py) : undefined}
          sources={sources}
          status={{ kind: "ready" }}
          headingLevel="h2"
          notes={[
            "Actual value minus the value on the fitted line for the entity's X. Blue: above the line; orange: below it.",
            "A large distance means the straight line describes that entity poorly; it is not a finding about why.",
          ]}
        >
          <RankedBars
            items={residualItems}
            formatter={{
              ...fy,
              full: (v) => (v === null || v === undefined ? "Not recorded" : fy.delta(v)),
            }}
            ariaLabel="Distance from the fitted line"
            diverging
            limit={20}
            highlight={search.sel ?? null}
          />
        </ChartFrame>
      ) : null}
      {mx ? (
        <Screen
          x={mx}
          metrics={metrics}
          type={type}
          period={pair.data?.px ?? null}
          onPlot={(id) => set({ y: id, py: undefined })}
        />
      ) : null}
    </div>
  );
}

function SessionList({
  session,
  qValues,
  currentKey,
  onClear,
  onOpen,
}: {
  session: SessionEntry[];
  qValues: number[];
  currentKey: string | null;
  onClear: () => void;
  onOpen: (e: SessionEntry) => void;
}) {
  return (
    <section aria-labelledby="session-title" className="rounded-md border border-border bg-surface">
      <header className="flex items-center justify-between gap-2 border-b border-border/70 px-3 py-2">
        <h2 id="session-title" className="text-xs font-semibold">
          Comparisons in this tab ({session.length})
        </h2>
        {session.length ? (
          <button
            type="button"
            onClick={onClear}
            className="inline-flex items-center gap-1 rounded text-[11px] text-primary hover:underline focus-visible:outline-2 focus-visible:outline-ring"
          >
            <Trash2 className="size-3" aria-hidden />
            Clear
          </button>
        ) : null}
      </header>
      {session.length ? (
        <ol className="max-h-64 divide-y divide-border/60 overflow-auto text-[11px] leading-4">
          {session.map((e, i) => (
            <li key={e.key} className={e.key === currentKey ? "bg-accent/60" : undefined}>
              <button
                type="button"
                onClick={() => onOpen(e)}
                className="w-full px-3 py-1.5 text-left hover:bg-accent focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
              >
                <span
                  className="block truncate font-medium"
                  title={`${e.yLabel} against ${e.xLabel}`}
                >
                  {e.yLabel} × {e.xLabel}
                </span>
                <span className="text-muted-foreground tabular-nums">
                  ρ = {e.rho.toFixed(2)}, {formatP(e.p)}, q ={" "}
                  {qValues[i]! < 0.001 ? "< 0.001" : qValues[i]!.toFixed(3)}, n = {e.n}
                </span>
              </button>
            </li>
          ))}
        </ol>
      ) : (
        <p className="px-3 py-2 text-[11px] text-muted-foreground">
          Each pair you look at is listed here.
        </p>
      )}
      <p className="border-t border-border/70 px-3 py-1.5 text-[11px] leading-4 text-muted-foreground">
        The more pairs you look at, the more will look related by chance. q is the
        Benjamini–Hochberg adjusted p-value across every comparison in this list (Spearman). Kept in
        this browser tab only.
      </p>
    </section>
  );
}

type ScreenRow = {
  metric: MetricDef;
  period: string;
  n: number;
  rho: number;
  ci: [number, number] | null;
  p: number;
  q: number;
};

async function runScreen(
  x: MetricDef,
  metrics: readonly MetricDef[],
  type: EntityType,
  period: string,
) {
  const base = await loadSnapshot(x, type, period);
  const xv = new Map(
    base.filter((f) => f.value !== null).map((f) => [f.entityId, f.value as number] as const),
  );
  const others = metrics.filter((m) => m.id !== x.id);
  const results: { metric: MetricDef; period: string; facts: Fact[] }[] = [];
  for (let i = 0; i < others.length; i += 6) {
    const chunk = others.slice(i, i + 6);
    const got = await Promise.all(
      chunk.map(async (m) => {
        const periods = await loadPeriods(m, type);
        const p = periods.includes(period) ? period : await defaultPeriod(m, type);
        return p ? { metric: m, period: p, facts: await loadSnapshot(m, type, p) } : null;
      }),
    );
    for (const g of got) if (g) results.push(g);
  }
  const rows = results.flatMap((r) => {
    const xs: number[] = [];
    const ys: number[] = [];
    for (const f of r.facts) {
      const a = xv.get(f.entityId);
      if (a !== undefined && f.value !== null) {
        xs.push(a);
        ys.push(f.value);
      }
    }
    const t = correlationTest(xs, ys, "spearman");
    return t
      ? [{ metric: r.metric, period: r.period, n: t.n, rho: t.coefficient, ci: t.ci, p: t.p }]
      : [];
  });
  const q = benjaminiHochberg(rows.map((r) => r.p));
  const screened: ScreenRow[] = rows
    .map((r, i) => ({ ...r, q: q[i]! }))
    .sort(
      (a, b) => Math.abs(b.rho) - Math.abs(a.rho) || a.metric.label.localeCompare(b.metric.label),
    );
  // matrix of X and the eight strongest
  const top = [x, ...screened.slice(0, 7).map((s) => s.metric)];
  const vals = new Map<string, Map<string, number>>();
  vals.set(x.id, xv);
  for (const r of results)
    vals.set(
      r.metric.id,
      new Map(
        r.facts
          .filter((f) => f.value !== null)
          .map((f) => [f.entityId, f.value as number] as const),
      ),
    );
  const matrix = new Map<string, number | null>();
  for (const a of top)
    for (const b of top) {
      const va = vals.get(a.id)!;
      const vb = vals.get(b.id)!;
      const ks = [...va.keys()].filter((k) => vb.has(k));
      matrix.set(
        `${a.id}|${b.id}`,
        a.id === b.id
          ? 1
          : spearman(
              ks.map((k) => va.get(k)!),
              ks.map((k) => vb.get(k)!),
            ),
      );
    }
  return { screened, top, matrix };
}

function Screen({
  x,
  metrics,
  type,
  period,
  onPlot,
}: {
  x: MetricDef;
  metrics: readonly MetricDef[];
  type: EntityType;
  period: string | null;
  onPlot: (id: string) => void;
}) {
  const [run, setRun] = useState(false);
  const q = useQuery({
    queryKey: ["insights", "screen", x.id, type, period ?? ""],
    queryFn: () => runScreen(x, metrics, type, period!),
    enabled: run && !!period,
    staleTime: 10 * 60 * 1000,
  });
  const words = ENTITY_LABEL[type];
  return (
    <ChartFrame
      title={`${x.label} against every other ${words.one} metric`}
      unit="Spearman ρ"
      period={
        period
          ? `X: ${periodLabel(period, x.periodType)}; each other metric in the same period, or its latest complete one`
          : undefined
      }
      sources={x.sourceLinks}
      status={
        !run
          ? { kind: "ready" }
          : q.isPending
            ? { kind: "loading" }
            : q.isError
              ? { kind: "error", onRetry: () => void q.refetch() }
              : { kind: "ready" }
      }
      headingLevel="h2"
      notes={[
        `Spearman rank correlation of ${x.label} with each other metric across ${words.many} that record both. q adjusts every p-value for the number of metrics screened (Benjamini–Hochberg); only q below 0.05 is worth a second look.`,
        "Screening many metrics finds some strong-looking associations by chance, and an association across groups says nothing about cause or about individuals.",
      ]}
      table={
        q.data
          ? {
              caption: "Screen results",
              columns: [
                { label: "Metric" },
                { label: "Period", align: "right" },
                { label: "n", align: "right" },
                { label: "ρ (95% CI)", align: "right" },
                { label: "p", align: "right" },
                { label: "q", align: "right" },
              ],
              rows: q.data.screened.map((r) => ({
                key: r.metric.id,
                cells: [
                  r.metric.label,
                  periodLabel(r.period, r.metric.periodType),
                  String(r.n),
                  `${r.rho.toFixed(2)}${r.ci ? ` (${r.ci[0].toFixed(2)} to ${r.ci[1].toFixed(2)})` : ""}`,
                  formatP(r.p).replace(/^p = /, ""),
                  r.q < 0.001 ? "< 0.001" : r.q.toFixed(3),
                ],
              })),
            }
          : undefined
      }
    >
      {!run ? (
        <div className="space-y-2 pb-2 text-xs text-muted-foreground">
          <p>
            Compute the rank correlation of {x.label} with each of the{" "}
            {Math.max(0, metrics.length - 1)} other metrics published for {words.many}, with
            multiple-comparison control.
          </p>
          <Button type="button" size="sm" onClick={() => setRun(true)} disabled={!period}>
            Run the screen
          </Button>
        </div>
      ) : q.data ? (
        <div className="space-y-3 pb-2">
          <ol className="divide-y divide-border/60 rounded border border-border/70 text-xs">
            {q.data.screened.slice(0, 12).map((r) => (
              <li
                key={r.metric.id}
                className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 px-2 py-1.5"
              >
                <span className="min-w-0 flex-1">{r.metric.label}</span>
                <span className="tabular-nums">ρ {r.rho.toFixed(2)}</span>
                <span className="tabular-nums text-muted-foreground">n {r.n}</span>
                <span
                  className={
                    r.q < 0.05 ? "tabular-nums font-medium" : "tabular-nums text-muted-foreground"
                  }
                >
                  q {r.q < 0.001 ? "< 0.001" : r.q.toFixed(3)}
                </span>
                <button
                  type="button"
                  onClick={() => onPlot(r.metric.id)}
                  className="rounded text-primary hover:underline focus-visible:outline-2 focus-visible:outline-ring"
                >
                  Plot
                </button>
              </li>
            ))}
          </ol>
          {q.data.top.length > 2 ? (
            <div>
              <p className="mb-1 text-xs font-medium">
                Rank correlations among {x.label} and the seven strongest
              </p>
              <Heatmap
                rows={q.data.top.map((m) => ({
                  id: m.id,
                  label: m.label.length > 34 ? `${m.label.slice(0, 33)}…` : m.label,
                }))}
                columns={q.data.top.map((m, i) => ({ id: m.id, label: String(i + 1) }))}
                value={(r, c) => q.data!.matrix.get(`${r}|${c}`) ?? null}
                formatter={{
                  full: (v) =>
                    v === null || v === undefined ? "Not recorded" : `ρ ${v.toFixed(2)}`,
                  tick: (v) => v.toFixed(2),
                  delta: (d) => d.toFixed(2),
                }}
                ariaLabel="Correlation matrix"
                scale="diverging"
                domain={[-1, 1]}
                cellLabels
                cellHeight={22}
              />
              <p className="pt-1 text-[11px] text-muted-foreground">
                Columns are numbered in the order of the rows.
              </p>
            </div>
          ) : null}
        </div>
      ) : null}
    </ChartFrame>
  );
}
