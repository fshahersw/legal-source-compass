import { useRef, useState, type KeyboardEvent } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  BarChart3,
  ChevronDown,
  ExternalLink,
  FileStack,
  FileText,
  Gavel,
  LayoutDashboard,
  PieChart,
} from "lucide-react";
import { ChartCard, ChartUnavailable } from "@/components/fda-analytics/FdaCharts";
import { chartDateLabel, FDA_COLORS } from "@/components/fda-analytics/chartView";
import { getCompanyDetail } from "@/lib/external/companies.functions";
import { OpenPaymentsPanel } from "@/components/companies/OpenPaymentsPanel";
import { cn } from "@/lib/utils";
import {
  count,
  METRIC_LABEL,
  money,
  pct,
  signedPct,
  TIER_LABEL,
  mdlRecordView,
  mdlTitle,
  strengthSplit,
  type CompanyDetail,
  type CompanyLink,
  type FinPoint,
  type MdlRecordLookup,
  type Metric,
} from "./companyData";
import { companyStatementsQuery } from "./companyQueries";
import { COMPANY_VIEWS, tabOf, viewOf, type CompanySearch, type CompanyTab } from "./companySearch";
import type { Grain } from "./companyStatements";
import { CompanyFacts } from "./CompanyHeader";
import { GrainToggle, OverviewTab, StatementsTab } from "./CompanyFinancials";
import { SegmentsTab } from "./CompanySegments";
import { DocumentsTab } from "./CompanyDocuments";
import { FilingsTab } from "./CompanyFilings";
import {
  FlagBadge,
  Kpi,
  LoadingBlocks,
  Notice,
  RoleText,
  SourceLine,
  SwatchLegend,
  TierBadge,
} from "./CompanyUi";
import {
  applyUiExposure,
  countsInUi,
  dataFlags,
  exposureSentence,
  sumSeries,
  uiExposure,
} from "./exposure";
import { ReserveVsDocket } from "./ReserveVsDocket";
import { CorporateTransactions } from "./CorporateTransactions";
import {
  dateSpan,
  linkedMdlNote,
  pendingActionsValue,
  pendingTrendFootnote,
  pendingTrendMessage,
  pendingTrendView,
} from "./companyViewNotes";

export const companyDetailQuery = (cik: string) => ({
  queryKey: ["company-sec-detail", cik],
  queryFn: () => getCompanyDetail({ data: { cik } }),
  staleTime: 10 * 60 * 1000,
});

const axis = { fontSize: 11, fill: "var(--muted-foreground)" };

const VIEW_ICON: Record<(typeof COMPANY_VIEWS)[number]["id"], typeof LayoutDashboard> = {
  overview: LayoutDashboard,
  financials: BarChart3,
  documents: FileText,
  litigation: Gavel,
};

export type CompanyNavigate = (next: CompanySearch, opts?: { replace?: boolean }) => void;

