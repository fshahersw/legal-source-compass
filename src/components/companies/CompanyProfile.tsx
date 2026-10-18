import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
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
import { Building2, ChevronDown, ExternalLink } from "lucide-react";
import { ChartCard, ChartUnavailable } from "@/components/fda-analytics/FdaCharts";
import { chartDateLabel, FDA_COLORS } from "@/components/fda-analytics/chartView";
import { getCompanyDetail } from "@/lib/external/companies.functions";
import { cn } from "@/lib/utils";
import {
  companyfactsUrl,
  count,
  edgarCompanyUrl,
  METRIC_LABEL,
  money,
  NOT_RECORDED,
  pct,
  signedPct,
  TIER_LABEL,
  mdlTitle,
  strengthSplit,
  type CompanyDetail,
  type CompanyLink,
  type FinPoint,
  type Metric,
} from "./companyData";
import {
  FlagBadge,
  Kpi,
  LoadingBlocks,
  Notice,
  RoleText,
  SourceLine,
  TierBadge,
} from "./CompanyUi";

export const companyDetailQuery = (cik: string) => ({
  queryKey: ["company-sec-detail", cik],
  queryFn: () => getCompanyDetail({ data: { cik } }),
  staleTime: 10 * 60 * 1000,
});

const axis = { fontSize: 11, fill: "var(--muted-foreground)" };

export function CompanyProfile({ cik }: { cik: string }) {
  const q = useQuery(companyDetailQuery(cik));
  if (q.isLoading) return <LoadingBlocks label="Loading company" />;
  if (q.isError)
    return (
      <Notice tone="error">
        This company could not be loaded. {q.error instanceof Error ? q.error.message : ""}
      </Notice>
    );
  if (!q.data)
    return (
      <Notice>
        No SEC company-intelligence record is published for CIK {cik}. Only registrants whose own
        filings name an MDL are included.{" "}
        <Link to="/companies" className="text-primary hover:underline">
          Back to all companies
        </Link>
      </Notice>
    );
  return <Profile d={q.data} />;
}

export function companyTitle(d: CompanyDetail | null | undefined) {
  return d?.summary.profile.name ?? "Company";
}

