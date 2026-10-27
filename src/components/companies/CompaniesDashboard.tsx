import { useMemo, useState } from "react";
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
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts";
import { ArrowDown, ArrowUp, ExternalLink, Search } from "lucide-react";
import { ChartCard, ChartUnavailable } from "@/components/fda-analytics/FdaCharts";
import { FDA_COLORS } from "@/components/fda-analytics/chartView";
import { Input } from "@/components/ui/input";
import { InfoPopover } from "@/components/kit/InfoPopover";
import { getCompaniesIntelligence } from "@/lib/external/companies.functions";
import { cn } from "@/lib/utils";
import {
  accrualMultiples,
  count,
  EMPTY_FILTER,
  filterCompanies,
  median,
  money,
  NOT_RECORDED,
  pct,
  signedPct,
  sortCompanies,
  strengthSplit,
  mdlTitle,
  TIER_LABEL,
  type CompaniesData,
  type CompanyFilter,
  type CoverageRow,
  type CompanySummary,
  type FlagKey,
  type SortKey,
  type Tier,
} from "./companyData";
import { FlagBadge, LoadingBlocks, Notice, Spark, TierBadge } from "./CompanyUi";
import { pendingActionsValue } from "./companyViewNotes";
import { ChartCard as KitChartCard, DumbbellRange } from "@/components/charts/recharts";
import {
  AiSummary,
  AskAiButton,
  buildSectionContext,
  DataDrawer,
  KpiCard,
  KpiGrid,
  Section,
} from "@/components/kit";
import { CoverageMapSection } from "./CoverageMapSection";
import {
  accrualDumbbell,
  applyUiExposure,
  COVERAGE_GROUP_LABEL,
  coverageGroup,
  coverageMap,
  coverageTotals,
  dataFlags,
  exposureSentence,
  STALE_FY,
  uiExposure,
} from "./exposure";

export const companiesQuery = {
  queryKey: ["companies-sec-intelligence"],
  queryFn: () => getCompaniesIntelligence(),
  staleTime: 10 * 60 * 1000,
};

const axis = { fontSize: 11, fill: "var(--muted-foreground)" };
const compact = (v: number) =>
  new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(v);
const TIER_COLOR: Record<Tier, string> = {
  A: FDA_COLORS[0]!,
  B: FDA_COLORS[1]!,
  C: FDA_COLORS[2]!,
};
const PAGE = 25;

export function CompaniesDashboard() {
  const q = useQuery(companiesQuery);
  if (q.isLoading) return <LoadingBlocks label="Loading company intelligence" />;
  if (q.isError)
    return (
      <Notice tone="error">
        Company intelligence could not be loaded. {q.error instanceof Error ? q.error.message : ""}
      </Notice>
    );
  if (!q.data || !q.data.companies.length)
    return <Notice>SEC company intelligence has not been published yet.</Notice>;
  return <Dashboard data={q.data} />;
}