export function CompanyProfile({
  cik,
  search,
  onNavigate,
}: {
  cik: string;
  search: CompanySearch;
  onNavigate: CompanyNavigate;
}) {
  const detail = useQuery(companyDetailQuery(cik));
  const statements = useQuery(companyStatementsQuery(cik));
  if (detail.isLoading || statements.isLoading) return <LoadingBlocks label="Loading company" />;
  if (detail.isError && statements.isError)
    return (
      <Notice tone="error">
        This company could not be loaded.{" "}
        {detail.error instanceof Error ? detail.error.message : ""}
      </Notice>
    );
  const d = detail.data ?? null;
  const p = statements.data ?? null;
  if (!d && !p)
    return (
      <Notice>
        No SEC company record is published for CIK {cik}. Only registrants whose own filings name an
        MDL are included.{" "}
        <Link to="/companies" className="text-primary hover:underline">
          Back to all companies
        </Link>
      </Notice>
    );
  const uiSummary = d ? applyUiExposure(d.summary) : null;
  const tab = tabOf(search);
  const grain: Grain = search.grain ?? "annual";
  const open = (id: CompanyTab) =>
    onNavigate({ ...(id === "overview" ? {} : { tab: id }) }, { replace: false });
  const setGrain = (g: Grain) =>
    onNavigate(
      { ...search, grain: g === "quarterly" ? "quarterly" : undefined },
      { replace: true },
    );
  return (
    <div className="space-y-3">
      <CompanyFacts cik={cik} profile={p} summary={uiSummary} />
      <TabBar tab={tab} onOpen={open} />
      <div
        role="tabpanel"
        id={`company-panel-${viewOf(tab).id}`}
        aria-labelledby={`company-tab-${viewOf(tab).id}`}
        className="min-w-0"
      >
        {statements.isError && tab !== "litigation" ? (
          <Notice tone="error">
            Financial data could not be loaded.{" "}
            {statements.error instanceof Error ? statements.error.message : ""}
          </Notice>
        ) : tab === "overview" ? (
          <OverviewTab profile={p} summary={uiSummary} onOpen={open} />
        ) : tab === "statements" || tab === "segments" ? (
          <ViewParts
            first={tab === "segments" ? 1 : 0}
            parts={[
              <ViewPart key="s" id="company-statements" title="Financial statements">
                <StatementsTab cik={cik} profile={p} grain={grain} onGrain={setGrain} />
              </ViewPart>,
              <ViewPart key="g" id="company-segments" title="Segments">
                <SegmentsTab
                  cik={cik}
                  grain={grain}
                  onGrain={setGrain}
                  currency={p?.currency ?? null}
                />
              </ViewPart>,
            ]}
          />
        ) : tab === "documents" || tab === "filings" ? (
          <ViewParts
            first={tab === "filings" ? 1 : 0}
            parts={[
              <ViewPart key="d" id="company-documents" title="Investor documents">
                <DocumentsTab
                  cik={cik}
                  docId={search.doc}
                  onDoc={(id) => onNavigate({ tab: "documents", doc: id }, { replace: true })}
                  currency={p?.currency ?? null}
                />
              </ViewPart>,
              <ViewPart key="f" id="company-filings" title="SEC filings">
                <FilingsTab cik={cik} profile={p} />
              </ViewPart>,
            ]}
          />
        ) : d ? (
          <Litigation d={d} />
        ) : detail.isError ? (
          <Notice tone="error">
            Litigation exposure could not be loaded.{" "}
            {detail.error instanceof Error ? detail.error.message : ""}
          </Notice>
        ) : (
          <Notice>No MDL evidence record is published for this registrant.</Notice>
        )}
      </div>
    </div>
  );
}

/** The parts of a view, the one a former tab address names (?tab=segments, ?tab=filings) first. */
function ViewParts({ parts, first }: { parts: readonly React.ReactNode[]; first: number }) {
  const ordered = [parts[first], ...parts.filter((_, i) => i !== first)];
  return <div className="space-y-8">{ordered}</div>;
}

function ViewPart({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="min-w-0 scroll-mt-16 space-y-3">
      <h2 id={`${id}-title`} className="text-heading text-foreground">
        {title}
      </h2>
      {children}
    </section>
  );
}

