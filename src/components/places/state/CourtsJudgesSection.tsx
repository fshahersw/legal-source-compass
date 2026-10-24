import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ArrowRight, Gavel, Landmark, UsersRound } from "lucide-react";
import { CourtArtwork } from "@/components/corpus/CourtArtwork";
import { Spark } from "@/components/places/census/CensusCharts";
import { getStateOverview } from "@/lib/external/stateOverview.functions";
import type { DistrictRow } from "@/lib/external/stateOverviewModel";
import type { CourtRow } from "@/lib/external/directoryTree";
import { NOT_RECORDED } from "@/lib/external/censusModel";
import { appellateCourts, courtCounts } from "./stateOverviewView";

const n = (v: number | null | undefined) => (v == null ? NOT_RECORDED : v.toLocaleString("en-US"));

function Band({
  icon,
  title,
  note,
}: {
  icon: React.ReactNode;
  title: string;
  note?: string | undefined;
}) {
  return (
    <div className="research-band">
      <h3 className="flex items-center gap-2 text-label font-semibold text-foreground">
        {icon}
        {title}
      </h3>
      {note ? <span className="text-[11px] text-muted-foreground">{note}</span> : null}
    </div>
  );
}

function benchText(d: DistrictRow): string {
  if (!d.bench) return NOT_RECORDED;
  const { active, senior, judgeships } = d.bench;
  if (active == null && senior == null) return NOT_RECORDED;
  return `${active ?? NOT_RECORDED} active${senior != null ? ` · ${senior} senior` : ""}${judgeships != null ? ` · ${judgeships} judgeships` : ""}`;
}

