import { useQuery } from "@tanstack/react-query";
import { AgencyMark } from "@/components/corpus/EntityArtwork";
import { AGENCY_ID, agencyMarkLabel, primaryAgencyMark } from "@/lib/visuals/agencyImages";
import { hostOf, mimeLabel } from "@/lib/visuals/common";
import { cn } from "@/lib/utils";
import { AboutImage } from "./AboutImage";
import { useImageFailed } from "./failedImages";
import { creditLinkClass, CreditText, LicenceText } from "./ImageCredit";
import { agencyImagesQuery } from "./queries";

/**
 * The agency's recorded seal (else its logo) from agency_images, whatever the registry's rights label says (owner
 * decision 2026-10-24, night), and whether it is still being read.
 */
function useRegistryMark(agencyId: string) {
  const valid = AGENCY_ID.test(agencyId);
  const q = useQuery({ ...agencyImagesQuery(agencyId), enabled: valid });
  return {
    mark: valid ? primaryAgencyMark(q.data?.marks ?? []) : null,
    pending: valid && q.isPending,
  };
}

/**
 * Page-header emblem: the agency's recorded seal, else its logo, else the GSA mark when the site has one, else the
 * building icon. `ready` is false until the agency's name is known, so the GSA lookup waits for it.
 */
export function AgencyEmblem({
  agencyId,
  name,
  ready = true,
}: {
  agencyId: string;
  name: string;
  ready?: boolean;
}) {
  const { mark, pending } = useRegistryMark(agencyId);
  return <AgencyMark name={name} registry={mark} holdGsa={!ready || pending} />;
}

/**
 * One short credit line under the header for the recorded seal or logo: its source site, plus author and licence only
 * when the record has them, and an "About this image" button with the file facts and the source page. Nothing when the
 * agency has no recorded mark.
 */
export function AgencyMarkCaption({
  agencyId,
  className,
}: {
  agencyId: string;
  className?: string;
}) {
  const { mark } = useRegistryMark(agencyId);
  const failed = useImageFailed(mark?.url);
  if (!mark) return null;
  const label = agencyMarkLabel(mark);
  const page = new URL(mark.sourcePage);
  return (
    <p
      className={cn(
        "m-0 text-[11px] leading-snug text-muted-foreground [overflow-wrap:anywhere]",
        className,
      )}
    >
      {failed ? `The ${label.toLowerCase()} did not load from its source. ` : null}
      {label} ·{" "}
      <a href={mark.sourcePage} target="_blank" rel="noreferrer" className={creditLinkClass}>
        {hostOf(mark.sourcePage)}
      </a>
      {mark.author ? (
        <>
          {" "}
          · <CreditText value={mark.author} />
        </>
      ) : null}
      {mark.license ? (
        <>
          {" "}
          · <LicenceText license={mark.license} url={mark.licenseUrl} />
        </>
      ) : null}{" "}
      <AboutImage
        notes={[`Image file: ${mimeLabel(mark.mime)}, ${mark.width} × ${mark.height} px.`]}
        links={[
          {
            label: `Source page · ${hostOf(mark.sourcePage)}${page.pathname === "/" ? "" : page.pathname}`,
            href: mark.sourcePage,
          },
        ]}
      />
    </p>
  );
}