function Dashboard({ data: raw }: { data: CompaniesData }) {
  // Exposure under the UI rule: tier C links never count; pending actions are MDL-wide.
  const data = useMemo(() => ({ ...raw, companies: raw.companies.map(applyUiExposure) }), [raw]);
  const { overview: o, companies } = data;
  const [filter, setFilter] = useState<CompanyFilter>(EMPTY_FILTER);
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({
    key: "pending",
    dir: "desc",
  });
  const [limit, setLimit] = useState(PAGE);
  const rows = useMemo(
    () => sortCompanies(filterCompanies(companies, filter), sort.key, sort.dir),
    [companies, filter, sort],
  );
  const ratios = companies.map((c) => c.accrualPctRevenue).filter((v): v is number => v !== null);
  const flagCounts = new Map<FlagKey, number>();
  for (const c of companies)
    for (const f of c.flags) flagCounts.set(f, (flagCounts.get(f) ?? 0) + 1);
  const setF = (patch: Partial<CompanyFilter>) => {
    setFilter((f) => ({ ...f, ...patch }));
    setLimit(PAGE);
  };
  const exposed = companies.filter((c) => c.exposure.pendingMdls > 0);
  const staleExposed = exposed.filter((c) => dataFlags(c).some((f) => f.id === "stale"));
  const coverage = useMemo(() => {
    const change = new Map<number, number | null>();
    for (const [k, v] of Object.entries(raw.mdlChange ?? {})) change.set(Number(k), v);
    return coverageTotals(coverageMap(o.coverage, change).rows);
  }, [o.coverage, raw.mdlChange]);
  const share = (n: number) =>
    coverage.pending
      ? `${((n / coverage.pending) * 100).toFixed(0)}% of ${count(coverage.pending)}`
      : null;
  const kpiSource = {
    source: { label: "SEC EDGAR filings; JPML pending MDL report" },
    asOf: o.jpmlAsOf ?? o.asOf,
  };

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span>
          {count(o.companies)} SEC registrants linked to MDLs · {count(o.links)} links · built{" "}
          {o.asOf}
        </span>
        <InfoPopover label="How companies are linked" showLabel>
          <p>
            Companies are linked to an MDL only when their own SEC filing names it: the MDL number
            (tier A), the official JPML caption (tier B), or, labelled for review, the
            caption&apos;s subject next to &ldquo;MDL&rdquo; (tier C). Tier C links are shown but
            never counted as exposure here.
          </p>
          <p className="mt-2">
            JPML pending actions belong to the whole MDL and are shared by every co-defendant, so a
            company is shown as &ldquo;named in N pending MDLs with X pending actions
            (MDL-wide)&rdquo;, never as its own share.
          </p>
          <p className="mt-2">
            Links by tier: A {o.tiers.A ?? 0} · B {o.tiers.B ?? 0} · C {o.tiers.C ?? 0}.{" "}
            {count(o.companiesWithFinancials)} of {count(o.companies)} linked registrants have XBRL
            financials. Built {o.asOf}; JPML pending counts as of {o.jpmlAsOf ?? NOT_RECORDED}.
          </p>
        </InfoPopover>
      </div>
      <KpiGrid columns={5} label="Defendant exposure figures">
        <KpiCard
          as="li"
          label="Pending products-liability MDLs with an acknowledged public defendant"
          value={`${count(coverage.groups.ab.mdls)} of ${count(coverage.mdls)}`}
          meta="SEC filing cites the MDL number or caption and reads the filer as a defendant"
          source={kpiSource}
        />
        <KpiCard
          as="li"
          label="Pending actions in those MDLs"
          value={count(coverage.groups.ab.pending)}
          meta={`MDL-wide, each MDL counted once${share(coverage.groups.ab.pending) ? ` · ${share(coverage.groups.ab.pending)}` : ""}`}
          source={kpiSource}
        />
        <KpiCard
          as="li"
          label="MDLs with tier C evidence only"
          value={count(coverage.groups.c.mdls)}
          meta={`${count(coverage.groups.c.pending)} pending actions, not counted (requires review)`}
          source={kpiSource}
        />
        <KpiCard
          as="li"
          label="MDLs no SEC filer names"
          value={count(coverage.groups.none.mdls)}
          meta={`${count(coverage.groups.none.pending)} pending actions`}
          source={kpiSource}
        />
        <KpiCard
          as="li"
          label="Exposed companies with stale financials"
          value={`${count(staleExposed.length)} of ${count(exposed.length)}`}
          meta={`Latest XBRL fiscal year FY${STALE_FY} or earlier`}
          source={{ source: { label: "SEC XBRL company facts" }, asOf: o.asOf }}
        />
      </KpiGrid>

      <CoverageMapSection data={raw} />
      <AllPendingMdls coverage={o.coverage} asOf={o.jpmlAsOf ?? o.asOf} />

      <ReserveSection
        companies={companies}
        medianRatio={median(ratios)}
        ratioCount={ratios.length}
      />

      <FlagPanel
        rules={o.flagRules}
        labels={o.flagLabels}
        counts={flagCounts}
        active={filter.flag}
        onPick={(f) => setF({ flag: filter.flag === f ? "" : f })}
      />

      <section className="rounded-md border border-border bg-surface" aria-label="Ranked companies">
        <div className="flex flex-wrap items-center gap-2 border-b border-border/70 px-3 py-2">
          <h3 className="mr-auto text-label font-semibold text-foreground">Ranked companies</h3>
          <label className="relative">
            <span className="sr-only">Search companies, tickers, sectors or MDLs</span>
            <Search
              className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              value={filter.q}
              onChange={(e) => setF({ q: e.target.value })}
              placeholder="Company, ticker, sector or MDL"
              className="h-8 w-56 pl-7 text-xs"
            />
          </label>
          <select
            aria-label="Strongest counted evidence tier"
            value={filter.tier}
            onChange={(e) => setF({ tier: e.target.value as CompanyFilter["tier"] })}
            className="h-8 rounded-md border border-border bg-surface px-2 text-xs"
          >
            <option value="">All evidence tiers</option>
            {(["A", "B"] as const).map((t) => (
              <option key={t} value={t}>
                Strongest: {t} · {TIER_LABEL[t]}
              </option>
            ))}
          </select>
          <Toggle
            on={filter.pendingOnly}
            onClick={() => setF({ pendingOnly: !filter.pendingOnly })}
            title="Shows companies named in at least one pending MDL counted as exposure: tier A or B evidence, the excerpt reads the company as a defendant, no dismissal and no review note. Tier C links and links whose role is not stated are not counted."
          >
            Counted pending MDLs only
          </Toggle>
          <Toggle on={filter.financials} onClick={() => setF({ financials: !filter.financials })}>
            With financials
          </Toggle>
          {filter !== EMPTY_FILTER ? (
            <button
              type="button"
              onClick={() => setF(EMPTY_FILTER)}
              className="text-xs text-primary hover:underline"
            >
              Reset
            </button>
          ) : null}
        </div>
        {rows.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-xs">
              <thead className="text-left text-muted-foreground">
                <tr className="border-b border-border/70">
                  <Th k="name" sort={sort} setSort={setSort}>
                    Company
                  </Th>
                  <Th k="mdls" sort={sort} setSort={setSort} right>
                    MDLs
                  </Th>
                  <Th k="pending" sort={sort} setSort={setSort} right>
                    Pending in named MDLs (MDL-wide)
                  </Th>
                  <Th k="revenue" sort={sort} setSort={setSort} right>
                    Revenue
                  </Th>
                  <Th k="net_income" sort={sort} setSort={setSort} right>
                    Net income
                  </Th>
                  <Th k="accrual" sort={sort} setSort={setSort} right>
                    Accrual
                  </Th>
                  <Th k="accrual_pct" sort={sort} setSort={setSort} right>
                    % rev.
                  </Th>
                  <Th k="accrual_yoy" sort={sort} setSort={setSort} right wide>
                    YoY
                  </Th>
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, limit).map((c) => (
                  <CompanyRow
                    key={c.profile.cik}
                    c={c}
                    flagLabels={o.flagLabels}
                    flagRules={o.flagRules}
                  />
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p role="status" className="px-3 py-6 text-sm text-muted-foreground">
            {filter.q.trim()
              ? `No linked company matches “${filter.q.trim()}”${
                  filter.tier || filter.flag || filter.financials || filter.pendingOnly
                    ? " with the selected filters"
                    : ""
                }.`
              : "No linked company matches these filters."}{" "}
            <button
              type="button"
              onClick={() => setF(EMPTY_FILTER)}
              className="text-primary underline"
            >
              Reset filters
            </button>
          </p>
        )}
        <div className="flex flex-wrap items-center gap-3 border-t border-border/60 px-3 py-1.5 text-xs text-muted-foreground">
          <span>
            Showing {Math.min(limit, rows.length)} of {rows.length}. Pending actions are the JPML
            count of each counted MDL, for the whole docket and shared with co-defendants: never add
            them across companies. Accrual is the company-wide XBRL loss-contingency figure, not an
            MDL reserve. &ldquo;Not recorded&rdquo; = no such XBRL fact. Co-registrant flags here
            use the stored co-registrant list, which is incomplete (some appear only on the company
            page).
          </span>
          {rows.length > limit ? (
            <button
              type="button"
              onClick={() => setLimit((l) => l + PAGE)}
              className="font-medium text-primary hover:underline"
            >
              Show {Math.min(PAGE, rows.length - limit)} more
            </button>
          ) : null}
        </div>
      </section>

      <AccrualMultiples companies={companies} />
      <FilingsByYear data={o.filingsByYear} />
      <details className="rounded-md border border-border bg-surface px-3 py-2 text-xs text-muted-foreground">
        <summary className="cursor-pointer font-medium text-foreground">Method and limits</summary>
        <ul className="mt-2 list-disc space-y-1 pl-4">
          {o.method.map((m) => (
            <li key={m}>{m}</li>
          ))}
        </ul>
      </details>
    </div>
  );
}

