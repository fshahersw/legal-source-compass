import { useMemo } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ExternalLink, Gavel, Landmark, ShieldAlert } from "lucide-react";
import { CourtArtwork } from "@/components/corpus/CourtArtwork";
import { AgencyMark, JudgePortrait } from "@/components/corpus/EntityArtwork";
import { FDA_COLORS } from "@/components/fda-analytics/chartView";
import { mdlAnalyticsQuery } from "@/components/matters/MdlAnalytics";
import { getMdlLens, type MdlLens as Lens } from "@/lib/external/mdlLens.functions";
import { getCourtStatsDistrict } from "@/lib/external/courtStats.functions";
import type { LensCompany } from "@/lib/external/mdlLens.functions";
import { money } from "@/components/companies/companyData";
import type { CourtAnalytics, NationalDistribution } from "@/lib/external/courtAnalytics.functions";
import type { FjcProfile } from "@/lib/external/judgeProfiles.functions";
import type { MassTortSignal } from "@/lib/external/massTortSignals.functions";
import type { SafetyInsight } from "@/lib/external/safetyInsights.functions";
import { cn } from "@/lib/utils";
import { growthPct, n, peerRanking, pct, REGULATOR, reportYears } from "./lensView";

export const mdlLensQuery = (mdl: number) => ({
  queryKey: ["mdl-lens", mdl],
  queryFn: () => getMdlLens({ data: { mdl } }),
  staleTime: 10 * 60 * 1000,
});

const axis = { fontSize: 11, fill: "var(--muted-foreground)" };
/** openFDA dates arrive as YYYYMMDD; show them as YYYY-MM-DD and anything else unchanged. */
const isoDay = (v: string | null | undefined) =>
  !v ? "—" : /^\d{8}$/.test(v) ? `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6)}` : v;
const monthYear = (v: string | null) =>
  v && /^\d{4}-\d{2}/.test(v)
    ? new Date(`${v.slice(0, 7)}-01T00:00:00Z`).toLocaleDateString("en-US", {
        month: "short",
        year: "numeric",
        timeZone: "UTC",
      })
    : "Not recorded";
const lastOf = (values: (number | null)[] | undefined) =>
  [...(values ?? [])].reverse().find((v): v is number => typeof v === "number") ?? null;

function Kpi({ label, value, note }: { label: string; value: string; note?: string | undefined }) {
  return (
    <div className="min-w-0 bg-surface px-3 py-2">
      <p className="truncate text-[11px] text-muted-foreground">{label}</p>
      <p className="font-mono text-lg font-semibold leading-tight">{value}</p>
      {note ? <p className="truncate text-[10.5px] text-muted-foreground">{note}</p> : null}
    </div>
  );
}

function Card({
  title,
  subtitle,
  children,
  className,
}: {
  title: string;
  subtitle?: string | undefined;
  children: React.ReactNode;
  className?: string | undefined;
}) {
  return (
    <section
      className={cn("min-w-0 rounded-lg border border-border bg-surface", className)}
      aria-label={title}
    >
      <header className="border-b border-border/70 px-3 py-2">
        <h2 className="text-[12.5px] font-semibold">{title}</h2>
        {subtitle ? <p className="text-[11px] text-muted-foreground">{subtitle}</p> : null}
      </header>
      <div className="p-3">{children}</div>
    </section>
  );
}

function Versus({
  label,
  value,
  range,
  digits = 0,
  lowerIsFaster,
}: {
  label: string;
  value: number | null;
  range: { min: number; median: number; max: number } | undefined;
  digits?: number;
  lowerIsFaster?: boolean;
}) {
  const position =
    value != null && range && range.max > range.min
      ? Math.min(100, Math.max(0, (100 * (value - range.min)) / (range.max - range.min)))
      : null;
  const medianPos =
    range && range.max > range.min
      ? (100 * (range.median - range.min)) / (range.max - range.min)
      : null;
  return (
    <div className="text-[11px]">
      <div className="flex justify-between gap-2">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-mono font-semibold">{n(value, digits)}</span>
      </div>
      {position != null && medianPos != null ? (
        <div className="relative mt-1 h-1.5 rounded-full bg-muted" aria-hidden="true">
          <span
            className="absolute top-[-2px] h-2.5 w-px bg-muted-foreground"
            style={{ left: `${medianPos}%` }}
          />
          <span
            className="absolute top-[-3px] size-3 -translate-x-1/2 rounded-full border-2 border-surface bg-primary"
            style={{ left: `${position}%` }}
          />
        </div>
      ) : null}
      {range ? (
        <p className="mt-0.5 text-[10px] text-muted-foreground">
          National median {n(range.median, digits)} (range {n(range.min, digits)}–
          {n(range.max, digits)})
          {lowerIsFaster && value != null
            ? value <= range.median
              ? " · faster than median"
              : " · slower than median"
            : ""}
        </p>
      ) : null}
    </div>
  );
}

