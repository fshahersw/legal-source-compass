import { Link } from "@tanstack/react-router";
import { memo, useMemo } from "react";
import { courtListenerCaseUrl, segmentOpinion, type OpinionText } from "@/lib/external/caselaw";

/**
 * One opinion's stored text: star-page markers become small page labels (so pin cites can be read) and the citations
 * CourtListener linked become links — to our case page when we hold the cited case, otherwise to CourtListener.
 */
export const OpinionBody = memo(function OpinionBody({ opinion }: { opinion: OpinionText }) {
  const alt = opinion.pagesSource === "xml_harvard_text" && opinion.paginatedText;
  const segments = useMemo(
    () =>
      alt
        ? segmentOpinion(opinion.paginatedText!, opinion.pages, [])
        : segmentOpinion(opinion.text, opinion.pages, opinion.citations),
    [alt, opinion],
  );
  if (!opinion.text.trim())
    return (
      <p className="text-[13px] text-muted-foreground">
        Source holds no text for this opinion.
      </p>
    );
  return (
    <div>
      {alt ? (
        <p className="mb-2 text-[11px] text-muted-foreground">
          Shown in the page-numbered rendering of the scanned reporter (the citation links of the
          other rendering do not line up with its page breaks).
        </p>
      ) : null}
      <div className="max-w-[46rem] whitespace-pre-wrap break-words text-[14px] leading-relaxed text-foreground">
        {segments.map((s, i) => {
          if (s.kind === "text") return <span key={i}>{s.text}</span>;
          if (s.kind === "page")
            return (
              <span
                key={i}
                className="mx-0.5 inline-block select-none rounded border border-border bg-muted px-1 align-[0.15em] font-sans text-[10px] leading-4 text-muted-foreground"
                title={`Start of reporter page ${s.label}${s.index && s.index > 1 ? ` (citation ${s.index})` : ""}`}
                aria-label={`page ${s.label}`}
                data-page={s.label}
              >
                *{s.label}
              </span>
            );
          if (s.clusterId && s.held)
            return (
              <Link
                key={i}
                to="/cases/$id"
                params={{ id: String(s.clusterId) }}
                className="text-primary underline decoration-primary/40 underline-offset-2 hover:decoration-primary"
              >
                {s.text}
              </Link>
            );
          if (s.clusterId)
            return (
              <a
                key={i}
                href={courtListenerCaseUrl(s.clusterId)}
                target="_blank"
                rel="noreferrer"
                title="Not held here: opens the source"
                className="text-foreground underline decoration-dotted decoration-muted-foreground underline-offset-2 hover:text-primary"
              >
                {s.text}
              </a>
            );
          return <span key={i}>{s.text}</span>;
        })}
      </div>
    </div>
  );
});
