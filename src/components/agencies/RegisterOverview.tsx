import { useMemo } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { KeyTakeaways } from "@/components/analysis/KeyTakeaways";
import { usableTakeaways, signedPct, changePct, int } from "@/components/analysis/analysisFormat";
import { FDA_COLORS } from "@/components/fda-analytics/chartView";
import { numTick } from "@/components/enforcement/listDisplay";
import {
  axisTick,
  Kpi,
  LoadingBlock,
  Panel,
  StateNote,
  tooltipStyle,
} from "@/components/enforcement/parts";
import {
  getRegisterOverview,
  type RegisterOverview as Overview,
} from "@/lib/external/agencyProfile.functions";
import { ActivityChart } from "./ActivityChart";
import { AdminTable, CommentsTable, DocList, ExtLink, FR_API_DOCS, StageBar } from "./AgencyPanels";
import { adminComparison, fmt, lastYearVsAverage, KIND_LABEL } from "./agencyView";

const PRES_LABEL: Record<string, string> = {
  executive_order: "Executive orders",
  proclamation: "Proclamations",
  memorandum: "Memoranda",
  notice: "Notices",
  determination: "Determinations",
  presidential_order: "Presidential orders",
  other: "Other",
};

const registerOverviewKey = ["fr-overview"] as const;

function presidentialRows(o: Overview, from = 1995) {
  const last = Number(o.partialYear);
  const keys = Object.keys(o.presidentialYearly);
  const rows: Record<string, number | string | boolean>[] = [];
  for (let y = from; y <= last; y++) {
    const year = String(y);
    const row: Record<string, number | string | boolean> = {
      year,
      partial: year === o.partialYear,
    };
    for (const k of keys) row[k] = o.presidentialYearly[k]?.[year] ?? 0;
    rows.push(row);
  }
  return { rows, keys: keys.filter((k) => rows.some((r) => (r[k] as number) > 0)) };
}

function overviewTakeaways(o: Overview) {
  const fy = lastYearVsAverage(o.yearly.RULE, o.partialYear);
  const { current, previous } = adminComparison(o.byAdministration);
  const sigNow = current?.significantRulesPerYear;
  const sigBefore = previous?.significantRulesPerYear;
  const top = o.topAgencies.rows.filter((r) => r.kind !== "department")[0];
  return usableTakeaways([
    fy.ratio != null
      ? {
          id: "rules",
          figure: `${fy.ratio.toLocaleString("en-US", { maximumFractionDigits: 2 })}×`,
          text: `Final rules published in ${fy.year} (${int(fy.value)}) against the ${fy.from}–${fy.to} average (${int(fy.avg5)} a year).`,
          anchor: "fr-activity",
        }
      : null,
    current &&
    previous &&
    current.executiveOrdersPerYear != null &&
    previous.executiveOrdersPerYear != null
      ? {
          id: "eo",
          figure: `${current.executiveOrdersPerYear.toLocaleString("en-US", { maximumFractionDigits: 1 })}/yr`,
          text: `Executive orders signed a year since ${current.start} (${int(current.executiveOrders)}), against ${previous.executiveOrdersPerYear.toLocaleString("en-US", { maximumFractionDigits: 1 })}/yr under ${previous.label}.`,
          anchor: "fr-administrations",
        }
      : null,
    sigNow != null && sigBefore != null
      ? {
          id: "significant",
          figure: signedPct(changePct(sigNow, sigBefore)),
          text: `Pace of significant final rules since ${current!.start} (${sigNow.toLocaleString("en-US", { maximumFractionDigits: 1 })} a year) against ${previous!.label} (${sigBefore.toLocaleString("en-US", { maximumFractionDigits: 1 })} a year).`,
          anchor: "fr-administrations",
        }
      : null,
    top
      ? {
          id: "top-agency",
          figure: int(top.rules),
          text: `Final rules from ${top.name} in ${o.topAgencies.year}, the most of any non-department agency.`,
          anchor: "fr-agencies",
        }
      : null,
    o.openComments.count
      ? {
          id: "comments",
          figure: int(o.openComments.count),
          text: `Documents accepting comments on or after ${o.openComments.asOf}; ${int(o.openComments.closingWithin30Days)} close within 30 days.`,
          anchor: "fr-comments",
        }
      : null,
  ]);
}

