import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Network } from "lucide-react";
import { StateConsumerProtectionPanel } from "@/components/states/consumer/StateConsumerProtectionPanel";
import { StateCourtDataPanel } from "@/components/states/courtdata/StateCourtDataPanel";
import { StateFederalDataPanel } from "@/components/states/StateFederalDataPanel";
import { StateMdlScopePanel } from "@/components/states/StateMdlScopePanel";
import { NOT_RECORDED } from "@/lib/external/censusModel";
import { getStateCourtData } from "@/lib/external/stateCourtData.functions";
import { getStateOverview } from "@/lib/external/stateOverview.functions";
import { getStateTrends } from "@/lib/external/stateTrends.functions";
import { TrendFigure, type FigureRow } from "./TrendFigure";

const int = (v: number) => v.toLocaleString("en-US");
const rate = (v: number) =>
  v.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const FJC_SOURCE = "https://www.fjc.gov/research/idb";

function Loading({ label }: { label: string }) {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label={label}
      className="h-56 animate-pulse rounded-md border border-border bg-muted/50"
    />
  );
}
function Failed({ what, onRetry }: { what: string; onRetry: () => void }) {
  return (
    <div role="alert" className="rounded-md border border-border bg-surface p-3 text-xs">
      {what} could not load.{" "}
      <button type="button" className="text-primary underline" onClick={onRetry}>
        Retry
      </button>
    </div>
  );
}
function Absent({ children }: { children: string }) {
  return (
    <p className="m-0 rounded-md border border-border bg-surface p-3 text-xs text-muted-foreground">
      {children}
    </p>
  );
}

/** Federal civil filings, terminations and year-end pending cases for the state's districts together (FJC IDB). */
function FilingsChart({ usps, stateName }: { usps: string; stateName: string }) {
  const fn = useServerFn(getStateCourtData);
  const q = useQuery({
    queryKey: ["state-court-data", usps],
    queryFn: () => fn({ data: { usps } }),
    staleTime: 10 * 60_000,
  });
  if (q.isPending) return <Loading label="Loading federal filings" />;
  if (q.error) return <Failed what="Federal civil filings" onRetry={() => void q.refetch()} />;
  const civil = q.data?.civil;
  if (!civil) return <Absent>{`No federal civil caseload is recorded for ${stateName}.`}</Absent>;
  const rows: FigureRow[] = civil.series.map((y) => ({
    x: y.fy,
    filings: y.filings,
    terminations: y.terminations,
    pending: y.pending,
  }));
  const first = civil.series[0]?.fy;
  return (
    <TrendFigure
      title="Federal civil cases"
      unit="cases per fiscal year, all districts of the state together"
      period={
        first ? `FY${first} to FY${civil.latestFy}, complete years` : `through FY${civil.latestFy}`
      }
      source={{
        label: "Federal Judicial Center, Integrated Database",
        href: civil.sourceUrl ?? FJC_SOURCE,
      }}
      xLabel="Fiscal year"
      format={int}
      series={[
        { id: "filings", label: "Filed", tone: "primary" },
        { id: "terminations", label: "Terminated", tone: "ring" },
        { id: "pending", label: "Pending at September 30", tone: "muted" },
      ]}
      rows={rows}
      note={
        civil.partialYear
          ? `FY${civil.partialYear.fy} is still in progress and is not drawn`
          : undefined
      }
      how={[
        {
          term: "Filed / terminated",
          means:
            "Civil cases opened and closed in the federal district courts of the state during the fiscal year (October 1 to September 30).",
          caveat: "Counts are cases, not parties or claims.",
        },
        {
          term: "Pending",
          means: "Civil cases still open on September 30 of the fiscal year.",
          caveat: "A stock, not a flow: it can rise while filings fall.",
        },
        {
          term: "Years",
          means: "Only complete fiscal years are drawn. A year in progress would look like a drop.",
        },
      ]}
    />
  );
}

