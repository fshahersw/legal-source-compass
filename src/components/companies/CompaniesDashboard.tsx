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
  type CompanySummary,
  type FlagKey,
  type SortKey,
  type Tier,
} from "./companyData";
import {
  FlagBadge,
  Kpi,
  LoadingBlocks,
  Notice,
  RoleText,
  SourceLine,
  Spark,
  TierBadge,
} from "./CompanyUi";
import { pendingActionsValue } from "./companyViewNotes";

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

function Dashboard({ data }: { data: CompaniesData }) {
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

  return (
    <div className="space-y-4">
      <SourceLine>
        Companies are linked to an MDL only when their own SEC filing names it: the MDL number (tier
        A), the official JPML caption (tier B), or — labelled for review — the caption&apos;s
        subject next to &ldquo;MDL&rdquo; (tier C). Every link was re-checked against the downloaded
        filing text. Financials are the registrant&apos;s own XBRL facts. Built {o.asOf}; JPML
        pending counts as of {o.jpmlAsOf ?? NOT_RECORDED}.
      </SourceLine>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Kpi
          label="SEC registrants linked"
          value={count(o.companies)}
          note={`${count(o.companiesWithFinancials)} with XBRL financials`}
        />
        <Kpi
          label="Company–MDL links"
          value={count(o.links)}
          note={`A ${o.tiers.A ?? 0} · B ${o.tiers.B ?? 0} · C ${o.tiers.C ?? 0}`}
        />
        <Kpi
          label="Pending MDLs linked"
          value={`${o.pendingMdlsWithLinks} / ${o.pendingTargets}`}
          note="pending mass-tort MDLs searched"
        />
        <Kpi
          label="Pending actions, defendants"
          value={count(o.pendingActionsCounted)}
          note={strengthSplit(o.pendingActionsCountedAB, o.pendingActionsCountedC) ?? undefined}
          detail={`+${count(o.pendingActionsUnclearOnly)} where role not stated (not counted)`}
          title="Each pending MDL counted once, when at least one linked company's own filing reads it as a defendant. A/B = MDL number or caption evidence; C = subject evidence (requires review)."
        />
        <Kpi
          label="Verified filings"
          value={count(o.verifiedFilings)}
          note="filing documents re-checked"
        />
        <Kpi
          label="Median accrual / revenue"
          value={pct(median(ratios), 2)}
          note={`${ratios.length} companies, current FY only`}
          title="Same-year litigation accrual / revenue, only for accruals from a company's latest or prior fiscal year while it still files XBRL."
        />
      </div>

      <div className="grid gap-3 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <ExposureScatter companies={companies} />
        <FilingsByYear data={o.filingsByYear} />
      </div>

      <FlagPanel
        rules={o.flagRules}
        labels={o.flagLabels}
        counts={flagCounts}
        active={filter.flag}
        onPick={(f) => setF({ flag: filter.flag === f ? "" : f })}
      />

      <section className="rounded-md border border-border bg-surface" aria-label="Ranked companies">
        <div className="flex flex-wrap items-center gap-2 border-b border-border/70 px-3 py-2">
          <h3 className="mr-auto text-sm font-semibold">Ranked companies</h3>
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
            aria-label="Strongest evidence tier"
            value={filter.tier}
            onChange={(e) => setF({ tier: e.target.value as CompanyFilter["tier"] })}
            className="h-8 rounded-md border border-border bg-surface px-2 text-xs"
          >
            <option value="">All evidence tiers</option>
            {(["A", "B", "C"] as const).map((t) => (
              <option key={t} value={t}>
                Strongest: {t} · {TIER_LABEL[t].replace(" (requires review)", "")}
              </option>
            ))}
          </select>
          <Toggle
            on={filter.pendingOnly}
            onClick={() => setF({ pendingOnly: !filter.pendingOnly })}
            title="Shows companies with at least one pending MDL counted as defendant exposure: the evidence excerpt reads the company as a defendant, no dismissal is reported and the link is not flagged for review. A pending MDL where the role is not stated is not counted."
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
                    Pending actions
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
            Showing {Math.min(limit, rows.length)} of {rows.length}. Pending actions sum the JPML
            count of each linked pending MDL (excluding links whose excerpt says the company is not
            named or is a claimant). Accrual is the company&apos;s total reported loss-contingency /
            litigation accrual for the XBRL concept named on its page, not an MDL-specific reserve.
            &ldquo;Not recorded&rdquo; = no such XBRL fact.
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
      <Coverage data={data} />
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
        </div>
      </td>
      <td className="px-2 py-1.5 text-right tabular-nums">
        {c.exposure.linkedMdls}
        <div className="text-[11px] text-muted-foreground">{c.exposure.pendingMdls} counted</div>
      </td>
      <td className="px-2 py-1.5 text-right tabular-nums">
        {c.exposure.pendingMdls ? (
          count(c.exposure.pendingActions)
        ) : (
          <span className="text-muted-foreground">{pendingActionsValue(c.exposure)}</span>
        )}
        {strengthSplit(c.exposure.pendingActionsAB, c.exposure.pendingActionsC) ? (
          <div className="whitespace-nowrap text-[11px] text-muted-foreground">
            {strengthSplit(c.exposure.pendingActionsAB, c.exposure.pendingActionsC)}
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

function ExposureScatter({ companies }: { companies: CompanySummary[] }) {
  const points = companies
    .filter(
      (c) =>
        (c.exposure.pendingActions ?? 0) > 0 &&
        (c.latest.litigation_accrual?.value ?? 0) > 0 &&
        c.latest.litigation_accrual?.unit === "USD" &&
        c.accrualCurrent,
    )
    .map((c) => ({
      name: c.profile.name,
      pending: c.exposure.pendingActions!,
      accrual: c.latest.litigation_accrual!.value,
      fy: c.latest.litigation_accrual!.fy,
      flagged: c.flags.length > 0,
    }));
  const flagged = points.filter((p) => p.flagged);
  const plain = points.filter((p) => !p.flagged);
  return (
    <ChartCard
      title="Pending MDL actions vs litigation accrual"
      subtitle="Each dot is a company: JPML pending actions in MDLs where its filings read it as a defendant (x) against its current XBRL accrual in USD (y), log scales"
      footnote={`${points.length} companies with a current accrual (latest or prior fiscal year). Red dots carry at least one flag. The accrual is company-wide, covering all loss contingencies, not only these MDLs.`}
    >
      {points.length < 2 ? (
        <ChartUnavailable reason="Fewer than two companies report both a USD litigation accrual and pending actions in linked MDLs." />
      ) : (
        <div className="h-72 px-2 py-2">
          <ResponsiveContainer width="100%" height="100%">
            <ScatterChart margin={{ top: 8, right: 16, bottom: 18, left: 4 }}>
              <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
              <XAxis
                type="number"
                dataKey="pending"
                name="Pending actions"
                scale="log"
                domain={["auto", "auto"]}
                tick={axis}
                tickFormatter={compact}
                label={{
                  value: "Pending actions (log)",
                  position: "insideBottom",
                  offset: -10,
                  fontSize: 11,
                  fill: "var(--muted-foreground)",
                }}
              />
              <YAxis
                type="number"
                dataKey="accrual"
                name="Accrual"
                scale="log"
                domain={["auto", "auto"]}
                tick={axis}
                tickFormatter={(v: number) => money(v, "USD")}
                width={60}
              />
              <ZAxis range={[48, 48]} />
              <Tooltip
                cursor={{ strokeDasharray: "3 3" }}
                content={({ payload }) => {
                  const d = payload?.[0]?.payload as (typeof points)[number] | undefined;
                  if (!d) return null;
                  return (
                    <div className="rounded border border-border bg-surface px-2 py-1 text-xs shadow-sm">
                      <div className="font-medium">{d.name}</div>
                      <div>Pending actions: {d.pending.toLocaleString("en-US")}</div>
                      <div>
                        Accrual FY{d.fy}: {money(d.accrual, "USD")}
                      </div>
                    </div>
                  );
                }}
              />
              <Scatter name="No flag" data={plain} fill={FDA_COLORS[0]} isAnimationActive={false} />
              <Scatter
                name="Flagged"
                data={flagged}
                fill="var(--destructive)"
                isAnimationActive={false}
              />
            </ScatterChart>
          </ResponsiveContainer>
        </div>
      )}
    </ChartCard>
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
      <h3 className="text-sm font-semibold">Cluster flags</h3>
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

function Coverage({ data }: { data: CompaniesData }) {
  const [all, setAll] = useState(false);
  const pending = data.overview.coverage.filter((c) => c.status === "pending");
  const shown = all ? pending : pending.slice(0, 15);
  const unlinked = pending.filter((c) => !c.companies.length).length;
  return (
    <section
      className="rounded-md border border-border bg-surface"
      aria-label="Pending MDL coverage"
    >
      <div className="border-b border-border/70 px-3 py-2">
        <h3 className="text-sm font-semibold">
          Pending mass-tort MDLs and the SEC filers that name them
        </h3>
        <p className="text-xs text-muted-foreground">
          Ranked by JPML pending actions. {unlinked} of {pending.length} pending MDLs have no SEC
          registrant whose filing matched the rules (recall is incomplete; many defendants are
          private or foreign non-filers).
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-xs">
          <thead className="text-left text-muted-foreground">
            <tr className="border-b border-border/70">
              <th className="px-2 py-1.5 font-medium">MDL</th>
              <th className="px-2 py-1.5 font-medium">Litigation</th>
              <th className="px-2 py-1.5 text-right font-medium">Pending</th>
              <th className="px-2 py-1.5 font-medium">Linked SEC filers (tier · excerpt role)</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((m) => (
              <tr key={m.mdl} className="border-b border-border/50 align-top">
                <td className="px-2 py-1.5 font-mono">
                  <Link
                    to="/records/$dataset/$id"
                    params={{ dataset: "mdl_analytics", id: String(m.mdl) }}
                    className="text-primary hover:underline"
                  >
                    {m.mdl}
                  </Link>
                </td>
                <td className="max-w-[320px] px-2 py-1.5">
                  {mdlTitle(m.title, m.titleTruncated, m.mdl)}
                </td>
                <td className="px-2 py-1.5 text-right tabular-nums">{count(m.pending)}</td>
                <td className="px-2 py-1.5">
                  {m.companies.length ? (
                    <ul className="flex flex-wrap gap-x-3 gap-y-0.5">
                      {m.companies.slice(0, 8).map((c) => (
                        <li key={c.cik} className="inline-flex items-center gap-1">
                          <Link
                            to="/companies/$cik"
                            params={{ cik: c.cik }}
                            className="text-primary hover:underline"
                          >
                            {c.name}
                          </Link>
                          {!c.counted ? (
                            <span className="text-[10px] text-muted-foreground">
                              {c.dismissed ? "dismissed" : c.review ? "review" : "not counted"}
                            </span>
                          ) : null}
                          <span className="font-mono text-[10px] text-muted-foreground">
                            {c.tier}
                          </span>
                          <RoleText role={c.role} />
                        </li>
                      ))}
                      {m.companies.length > 8 ? (
                        <li className="text-muted-foreground">+{m.companies.length - 8} more</li>
                      ) : null}
                    </ul>
                  ) : (
                    <span className="text-muted-foreground">
                      No filing matched the rules (recall incomplete)
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex items-center gap-3 border-t border-border/60 px-3 py-1.5 text-xs text-muted-foreground">
        <span>
          Source: JPML pending MDL reports (dataset mdl_analytics) and SEC EDGAR filings.{" "}
          <a
            href="https://efts.sec.gov/LATEST/search-index?q=%22MDL%20No.%22"
            className="inline-flex items-center gap-0.5 text-primary hover:underline"
            target="_blank"
            rel="noreferrer"
          >
            EDGAR full-text search <ExternalLink className="size-3" aria-hidden />
          </a>
        </span>
        {pending.length > 15 ? (
          <button
            type="button"
            onClick={() => setAll((v) => !v)}
            className="ml-auto font-medium text-primary hover:underline"
          >
            {all ? "Show top 15" : `Show all ${pending.length}`}
          </button>
        ) : null}
      </div>
    </section>
  );
}
