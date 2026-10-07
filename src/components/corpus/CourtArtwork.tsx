import {
  Archive,
  Building2,
  CircleHelp,
  Columns3,
  Gavel,
  Landmark,
  LibraryBig,
  MapPinHouse,
  Scale,
  University,
} from "lucide-react";
import { useState } from "react";
import { fileUrl } from "@/lib/external/groups";
import {
  artworkForCourtId,
  classifyCourtType,
  courtTypeLabels,
  recordedCourtArtwork,
  type CourtTypeGroup,
} from "@/lib/courts/artwork";
import { cn } from "@/lib/utils";

const typeIcons = {
  "us-supreme": Landmark,
  "federal-appellate": Columns3,
  "federal-district": University,
  "federal-bankruptcy": Scale,
  "state-high": Landmark,
  "state-appellate": LibraryBig,
  "state-trial": Gavel,
  county: MapPinHouse,
  "local-specialty": Building2,
  historical: Archive,
  unclassified: CircleHelp,
} satisfies Record<CourtTypeGroup, typeof Landmark>;

export function CourtArtwork({
  courtId,
  title,
  system,
  type,
  recordedLinks = [],
  compact = false,
}: {
  courtId: string;
  title: string;
  system?: string | null;
  type?: string | null;
  recordedLinks?: readonly { url: string; label: string }[];
  compact?: boolean;
}) {
  const verified = artworkForCourtId(courtId);
  const recorded = verified ? null : recordedCourtArtwork(recordedLinks);
  const [failed, setFailed] = useState(false);
  const source = !failed ? verified?.assetPath ?? recorded?.url ?? null : null;
  const officialLabel = verified ? "Verified official court artwork" : recorded ? "Recorded court image" : null;
  const group = classifyCourtType(system, type);
  const Icon = typeIcons[group];

  if (compact) {
    if (source) {
      const image = (
        <img
          src={source.startsWith("/") ? fileUrl(source) : source}
          alt={`${title} ${verified?.kind === "banner" ? "official court mark" : "court artwork"}`}
          className={cn(
            "size-9 shrink-0 border border-border bg-surface object-contain",
            verified?.kind === "banner" ? "rounded-md object-left" : "rounded-full p-1",
          )}
          loading="lazy"
          onError={() => setFailed(true)}
        />
      );
      return verified ? (
        <a
          href={verified.sourcePage}
          target="_blank"
          rel="noreferrer"
          title={`${officialLabel} · source: ${verified.sourcePage}`}
          aria-label={`Open the official source for ${title} artwork`}
        >
          {image}
        </a>
      ) : image;
    }
    return (
      <span
        className="grid size-9 shrink-0 place-items-center rounded-md border border-border bg-muted text-muted-foreground"
        title={`Court type · ${courtTypeLabels[group]}`}
        aria-label={`Court type: ${courtTypeLabels[group]}`}
      >
        <Icon aria-hidden="true" className="size-4" />
      </span>
    );
  }

  return (
    <figure className="w-32 shrink-0 text-center sm:w-36">
      <div className="grid h-32 w-full place-items-center overflow-hidden rounded-md border border-border bg-muted/40 p-3">
        {source ? (
          <img
            src={source.startsWith("/") ? fileUrl(source) : source}
            alt={`${title} ${verified?.kind === "banner" ? "official court mark" : "court artwork"}`}
            className="max-h-full max-w-full object-contain"
            loading="lazy"
            onError={() => setFailed(true)}
          />
        ) : (
          <Icon aria-hidden="true" className="size-14 text-muted-foreground" strokeWidth={1.35} />
        )}
      </div>
      <figcaption className="mt-1.5 text-[10px] leading-snug text-muted-foreground">
        {source ? officialLabel : "Court type"}
        <span className="block font-medium text-foreground">
          {source ? (verified?.description ?? recorded?.label) : courtTypeLabels[group]}
        </span>
        {verified ? (
          <a
            href={verified.sourcePage}
            target="_blank"
            rel="noreferrer"
            className="underline decoration-dotted underline-offset-2"
          >
            Official source · retrieved {verified.retrievedAt}
          </a>
        ) : null}
      </figcaption>
    </figure>
  );
}