function Profile({ d }: { d: CompanyDetail }) {
  const { summary: s, financials: f } = d;
  const p = s.profile;
  const acc = s.latest.litigation_accrual;
  const unit = s.currency;
  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-start gap-3 rounded-md border border-border bg-surface p-3">
        <span
          className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-border bg-muted text-muted-foreground"
          aria-hidden
        >
          <Building2 className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            {p.tickers.length ? (
              <span className="rounded border border-border bg-muted px-1.5 py-px font-mono text-[11px]">
                {p.tickers.join(" · ")}
                {p.exchanges.length ? ` · ${p.exchanges.join(", ")}` : ""}
              </span>
            ) : (
              <span className="text-[11px] text-muted-foreground">No ticker recorded</span>
            )}
            {s.exposure.strongestTier ? (
              <TierBadge tier={s.exposure.strongestTier} />
            ) : (
              <span className="text-[11px] text-muted-foreground">
                No pending MDL read as defendant
              </span>
            )}
            {s.flags.map((k) => (
              <FlagBadge key={k} flag={k} label={FLAG_TEXT[k]} />
            ))}
          </div>
          <dl className="mt-1.5 grid grid-cols-2 gap-x-4 gap-y-0.5 text-xs sm:grid-cols-4">
            <Fact label="CIK" value={p.cik} mono />
            <Fact
              label="SIC"
              value={p.sic ? `${p.sic} · ${p.sicDescription ?? ""}` : NOT_RECORDED}
            />
            <Fact
              label="State of incorporation"
              value={p.stateOfIncorporationName ?? p.stateOfIncorporation ?? NOT_RECORDED}
            />
            <Fact
              label="Business address"
              value={
                [p.businessCity, p.businessStateName ?? p.businessState]
                  .filter(Boolean)
                  .join(", ") || NOT_RECORDED
              }
            />
          </dl>
          {p.formerNames.length ? (
            <p className="mt-1 text-[11px] text-muted-foreground">
              Former names: {p.formerNames.join("; ")}
            </p>
          ) : null}
          {s.coRegistrantOf.length ? (
            <p className="mt-1 text-[11px] text-muted-foreground">
              No XBRL financials of its own; appears as a co-registrant with{" "}
              {s.coRegistrantOf.join("; ")}.
            </p>
          ) : null}
        </div>
        <div className="flex flex-col gap-1 text-xs">
          <a
            href={edgarCompanyUrl(p.cik)}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-primary hover:underline"
          >
            EDGAR filings <ExternalLink className="size-3" aria-hidden />
          </a>
          <a
            href={companyfactsUrl(p.cik)}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-primary hover:underline"
          >
            XBRL companyfacts <ExternalLink className="size-3" aria-hidden />
          </a>
        </div>
      </header>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Kpi
          label="Linked MDLs"
          value={String(s.exposure.linkedMdls)}
          note={`${s.exposure.pendingMdls} pending, counted as defendant`}
        />
        <Kpi
          label="Pending actions (defendant)"
          value={count(s.exposure.pendingActions)}
          note={strengthSplit(s.exposure.pendingActionsAB, s.exposure.pendingActionsC) ?? undefined}
          detail={
            s.exposure.pendingActionsUnclear
              ? `+${s.exposure.pendingActionsUnclear.toLocaleString("en-US")} where role not stated`
              : s.exposure.pendingChange12m !== null
                ? `${s.exposure.pendingChange12m >= 0 ? "+" : ""}${s.exposure.pendingChange12m.toLocaleString("en-US")} in 12 months`
                : undefined
          }
          title="Sum of JPML pending actions in MDLs whose evidence excerpt reads the company as a defendant. A/B = MDL number or caption evidence; C = subject evidence (requires review)."
        />
        <Kpi
          label="Revenue"
          value={money(s.latest.revenue?.value, s.latest.revenue?.unit)}
          note={s.latest.revenue ? `FY${s.latest.revenue.fy}` : undefined}
        />
        <Kpi
          label="Net income"
          value={money(s.latest.net_income?.value, s.latest.net_income?.unit)}
          note={s.latest.net_income ? `FY${s.latest.net_income.fy}` : undefined}
        />
        <Kpi
          label="Litigation accrual (company-wide)"
          value={money(acc?.value, acc?.unit)}
          note={
            acc
              ? s.accrualCurrent
                ? `FY${acc.fy} · YoY ${signedPct(s.accrualYoyPct)}`
                : `FY${acc.fy}, not current`
              : undefined
          }
          detail="not MDL-specific"
          title={
            acc
              ? `${acc.concept}: the company's total loss-contingency accrual, not an MDL reserve`
              : undefined
          }
        />
        <Kpi
          label="Accrual % of revenue"
          value={acc && !s.accrualCurrent ? "Not current" : pct(s.accrualPctRevenue, 2)}
          note={
            acc && !s.accrualCurrent && s.accrualPctRevenueAny !== null
              ? `${s.accrualPctRevenueAny.toFixed(2)}% in FY${acc.fy}`
              : "same fiscal year, same unit"
          }
        />
      </div>

      {f ? (
        <Financials d={d} />
      ) : (
        <Notice>
          No XBRL financial facts are published for this registrant (it may file without XBRL or
          only as a co-registrant).
        </Notice>
      )}

      <div className="grid gap-3 xl:grid-cols-2">
        <PendingTrend d={d} />
        <MentionTimeline d={d} />
      </div>

      <Exposure links={d.links} />
      <SourceLine>
        Sources: SEC EDGAR filing documents (evidence excerpts), EDGAR full-text search,
        data.sec.gov submissions and XBRL companyfacts
        {f?.retrieved ? ` (retrieved ${f.retrieved})` : ""}; JPML pending MDL reports via dataset
        mdl_analytics. Values are in {unit ?? "the reported unit"}; no currency conversion. Role
        readings are deterministic phrase rules and require review.
      </SourceLine>
    </div>
  );
}

