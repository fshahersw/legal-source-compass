import { Fragment, useMemo, useState } from "react";
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
import { ExternalLink, Gavel, Landmark, ShieldAlert } from "lucide-react";
import { CourtArtwork } from "@/components/corpus/CourtArtwork";
import { AgencyMark, JudgePortrait } from "@/components/corpus/EntityArtwork";
import { FDA_COLORS } from "@/components/fda-analytics/chartView";
import { mdlAnalyticsQuery } from "@/components/matters/MdlAnalytics";
import { compact, title as litigationTitle } from "@/components/mdl/intelFormat";
import { LeadershipList } from "@/components/mdl/LeadershipList";
import { MdlCaseYears, MdlMonthlyPendingCard } from "@/components/mdl/MdlTrendCards";
import { ProfileTrend } from "@/components/trends/ProfileTrend";
import { CourtOrderLink } from "@/components/mdl/PacerLabel";
import { getMdlLens, type MdlLens as Lens } from "@/lib/external/mdlLens.functions";
import { getCourtStatsDistrict } from "@/lib/external/courtStats.functions";
import type {
  LensCompany,
  LensHearing,
  LensFdaReport,
  LensPanelOrder,
  LensTerminated,
} from "@/lib/external/mdlLens.functions";
import type { CourtMdl } from "@/lib/external/mdlIntel.functions";
import { money } from "@/components/companies/companyData";
import type { CourtAnalytics, NationalDistribution } from "@/lib/external/courtAnalytics.functions";
import type { FjcProfile } from "@/lib/external/judgeProfiles.functions";
import type { MassTortSignal } from "@/lib/external/massTortSignals.functions";
import type { SafetyInsight } from "@/lib/external/safetyInsights.functions";
import { cn } from "@/lib/utils";
import { MdlOrigins } from "./MdlOrigins";
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
/** "1 MDL", "3 MDLs". */
const count = (v: number, word: string, many = `${word}s`) => `${n(v)} ${v === 1 ? word : many}`;
const axisNumber = (v: number) => compact(v);
const tooltipNumber = (v: unknown) => n(Number(v));

/** Labels and notes wrap to two lines (full text on hover) so a narrow card never cuts them off. */
function Kpi({ label, value, note }: { label: string; value: string; note?: string | undefined }) {
  return (
    <div className="min-w-0 bg-surface px-3 py-2">
      <p
        className="line-clamp-2 break-words text-[11px] leading-4 text-muted-foreground"
        title={label}
      >
        {label}
      </p>
      <p className="font-mono text-lg font-semibold leading-tight">{value}</p>
      {note ? (
        <p className="line-clamp-2 break-words text-[10.5px] text-muted-foreground" title={note}>
          {note}
        </p>
      ) : null}
    </div>
  );
}

/** "MDL 2875 · Valsartan, ..." for a linked MDL row, used as both the text and its hover title. */
const mdlLabel = (mdl: number, title: string, prefix = "MDL ") =>
  `${prefix}${mdl} · ${title.replace(/^IN RE:?\s*/i, "")}`;

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
            <YAxis tick={{ ...axis, fontSize: 9 }} tickFormatter={axisNumber} />
            <Tooltip
              contentStyle={{ fontSize: 11 }}
              formatter={(v) => [n(Number(v)), "Products-liability filings"]}
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

