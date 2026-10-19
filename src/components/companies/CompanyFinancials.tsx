import { useEffect, useMemo, useRef } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Download } from "lucide-react";
import { ChartCard, ChartUnavailable } from "@/components/fda-analytics/FdaCharts";
import { FDA_COLORS } from "@/components/fda-analytics/chartView";
import { Panel } from "@/components/enforcement/parts";
import { cn } from "@/lib/utils";
import { money, NOT_RECORDED, pct, signedPct, type CompanySummary } from "./companyData";
import {
  BASIS_LABEL,
  MARGIN_KEYS,
  MARGIN_LABEL,
  moneyScale,
  periodLabel,
  periodsOf,
  latestValue,
  seriesAt,
  STATEMENT_LABEL,
  statementRows,
  statementsCsv,
  SUBTOTALS,
  tableValue,
  trendRows,
  unitKind,
  type Grain,
  type Line as StatementLine,
  type Scale,
  type StatementKind,
  type Statements,
  type StatementsProfile,
} from "./companyStatements";
import { Kpi, Notice, SourceLine } from "./CompanyUi";
import type { CompanyTab } from "./companySearch";

const axis = { fontSize: 11, fill: "var(--muted-foreground)" };

export function GrainToggle({
  grain,
  onGrain,
  quarterly = true,
}: {
  grain: Grain;
  onGrain: (g: Grain) => void;
  quarterly?: boolean;
}) {
  return (
    <div className="flex gap-1" role="group" aria-label="Period grain">
      {(["annual", "quarterly"] as const).map((g) => (
        <button
          key={g}
          type="button"
          aria-pressed={grain === g}
          disabled={g === "quarterly" && !quarterly}
          onClick={() => onGrain(g)}
          className={cn(
            "rounded border px-2 py-0.5 text-[11px] disabled:cursor-not-allowed disabled:opacity-50",
            grain === g
              ? "border-primary bg-primary/10 text-primary"
              : "border-border text-muted-foreground hover:bg-muted",
          )}
        >
          {g === "annual" ? "Fiscal years" : "Quarters"}
        </button>
      ))}
    </div>
  );
}

export function NoStatements() {
  return (
    <Notice>
      No XBRL financial statements are filed by this registrant. It may file without XBRL, only as a
      co-registrant in another company&rsquo;s reports, or not report periodically.
    </Notice>
  );
}

function sourceNote(p: StatementsProfile) {
  const sup = p.supplement.length
    ? ` ${p.supplement.map((f) => `${f.form} filed ${f.date}`).join("; ")} ${p.supplement.length === 1 ? "is" : "are"} not yet in SEC companyfacts and ${p.supplement.length === 1 ? "was" : "were"} read from the filing's own XBRL instance.`
    : "";
  return `Source: the registrant's XBRL facts in its 10-K, 10-Q, 20-F and 40-F filings (SEC companyfacts${p.retrieved ? `, retrieved ${p.retrieved}` : ""}); the latest filed value is used for each period.${sup} Values are in ${p.currency ?? "the reported unit"}; no currency conversion.`;
}

/* ---------- Overview ---------- */

export function OverviewTab({
  profile: p,
  summary,
  onOpen,
}: {
  profile: StatementsProfile | null;
  summary: CompanySummary | null;
  onOpen: (tab: CompanyTab) => void;
}) {
  const s = p?.statements ?? null;
  const exposure = summary?.exposure ?? null;
  return (
    <div className="space-y-3">
      {s ? <OverviewKpis s={s} /> : <NoStatements />}
      {exposure ? (
        <p className="rounded-md border border-border bg-surface px-3 py-2 text-xs text-muted-foreground">
          Litigation:{" "}
          <span className="text-foreground">
            {exposure.linkedMdls} MDL{exposure.linkedMdls === 1 ? "" : "s"} named in this
            company&rsquo;s own filings
          </span>
          {exposure.pendingActions !== null
            ? `, ${exposure.pendingActions.toLocaleString("en-US")} pending actions where its filings read it as a defendant`
            : ""}
          .{" "}
          <button
            type="button"
            onClick={() => onOpen("litigation")}
            className="text-primary hover:underline focus-visible:outline-2 focus-visible:outline-ring"
          >
            Open litigation exposure
          </button>
        </p>
      ) : null}
      {s && p ? (
        <>
          <div className="grid gap-3 xl:grid-cols-2">
            <RevenueChart s={s} grain="annual" unit={p.currency} />
            <MarginChart s={s} />
          </div>
          <RevenueChart s={s} grain="quarterly" unit={p.currency} />
          <SourceLine>{sourceNote(p)}</SourceLine>
        </>
      ) : null}
    </div>
  );
}

