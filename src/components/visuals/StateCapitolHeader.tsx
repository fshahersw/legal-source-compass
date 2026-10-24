import { useQuery } from "@tanstack/react-query";
import { capitolCaption, USPS } from "@/lib/visuals/stateCapitols";
import { PhotoHeaderBand } from "./PhotoHeaderBand";
import { stateCapitolQuery } from "./queries";

/**
 * The state capitol photograph for a state page (dataset state_capitol_images), with its credit. Renders nothing while
 * loading, on a failed read or when none is recorded, so the page looks as it did without one.
 */
export function StateCapitolHeader({ usps, stateName }: { usps: string; stateName: string }) {
  const valid = USPS.test(usps);
  const q = useQuery({ ...stateCapitolQuery(usps), enabled: valid });
  const photo = q.data ?? null;
  if (!valid || !photo) return null;
  const caption = capitolCaption(photo, stateName);
  return (
    <PhotoHeaderBand
      key={photo.display.url}
      image={photo}
      alt={`Photograph of the ${photo.building}`}
      eyebrow="State capitol"
      heading={
        <>
          <span className="font-semibold">{photo.building}</span>
          <span className="text-muted-foreground">{caption.slice(photo.building.length)}</span>
        </>
      }
      label={`${stateName} capitol photograph`}
      photoWidth="sm:grid-cols-[20rem_minmax(0,1fr)]"
      sizes="(min-width: 640px) 20rem, 100vw"
      className="mb-3"
    >
      <p className="m-0 text-[11px] leading-snug text-muted-foreground">
        The photograph shows the building; it is not a statement of where a body meets today.
      </p>
    </PhotoHeaderBand>
  );
}
