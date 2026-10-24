import { useQuery } from "@tanstack/react-query";
import { AgencyMark } from "@/components/corpus/EntityArtwork";
import { AGENCY_ID } from "@/lib/visuals/agencyImages";
import { agencyArtwork } from "@/lib/visuals/registry";
import { useImageFailed } from "./failedImages";
import { MarkCredit } from "./ImageCredit";
import { agencyImagesQuery } from "./queries";

/** The first seal or logo agency_images records for the agency, only when the site has no GSA mark for it. */
function useFallbackMark(agencyId: string, name: string, ready: boolean) {
  const wanted = ready && AGENCY_ID.test(agencyId) && !agencyArtwork(name);
  const q = useQuery({ ...agencyImagesQuery(agencyId), enabled: wanted });
  return wanted ? (q.data?.marks[0] ?? null) : null;
}

/** Page-header emblem: the GSA mark when the site has one, else the recorded seal or logo, else the building icon. */
export function AgencyEmblem({
  agencyId,
  name,
  ready,
}: {
  agencyId: string;
  name: string;
  /** False until the agency's name is known, so a recorded mark never flashes before a GSA mark. */
  ready: boolean;
}) {
  const mark = useFallbackMark(agencyId, name, ready);
  return <AgencyMark name={name} fallback={mark} />;
}

/** Credit for the recorded seal or logo in the header; nothing when the GSA mark (or no mark) is shown. */
export function AgencyMarkCaption({
  agencyId,
  name,
  ready,
  className,
}: {
  agencyId: string;
  name: string;
  ready: boolean;
  className?: string;
}) {
  const mark = useFallbackMark(agencyId, name, ready);
  const failed = useImageFailed(mark?.url);
  if (!mark) return null;
  return (
    <div className={className}>
      {failed ? (
        <p className="m-0 text-[11px] leading-snug text-muted-foreground">
          The agency mark did not load from its source.
        </p>
      ) : null}
      <MarkCredit mark={mark} label="Agency mark" />
    </div>
  );
}
