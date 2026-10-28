import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { AGENCY_ID, AGENCY_PHOTO_NOTE, agencyPhotoWhen } from "@/lib/visuals/agencyImages";
import { cn } from "@/lib/utils";
import { PhotoHeaderBand } from "./PhotoHeaderBand";
import { agencyImagesQuery } from "./queries";

/**
 * The building photograph recorded for a federal agency (dataset agency_images), primary first, with its credit and a
 * note that the date and association are the source's and current occupancy is not verified. Renders nothing while
 * loading, on a failed read or when no photograph is recorded, so the page looks as it did without one.
 */
export function AgencyBuildingPhoto({ agencyId, name }: { agencyId: string; name: string }) {
  const valid = AGENCY_ID.test(agencyId);
  const q = useQuery({ ...agencyImagesQuery(agencyId), enabled: valid });
  const [index, setIndex] = useState(0);
  const photos = q.data?.photos ?? null;
  if (!valid || !photos?.length) return null;
  const at = Math.min(index, photos.length - 1);
  const photo = photos[at]!;
  return (
    <PhotoHeaderBand
      key={photo.display.url}
      image={photo}
      alt={
        photo.building
          ? `Photograph of ${photo.building}, recorded by the source for ${name}`
          : `Building photograph recorded by the source for ${name}`
      }
      eyebrow="Agency building"
      heading={
        <>
          <span className="font-semibold">{photo.building ?? name}</span>
          <span className="text-muted-foreground"> · {agencyPhotoWhen(photo)}</span>
        </>
      }
      label={`Building photograph recorded for ${name}`}
      aside={
        photos.length > 1 ? (
          <div role="group" aria-label="Recorded photographs" className="flex gap-1">
            {photos.map((p, i) => (
              <button
                key={p.display.url}
                type="button"
                aria-pressed={i === at}
                aria-label={`Photograph ${i + 1} of ${photos.length}`}
                onClick={() => setIndex(i)}
                className={cn(
                  "min-w-6 rounded border px-1.5 text-[11px] leading-5 focus-visible:outline-2 focus-visible:outline-ring",
                  i === at
                    ? "border-primary font-medium text-primary"
                    : "border-border text-muted-foreground hover:bg-muted",
                )}
              >
                {i + 1}
              </button>
            ))}
          </div>
        ) : undefined
      }
      className="mb-3"
    >
      <p className="m-0 text-[11px] leading-snug text-muted-foreground">{AGENCY_PHOTO_NOTE}</p>
    </PhotoHeaderBand>
  );
}
