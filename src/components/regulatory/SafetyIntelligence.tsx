import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Bar, BarChart, ResponsiveContainer, Tooltip } from "recharts";
import { ChevronDown, Info, Radar, Search, ShieldAlert } from "lucide-react";
import { AgencyMark } from "@/components/corpus/EntityArtwork";
import { Input } from "@/components/ui/input";
import {
  getSafetyIntelligence,
  INSIGHT_AGENCIES,
  INSIGHT_KINDS,
  type InsightAgency,
  type InsightSeverity,
  type SafetyInsight,
} from "@/lib/external/safetyInsights.functions";
import { communityCourtArtwork } from "@/lib/visuals/registry";
import { cn } from "@/lib/utils";
import {
  AGENCY_NAME,
  countBy,
  EMPTY_FILTER,
  evidenceParams,
  filterInsights,
  KIND_LABEL,
  metricLine,
  risingThemes,
  SEVERITY_LABEL,
  type InsightFilter,
} from "./insightView";

export const safetyIntelligenceQuery = {
  queryKey: ["safety-intelligence"],
  queryFn: () => getSafetyIntelligence(),
  staleTime: 10 * 60 * 1000,
};

const SEVERITY_STYLE: Record<InsightSeverity, string> = {
  high: "border-destructive/30 bg-destructive/10 text-destructive",
  elevated: "border-warning/40 bg-warning/15 text-warning-foreground",
  watch: "border-border bg-muted text-muted-foreground",
};
const SEVERITY_BAR: Record<InsightSeverity, string> = {
  high: "var(--destructive)",
  elevated: "var(--warning)",
  watch: "var(--muted-foreground)",
};
const AGENCIES: readonly InsightAgency[] = INSIGHT_AGENCIES;
const PAGE = 12;

function Mark({ agency, className }: { agency: InsightAgency; className?: string | undefined }) {
  if (agency === "JPML") {
    const seal = communityCourtArtwork("jpml", "federal");
    if (seal)
      return (
        <img
          src={seal.path}
          alt="Judicial Panel on Multidistrict Litigation seal"
          title={`${seal.name} · ${seal.license}`}
          className={cn(
            "size-10 shrink-0 rounded-lg border border-border bg-white p-1 object-contain",
            className,
          )}
          loading="lazy"
        />
      );
  }
  return <AgencyMark name={AGENCY_NAME[agency]} className={className} />;
}