/** Federal district table: bench, latest complete-year civil filings with a trend line, and pending MDL actions. */
function Districts({ usps, stateName }: { usps: string; stateName: string }) {
  const fn = useServerFn(getStateOverview);
  const q = useQuery({
    queryKey: ["state-overview", usps],
    queryFn: () => fn({ data: { usps } }),
    staleTime: 10 * 60_000,
  });
  const o = q.data;
  const asOf = o?.summary.asOf;
  return (
    <section
      className="resource-panel min-w-0"
      aria-label={`Federal district courts in ${stateName}`}
      data-testid="districts"
    >
      <Band
        icon={<Gavel className="size-4" aria-hidden />}
        title="Federal district courts"
        note={o ? `${o.districts.length} in ${stateName}` : undefined}
      />
      {q.isPending ? (
        <div
          role="status"
          aria-busy="true"
          className="space-y-2 p-3"
          aria-label="Loading districts"
        >
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-9 animate-pulse rounded bg-muted" />
          ))}
        </div>
      ) : q.error ? (
        <div role="alert" className="p-3 text-xs">
          District data could not load.{" "}
          <button type="button" className="text-primary underline" onClick={() => void q.refetch()}>
            Retry
          </button>
        </div>
      ) : !o || !o.districts.length ? (
        <p className="m-0 p-3 text-xs text-muted-foreground">
          {o?.unavailable.includes("districts")
            ? "Federal district records could not be read."
            : `No federal district court is recorded for ${stateName}.`}
        </p>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[40rem] text-left text-xs">
              <caption className="sr-only">
                Federal district courts in {stateName}: bench, civil filings in the latest complete
                fiscal year with a trend, and pending MDL actions
              </caption>
              <thead className="bg-muted/50 text-[11px] text-muted-foreground">
                <tr>
                  <th scope="col" className="px-3 py-1.5 font-medium">
                    District
                  </th>
                  <th scope="col" className="px-2 py-1.5 font-medium">
                    Judges
                  </th>
                  <th scope="col" className="px-2 py-1.5 text-right font-medium">
                    Civil filings
                  </th>
                  <th scope="col" className="px-2 py-1.5 font-medium">
                    Trend
                  </th>
                  <th scope="col" className="px-3 py-1.5 text-right font-medium">
                    Pending MDL actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {o.districts.map((d) => (
                  <tr
                    key={d.courtId}
                    className="border-t border-border/60 align-middle"
                    data-testid="district-row"
                  >
                    <th scope="row" className="px-3 py-2 text-left font-normal">
                      <div className="flex items-center gap-2">
                        <CourtArtwork
                          courtId={d.courtId}
                          title={d.name}
                          system="Federal"
                          type="Federal district"
                          compact
                        />
                        <Link
                          to="/courts/$id"
                          params={{ id: d.courtId }}
                          className="min-w-0 font-medium hover:underline"
                        >
                          <span className="block">{d.name}</span>
                          {d.circuit ? (
                            <span className="block text-[11px] font-normal text-muted-foreground">
                              {d.circuit}
                            </span>
                          ) : null}
                        </Link>
                      </div>
                    </th>
                    <td className="px-2 py-2 text-[11.5px] text-muted-foreground">
                      {benchText(d)}
                    </td>
                    <td className="px-2 py-2 text-right font-mono tabular-nums">
                      {d.latest ? (
                        <>
                          {n(d.latest.filings)}
                          <span className="block font-sans text-[10.5px] text-muted-foreground">
                            FY{d.latest.fy}
                          </span>
                        </>
                      ) : (
                        NOT_RECORDED
                      )}
                    </td>
                    <td className="px-2 py-2">
                      <Spark
                        points={d.series.map((p) => ({ year: p.fy, value: p.filings, moe: null }))}
                        label={`${d.name} civil filings`}
                      />
                    </td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums">
                      {d.mdl?.pendingActions != null ? (
                        <>
                          {n(d.mdl.pendingActions)}
                          <span className="block font-sans text-[10.5px] text-muted-foreground">
                            {d.mdl.pendingMdls ?? 0} {d.mdl.pendingMdls === 1 ? "MDL" : "MDLs"}
                          </span>
                        </>
                      ) : (
                        NOT_RECORDED
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="m-0 border-t border-border/60 px-3 py-2 text-[11px] leading-4 text-muted-foreground">
            Civil filings: Federal Judicial Center Integrated Database, complete fiscal years only
            (a year still in progress is not drawn); the trend line shows up to the last 12 complete
            fiscal years recorded for the district. Judges: FJC biographical directory
            {asOf ? `, as of ${asOf}` : ""}; pending MDL actions: Judicial Panel on Multidistrict
            Litigation pending-MDL reports. Courts that do not appear in a source show Not recorded,
            not zero.
          </p>
        </>
      )}
    </section>
  );
}

/** The state's own supreme and appellate courts, and the size of the court and judge directories. */
function StateCourts({
  usps,
  stateName,
  courts,
  loading,
  error,
  onRetry,
  onOpenCourts,
  onOpenJudges,
}: {
  usps: string;
  stateName: string;
  courts: CourtRow[] | undefined;
  loading: boolean;
  error: boolean;
  onRetry: () => void;
  onOpenCourts: () => void;
  onOpenJudges: () => void;
}) {
  const fn = useServerFn(getStateOverview);
  const overview = useQuery({
    queryKey: ["state-overview", usps],
    queryFn: () => fn({ data: { usps } }),
    staleTime: 10 * 60_000,
  });
  const top = courts ? appellateCourts(courts) : [];
  const counts = courts ? courtCounts(courts) : null;
  const profiles = overview.data?.judgeProfiles ?? null;
  return (
    <section
      className="resource-panel min-w-0"
      aria-label={`Courts and judges of ${stateName}`}
      data-testid="state-courts"
    >
      <Band
        icon={<Landmark className="size-4" aria-hidden />}
        title="State supreme and appellate courts"
        note={counts ? `${counts.total} courts in the directory` : undefined}
      />
      {loading ? (
        <p role="status" className="m-0 px-3 py-6 text-xs text-muted-foreground">
          Loading courts…
        </p>
      ) : error ? (
        <div role="alert" className="p-3 text-xs">
          Courts could not load.{" "}
          <button type="button" className="text-primary underline" onClick={onRetry}>
            Retry
          </button>
        </div>
      ) : top.length ? (
        <ul className="m-0 list-none divide-y divide-border/70 p-0">
          {top.slice(0, 8).map((court) => (
            <li key={court.id} className="flex items-center gap-2.5 px-3 py-2">
              <CourtArtwork
                courtId={court.id}
                title={court.title}
                system={court.system}
                type={court.type}
                compact
              />
              <Link
                to="/courts/$id"
                params={{ id: court.id }}
                className="min-w-0 flex-1 text-xs font-medium hover:underline"
              >
                <span className="line-clamp-2">{court.title}</span>
                <span className="mt-0.5 block text-[11px] font-normal text-muted-foreground">
                  {court.type}
                </span>
              </Link>
            </li>
          ))}
          {top.length > 8 ? (
            <li className="px-3 py-1.5 text-[11px] text-muted-foreground">
              and {top.length - 8} more appellate courts
            </li>
          ) : null}
        </ul>
      ) : (
        <p className="m-0 px-3 py-4 text-xs text-muted-foreground">
          No state supreme or appellate court is recorded in the court directory for {stateName}.
        </p>
      )}
      <div className="grid grid-cols-2 border-t border-border">
        <button
          type="button"
          onClick={onOpenCourts}
          className="flex items-center justify-between gap-2 border-r border-border bg-muted/30 px-3 py-2.5 text-left text-xs font-medium text-primary hover:bg-muted"
        >
          <span>
            All courts
            {counts ? (
              <span className="font-normal text-muted-foreground">
                {" "}
                · {counts.federal} federal, {counts.state} state
              </span>
            ) : null}
          </span>
          <ArrowRight className="size-3.5 shrink-0" aria-hidden />
        </button>
        <button
          type="button"
          onClick={onOpenJudges}
          className="flex items-center justify-between gap-2 bg-muted/30 px-3 py-2.5 text-left text-xs font-medium text-primary hover:bg-muted"
        >
          <span className="flex items-center gap-1.5">
            <UsersRound className="size-3.5" aria-hidden />
            Judges
            {profiles != null ? (
              <span className="font-normal text-muted-foreground">
                {" "}
                · {profiles.toLocaleString("en-US")} profiles
              </span>
            ) : null}
          </span>
          <ArrowRight className="size-3.5 shrink-0" aria-hidden />
        </button>
      </div>
    </section>
  );
}

export function CourtsJudgesSection(props: {
  usps: string;
  stateName: string;
  courts: CourtRow[] | undefined;
  courtsLoading: boolean;
  courtsError: boolean;
  onRetryCourts: () => void;
  onOpenCourts: () => void;
  onOpenJudges: () => void;
}) {
  return (
    <div className="grid items-start gap-3 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
      <Districts usps={props.usps} stateName={props.stateName} />
      <StateCourts
        usps={props.usps}
        stateName={props.stateName}
        courts={props.courts}
        loading={props.courtsLoading}
        error={props.courtsError}
        onRetry={props.onRetryCourts}
        onOpenCourts={props.onOpenCourts}
        onOpenJudges={props.onOpenJudges}
      />
    </div>
  );
}