function TabBar({ tab, onOpen }: { tab: CompanyTab; onOpen: (id: CompanyTab) => void }) {
  const refs = useRef(new Map<string, HTMLButtonElement>());
  const current = viewOf(tab);
  const openView = (v: (typeof COMPANY_VIEWS)[number]) => onOpen(v.tabs[0]);
  const onKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    const i = COMPANY_VIEWS.findIndex((v) => v.id === current.id);
    const n = COMPANY_VIEWS.length;
    const next =
      e.key === "ArrowRight"
        ? COMPANY_VIEWS[(i + 1) % n]
        : e.key === "ArrowLeft"
          ? COMPANY_VIEWS[(i - 1 + n) % n]
          : e.key === "Home"
            ? COMPANY_VIEWS[0]
            : e.key === "End"
              ? COMPANY_VIEWS[n - 1]
              : undefined;
    if (!next) return;
    e.preventDefault();
    openView(next);
    refs.current.get(next.id)?.focus();
  };
  return (
    <div
      role="tablist"
      aria-label="Company views"
      className="flex gap-1 overflow-x-auto rounded-md border border-border bg-surface p-1"
    >
      {COMPANY_VIEWS.map((v) => {
        const Icon = VIEW_ICON[v.id];
        const on = v.id === current.id;
        return (
          <button
            key={v.id}
            ref={(el) => {
              if (el) refs.current.set(v.id, el);
            }}
            type="button"
            role="tab"
            id={`company-tab-${v.id}`}
            aria-selected={on}
            aria-controls={`company-panel-${v.id}`}
            tabIndex={on ? 0 : -1}
            onClick={() => openView(v)}
            onKeyDown={onKey}
            className={cn(
              "flex shrink-0 items-center gap-1.5 rounded px-3 py-1.5 text-xs transition-colors focus-visible:outline-2 focus-visible:outline-ring",
              on
                ? "bg-primary font-semibold text-primary-foreground"
                : "text-muted-foreground hover:bg-muted",
            )}
          >
            <Icon className="size-3.5" aria-hidden />
            {v.label}
          </button>
        );
      })}
    </div>
  );
}

export function companyTitle(d: CompanyDetail | null | undefined) {
  return d?.summary.profile.name ?? "Company";
}

/** SIC groups that report to CMS Open Payments or FDA MAUDE: drugs, biologics, devices, medical supply wholesale. */
function reportsToCms(sic: string | null): boolean {
  const code = Number(sic);
  if (!sic || !Number.isInteger(code)) return false;
  return (
    (code >= 2830 && code <= 2836) ||
    (code >= 3840 && code <= 3851) ||
    code === 5047 ||
    code === 5122
  );
}

function Litigation({ d: published }: { d: CompanyDetail }) {
  // Exposure under the UI rule: tier C links never count; pending actions are MDL-wide.
  const d: CompanyDetail = {
    ...published,
    summary: applyUiExposure(published.summary),
    links: published.links.map((l) => ({ ...l, countsTowardExposure: countsInUi(l) })),
  };
  const { summary: s, financials: f } = d;
  const p = s.profile;
  const acc = s.latest.litigation_accrual;
  const unit = s.currency;
  const ui = uiExposure(published.summary.mdls);
  const flags = dataFlags(
    s,
    d.links.flatMap((l) => l.verified.flatMap((v) => v.coRegistrants)),
  );
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-1.5">
        {s.exposure.strongestTier ? (
          <TierBadge tier={s.exposure.strongestTier} />
        ) : (
          <span className="text-[11px] text-muted-foreground">
            No pending MDL counted (tier A or B, read as defendant)
          </span>
        )}
        {s.flags.map((k) => (
          <FlagBadge key={k} flag={k} label={FLAG_TEXT[k]} />
        ))}
      </div>
      {flags.length ? (
        <ul className="space-y-1" aria-label="Data notes">
          {flags.map((fl) => (
            <li
              key={fl.id}
              className="rounded-md border border-warning/40 bg-warning/10 px-3 py-1.5 text-xs text-foreground"
            >
              <span className="font-medium">{fl.label}: </span>
              {fl.detail}
            </li>
          ))}
        </ul>
      ) : null}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi
          label="Linked MDLs"
          value={String(s.exposure.linkedMdls)}
          note={linkedMdlNote(s.mdls, s.exposure.pendingMdls)}
        />
        <Kpi
          label="Pending in named MDLs (MDL-wide)"
          value={pendingActionsValue(s.exposure)}
          note={exposureSentence(ui)}
          detail={
            ui.tierCPendingMdls
              ? `+${ui.tierCPendingMdls} tier C MDL${ui.tierCPendingMdls === 1 ? "" : "s"} not counted (requires review)`
              : s.exposure.pendingActionsUnclear
                ? `+${s.exposure.pendingActionsUnclear.toLocaleString("en-US")} where role not stated`
                : s.exposure.pendingChange12m !== null
                  ? `${s.exposure.pendingChange12m >= 0 ? "+" : ""}${s.exposure.pendingChange12m.toLocaleString("en-US")} in 12 months`
                  : undefined
          }
          title="JPML pending actions of the MDLs this company's own filings name it a defendant in (tier A or B evidence). The count is for the whole docket and is shared with every co-defendant; it is not this company's share."
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
        <LitigationFinancials d={d} />
      ) : (
        <Notice>
          No XBRL litigation facts are published for this registrant (it may file without XBRL or
          only as a co-registrant).
        </Notice>
      )}

      <ReserveVsDocket d={d} />

      <div className="grid gap-3 xl:grid-cols-2">
        <PendingTrend d={d} />
        <MentionTimeline d={d} />
      </div>

      <Exposure links={d.links} records={d.mdlRecords} />
      <CorporateTransactions cik={p.cik} name={p.name} />
      {reportsToCms(p.sic) ? (
        <section aria-label="Industry payments and device reports" className="space-y-2">
          <div>
            <h3 className="text-label font-semibold text-foreground">Industry payments and device reports</h3>
            <p className="text-xs text-muted-foreground">
              CMS Open Payments and FDA MAUDE, matched on the exact registrant name. Subsidiaries
              that report under their own names are not included.
            </p>
          </div>
          <OpenPaymentsPanel name={p.name} />
        </section>
      ) : null}
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