/** CFPB complaints per 100,000 residents by complete calendar year. */
function ComplaintsChart({ usps, stateName }: { usps: string; stateName: string }) {
  const fn = useServerFn(getStateTrends);
  const q = useQuery({
    queryKey: ["state-trends", usps],
    queryFn: () => fn({ data: { usps } }),
    staleTime: 10 * 60_000,
  });
  if (q.isPending) return <Loading label="Loading complaint trend" />;
  if (q.error || q.data?.unavailable.includes("cfpb"))
    return <Failed what="The complaint trend" onRetry={() => void q.refetch()} />;
  const cfpb = q.data?.cfpb;
  if (!cfpb)
    return <Absent>{`No consumer finance complaint series is recorded for ${stateName}.`}</Absent>;
  const withRate = cfpb.years.filter((y) => y.per100k != null);
  const rows: FigureRow[] = cfpb.years.map((y) => ({
    x: y.year,
    rate: y.per100k,
    complaints: y.complaints,
  }));
  const vintages = [...new Set(cfpb.years.map((y) => y.vintage).filter((v): v is string => !!v))];
  return (
    <TrendFigure
      title="Consumer finance complaints (CFPB)"
      unit="complaints per 100,000 residents, by calendar year"
      period={`${cfpb.years[0]!.year} to ${cfpb.years.at(-1)!.year}, complete years`}
      source={{
        label: "Consumer Financial Protection Bureau, Consumer Complaint Database",
        href: cfpb.sourceUrl,
      }}
      xLabel="Year"
      format={rate}
      series={[{ id: "rate", label: "Per 100,000 residents", tone: "primary" }]}
      rows={rows}
      note={`${withRate.length} of ${cfpb.years.length} years have a population denominator${vintages.length ? ` (${vintages.join(", ")})` : ""}`}
      how={[
        {
          term: "Complaints",
          means:
            "Complaints about consumer financial products that the CFPB received and published, assigned to the state of the consumer's address.",
          caveat: "Complaints are consumers' accounts, not findings of wrongdoing.",
        },
        {
          term: "Per 100,000",
          means:
            "The complaint count divided by the state's resident population for that year (Census Bureau estimates; the vintage is named in the note).",
          caveat:
            "A year still in progress is not drawn; a year without a population denominator is a gap.",
        },
      ]}
    />
  );
}

/** OSHA inspections by federal fiscal year. */
function InspectionsChart({ usps, stateName }: { usps: string; stateName: string }) {
  const fn = useServerFn(getStateTrends);
  const q = useQuery({
    queryKey: ["state-trends", usps],
    queryFn: () => fn({ data: { usps } }),
    staleTime: 10 * 60_000,
  });
  if (q.isPending) return <Loading label="Loading inspection trend" />;
  if (q.error || q.data?.unavailable.includes("osha"))
    return <Failed what="The inspection trend" onRetry={() => void q.refetch()} />;
  const osha = q.data?.osha;
  if (!osha) return <Absent>{`No OSHA inspection series is recorded for ${stateName}.`}</Absent>;
  const rows: FigureRow[] = osha.years.map((y) => ({
    x: y.fy,
    inspections: y.inspections,
    federal: y.federal,
    statePlan: y.statePlan,
  }));
  const hasSplit = osha.years.some((y) => (y.statePlan ?? 0) > 0);
  return (
    <TrendFigure
      title="Workplace safety inspections (OSHA)"
      unit="inspections per federal fiscal year"
      period={`FY${osha.years[0]!.fy} to FY${osha.latestFy}, complete years`}
      source={{ label: "U.S. Department of Labor, OSHA enforcement data", href: osha.sourceUrl }}
      xLabel="Fiscal year"
      format={int}
      series={[
        { id: "inspections", label: "All inspections", tone: "primary" },
        ...(hasSplit
          ? ([
              { id: "federal", label: "Federal OSHA", tone: "ring" },
              { id: "statePlan", label: "State Plan offices", tone: "muted" },
            ] as const)
          : []),
      ]}
      rows={rows}
      note={
        [
          osha.plan,
          osha.rate
            ? `FY${osha.latestFy}: ${rate(osha.rate.value)} per 100,000 covered jobs (${osha.rate.denominator}, ${osha.rate.year})`
            : null,
        ]
          .filter(Boolean)
          .join(" · ") || undefined
      }
      how={[
        {
          term: "Inspections",
          means:
            "Workplace inspections by federal OSHA and State Plan offices that the OSHA enforcement data records for the fiscal year (October 1 to September 30).",
          caveat:
            "A state with its own OSHA-approved plan is inspected by its state office, so the split between federal and State Plan counts changes with the plan, not only with activity.",
        },
        { term: "Years", means: "Only complete fiscal years are drawn, the last 15 at most." },
      ]}
    />
  );
}