function CourtCard({
  court,
  dist,
  className,
}: {
  court: CourtAnalytics;
  dist: NationalDistribution | null;
  className?: string | undefined;
}) {
  const m = court.metrics;
  const others = court.mdls.filter((x) => x.pending > 0).sort((a, b) => b.pending - a.pending);
  return (
    <Card
      title="Transferee court"
      subtitle="US Courts Federal Court Management Statistics, 12 months to June 30, 2026"
      className={className}
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
            {count(court.mdl_actions, "pending MDL action")} across {count(others.length, "MDL")}
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
                  title={mdlLabel(x.mdl, x.title)}
                >
                  {mdlLabel(x.mdl, x.title)}
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

function JudgeCard({
  judge,
  mdl,
  className,
}: {
  judge: FjcProfile;
  mdl: number;
  className?: string | undefined;
}) {
  const current = judge.services.filter((s) => !s.termination).at(-1) ?? judge.services.at(-1);
  const others = judge.mdls.filter((x) => x.mdl !== mdl).sort((a, b) => b.pending - a.pending);
  const load = judge.mdls.reduce((s, x) => s + x.pending, 0);
  return (
    <Card
      title="Transferee judge"
      subtitle="Federal Judicial Center biographical directory"
      className={className}
    >
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
                  title={mdlLabel(x.mdl, x.title)}
                >
                  {mdlLabel(x.mdl, x.title)}
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
  // Terms are stored as the source's top list; spellings differing only in case are combined (mergeTermCase).
  const recorded = signal.topTerms.reduce((s, t) => s + t.variants.length, 0);
  const merged = signal.topTerms.find((t) => t.variants.length > 1);
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
                {signal.eventTotal == null
                  ? "Reports not recorded"
                  : `${count(signal.eventTotal, "report")} on record`}{" "}
                ·{" "}
                {signal.recallTotal == null
                  ? "recalls not recorded"
                  : count(signal.recallTotal, "recall")}
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
                <YAxis tick={axis} tickFormatter={axisNumber} />
                <Tooltip contentStyle={{ fontSize: 11 }} formatter={tooltipNumber} />
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
                      <span
                        className="truncate"
                        title={
                          t.variants.length > 1 ? `Combines ${t.variants.join(" + ")}` : t.term
                        }
                      >
                        {t.term}
                      </span>
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
              {merged ? (
                <p className="mt-1 text-[10.5px] leading-snug text-muted-foreground">
                  Spellings that differ only in letter case are counted together (for example{" "}
                  {merged.variants.map((v) => `“${v}”`).join(" and ")}), within the {recorded} most
                  reported terms recorded from the source; a spelling outside those is not included.
                </p>
              ) : null}
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
                      <span
                        className="block truncate text-muted-foreground"
                        title={r.reason_for_recall}
                      >
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
  // Counted defendants first; dismissed, review-flagged, claimant and role-not-stated links are listed apart.
  const companies = all.filter(
    (c) => c.link.countsTowardExposure && !c.link.dismissed && !c.link.review,
  );
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
              <span className="font-medium">
                Also named in filings, not counted as a defendant here:{" "}
              </span>
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
                  <span className="text-muted-foreground">
                    (
                    {c.link.dismissed
                      ? "filing reports a dismissal"
                      : c.link.review
                        ? (c.link.reviewNote ?? "requires review")
                        : c.link.roleLabel.toLowerCase()}
                    )
                  </span>
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

/**
 * The court-page index is built from this JPML report, a different publication from the monthly
 * "Distribution of Pending MDL Dockets by Actions Pending" series behind the trajectory and peer ranking.
 */
const BY_TYPE_REPORT = "the JPML “Pending MDL Dockets by MDL Type” report of 10/1/2026";
const ACTIONS_PENDING_SERIES =
  "the JPML monthly “Distribution of Pending MDL Dockets by Actions Pending” reports";

function CourtPageCard({
  page,
  sourceUrl,
  sourceLabel,
  className,
}: {
  page: CourtMdl | null;
  /** The court-page record's own source (the court page, or the JPML report it was listed in). */
  sourceUrl?: string | null | undefined;
  /** The JPML report the source URL is, when it is the docket-type report (courtPageSourceLabel). */
  sourceLabel?: string | null | undefined;
  className?: string | undefined;
}) {
  if (!page || !page.pages.length)
    return (
      <Card
        title="Transferee court MDL page"
        subtitle="Official court website"
        className={className}
      >
        <p className="text-[11px] text-muted-foreground">
          {!page ? (
            `Transferee-court pages are indexed for the pending products-liability MDLs on ${BY_TYPE_REPORT}; this docket is not among them.`
          ) : page.status !== "transferred" ? (
            <>
              Listed on {sourceLabel ?? BY_TYPE_REPORT} but not transferred as of that report
              {page.transferOrderFiled ? (
                <>
                  ; the Panel&rsquo;s{" "}
                  {page.transferOrderUrl ? (
                    <a
                      href={page.transferOrderUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="text-primary hover:underline"
                    >
                      transfer order
                    </a>
                  ) : (
                    "transfer order"
                  )}{" "}
                  was filed {page.transferOrderFiled}
                  {page.judge || page.districtLabel
                    ? ` (${[page.judge, page.districtLabel].filter(Boolean).join(", ")})`
                    : ""}
                </>
              ) : (
                "; no transfer order date is recorded"
              )}
              . No transferee-court MDL page is indexed for it.
            </>
          ) : page.failedPages.length ? (
            <>
              The official MDL page was located on the transferee court's website but could not be
              fetched (
              {page.failedPages.map((p, i) => (
                <span key={p.url}>
                  {i ? ", " : ""}
                  <a
                    href={p.url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-primary hover:underline"
                  >
                    {p.status ? `HTTP ${p.status}` : "no response"}
                  </a>
                </span>
              ))}
              ).
            </>
          ) : (
            "No official MDL page for this docket was located on the transferee court's website."
          )}
        </p>
        {page && sourceUrl ? (
          <a
            href={sourceUrl}
            target="_blank"
            rel="noreferrer"
            className="mt-2 inline-flex items-center gap-1 text-[11px] text-primary hover:underline"
          >
            {sourceLabel ? `Source: ${sourceLabel.replace(/^the /, "")}` : "Source of this record"}{" "}
            <ExternalLink className="size-3" aria-hidden="true" />
          </a>
        ) : null}
      </Card>
    );
  const orders = page.latestOrders.filter((o) => !o.vacated).slice(0, 6);
  const bellwether = page.quotes.filter((q) => q.category === "bellwether").slice(0, 3);
  const settlement = page.quotes.filter((q) => q.category === "settlement").slice(0, 2);
  const retrieved = page.pages[0]?.retrieved;
  return (
    <Card
      title="Transferee court MDL page"
      subtitle={`Quoted verbatim from the court's own pages${retrieved ? `, retrieved ${retrieved}` : ""}; counsel contact details removed.`}
      className={cn("lg:col-span-2", className)}
    >
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="min-w-0 space-y-3">
          <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px]">
            {page.pages.slice(0, 3).map((pg) => (
              <a
                key={pg.url}
                href={pg.url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-primary hover:underline"
              >
                {pg.title || "Court page"}
                <ExternalLink className="size-3" aria-hidden="true" />
              </a>
            ))}
          </div>
          <div>
            <p className="text-[11px] font-medium">
              Latest orders listed{page.ordersTotal ? ` · ${n(page.ordersTotal)} on the page` : ""}
            </p>
            {orders.length ? (
              <ul className="mt-1 space-y-1 text-[11px]">
                {orders.map((o) => (
                  <li key={o.url + o.title} className="flex items-start gap-2">
                    <span className="w-20 shrink-0 font-mono text-muted-foreground">
                      {o.date ?? o.datePrinted ?? "—"}
                    </span>
                    <CourtOrderLink
                      order={o}
                      className="min-w-0 truncate text-primary hover:underline"
                    />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-1 text-[11px] text-muted-foreground">
                {page.ordersTotal
                  ? `None of the ${count(page.ordersTotal, "order")} extracted from the court page has a date that could be read.`
                  : "No orders were extracted from the court page; the page itself may list them."}
              </p>
            )}
          </div>
          {page.leadership.length ? (
            <div>
              <p className="text-[11px] font-medium">Leadership as listed</p>
              <p className="text-[10.5px] text-muted-foreground">
                Names, firms and roles as printed on the court page; contact details are not shown.
              </p>
              <LeadershipList
                sections={page.leadership}
                initialSections={3}
                initialLines={6}
                moreRoles={page.leadershipMore}
                moreUrl={page.leadershipMoreUrl}
                className="mt-1.5"
              />
            </div>
          ) : null}
        </div>
        <div className="min-w-0 space-y-3">
          <div>
            <p className="text-[11px] font-medium">
              Bellwether statements
              {page.firstBellwetherDate ? (
                <span className="font-normal text-muted-foreground">
                  {" "}
                  · first trial date quoted {page.firstBellwetherDate}
                </span>
              ) : null}
            </p>
            {bellwether.length ? (
              <ul className="mt-1 space-y-1.5">
                {bellwether.map((q, i) => (
                  <li key={i} className="border-l-2 border-border pl-2 text-[11px] leading-snug">
                    “{q.text}”
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-1 text-[11px] text-muted-foreground">
                The court pages contain no bellwether statement.
              </p>
            )}
            {page.bellwetherTimingNote ? (
              <p className="mt-1 text-[10.5px] text-muted-foreground">
                {page.bellwetherTimingNote}
              </p>
            ) : null}
          </div>
          {settlement.length ? (
            <div>
              <p className="text-[11px] font-medium">Settlement statements</p>
              <ul className="mt-1 space-y-1.5">
                {settlement.map((q, i) => (
                  <li key={i} className="border-l-2 border-border pl-2 text-[11px] leading-snug">
                    “{q.text}”
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      </div>
    </Card>
  );
}

function FlagsCard({
  insights,
  className,
}: {
  insights: SafetyInsight[];
  className?: string | undefined;
}) {
  return (
    <Card
      title="Automated flags"
      subtitle="From the regulatory-watch detectors on /safety"
      className={className}
    >
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
                      title={mdlLabel(p.mdl, p.title)}
                    >
                      {mdlLabel(p.mdl, p.title, "")}
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

const HEARINGS_SHOWN = 6;

/** Dockets on the Panel's hearing-session Schedule of Matters for this MDL number, with the order or report found. */
function HearingsCard({
  hearings,
  className,
}: {
  hearings: LensHearing[];
  className?: string | undefined;
}) {
  const [all, setAll] = useState(false);
  const shown = all ? hearings : hearings.slice(0, HEARINGS_SHOWN);
  return (
    <Card
      title="JPML hearing sessions"
      subtitle="Listed on the Panel's hearing-session Schedule of Matters; an outcome is shown only from a published order or JPML report"
      className={className}
    >
      <ul className="space-y-2 text-[11px]">
        {shown.map((h) => (
          <li
            key={`${h.session}:${h.section}`}
            className="border-t border-border/60 pt-2 first:border-0 first:pt-0"
          >
            <p className="flex flex-wrap items-baseline gap-x-2">
              <span className="font-mono text-muted-foreground">{h.session}</span>
              <span className="text-muted-foreground">
                Section {h.section} ·{" "}
                {h.section === "A" ? "motion to centralize" : "CTO opposition or other matter"}
              </span>
            </p>
            <p className="mt-0.5">
              <span className="font-medium">{h.outcomeLabel}</span>
              {h.district ? <span className="text-muted-foreground"> → {h.district}</span> : null}
              {h.requestedDistrict ? (
                <span className="text-muted-foreground">
                  {" "}
                  · motion asked for {h.requestedDistrict}
                </span>
              ) : null}
              {h.actionsListed != null ? (
                <span className="text-muted-foreground">
                  {" "}
                  · {count(h.actionsListed, "action")} listed
                </span>
              ) : null}
            </p>
            {h.evidenceQuote ? (
              <p className="mt-1 border-l-2 border-border pl-2 leading-snug">
                <span className="text-muted-foreground">{h.evidenceQuote.label}: </span>
                <q>
                  {h.evidenceQuote.text}
                  {h.evidenceQuote.clipped ? " …" : ""}
                </q>
                {h.evidenceQuote.clipped ? (
                  <span className="text-muted-foreground"> (stored text ends here)</span>
                ) : null}
              </p>
            ) : null}
            <p className="mt-0.5 flex flex-wrap gap-x-3">
              {h.evidenceUrl ? (
                <a
                  href={h.evidenceUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-primary hover:underline"
                >
                  {h.evidenceLabel ?? "Order"}
                  {h.evidenceDate ? `, ${h.evidenceDate}` : ""}{" "}
                  <ExternalLink className="inline size-3 align-[-2px]" aria-hidden="true" />
                </a>
              ) : null}
              {h.noticeUrl ? (
                <a
                  href={h.noticeUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-primary hover:underline"
                >
                  Hearing-session notice{" "}
                  <ExternalLink className="inline size-3 align-[-2px]" aria-hidden="true" />
                </a>
              ) : null}
            </p>
          </li>
        ))}
      </ul>
      {hearings.length > HEARINGS_SHOWN ? (
        <button
          type="button"
          onClick={() => setAll(!all)}
          aria-expanded={all}
          className="mt-2 rounded text-[11px] text-primary hover:underline focus-visible:outline-2 focus-visible:outline-ring"
        >
          {all ? "Show fewer" : `Show all ${n(hearings.length)} listings`}
        </button>
      ) : null}
    </Card>
  );
}

/** Entries of the JPML terminated-litigations report for this MDL number, one per transferee district. */
function FdaReportsCard({
  reports,
  className,
}: {
  reports: LensFdaReport[];
  className?: string | undefined;
}) {
  return (
    <Card
      title="FDA adverse-event reports"
      subtitle="openFDA report counts for this MDL's product. Reports, not incidence: counts are affected by litigation-driven reporting."
      className={className}
    >
      <ul className="space-y-2.5 text-[11px]">
        {reports.map((r) => (
          <li key={r.recordId}>
            <p className="font-medium">
              <Link
                to="/records/$dataset/$id"
                params={{ dataset: r.dataset, id: r.recordId }}
                className="text-primary hover:underline"
              >
                {r.system}: {r.title}
              </Link>
            </p>
            <p className="text-muted-foreground">
              {r.reports} reports
              {r.deaths ? ` · ${r.deaths} with a death outcome` : ""}
              {r.dataThrough ? ` · data through ${r.dataThrough.split(" ")[0]}` : ""}
            </p>
            {r.searchScope ? (
              <p className="mt-0.5 text-muted-foreground">Search scope: {r.searchScope}</p>
            ) : null}
          </li>
        ))}
      </ul>
    </Card>
  );
}

function TerminatedCard({
  rows,
  className,
}: {
  rows: LensTerminated[];
  className?: string | undefined;
}) {
  const sources = [...new Set(rows.map((r) => r.sourceUrl).filter((u): u is string => !!u))];
  return (
    <Card
      title="Terminated litigation"
      subtitle="As printed in the JPML terminated-litigations report, one entry per transferee district"
      className={className}
    >
      <ul className="space-y-3 text-[11px]">
        {rows.map((r) => (
          <li key={`${r.districtCode ?? r.districtName}:${r.year}`}>
            <p className="font-medium">
              {r.districtName ?? "District not recorded"}
              {r.circuit ? (
                <span className="font-normal text-muted-foreground"> · {r.circuit}</span>
              ) : null}
            </p>
            <p className="text-muted-foreground">
              {r.judge ?? "Judge not recorded"} · terminated {r.year ?? "year not recorded"} ·
              caption as printed: “{r.caption}”
            </p>
            <dl className="mt-1.5 grid grid-cols-2 gap-px overflow-hidden rounded-md border border-border bg-border/60 sm:grid-cols-4">
              {(
                [
                  ["Transferred", r.transferred],
                  ["Filed in transferee court", r.filedInTransferee],
                  ["Closed", r.closed],
                  ["Remanded", r.remanded],
                ] as const
              ).map(([label, value]) => (
                <div key={label} className="min-w-0 bg-surface px-2 py-1.5">
                  <dt
                    className="line-clamp-2 break-words text-[10.5px] text-muted-foreground"
                    title={label}
                  >
                    {label}
                  </dt>
                  <dd className="font-mono text-[13px] font-semibold">{n(value)}</dd>
                </div>
              ))}
            </dl>
          </li>
        ))}
      </ul>
      {sources.map((url) => (
        <a
          key={url}
          href={url}
          target="_blank"
          rel="noreferrer"
          className="mt-2 inline-flex items-center gap-1 text-[11px] text-primary hover:underline"
        >
          Source: JPML terminated-litigations report{" "}
          <ExternalLink className="size-3" aria-hidden="true" />
        </a>
      ))}
    </Card>
  );
}

/** Panel orders published on GovInfo for this MDL number (mdl_intel_hearing_orders, ids order:<package>-<part>). */
function PanelOrdersCard({
  orders,
  className,
}: {
  orders: LensPanelOrder[];
  className?: string | undefined;
}) {
  return (
    <Card
      title="Panel orders on GovInfo"
      subtitle="Order type as read from the start of GovInfo's docket text. Dated by signature when the text states one, otherwise by GovInfo's package date, which can be years after the order."
      className={className}
    >
      <ul className="space-y-2 text-[11px]">
        {orders.map((o) => {
          const facts = [
            o.natureOfSuit ? `GovInfo nature of suit: ${o.natureOfSuit}` : null,
            o.transfereeCourt ? `transferee court ${o.transfereeCourt}` : null,
            o.transfereeJudge ? `Judge ${o.transfereeJudge}` : null,
            o.actionsTransferred != null
              ? `${count(o.actionsTransferred, "action")} transferred`
              : null,
            o.initialMotion ? "rules on the initial motion" : null,
          ].filter((f): f is string => !!f);
          return (
            <li key={o.id} className="border-t border-border/60 pt-2 first:border-0 first:pt-0">
              <p className="flex flex-wrap items-baseline gap-x-2">
                <span className="text-muted-foreground">
                  {o.signedDate || o.issued ? (
                    <>
                      {o.signedDate ? "Signed" : "GovInfo date"}{" "}
                      <span className="font-mono">{o.signedDate ?? o.issued}</span>
                    </>
                  ) : (
                    "Date not recorded"
                  )}
                </span>
                <span className="font-medium">{o.kindLabel}</span>
              </p>
              {o.title ? <p className="mt-0.5 break-words">{o.title}</p> : null}
              {facts.length ? (
                <p className="mt-0.5 break-words text-muted-foreground">{facts.join(" · ")}</p>
              ) : null}
              <p className="mt-0.5 flex flex-wrap gap-x-3">
                {o.pdfUrl ? (
                  <a
                    href={o.pdfUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-primary hover:underline"
                  >
                    Order PDF (GovInfo){" "}
                    <ExternalLink className="inline size-3 align-[-2px]" aria-hidden="true" />
                  </a>
                ) : null}
                {o.detailsUrl ? (
                  <a
                    href={o.detailsUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-primary hover:underline"
                  >
                    GovInfo details{" "}
                    <ExternalLink className="inline size-3 align-[-2px]" aria-hidden="true" />
                  </a>
                ) : null}
              </p>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

/** A card renderer given the grid class it should take; null when the card has nothing to show. */
type CardSlot = ((className: string | undefined) => React.ReactNode) | null;

/** Half-width cards in a two-column row; an odd last card spans the row instead of leaving half of it empty. */
function PairedCards({ slots }: { slots: CardSlot[] }) {
  const cards = slots.filter((s): s is NonNullable<CardSlot> => s !== null);
  if (!cards.length) return null;
  return (
    <div className="grid gap-3 lg:grid-cols-2">
      {cards.map((card, i) => (
        <Fragment key={i}>
          {card(i === cards.length - 1 && cards.length % 2 === 1 ? "lg:col-span-2" : undefined)}
        </Fragment>
      ))}
    </div>
  );
}

const reportMonth = (iso: string | null) =>
  iso && /^\d{4}-\d{2}-\d{2}$/.test(iso)
    ? new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", {
        month: "long",
        day: "numeric",
        year: "numeric",
        timeZone: "UTC",
      })
    : null;

/**
 * An MDL number that is not in the JPML pending-report series: show every record kept for that exact number,
 * each with its own source, and say plainly which series it is missing from.
 */
function RecordedOnly({ mdl, lens }: { mdl: number; lens: Lens }) {
  const first = reportMonth(lens.series.first);
  const asOf = reportMonth(lens.series.asOf);
  const range = first && asOf ? `${first} to ${asOf}` : null;
  const sessions =
    lens.hearingCoverage.first && lens.hearingCoverage.last
      ? ` (sessions ${lens.hearingCoverage.first} to ${lens.hearingCoverage.last})`
      : "";
  // Each label says what its source covers, so a gap in coverage does not read as a gap in the record.
  const recorded: [string, boolean][] = [
    [`JPML hearing-session schedules${sessions}`, lens.hearings.length > 0],
    ["Panel orders on GovInfo", lens.panelOrders.length + lens.panelOrdersInHearings > 0],
    ["terminated-litigations report", lens.terminated.length > 0],
    [
      `transferee-court page index (pending products-liability MDLs on ${BY_TYPE_REPORT})`,
      !!lens.courtPage,
    ],
    ["SEC filings naming the MDL", lens.companies.length > 0],
    ["agency product signal", !!lens.signal],
    ["openFDA adverse-event reports", lens.fdaReports.length > 0],
    ["automated flags", lens.insights.length > 0],
  ];
  const missing = recorded.filter(([, has]) => !has).map(([label]) => label);
  const anything =
    recorded.some(([, has]) => has) || !!lens.court || !!lens.judge || lens.judgeAmbiguous;
  const facts = [
    lens.series.reports != null ? count(lens.series.reports, "report") : null,
    range,
  ].filter(Boolean);
  const notTransferred = lens.courtPage?.status === "not_transferred_as_of_report";
  const byType = lens.courtPageSourceLabel ?? BY_TYPE_REPORT;
  const series = (
    <>
      {ACTIONS_PENDING_SERIES} recorded here
      {facts.length || lens.series.sourceUrl ? (
        <>
          {" "}
          ({facts.join(", ")}
          {facts.length && lens.series.sourceUrl ? "; " : null}
          {lens.series.sourceUrl ? (
            <a
              href={lens.series.sourceUrl}
              target="_blank"
              rel="noreferrer"
              className="text-primary hover:underline"
            >
              JPML report archive
            </a>
          ) : null}
          )
        </>
      ) : null}
    </>
  );
  if (!anything)
    return (
      <p className="rounded-lg border border-border px-4 py-4 text-sm text-muted-foreground">
        No records for MDL {mdl}. It is not in {series}, and no hearing-session listing, GovInfo
        Panel order, terminated-litigation entry, transferee-court page, SEC filing link or agency
        signal is recorded for this MDL number.
      </p>
    );
  const t = lens.recordedTitle;
  // Hearing schedules print titles in capitals; the heading shows them in title case and says so.
  const caseNormalized = !!t && !/[a-z]/.test(t.title.replace(/^IN RE:?\s*/i, ""));
  const courtPageFull = !!lens.courtPage?.pages.length;
  const { court, judge, courtPage } = lens;
  const slots: CardSlot[] = [
    lens.hearings.length ? (c) => <HearingsCard hearings={lens.hearings} className={c} /> : null,
    lens.panelOrders.length
      ? (c) => <PanelOrdersCard orders={lens.panelOrders} className={c} />
      : null,
    lens.terminated.length ? (c) => <TerminatedCard rows={lens.terminated} className={c} /> : null,
    lens.fdaReports.length
      ? (c) => <FdaReportsCard reports={lens.fdaReports} className={c} />
      : null,
    // A court page with fetched pages takes a full row of its own below.
    courtPage && !courtPageFull
      ? (c) => (
          <CourtPageCard
            page={courtPage}
            sourceUrl={lens.courtPageSourceUrl}
            sourceLabel={lens.courtPageSourceLabel}
            className={c}
          />
        )
      : null,
    court ? (c) => <CourtCard court={court} dist={lens.courtDistributions} className={c} /> : null,
    judge ? (c) => <JudgeCard judge={judge} mdl={mdl} className={c} /> : null,
    lens.insights.length ? (c) => <FlagsCard insights={lens.insights} className={c} /> : null,
  ];
  return (
    <div className="space-y-3">
      <section className="rounded-lg border border-border bg-surface" aria-label="MDL summary">
        <div className="px-4 py-3">
          <p className="text-[11px] text-muted-foreground">
            MDL {mdl} ·{" "}
            {notTransferred
              ? `listed on ${byType} but not transferred as of that report, so it has no actions-pending series`
              : `not in ${ACTIONS_PENDING_SERIES}`}
          </p>
          <h2 className="mt-0.5 text-base font-semibold leading-snug">
            {t ? litigationTitle(t.title) : `MDL ${mdl}`}
          </h2>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            {t
              ? `Title from ${t.source}${caseNormalized ? ", printed there in capitals" : ""}.`
              : "No litigation title is recorded for this MDL number."}
          </p>
        </div>
        <p
          role="note"
          className="border-t border-border bg-muted/40 px-4 py-2 text-[11.5px] leading-snug text-muted-foreground"
        >
          MDL {mdl} does not appear in {series}, so no pending-action trajectory, transferee-court
          caseload or peer ranking is shown. Below is what other datasets record for this exact MDL
          number, each with its source.
        </p>
      </section>

      <PairedCards slots={slots} />
      {courtPage && courtPageFull ? (
        <div className="grid gap-3 lg:grid-cols-2">
          <CourtPageCard
            page={courtPage}
            sourceUrl={lens.courtPageSourceUrl}
            sourceLabel={lens.courtPageSourceLabel}
          />
        </div>
      ) : null}
      {lens.companies.length ? (
        <div className="grid gap-3 lg:grid-cols-2">
          <CompaniesCard companies={lens.companies} />
        </div>
      ) : null}
      {lens.signal ? (
        <div className="grid gap-3 lg:grid-cols-2">
          <SignalCard signal={lens.signal} />
        </div>
      ) : null}
      {missing.length ? (
        <p className="rounded-lg border border-dashed border-border px-4 py-3 text-[11.5px] text-muted-foreground">
          Not recorded for MDL {mdl}: {missing.join(", ")}.
        </p>
      ) : null}
    </div>
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
  if (!m) return <RecordedOnly mdl={mdl} lens={lens} />;
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
              {m.asOf ? ` · JPML actions-pending report of ${m.asOf}` : ""}
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
        <div className="grid min-w-0 items-start gap-3 sm:grid-cols-2 lg:col-span-2">
          <MdlMonthlyPendingCard mdl={m.mdl} series={m.series} />
          <ProfileTrend kind="mdl-fy-pending" id={m.mdl} />
        </div>
        <PeersCard mdl={m.mdl} type={m.type} />
      </div>

      <MdlCaseYears mdl={m.mdl} />

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

      <MdlOrigins mdl={m.mdl} />

      <div className="grid gap-3 lg:grid-cols-2">
        <CompaniesCard companies={lens.companies} />
        {/* The companies card spans the row, so the court-page card does too rather than leaving half empty. */}
        <CourtPageCard
          page={lens.courtPage}
          sourceUrl={lens.courtPageSourceUrl}
          sourceLabel={lens.courtPageSourceLabel}
          className="lg:col-span-2"
        />
      </div>

      <PairedCards
        slots={[
          lens.hearings.length
            ? (c) => <HearingsCard hearings={lens.hearings} className={c} />
            : null,
          lens.panelOrders.length
            ? (c) => <PanelOrdersCard orders={lens.panelOrders} className={c} />
            : null,
          lens.terminated.length
            ? (c) => <TerminatedCard rows={lens.terminated} className={c} />
            : null,
          lens.fdaReports.length
            ? (c) => <FdaReportsCard reports={lens.fdaReports} className={c} />
            : null,
        ]}
      />

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