function LitigationFinancials({ d }: { d: CompanyDetail }) {
  const f = d.financials!;
  const [grain, setGrain] = useState<Grain>("annual");
  const pts = grain === "annual" ? f.annual : f.quarterly;
  const unit =
    f.annual.revenue[0]?.unit ?? f.annual.net_income[0]?.unit ?? d.summary.currency ?? "USD";
  const lit = rowsFor(
    pts,
    ["litigation_accrual", "litigation_expense", "legal_payments", "possible_loss"],
    grain,
  );
  const accPct = f.accrualPctRevenue.map((r) => ({ label: `FY${r.fy}`, pct: r.pct }));
  const fmt = (v: number) => money(v, unit);
  const tracked = [
    "litigation_accrual",
    "litigation_expense",
    "legal_payments",
    "possible_loss",
  ] as const;
  // A registrant that tags none of the litigation concepts in either grain gets one line, not an empty chart.
  if (!tracked.some((m) => f.annual[m].length || f.quarterly[m].length))
    return (
      <p className="rounded-md border border-border bg-surface px-3 py-2 text-xs text-muted-foreground">
        Litigation accruals, expense, settlement payments and possible-loss estimates: none of these
        concepts is tagged in this registrant&rsquo;s XBRL facts.
      </p>
    );
  return (
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
      <div className="px-3 pt-2">
        <GrainToggle grain={grain} onGrain={setGrain} />
      </div>
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
  );
}

function PendingTrend({ d }: { d: CompanyDetail }) {
  // Summed from the counted links' own monthly series (tier A/B, read as defendant), not the stored profile
  // series, which also carried tier C links.
  const counted = sumSeries(
    d.links.filter((l) => l.status === "pending" && l.countsTowardExposure).map((l) => l.series),
  );
  const series = counted.map((p) => ({
    label: chartDateLabel(p.date),
    pending: p.pending,
    mdls: p.mdls ?? null,
  }));
  // Chart only MDLs read as defendant (the same rule as the KPI totals); every other pending link
  // is named with the reason it is left out, so an empty chart never reads as "nothing pending".
  const view = pendingTrendView(d.summary.mdls, counted);
  const leftOut = pendingTrendFootnote(view);
  return (
    <ChartCard
      title="Pending actions in the MDLs this company is named in (MDL-wide)"
      subtitle="Sum of JPML pending actions per monthly report for the counted MDLs: the whole dockets, shared with co-defendants"
      footnote={`Counts only MDLs whose tier A or B evidence reads the company as a defendant (not dismissed, not flagged for review); tier C links require review and are not counted. An MDL created during the window counts from its first report.${leftOut ? ` ${leftOut}` : ""}`}
    >
      {view.kind === "chart" ? (
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
        <ChartUnavailable
          reason={`${pendingTrendMessage(view) ?? ""}${
            view.kind === "none_counted"
              ? " See “MDL exposure and evidence filings” below for each link's evidence."
              : ""
          }`}
        />
      )}
    </ChartCard>
  );
}