const FLAG_TEXT = {
  accrual_surge: "Accrual surge with growing docket",
  accrual_heavy: "Accrual ≥ 5% of revenue",
  expense_spike: "Litigation expense doubled",
  docket_growth: "Linked docket growing 25%+",
  multi_mdl: "3+ pending MDLs",
} as const;

function Fact({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] text-muted-foreground">{label}</dt>
      <dd className={cn("truncate", mono && "font-mono")} title={value}>
        {value}
      </dd>
    </div>
  );
}

function rowsFor(
  points: Partial<Record<Metric, FinPoint[]>>,
  metrics: Metric[],
  grain: "annual" | "quarterly",
) {
  const map = new Map<string, Record<string, number | string>>();
  for (const m of metrics)
    for (const p of points[m] ?? []) {
      const key = grain === "annual" ? String(p.fy) : p.end;
      const row = map.get(key) ?? {
        key,
        label: grain === "annual" ? `FY${p.fy}` : chartDateLabel(p.end),
      };
      row[m] = p.value;
      map.set(key, row);
    }
  return [...map.values()].sort((a, b) => String(a["key"]).localeCompare(String(b["key"])));
}

function conceptNote(points: Partial<Record<Metric, FinPoint[]>>, metrics: Metric[]) {
  return metrics
    .map((m) => {
      const concepts = [...new Set((points[m] ?? []).map((p) => p.concept))];
      return concepts.length
        ? `${METRIC_LABEL[m]}: ${concepts.join(", ")}`
        : `${METRIC_LABEL[m]}: not reported`;
    })
    .join(" · ");
}