/** Products-liability filings by fiscal year in the transferee district (Judicial Business C-11/C-3). */
function CourtPlHistory({ courtId }: { courtId: string }) {
  const q = useQuery({
    queryKey: ["court-stats-district", courtId],
    queryFn: () => getCourtStatsDistrict({ data: { id: courtId } }),
    staleTime: 10 * 60 * 1000,
  });
  const panel = q.data;
  if (q.isLoading)
    return <div className="mt-3 h-24 animate-pulse rounded bg-muted/50" aria-busy="true" />;
  if (!panel) return null;
  const rows = panel.years.map((year, i) => ({
    year: `FY${String(year).slice(2)}`,
    pl: panel.pl[i] ?? null,
    share: panel.share[i] ?? null,
  }));
  const latest = rows.at(-1);
  return (
    <div className="mt-3">
      <p className="text-[11px] font-medium">
        Products-liability filings, FY{panel.years[0]}–FY{panel.years.at(-1)}
        {panel.ranks.pl && panel.ranks.of ? (
          <span className="font-normal text-muted-foreground">
            {" "}
            · #{panel.ranks.pl} of {panel.ranks.of} districts in FY{panel.years.at(-1)}
          </span>
        ) : null}
      </p>
      <div className="h-24">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} margin={{ top: 4, right: 0, bottom: 0, left: -18 }}>
            <XAxis dataKey="year" tick={{ ...axis, fontSize: 9 }} interval={2} />
            <YAxis tick={{ ...axis, fontSize: 9 }} />
            <Tooltip
              contentStyle={{ fontSize: 11 }}
              formatter={(v) => [n(Number(v)), "PL filings"]}
            />
            <Bar dataKey="pl" fill={FDA_COLORS[3]} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <p className="text-[10px] text-muted-foreground">
        {latest?.share != null
          ? `${latest.share.toFixed(1)}% of the district's civil filings in ${latest.year}. `
          : ""}
        Counts include MDL actions transferred to the court. Source: U.S. Courts Judicial Business
        tables C-3 and C-11.
      </p>
    </div>
  );
}

