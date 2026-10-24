import { useQuery } from "@tanstack/react-query";
import { ExternalLink, MapPin } from "lucide-react";
import { useImageLoaded } from "@/components/courts/hero/useImageLoaded";
import { imageSrcSet } from "@/lib/visuals/common";
import {
  addressLine,
  buildingsCountLine,
  mapLink,
  type CourtBuilding,
} from "@/lib/visuals/courtBuildings";
import { cn } from "@/lib/utils";
import { ImageLoadFailed, OpenImageCredit, creditLinkClass } from "./ImageCredit";
import { courtBuildingsQuery } from "./queries";

const CARD_SIZES =
  "(min-width: 1280px) 15rem, (min-width: 1024px) 19rem, (min-width: 640px) 45vw, 100vw";

/**
 * Courthouses of a court that U.S. Courts or the court's website lists for it, each with a photograph credited as
 * its source records it (dataset court_buildings). Renders nothing until the dataset has a record for the
 * court, so a court without one looks exactly as before.
 */
export function CourtBuildingsPanel({ courtId }: { courtId: string }) {
  const q = useQuery(courtBuildingsQuery(courtId));
  if (q.isPending) return null;
  if (q.isError)
    return (
      <p
        role="alert"
        className="mb-5 flex flex-wrap items-center gap-2 rounded-lg border border-border px-4 py-3 text-xs text-muted-foreground"
      >
        Courthouse photographs could not be loaded.
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
  return (
    <section
      aria-labelledby={`courthouses-${courtId}`}
      className="mb-5 rounded-xl border border-border bg-card shadow-xs"
    >
      <header className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-b border-border/70 px-4 py-3">
        <h2 id={`courthouses-${courtId}`} className="m-0 text-sm font-semibold">
          Courthouses
        </h2>
        <p className="m-0 text-xs text-muted-foreground">{buildingsCountLine(data)}</p>
      </header>
      <ul className="m-0 grid list-none gap-3 p-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {data.buildings.map((b) => (
          <BuildingCard key={b.assetId} b={b} />
        ))}
      </ul>
      <footer className="space-y-1 border-t border-border/70 px-4 py-2 text-[11px] leading-relaxed text-muted-foreground">
        <p className="m-0">
          A building appears here only where a U.S. Courts or court-website listing names it for
          this court, with the relationship that listing records. Each photograph is served from its
          source, with its author, licence and source page as recorded. A photograph shows the
          building, not that the court sits there today.
        </p>
        {data.dropped ? (
          <p className="m-0">
            {data.dropped} recorded building{data.dropped === 1 ? "" : "s"} could not be read and{" "}
            {data.dropped === 1 ? "is" : "are"} not shown.
          </p>
        ) : null}
      </footer>
    </section>
  );
}

function BuildingCard({ b }: { b: CourtBuilding }) {
  const photo = b.photo;
  const img = useImageLoaded(photo.thumb.url);
  const address = addressLine(b);
  const map = mapLink(b);
  return (
    <li className="flex min-w-0 flex-col overflow-hidden rounded-md border border-border/70 bg-surface">
      <div className="relative aspect-[4/3] w-full overflow-hidden border-b border-border/70 bg-muted/40">
        {img.failed ? (
          <div className="absolute inset-0 grid place-items-center p-3 text-center">
            <ImageLoadFailed image={photo} />
          </div>
        ) : (
          <img
            ref={img.ref}
            src={photo.thumb.url}
            srcSet={imageSrcSet(photo)}
            sizes={CARD_SIZES}
            width={photo.thumb.width}
            height={photo.thumb.height}
            alt={`Photograph of ${b.building}${b.city ? `, ${b.city}` : ""}`}
            loading="lazy"
            decoding="async"
            referrerPolicy="no-referrer"
            onLoad={img.onLoad}
            onError={img.onError}
            className={cn(
              "absolute inset-0 size-full object-cover motion-safe:transition-opacity motion-safe:duration-300",
              img.loaded ? "opacity-100" : "opacity-0",
            )}
          />
        )}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-1.5 px-3 py-2.5">
        <p className="m-0 text-xs font-semibold leading-snug [overflow-wrap:anywhere]">
          {b.building}
        </p>
        <p className="m-0 flex items-start gap-1 text-[11.5px] leading-snug text-foreground/90">
          <MapPin className="mt-0.5 size-3 shrink-0 text-muted-foreground" aria-hidden />
          <span className="min-w-0 [overflow-wrap:anywhere]">
            {address ?? "Address not recorded"}
          </span>
        </p>
        <p className="m-0 flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-[11px] leading-snug text-muted-foreground">
          <a href={b.evidenceUrl} target="_blank" rel="noreferrer" className={creditLinkClass}>
            {b.relationshipLabel}
          </a>
          {map ? (
            <a
              href={map}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-0.5 text-primary underline-offset-2 hover:underline"
            >
              Map <ExternalLink className="size-3" aria-hidden />
            </a>
          ) : null}
        </p>
        <div className="mt-auto pt-1">
          <OpenImageCredit image={photo} compact />
        </div>
      </div>
    </li>
  );
}