/**
 * Every pending MDL of any litigation type (the coverage map above covers Products Liability only), with the SEC
 * filers that name it. Restores the former all-types coverage table behind "View data". Pending actions are MDL-wide.
 */
function AllPendingMdls({ coverage, asOf }: { coverage: CoverageRow[]; asOf: string }) {
  const rows = useMemo(() => {
    const seen = new Set<number>();
    return coverage
      .filter((r) => r.status === "pending" && !seen.has(r.mdl) && seen.add(r.mdl))
      .sort((a, b) => (b.pending ?? -1) - (a.pending ?? -1) || a.mdl - b.mdl);
  }, [coverage]);
  if (!rows.length) return null;
  const counted = (r: CoverageRow) =>
    r.companies.filter(
      (c) => c.counted && c.tier !== "C" && c.role === "defendant" && !c.dismissed && !c.review,
    );
  return (
    <div className="-mt-4 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
      <span>The map covers Products Liability MDLs only.</span>
      <DataDrawer
        title="Pending MDLs of every type and the SEC filers that name them"
        description="Pending actions belong to the whole MDL (JPML). A filer counts only when its filing cites the MDL number or caption (tier A or B) and reads it as a defendant; tier C links require review and never count."
        rows={rows}
        rowKey={(r) => String(r.mdl)}
        triggerLabel={`View all ${count(rows.length)} pending MDLs`}
        searchable
        columns={[
          { key: "mdl", label: "MDL", value: (r) => r.mdl },
          {
            key: "title",
            label: "Litigation",
            value: (r) => r.title,
            render: (r) => mdlTitle(r.title, r.titleTruncated, r.mdl),
          },
          { key: "type", label: "Type", value: (r) => r.type },
          {
            key: "pending",
            label: "Pending actions (MDL-wide)",
            align: "right",
            value: (r) => r.pending,
          },
          {
            key: "group",
            label: "Evidence",
            value: (r) => COVERAGE_GROUP_LABEL[coverageGroup(r.companies)],
          },
          {
            key: "counted",
            label: "Acknowledged defendants",
            value: (r) =>
              counted(r)
                .map((c) => c.name)
                .join("; ") || null,
          },
          {
            key: "other",
            label: "Other filers naming it (not counted)",
            value: (r) => {
              const keep = new Set(counted(r));
              return (
                r.companies
                  .filter((c) => !keep.has(c))
                  .map(
                    (c) =>
                      `${c.name} (${c.tier === "C" ? "tier C, requires review" : c.dismissed ? "dismissed" : c.review ? "review" : c.role})`,
                  )
                  .join("; ") || null
              );
            },
          },
        ]}
        source={{
          source: { label: "JPML pending MDL report; SEC EDGAR filings" },
          asOf,
        }}
      />
    </div>
  );
}