/** The Federal Register as a whole: volume by type and administration, presidential documents, top agencies. */
export function RegisterOverview() {
  const read = useServerFn(getRegisterOverview);
  const q = useQuery({
    queryKey: registerOverviewKey,
    queryFn: () => read(),
    staleTime: 10 * 60_000,
  });
  const pres = useMemo(() => (q.data ? presidentialRows(q.data) : null), [q.data]);
  const takeaways = useMemo(() => (q.data ? overviewTakeaways(q.data) : []), [q.data]);
  if (q.isPending) return <LoadingBlock label="Loading the Federal Register overview" />;
  if (q.isError)
    return (
      <StateNote
        tone="error"
        action={
          <button type="button" className="text-primary underline" onClick={() => void q.refetch()}>
            Retry overview
          </button>
        }
      >
        The Federal Register overview could not be loaded.
      </StateNote>
    );
  const o = q.data;
  if (!o) return <StateNote>The Federal Register overview has not been published yet.</StateNote>;
  const last = String(Number(o.partialYear) - 1);
  const current = o.byAdministration.find((a) => a.current);
  const max = Math.max(1, ...o.topAgencies.rows.map((r) => r.rules));
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
        <Kpi
          label="Documents since 1994"
          value={fmt(Object.values(o.yearly.ALL).reduce((a, b) => a + b, 0))}
          note={`To ${o.asOf}`}
        />
        <Kpi
          label={`Final rules ${last}`}
          value={fmt(o.yearly.RULE[last])}
          note={`${fmt(o.yearly.RULE[o.partialYear])} so far in ${o.partialYear}`}
        />
        <Kpi
          label={`Proposed rules ${last}`}
          value={fmt(o.yearly.PRORULE[last])}
          note={`${fmt(o.yearly.NOTICE[last])} notices`}
        />
        <Kpi
          label={`Significant final rules ${last}`}
          value={fmt(o.significantYearly.RULE[last])}
          note={`${fmt(o.significantTotals.RULE)} since 1994`}
        />
        <Kpi
          label="Open comment periods (Federal Register)"
          value={fmt(o.openComments.count)}
          note={`Federal Register documents, as of ${o.openComments.asOf}`}
        />
        <Kpi
          label="Executive orders this term"
          value={fmt(current?.executiveOrders)}
          note={current ? `Signed since ${current.start}` : undefined}
        />
      </div>
      <KeyTakeaways
        title="What stands out"
        items={takeaways}
        scope={`Federal Register to ${o.asOf}`}
      />
      <Panel
        id="fr-activity"
        title="Documents published per year"
        subtitle="All agencies, with the administration in office"
        footnote={
          <>
            Counts by publication date from the Federal Register API; significant = a Unified Agenda
            entry deemed significant under EO 12866.{" "}
            <ExtLink href={FR_API_DOCS}>Federal Register API</ExtLink>
          </>
        }
      >
        <ActivityChart trends={o} views={["rules", "NOTICE", "PRESDOCU", "ALL"]} />
      </Panel>
      <div className="grid gap-3 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Panel
          id="fr-administrations"
          title="By administration"
          subtitle="January 20 to January 19 windows (Amendment XX); executive orders by signing date"
        >
          <AdminTable rows={o.byAdministration} showExecutiveOrders />
        </Panel>
        <Panel title="Presidential documents per year" subtitle="By presidential document type">
          {pres && pres.keys.length ? (
            <div className="h-60 px-1 pb-1">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={pres.rows} margin={{ top: 6, right: 8, bottom: 0, left: -10 }}>
                  <CartesianGrid stroke="var(--border)" vertical={false} />
                  <XAxis
                    dataKey="year"
                    tick={axisTick}
                    interval="preserveStartEnd"
                    minTickGap={14}
                  />
                  <YAxis tick={axisTick} tickFormatter={numTick} width={40} />
                  <Tooltip contentStyle={tooltipStyle} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  {pres.keys.map((k, i) => (
                    <Bar
                      key={k}
                      dataKey={k}
                      name={PRES_LABEL[k] ?? k}
                      stackId="p"
                      fill={i < FDA_COLORS.length ? FDA_COLORS[i] : "var(--muted-foreground)"}
                      isAnimationActive={false}
                    />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <p className="px-3 py-3 text-xs text-muted-foreground">
              No presidential documents recorded.
            </p>
          )}
        </Panel>
      </div>
      <div className="grid gap-3 xl:grid-cols-2">
        <Panel
          id="fr-agencies"
          title={`Most final rules in ${o.topAgencies.year}`}
          subtitle="Agencies as the Federal Register lists them; departments include their components"
        >
          <ul className="space-y-1 px-3 py-2">
            {o.topAgencies.rows.slice(0, 15).map((r) => (
              <li
                key={r.agencyId}
                className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_3.5rem] items-center gap-2 text-xs"
              >
                <Link
                  to="/agencies/$id"
                  params={{ id: String(r.agencyId) }}
                  className="truncate text-primary hover:underline"
                  title={`${r.name} · ${KIND_LABEL[r.kind]}`}
                >
                  {r.name}
                </Link>
                <span className="h-2 rounded-sm bg-muted">
                  <span
                    className="block h-2 rounded-sm bg-primary"
                    style={{ width: `${(r.rules / max) * 100}%` }}
                  />
                </span>
                <span className="text-right font-mono">{fmt(r.rules)}</span>
              </li>
            ))}
          </ul>
        </Panel>
        <Panel
          title="Unified Agenda pipeline"
          subtitle={
            o.agenda
              ? `${fmt(o.agenda.total)} actions in publication ${o.agenda.edition}, the only edition held; projected dates are as printed then`
              : "Not recorded"
          }
        >
          {o.agenda ? (
            <div className="space-y-2 px-3 py-2">
              <StageBar byStage={o.agenda.byStage} total={o.agenda.total} />
              <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-4">
                {[
                  [
                    "Economically significant",
                    o.agenda.byPriority["Economically Significant"] ?? 0,
                  ],
                  ["Other significant", o.agenda.byPriority["Other Significant"] ?? 0],
                  ["Major (CRA)", o.agenda.major],
                  ["With a legal deadline", o.agenda.withLegalDeadline],
                ].map(([label, value]) => (
                  <div key={label as string}>
                    <dt className="text-[11px] text-muted-foreground">{label}</dt>
                    <dd className="font-mono">{fmt(value as number)}</dd>
                  </div>
                ))}
              </dl>
              <Link
                to="/data/$dataset"
                params={{ dataset: "unified_agenda_pipeline" }}
                className="inline-block text-[11px] text-primary hover:underline"
              >
                Browse every agenda action →
              </Link>
            </div>
          ) : (
            <p className="px-3 py-3 text-xs text-muted-foreground">
              The Unified Agenda summary is not recorded.
            </p>
          )}
        </Panel>
      </div>
      <div className="grid gap-3 xl:grid-cols-2">
        <Panel title="Latest significant final rules">
          <DocList docs={o.latestSignificantRules} empty="No significant final rules recorded." />
        </Panel>
        <Panel
          title="Latest executive orders"
          subtitle={`${fmt(o.executiveOrders.total)} signed and published since 1994`}
        >
          <ul className="divide-y divide-border/60">
            {o.executiveOrders.latest.map((e) => (
              <li
                key={e.url}
                className="grid gap-x-3 px-3 py-1.5 text-xs sm:grid-cols-[5.5rem_minmax(0,1fr)]"
              >
                <span className="font-mono text-[11px] text-muted-foreground">{e.signed}</span>
                <span className="min-w-0">
                  <ExtLink href={e.url}>
                    <span className="font-medium">
                      EO {e.number}: {e.title}
                    </span>
                  </ExtLink>
                  <span className="block text-[11px] text-muted-foreground">
                    {[e.president, e.citation].filter(Boolean).join(" · ")}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </Panel>
      </div>
      <Panel
        id="fr-comments"
        title="Comment periods closing soonest"
        subtitle={`${fmt(o.openComments.count)} documents accept comments on or after ${o.openComments.asOf}`}
      >
        <CommentsTable comments={o.openComments} limit={12} />
      </Panel>
    </div>
  );
}