function CourtCard({ court, dist }: { court: CourtAnalytics; dist: NationalDistribution | null }) {
  const m = court.metrics;
  const others = court.mdls.filter((x) => x.pending > 0).sort((a, b) => b.pending - a.pending);
  return (
    <Card
      title="Transferee court"
      subtitle="US Courts Federal Court Management Statistics, 12 months to June 30, 2026"
    >
      <div className="flex items-start gap-3">
        <CourtArtwork
          courtId={court.court_id}
          title={court.name}
          system="Federal"
          type="District"
          compact
        />
        <div className="min-w-0">
          <Link
            to="/courts/$id"
            params={{ id: court.court_id }}
            className="text-sm font-semibold hover:underline"
          >
            {court.name}
          </Link>
          <p className="text-[11px] text-muted-foreground">
            {n(court.mdl_actions)} pending MDL actions across {others.length} MDLs
          </p>
        </div>
      </div>
      <div className="mt-3 space-y-2.5">
        <Versus
          label="Median months, civil filing to disposition"
          value={lastOf(m["median_months_civil"])}
          range={dist?.["median_months_civil"]}
          digits={1}
          lowerIsFaster
        />
        <Versus
          label="Median months, civil filing to trial"
          value={lastOf(m["median_months_civil_to_trial"])}
          range={dist?.["median_months_civil_to_trial"]}
          digits={1}
          lowerIsFaster
        />
        <Versus
          label="Weighted filings per judgeship"
          value={lastOf(m["per_judge_weighted_filings"])}
          range={dist?.["per_judge_weighted_filings"]}
        />
      </div>
      <CourtPlHistory courtId={court.court_id} />
      {others.length > 1 ? (
        <div className="mt-3">
          <p className="text-[11px] font-medium">Largest MDLs in this court</p>
          <ul className="mt-1 space-y-0.5 text-[11px]">
            {others.slice(0, 5).map((x) => (
              <li key={x.mdl} className="flex justify-between gap-2">
                <Link
                  to="/matters/lens/$mdl"
                  params={{ mdl: String(x.mdl) }}
                  className="truncate text-primary hover:underline"
                >
                  MDL {x.mdl} · {x.title.replace(/^IN RE:?\s*/i, "")}
                </Link>
                <span className="shrink-0 font-mono text-muted-foreground">{n(x.pending)}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </Card>
  );
}

function JudgeCard({ judge, mdl }: { judge: FjcProfile; mdl: number }) {
  const current = judge.services.filter((s) => !s.termination).at(-1) ?? judge.services.at(-1);
  const others = judge.mdls.filter((x) => x.mdl !== mdl).sort((a, b) => b.pending - a.pending);
  const load = judge.mdls.reduce((s, x) => s + x.pending, 0);
  return (
    <Card title="Transferee judge" subtitle="Federal Judicial Center biographical directory">
      <div className="flex items-start gap-3">
        <JudgePortrait name={judge.name} photo={null} />
        <div className="min-w-0">
          {judge.judge_profile_id ? (
            <Link
              to="/judges/$id"
              params={{ id: judge.judge_profile_id }}
              className="text-sm font-semibold hover:underline"
            >
              {judge.name}
            </Link>
          ) : (
            <p className="text-sm font-semibold">{judge.name}</p>
          )}
          <p className="text-[11px] text-muted-foreground">
            {[
              current?.title,
              judge.status,
              current?.president ? `appointed by ${current.president}` : null,
              current?.commission ? `commissioned ${current.commission.slice(0, 4)}` : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
      </div>
      <div className="mt-3 grid grid-cols-3 gap-px overflow-hidden rounded-md border border-border bg-border/60 text-center">
        <Kpi label="Service, yrs" value={n(judge.years_service)} />
        <Kpi label="MDLs" value={n(judge.mdls.length)} />
        <Kpi label="MDL actions" value={n(load)} />
      </div>
      {others.length ? (
        <div className="mt-3">
          <p className="text-[11px] font-medium">Other MDLs before this judge</p>
          <ul className="mt-1 space-y-0.5 text-[11px]">
            {others.slice(0, 5).map((x) => (
              <li key={x.mdl} className="flex justify-between gap-2">
                <Link
                  to="/matters/lens/$mdl"
                  params={{ mdl: String(x.mdl) }}
                  className="truncate text-primary hover:underline"
                >
                  MDL {x.mdl} · {x.title.replace(/^IN RE:?\s*/i, "")}
                </Link>
                <span className="shrink-0 font-mono text-muted-foreground">{n(x.pending)}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="mt-3 text-[11px] text-muted-foreground">
          No other pending MDLs recorded for this judge.
        </p>
      )}
    </Card>
  );
}

function SignalCard({ signal }: { signal: MassTortSignal }) {
  const regulator = REGULATOR[signal.kind];
  const year = new Date().getUTCFullYear();
  const rows = reportYears(signal, year);
  const terms = signal.topTerms.slice(0, 8);
  const maxTerm = Math.max(1, ...terms.map((t) => t.count));
  return (
    <Card
      title="Regulator and product signal"
      subtitle={`${signal.product} · ${signal.source}`}
      className="lg:col-span-2"
    >
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <AgencyMark name={regulator.name} className="size-8" />
            <div className="text-[11.5px]">
              <p className="font-semibold">
                {regulator.short} · {regulator.name}
              </p>
              <p className="text-muted-foreground">
                {n(signal.eventTotal)} reports on record · {n(signal.recallTotal)} recalls
              </p>
            </div>
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground">
            Reports per year, complete years {rows[0]?.year}–{year - 1}
          </p>
          <div className="h-40">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={rows} margin={{ top: 4, right: 4, bottom: 0, left: -10 }}>
                <CartesianGrid stroke="var(--border)" vertical={false} />
                <XAxis dataKey="year" tick={axis} interval={2} />
                <YAxis tick={axis} />
                <Tooltip contentStyle={{ fontSize: 11 }} />
                <Bar
                  dataKey="reports"
                  name="Reports"
                  fill={FDA_COLORS[1]}
                  isAnimationActive={false}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <p className="mt-1 text-[10.5px] leading-snug text-muted-foreground">{signal.caveat}</p>
        </div>
        <div className="min-w-0 space-y-3">
          {terms.length ? (
            <div>
              <p className="text-[11px] font-medium">Most reported terms</p>
              <ul className="mt-1 space-y-1">
                {terms.map((t) => (
                  <li key={t.term} className="text-[11px]">
                    <span className="flex justify-between gap-2">
                      <span className="truncate">{t.term}</span>
                      <span className="font-mono text-muted-foreground">{n(t.count)}</span>
                    </span>
                    <span className="mt-0.5 block h-1 rounded-full bg-muted">
                      <span
                        className="block h-full rounded-full bg-primary/70"
                        style={{ width: `${(100 * t.count) / maxTerm}%` }}
                      />
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {signal.recentRecalls.length ? (
            <div>
              <p className="text-[11px] font-medium">Recent recalls</p>
              <ul className="mt-1 space-y-1 text-[11px]">
                {signal.recentRecalls.slice(0, 4).map((r, i) => (
                  <li key={(r.recall_number ?? r.res_event_number ?? "") + i}>
                    <span className="font-mono text-muted-foreground">
                      {isoDay(r.report_date ?? r.event_date_initiated)}
                    </span>{" "}
                    <span className="font-medium">{r.classification ?? ""}</span>{" "}
                    {r.recalling_firm ?? ""}
                    {r.reason_for_recall ? (
                      <span className="block truncate text-muted-foreground">
                        {r.reason_for_recall}
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <a
            href={signal.sourceUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline"
          >
            Source: {signal.source} <ExternalLink className="size-3" aria-hidden="true" />
          </a>
        </div>
      </div>
    </Card>
  );
}

const TIER_STYLE = {
  A: "border-success/40 bg-success/10",
  B: "border-border bg-muted",
  C: "border-warning/40 bg-warning/15",
} as const;

function CompaniesCard({ companies: all }: { companies: LensCompany[] }) {
  // Registrants read as claimants or as not named are listed apart from possible defendants.
  const companies = all.filter((c) => c.link.role === "defendant" || c.link.role === "unclear");
  const others = all.filter((c) => !companies.includes(c));
  return (
    <Card
      title="Public companies naming this MDL in SEC filings"
      subtitle="Linked only when the company's own 10-K, 10-Q, 20-F or 8-K names this MDL. Accruals are company-wide litigation figures, not MDL-specific."
      className="lg:col-span-2"
    >
      {all.length ? (
        <div className="overflow-x-auto">
          <table hidden={!companies.length} className="w-full min-w-[640px] text-[11.5px]">
            <thead className="text-left text-[10.5px] uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="py-1 pr-2 font-medium">Company</th>
                <th className="py-1 pr-2 font-medium">Evidence</th>
                <th className="py-1 pr-2 font-medium">Role read</th>
                <th className="py-1 pr-2 text-right font-medium">Revenue</th>
                <th className="py-1 pr-2 text-right font-medium">Litigation accrual</th>
                <th className="py-1 text-right font-medium">Accrual % rev.</th>
              </tr>
            </thead>
            <tbody>
              {companies.map((c) => {
                const rev = c.summary?.latest.revenue ?? null;
                const acc = c.summary?.latest.litigation_accrual ?? null;
                // An accrual more than a year older than the latest revenue is shown as stale, not current.
                const stale = !!acc && !!rev && acc.fy < rev.fy - 1;
                const filing = c.link.verified[0] ?? null;
                return (
                  <tr key={c.cik} className="border-t border-border/60 align-top">
                    <td className="py-1.5 pr-2">
                      <Link
                        to="/companies/$cik"
                        params={{ cik: c.cik }}
                        className="font-medium text-primary hover:underline"
                      >
                        {c.summary?.profile.name ?? c.name}
                      </Link>
                      {c.summary?.profile.tickers.length ? (
                        <span className="ml-1 font-mono text-[10.5px] text-muted-foreground">
                          {c.summary.profile.tickers.join(", ")}
                        </span>
                      ) : null}
                    </td>
                    <td className="py-1.5 pr-2">
                      <span
                        title={c.link.tierLabel}
                        className={cn(
                          "mr-1 rounded border px-1 py-px text-[10px] font-semibold",
                          TIER_STYLE[c.link.tier],
                        )}
                      >
                        Tier {c.link.tier}
                        {c.link.tier === "C" ? " · review" : ""}
                      </span>
                      {c.link.verifiedCount} filing{c.link.verifiedCount === 1 ? "" : "s"}
                      {filing ? (
                        <a
                          href={filing.url}
                          target="_blank"
                          rel="noreferrer"
                          className="block text-[10.5px] text-primary hover:underline"
                        >
                          {filing.form} filed {filing.fileDate}
                        </a>
                      ) : null}
                    </td>
                    <td className="py-1.5 pr-2 text-muted-foreground">{c.link.roleLabel}</td>
                    <td className="py-1.5 pr-2 text-right font-mono">
                      {rev ? (
                        <>
                          {money(rev.value, rev.unit)}
                          <span className="block text-[10px] text-muted-foreground">
                            FY{rev.fy}
                          </span>
                        </>
                      ) : (
                        "Not recorded"
                      )}
                    </td>
                    <td className="py-1.5 pr-2 text-right font-mono">
                      {acc && !stale ? (
                        <>
                          {money(acc.value, acc.unit)}
                          <span className="block text-[10px] text-muted-foreground">
                            FY{acc.fy}
                          </span>
                        </>
                      ) : acc ? (
                        <span
                          className="text-muted-foreground"
                          title={`${money(acc.value, acc.unit)} in FY${acc.fy}`}
                        >
                          Not current
                          <span className="block text-[10px]">last reported FY{acc.fy}</span>
                        </span>
                      ) : (
                        "Not recorded"
                      )}
                    </td>
                    <td className="py-1.5 text-right font-mono">
                      {!stale && c.summary?.accrualPctRevenue != null
                        ? `${c.summary.accrualPctRevenue.toFixed(1)}%`
                        : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {others.length ? (
            <p className="mt-2 text-[11px]">
              <span className="font-medium">Named in filings but not as a defendant: </span>
              {others.map((c, i) => (
                <span key={c.cik}>
                  {i ? "; " : ""}
                  <Link
                    to="/companies/$cik"
                    params={{ cik: c.cik }}
                    className="text-primary hover:underline"
                  >
                    {c.summary?.profile.name ?? c.name}
                  </Link>{" "}
                  <span className="text-muted-foreground">({c.link.roleLabel.toLowerCase()})</span>
                </span>
              ))}
            </p>
          ) : null}
          <p className="mt-2 text-[10.5px] text-muted-foreground">
            Tier A: the filing cites the MDL number. Tier B: it cites the official caption. Tier C:
            it describes the litigation by subject and needs review. Role is a deterministic reading
            of the excerpt, also for review.
          </p>
        </div>
      ) : (
        <p className="text-[11px] text-muted-foreground">
          No SEC registrant's filings were found naming this MDL. Defendants that do not file with
          the SEC (for example foreign companies without US listings or private companies) cannot
          appear here.
        </p>
      )}
    </Card>
  );
}

function FlagsCard({ insights }: { insights: SafetyInsight[] }) {
  return (
    <Card title="Automated flags" subtitle="From the regulatory-watch detectors on /safety">
      {insights.length ? (
        <ul className="space-y-2">
          {insights.map((i) => (
            <li key={i.id} className="text-[11.5px]">
              <span className="mr-1 inline-flex items-center gap-0.5 rounded border border-destructive/30 bg-destructive/10 px-1 text-[10px] font-medium text-destructive">
                <ShieldAlert className="size-3" aria-hidden="true" />
                {i.severity}
              </span>
              <span className="font-medium">{i.headline}</span>
              <span className="block text-muted-foreground">{i.summary}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[11px] text-muted-foreground">
          No automated flag currently names this MDL.
        </p>
      )}
    </Card>
  );
}

function PeersCard({ mdl, type }: { mdl: number; type: string | null }) {
  const q = useQuery(mdlAnalyticsQuery);
  const ranking = useMemo(
    () => (q.data ? peerRanking(q.data.mdls, mdl, type) : null),
    [q.data, mdl, type],
  );
  return (
    <Card
      title="Position among peers"
      subtitle={
        type
          ? `Pending ${type.toLowerCase()} MDLs, ranked by pending actions`
          : "Pending MDLs ranked by pending actions"
      }
    >
      {q.isLoading ? (
        <div className="h-40 animate-pulse rounded bg-muted/50" aria-busy="true" />
      ) : !ranking || !ranking.count ? (
        <p className="text-[11px] text-muted-foreground">Peer data is not available.</p>
      ) : (
        <>
          <p className="text-[11px]">
            <span className="font-semibold">#{ranking.position ?? "—"}</span> of {ranking.count} by
            size
            {ranking.growthPosition ? (
              <>
                {" "}
                · <span className="font-semibold">#{ranking.growthPosition}</span> of{" "}
                {ranking.growthCount} by 12-month growth
              </>
            ) : null}
          </p>
          <ul className="mt-2 space-y-1">
            {ranking.window.map((p) => {
              const max = ranking.peers[0]?.pending || 1;
              const self = p.mdl === mdl;
              return (
                <li key={p.mdl} className="text-[11px]">
                  <span className="flex justify-between gap-2">
                    <Link
                      to="/matters/lens/$mdl"
                      params={{ mdl: String(p.mdl) }}
                      className={cn(
                        "truncate hover:underline",
                        self ? "font-semibold text-primary" : "text-foreground",
                      )}
                    >
                      {p.mdl} · {p.title.replace(/^IN RE:?\s*/i, "")}
                    </Link>
                    <span className="shrink-0 font-mono text-muted-foreground">{n(p.pending)}</span>
                  </span>
                  <span className="mt-0.5 block h-1 rounded-full bg-muted">
                    <span
                      className={cn(
                        "block h-full rounded-full",
                        self ? "bg-primary" : "bg-muted-foreground/40",
                      )}
                      style={{ width: `${(100 * p.pending) / max}%` }}
                    />
                  </span>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </Card>
  );
}

export function MdlLens({ mdl }: { mdl: number }) {
  const q = useQuery(mdlLensQuery(mdl));
  if (q.isLoading)
    return (
      <div className="space-y-3" aria-busy="true" aria-label="Loading MDL lens">
        <div className="h-24 animate-pulse rounded-lg border border-border bg-muted/50" />
        <div className="h-72 animate-pulse rounded-lg border border-border bg-muted/50" />
      </div>
    );
  if (q.isError || !q.data)
    return (
      <p
        role="alert"
        className="rounded-lg border border-border px-4 py-4 text-sm text-destructive"
      >
        The MDL lens could not be loaded.
      </p>
    );
  const lens: Lens = q.data;
  const m = lens.mdl;
  if (!m)
    return (
      <p className="rounded-lg border border-border px-4 py-4 text-sm text-muted-foreground">
        MDL {mdl} is not in the JPML monthly report series.
      </p>
    );
  const growth = growthPct(m.pending, m.change12m);
  return (
    <div className="space-y-3">
      <section className="rounded-lg border border-border bg-surface" aria-label="MDL summary">
        <div className="flex flex-wrap items-start justify-between gap-3 px-4 py-3">
          <div className="min-w-0">
            <p className="text-[11px] text-muted-foreground">
              MDL {m.mdl}
              {m.masterDocket ? ` · ${m.masterDocket}` : ""} · {m.type ?? "Type not recorded"} ·{" "}
              {m.status ?? "Status not recorded"}
              {m.asOf ? ` · JPML report of ${m.asOf}` : ""}
            </p>
            <h2 className="mt-0.5 text-base font-semibold leading-snug">{m.title}</h2>
            <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] text-muted-foreground">
              <span className="inline-flex items-center gap-1">
                <Landmark className="size-3.5" aria-hidden="true" />
                {lens.court?.name ?? m.district ?? "District not recorded"}
              </span>
              <span className="inline-flex items-center gap-1">
                <Gavel className="size-3.5" aria-hidden="true" />
                {m.judge ?? "Judge not recorded"}
              </span>
              {m.dateTransferred ? <span>Centralized {m.dateTransferred}</span> : null}
            </p>
          </div>
          {m.badges.length ? (
            <div className="flex flex-wrap gap-1">
              {m.badges.map((b) => (
                <span
                  key={b}
                  className="rounded border border-border bg-muted px-1.5 py-px text-[10.5px]"
                >
                  {b}
                </span>
              ))}
            </div>
          ) : null}
        </div>
        <div className="grid grid-cols-2 gap-px border-t border-border bg-border/60 sm:grid-cols-4 xl:grid-cols-8">
          <Kpi
            label="Pending actions"
            value={n(m.pending)}
            note={m.rank ? `#${m.rank} overall` : undefined}
          />
          <Kpi label="Total actions" value={n(m.total)} />
          <Kpi
            label="Change, 12 months"
            value={
              m.change12m == null
                ? "Not recorded"
                : `${m.change12m > 0 ? "+" : ""}${n(m.change12m)}`
            }
            note={growth == null ? undefined : pct(growth, 0)}
          />
          <Kpi label="New, 12 months" value={n(m.new12m)} />
          <Kpi label="Resolved, 12 months" value={n(m.resolved12m)} />
          <Kpi label="Peak pending" value={n(m.peakPending)} />
          <Kpi
            label="Age"
            value={m.ageYears == null ? "Not recorded" : `${m.ageYears.toFixed(1)} yrs`}
          />
          <Kpi label="First filed" value={monthYear(m.dateFiled)} />
        </div>
      </section>

      <div className="grid gap-3 lg:grid-cols-3">
        <Card
          title="Trajectory"
          subtitle="Pending and total actions, JPML monthly pending-MDL reports"
          className="lg:col-span-2"
        >
          {m.series.length > 1 ? (
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={m.series} margin={{ top: 4, right: 8, bottom: 0, left: -6 }}>
                  <CartesianGrid stroke="var(--border)" vertical={false} />
                  <XAxis
                    dataKey="date"
                    tick={axis}
                    tickFormatter={(d: string) => d.slice(0, 7)}
                    interval="preserveStartEnd"
                  />
                  <YAxis tick={axis} />
                  <Tooltip contentStyle={{ fontSize: 11 }} />
                  <Line
                    name="Pending"
                    dataKey="pending"
                    stroke={FDA_COLORS[0]}
                    dot={false}
                    strokeWidth={2}
                    isAnimationActive={false}
                  />
                  <Line
                    name="Total"
                    dataKey="total"
                    stroke={FDA_COLORS[2]}
                    dot={false}
                    strokeDasharray="4 3"
                    isAnimationActive={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <p className="text-[11px] text-muted-foreground">
              Fewer than two monthly reports are recorded.
            </p>
          )}
        </Card>
        <PeersCard mdl={m.mdl} type={m.type} />
      </div>

      <div className="grid gap-3 lg:grid-cols-3">
        {lens.court ? (
          <CourtCard court={lens.court} dist={lens.courtDistributions} />
        ) : (
          <Card title="Transferee court">
            <p className="text-[11px] text-muted-foreground">
              No single court caseload record lists this MDL.
            </p>
          </Card>
        )}
        {lens.judge ? (
          <JudgeCard judge={lens.judge} mdl={m.mdl} />
        ) : (
          <Card title="Transferee judge">
            <p className="text-[11px] text-muted-foreground">
              {lens.judgeAmbiguous
                ? "More than one judge profile lists this MDL, so none is shown."
                : "No FJC profile lists this MDL."}
            </p>
          </Card>
        )}
        <FlagsCard insights={lens.insights} />
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <CompaniesCard companies={lens.companies} />
      </div>

      {lens.signal ? (
        <div className="grid gap-3 lg:grid-cols-2">
          <SignalCard signal={lens.signal} />
        </div>
      ) : (
        <p className="rounded-lg border border-dashed border-border px-4 py-3 text-[11.5px] text-muted-foreground">
          No product-level agency signal is recorded for this MDL.
        </p>
      )}
    </div>
  );
}
