import { useId, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight, ExternalLink } from "lucide-react";
import {
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { int } from "@/components/analysis/analysisFormat";
import { numTick } from "@/components/enforcement/listDisplay";
import {
  axisTick,
  Kpi,
  MoreToggle,
  Panel,
  Segmented,
  tooltipStyle,
} from "@/components/enforcement/parts";
import {
  Callout,
  KpiGrid,
  KpiSkeleton,
  QueryPanel,
} from "@/components/courts/collection/CollectionParts";
import { RhoMark } from "@/components/courts/collection/CollectionVisuals";
import { RankScatter } from "@/components/courts/firms/FirmVisuals";
import { FDA_COLORS } from "@/components/fda-analytics/chartView";
import type {
  AlignmentYear,
  CurrentTrend,
  Labelled,
  ScacStatistics,
} from "@/lib/external/scac.functions";
import { cn } from "@/lib/utils";
import { alignmentQuery, CREDIT, moneyShort, statisticsQuery } from "./scacQueries";

const BAR = FDA_COLORS[0]!;
const LINE = FDA_COLORS[2]!;
const STATUS_COLOR = [
  FDA_COLORS[5]!,
  FDA_COLORS[1]!,
  FDA_COLORS[3]!,
  FDA_COLORS[4]!,
  FDA_COLORS[2]!,
];

/** Federal securities class action filings from the public pages of Stanford's Securities Class Action Clearinghouse. */
export function SecuritiesPage() {
  return (
    <div className="space-y-4">
      <Callout>
        Figures from the public pages of the{" "}
        <strong>Stanford Securities Class Action Clearinghouse</strong> (with Cornerstone Research).
        SCAC counts one <strong>filing</strong> per underlying event, which can group several
        complaints. The Clearinghouse is restructuring and its data stop on{" "}
        <strong>28 July 2025</strong>, so 2025 is a partial year. Per-case pages need a SCAC account
        and are not read here. {CREDIT}
      </Callout>
      <Overview />
      <YearsPanel />
      <div className="grid gap-4 lg:grid-cols-2">
        <StatusPanel />
        <CircuitPanel />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <SectorPanel />
        <IndustryPanel />
      </div>
      <TrendsPanel />
      <TopTens />
      <AlignmentPanel />
    </div>
  );
}

function Overview() {
  const q = useQuery(statisticsQuery);
  if (q.isLoading) return <KpiSkeleton n={5} />;
  const s = q.data;
  if (!s || s.total == null) return null;
  const status = (label: string) => s.status.find((x) => x.label.toLowerCase().includes(label));
  const share = (n: number | undefined) =>
    n != null && s.total ? `${((100 * n) / s.total).toFixed(1)}% of filings` : undefined;
  const settled = status("settled");
  const dismissed = status("dismissed");
  const ongoing = status("ongoing");
  const key = (label: string) => s.keyStats.find((k) => k.label === label)?.value;
  return (
    <KpiGrid id="scac-kpis" label="Securities class action filings">
      <Kpi
        label="Filings, 1996 to July 2025"
        value={int(s.total)}
        note={`Most active court: ${key("Most Active District Court") ?? "Not recorded"}`}
      />
      <Kpi
        label="Settled"
        value={settled ? int(settled.filings) : "Not recorded"}
        note={share(settled?.filings)}
      />
      <Kpi
        label="Dismissed"
        value={dismissed ? int(dismissed.filings) : "Not recorded"}
        note={share(dismissed?.filings)}
      />
      <Kpi
        label="Ongoing when data stopped"
        value={ongoing ? int(ongoing.filings) : "Not recorded"}
        note={share(ongoing?.filings)}
      />
      <Kpi
        label="Total settlements"
        value={s.settlementsUsd != null ? moneyShort(s.settlementsUsd) : "Not recorded"}
        note={`${key("Total # of Defendants (Individual and Companies) sued") ?? "Not recorded"} defendants sued`}
      />
    </KpiGrid>
  );
}

// ------------------------------------------------------------------------------------------------ years

type Overlay = "nos850" | "vix" | "nasdaq";
const OVERLAY: Record<
  Overlay,
  { label: string; unit: string; get: (y: AlignmentYear) => number | null }
> = {
  nos850: {
    label: "FJC: securities cases marked class action (NOS 850, fiscal year)",
    unit: "cases",
    get: (y) => y.nos850ClassActions,
  },
  vix: { label: "VIX, annual mean of daily closes", unit: "index", get: (y) => y.vixMean },
  nasdaq: {
    label: "NASDAQ Composite, calendar-year return %",
    unit: "%",
    get: (y) => y.nasdaqReturn,
  },
};

function YearsPanel() {
  const q = useQuery(alignmentQuery);
  const [overlay, setOverlay] = useState<Overlay>("nos850");
  return (
    <Panel
      id="scac-years"
      title="Filings by year"
      subtitle="SCAC filings per calendar year, with a second series for context"
      actions={
        <Segmented
          label="Second series"
          value={overlay}
          options={[
            { id: "nos850", label: "Court class actions" },
            { id: "vix", label: "Volatility" },
            { id: "nasdaq", label: "NASDAQ return" },
          ]}
          onChange={setOverlay}
        />
      }
      footnote="2025 runs to 28 July and is drawn lighter. The FJC series counts federal civil cases under nature of suit 850 (securities, commodities, exchange) marked as class actions, by fiscal year (October to September); SCAC counts filings by calendar year. Market series: CBOE VIX and NASDAQ Composite via FRED."
    >
      <QueryPanel
        query={q}
        label="Loading filings by year"
        errorText="The yearly series could not be loaded."
        emptyText="No yearly series is recorded."
        isEmpty={(d) => !d.years.length}
      >
        {(d) => <YearsChart years={d.years} overlay={overlay} />}
      </QueryPanel>
    </Panel>
  );
}

function YearsChart({ years, overlay }: { years: AlignmentYear[]; overlay: Overlay }) {
  const o = OVERLAY[overlay];
  const data = years.map((y) => ({
    label: String(y.year),
    filings: y.filings,
    second: o.get(y),
    partial: y.partial,
  }));
  const peak = years.reduce((a, b) => (b.filings > a.filings ? b : a), years[0]!);
  return (
    <div>
      <ul className="flex flex-wrap items-center gap-x-3 gap-y-0.5 px-3 pt-2 text-[11px] text-muted-foreground">
        <li className="flex items-center gap-1.5">
          <span
            aria-hidden
            className="inline-block size-2.5 rounded-sm"
            style={{ background: BAR }}
          />
          SCAC filings
        </li>
        <li className="flex items-center gap-1.5">
          <span aria-hidden className="inline-block h-0.5 w-3" style={{ background: LINE }} />
          {o.label} (right axis)
        </li>
        <li>
          Peak: {peak.year} with {int(peak.filings)} filings
        </li>
      </ul>
      <div
        className="h-64 p-2"
        role="img"
        aria-label={`Bars of SCAC filings by year, ${years[0]?.year} to ${years.at(-1)?.year}, with a line of ${o.label}`}
      >
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 8, right: 4, left: 4, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
            <XAxis dataKey="label" tick={axisTick} interval="preserveStartEnd" minTickGap={14} />
            <YAxis
              yAxisId="l"
              tick={axisTick}
              tickFormatter={numTick}
              width={44}
              allowDecimals={false}
            />
            <YAxis
              yAxisId="r"
              orientation="right"
              tick={axisTick}
              tickFormatter={numTick}
              width={44}
            />
            <Tooltip
              cursor={{ fill: "var(--muted)", opacity: 0.5 }}
              content={(p) => {
                const row = p.payload?.[0]?.payload as (typeof data)[number] | undefined;
                if (!p.active || !row) return null;
                return (
                  <div
                    className="rounded-md border border-border bg-surface text-foreground shadow-sm"
                    style={tooltipStyle}
                  >
                    <p className="font-medium">
                      {row.label}
                      {row.partial ? " (to 28 July)" : ""}
                    </p>
                    <p className="flex gap-3">
                      <span className="text-muted-foreground">SCAC filings</span>
                      <span className="ml-auto font-mono">{int(row.filings)}</span>
                    </p>
                    <p className="flex gap-3">
                      <span className="text-muted-foreground">{o.label}</span>
                      <span className="ml-auto font-mono">
                        {row.second == null
                          ? "Not recorded"
                          : overlay === "nos850"
                            ? int(row.second)
                            : row.second.toFixed(1)}
                      </span>
                    </p>
                  </div>
                );
              }}
            />
            <Bar yAxisId="l" dataKey="filings" fill={BAR} isAnimationActive>
              {data.map((r) => (
                <Cell key={r.label} fillOpacity={r.partial ? 0.4 : 0.9} />
              ))}
            </Bar>
            <Line
              yAxisId="r"
              dataKey="second"
              stroke={LINE}
              strokeWidth={2}
              dot={{ r: 2 }}
              connectNulls={false}
              isAnimationActive
              animationDuration={600}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------------------------------------ lists

function Bars({
  rows,
  base,
  color = BAR,
  limit = 12,
  label,
  link,
}: {
  rows: Labelled[];
  base: number;
  color?: string;
  limit?: number;
  label: string;
  /** The court id a row links to, when the record names one. */
  link?: (r: Labelled) => string | null;
}) {
  const [all, setAll] = useState(false);
  const id = useId();
  const max = Math.max(...rows.map((r) => r.filings), 1);
  const shown = all ? rows : rows.slice(0, limit);
  return (
    <div className="p-3">
      <ol id={id} aria-label={label} className="m-0 grid list-none gap-1.5 p-0 text-xs">
        {shown.map((r) => {
          const l = link?.(r);
          return (
            <li
              key={r.label}
              className="grid grid-cols-[minmax(0,11rem)_minmax(0,1fr)_3.5rem_3rem] items-center gap-2"
            >
              <span className="truncate" title={r.label}>
                {l ? (
                  <Link
                    to="/courts/$id"
                    params={{ id: l }}
                    className="text-primary hover:underline"
                  >
                    {r.label}
                  </Link>
                ) : (
                  r.label
                )}
              </span>
              <span className="h-2.5 rounded-sm bg-muted" aria-hidden>
                <span
                  className="block h-2.5 rounded-sm motion-safe:transition-[width] motion-safe:duration-500"
                  style={{ width: `${(100 * r.filings) / max}%`, background: color }}
                />
              </span>
              <span className="text-right font-mono">{int(r.filings)}</span>
              <span className="text-right font-mono text-muted-foreground">
                {base ? `${((100 * r.filings) / base).toFixed(1)}%` : ""}
              </span>
            </li>
          );
        })}
      </ol>
      <MoreToggle
        total={rows.length}
        limit={limit}
        expanded={all}
        onToggle={() => setAll((v) => !v)}
        controls={id}
      />
    </div>
  );
}

function StatusPanel() {
  const q = useQuery(statisticsQuery);
  return (
    <Panel
      id="scac-status"
      title="How filings end"
      subtitle="Litigation status recorded by SCAC when its data stopped"
    >
      <QueryPanel
        query={q}
        label="Loading status"
        errorText="Status could not be loaded."
        emptyText="No status is recorded."
        isEmpty={(d) => !d.status.length}
      >
        {(d) => {
          const total = d.status.reduce((a, b) => a + b.filings, 0);
          return (
            <div className="space-y-3 p-3">
              <div
                className="flex h-5 w-full overflow-hidden rounded-sm"
                role="img"
                aria-label={d.status.map((s) => `${s.label} ${int(s.filings)}`).join(", ")}
              >
                {d.status.map((s, i) => (
                  <span
                    key={s.label}
                    className="block h-5"
                    style={{
                      width: `${(100 * s.filings) / total}%`,
                      background: STATUS_COLOR[i % STATUS_COLOR.length],
                    }}
                    title={`${s.label}: ${int(s.filings)}`}
                  />
                ))}
              </div>
              <ul className="m-0 grid list-none gap-1 p-0 text-xs sm:grid-cols-2">
                {d.status.map((s, i) => (
                  <li key={s.label} className="flex items-center gap-2">
                    <span
                      className="inline-block size-2.5 rounded-sm"
                      style={{ background: STATUS_COLOR[i % STATUS_COLOR.length] }}
                      aria-hidden
                    />
                    <span className="min-w-0 flex-1">{s.label}</span>
                    <span className="font-mono">{int(s.filings)}</span>
                    <span className="w-12 text-right font-mono text-muted-foreground">
                      {((100 * s.filings) / total).toFixed(1)}%
                    </span>
                  </li>
                ))}
              </ul>
              <p className="m-0 text-[11px] text-muted-foreground">
                Status as SCAC recorded it; a case ongoing in July 2025 may since have ended.
              </p>
            </div>
          );
        }}
      </QueryPanel>
    </Panel>
  );
}

function CircuitPanel() {
  const q = useQuery(statisticsQuery);
  return (
    <Panel
      id="scac-circuits"
      title="Where they are filed"
      subtitle="Filings by federal circuit, 1996 to July 2025"
    >
      <QueryPanel
        query={q}
        label="Loading circuits"
        errorText="Circuits could not be loaded."
        emptyText="No circuits are recorded."
        isEmpty={(d) => !d.circuits.length}
      >
        {(d) => (
          <Bars
            rows={d.circuits.map((c) => ({
              ...c,
              label: c.label === "D.C." ? "D.C. Circuit" : `${c.label} Circuit`,
            }))}
            base={d.total ?? 0}
            label="Filings by circuit"
            link={(r) => {
              const c = d.circuits.find(
                (x) => (x.label === "D.C." ? "D.C. Circuit" : `${x.label} Circuit`) === r.label,
              );
              return c?.courtId ?? null;
            }}
          />
        )}
      </QueryPanel>
    </Panel>
  );
}

function SectorPanel() {
  const q = useQuery(statisticsQuery);
  return (
    <Panel
      id="scac-sectors"
      title="Sectors sued"
      subtitle="Filings by the issuer's sector (filings with a recorded sector)"
    >
      <QueryPanel
        query={q}
        label="Loading sectors"
        errorText="Sectors could not be loaded."
        emptyText="No sectors are recorded."
        isEmpty={(d) => !d.sectors.length}
      >
        {(d) => (
          <Bars
            rows={d.sectors}
            base={d.sectors.reduce((a, b) => a + b.filings, 0)}
            color={FDA_COLORS[1]!}
            label="Filings by sector"
          />
        )}
      </QueryPanel>
    </Panel>
  );
}

function IndustryPanel() {
  const q = useQuery(statisticsQuery);
  const n = q.data?.industries.length;
  return (
    <Panel
      id="scac-industries"
      title="Industries sued"
      subtitle={`Filings by the issuer's industry${n ? ` (${n} industries)` : ""}`}
    >
      <QueryPanel
        query={q}
        label="Loading industries"
        errorText="Industries could not be loaded."
        emptyText="No industries are recorded."
        isEmpty={(d) => !d.industries.length}
      >
        {(d) => (
          <Bars
            rows={d.industries}
            base={d.industries.reduce((a, b) => a + b.filings, 0)}
            color={FDA_COLORS[3]!}
            label="Filings by industry"
          />
        )}
      </QueryPanel>
    </Panel>
  );
}

// ------------------------------------------------------------------------------------------------ trends

function TrendsPanel() {
  const q = useQuery(statisticsQuery);
  const [open, setOpen] = useState<string | null>(null);
  return (
    <Panel
      id="scac-trends"
      title="Litigation waves"
      subtitle="SCAC's current trends (with the filings its public page lists) and historical trends"
      footnote="Courts link to their pages only on an exact CourtListener name match. Case pages on securities.stanford.edu need a SCAC account."
    >
      <QueryPanel
        query={q}
        label="Loading trends"
        errorText="Trends could not be loaded."
        emptyText="No trends are recorded."
        isEmpty={(d) => !d.current.length && !d.historical.length}
      >
        {(d) => (
          <div className="grid gap-4 p-3 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
            <ul className="m-0 grid list-none gap-2 p-0 sm:grid-cols-2">
              {d.current.map((t) => (
                <TrendCard
                  key={t.name}
                  t={t}
                  open={open === t.name}
                  onToggle={() => setOpen(open === t.name ? null : t.name)}
                />
              ))}
            </ul>
            <section aria-label="Historical trends">
              <h4 className="m-0 mb-1 text-[11px] font-semibold">Historical trends</h4>
              <Bars
                rows={d.historical}
                base={0}
                color={FDA_COLORS[4]!}
                limit={10}
                label="Filings by historical trend"
              />
            </section>
            {open ? <TrendRows t={d.current.find((x) => x.name === open)!} /> : null}
          </div>
        )}
      </QueryPanel>
    </Panel>
  );
}

function TrendCard({
  t,
  open,
  onToggle,
}: {
  t: CurrentTrend;
  open: boolean;
  onToggle: () => void;
}) {
  const years = t.byYear.length
    ? Array.from(
        { length: t.byYear.at(-1)!.year - t.byYear[0]!.year + 1 },
        (_, i) => t.byYear[0]!.year + i,
      )
    : [];
  const by = new Map(t.byYear.map((y) => [y.year, y.filings]));
  const max = Math.max(...t.byYear.map((y) => y.filings), 1);
  const top = t.byCourt[0];
  return (
    <li
      className={cn(
        "rounded-md border border-border/70 bg-surface p-3",
        open && "ring-1 ring-primary/40",
      )}
    >
      <div className="flex items-baseline justify-between gap-2">
        <h4 className="m-0 text-xs font-semibold">{t.name}</h4>
        <span className="font-mono text-sm font-semibold">{int(t.filings)}</span>
      </div>
      <div
        className="mt-2 flex h-10 items-end gap-px"
        role="img"
        aria-label={`${t.name} filings by year: ${t.byYear.map((y) => `${y.year} ${y.filings}`).join(", ")}`}
      >
        {years.map((y) => (
          <span
            key={y}
            className="block flex-1 rounded-t-sm motion-safe:transition-[height] motion-safe:duration-500"
            style={{
              height: `${Math.max(4, (100 * (by.get(y) ?? 0)) / max)}%`,
              background: (by.get(y) ?? 0) ? FDA_COLORS[0] : "var(--muted)",
            }}
            title={`${y}: ${by.get(y) ?? 0}`}
          />
        ))}
      </div>
      <p className="m-0 mt-1 flex justify-between text-[10px] text-muted-foreground">
        <span>{years[0]}</span>
        <span>{years.at(-1)}</span>
      </p>
      <p className="m-0 mt-1 text-[11px] text-muted-foreground">
        {t.first ?? "?"} to {t.last ?? "?"}
        {top ? (
          <>
            {" · most in "}
            {top.courtId ? (
              <Link
                to="/courts/$id"
                params={{ id: top.courtId }}
                className="text-primary hover:underline"
              >
                {top.court}
              </Link>
            ) : (
              top.court
            )}{" "}
            ({top.filings})
          </>
        ) : null}
      </p>
      <button
        type="button"
        aria-expanded={open}
        onClick={onToggle}
        className="mt-1 inline-flex items-center gap-1 text-[11px] text-primary hover:underline focus-visible:outline-2 focus-visible:outline-ring"
      >
        <ChevronRight
          className={cn(
            "size-3 transition-transform motion-reduce:transition-none",
            open && "rotate-90",
          )}
          aria-hidden
        />
        {open ? "Hide filings" : `Show the ${t.rows.length} filings`}
      </button>
    </li>
  );
}

function TrendRows({ t }: { t: CurrentTrend }) {
  return (
    <section aria-label={`${t.name} filings`} className="lg:col-span-2">
      <h4 className="m-0 mb-1 text-[11px] font-semibold">
        {t.name}: {t.rows.length} filings listed on SCAC&rsquo;s public trend page
      </h4>
      <div className="max-h-96 overflow-auto rounded-md border border-border/70">
        <table className="w-full min-w-[40rem] text-xs">
          <caption className="sr-only">{t.name} filings</caption>
          <thead className="sticky top-0 bg-surface text-left text-[11px] text-muted-foreground">
            <tr>
              <th scope="col" className="px-2 py-1 font-medium">
                Filed
              </th>
              <th scope="col" className="px-2 py-1 font-medium">
                Filing
              </th>
              <th scope="col" className="px-2 py-1 font-medium">
                District court
              </th>
              <th scope="col" className="px-2 py-1 font-medium">
                Exchange · ticker
              </th>
              <th scope="col" className="px-2 py-1 font-medium">
                Sector
              </th>
            </tr>
          </thead>
          <tbody>
            {t.rows.map((r) => (
              <tr key={`${r.name}|${r.filed}`} className="border-t border-border/50">
                <td className="whitespace-nowrap px-2 py-1 font-mono">{r.filed ?? "—"}</td>
                <td className="px-2 py-1">
                  {r.name}
                  {r.casePage ? (
                    <a
                      href={r.casePage}
                      target="_blank"
                      rel="noreferrer"
                      className="ml-1 inline-flex text-muted-foreground hover:text-foreground"
                      title="SCAC case page (account required)"
                    >
                      <ExternalLink className="size-3" aria-label="SCAC case page" />
                    </a>
                  ) : null}
                </td>
                <td className="px-2 py-1">
                  {r.courtId ? (
                    <Link
                      to="/courts/$id"
                      params={{ id: r.courtId }}
                      className="text-primary hover:underline"
                    >
                      {r.court}
                    </Link>
                  ) : (
                    r.court
                  )}
                </td>
                <td className="px-2 py-1 text-muted-foreground">
                  {[r.exchange, r.ticker].filter(Boolean).join(" · ") || "—"}
                </td>
                <td className="px-2 py-1 text-muted-foreground">{r.sector ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// ------------------------------------------------------------------------------------------------ top tens

function TopTens() {
  const q = useQuery(statisticsQuery);
  const [tab, setTab] = useState<"settlements" | "durations" | "firms">("settlements");
  return (
    <Panel
      id="scac-top"
      title="Top tens"
      subtitle={
        tab === "settlements"
          ? "Largest settlements in cases filed since the PSLRA (1995), with fees and expenses"
          : tab === "durations"
            ? "Longest lawsuits, from the first identified filing to the last stage recorded"
            : "Plaintiff firms by filings as appointed lead counsel (or, without one, the firm on the latest operative complaint)"
      }
      actions={
        <Segmented
          label="Top ten list"
          value={tab}
          options={[
            { id: "settlements", label: "Settlements" },
            { id: "durations", label: "Longest" },
            { id: "firms", label: "Plaintiff firms" },
          ]}
          onChange={setTab}
        />
      }
    >
      <QueryPanel
        query={q}
        label="Loading top tens"
        errorText="The top tens could not be loaded."
        emptyText="No top tens are recorded."
        isEmpty={(d) => !d.settlements.length}
      >
        {(d) =>
          tab === "settlements" ? (
            <Settlements d={d} />
          ) : tab === "durations" ? (
            <Durations d={d} />
          ) : (
            <Firms d={d} />
          )
        }
      </QueryPanel>
    </Panel>
  );
}

function Settlements({ d }: { d: ScacStatistics }) {
  const max = Math.max(...d.settlements.map((s) => s.amountUsd ?? 0), 1);
  return (
    <ol className="m-0 grid list-none gap-1.5 p-3 text-xs">
      {d.settlements.map((s) => (
        <li
          key={s.rank}
          className="grid grid-cols-[1.5rem_minmax(0,14rem)_minmax(0,1fr)_7.5rem_6rem] items-center gap-2"
          title={s.stage ?? undefined}
        >
          <span className="text-right font-mono text-muted-foreground">{s.rank}</span>
          <span className="truncate">{s.entity}</span>
          <span className="flex h-3 overflow-hidden rounded-sm bg-muted" aria-hidden>
            <span
              className="block h-3"
              style={{
                width: `${(100 * ((s.amountUsd ?? 0) - (s.feesUsd ?? 0))) / max}%`,
                background: FDA_COLORS[1],
              }}
            />
            <span
              className="block h-3"
              style={{ width: `${(100 * (s.feesUsd ?? 0)) / max}%`, background: FDA_COLORS[2] }}
            />
          </span>
          <span className="whitespace-nowrap text-right font-mono">
            {s.amountUsd != null ? moneyShort(s.amountUsd) : "—"}
          </span>
          <span className="text-right font-mono text-muted-foreground">
            {s.amountUsd && s.feesUsd != null
              ? `fees ${((100 * s.feesUsd) / s.amountUsd).toFixed(1)}%`
              : "—"}
          </span>
        </li>
      ))}
      <li className="mt-1 flex gap-3 text-[11px] text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          <span
            className="inline-block size-2.5 rounded-sm"
            style={{ background: FDA_COLORS[1] }}
            aria-hidden
          />
          Settlement net of fees and expenses
        </span>
        <span className="inline-flex items-center gap-1">
          <span
            className="inline-block size-2.5 rounded-sm"
            style={{ background: FDA_COLORS[2] }}
            aria-hidden
          />
          Fees and expenses awarded
        </span>
      </li>
    </ol>
  );
}

function Durations({ d }: { d: ScacStatistics }) {
  const max = Math.max(...d.durations.map((s) => s.days ?? 0), 1);
  return (
    <ol className="m-0 grid list-none gap-1.5 p-3 text-xs">
      {d.durations.map((s) => (
        <li
          key={s.rank}
          className="grid grid-cols-[1.5rem_minmax(0,14rem)_minmax(0,1fr)_5rem_9rem] items-center gap-2"
          title={s.stage ?? undefined}
        >
          <span className="text-right font-mono text-muted-foreground">{s.rank}</span>
          <span className="truncate">{s.entity}</span>
          <span className="h-2.5 rounded-sm bg-muted" aria-hidden>
            <span
              className="block h-2.5 rounded-sm"
              style={{ width: `${(100 * (s.days ?? 0)) / max}%`, background: FDA_COLORS[4] }}
            />
          </span>
          <span className="text-right font-mono">
            {s.days != null ? `${(s.days / 365.25).toFixed(1)} yrs` : "—"}
          </span>
          <span className="text-right font-mono text-muted-foreground">
            {s.filed?.slice(0, 4) ?? "?"}–{s.lastStage?.slice(0, 4) ?? "?"}
          </span>
        </li>
      ))}
    </ol>
  );
}

function Firms({ d }: { d: ScacStatistics }) {
  const max = Math.max(...d.firms.map((s) => s.filings ?? 0), 1);
  return (
    <div className="p-3">
      <ol className="m-0 grid list-none gap-1.5 p-0 text-xs">
        {d.firms.map((s) => (
          <li
            key={s.rank}
            className="grid grid-cols-[1.5rem_minmax(0,16rem)_minmax(0,1fr)_3.5rem_12rem] items-center gap-2"
          >
            <span className="text-right font-mono text-muted-foreground">{s.rank}</span>
            <span className="truncate" title={s.entity}>
              {s.entity}
            </span>
            <span className="h-2.5 rounded-sm bg-muted" aria-hidden>
              <span
                className="block h-2.5 rounded-sm"
                style={{ width: `${(100 * (s.filings ?? 0)) / max}%`, background: FDA_COLORS[1] }}
              />
            </span>
            <span className="text-right font-mono">{s.filings != null ? int(s.filings) : "—"}</span>
            <span className="truncate text-[11px] text-muted-foreground">
              {s.mdlProfile && s.mdl ? (
                <Link
                  to="/records/$dataset/$id"
                  params={{ dataset: "firm_profiles", id: s.mdlProfile }}
                  className="text-primary hover:underline"
                >
                  Same name on {s.mdl.mdls} MDL master docket{s.mdl.mdls === 1 ? "" : "s"}
                </Link>
              ) : (
                "No MDL master-docket match"
              )}
            </span>
          </li>
        ))}
      </ol>
      <p className="m-0 mt-2 text-[11px] text-muted-foreground">
        The MDL column matches the firm name, after the stated normalisation, against the law firms
        on MDL master dockets (
        <Link to="/courts/firms" className="text-primary hover:underline">
          Law firms
        </Link>
        ). A matching name is not a verified identity.
      </p>
    </div>
  );
}

// ------------------------------------------------------------------------------------------------ alignment

function AlignmentPanel() {
  const q = useQuery(alignmentQuery);
  return (
    <Panel
      id="scac-alignment"
      title="Do filings track markets or the courts?"
      subtitle="Spearman rank correlations of yearly SCAC filings (1996–2024) with market and court series, 95% intervals"
      footnote="Each point is a year, placed by rank. 'Previous year' compares filings with the series one year earlier. An interval that crosses zero leaves the direction unsettled over these years. These are associations across years; they do not show cause, and a few spike years (2001's 498 filings) weigh heavily."
    >
      <QueryPanel
        query={q}
        label="Loading correlations"
        errorText="The correlations could not be loaded."
        emptyText="No correlations are recorded."
        isEmpty={(d) => !d.correlations.length}
      >
        {(d) => (
          <ul className="m-0 grid list-none gap-2 p-3 sm:grid-cols-2 xl:grid-cols-3">
            {d.correlations.map((c) => (
              <li
                key={c.id}
                className="flex min-w-0 gap-3 rounded-md border border-border/70 bg-surface p-3"
              >
                <RankScatter
                  points={c.points.map((p) => ({ key: p.year, x: p.x, y: p.y }))}
                  xLabel="SCAC filings"
                  yLabel={c.label}
                  label={`Scatter: SCAC filings and ${c.label}`}
                  pointName={(k) => String(k)}
                  format={(v) => (Number.isInteger(v) ? int(v) : v.toFixed(1))}
                />
                <div className="min-w-0 text-xs">
                  <p className="m-0 font-medium leading-snug">{c.label}</p>
                  <p className="m-0 mt-1 font-mono">
                    ρ {c.rho >= 0 ? "+" : ""}
                    {c.rho.toFixed(2)}{" "}
                    <span className="text-muted-foreground">
                      [{c.low.toFixed(2)}, {c.high.toFixed(2)}] · n {c.n}
                    </span>
                  </p>
                  <RhoMark
                    rho={c.rho}
                    low={c.low}
                    high={c.high}
                    label={`Correlation ${c.rho.toFixed(2)}, interval ${c.low.toFixed(2)} to ${c.high.toFixed(2)}`}
                  />
                  <p className="m-0 text-[11px] text-muted-foreground">{c.strength ?? ""}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </QueryPanel>
    </Panel>
  );
}
