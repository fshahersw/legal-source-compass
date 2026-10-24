import type { ReactNode } from "react";
import { useImageLoaded } from "@/components/courts/hero/useImageLoaded";
import { imageSrcSet, type OpenImage } from "@/lib/visuals/common";
import { cn } from "@/lib/utils";
import { ImageLoadFailed, OpenImageCredit } from "./ImageCredit";

/**
 * A compact page-header band: the photograph on the left (about 136 px high on desktop, a 3:2 frame when stacked on a
 * narrow screen) and, to its right, an eyebrow, a one-line caption, optional notes and the credit. When the
 * photograph does not load, the frame stays and says so, with a link to the image's own page.
 */
export function PhotoHeaderBand({
  image,
  alt,
  eyebrow,
  heading,
  aside,
  children,
  frameClassName = "sm:h-[8.5rem] sm:w-52",
  sizes = "(min-width: 640px) 13rem, 100vw",
  label,
  className,
}: {
  image: OpenImage;
  alt: string;
  eyebrow: string;
  /** The one-line caption, e.g. "Building · photographed 2012". */
  heading: ReactNode;
  /** Right of the eyebrow: a switcher or a small action. */
  aside?: ReactNode;
  children?: ReactNode;
  /** Size of the photo frame at sm and up (its height sets the band's height). */
  frameClassName?: string;
  sizes?: string;
  label: string;
  className?: string;
}) {
  const img = useImageLoaded(image.display.url);
  return (
    <figure
      aria-label={label}
      className={cn(
        "m-0 flex flex-col gap-3 rounded-lg border border-border bg-surface p-2.5 sm:flex-row sm:gap-4",
        className,
      )}
    >
      <div
        className={cn(
          "relative aspect-[3/2] w-full shrink-0 overflow-hidden rounded-md border border-border/70 bg-muted/40 sm:aspect-auto",
          frameClassName,
        )}
      >
        {img.failed ? (
          <div className="absolute inset-0 grid place-items-center p-3 text-center">
            <ImageLoadFailed image={image} />
          </div>
        ) : (
          <img
            ref={img.ref}
            src={image.display.url}
            srcSet={imageSrcSet(image)}
            sizes={sizes}
            width={image.display.width}
            height={image.display.height}
            alt={alt}
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
      <figcaption className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex min-h-5 items-center justify-between gap-2">
          <p className="m-0 text-[10.5px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
            {eyebrow}
          </p>
          {aside}
        </div>
        <p className="m-0 text-[13px] leading-snug [overflow-wrap:anywhere]">{heading}</p>
        {children}
        <div className="mt-auto pt-1">
          <OpenImageCredit image={image} />
        </div>
      </figcaption>
    </figure>
  );
}
