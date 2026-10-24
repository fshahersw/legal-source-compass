import { hostOf, isWideMark } from "@/lib/visuals/common";
import { cn } from "@/lib/utils";
import { markImageFailed, useImageFailed } from "./failedImages";
import { AboutImage } from "./AboutImage";
import { creditLinkClass, CreditText, LicenceText } from "./ImageCredit";
import { useMark } from "./useCommitteeMark";

/**
 * The committee's mark from its own website (dataset committee_marks), for the page-header emblem slot. Square seals
 * get a square frame, wide wordmarks a plate. Renders nothing while loading, when none is recorded or when the image
 * does not load (its caption then says so).
 */
export function CommitteeMarkEmblem({ code, name }: { code: string; name: string }) {
  const mark = useMark(code);
  const failed = useImageFailed(mark?.url);
  if (!mark || failed) return null;
  const wide = isWideMark(mark);
  return (
    <span
      className={cn(
        "flex shrink-0 items-center justify-center overflow-hidden rounded-md border border-border",
        mark.background === "dark" ? "bg-sidebar" : "bg-surface",
        wide ? "h-11 max-w-44 px-2 py-1.5" : "size-12 p-0.5",
      )}
      title={`Logo from the committee's official website (${hostOf(mark.sourcePage)})`}
    >
      <img
        src={mark.url}
        alt={`${name} logo`}
        width={mark.width}
        height={mark.height}
        loading="lazy"
        decoding="async"
        referrerPolicy="no-referrer"
        onError={() => markImageFailed(mark.url)}
        className={cn("object-contain", wide ? "h-full w-auto max-w-full" : "size-full")}
      />
    </span>
  );
}

/**
 * One short credit line for the committee's mark: the committee's site, plus the author and licence only when the record
 * has them. The registry's branding note and the site's policy page sit in the "About this image" popover.
 */
export function CommitteeMarkCaption({ code, className }: { code: string; className?: string }) {
  const mark = useMark(code);
  const failed = useImageFailed(mark?.url);
  if (!mark) return null;
  const policy = mark.policyUrl ? new URL(mark.policyUrl) : null;
  return (
    <p
      className={cn(
        "m-0 text-[11px] leading-snug text-muted-foreground [overflow-wrap:anywhere]",
        className,
      )}
    >
      {failed ? "The committee logo did not load from its source. " : null}
      Logo from the committee&rsquo;s website:{" "}
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
        notes={mark.brandingNote ? [mark.brandingNote] : []}
        links={
          policy && mark.policyUrl
            ? [
                {
                  label: `Site policy page · ${hostOf(mark.policyUrl)}${policy.pathname === "/" ? "" : policy.pathname}`,
                  href: mark.policyUrl,
                },
              ]
            : []
        }
      />
    </p>
  );
}
