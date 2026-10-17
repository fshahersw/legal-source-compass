import { useMemo, useState, type JSX } from "react";
import { Link } from "@tanstack/react-router";
import {
  AlertTriangle,
  Apple,
  CalendarDays,
  CalendarX,
  Car,
  Gavel,
  Landmark,
  Minus,
  Package,
  Pill,
  SprayCan,
  Stethoscope,
  TrendingDown,
  TrendingUp,
  type LucideIcon,
} from "lucide-react";
import {
  Area,
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

/* ---------------------------------- types --------------------------------- */

type MdlPoint = { date: string; pending: number; total: number };

type MdlRow = {
  mdl: number;
  title: string;
  type: string | null;
  massTort: boolean;
  status: "pending" | "terminated" | "no_longer_listed";
  district: string | null;
  judge: string | null;
  pending: number;
  total: number;
  change1m: number | null;
  change3m: number | null;
  change12m: number | null;
  new12m: number | null;
  resolved12m: number | null;
  ageYears: number | null;
  growth: string;
  dateTransferred: string | null;
  dateClosed: string | null;
  rank: number | null;
  sharePct: number | null;
  series: MdlPoint[];
};

type Signal = {
  product: string;
  kind: "drug" | "device" | "food" | "cosmetic" | "vehicle";
  source: string;
  caveat: string;
  eventTotal: number | null;
  eventsByYear: Record<string, number>;
  breakdown: Record<string, number>;
  topTerms: { term: string; count: number }[];
  recallTotal: number | null;
  recentRecalls: {
    recall_number?: string | null;
    classification?: string | null;
    report_date?: string | null;
    recalling_firm?: string | null;
    reason_for_recall?: string | null;
  }[];
} | null;

type Props = { mdl: MdlRow; signal: Signal; peers: MdlRow[] };

/* --------------------------------- helpers -------------------------------- */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const NR = "Not recorded";

function fmtInt(n: number | null | undefined): string {
  return n == null || Number.isNaN(n) ? NR : n.toLocaleString("en-US");
}

function fmtSigned(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return NR;
  return `${n > 0 ? "+" : ""}${n.toLocaleString("en-US")}`;
}

function fmtAxis(n: number): string {
  if (n >= 1000) return `${parseFloat((n / 1000).toFixed(1))}k`;
  return String(n);
}

function parseDate(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  if (/^\d{8}$/.test(iso)) {
    const d = new Date(`${iso.slice(0, 4)}-${iso.slice(4, 6)}-${iso.slice(6, 8)}T00:00:00Z`);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

function fmtDate(iso: string | null | undefined): string | null {
  const d = parseDate(iso);
  if (!d) return null;
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}

function fmtMonthShort(iso: string): string {
  const d = parseDate(iso);
  if (!d) return iso;
  return `${MONTHS[d.getUTCMonth()]} '${String(d.getUTCFullYear()).slice(2)}`;
}

function fmtMonthLong(iso: string): string {
  const d = parseDate(iso);
  if (!d) return iso;
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/* ------------------------------ subcomponents ----------------------------- */

function StatusBadge({ status }: { status: MdlRow["status"] }) {
  const map: Record<MdlRow["status"], { label: string; cls: string }> = {
    pending: { label: "Pending", cls: "bg-success/10 text-success" },
    terminated: { label: "Terminated", cls: "bg-muted text-muted-foreground" },
    no_longer_listed: { label: "No longer listed", cls: "bg-warning/10 text-warning" },
  };
  const s = map[status] ?? map.no_longer_listed;
  return <span className={`rounded-md px-2 py-0.5 text-xs font-medium ${s.cls}`}>{s.label}</span>;
}

const KIND_ICON: Record<string, LucideIcon> = {
  drug: Pill,
  device: Stethoscope,
  food: Apple,
  cosmetic: SprayCan,
  vehicle: Car,
};

function Meta({
  icon: Icon,
  label,
  value,
}: {
  icon: LucideIcon;
  label: string;
  value: string | null;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm text-foreground">
        {value ?? <span className="text-muted-foreground">{NR}</span>}
      </dd>
    </div>
  );
}

function HeaderStat({ label, value }: { label: string; value: number | null }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      {value == null ? (
        <p className="mt-1 text-sm text-muted-foreground">{NR}</p>
      ) : (
        <p className="mt-0.5 text-2xl font-semibold tabular-nums text-foreground">
          {Number.isInteger(value) ? value.toLocaleString("en-US") : value.toFixed(1)}
        </p>
      )}
    </div>
  );
}

function Section({
  title,
  action,
  children,
  className = "",
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      aria-label={title}
      className={`rounded-lg border border-border bg-card shadow-card ${className}`}
    >
      <header className="flex items-center justify-between gap-4 border-b border-border px-5 py-3">
        <h2 className="text-base font-semibold text-foreground">{title}</h2>
        {action}
      </header>
      <div className="p-5">{children}</div>
    </section>
  );
}

function ChangeRow({ label, value }: { label: string; value: number | null }) {
  const flat = value == null || value === 0;
  const Icon = flat ? Minus : value > 0 ? TrendingUp : TrendingDown;
  const tone = flat ? "text-muted-foreground" : value > 0 ? "text-warning" : "text-success";
  return (
    <div className="flex items-center justify-between py-1.5">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="flex items-center gap-1.5">
        <Icon className={`h-3.5 w-3.5 ${tone}`} aria-hidden />
        <span className="text-sm font-medium tabular-nums text-foreground">{fmtSigned(value)}</span>
      </span>
    </div>
  );
}

function FlowBar({
  label,
  value,
  max,
  barClass,
}: {
  label: string;
  value: number | null;
  max: number;
  barClass: string;
}) {
  const pct = value != null && max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <span className="text-xs text-muted-foreground">{label}</span>
        <span className="text-sm font-medium tabular-nums text-foreground">{fmtInt(value)}</span>
      </div>
      <div className="mt-1 h-1.5 rounded-md bg-muted" role="presentation">
        <div className={`h-1.5 rounded-md ${barClass}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function BreakdownRow({ label, count, total }: { label: string; count: number; total: number }) {
  const pct = total > 0 ? Math.min(100, (count / total) * 100) : 0;
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <span className="text-xs text-muted-foreground">{label}</span>
        <span className="text-xs font-medium tabular-nums text-foreground">{fmtInt(count)}</span>
      </div>
      <div className="mt-1 h-1.5 rounded-md bg-muted" role="presentation">
        <div className="h-1.5 rounded-md bg-primary" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

type TipEntry = { dataKey?: string | number; name?: string; value?: number | null; color?: string };
type TipProps = { active?: boolean; payload?: TipEntry[]; label?: string | number };

function TrajTip({ active, payload, label }: TipProps) {
  if (!active || !payload?.length) return null;
  return (
    <div className="min-w-[160px] rounded-md border border-border bg-card px-3 py-2 shadow-card">
      <p className="mb-1 text-xs text-muted-foreground">{fmtMonthLong(String(label))}</p>
      {payload.map((p) => (
        <p key={String(p.dataKey)} className="flex items-center gap-2 py-0.5 text-xs">
          <span className="h-2 w-2 rounded-full" style={{ background: p.color }} aria-hidden />
          <span className="text-muted-foreground">{p.name}</span>
          <span className="ml-auto pl-4 font-medium tabular-nums text-foreground">
            {fmtInt(p.value)}
          </span>
        </p>
      ))}
    </div>
  );
}

function BarTip({ active, payload, label }: TipProps) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-md border border-border bg-card px-3 py-2 shadow-card">
      <p className="text-xs text-muted-foreground">{String(label)}</p>
      <p className="text-xs font-medium tabular-nums text-foreground">
        {fmtInt(payload[0]?.value ?? null)} reports
      </p>
    </div>
  );
}

function ClassBadge({ cls }: { cls?: string | null | undefined }) {
  if (!cls) return <span className="text-xs text-muted-foreground">{NR}</span>;
  const c = cls.toUpperCase();
  const tone = c.includes("III")
    ? "bg-muted text-muted-foreground"
    : c.includes("II")
      ? "bg-warning/10 text-warning"
      : c.includes("I")
        ? "bg-destructive/10 text-destructive"
        : "bg-muted text-muted-foreground";
  return <span className={`rounded-md px-1.5 py-0.5 text-xs font-medium ${tone}`}>{cls}</span>;
}

const focusCls =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-md";

const GROWTH_LABELS: Record<string, string> = {
  fast_growth: "Growing 25%+ in 12 months",
  growing: "Growing",
  stable: "Stable",
  declining: "Declining",
  insufficient_history: "Under 12 months of reports",
};
// openFDA FAERS `serious`: 1 = the report describes a serious outcome, 2 = it does not.
const DRUG_SERIOUSNESS: Record<string, string> = { "1": "Serious", "2": "Non-serious" };

/* ---------------------------------- page ---------------------------------- */

export function MdlDossierPrototype({ mdl, signal, peers }: Props) {
  const [showAllTerms, setShowAllTerms] = useState(false);
  const [showAllRecalls, setShowAllRecalls] = useState(false);

  const cohort = useMemo(() => {
    const combined = [...(peers ?? []), mdl].sort((a, b) => (b.pending ?? 0) - (a.pending ?? 0));
    const idx = combined.findIndex((r) => r.mdl === mdl.mdl);
    const start = Math.max(0, Math.min(idx - 2, combined.length - 7));
    return { combined, rows: combined.slice(start, start + 7), start };
  }, [peers, mdl]);

  const events = useMemo(
    () =>
      signal
        ? Object.entries(signal.eventsByYear ?? {})
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([year, count]) => ({ year, count }))
        : [],
    [signal],
  );

  const breakdown = useMemo(
    () => (signal ? Object.entries(signal.breakdown ?? {}).sort(([, a], [, b]) => b - a) : []),
    [signal],
  );
  const breakdownTotal = useMemo(() => breakdown.reduce((s, [, v]) => s + v, 0), [breakdown]);

  const terms = signal?.topTerms ?? [];
  const maxTerm = terms.reduce((m, t) => Math.max(m, t.count), 1);
  const visibleTerms = showAllTerms ? terms : terms.slice(0, 8);
  const recalls = signal?.recentRecalls ?? [];
  const visibleRecalls = showAllRecalls ? recalls : recalls.slice(0, 4);
  const flowMax = Math.max(mdl.new12m ?? 0, mdl.resolved12m ?? 0);
  const KindIcon = signal ? (KIND_ICON[signal.kind] ?? Package) : Package;

  return (
    <div className="mx-auto w-full max-w-[1400px] space-y-4 p-6 font-sans text-foreground">
      {/* ------------------------------- header ------------------------------- */}
      <header className="rounded-lg border border-border bg-card shadow-card">
        <div className="flex flex-wrap items-start justify-between gap-6 px-6 py-5">
          <div className="min-w-0">
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Multidistrict litigation · MDL No. <span className="tabular-nums">{mdl.mdl}</span>
            </p>
            <div className="mt-1 flex flex-wrap items-center gap-3">
              <h1 className="font-display text-2xl font-semibold text-foreground">{mdl.title}</h1>
              <StatusBadge status={mdl.status} />
              {mdl.massTort && (
                <span className="rounded-md bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                  Mass tort
                </span>
              )}
              {mdl.growth && (
                <span className="rounded-md bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                  {GROWTH_LABELS[mdl.growth] ?? mdl.growth.replace(/_/g, " ")}
                </span>
              )}
            </div>
            <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-2">
              <Meta icon={Gavel} label="Judge" value={mdl.judge} />
              <Meta icon={Landmark} label="Court" value={mdl.district} />
              <Meta icon={Package} label="Type" value={mdl.type} />
              <Meta icon={CalendarDays} label="Transferred" value={fmtDate(mdl.dateTransferred)} />
              {mdl.status !== "pending" && (
                <Meta icon={CalendarX} label="Closed" value={fmtDate(mdl.dateClosed)} />
              )}
            </dl>
          </div>
          <div className="flex shrink-0 gap-8 lg:border-l lg:border-border lg:pl-8">
            <HeaderStat label="Pending actions" value={mdl.pending} />
            <HeaderStat label="Total filed" value={mdl.total} />
            <HeaderStat label="Age (years)" value={mdl.ageYears} />
          </div>
        </div>
      </header>

      {/* ------------------------ trajectory + momentum ----------------------- */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Section title="Litigation trajectory" className="lg:col-span-2">
          <div className="mb-3 flex items-center gap-5 text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <span
                className="h-2 w-2 rounded-full"
                style={{ background: "var(--primary)" }}
                aria-hidden
              />
              Pending
            </span>
            <span className="flex items-center gap-1.5">
              <span
                className="h-2 w-2 rounded-full"
                style={{ background: "var(--muted-foreground)" }}
                aria-hidden
              />
              Total filed (cumulative)
            </span>
          </div>
          {mdl.series.length === 0 ? (
            <p className="py-16 text-center text-sm text-muted-foreground">{NR}</p>
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <ComposedChart data={mdl.series} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid stroke="var(--border)" vertical={false} />
                <XAxis
                  dataKey="date"
                  tickFormatter={fmtMonthShort}
                  tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                  tickLine={false}
                  axisLine={{ stroke: "var(--border)" }}
                  minTickGap={40}
                  tickMargin={8}
                />
                <YAxis
                  tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                  tickLine={false}
                  axisLine={false}
                  width={48}
                  tickFormatter={fmtAxis}
                />
                <Tooltip content={<TrajTip />} cursor={{ stroke: "var(--border)" }} />
                <Area
                  dataKey="total"
                  name="Total filed"
                  stroke="var(--muted-foreground)"
                  fill="var(--border)"
                  fillOpacity={0.35}
                  strokeWidth={1.5}
                  isAnimationActive={false}
                />
                <Area
                  dataKey="pending"
                  name="Pending"
                  stroke="var(--primary)"
                  fill="var(--primary)"
                  fillOpacity={0.12}
                  strokeWidth={2}
                  isAnimationActive={false}
                />
              </ComposedChart>
            </ResponsiveContainer>
          )}
          <p className="mt-2 text-xs text-muted-foreground">Monthly JPML statistics reports.</p>
        </Section>

        <Section title="Momentum">
          <div role="group" aria-label="Change in pending actions">
            <ChangeRow label="Change, 1 month" value={mdl.change1m} />
            <ChangeRow label="Change, 3 months" value={mdl.change3m} />
            <ChangeRow label="Change, 12 months" value={mdl.change12m} />
          </div>
          <div
            className="mt-4 space-y-4 border-t border-border pt-4"
            role="group"
            aria-label="New versus resolved actions, trailing 12 months"
          >
            <FlowBar
              label="New actions — 12 mo"
              value={mdl.new12m}
              max={flowMax}
              barClass="bg-primary"
            />
            <FlowBar
              label="Resolved — 12 mo"
              value={mdl.resolved12m}
              max={flowMax}
              barClass="bg-success"
            />
          </div>
          <p className="mt-4 text-xs text-muted-foreground">
            Change figures are net movement in pending actions versus prior JPML reports.
          </p>
        </Section>
      </div>

      {/* --------------------------- peers / position -------------------------- */}
      <Section title="Position among peers">
        <div className="grid gap-6 lg:grid-cols-3">
          <div className="space-y-5">
            <div>
              <p className="text-xs text-muted-foreground">Rank by pending actions</p>
              {mdl.status !== "pending" ? (
                <p className="mt-1 text-sm text-muted-foreground">{NR}</p>
              ) : (
                <p className="mt-0.5 text-2xl font-semibold tabular-nums text-foreground">
                  #
                  {(cohort.combined.findIndex((r) => r.mdl === mdl.mdl) + 1).toLocaleString(
                    "en-US",
                  )}
                  <span className="ml-2 text-sm font-normal text-muted-foreground">
                    of {cohort.combined.length.toLocaleString("en-US")} comparable pending MDLs
                  </span>
                </p>
              )}
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Share of pending actions</p>
              {mdl.sharePct == null ? (
                <p className="mt-1 text-sm text-muted-foreground">{NR}</p>
              ) : (
                <>
                  <p className="mt-0.5 text-2xl font-semibold tabular-nums text-foreground">
                    {mdl.sharePct.toFixed(2)}%
                  </p>
                  <div className="mt-2 h-1.5 rounded-md bg-muted" role="presentation">
                    <div
                      className="h-1.5 rounded-md bg-primary"
                      style={{ width: `${Math.min(100, Math.max(0, mdl.sharePct))}%` }}
                    />
                  </div>
                </>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              Cohort: other pending MDLs{mdl.type ? ` of type “${mdl.type}”` : ""}.
            </p>
          </div>

          <div className="overflow-x-auto lg:col-span-2">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted-foreground">
                  <th scope="col" className="py-2 pr-3 font-medium">
                    Rank
                  </th>
                  <th scope="col" className="py-2 pr-3 font-medium">
                    MDL
                  </th>
                  <th scope="col" className="py-2 pr-3 font-medium">
                    Title
                  </th>
                  <th scope="col" className="py-2 pr-3 text-right font-medium">
                    Pending
                  </th>
                  <th scope="col" className="py-2 pr-3 text-right font-medium">
                    Total
                  </th>
                  <th scope="col" className="py-2 text-right font-medium">
                    Δ 12 mo
                  </th>
                </tr>
              </thead>
              <tbody>
                {cohort.rows.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-6 text-center text-sm text-muted-foreground">
                      {NR}
                    </td>
                  </tr>
                ) : (
                  cohort.rows.map((row, i) => {
                    const isSelf = row.mdl === mdl.mdl;
                    return (
                      <tr
                        key={row.mdl}
                        className={`border-b border-border last:border-0 ${isSelf ? "bg-muted/60" : ""}`}
                      >
                        <td className="py-2 pr-3 tabular-nums text-muted-foreground">
                          #{(cohort.start + i + 1).toLocaleString("en-US")}
                        </td>
                        <td className="py-2 pr-3 whitespace-nowrap">
                          {isSelf ? (
                            <span className="font-mono text-xs text-foreground">
                              No. {row.mdl}
                              <span className="ml-2 rounded-md bg-primary/10 px-1.5 py-0.5 font-sans text-xs font-medium text-primary">
                                This docket
                              </span>
                            </span>
                          ) : (
                            <Link
                              to="/prototypes/mdl/$id"
                              params={{ id: String(row.mdl) }}
                              className={`font-mono text-xs text-primary hover:underline ${focusCls}`}
                            >
                              No. {row.mdl}
                            </Link>
                          )}
                        </td>
                        <td
                          className="max-w-[260px] truncate py-2 pr-3 text-foreground"
                          title={row.title}
                        >
                          {row.title}
                        </td>
                        <td className="py-2 pr-3 text-right tabular-nums text-foreground">
                          {fmtInt(row.pending)}
                        </td>
                        <td className="py-2 pr-3 text-right tabular-nums text-muted-foreground">
                          {fmtInt(row.total)}
                        </td>
                        <td className="py-2 text-right tabular-nums text-foreground">
                          {fmtSigned(row.change12m)}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
            <p className="mt-2 text-xs text-muted-foreground">
              Ranked by pending actions · {cohort.combined.length.toLocaleString("en-US")} MDLs in
              cohort.
            </p>
          </div>
        </div>
      </Section>

      {/* --------------------------- safety signal ----------------------------- */}
      {signal && (
        <Section title="Product-safety signal">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex flex-wrap items-center gap-3">
              <KindIcon className="h-4 w-4 text-muted-foreground" aria-hidden />
              <p className="text-sm font-semibold text-foreground">{signal.product}</p>
              <span className="rounded-md bg-muted px-2 py-0.5 text-xs font-medium capitalize text-muted-foreground">
                {signal.kind}
              </span>
              <span className="text-xs text-muted-foreground">Source: {signal.source}</span>
            </div>
            <div className="text-right">
              <p className="text-xs text-muted-foreground">Total reports</p>
              <p className="text-lg font-semibold tabular-nums text-foreground">
                {fmtInt(signal.eventTotal)}
              </p>
            </div>
          </div>

          <div className="mt-5 grid gap-6 lg:grid-cols-2">
            <div role="group" aria-label="Reports per year">
              <h3 className="mb-3 text-sm font-medium text-foreground">Reports per year</h3>
              {events.length === 0 ? (
                <p className="py-12 text-center text-sm text-muted-foreground">{NR}</p>
              ) : (
                <ResponsiveContainer width="100%" height={180}>
                  <BarChart data={events} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                    <CartesianGrid stroke="var(--border)" vertical={false} />
                    <XAxis
                      dataKey="year"
                      tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                      tickLine={false}
                      axisLine={{ stroke: "var(--border)" }}
                      tickMargin={8}
                    />
                    <YAxis
                      tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                      tickLine={false}
                      axisLine={false}
                      width={48}
                      tickFormatter={fmtAxis}
                    />
                    <Tooltip content={<BarTip />} cursor={{ fill: "var(--muted)" }} />
                    <Bar
                      dataKey="count"
                      fill="var(--primary)"
                      radius={[2, 2, 0, 0]}
                      isAnimationActive={false}
                    />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>

            <div role="group" aria-label="Reported outcomes">
              <h3 className="mb-3 text-sm font-medium text-foreground">Reported outcomes</h3>
              {breakdown.length === 0 ? (
                <p className="py-12 text-center text-sm text-muted-foreground">{NR}</p>
              ) : (
                <div className="space-y-3">
                  {breakdown.map(([label, count]) => (
                    <BreakdownRow
                      key={label}
                      label={
                        signal?.kind === "drug"
                          ? (DRUG_SERIOUSNESS[label] ?? label)
                          : label || "Not stated"
                      }
                      count={count}
                      total={breakdownTotal}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="mt-5 flex gap-2 rounded-md border border-border bg-muted/50 p-3">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" aria-hidden />
            <p className="text-xs leading-relaxed text-muted-foreground">{signal.caveat}</p>
          </div>

          <div className="mt-5 grid gap-6 lg:grid-cols-5">
            <div className="lg:col-span-2" role="group" aria-label="Top reported terms">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-sm font-medium text-foreground">Top reported terms</h3>
                {terms.length > 8 && (
                  <button
                    type="button"
                    onClick={() => setShowAllTerms((v) => !v)}
                    aria-expanded={showAllTerms}
                    className={`px-1 text-xs font-medium text-primary hover:underline ${focusCls}`}
                  >
                    {showAllTerms ? "Show fewer" : `Show all ${terms.length}`}
                  </button>
                )}
              </div>
              {terms.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">{NR}</p>
              ) : (
                <ol className="space-y-2">
                  {visibleTerms.map((t, i) => (
                    <li key={t.term} className="flex items-center gap-3">
                      <span className="w-5 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                        {i + 1}
                      </span>
                      <span
                        className="min-w-0 flex-1 truncate text-sm text-foreground"
                        title={t.term}
                      >
                        {t.term}
                      </span>
                      <span className="h-1.5 w-16 shrink-0 rounded-md bg-muted" role="presentation">
                        <span
                          className="block h-1.5 rounded-md bg-primary"
                          style={{ width: `${Math.min(100, (t.count / maxTerm) * 100)}%` }}
                        />
                      </span>
                      <span className="w-12 shrink-0 text-right text-xs tabular-nums text-foreground">
                        {fmtInt(t.count)}
                      </span>
                    </li>
                  ))}
                </ol>
              )}
            </div>

            <div className="overflow-x-auto lg:col-span-3" role="group" aria-label="Recent recalls">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-sm font-medium text-foreground">
                  Recent recalls
                  <span className="ml-2 text-xs font-normal tabular-nums text-muted-foreground">
                    {signal.recallTotal == null ? NR : `${fmtInt(signal.recallTotal)} total`}
                  </span>
                </h3>
                {recalls.length > 4 && (
                  <button
                    type="button"
                    onClick={() => setShowAllRecalls((v) => !v)}
                    aria-expanded={showAllRecalls}
                    className={`px-1 text-xs font-medium text-primary hover:underline ${focusCls}`}
                  >
                    {showAllRecalls ? "Show fewer" : `Show all ${recalls.length}`}
                  </button>
                )}
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs text-muted-foreground">
                    <th scope="col" className="py-2 pr-3 font-medium">
                      Recall no.
                    </th>
                    <th scope="col" className="py-2 pr-3 font-medium">
                      Class
                    </th>
                    <th scope="col" className="py-2 pr-3 font-medium">
                      Date
                    </th>
                    <th scope="col" className="py-2 pr-3 font-medium">
                      Firm
                    </th>
                    <th scope="col" className="py-2 font-medium">
                      Reason
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {visibleRecalls.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="py-6 text-center text-sm text-muted-foreground">
                        {NR}
                      </td>
                    </tr>
                  ) : (
                    visibleRecalls.map((r, i) => (
                      <tr
                        key={r.recall_number ?? i}
                        className="border-b border-border align-top last:border-0"
                      >
                        <td className="py-2 pr-3 font-mono text-xs whitespace-nowrap text-foreground">
                          {r.recall_number ?? (
                            <span className="font-sans text-muted-foreground">{NR}</span>
                          )}
                        </td>
                        <td className="py-2 pr-3 whitespace-nowrap">
                          <ClassBadge cls={r.classification} />
                        </td>
                        <td className="py-2 pr-3 text-xs whitespace-nowrap tabular-nums text-muted-foreground">
                          {fmtDate(r.report_date) ?? NR}
                        </td>
                        <td
                          className="max-w-[160px] truncate py-2 pr-3 text-xs text-foreground"
                          title={r.recalling_firm ?? undefined}
                        >
                          {r.recalling_firm ?? <span className="text-muted-foreground">{NR}</span>}
                        </td>
                        <td className="py-2 text-xs leading-relaxed text-muted-foreground">
                          <span className="line-clamp-2">{r.reason_for_recall ?? NR}</span>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </Section>
      )}
    </div>
  );
}
