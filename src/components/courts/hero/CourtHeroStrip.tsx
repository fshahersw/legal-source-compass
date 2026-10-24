import { useQuery } from "@tanstack/react-query";
import { ImageOff } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { entityQuery } from "@/components/corpus/EntityPage";
import { photoAlt, photoPlace } from "@/lib/courts/photos";
import { cn } from "@/lib/utils";
import { recordedSystemAndType, resolveCourtMark } from "./courtMark";
import { MarkMedallion, PhotoCredit } from "./parts";
import { useImageLoaded } from "./useImageLoaded";
import { courtPhotoQuery } from "./queries";

/**
 * Compact court header for pages about one court that are not its profile (e.g. its case law): the seal, the
 * building thumbnail with its credit, and a link to the court page. The same three items are drawn in every state
 * (loading, photograph, none, failed), so the layout never shifts; without a photograph the frame shows a quiet
 * "no photograph" emblem and the seal stays beside it.
 */
export function CourtHeroStrip({ courtId, title }: { courtId: string; title: string }) {
  const entity = useQuery(entityQuery("court_spine", courtId));
  const { system, type } = recordedSystemAndType(entity.data?.raw);
  // Until the court record is read, only the system-independent exact-id artwork is offered.
  const mark = resolveCourtMark(courtId, entity.data ? system : null, entity.data ? type : null);
  const q = useQuery(courtPhotoQuery(courtId));
  const photo = q.data ?? null;
  const img = useImageLoaded(photo?.thumb.url ?? null);
  const place = photo ? photoPlace(photo) : null;
  const showPhoto = !!photo && !img.failed;
  return (
    <section
      aria-label="Court building and seal"
      className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-border bg-surface p-2.5"
    >
      <div className="relative aspect-[3/2] w-24 shrink-0 overflow-hidden rounded border border-border bg-muted/40">
        {q.isPending ? (
          <span aria-hidden="true" className="absolute inset-0 animate-pulse bg-muted/70" />
        ) : !showPhoto || !img.loaded ? (
          <span aria-hidden="true" className="absolute inset-0 grid place-items-center">
            <ImageOff className="size-5 text-muted-foreground/70" strokeWidth={1.35} />
          </span>
        ) : null}
        {showPhoto ? (
          <img
            ref={img.ref}
            src={photo.thumb.url}
            width={photo.thumb.width}
            height={photo.thumb.height}
            alt={photoAlt(photo, title)}
            loading="lazy"
            decoding="async"
            referrerPolicy="no-referrer"
            onLoad={img.onLoad}
            onError={img.onError}
            className={cn(
              "absolute inset-0 size-full bg-muted object-cover motion-safe:transition-opacity motion-safe:duration-300",
              img.loaded ? "opacity-100" : "opacity-0",
            )}
          />
        ) : null}
      </div>
      <MarkMedallion mark={mark} title={title} size="sm" />
      {/* Reserves the photo state's height (building line + two credit lines) so nothing shifts when it arrives. */}
      <div className="flex min-h-16 min-w-0 flex-1 basis-56 flex-col justify-center">
        {showPhoto ? (
          <>
            <p className="m-0 truncate text-[12px] font-medium" title={photo.building ?? undefined}>
              {photo.building ?? "Court building"}
              {place ? <span className="font-normal text-muted-foreground"> · {place}</span> : null}
            </p>
            <PhotoCredit photo={photo} className="mt-0.5" />
          </>
        ) : (
          <p className="m-0 text-[11px] text-muted-foreground">
            {q.isPending
              ? "Looking up the court building photograph…"
              : q.isError
                ? "The building photograph could not be looked up."
                : "No building photograph is recorded for this court."}
          </p>
        )}
      </div>
      <Link
        to="/courts/$id"
        params={{ id: courtId }}
        className="shrink-0 rounded-md border border-border px-2.5 py-1 text-[12px] font-medium hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
      >
        Court page
      </Link>
    </section>
  );
}
