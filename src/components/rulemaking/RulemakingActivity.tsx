import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { listAgencyDirectory } from "@/lib/external/agencyProfile.functions";
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
import { ExternalLink, TrendingDown, TrendingUp } from "lucide-react";
import { AgencyMark } from "@/components/corpus/EntityArtwork";
import { FDA_COLORS } from "@/components/fda-analytics/chartView";
import {
  DOC_TYPES,
  getRulemakingActivity,
  type AgencyActivity,
} from "@/lib/external/rulemaking.functions";
import { cn } from "@/lib/utils";
import {
  AGENCY_MARK_NAME,
  lastYearVsAverage,
  monthlyRows,
  TYPE_LABEL,
  yearlyRows,
} from "./rulemakingView";

export const rulemakingQuery = {
  queryKey: ["rulemaking-activity"],
  queryFn: () => getRulemakingActivity(),
  staleTime: 10 * 60 * 1000,
};

const agencyDirectoryQuery = {
  queryKey: ["agency-directory"],
  queryFn: () => listAgencyDirectory(),
  staleTime: 10 * 60 * 1000,
};

const COLORS = { RULE: FDA_COLORS[0], PRORULE: FDA_COLORS[2], NOTICE: FDA_COLORS[1] } as const;
const axis = { fontSize: 11, fill: "var(--muted-foreground)" };
const fmt = (v: number) => v.toLocaleString("en-US");

function Mark({ agency, className }: { agency: AgencyActivity; className?: string }) {
  return <AgencyMark name={AGENCY_MARK_NAME[agency.short] ?? agency.name} className={className} />;
}

function FlagChips({ agency }: { agency: AgencyActivity }) {
  const flagged = DOC_TYPES.flatMap((t) => {
    const f = agency.flags[t];
    return f?.flag ? [{ t, f }] : [];
  });
  if (!flagged.length) return null;
  return (
    <span className="flex flex-wrap gap-1">
      {flagged.map(({ t, f }) => (
        <span
          key={t}
          title={`${f.recent} in ${f.window} vs ${f.baselineAnnual} a year in ${f.baselineWindow}`}
          className={cn(
            "inline-flex items-center gap-0.5 rounded border px-1 py-px text-[10px] font-medium",
            f.flag === "surge"
              ? "border-warning/40 bg-warning/15 text-warning-foreground"
              : "border-border bg-muted text-muted-foreground",
          )}
        >
          {f.flag === "surge" ? (
            <TrendingUp className="size-3" aria-hidden="true" />
          ) : (
            <TrendingDown className="size-3" aria-hidden="true" />
          )}
          {TYPE_LABEL[t]} {f.flag}
        </span>
      ))}
    </span>
  );
}

function SmallMultiple({
  agency,
  active,
  onPick,
}: {
  agency: AgencyActivity;
  active: boolean;
  onPick: () => void;
}) {
  const rows = yearlyRows(agency, 2010);
  const final = lastYearVsAverage(agency.yearly.RULE, agency.partialYear);
  return (
    <button
      type="button"
      onClick={onPick}
      aria-pressed={active}
      className={cn(
        "flex min-w-0 flex-col rounded-lg border bg-surface p-2.5 text-left transition-colors hover:bg-muted/40 focus-visible:outline-2 focus-visible:outline-ring",
        active ? "border-primary ring-1 ring-primary/30" : "border-border",
      )}
    >
      <span className="flex items-center gap-2">
        <Mark agency={agency} className="size-7 rounded-md p-1" />
        <span className="min-w-0">
          <span className="block text-[12px] font-semibold">{agency.short}</span>
          <span className="block truncate text-[10.5px] text-muted-foreground" title={agency.name}>
            {agency.name}
          </span>
        </span>
      </span>
      <span className="mt-1.5 h-12 w-full" aria-hidden="true">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={rows} margin={{ top: 2, right: 2, bottom: 0, left: 2 }}>
            <Line
              type="monotone"
              dataKey="RULE"
              stroke={COLORS.RULE}
              dot={false}
              strokeWidth={1.5}
              isAnimationActive={false}
            />
            <Line
              type="monotone"
              dataKey="PRORULE"
              stroke={COLORS.PRORULE}
              dot={false}
              strokeWidth={1.2}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </span>
      <span className="mt-1 font-mono text-[11px]">
        {fmt(final.value)} final rules in {final.year}
        {final.ratio != null ? (
          <span className="text-muted-foreground"> · {final.ratio.toFixed(2)}× 5-yr avg</span>
        ) : null}
      </span>
      <span className="mt-1 min-h-4">
        <FlagChips agency={agency} />
      </span>
    </button>
  );
}

