import { photoAlt, type CourtPhotoThumb } from "@/lib/courts/photos";
import { cn } from "@/lib/utils";
import { useImageLoaded } from "./useImageLoaded";

/**
 * A court list row's building thumbnail at a fixed 3:2 size (no layout shift). Renders nothing when the image fails;
 * the row's credit line (PhotoCredit compact) sits beside the court name.
 */
export function CourtPhotoThumbnail({
  photo,
  title,
  className,
}: {
  photo: CourtPhotoThumb;
  title: string;
  className?: string;
}) {
  const img = useImageLoaded(photo.thumb.url);
  if (img.failed) return null;
  return (
    <span
      className={cn(
        "relative block aspect-[3/2] h-9 shrink-0 overflow-hidden rounded-md border border-border bg-muted/40",
        className,
      )}
    >
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
          "size-full object-cover motion-safe:transition-opacity motion-safe:duration-300",
          img.loaded ? "opacity-100" : "opacity-0",
        )}
      />
    </span>
  );
}
