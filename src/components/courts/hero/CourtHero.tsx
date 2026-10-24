import { useQuery } from "@tanstack/react-query";
import { photoAlt, photoPlace, photoSource, photoSrcSet } from "@/lib/courts/photos";
import { useImageFailed } from "@/components/visuals/failedImages";
import { cn } from "@/lib/utils";
import { resolveCourtMark } from "./courtMark";
import { MarkCaption, MarkMedallion, PhotoCredit, SealPlate } from "./parts";
import { useImageLoaded } from "./useImageLoaded";
import { courtPhotoQuery } from "./queries";

const HERO_SIZES = "(min-width: 1024px) 23rem, (min-width: 640px) 19rem, 100vw";

/**
 * Court page header artwork: the court's building photograph (credited as its source records it) with the court's
 * seal set into its corner, and a visible credit. Without a photograph, or when it fails to load, the same frame
 * shows the seal on a ruled plate, so the layout never shifts.
 */
export function CourtHero({
  courtId,
  title,
  system,
  type,
  recordedLinks = [],
}: {
  courtId: string;
  title: string;
  system?: string | null | undefined;
  type?: string | null | undefined;
  recordedLinks?: readonly { url: string; label: string }[];
}) {
  const resolved = resolveCourtMark(courtId, system, type, recordedLinks);
  // A stored court image that cannot be served is not captioned as if it were drawn: the court-type emblem takes over.
  const recordedFailed = useImageFailed(resolved.kind === "recorded" ? resolved.src : null);
  const mark = recordedFailed ? resolveCourtMark(courtId, system, type) : resolved;
  const q = useQuery(courtPhotoQuery(courtId));
  const photo = q.data ?? null;
  const img = useImageLoaded(photo?.display.url ?? null);
  const status = q.isPending
    ? "loading"
    : q.isError
      ? "error"
      : !photo
        ? "none"
        : img.failed
          ? "failed"
          : "photo";
  const place = photo ? photoPlace(photo) : null;
  return (
    <figure
      className="m-0 w-full shrink-0 sm:w-[19rem] lg:w-[23rem]"
      aria-busy={status === "loading"}
    >
      <div className="relative aspect-[3/2] w-full overflow-hidden rounded-md border border-border bg-muted/40">
        <SealPlate mark={mark} title={title} />
        {photo && status === "photo" ? (
          <img
            ref={img.ref}
            src={photo.display.url}
            srcSet={photoSrcSet(photo)}
            sizes={HERO_SIZES}
            width={photo.display.width}
            height={photo.display.height}
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
        {status === "photo" && img.loaded ? (
          <MarkMedallion mark={mark} title={title} className="absolute bottom-2.5 left-2.5" />
        ) : null}
      </div>
      <figcaption className="mt-2 space-y-1.5">
        {status === "photo" && photo ? (
          <>
            {photo.building || place ? (
              <p className="m-0 text-[12px] leading-snug">
                {photo.building ? <span className="font-medium">{photo.building}</span> : null}
                {photo.building && place ? (
                  <span className="text-muted-foreground"> · </span>
                ) : null}
                {place ? <span className="text-muted-foreground">{place}</span> : null}
              </p>
            ) : null}
            <PhotoCredit photo={photo} />
          </>
        ) : status === "none" ? (
          <p className="m-0 text-[11px] leading-snug text-muted-foreground">
            No building photograph is recorded for this court.
          </p>
        ) : status === "failed" && photo ? (
          <p className="m-0 text-[11px] leading-snug text-muted-foreground">
            The building photograph did not load from its source.{" "}
            <a
              href={photo.sourcePage}
              target="_blank"
              rel="noreferrer"
              className="underline decoration-dotted underline-offset-2 hover:text-foreground"
            >
              Open it on {photoSource(photo)}
            </a>
            .
          </p>
        ) : status === "error" ? (
          <p role="alert" className="m-0 text-[11px] leading-snug text-muted-foreground">
            The building photograph could not be looked up.{" "}
            <button
              type="button"
              onClick={() => void q.refetch()}
              className="rounded text-primary underline focus-visible:outline-2 focus-visible:outline-ring"
            >
              Retry
            </button>
          </p>
        ) : (
          <span
            aria-hidden="true"
            className="block h-3.5 w-2/3 animate-pulse rounded bg-muted/70"
          />
        )}
        <MarkCaption mark={mark} />
      </figcaption>
    </figure>
  );
}
