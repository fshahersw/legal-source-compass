import { courtTypeLabels } from "@/lib/courts/artwork";
import { photoAuthor, photoSource, type CourtPhotoThumb } from "@/lib/courts/photos";
import { cn } from "@/lib/utils";
import type { CourtMark } from "./courtMark";
import { courtTypeIcons } from "./typeIcons";
import { useImageLoaded } from "./useImageLoaded";

const linkClass =
  "underline decoration-dotted underline-offset-2 hover:text-foreground focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-ring";

function markAlt(mark: CourtMark, title: string) {
  if (mark.kind === "verified")
    return `${title} ${mark.shape === "banner" ? "official court mark" : "court artwork"}`;
  if (mark.kind === "community") return `${title} court mark`;
  if (mark.kind === "recorded") return `${title} recorded court image`;
  return `Court type: ${mark.description}`;
}

/** The seal, mark or court-type emblem itself; an image that fails to load falls back to the labelled emblem. */
export function MarkImage({
  mark,
  title,
  className,
  iconClassName,
}: {
  mark: CourtMark;
  title: string;
  className?: string;
  iconClassName?: string;
}) {
  const src = mark.kind === "type" ? null : mark.src;
  const img = useImageLoaded(src);
  if (src && !img.failed)
    return (
      <img
        ref={img.ref}
        src={src}
        alt={markAlt(mark, title)}
        loading="lazy"
        decoding="async"
        onError={img.onError}
        className={cn("object-contain", className)}
      />
    );
  const Icon = courtTypeIcons[mark.group];
  return (
    <Icon
      role="img"
      aria-label={`Court type: ${courtTypeLabels[mark.group]}`}
      className={cn("text-muted-foreground", iconClassName)}
      strokeWidth={1.35}
    />
  );
}

/** Seal or mark set into the corner of a photograph: round for seals, a plate for wide homepage marks. */
export function MarkMedallion({
  mark,
  title,
  size = "md",
  className,
}: {
  mark: CourtMark;
  title: string;
  size?: "sm" | "md";
  className?: string;
}) {
  const banner = mark.kind === "verified" && mark.shape === "banner";
  const body = (
    <span
      className={cn(
        "flex items-center justify-center border border-border bg-surface ring-2 ring-surface",
        banner
          ? cn("rounded-md px-2", size === "md" ? "h-10 max-w-56" : "h-8 max-w-40")
          : cn("rounded-full", size === "md" ? "size-14 p-1.5" : "size-10 p-1"),
      )}
    >
      <MarkImage
        mark={mark}
        title={title}
        className={banner ? "max-h-[80%] w-auto max-w-full" : "size-full"}
        iconClassName={size === "md" ? "size-6" : "size-5"}
      />
    </span>
  );
  if (mark.kind === "verified" || mark.kind === "community")
    return (
      <a
        href={mark.sourcePage}
        target="_blank"
        rel="noreferrer"
        title={`${mark.label} · source: ${mark.sourcePage}`}
        aria-label={`Open the source of the ${title} mark`}
        className={cn(
          "inline-flex focus-visible:rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
          className,
        )}
      >
        {body}
      </a>
    );
  return <span className={cn("inline-flex", className)}>{body}</span>;
}

/** The deliberate no-photograph state: the court's own mark centred on a ruled plate, with its court type. */
export function SealPlate({
  mark,
  title,
  compact = false,
}: {
  mark: CourtMark;
  title: string;
  compact?: boolean;
}) {
  return (
    <div className="absolute inset-0 grid place-items-center">
      <span
        aria-hidden="true"
        className={cn(
          "pointer-events-none absolute rounded-[3px] border border-border/80",
          compact ? "inset-1" : "inset-2.5",
        )}
      />
      <div
        className={cn(
          "flex w-full flex-col items-center px-4 text-center",
          compact ? "gap-0" : "gap-2.5",
        )}
      >
        <MarkImage
          mark={mark}
          title={title}
          className={compact ? "max-h-10 max-w-[70%]" : "max-h-24 max-w-[62%]"}
          iconClassName={compact ? "size-6" : "size-14"}
        />
        {compact ? null : (
          <p className="m-0 text-[10.5px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
            {courtTypeLabels[mark.group]}
          </p>
        )}
      </div>
    </div>
  );
}

/** What the mark is and where it comes from. A court-type emblem says it is not a seal. */
export function MarkCaption({ mark, className }: { mark: CourtMark; className?: string }) {
  return (
    <p className={cn("m-0 text-[11px] leading-snug text-muted-foreground", className)}>
      {mark.kind === "verified" ? (
        <>
          {mark.label} ·{" "}
          <a href={mark.sourcePage} target="_blank" rel="noreferrer" className={linkClass}>
            official source, retrieved {mark.retrievedAt}
          </a>
        </>
      ) : mark.kind === "community" ? (
        <>
          {mark.label} ·{" "}
          <a href={mark.sourcePage} target="_blank" rel="noreferrer" className={linkClass}>
            provenance · {mark.license}
          </a>
        </>
      ) : mark.kind === "recorded" ? (
        <>
          {mark.label} · {mark.description}
        </>
      ) : (
        <>Court type emblem ({mark.description}); not an official seal.</>
      )}
    </p>
  );
}

/**
 * Visible credit for a photograph: author, licence (linked when a licence link is recorded) and source page (linked).
 * When the record names no licence, only "Source: <site>" is shown.
 */
export function PhotoCredit({
  photo,
  compact = false,
  className,
}: {
  photo: Pick<CourtPhotoThumb, "author" | "license" | "licenseUrl" | "sourcePage" | "origin">;
  compact?: boolean;
  className?: string;
}) {
  const author = photoAuthor(photo);
  const source = (
    <a href={photo.sourcePage} target="_blank" rel="noreferrer" className={linkClass}>
      {photoSource(photo)}
    </a>
  );
  if (!photo.license)
    return (
      <p
        className={cn(
          "m-0 leading-snug text-muted-foreground",
          compact ? "text-[10.5px]" : "text-[11px]",
          className,
        )}
      >
        Source: {source}
      </p>
    );
  const links = (
    <>
      {photo.licenseUrl ? (
        <a href={photo.licenseUrl} target="_blank" rel="noreferrer" className={linkClass}>
          {photo.license}
        </a>
      ) : (
        photo.license
      )}{" "}
      · {source}
    </>
  );
  if (compact)
    return (
      <p
        className={cn(
          "m-0 flex min-w-0 items-baseline gap-1 text-[10.5px] leading-snug text-muted-foreground",
          className,
        )}
      >
        <span className="shrink-0">Photo:</span>
        <span className="min-w-0 shrink truncate" title={author}>
          {author}
        </span>
        <span className="min-w-0 max-w-[60%] shrink-0 truncate" title={photo.license}>
          · {links}
        </span>
      </p>
    );
  return (
    <div className={cn("space-y-0.5 text-[11px] leading-snug text-muted-foreground", className)}>
      <p className="m-0 line-clamp-2 [overflow-wrap:anywhere]" title={author}>
        Photo: {author}
      </p>
      <p className="m-0">{links}</p>
    </div>
  );
}