function AgencyDetail({ agency }: { agency: AgencyActivity }) {
  const yearly = yearlyRows(agency, 2000);
  const monthly = monthlyRows(agency, 36);
  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <section
        className="min-w-0 rounded-xl border border-border bg-card shadow-xs p-3"
        aria-label="Documents per year"
      >
        <h3 className="text-[12px] font-semibold">{agency.short} documents per year</h3>
        <p className="text-[11px] text-muted-foreground">
          Complete calendar years 2000–{Number(agency.partialYear) - 1}, by publication date. Dotted
          line: final rules flagged significant under EO 12866.
        </p>
        <div className="mt-2 h-56">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={yearly} margin={{ top: 4, right: 18, bottom: 0, left: -12 }}>
              <CartesianGrid stroke="var(--border)" vertical={false} />
              <XAxis dataKey="year" tick={axis} interval={4} padding={{ right: 6 }} />
              <YAxis tick={axis} />
              <Tooltip contentStyle={{ fontSize: 11 }} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Line
                name={TYPE_LABEL.RULE}
                dataKey="RULE"
                stroke={COLORS.RULE}
                dot={false}
                isAnimationActive={false}
              />
              <Line
                name={TYPE_LABEL.PRORULE}
                dataKey="PRORULE"
                stroke={COLORS.PRORULE}
                dot={false}
                isAnimationActive={false}
              />
              <Line
                name={TYPE_LABEL.NOTICE}
                dataKey="NOTICE"
                stroke={COLORS.NOTICE}
                dot={false}
                strokeOpacity={0.6}
                isAnimationActive={false}
              />
              <Line
                name="Significant final rules"
                dataKey="significant"
                stroke={FDA_COLORS[4]}
                strokeDasharray="3 3"
                dot={false}
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </section>
      <section
        className="min-w-0 rounded-xl border border-border bg-card shadow-xs p-3"
        aria-label="Rules per month"
      >
        <h3 className="text-[12px] font-semibold">Final and proposed rules per month</h3>
        <p className="text-[11px] text-muted-foreground">
          Last 36 months; {agency.partialMonth} is a partial month.
        </p>
        <div className="mt-2 h-56">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={monthly} margin={{ top: 4, right: 18, bottom: 0, left: -12 }}>
              <CartesianGrid stroke="var(--border)" vertical={false} />
              <XAxis dataKey="month" tick={axis} interval={5} />
              <YAxis tick={axis} allowDecimals={false} />
              <Tooltip contentStyle={{ fontSize: 11 }} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar
                name={TYPE_LABEL.RULE}
                dataKey="RULE"
                stackId="r"
                fill={COLORS.RULE}
                isAnimationActive={false}
              />
              <Bar
                name={TYPE_LABEL.PRORULE}
                dataKey="PRORULE"
                stackId="r"
                fill={COLORS.PRORULE}
                isAnimationActive={false}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </section>
      <section
        className="min-w-0 rounded-xl border border-border bg-card shadow-xs p-3 lg:col-span-2"
        aria-label="Recent significant final rules"
      >
        <h3 className="text-[12px] font-semibold">
          Latest significant final rules
          {agency.significantFinalRulesTotal != null ? (
            <span className="font-normal text-muted-foreground">
              {" "}
              · {fmt(agency.significantFinalRulesTotal)} on record
            </span>
          ) : null}
        </h3>
        {agency.latestSignificantRules.length ? (
          <ul className="mt-2 divide-y divide-border">
            {agency.latestSignificantRules.map((r) => (
              <li key={r.url} className="py-1.5 text-xs">
                <span className="flex flex-wrap items-baseline gap-x-2">
                  <span className="w-20 shrink-0 font-mono text-[11px] text-muted-foreground">
                    {r.date}
                  </span>
                  <a
                    href={r.url}
                    target="_blank"
                    rel="noreferrer"
                    className="font-medium text-primary hover:underline"
                  >
                    {r.title}
                    <ExternalLink className="ml-1 inline size-3" aria-hidden="true" />
                  </a>
                </span>
                <span className="ml-[5.5rem] block text-[11px] text-muted-foreground">
                  {[
                    r.citation,
                    r.cfr.slice(0, 3).join(", "),
                    r.effectiveOn ? `effective ${r.effectiveOn}` : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-1 text-xs text-muted-foreground">
            No significant final rules recorded for this agency.
          </p>
        )}
      </section>
    </div>
  );
}

/** Federal Register rulemaking activity by agency: small multiples, flags and a detail view. */
export function RulemakingActivity() {
  const q = useQuery(rulemakingQuery);
  const agencies = useMemo(() => q.data?.agencies ?? [], [q.data]);
  const [picked, setPicked] = useState<string | null>(null);
  const active = agencies.find((a) => a.slug === picked) ?? agencies[0] ?? null;
  // Profile links only on an exact, unique name match with the Federal Register agency directory.
  const directory = useQuery(agencyDirectoryQuery);
  const profileId = useMemo(() => {
    if (!active) return null;
    const hits = (directory.data?.rows ?? []).filter((r) => r.name === active.name);
    return hits.length === 1 ? hits[0]!.id : null;
  }, [active, directory.data]);
  const flagged = agencies.flatMap((a) =>
    DOC_TYPES.flatMap((t) => (a.flags[t]?.flag ? [{ a, t, f: a.flags[t]! }] : [])),
  );

  return (
    <section className="space-y-3" aria-labelledby="rulemaking-title">
      <div>
        <h2 id="rulemaking-title" className="text-sm font-semibold">
          Federal Register rulemaking activity
        </h2>
        <p className="text-xs text-muted-foreground">
          Final rules, proposed rules and notices published per agency, counted by the Federal
          Register API
          {q.data?.asOf ? ` as of ${q.data.asOf}` : ""}. Flags compare the last 12 complete months
          with the agency's prior three-year rate (surge: unusually high, ≥1.25×; slowdown: ≤0.6× on
          a base of at least 10 a year).
        </p>
      </div>
      {q.isLoading ? (
        <div
          className="h-64 animate-pulse rounded-lg border border-border bg-muted/50"
          aria-busy="true"
        />
      ) : q.isError ? (
        <p
          role="alert"
          className="rounded-lg border border-border px-4 py-4 text-sm text-destructive"
        >
          Rulemaking activity could not be loaded.
        </p>
      ) : !agencies.length || !active ? (
        <p className="rounded-lg border border-border px-4 py-4 text-sm text-muted-foreground">
          Rulemaking activity has not been published yet.
        </p>
      ) : (
        <>
          {flagged.length ? (
            <ul
              className="flex flex-wrap gap-2 text-[11.5px]"
              aria-label="Flagged rulemaking changes"
            >
              {flagged.map(({ a, t, f }) => (
                <li
                  key={a.slug + t}
                  className="rounded-md border border-border bg-surface px-2 py-1"
                >
                  <span className="font-semibold">{a.short}</span> {TYPE_LABEL[t].toLowerCase()}:{" "}
                  <span
                    className={
                      f.flag === "surge" ? "text-warning-foreground" : "text-muted-foreground"
                    }
                  >
                    {f.recent} in last 12 months vs {f.baselineAnnual}/yr
                    {f.ratio != null ? ` (${f.ratio.toFixed(2)}×)` : ""}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
            {agencies.map((a) => (
              <SmallMultiple
                key={a.slug}
                agency={a}
                active={a.slug === active.slug}
                onPick={() => setPicked(a.slug)}
              />
            ))}
          </div>
          <p className="flex flex-wrap gap-x-4 gap-y-1 text-[11.5px]">
            {profileId != null ? (
              <Link
                to="/agencies/$id"
                params={{ id: String(profileId) }}
                className="text-primary hover:underline"
              >
                {active.short} profile: agenda, comment periods, spending, CFR →
              </Link>
            ) : null}
            <Link
              to="/agencies"
              search={{ view: "register" }}
              className="text-primary hover:underline"
            >
              Federal Register overview, every agency →
            </Link>
          </p>
          <AgencyDetail agency={active} />
        </>
      )}
    </section>
  );
}