function Toggle({
  on,
  onClick,
  title,
  children,
}: {
  on: boolean;
  onClick: () => void;
  title?: string | undefined;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      title={title}
      className={cn(
        "h-8 rounded-md border px-2 text-xs focus-visible:outline-2 focus-visible:outline-ring",
        on
          ? "border-primary bg-primary/10 text-primary"
          : "border-border bg-surface text-muted-foreground hover:bg-muted",
      )}
    >
      {children}
    </button>
  );
}

function Th({
  k,
  sort,
  setSort,
  right,
  wide,
  children,
}: {
  k: SortKey;
  sort: { key: SortKey; dir: "asc" | "desc" };
  setSort: (s: { key: SortKey; dir: "asc" | "desc" }) => void;
  right?: boolean;
  /** Shown only on wide screens (its value moves into the previous cell below xl). */
  wide?: boolean;
  children: React.ReactNode;
}) {
  const active = sort.key === k;
  return (
    <th
      className={cn(
        "px-2 py-1.5 font-medium",
        right && "text-right",
        wide && "hidden xl:table-cell",
      )}
      aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}
    >
      <button
        type="button"
        onClick={() =>
          setSort({
            key: k,
            dir: active && sort.dir === "desc" ? "asc" : k === "name" && !active ? "asc" : "desc",
          })
        }
        className={cn(
          "inline-flex items-center gap-0.5 hover:text-foreground",
          active && "text-foreground",
        )}
      >
        {children}
        {active ? (
          sort.dir === "asc" ? (
            <ArrowUp className="size-3" aria-hidden />
          ) : (
            <ArrowDown className="size-3" aria-hidden />
          )
        ) : null}
      </button>
    </th>
  );
}