function OverviewKpis({ s }: { s: Statements }) {
  const ps = s.annualPeriods;
  const rev = latestValue(s, "revenue", "annual");
  const ni = latestValue(s, "net_income", "annual");
  const op = latestValue(s, "operating_income", "annual");
  const fcf = latestValue(s, "fcf", "annual");
  const eps = latestValue(s, "eps_diluted", "annual");
  const qRev = latestValue(s, "revenue", "quarterly");
  const fyNote = (v: { period: { fy: number } } | null) => (v ? `FY${v.period.fy}` : undefined);
  const growth = rev ? seriesAt(s.growth.annual["revenue"], rev.period, ps) : null;
  const netMargin = ni ? seriesAt(s.margins.annual.net_margin, ni.period, ps) : null;
  const opMargin = op ? seriesAt(s.margins.annual.operating_margin, op.period, ps) : null;
  const fcfMargin = fcf ? seriesAt(s.margins.annual.fcf_margin, fcf.period, ps) : null;
  const qGrowth = qRev
    ? seriesAt(s.growth.quarterly["revenue"], qRev.period, s.quarterlyPeriods)
    : null;
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
      <Kpi
        label="Revenue"
        value={money(rev?.value, rev?.unit)}
        note={
          rev
            ? `${fyNote(rev)} · ${growth !== null ? `${signedPct(growth)} YoY` : "no prior year"}`
            : undefined
        }
      />
      <Kpi
        label="Net income"
        value={money(ni?.value, ni?.unit)}
        note={ni ? `${fyNote(ni)} · net margin ${pct(netMargin)}` : undefined}
      />
      <Kpi
        label="Operating margin"
        value={op ? pct(opMargin) : NOT_RECORDED}
        note={
          op
            ? `${fyNote(op)} · operating income ${money(op.value, op.unit)}`
            : "operating income not reported"
        }
      />
      <Kpi
        label="Free cash flow"
        value={money(fcf?.value, fcf?.unit)}
        note={fcf ? `${fyNote(fcf)} · margin ${pct(fcfMargin)}` : undefined}
        detail="cash from operations less capital expenditures"
      />
      <Kpi
        label="Diluted EPS"
        value={eps ? `${eps.value < 0 ? "-" : ""}${Math.abs(eps.value).toFixed(2)}` : NOT_RECORDED}
        note={eps ? `${fyNote(eps)} · ${eps.unit?.split("/")[0] ?? ""} per share` : undefined}
      />
      <Kpi
        label="Latest quarter revenue"
        value={money(qRev?.value, qRev?.unit)}
        note={
          qRev
            ? `${periodLabel(qRev.period)} · ${qGrowth !== null ? `${signedPct(qGrowth)} YoY` : "no year-earlier quarter"}`
            : undefined
        }
        detail={qRev?.cell.basis === 1 ? "derived quarter" : undefined}
      />
    </div>
  );
}

function RevenueChart({ s, grain, unit }: { s: Statements; grain: Grain; unit: string | null }) {
  const rows = trendRows(s, grain);
  const fmt = (v: number) => money(v, unit);
  const has = rows.some((r) => r.revenue !== null || r.net_income !== null);
  return (
    <ChartCard
      title={
        grain === "annual"
          ? "Revenue and net income by fiscal year"
          : "Revenue and net income by quarter"
      }
      subtitle={`${unit ?? "Reported unit"}; latest filed value per period`}
      footnote={
        grain === "quarterly"
          ? "Quarters not filed on their own (usually the fourth) are derived from year-to-date values of the same concept and marked in the statements table."
          : undefined
      }
    >
      {has ? (
        <div className="h-60 px-2 py-2">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={rows} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
              <CartesianGrid stroke="var(--border)" vertical={false} />
              <XAxis dataKey="label" tick={axis} interval="preserveStartEnd" minTickGap={12} />
              <YAxis tick={axis} tickFormatter={fmt} width={60} />
              <ReferenceLine y={0} stroke="var(--border)" />
              <Tooltip formatter={(v: number) => fmt(v)} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar
                dataKey="revenue"
                name="Revenue"
                fill={FDA_COLORS[0]}
                isAnimationActive={false}
              />
              <Bar
                dataKey="net_income"
                name="Net income"
                fill={FDA_COLORS[1]}
                isAnimationActive={false}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <ChartUnavailable reason="No revenue or net income facts for this grain." />
      )}
    </ChartCard>
  );
}