/** Opacity of the search-only bars; the legend swatch uses the same value. */
const SEARCH_ONLY_OPACITY = 0.35;

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
        <div className="px-2 py-2">
          <SwatchLegend
            items={[
              { label: "Verified", color: FDA_COLORS[0]!, shape: "square" },
              {
                label: "Search match only",
                color: "var(--muted-foreground)",
                shape: "square",
                opacity: SEARCH_ONLY_OPACITY,
              },
            ]}
          />
          <div className="h-52">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid stroke="var(--border)" vertical={false} />
                <XAxis dataKey="year" tick={axis} interval="preserveStartEnd" minTickGap={16} />
                <YAxis
                  tick={axis}
                  width={36}
                  allowDecimals={false}
                  tickFormatter={(v: number) => v.toLocaleString("en-US")}
                />
                <Tooltip
                  formatter={(v: number, name) => [`${v.toLocaleString("en-US")} filings`, name]}
                />
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
                  fillOpacity={SEARCH_ONLY_OPACITY}
                  isAnimationActive={false}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      ) : (
        <ChartUnavailable reason="No dated filings were stored." />
      )}
    </ChartCard>
  );
}

function Exposure({
  links,
  records,
}: {
  links: CompanyLink[];
  records: Record<string, MdlRecordLookup> | null;
}) {
  const sorted = [...links].sort((a, b) => (b.pending ?? -1) - (a.pending ?? -1) || a.mdl - b.mdl);
  return (
    <section className="rounded-md border border-border bg-surface" aria-label="MDL exposure">
      <div className="border-b border-border/70 px-3 py-2">
        <h3 className="text-label font-semibold text-foreground">MDL exposure and evidence filings</h3>
        <p className="text-xs text-muted-foreground">
          Each MDL below is named in this company&apos;s own SEC filings. Expand a row for the
          filings, the matched text and an excerpt. {TIER_LABEL.C}: confirm against the filing
          before relying on it.
        </p>
      </div>
      {sorted.length ? (
        <ul>
          {sorted.map((l) => (
            <ExposureRow key={l.mdl} l={l} record={mdlRecordView(records, l.mdl)} />
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

function ExposureRow({ l, record }: { l: CompanyLink; record: ReturnType<typeof mdlRecordView> }) {
  const [open, setOpen] = useState(false);
  const id = `mdl-evidence-${l.mdl}`;
  const latest = l.verified.at(-1);
  const ref = record.ref;
  return (
    <li className="border-b border-border/50 last:border-b-0">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-2 px-3 py-2 md:grid-cols-[4rem_minmax(0,1fr)_7rem_9rem_10.5rem]">
        {ref ? (
          <Link
            to="/records/$dataset/$id"
            params={{ dataset: ref.dataset, id: ref.id }}
            className="font-mono text-xs text-primary hover:underline"
            title={
              ref.dataset === "mdl_terminated_history"
                ? "JPML terminated-litigation report record"
                : "JPML MDL report record"
            }
          >
            MDL {l.mdl}
          </Link>
        ) : (
          <span className="font-mono text-xs" title={record.note}>
            MDL {l.mdl}
          </span>
        )}
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
            <span className="text-[10px] text-muted-foreground">
              {l.tier === "C" ? "Requires review · not counted" : "Not counted in totals"}
            </span>
          ) : null}
        </div>
        <div className="text-[11px] text-muted-foreground">
          {l.verifiedCount} verified filing{l.verifiedCount === 1 ? "" : "s"}
          <div
            className="whitespace-nowrap tabular-nums"
            title="First and latest verified filing dates"
          >
            {dateSpan(l.firstVerified, l.lastVerified)}
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
