import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getStateCensus } from "@/lib/external/census.functions";
import { formatCensus, NOT_RECORDED } from "@/lib/external/censusModel";
import { getStateOverview } from "@/lib/external/stateOverview.functions";
import type { CourtRow } from "@/lib/external/directoryTree";
import { isJudicialCourtRecord } from "@/lib/corpus/courtDirectoryKind";
import { cn } from "@/lib/utils";
import { filingsChange, uniqueCircuits } from "./stateOverviewView";

type TileProps = {
  label: string;
  value: ReactNode;
  note: ReactNode;
  href: string;
  loading?: boolean;
  testId: string;
};

function Tile({ label, value, note, href, loading, testId }: TileProps) {
  return (
    <li className="min-w-0">
      <a
        href={href}
        data-testid={testId}
        className={cn(
          "block h-full rounded-md border border-border bg-surface px-3 py-2 transition-colors hover:border-primary/30 hover:bg-muted/30 focus-visible:outline-2 focus-visible:outline-ring",
        )}
      >
        <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </div>
        <div
          className="mt-0.5 font-mono text-xl font-semibold tabular-nums"
          aria-busy={loading || undefined}
        >
          {loading ? (
            <span
              className="inline-block h-6 w-20 animate-pulse rounded bg-muted align-middle"
              aria-label="Loading"
            />
          ) : (
            value
          )}
        </div>
        <div className="mt-0.5 text-[11px] leading-4 text-muted-foreground">
          {loading ? "" : note}
        </div>
      </a>
    </li>
  );
}

/**
 * The state's key facts in one band: population, courts, judges, federal districts, pending MDL actions and recent federal
 * filings. Each figure names its source and date; a figure that is not available says so, and none is estimated.
 */
export function StateHeaderBand({
  usps,
  stateName,
  courts,
  courtsLoading,
}: {
  usps: string;
  stateName: string;
  courts: CourtRow[] | undefined;
  courtsLoading: boolean;
}) {
  const censusFn = useServerFn(getStateCensus);
  const overviewFn = useServerFn(getStateOverview);
  const census = useQuery({
    queryKey: ["state-census", usps],
    queryFn: () => censusFn({ data: { usps } }),
    staleTime: 10 * 60_000,
  });
  const overview = useQuery({
    queryKey: ["state-overview", usps],
    queryFn: () => overviewFn({ data: { usps } }),
    staleTime: 10 * 60_000,
  });
  const judicial = (courts ?? []).filter(isJudicialCourtRecord);
  const federal = judicial.filter((c) => c.system.toLowerCase() === "federal").length;
  const stateCourts = judicial.filter((c) => c.system.toLowerCase() === "state").length;
  const pep = census.data?.pep?.latest ?? null;
  const o = overview.data;
  const s = o?.summary;
  const change = s?.filings ? filingsChange(s.filings) : null;
  const circuits = o ? uniqueCircuits(o.districts) : [];
  return (
    <section aria-label={`${stateName} at a glance`} data-testid="state-header-band">
      <ul className="m-0 grid list-none grid-cols-2 gap-2 p-0 md:grid-cols-3 xl:grid-cols-6">
        <Tile
          testId="fact-population"
          label="Population"
          href="#demographics"
          loading={census.isPending}
          value={pep ? formatCensus(pep.value, "int") : NOT_RECORDED}
          note={
            pep
              ? `${pep.rank && pep.of ? `#${pep.rank} of ${pep.of} · ` : ""}${pep.date}`
              : census.error
                ? "Could not load"
                : "No estimate recorded"
          }
        />
        <Tile
          testId="fact-courts"
          label="Courts"
          href="#courts"
          loading={courtsLoading}
          value={courts ? judicial.length.toLocaleString("en-US") : NOT_RECORDED}
          note={
            courts
              ? `${federal} federal · ${stateCourts} state`
              : "Directory not loaded"
          }
        />
        <Tile
          testId="fact-judges"
          label="Judges"
          href="#courts"
          loading={overview.isPending}
          value={o?.judgeProfiles != null ? o.judgeProfiles.toLocaleString("en-US") : NOT_RECORDED}
          note={
            s?.activeJudges != null
              ? `${s.activeJudges} active federal district judges`
              : "profiles in the directory"
          }
        />
        <Tile
          testId="fact-districts"
          label="Federal districts"
          href="#courts"
          loading={overview.isPending}
          value={s ? String(s.districts) : NOT_RECORDED}
          note={circuits.length ? circuits.join(", ") : "No federal district recorded"}
        />
        <Tile
          testId="fact-mdl"
          label="Pending MDL actions"
          href="#litigation"
          loading={overview.isPending}
          value={
            s?.pendingActions != null ? s.pendingActions.toLocaleString("en-US") : NOT_RECORDED
          }
          note={
            s?.pendingActions != null
              ? `in ${s.pendingMdls ?? 0} MDLs · ${s.asOf ?? "latest"}`
              : "Not recorded for every district"
          }
        />
        <Tile
          testId="fact-filings"
          label="Recent federal filings"
          href="#litigation"
          loading={overview.isPending}
          value={s?.filings ? s.filings.value.toLocaleString("en-US") : NOT_RECORDED}
          note={
            s?.filings
              ? `civil, FY${s.filings.fy}${change ? ` · ${change} vs FY${s.filings.fy - 1}` : ""}`
              : "No complete fiscal year recorded"
          }
        />
      </ul>
      {overview.error || census.error ? (
        <p role="status" className="m-0 mt-1.5 text-[11px] text-muted-foreground">
          Some figures could not load.{" "}
          <button
            type="button"
            className="text-primary underline"
            onClick={() => {
              void overview.refetch();
              void census.refetch();
            }}
          >
            Retry
          </button>
        </p>
      ) : null}
      {o?.unavailable.length ? (
        <p role="status" className="m-0 mt-1.5 text-[11px] text-muted-foreground">
          Not loaded: {o.unavailable.join(", ")}.
        </p>
      ) : null}
    </section>
  );
}
