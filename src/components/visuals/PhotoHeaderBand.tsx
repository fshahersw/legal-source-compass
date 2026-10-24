import type { ReactNode } from "react";
import { useImageLoaded } from "@/components/courts/hero/useImageLoaded";
import { imageSrcSet, type OpenImage } from "@/lib/visuals/common";
import { cn } from "@/lib/utils";
import { ImageLoadFailed, OpenImageCredit } from "./ImageCredit";

/**
 * A page-header figure: the photograph at a fixed aspect beside its eyebrow, one-line caption, notes and credit.
 * When the photograph does not load, the frame stays and says so, with a link to the image's own page.
 */
export function PhotoHeaderBand({
  image,
  alt,
  eyebrow,
  heading,
  children,
  photoWidth = "sm:grid-cols-[18rem_minmax(0,1fr)]",
  sizes = "(min-width: 640px) 18rem, 100vw",
  label,
  className,
}: {
  image: OpenImage;
  alt: string;
  eyebrow: string;
  /** The one-line caption, e.g. "Building · photographed 2012". */
  heading: ReactNode;
  children?: ReactNode;
  /** Tailwind grid template for the photo column at sm and up. */
  photoWidth?: string;
  sizes?: string;
  label: string;
  className?: string;
}) {
  const img = useImageLoaded(image.display.url);
  return (
    <figure
      aria-label={label}
      className={cn(
        "m-0 grid gap-3 rounded-lg border border-border bg-surface p-3",
        photoWidth,
        className,
      )}
    >
      <div className="relative aspect-[3/2] w-full overflow-hidden rounded-md border border-border/70 bg-muted/40">
        {img.failed ? (
          <div className="absolute inset-0 grid place-items-center p-4 text-center">
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
      <figcaption className="flex min-w-0 flex-col gap-1.5">
        <p className="m-0 text-[10.5px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
          {eyebrow}
        </p>
        <p className="m-0 text-[13px] leading-snug [overflow-wrap:anywhere]">{heading}</p>
        {children}
        <div className="mt-auto pt-1">
          <OpenImageCredit image={image} />
        </div>
      </figcaption>
    </figure>
  );
}