function Sparkline({ insight }: { insight: SafetyInsight }) {
  if (insight.series.length < 3) return null;
  const color = SEVERITY_BAR[insight.severity];
  return (
    <div className="h-9 w-28 shrink-0" aria-hidden="true">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={insight.series} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
          <Tooltip
            cursor={{ fill: "var(--muted)" }}
            contentStyle={{ fontSize: 11, padding: "2px 6px" }}
            labelFormatter={(_, p) => String(p?.[0]?.payload?.period ?? "")}
            formatter={(v) => [Number(v).toLocaleString("en-US"), "count"]}
          />
          <Bar dataKey="count" fill={color} radius={[1, 1, 0, 0]} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function InsightCard({ insight }: { insight: SafetyInsight }) {
  const [open, setOpen] = useState(false);
  const detailId = `insight-${insight.id}`;
  return (
    <li className="rounded-xl border border-border bg-card shadow-xs">
      <div className="flex items-start gap-3 p-3">
        <Mark agency={insight.agency} className="size-9" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
            <span
              className={cn(
                "rounded border px-1.5 py-px font-medium",
                SEVERITY_STYLE[insight.severity],
              )}
            >
              {SEVERITY_LABEL[insight.severity]}
            </span>
            <span className="font-medium text-foreground">{KIND_LABEL[insight.kind]}</span>
            <span className="text-muted-foreground">· {insight.agency}</span>
            {insight.serious ? (
              <span className="inline-flex items-center gap-0.5 text-destructive">
                <ShieldAlert className="size-3" aria-hidden="true" />
                Serious-harm indicator
              </span>
            ) : null}
          </div>
          <h3 className="mt-1 text-[13.5px] font-semibold leading-snug">{insight.headline}</h3>
          {/* Clamped while collapsed (full text on hover); the whole summary shows once opened. */}
          <p
            className={cn(
              "mt-0.5 break-words text-xs leading-relaxed text-muted-foreground",
              !open && "line-clamp-2",
            )}
            title={open ? undefined : insight.summary}
          >
            {insight.summary}
          </p>
          <p className="mt-1 font-mono text-[11px] text-foreground/80">{metricLine(insight)}</p>
        </div>
        <div className="hidden flex-col items-end gap-1 sm:flex">
          <Sparkline insight={insight} />
          <span className="text-[11px] text-muted-foreground" title="Detector score, 0–100">
            Score{" "}
            <span className="font-mono font-semibold text-foreground">
              {Math.round(insight.score)}
            </span>
          </span>
        </div>
      </div>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={detailId}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-1 border-t border-border/70 px-3 py-1.5 text-left text-[11px] text-muted-foreground hover:bg-muted/50 focus-visible:outline-2 focus-visible:outline-ring"
      >
        <ChevronDown
          className={cn("size-3.5 transition-transform", open && "rotate-180")}
          aria-hidden="true"
        />
        Evidence ({insight.evidence.length}) and method · as of {insight.asOf}
      </button>
      {open ? (
        <div id={detailId} className="space-y-2 border-t border-border/70 px-3 py-2 text-xs">
          {insight.evidence.length ? (
            <ul className="space-y-1">
              {insight.evidence.map((e) => (
                <li key={`${e.dataset}:${e.id}`} className="flex gap-2">
                  <span className="w-20 shrink-0 font-mono text-[11px] text-muted-foreground">
                    {e.date ?? "—"}
                  </span>
                  <span className="min-w-0">
                    {e.dataset === "mdl_analytics" && /^\d+$/.test(e.id) ? (
                      <Link
                        to="/matters/lens/$mdl"
                        params={{ mdl: e.id }}
                        className="font-medium text-primary hover:underline"
                      >
                        {e.title} · case lens
                      </Link>
                    ) : (
                      <Link
                        to="/records/$dataset/$id"
                        params={evidenceParams(e)}
                        className="font-medium text-primary hover:underline"
                      >
                        {e.title}
                      </Link>
                    )}
                    {e.note ? (
                      <span className="block break-words text-muted-foreground">{e.note}</span>
                    ) : null}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-muted-foreground">No linked records were stored for this flag.</p>
          )}
          <p className="text-muted-foreground">
            <span className="font-medium text-foreground">Method.</span> {insight.method}
          </p>
        </div>
      ) : null}
    </li>
  );
}

function Tile({
  label,
  value,
  active,
  onClick,
  tone,
}: {
  label: string;
  value: number;
  active: boolean;
  onClick: () => void;
  tone: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "flex flex-col items-start rounded-lg border bg-surface px-3 py-2 text-left transition-colors hover:bg-muted/40 focus-visible:outline-2 focus-visible:outline-ring",
        active ? "border-primary ring-1 ring-primary/30" : "border-border",
      )}
    >
      <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <span className="size-2 rounded-full" style={{ background: tone }} aria-hidden="true" />
        {label}
      </span>
      <span className="font-mono text-xl font-semibold leading-tight">
        {value.toLocaleString("en-US")}
      </span>
    </button>
  );
}

function SignalMix({
  insights,
  onPick,
  active,
}: {
  insights: SafetyInsight[];
  onPick: (k: string) => void;
  active: string;
}) {
  const rows = INSIGHT_KINDS.map((kind) => {
    const items = insights.filter((i) => i.kind === kind);
    return {
      kind,
      high: items.filter((i) => i.severity === "high").length,
      elevated: items.filter((i) => i.severity === "elevated").length,
      watch: items.filter((i) => i.severity === "watch").length,
      total: items.length,
    };
  }).filter((r) => r.total > 0);
  const max = Math.max(1, ...rows.map((r) => r.total));
  return (
    <section className="rounded-xl border border-border bg-card shadow-xs p-3" aria-label="Signal mix">
      <h3 className="text-[12px] font-semibold">Signal mix</h3>
      <ul className="mt-2 space-y-1.5">
        {rows.map((r) => (
          <li key={r.kind}>
            <button
              type="button"
              onClick={() => onPick(active === r.kind ? "" : r.kind)}
              aria-pressed={active === r.kind}
              className={cn(
                "w-full rounded px-1 py-0.5 text-left hover:bg-muted/50 focus-visible:outline-2 focus-visible:outline-ring",
                active === r.kind && "bg-muted",
              )}
            >
              <span className="flex justify-between text-[11px]">
                <span>{KIND_LABEL[r.kind]}</span>
                <span className="font-mono text-muted-foreground">{r.total}</span>
              </span>
              <span
                className="mt-0.5 flex h-1.5 overflow-hidden rounded-full bg-muted"
                style={{ width: `${(r.total / max) * 100}%` }}
              >
                {(["high", "elevated", "watch"] as const).map((s) =>
                  r[s] ? (
                    <span key={s} style={{ flex: r[s], background: SEVERITY_BAR[s] }} />
                  ) : null,
                )}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function RisingThemes({ insights }: { insights: SafetyInsight[] }) {
  const themes = risingThemes(insights);
  if (!themes.length) return null;
  const max = Math.max(...themes.map((t) => t.metric.ratio ?? 0), 1);
  return (
    <section
      className="rounded-xl border border-border bg-card shadow-xs p-3"
      aria-label="Fastest-rising hazard themes"
    >
      <h3 className="text-[12px] font-semibold">Fastest-rising hazard themes</h3>
      <p className="text-[11px] text-muted-foreground">
        Last 12 months against the prior three-year annual rate.
      </p>
      <ul className="mt-2 space-y-1.5">
        {themes.map((t) => (
          <li key={t.id} className="text-[11px]">
            <span className="flex justify-between gap-2">
              <span className="truncate" title={t.entity}>
                {t.entity.split(" · ").pop()}
              </span>
              <span className="shrink-0 font-mono">{(t.metric.ratio ?? 0).toFixed(1)}×</span>
            </span>
            <span className="mt-0.5 block h-1.5 rounded-full bg-muted">
              <span
                className="block h-full rounded-full"
                style={{
                  width: `${((t.metric.ratio ?? 0) / max) * 100}%`,
                  background: SEVERITY_BAR[t.severity],
                }}
              />
            </span>
            <span className="text-muted-foreground">
              {t.entity.split(" · ")[0]} · {t.metric.recent} {t.metric.unit}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function SafetyIntelligence() {
  const q = useQuery(safetyIntelligenceQuery);
  const [filter, setFilter] = useState<InsightFilter>(EMPTY_FILTER);
  const [shown, setShown] = useState(PAGE);
  const all = useMemo(() => q.data?.insights ?? [], [q.data]);
  const rows = useMemo(() => filterInsights(all, filter), [all, filter]);
  const set = (patch: Partial<InsightFilter>) => {
    setFilter((f) => ({ ...f, ...patch }));
    setShown(PAGE);
  };

  if (q.isLoading)
    return (
      <div className="space-y-2" aria-busy="true" aria-label="Loading safety intelligence">
        <div className="h-16 animate-pulse rounded-lg border border-border bg-muted/50" />
        <div className="h-72 animate-pulse rounded-lg border border-border bg-muted/50" />
      </div>
    );
  if (q.isError)
    return (
      <p
        role="alert"
        className="rounded-lg border border-border px-4 py-4 text-sm text-destructive"
      >
        Safety intelligence could not be loaded. The agency collections below are still available.
      </p>
    );
  if (!all.length)
    return (
      <p className="rounded-lg border border-border px-4 py-4 text-sm text-muted-foreground">
        No automated safety flags have been published yet.
      </p>
    );

  const severity = countBy(all, (i) => i.severity);
  const agencies = countBy(all, (i) => i.agency);
  const serious = all.filter((i) => i.serious).length;
  const generated = q.data?.generatedAt ? new Date(q.data.generatedAt) : null;

  return (
    <section className="space-y-3" aria-labelledby="safety-intel-title">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 id="safety-intel-title" className="flex items-center gap-1.5 text-sm font-semibold">
            <Radar className="size-4 text-primary" aria-hidden="true" />
            Regulatory watch · automated flags
          </h2>
          <p className="text-xs text-muted-foreground">
            {all.length.toLocaleString("en-US")} trends and anomalies detected across agency safety,
            enforcement, rulemaking, court, MDL and SEC records
            {generated
              ? ` · generated ${generated.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`
              : ""}
            {" · rebuilt weekly"}
          </p>
        </div>
        <details className="relative text-xs">
          <summary className="flex cursor-pointer list-none items-center gap-1 rounded-md border border-border px-2 py-1 text-muted-foreground hover:bg-muted">
            <Info className="size-3.5" aria-hidden="true" />
            How flags are scored
          </summary>
          <div className="absolute right-0 z-20 mt-1 w-80 rounded-lg border border-border bg-popover p-3 text-[11.5px] leading-relaxed text-popover-foreground shadow-drawer">
            Each detector compares a recent window with the same source's own baseline (for example
            a firm's prior three-year recall rate) and scores how unlikely the recent count is.
            Scores run 0–100; High flags are strongly unusual or tied to serious-harm indicators
            such as Class I recalls or reported deaths. A flag is a lead to review, not a finding:
            open the evidence to see the underlying records.
          </div>
        </details>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {(["high", "elevated", "watch"] as const).map((s) => (
          <Tile
            key={s}
            label={SEVERITY_LABEL[s]}
            value={severity.get(s) ?? 0}
            tone={SEVERITY_BAR[s]}
            active={filter.severity === s}
            onClick={() => set({ severity: filter.severity === s ? "" : s })}
          />
        ))}
        <Tile
          label="Serious-harm indicators"
          value={serious}
          tone="var(--destructive)"
          active={filter.seriousOnly}
          onClick={() => set({ seriousOnly: !filter.seriousOnly })}
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div role="group" aria-label="Filter by agency" className="flex flex-wrap gap-1.5">
          <button
            type="button"
            aria-pressed={!filter.agency}
            onClick={() => set({ agency: "" })}
            className={cn(
              "rounded-md border px-2.5 py-1 text-xs",
              !filter.agency
                ? "border-primary bg-primary/10 text-primary"
                : "border-border hover:bg-muted",
            )}
          >
            All agencies
          </button>
          {AGENCIES.filter((a) => agencies.get(a)).map((a) => (
            <button
              key={a}
              type="button"
              aria-pressed={filter.agency === a}
              onClick={() => set({ agency: filter.agency === a ? "" : a })}
              className={cn(
                "flex items-center gap-1.5 rounded-md border py-0.5 pl-0.5 pr-2 text-xs",
                filter.agency === a
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border hover:bg-muted",
              )}
            >
              <Mark agency={a} className="size-6 rounded-md p-0.5" />
              {a}
              <span className="font-mono text-muted-foreground">{agencies.get(a)}</span>
            </button>
          ))}
        </div>
        <label className="relative ml-auto w-full sm:w-64">
          <span className="sr-only">Search flags</span>
          <Search
            className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            value={filter.query}
            onChange={(e) => set({ query: e.target.value })}
            placeholder="Search firm, product, hazard…"
            className="h-8 pl-7 text-xs"
          />
        </label>
      </div>

      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="min-w-0">
          {rows.length ? (
            <>
              <ol className="space-y-2" aria-label="Flagged trends, highest score first">
                {rows.slice(0, shown).map((i) => (
                  <InsightCard key={i.id} insight={i} />
                ))}
              </ol>
              <div className="mt-2 flex items-center gap-3 text-xs text-muted-foreground">
                <span>
                  Showing {Math.min(shown, rows.length)} of {rows.length}
                </span>
                {shown < rows.length ? (
                  <button
                    type="button"
                    onClick={() => setShown((n) => n + PAGE * 2)}
                    className="rounded-md border border-border px-2.5 py-1 text-foreground hover:bg-muted"
                  >
                    Show more
                  </button>
                ) : null}
              </div>
            </>
          ) : (
            <div className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
              No flags match these filters.{" "}
              <button
                type="button"
                className="text-primary underline"
                onClick={() => set(EMPTY_FILTER)}
              >
                Clear filters
              </button>
            </div>
          )}
        </div>
        <aside className="space-y-3">
          <SignalMix
            insights={all}
            active={filter.kind}
            onPick={(k) => set({ kind: k as InsightFilter["kind"] })}
          />
          <RisingThemes insights={all} />
        </aside>
      </div>
    </section>
  );
}
