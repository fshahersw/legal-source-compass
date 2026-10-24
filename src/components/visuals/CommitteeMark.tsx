import { useQuery } from "@tanstack/react-query";
import { COMMITTEE_CODE } from "@/lib/external/congressMembers";
import { hostOf, isWideMark } from "@/lib/visuals/common";
import { cn } from "@/lib/utils";
import { markImageFailed, useImageFailed } from "./failedImages";
import { creditLinkClass, LicenceText } from "./ImageCredit";
import { committeeMarkQuery } from "./queries";

function useMark(code: string) {
  const valid = COMMITTEE_CODE.test(code);
  const q = useQuery({ ...committeeMarkQuery(code), enabled: valid });
  return valid ? (q.data ?? null) : null;
}

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
 * Where the mark comes from (the committee's site), its recorded author and licence when the record has them, the
 * branding note and, where recorded, the site's policy statement with its page.
 */
export function CommitteeMarkCaption({ code, className }: { code: string; className?: string }) {
  const mark = useMark(code);
  const failed = useImageFailed(mark?.url);
  if (!mark) return null;
  return (
    <div className={cn("space-y-0.5 text-[11px] leading-snug text-muted-foreground", className)}>
      <p className="m-0 [overflow-wrap:anywhere]">
        {failed ? "The committee logo did not load from its source. " : null}
        Logo from the committee&rsquo;s official website ·{" "}
        <a href={mark.sourcePage} target="_blank" rel="noreferrer" className={creditLinkClass}>
          {hostOf(mark.sourcePage)}
        </a>
        {mark.license ? (
          <>
            {" "}
            · {mark.author ?? "Author not recorded"} ·{" "}
            <LicenceText license={mark.license} url={mark.licenseUrl} />
          </>
        ) : null}
        {mark.brandingNote ? <> · {mark.brandingNote}</> : null}
      </p>
      {mark.policyUrl && mark.policyQuote ? (
        <details className="group">
          <summary className="cursor-pointer list-none rounded-sm focus-visible:outline-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden">
            <span className="underline decoration-dotted underline-offset-2 hover:text-foreground">
              Use statement on the committee&rsquo;s site
            </span>
          </summary>
          <p className="m-0 mt-1 max-w-3xl">
            &ldquo;{mark.policyQuote}&rdquo;{" "}
            <a href={mark.policyUrl} target="_blank" rel="noreferrer" className={creditLinkClass}>
              {hostOf(mark.policyUrl)}
              {new URL(mark.policyUrl).pathname}
            </a>
          </p>
        </details>
      ) : null}
    </div>
  );
}