function CompanyRow({
  c,
  flagLabels,
  flagRules,
}: {
  c: CompanySummary;
  flagLabels: Partial<Record<FlagKey, string>>;
  flagRules: Partial<Record<FlagKey, string>>;
}) {
  const p = c.profile;
  const acc = c.latest.litigation_accrual;
  const ui = uiExposure(c.mdls);
  const flags = dataFlags(c);
  const tickerSic =
    [p.tickers.slice(0, 2).join(", "), p.sicDescription].filter(Boolean).join(" · ") ||
    "Ticker and SIC not recorded";
  return (
    <tr className="border-b border-border/50 align-top hover:bg-muted/30">
      <td className="max-w-[220px] px-2 py-1.5">
        <Link
          to="/companies/$cik"
          params={{ cik: p.cik }}
          className="font-medium text-primary hover:underline"
        >
          {p.name}
        </Link>
        <div className="truncate text-[11px] text-muted-foreground" title={tickerSic}>
          {tickerSic}
        </div>
        <div className="mt-0.5 flex flex-wrap gap-1">
          {c.exposure.strongestTier ? (
            <TierBadge tier={c.exposure.strongestTier} />
          ) : (
            <span
              className="text-[11px] text-muted-foreground"
              title="No pending MDL where its filing reads it as a defendant"
            >
              No counted pending MDL
            </span>
          )}
          {c.flags.map((f) => (
            <FlagBadge key={f} flag={f} label={flagLabels[f] ?? f} rule={flagRules[f]} />
          ))}
          {flags.map((f) => (
            <span
              key={f.id}
              title={f.detail}
              className="rounded border border-warning/40 bg-warning/10 px-1 text-[10px] font-medium text-foreground"
            >
              {f.label}
            </span>
          ))}
        </div>
      </td>
      <td className="px-2 py-1.5 text-right tabular-nums">
        {c.exposure.linkedMdls}
        <div className="text-[11px] text-muted-foreground">{c.exposure.pendingMdls} counted</div>
      </td>
      <td className="px-2 py-1.5 text-right tabular-nums" title={exposureSentence(ui)}>
        {c.exposure.pendingMdls ? (
          count(c.exposure.pendingActions)
        ) : (
          <span className="text-muted-foreground">{pendingActionsValue(c.exposure)}</span>
        )}
        {c.exposure.pendingMdls ? (
          <div className="whitespace-nowrap text-[11px] text-muted-foreground">
            in {c.exposure.pendingMdls} MDL{c.exposure.pendingMdls === 1 ? "" : "s"}, MDL-wide
          </div>
        ) : null}
        {ui.tierCPendingMdls ? (
          <div
            className="whitespace-nowrap text-[11px] italic text-muted-foreground"
            title="Tier C evidence describes the MDL by its subject only; it requires review and is not counted"
          >
            +{ui.tierCPendingMdls} tier C (not counted)
          </div>
        ) : null}
        {c.exposure.pendingActionsUnclear ? (
          <div
            className="whitespace-nowrap text-[11px] italic text-muted-foreground"
            title="Role not stated in the evidence excerpt; not counted"
          >
            +{c.exposure.pendingActionsUnclear.toLocaleString("en-US")} role not stated
          </div>
        ) : null}
        {c.exposure.pendingChange12m !== null ? (
          <div
            className={cn(
              "text-[11px]",
              c.exposure.pendingChange12m > 0 ? "text-destructive" : "text-muted-foreground",
            )}
          >
            {c.exposure.pendingChange12m > 0 ? "+" : ""}
            {c.exposure.pendingChange12m.toLocaleString("en-US")} 12m
          </div>
        ) : null}
      </td>
      <td className="px-2 py-1.5 text-right tabular-nums">
        {money(c.latest.revenue?.value, c.latest.revenue?.unit)}
        {c.latest.revenue ? (
          <div className="text-[11px] text-muted-foreground">FY{c.latest.revenue.fy}</div>
        ) : null}
        <div className="mt-0.5 flex justify-end">
          <Spark
            values={c.spark.revenue.map((x) => x.v)}
            color={FDA_COLORS[0]}
            width={56}
            height={14}
            label={`${p.name} revenue trend`}
          />
        </div>
      </td>
      <td
        className={cn(
          "px-2 py-1.5 text-right tabular-nums",
          (c.latest.net_income?.value ?? 0) < 0 && "text-destructive",
        )}
      >
        {money(c.latest.net_income?.value, c.latest.net_income?.unit)}
      </td>
      <td
        className={cn(
          "px-2 py-1.5 text-right tabular-nums",
          acc && !c.accrualCurrent && "text-muted-foreground",
        )}
      >
        {money(acc?.value, acc?.unit)}
        {acc ? (
          <div className="whitespace-nowrap text-[11px] text-muted-foreground">
            FY{acc.fy}
            {c.accrualCurrent ? "" : ", not current"}
          </div>
        ) : null}
        <div className="mt-0.5 flex justify-end">
          <Spark
            values={c.spark.litigation_accrual.map((x) => x.v)}
            color={FDA_COLORS[2]}
            width={56}
            height={14}
            label={`${p.name} accrual trend`}
          />
        </div>
      </td>
      <td className="px-2 py-1.5 text-right tabular-nums">
        {acc && !c.accrualCurrent ? (
          <span className="text-muted-foreground">Not current</span>
        ) : (
          pct(c.accrualPctRevenue, 2)
        )}
        {c.accrualYoyPct !== null ? (
          <div
            className={cn(
              "whitespace-nowrap text-[11px] text-muted-foreground xl:hidden",
              c.accrualYoyPct >= 50 && "font-semibold text-destructive",
            )}
          >
            YoY {signedPct(c.accrualYoyPct)}
          </div>
        ) : null}
      </td>
      <td
        className={cn(
          "hidden px-2 py-1.5 text-right tabular-nums xl:table-cell",
          (c.accrualYoyPct ?? 0) >= 50 && "font-semibold text-destructive",
        )}
      >
        {signedPct(c.accrualYoyPct)}
      </td>
    </tr>
  );
}

