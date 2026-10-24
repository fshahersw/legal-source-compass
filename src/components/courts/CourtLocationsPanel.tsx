import { useQuery } from "@tanstack/react-query";
import { ExternalLink, MapPin } from "lucide-react";
import {
  getCourtLocations,
  mapHref,
  type CourtLocation,
} from "@/lib/external/courtLocations.functions";

/** "cand.uscourts.gov/about-court/court-locations" for a source page. */
const pageLabel = (url: string) => {
  try {
    const u = new URL(url);
    return u.host.replace(/^www\./, "") + (u.pathname !== "/" ? u.pathname : "");
  } catch {
    return url;
  }
};

/** Courthouse addresses a court publishes on its own website (dataset court_locations). Renders nothing when none are recorded. */
export function CourtLocationsPanel({ courtId }: { courtId: string }) {
  const q = useQuery({
    queryKey: ["court-locations", courtId],
    queryFn: () => getCourtLocations({ data: { id: courtId } }),
    staleTime: 10 * 60 * 1000,
  });
  if (q.isLoading)
    return (
      <div
        className="mb-5 h-20 animate-pulse rounded-lg border border-border bg-muted/40"
        aria-busy="true"
        aria-label="Loading courthouse locations"
      />
    );
  if (q.isError)
    return (
      <p
        role="alert"
        className="mb-5 flex flex-wrap items-center gap-2 rounded-lg border border-border px-4 py-3 text-xs text-muted-foreground"
      >
        Courthouse locations could not be loaded.
        <button
          type="button"
          onClick={() => void q.refetch()}
          className="rounded text-primary underline focus-visible:outline-2 focus-visible:outline-ring"
        >
          Retry
        </button>
      </p>
    );
  const data = q.data;
  if (!data) return null;
  const sources = [...new Set(data.locations.map((l) => l.sourceUrl))];
  const cities = new Set(data.locations.map((l) => `${l.city}, ${l.state}`));
  return (
    <section
      aria-label="Courthouse locations"
      className="mb-5 rounded-xl border border-border bg-card shadow-xs"
    >
      <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border/70 px-4 py-3">
        <h2 className="m-0 text-heading font-semibold text-foreground">Courthouse locations</h2>
        <p className="m-0 text-xs text-muted-foreground">
          {data.locations.length} address{data.locations.length === 1 ? "" : "es"} in {cities.size}{" "}
          {cities.size === 1 ? "city" : "cities"}, as published by the court
        </p>
      </header>
      <ul className="m-0 grid list-none gap-2 p-3 sm:grid-cols-2 lg:grid-cols-3">
        {data.locations.map((l) => (
          <LocationCard key={`${l.address1}|${l.zip}`} l={l} />
        ))}
      </ul>
      <footer className="space-y-1 border-t border-border/70 px-4 py-2 text-[11px] leading-relaxed text-muted-foreground">
        <p className="m-0">
          Read from{" "}
          {sources.map((s, i) => (
            <span key={s}>
              {i ? ", " : ""}
              <a
                href={s}
                target="_blank"
                rel="noreferrer"
                className="underline hover:text-foreground"
              >
                {pageLabel(s)}
              </a>
            </span>
          ))}
          . A court may have offices its website does not list on these pages. Map positions come
          from the U.S. Census Bureau Geocoder; addresses it could not match have none.
        </p>
        {data.sharedSiteWith.length ? (
          <p className="m-0">
            This court shares its website with {data.sharedSiteWith.join(", ")}.
          </p>
        ) : null}
        {data.dropped ? (
          <p className="m-0">{data.dropped} stored address could not be read and is not shown.</p>
        ) : null}
      </footer>
    </section>
  );
}

function LocationCard({ l }: { l: CourtLocation }) {
  const map = mapHref(l);
  return (
    <li className="min-w-0 rounded-md border border-border/70 bg-surface px-3 py-2.5">
      <p className="m-0 flex items-start gap-1.5 text-xs font-semibold leading-snug">
        <MapPin className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden />
        <span className="min-w-0">
          {l.city}, {l.state}
          {l.mailing ? (
            <span className="ml-1.5 rounded border border-border px-1 py-px text-[10px] font-normal text-muted-foreground">
              Mailing
            </span>
          ) : null}
        </span>
      </p>
      <address className="mt-1 text-xs not-italic leading-relaxed text-foreground/90">
        {l.name ? <span className="block text-muted-foreground">{l.name}</span> : null}
        <span className="block">{l.address1}</span>
        {l.address2 ? <span className="block">{l.address2}</span> : null}
        <span className="block">
          {l.city}, {l.state} {l.zip}
        </span>
      </address>
      <p className="m-0 mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[11px]">
        {map ? (
          <a
            href={map}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-primary underline-offset-2 hover:underline"
          >
            Map <ExternalLink className="size-3" aria-hidden />
          </a>
        ) : (
          <span className="text-muted-foreground">No map position</span>
        )}
        {l.otherSpellings.length ? (
          <span className="text-muted-foreground" title={l.otherSpellings.join("; ")}>
            Also written{" "}
            {l.otherSpellings.length === 1
              ? l.otherSpellings[0]
              : `${l.otherSpellings.length} other ways`}
          </span>
        ) : null}
      </p>
    </li>
  );
}