function Financials({ d }: { d: CompanyDetail }) {
  const f = d.financials!;
  const [grain, setGrain] = useState<"annual" | "quarterly">("annual");
  const pts = grain === "annual" ? f.annual : f.quarterly;
  const unit =
    f.annual.revenue[0]?.unit ?? f.annual.net_income[0]?.unit ?? d.summary.currency ?? "USD";
  const pl = rowsFor(pts, ["revenue", "net_income"], grain);
  const lit = rowsFor(
    pts,
    ["litigation_accrual", "litigation_expense", "legal_payments", "possible_loss"],
    grain,
  );
  const accPct = f.accrualPctRevenue.map((r) => ({ label: `FY${r.fy}`, pct: r.pct }));
  const fmt = (v: number) => money(v, unit);
  const toggle = (
    <div className="flex gap-1 px-3 pt-2" role="group" aria-label="Period grain">
      {(["annual", "quarterly"] as const).map((g) => (
        <button
          key={g}
          type="button"
          aria-pressed={grain === g}
          onClick={() => setGrain(g)}
          className={cn(
            "rounded border px-2 py-0.5 text-[11px]",
            grain === g
              ? "border-primary bg-primary/10 text-primary"
              : "border-border text-muted-foreground hover:bg-muted",
          )}
        >
          {g === "annual" ? "Fiscal years (10-K/20-F)" : "Quarters (10-Q)"}
        </button>
      ))}
    </div>
  );
  return (
    <div className="grid gap-3 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <ChartCard
        title="Revenue and net income"
        subtitle={`${grain === "annual" ? "Fiscal years" : "Quarterly (80–100 day) periods"}, ${unit}, latest filed value per period`}
        footnote={conceptNote(pts, ["revenue", "net_income"])}
      >
        {toggle}
        {pl.length ? (
          <div className="h-64 px-2 py-2">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={pl} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
                <CartesianGrid stroke="var(--border)" vertical={false} />
                <XAxis dataKey="label" tick={axis} interval="preserveStartEnd" minTickGap={20} />
                <YAxis tick={axis} tickFormatter={fmt} width={60} />
                <ReferenceLine y={0} stroke="var(--border)" />
                <Tooltip formatter={(v: number) => fmt(v)} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Line
                  dataKey="revenue"
                  name="Revenue"
                  stroke={FDA_COLORS[0]}
                  strokeWidth={2}
                  dot={false}
                  connectNulls={false}
                  isAnimationActive={false}
                />
                <Line
                  dataKey="net_income"
                  name="Net income"
                  stroke={FDA_COLORS[1]}
                  strokeWidth={2}
                  dot={false}
                  connectNulls={false}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <ChartUnavailable reason="No revenue or net income facts for this grain." />
        )}
      </ChartCard>
      <ChartCard
        title="Litigation accruals, expense and payments"
        subtitle={`Company-wide loss-contingency XBRL facts, not MDL-specific, ${unit}; accrual and possible-loss are period-end balances`}
        footnote={conceptNote(pts, [
          "litigation_accrual",
          "litigation_expense",
          "legal_payments",
          "possible_loss",
        ])}
      >
        {toggle}
        {lit.length ? (
          <div className="h-64 px-2 py-2">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={lit} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
                <CartesianGrid stroke="var(--border)" vertical={false} />
                <XAxis dataKey="label" tick={axis} interval="preserveStartEnd" minTickGap={20} />
                <YAxis tick={axis} tickFormatter={fmt} width={60} />
                <Tooltip formatter={(v: number) => fmt(v)} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar
                  dataKey="litigation_accrual"
                  name="Accrual"
                  fill={FDA_COLORS[2]}
                  isAnimationActive={false}
                />
                <Bar
                  dataKey="litigation_expense"
                  name="Expense"
                  fill={FDA_COLORS[3]}
                  isAnimationActive={false}
                />
                <Bar
                  dataKey="legal_payments"
                  name="Payments"
                  fill={FDA_COLORS[4]}
                  isAnimationActive={false}
                />
                <Bar
                  dataKey="possible_loss"
                  name="Possible loss"
                  fill={FDA_COLORS[5]}
                  isAnimationActive={false}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <ChartUnavailable reason="This registrant reports none of the tracked litigation concepts in XBRL for this grain." />
        )}
        {grain === "annual" && accPct.length ? (
          <div className="border-t border-border/60 px-3 py-1.5 text-[11px] text-muted-foreground">
            Accrual as % of revenue:{" "}
            {accPct.slice(-6).map((r) => (
              <span key={r.label} className="mr-2 whitespace-nowrap font-mono text-foreground">
                {r.label} {r.pct.toFixed(2)}%
              </span>
            ))}
          </div>
        ) : null}
      </ChartCard>
    </div>
  );
}

function PendingTrend({ d }: { d: CompanyDetail }) {
  const series = d.summary.pendingSeries.map((p) => ({
    label: chartDateLabel(p.date),
    pending: p.pending,
    mdls: p.mdls ?? null,
  }));
  return (
    <ChartCard
      title="Pending actions across linked pending MDLs"
      subtitle="Sum of JPML pending actions per monthly report for the MDLs where this company's filings read it as a defendant"
      footnote="Counts only MDLs whose evidence passage reads the company as a defendant (not dismissed, not flagged for review). An MDL created during the window counts from its first report."
    >
      {series.length > 1 ? (
        <div className="h-56 px-2 py-2">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={series} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
              <CartesianGrid stroke="var(--border)" vertical={false} />
              <XAxis dataKey="label" tick={axis} interval="preserveStartEnd" minTickGap={24} />
              <YAxis
                tick={axis}
                width={52}
                tickFormatter={(v: number) => v.toLocaleString("en-US")}
              />
              <Tooltip
                formatter={(v: number, k) => [
                  v.toLocaleString("en-US"),
                  k === "pending" ? "Pending actions" : k,
                ]}
                labelFormatter={(l, payload) => {
                  const m = payload?.[0]?.payload?.mdls;
                  return m ? `${l} · ${m} MDL${m === 1 ? "" : "s"} reporting` : String(l);
                }}
              />
              <Line
                dataKey="pending"
                stroke={FDA_COLORS[0]}
                strokeWidth={2}
                dot={false}
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <ChartUnavailable reason="None of this company's linked MDLs is pending in the JPML monthly reports." />
      )}
    </ChartCard>
  );
}