function FilingsByYear({ data }: { data: CompaniesData["overview"]["filingsByYear"] }) {
  const rows = data.filter((r) => r.year >= 2005);
  return (
    <ChartCard
      title="Verified filings naming linked MDLs, by year"
      subtitle="Distinct filings (accessions) whose text passed the evidence rule, by filing year and tier"
      footnote="Source: SEC EDGAR full-text search candidates, re-checked against filing documents. Full-text search covers 2001 onward."
    >
      {rows.length ? (
        <div className="h-72 px-2 py-2">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid stroke="var(--border)" vertical={false} />
              <XAxis dataKey="year" tick={axis} interval="preserveStartEnd" minTickGap={16} />
              <YAxis
                tick={axis}
                width={40}
                allowDecimals={false}
                tickFormatter={(v: number) => v.toLocaleString("en-US")}
              />
              <Tooltip
                formatter={(v: number, name) => [`${v.toLocaleString("en-US")} filings`, name]}
              />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar
                dataKey="A"
                name="A · MDL number"
                stackId="t"
                fill={TIER_COLOR.A}
                isAnimationActive={false}
              />
              <Bar
                dataKey="B"
                name="B · caption"
                stackId="t"
                fill={TIER_COLOR.B}
                isAnimationActive={false}
              />
              <Bar
                dataKey="C"
                name="C · subject (review)"
                stackId="t"
                fill={TIER_COLOR.C}
                isAnimationActive={false}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <ChartUnavailable reason="No verified filings were stored." />
      )}
    </ChartCard>
  );
}