/** MDLs with actions pending before the state's districts, most actions first. */
function PendingMdls({ usps, stateName }: { usps: string; stateName: string }) {
  const fn = useServerFn(getStateOverview);
  const q = useQuery({
    queryKey: ["state-overview", usps],
    queryFn: () => fn({ data: { usps } }),
    staleTime: 10 * 60_000,
  });
  const [all, setAll] = useState(false);
  const o = q.data;
  const mdls = o?.summary.mdls ?? [];
  const shown = all ? mdls : mdls.slice(0, 10);
  const names = new Map((o?.districts ?? []).map((d) => [d.courtId, d.name]));
  return (
    <section
      className="resource-panel min-w-0"
      aria-label={`Pending MDLs in ${stateName}`}
      data-testid="pending-mdls"
    >
      <div className="research-band">
        <h3 className="flex items-center gap-2 text-label font-semibold text-foreground">
          <Network className="size-4" aria-hidden />
          Pending MDLs before the state's courts
        </h3>
        <span className="text-[11px] text-muted-foreground">
          {o?.summary.asOf ? `JPML, ${o.summary.asOf}` : "JPML"}
        </span>
      </div>
      {q.isPending ? (
        <p role="status" className="m-0 px-3 py-6 text-xs text-muted-foreground">
          Loading…
        </p>
      ) : q.error || o?.unavailable.includes("benches") ? (
        <div role="alert" className="p-3 text-xs">
          Pending MDLs could not load.{" "}
          <button type="button" className="text-primary underline" onClick={() => void q.refetch()}>
            Retry
          </button>
        </div>
      ) : !mdls.length ? (
        <p className="m-0 px-3 py-4 text-xs text-muted-foreground">
          The Judicial Panel on Multidistrict Litigation's pending-MDL reports list no MDL before a
          district court of {stateName}.
        </p>
      ) : (
        <>
          <table className="w-full text-left text-xs">
            <caption className="sr-only">
              MDLs with actions pending before the district courts of {stateName}
            </caption>
            <thead className="bg-muted/50 text-[11px] text-muted-foreground">
              <tr>
                <th scope="col" className="px-3 py-1.5 font-medium">
                  MDL, district and judge
                </th>
                <th scope="col" className="px-3 py-1.5 text-right font-medium">
                  Pending actions
                </th>
              </tr>
            </thead>
            <tbody>
              {shown.map((m) => (
                <tr
                  key={`${m.courtId}-${m.mdl}`}
                  className="border-t border-border/60 align-top"
                  data-testid="mdl-row"
                >
                  <td className="px-3 py-1.5">
                    <Link
                      to="/matters/lens/$mdl"
                      params={{ mdl: String(m.mdl) }}
                      className="font-medium text-primary hover:underline"
                    >
                      MDL {m.mdl}
                    </Link>
                    <span className="block text-[11.5px] leading-4">{m.title}</span>
                    <span className="block text-[11px] leading-4 text-muted-foreground">
                      <Link to="/courts/$id" params={{ id: m.courtId }} className="hover:underline">
                        {names.get(m.courtId) ?? m.courtId}
                      </Link>
                      {" · "}
                      {m.judge ?? `Judge ${NOT_RECORDED}`}
                    </span>
                  </td>
                  <td className="px-3 py-1.5 text-right font-mono tabular-nums">
                    {int(m.pending)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/60 px-3 py-2 text-[11px] text-muted-foreground">
            <span>
              {mdls.length} MDLs ·{" "}
              {o?.summary.pendingActions != null
                ? `${int(o.summary.pendingActions)} actions in all`
                : `total ${NOT_RECORDED} (a district has no report)`}
              . Source: Judicial Panel on Multidistrict Litigation, pending-MDL reports; pending
              actions are those before the transferee district, not only cases filed in the state.
            </span>
            {mdls.length > 10 ? (
              <button
                type="button"
                className="font-medium text-primary hover:underline"
                onClick={() => setAll((v) => !v)}
              >
                {all ? "Show the first 10" : `Show all ${mdls.length}`}
              </button>
            ) : null}
          </div>
        </>
      )}
    </section>
  );
}

/**
 * Litigation and enforcement for the state: federal civil caseload trend, MDLs pending before its courts, MDL cases that
 * started here, yearly complaint and inspection trends, and the latest federal enforcement figures.
 */
export function LitigationSection({ usps, stateName }: { usps: string; stateName: string }) {
  // Two independent stacks (not rows), so a panel that opens or is short never leaves a gap beside a tall one.
  return (
    <div className="grid items-start gap-3 xl:grid-cols-2">
      <div className="min-w-0 space-y-3">
        <FilingsChart usps={usps} stateName={stateName} />
        <StateCourtDataPanel key={`court-data-${usps}`} usps={usps} />
        <ComplaintsChart usps={usps} stateName={stateName} />
      </div>
      <div className="min-w-0 space-y-3">
        <PendingMdls usps={usps} stateName={stateName} />
        <StateMdlScopePanel key={`mdl-scope-${usps}`} usps={usps} />
        <StateFederalDataPanel key={`federal-${usps}`} usps={usps} />
        <InspectionsChart usps={usps} stateName={stateName} />
        <StateConsumerProtectionPanel key={`consumer-${usps}`} usps={usps} />
      </div>
    </div>
  );
}