function MentionTimeline({ d }: { d: CompanyDetail }) {
  const rows = d.summary.mentionsByYear.map((r) => ({
    year: r.year,
    verified: r.verified,
    searchOnly: Math.max(0, r.search - r.verified),
  }));
  return (
    <ChartCard
      title="Filings mentioning linked MDLs, by year"
      subtitle="Verified = text re-checked against the evidence rule; search-only = EDGAR full-text match not downloaded or not verified"
      footnote="Only the registrant's own 10-K, 10-Q, 8-K, 20-F, 6-K, 40-F and registration statements count."
    >
      {rows.length ? (
        <div className="h-56 px-2 py-2">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid stroke="var(--border)" vertical={false} />
              <XAxis dataKey="year" tick={axis} interval="preserveStartEnd" minTickGap={16} />
              <YAxis tick={axis} width={32} allowDecimals={false} />
              <Tooltip />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar
                dataKey="verified"
                name="Verified"
                stackId="m"
                fill={FDA_COLORS[0]}
                isAnimationActive={false}
              />
              <Bar
                dataKey="searchOnly"
                name="Search match only"
                stackId="m"
                fill="var(--muted-foreground)"
                fillOpacity={0.35}
                isAnimationActive={false}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <ChartUnavailable reason="No dated filings were stored." />
      )}
    </ChartCard>
  );
}

function Exposure({ links }: { links: CompanyLink[] }) {
  const sorted = [...links].sort((a, b) => (b.pending ?? -1) - (a.pending ?? -1) || a.mdl - b.mdl);
  return (
    <section className="rounded-md border border-border bg-surface" aria-label="MDL exposure">
      <div className="border-b border-border/70 px-3 py-2">
        <h3 className="text-sm font-semibold">MDL exposure and evidence filings</h3>
        <p className="text-xs text-muted-foreground">
          Each MDL below is named in this company&apos;s own SEC filings. Expand a row for the
          filings, the matched text and an excerpt. {TIER_LABEL.C}: confirm against the filing
          before relying on it.
        </p>
      </div>
      {sorted.length ? (
        <ul>
          {sorted.map((l) => (
            <ExposureRow key={l.mdl} l={l} />
          ))}
        </ul>
      ) : (
        <p className="px-3 py-6 text-sm text-muted-foreground">
          No evidence links were stored for this company.
        </p>
      )}
    </section>
  );
}

