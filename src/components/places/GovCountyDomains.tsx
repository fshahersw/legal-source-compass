import { useMemo } from "react";
import { ChevronRight, Globe2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { matchCountyRows, parseCensusArea } from "@/lib/external/govDomainsModel";
import { GovDomainRow, GovDomainsPanel } from "@/components/places/state/GovDomainsPanel";
import { useGovStateQuery } from "@/components/places/state/useGovStateQuery";
import { matchLine, snapshotText } from "@/components/places/state/govDomainsView";

/**
 * Official government websites on a county page. Neither registry gives a county, so the county's own domains are listed
 * only where the publisher's organization name (or GSA note) equals the Census name of the area exactly, each with the
 * sentence that says how it matched. Everything else is the state's list, searchable, rather than a guess.
 */
export function GovCountyDomains({
  usps,
  stateName,
  areaName,
  areaPending,
}: {
  usps: string;
  stateName: string;
  /** The Census name of the area, "Laramie County, Wyoming" (null until it has loaded or when the Census has none). */
  areaName: string | null;
  /** True while the Census name is still loading: nothing is matched, and nothing is said about a match, until it is known. */
  areaPending: boolean;
}) {
  const q = useGovStateQuery(usps, true);
  const area = useMemo(() => (areaName ? parseCensusArea(areaName) : null), [areaName]);
  const matches = useMemo(
    () => (area && q.data ? matchCountyRows(q.data.rows, area, usps) : []),
    [area, q.data, usps],
  );
  const data = q.data;
  const pending = q.isPending || areaPending;
  return (
    <section
      className="resource-panel mt-3"
      aria-label={`Official government websites for ${area?.full ?? "this county"}`}
      data-testid="county-gov-domains"
    >
      <div className="research-band">
        <h3 className="flex items-center gap-2 font-sans text-sm font-semibold">
          <Globe2 className="size-4" aria-hidden />
          Official government websites
        </h3>
        <span className="text-xs tabular-nums text-[var(--navy-muted)]" role="status">
          {pending ? "Loading…" : data?.available ? `${matches.length} named exactly` : ""}
        </span>
      </div>
      {q.error ? (
        <div role="alert" className="flex items-center justify-between gap-3 px-3 py-2 text-xs">
          <span>The government website registries could not be read.</span>
          <Button variant="link" size="sm" onClick={() => void q.refetch()}>
            Retry
          </Button>
        </div>
      ) : null}
      {pending ? (
        <div className="space-y-2 p-3" role="status" aria-label="Loading government websites">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-2/3" />
        </div>
      ) : null}
      {data && !data.available ? (
        <p className="m-0 px-4 py-6 text-sm text-muted-foreground" role="status">
          The government website registries are not available in this workspace yet.
        </p>
      ) : null}
      {data?.available && !areaPending ? (
        <>
          {!area ? (
            <p
              className="m-0 border-b border-border px-3 py-2 text-xs text-muted-foreground"
              role="status"
            >
              The Census name of this area is not available, so no domain can be matched to it
              exactly. The {stateName} list is below.
            </p>
          ) : matches.length ? (
            <ul
              className="m-0 list-none divide-y divide-border/60 p-0"
              aria-label={`Domains named ${area.full}`}
            >
              {matches.map((m) => (
                <GovDomainRow
                  key={m.row.id}
                  row={m.row}
                  extra={`Matched because ${matchLine(m)}`}
                />
              ))}
            </ul>
          ) : (
            <p
              className="m-0 border-b border-border px-3 py-2 text-xs text-muted-foreground"
              role="status"
            >
              No registered domain has “{area.full}” as its organization name, so none is matched to
              this county. Offices such as a sheriff, clerk or library carry their own names and are
              not matched this way; search the {stateName} list below.
            </p>
          )}
          <div className="border-t border-border bg-muted/30 px-3 py-2 text-[11px] leading-4 text-muted-foreground">
            A domain is matched to a county only when the registry&rsquo;s own organization name (or
            GSA&rsquo;s note) equals the Census name of the county exactly; no registry gives a
            county. {snapshotText(data.snapshot)}.
          </div>
          <details className="group border-t border-border">
            <summary className="flex cursor-pointer list-none items-center gap-1.5 px-3 py-2 text-xs font-medium hover:bg-muted/40 focus-visible:outline-2 focus-visible:outline-ring">
              <ChevronRight
                className="size-3.5 transition-transform group-open:rotate-90"
                aria-hidden
              />
              All {data.total.toLocaleString("en-US")} registered government websites in {stateName}
            </summary>
            <GovDomainsPanel usps={usps} stateName={stateName} embedded />
          </details>
        </>
      ) : null}
    </section>
  );
}