function MarginChart({ s }: { s: Statements }) {
  const rows = trendRows(s, "annual");
  const has = rows.some(
    (r) => r.gross_margin !== null || r.operating_margin !== null || r.net_margin !== null,
  );
  return (
    <ChartCard
      title="Margins by fiscal year"
      subtitle="Percent of revenue, same period and unit; computed from the reported lines"
    >
      {has ? (
        <div className="h-60 px-2 py-2">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={rows} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
              <CartesianGrid stroke="var(--border)" vertical={false} />
              <XAxis dataKey="label" tick={axis} interval="preserveStartEnd" minTickGap={12} />
              <YAxis tick={axis} tickFormatter={(v: number) => `${v}%`} width={44} />
              <ReferenceLine y={0} stroke="var(--border)" />
              <Tooltip formatter={(v: number) => `${v.toFixed(1)}%`} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              {(["gross_margin", "operating_margin", "net_margin"] as const).map((k, i) => (
                <Line
                  key={k}
                  dataKey={k}
                  name={MARGIN_LABEL[k]}
                  stroke={FDA_COLORS[i + 2]}
                  strokeWidth={2}
                  dot={false}
                  connectNulls={false}
                  isAnimationActive={false}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <ChartUnavailable reason="Margins need revenue and the margin line in the same period and unit." />
      )}
    </ChartCard>
  );
}

/* ---------- Financial statements ---------- */

function downloadCsv(text: string, filename: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function StatementsTab({
  cik,
  profile: p,
  grain,
  onGrain,
}: {
  cik: string;
  profile: StatementsProfile | null;
  grain: Grain;
  onGrain: (g: Grain) => void;
}) {
  const s = p?.statements ?? null;
  const scale = useMemo(() => (s ? moneyScale(s) : null), [s]);
  if (!s || !p || !scale) return <NoStatements />;
  const ps = periodsOf(s, grain);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-surface px-3 py-2">
        <div className="flex flex-wrap items-center gap-3">
          <GrainToggle grain={grain} onGrain={onGrain} quarterly={s.quarterlyPeriods.length > 0} />
          <span className="text-[11px] text-muted-foreground">
            {ps.length
              ? `${periodLabel(ps[0]!)} to ${periodLabel(ps[ps.length - 1]!)}`
              : "No periods"}{" "}
            · {p.currency ?? "reported unit"} {scale.label} except per-share amounts; shares in
            millions
          </span>
        </div>
        <button
          type="button"
          onClick={() =>
            downloadCsv(statementsCsv(s, grain, cik), `${cik}-${grain}-financial-statements.csv`)
          }
          className="inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-[11px] hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
        >
          <Download className="size-3.5" aria-hidden />
          Download CSV
        </button>
      </div>
      {(["income", "balance", "cashflow"] as const).map((kind) => (
        <StatementTable key={kind} s={s} kind={kind} grain={grain} scale={scale} />
      ))}
      <SourceLine>
        {sourceNote(p)} Italic values are derived: a quarter not filed on its own is the
        year-to-date value less the previous year-to-date value (or, for a fourth quarter, the full
        year less the three filed quarters) of the same concept; per-share amounts are never
        derived. Lines marked &ldquo;computed&rdquo; are calculated from two reported lines of the
        same period. Hover a value for its XBRL concept and accession.
      </SourceLine>
    </div>
  );
}

function StatementTable({
  s,
  kind,
  grain,
  scale,
}: {
  s: Statements;
  kind: StatementKind;
  grain: Grain;
  scale: Scale;
}) {
  const ps = periodsOf(s, grain);
  const rows = statementRows(s, kind, grain);
  const scroller = useRef<HTMLDivElement>(null);
  // Newest periods are on the right; start scrolled there.
  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, [grain, rows.length]);
  const ratioRows: { label: string; values: (number | null)[]; signed?: boolean }[] =
    kind === "income"
      ? [
          ...MARGIN_KEYS.filter((k) => k !== "fcf_margin").map((k) => ({
            label: MARGIN_LABEL[k],
            values: s.margins[grain][k],
          })),
          {
            label:
              grain === "annual"
                ? "Revenue growth, year on year"
                : "Revenue growth, same quarter a year earlier",
            values: s.growth[grain]["revenue"] ?? [],
            signed: true,
          },
        ].filter((r) => r.values.some((v) => v !== null))
      : kind === "cashflow"
        ? [{ label: MARGIN_LABEL.fcf_margin, values: s.margins[grain].fcf_margin }].filter((r) =>
            r.values.some((v) => v !== null),
          )
        : [];
  return (
    <Panel
      title={STATEMENT_LABEL[kind]}
      subtitle={`${rows.length} line${rows.length === 1 ? "" : "s"} reported · ${grain === "annual" ? "fiscal years" : "quarters"}`}
    >
      {rows.length ? (
        <div ref={scroller} className="relative overflow-x-auto">
          <table className="min-w-full border-separate border-spacing-0 text-xs tabular-nums">
            <caption className="sr-only">
              {STATEMENT_LABEL[kind]}, {grain === "annual" ? "fiscal years" : "quarters"}
            </caption>
            <thead>
              <tr>
                <th
                  scope="col"
                  className="sticky left-0 z-[1] min-w-44 border-b border-border bg-surface px-3 py-1.5 text-left font-medium text-muted-foreground"
                >
                  Line
                </th>
                {ps.map((p) => (
                  <th
                    key={p.end}
                    scope="col"
                    className="whitespace-nowrap border-b border-border px-2 py-1.5 text-right font-medium"
                    title={`${p.start} to ${p.end}`}
                  >
                    {periodLabel(p)}
                    <div className="text-[10px] font-normal text-muted-foreground">{p.end}</div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((line) => (
                <StatementRow key={line.key} line={line} grain={grain} scale={scale} periods={ps} />
              ))}
              {ratioRows.map((r) => (
                <tr key={r.label} className="text-muted-foreground">
                  <th
                    scope="row"
                    className="sticky left-0 z-[1] border-b border-border/50 bg-surface px-3 py-1 text-left font-normal"
                  >
                    {r.label}
                  </th>
                  {ps.map((p, i) => {
                    const v = r.values[i] ?? null;
                    return (
                      <td
                        key={p.end}
                        className="whitespace-nowrap border-b border-border/50 px-2 py-1 text-right"
                      >
                        {v === null ? "—" : r.signed ? signedPct(v) : `${v.toFixed(1)}%`}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="px-3 py-6 text-sm text-muted-foreground">
          No {STATEMENT_LABEL[kind].toLowerCase()} lines are reported for this grain.
        </p>
      )}
    </Panel>
  );
}

function StatementRow({
  line,
  grain,
  scale,
  periods,
}: {
  line: StatementLine;
  grain: Grain;
  scale: Scale;
  periods: ReturnType<typeof periodsOf>;
}) {
  const kind = unitKind(line.unit);
  const subtotal = SUBTOTALS.has(line.key);
  const computed = line[grain].some((c) => c?.basis === 2);
  return (
    <tr className={cn(subtotal && "font-semibold")}>
      <th
        scope="row"
        className={cn(
          "sticky left-0 z-[1] border-b border-border/50 bg-surface px-3 py-1 text-left",
          subtotal ? "font-semibold" : "font-normal",
        )}
      >
        {line.label}
        {kind === "per_share" ? (
          <span className="font-normal text-muted-foreground"> (per share)</span>
        ) : null}
        {kind === "shares" ? (
          <span className="font-normal text-muted-foreground"> (millions)</span>
        ) : null}
        {computed ? (
          <span
            className="ml-1 text-[10px] font-normal text-muted-foreground"
            title={BASIS_LABEL[2]}
          >
            computed
          </span>
        ) : null}
      </th>
      {periods.map((p, i) => {
        const c = line[grain][i] ?? null;
        return (
          <td
            key={p.end}
            className={cn(
              "whitespace-nowrap border-b border-border/50 px-2 py-1 text-right",
              c?.basis === 1 && "italic text-muted-foreground",
            )}
            title={
              c
                ? `${line.label}, ${periodLabel(p)}: ${c.v.toLocaleString("en-US")} ${line.unit ?? ""}\n${BASIS_LABEL[c.basis]}${c.concept ? `\nConcept: ${c.concept}` : ""}${c.accn ? `\nAccession: ${c.accn}` : ""}`
                : `${line.label}, ${periodLabel(p)}: not reported`
            }
          >
            {tableValue(c, line.unit, scale)}
            {c?.basis === 1 ? <span className="sr-only"> (derived)</span> : null}
          </td>
        );
      })}
    </tr>
  );
}