function ExposureRow({ l }: { l: CompanyLink }) {
  const [open, setOpen] = useState(false);
  const id = `mdl-evidence-${l.mdl}`;
  const latest = l.verified.at(-1);
  return (
    <li className="border-b border-border/50 last:border-b-0">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-2 px-3 py-2 md:grid-cols-[4rem_minmax(0,1fr)_7rem_9rem_8rem]">
        <Link
          to="/records/$dataset/$id"
          params={{ dataset: "mdl_analytics", id: String(l.mdl) }}
          className="font-mono text-xs text-primary hover:underline"
        >
          MDL {l.mdl}
        </Link>
        <div className="min-w-0 md:order-none">
          <div className="text-xs font-medium leading-snug">
            {mdlTitle(l.title, l.titleTruncated, l.mdl)}
          </div>
          <div className="text-[11px] text-muted-foreground">
            {[
              l.district,
              l.judge,
              l.status === "pending"
                ? "Pending"
                : l.terminationYear
                  ? `Terminated ${l.terminationYear}`
                  : "Not pending",
            ]
              .filter(Boolean)
              .join(" · ")}
          </div>
        </div>
        <div className="text-right text-xs tabular-nums">
          {l.status === "pending" ? count(l.pending) : "—"}
          <div className="text-[11px] text-muted-foreground">
            {l.change12m !== null
              ? `${l.change12m >= 0 ? "+" : ""}${l.change12m.toLocaleString("en-US")} 12m`
              : "pending actions"}
          </div>
        </div>
        <div className="flex flex-col items-start gap-0.5">
          <TierBadge tier={l.tier} />
          <RoleText role={l.role} />
          {l.dismissed ? (
            <span
              className="rounded border border-border bg-muted px-1 text-[10px] font-medium"
              title="The latest evidence passage reports a dismissal or that the company is not sued"
            >
              Dismissed (excerpt)
            </span>
          ) : null}
          {l.review ? (
            <span
              className="rounded border border-warning/40 bg-warning/15 px-1 text-[10px] font-medium text-warning-foreground"
              title={l.reviewNote ?? undefined}
            >
              Review
            </span>
          ) : null}
          {!l.countsTowardExposure ? (
            <span className="text-[10px] text-muted-foreground">Not counted in totals</span>
          ) : null}
        </div>
        <div className="text-[11px] text-muted-foreground">
          {l.verifiedCount} verified filing{l.verifiedCount === 1 ? "" : "s"}
          <div>
            {l.firstVerified} → {l.lastVerified}
          </div>
        </div>
      </div>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-1 border-t border-border/40 px-3 py-1 text-left text-[11px] text-muted-foreground hover:bg-muted/50 focus-visible:outline-2 focus-visible:outline-ring"
      >
        <ChevronDown
          className={cn("size-3.5 transition-transform", open && "rotate-180")}
          aria-hidden
        />
        Evidence filings ({l.verified.length})
        {latest ? ` · latest ${latest.form} ${latest.fileDate}` : ""}
      </button>
      {open ? (
        <div id={id} className="space-y-2 bg-muted/20 px-3 py-2 text-xs">
          {l.reviewNote ? (
            <p className="rounded border border-warning/40 bg-warning/10 px-2 py-1 text-[11px]">
              <span className="font-medium">Review: </span>
              {l.reviewNote}
            </p>
          ) : null}
          {l.roleSource === "review" && l.roleNote ? (
            <p className="text-[11px] text-muted-foreground">
              <span className="font-medium text-foreground">Role set by review: </span>
              {l.roleNote}
            </p>
          ) : null}
          {l.verified
            .slice()
            .reverse()
            .map((v) => (
              <div
                key={`${v.adsh}-${v.url}`}
                className="rounded border border-border/60 bg-surface px-2 py-1.5"
              >
                <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                  <a
                    href={v.url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 font-medium text-primary hover:underline"
                  >
                    {v.form} filed {v.fileDate} <ExternalLink className="size-3" aria-hidden />
                  </a>
                  {v.indexUrl ? (
                    <a
                      href={v.indexUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="text-[11px] text-muted-foreground hover:underline"
                    >
                      accession {v.adsh}
                    </a>
                  ) : (
                    <span className="font-mono text-[11px] text-muted-foreground">{v.adsh}</span>
                  )}
                  <span className="text-[11px] text-muted-foreground">
                    matched &ldquo;{v.matched}&rdquo;
                  </span>
                  <RoleText role={v.role} />
                </div>
                {v.excerpt ? (
                  <p className="mt-1 leading-5 text-muted-foreground">{v.excerpt}</p>
                ) : null}
                {v.coRegistrants.length ? (
                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                    Co-registrants: {v.coRegistrants.join("; ")}
                  </p>
                ) : null}
              </div>
            ))}
          {l.searchUrls.length ? (
            <p className="text-[11px] text-muted-foreground">
              {l.searchCount} EDGAR full-text matches ({l.checked} documents checked).{" "}
              {l.searchUrls.slice(0, 3).map((u, i) => (
                <a
                  key={u}
                  href={u}
                  target="_blank"
                  rel="noreferrer"
                  className="mr-2 text-primary hover:underline"
                >
                  Search query {i + 1}
                </a>
              ))}
            </p>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}
