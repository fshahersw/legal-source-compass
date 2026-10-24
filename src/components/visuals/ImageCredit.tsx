import { Fragment } from "react";
import {
  creditSegments,
  hostOf,
  plainCredit,
  sourceLabel,
  type ImageCredit,
  type MarkImage,
} from "@/lib/visuals/common";
import { cn } from "@/lib/utils";

export const creditLinkClass =
  "underline decoration-dotted underline-offset-2 hover:text-foreground focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-ring";

/** A recorded author or credit string with every URL in it shown as a short link labelled with its host. */
export function CreditText({ value }: { value: string }) {
  return (
    <>
      {creditSegments(value).map((seg, i) =>
        seg.kind === "text" ? (
          <Fragment key={i}>{seg.text}</Fragment>
        ) : (
          <a key={i} href={seg.href} target="_blank" rel="noreferrer" className={creditLinkClass}>
            {seg.host}
          </a>
        ),
      )}
    </>
  );
}

/**
 * Visible credit for an image, as recorded: who made it (the Library of Congress credit line where the archive gives
 * one, else the author, else the recorded credit), then the licence (linked when the record has a licence link) and
 * the image's own page. Any URL inside the author or credit is a short link labelled with its host. When the record
 * names no licence the second line is "Source: <site>", and nothing is said about an author nobody recorded.
 */
export function OpenImageCredit({
  image,
  label = "Photo",
  compact = false,
  className,
}: {
  image: Pick<ImageCredit, "author" | "credit" | "origin" | "license" | "licenseUrl" | "filePage">;
  label?: string;
  compact?: boolean;
  className?: string;
}) {
  const size = compact ? "text-[10.5px]" : "text-[11px]";
  const source = (
    <a href={image.filePage} target="_blank" rel="noreferrer" className={creditLinkClass}>
      {sourceLabel(image)}
    </a>
  );
  // The archive's own credit line stands alone; any other recorded author or credit follows "Photo:".
  const archive = image.origin === "loc" && image.credit ? image.credit : null;
  const recorded = archive ?? image.author ?? image.credit;
  const who = recorded ?? (image.license ? "Author not recorded" : null);
  const prefix = archive ? "" : `${label}: `;
  return (
    <div className={cn("space-y-0.5 leading-snug text-muted-foreground", size, className)}>
      {who ? (
        <p className="m-0 line-clamp-2 [overflow-wrap:anywhere]" title={plainCredit(prefix + who)}>
          {prefix}
          <CreditText value={who} />
        </p>
      ) : null}
      <p className="m-0 [overflow-wrap:anywhere]">
        {image.license ? (
          <>
            <LicenceText license={image.license} url={image.licenseUrl} /> · {source}
          </>
        ) : (
          <>Source: {source}</>
        )}
      </p>
    </div>
  );
}

/** The licence name, linked to its deed or statement when the record has one. */
export function LicenceText({ license, url }: { license: string; url: string | null }) {
  return url ? (
    <a href={url} target="_blank" rel="noreferrer" className={creditLinkClass}>
      {license}
    </a>
  ) : (
    <>{license}</>
  );
}

/** Shown in place of an image that did not load: the credit stays reachable through the file page. */
export function ImageLoadFailed({
  image,
  noun = "photograph",
  className,
}: {
  image: Pick<ImageCredit, "filePage" | "origin">;
  noun?: string;
  className?: string;
}) {
  return (
    <p className={cn("m-0 text-[11px] leading-snug text-muted-foreground", className)}>
      The {noun} did not load from its source.{" "}
      <a href={image.filePage} target="_blank" rel="noreferrer" className={creditLinkClass}>
        Open it on {sourceLabel(image)}
      </a>
      .
    </p>
  );
}

/** Credit for a seal, logo or wordmark taken from a site: author and licence when recorded, and its source page. */
export function MarkCredit({
  mark,
  label,
  className,
}: {
  mark: Pick<MarkImage, "license" | "licenseUrl" | "author" | "sourcePage">;
  label: string;
  className?: string;
}) {
  const source = (
    <a href={mark.sourcePage} target="_blank" rel="noreferrer" className={creditLinkClass}>
      {hostOf(mark.sourcePage)}
    </a>
  );
  return (
    <p
      className={cn(
        "m-0 text-[11px] leading-snug text-muted-foreground [overflow-wrap:anywhere]",
        className,
      )}
    >
      {label}:{" "}
      {mark.author ? (
        <>
          <CreditText value={mark.author} /> ·{" "}
        </>
      ) : null}
      {mark.license ? (
        <>
          <LicenceText license={mark.license} url={mark.licenseUrl} /> · {source}
        </>
      ) : (
        <>Source: {source}</>
      )}
    </p>
  );
}