function FlagPanel({
  rules,
  labels,
  counts,
  active,
  onPick,
}: {
  rules: Partial<Record<FlagKey, string>>;
  labels: Partial<Record<FlagKey, string>>;
  counts: Map<FlagKey, number>;
  active: "" | FlagKey;
  onPick: (f: FlagKey) => void;
}) {
  const keys = Object.keys(rules) as FlagKey[];
  if (!keys.length) return null;
  return (
    <section className="rounded-md border border-border bg-surface p-3" aria-label="Cluster flags">
      <h3 className="text-label font-semibold text-foreground">Cluster flags</h3>
      <p className="text-xs text-muted-foreground">
        Deterministic rules over the published numbers. Select a flag to filter the table.
      </p>
      <div className="mt-2 grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
        {keys.map((k) => (
          <button
            key={k}
            type="button"
            aria-pressed={active === k}
            onClick={() => onPick(k)}
            className={cn(
              "rounded-md border px-2.5 py-2 text-left hover:bg-muted/40 focus-visible:outline-2 focus-visible:outline-ring",
              active === k ? "border-primary ring-1 ring-primary/30" : "border-border",
            )}
          >
            <span className="flex items-baseline justify-between gap-2">
              <span className="text-xs font-medium">{labels[k] ?? k}</span>
              <span className="font-mono text-base font-semibold tabular-nums">
                {counts.get(k) ?? 0}
              </span>
            </span>
            <span className="mt-0.5 block text-[11px] leading-4 text-muted-foreground">
              {rules[k]}
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}

function AccrualMultiples({ companies }: { companies: CompanySummary[] }) {
  const picks = accrualMultiples(companies);
  return (
    <ChartCard
      title="Litigation accruals over time"
      subtitle="Small multiples, each on its own scale: fiscal-year-end loss-contingency / litigation accrual (XBRL), largest 12 with 3+ years"
      footnote="Dashed line = the company's median accrual over the years shown. Each series uses one XBRL concept for the whole company so its definition never changes mid-series."
    >
      {picks.length ? (
        <div className="grid grid-cols-2 gap-px bg-border/60 sm:grid-cols-3 xl:grid-cols-4">
          {picks.map((c) => {
            const pts = c.spark.litigation_accrual;
            const med = median(pts.map((p) => p.v));
            const unit = c.latest.litigation_accrual?.unit ?? "USD";
            return (
              <div key={c.profile.cik} className="min-w-0 bg-surface px-2 py-1.5">
                <div className="flex items-baseline justify-between gap-1">
                  <Link
                    to="/companies/$cik"
                    params={{ cik: c.profile.cik }}
                    className="truncate text-xs font-medium text-primary hover:underline"
                    title={c.profile.name}
                  >
                    {c.profile.name}
                  </Link>
                  <span className="shrink-0 font-mono text-[11px] tabular-nums">
                    {money(pts.at(-1)?.v, unit)}
                  </span>
                </div>
                <div className="h-16">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart
                      data={pts.map((p) => ({ fy: p.fy, v: p.v, m: med }))}
                      margin={{ top: 4, right: 2, bottom: 0, left: 2 }}
                    >
                      <XAxis dataKey="fy" hide />
                      <YAxis hide domain={["auto", "auto"]} />
                      <Tooltip
                        contentStyle={{ fontSize: 11, padding: "2px 6px" }}
                        labelFormatter={(fy) => `FY${fy}`}
                        formatter={(v: number, k) => [
                          money(v, unit),
                          k === "m" ? "Median" : "Accrual",
                        ]}
                      />
                      <Line
                        dataKey="m"
                        stroke="var(--muted-foreground)"
                        strokeDasharray="3 3"
                        dot={false}
                        strokeWidth={1}
                        isAnimationActive={false}
                      />
                      <Line
                        dataKey="v"
                        stroke={FDA_COLORS[2]}
                        strokeWidth={1.75}
                        dot={false}
                        isAnimationActive={false}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
                <div className="flex justify-between text-[10px] text-muted-foreground">
                  <span>FY{pts[0]?.fy}</span>
                  <span>FY{pts.at(-1)?.fy}</span>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <ChartUnavailable reason="No linked company reports three or more years of litigation accrual facts." />
      )}
    </ChartCard>
  );
}

const XBRL_SOURCE = {
  label: "SEC XBRL company facts (company_sec_profiles)",
  url: "https://www.sec.gov/edgar/sec-api-documentation",
};

/**
 * Reserves against revenue: each company's litigation accrual as a share of same-year revenue in its latest two
 * consecutive fiscal years (current filers only; stale financials are left out). The per-company reserve vs docket
 * index chart is on each company page.
 */
function ReserveSection({
  companies,
  medianRatio,
  ratioCount,
}: {
  companies: CompanySummary[];
  medianRatio: number | null;
  ratioCount: number;
}) {
  // every qualifying company counts toward "rising"; the chart shows the 15 with the highest latest share
  const all = useMemo(() => accrualDumbbell(companies, Infinity), [companies]);
  const rows = useMemo(() => all.slice(0, 15), [all]);
  const rising = all.filter((r) => r.b > r.a).length;
  const context = useMemo(
    () =>
      buildSectionContext({
        title: "Litigation accruals as a share of revenue",
        scope: "SEC registrants named in MDLs, current XBRL filers",
        source: XBRL_SOURCE.label,
        figures: [
          {
            label: "Median accrual / revenue, current FY",
            value: medianRatio,
            unit: "%",
            decimals: 2,
          },
          { label: "Companies in the median", value: ratioCount },
          { label: "Companies with two consecutive fiscal years", value: all.length },
          { label: "Of those, accrual share rose in the latest year", value: rising },
          ...rows.flatMap((r) => [
            {
              label: `${r.label} accrual / revenue`,
              value: r.a,
              unit: "%",
              period: r.note.split(" → ")[0],
              decimals: 2,
            },
            {
              label: `${r.label} accrual / revenue`,
              value: r.b,
              unit: "%",
              period: r.note.split(" → ")[1],
              decimals: 2,
            },
          ]),
        ],
      }),
    [rows, all.length, rising, medianRatio, ratioCount],
  );
  return (
    <Section
      id="reserves"
      title="Are reserves keeping pace?"
      description="Company-wide litigation accruals as a share of revenue, prior against latest fiscal year."
      actions={<AskAiButton sectionId="reserves" context={context} />}
    >
      <KitChartCard
        variant="editorial"
        title={
          rows.length
            ? `${rising} of ${all.length} companies raised their accrual's share of revenue in the latest year`
            : "Litigation accruals as a share of revenue"
        }
        subtitle={`${all.length > rows.length ? `Showing the ${rows.length} with the highest latest share · ` : ""}Litigation / loss-contingency accrual ÷ same-year revenue · % · median ${medianRatio === null ? NOT_RECORDED : `${medianRatio.toFixed(2)}%`} across ${ratioCount} current filers`}
        sources={[XBRL_SOURCE]}
        status={
          rows.length
            ? { kind: "ready" }
            : {
                kind: "empty",
                reason: "No current filer reports an accrual and revenue in two consecutive years.",
              }
        }
        about={
          <>
            <p>
              The accrual is the company&rsquo;s whole loss-contingency or litigation reserve under
              the XBRL concept it uses, not a reserve for any one MDL; concepts differ between
              companies. Only companies whose latest XBRL fiscal year is after FY{STALE_FY} are
              shown.
            </p>
            <p className="mt-2">
              Each company page sets its accrual against the pending actions of the MDLs it is named
              in (an index chart rebased to a date you choose).
            </p>
          </>
        }
        table={{
          caption:
            "Accrual as % of revenue, prior and latest fiscal year (every qualifying company)",
          columns: [
            { label: "Company" },
            { label: "Fiscal years" },
            { label: "Prior FY", align: "right" },
            { label: "Latest FY", align: "right" },
          ],
          rows: all.map((r) => ({
            key: r.id,
            cells: [r.label, r.note, `${r.a.toFixed(2)}%`, `${r.b.toFixed(2)}%`],
          })),
        }}
      >
        <DumbbellRange
          rows={rows.map((r) => ({ id: r.id, label: r.label, a: r.a, b: r.b, note: r.note }))}
          aLabel="Prior FY"
          bLabel="Latest FY"
          format={(v) => `${v.toFixed(2)}%`}
          gapLabel="Change (points)"
          ariaLabel="Litigation accrual as a share of revenue, prior and latest fiscal year"
        />
      </KitChartCard>
      <AiSummary context={context} className="mt-4" />
    </Section>
  );
}
