import { useQuery } from "@tanstack/react-query";
import { Download, ExternalLink } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { formatBytes } from "@/lib/matters/documents";
import {
  COLLECTION_LABEL,
  LISTED_BY_LABEL,
  NOT_RECORDED,
  SOURCE_LABEL,
  TEXT_STATUS_NOTE,
  documentPdfUrl,
  documentTitle,
  fmtCount,
  fmtDay,
  typeLabel,
  type DocSummary,
} from "@/lib/documents/documents";
import { documentQuery } from "./documentQueries";
import { TargetLink, TextStatusTag } from "./DocumentParts";
import { FilingCitationContext } from "@/components/litviz/CitationMap";

export type OpenDocument = { doc: DocSummary; page: number | null; pages?: number[] };

const KIND_LABEL: Record<string, string> = {
  case_citation: "case citations",
  usc: "U.S. Code citations",
  cfr: "CFR citations",
  state_code: "state statute citations",
  mdl_number: "MDL numbers",
  docket_number: "docket numbers",
  date: "dates",
  dollar_amount: "dollar amounts",
};

function Details({ doc }: { doc: DocSummary }) {
  const q = useQuery(documentQuery(doc.id));
  if (q.isPending)
    return (
      <p className="text-[12px] text-muted-foreground" role="status">
        Loading the filing's details…
      </p>
    );
  if (q.isError)
    return (
      <p role="alert" className="text-[12px] text-muted-foreground">
        The filing's details could not be read.{" "}
        <button type="button" className="text-primary underline" onClick={() => void q.refetch()}>
          Retry
        </button>
      </p>
    );
  const d = q.data.document;
  if (!q.data.available || !d)
    return (
      <p className="text-[12px] text-muted-foreground">
        No further details are published for this filing.
      </p>
    );
  const cites = d.links.filter((l) => l.relation === "cites");
  const kinds = Object.entries(d.extractions).filter(([, n]) => n > 0);
  return (
    <dl className="grid grid-cols-[8.5rem_minmax(0,1fr)] gap-x-3 gap-y-1 text-[12px]">
      <dt className="text-muted-foreground">Listed</dt>
      <dd>
        {LISTED_BY_LABEL[d.listedBy]} ·{" "}
        <TargetLink link={{ toType: "mdl", toId: d.mdl }}>
          {q.data.mdlName ?? `MDL No. ${d.mdl}`}
        </TargetLink>
      </dd>
      <dt className="text-muted-foreground">Court</dt>
      <dd>
        {d.courtId ? (
          <>
            {q.data.courtName ?? d.courtId}
            {d.courtBasis ? <span className="text-muted-foreground"> · {d.courtBasis}</span> : null}
          </>
        ) : (
          NOT_RECORDED
        )}
      </dd>
      <dt className="text-muted-foreground">Filed</dt>
      <dd>
        {fmtDay(d.filedDate)}
        {d.dateBasis ? <span className="text-muted-foreground"> · {d.dateBasis}</span> : null}
      </dd>
      <dt className="text-muted-foreground">Text</dt>
      <dd>
        {TEXT_STATUS_NOTE[d.textStatus]}
        {d.indexedPages !== null ? ` ${fmtCount(d.indexedPages)} pages indexed.` : ""}
        {d.ocrPendingPages
          ? ` ${fmtCount(d.ocrPendingPages)} pages wait for text recognition.`
          : ""}
      </dd>
      {kinds.length ? (
        <>
          <dt className="text-muted-foreground">Found in the text</dt>
          <dd>{kinds.map(([k, n]) => `${fmtCount(n)} ${KIND_LABEL[k] ?? k}`).join(" · ")}</dd>
        </>
      ) : null}
      {cites.length ? (
        <>
          <dt className="text-muted-foreground">Cites</dt>
          <dd className="flex flex-wrap gap-x-2 gap-y-0.5">
            {cites.slice(0, 24).map((l) => (
              <span key={`${l.toType}:${l.toId}`}>
                <TargetLink link={l} />
                {l.mentions > 1 ? (
                  <span className="text-muted-foreground"> ×{l.mentions}</span>
                ) : null}
              </span>
            ))}
            {cites.length > 24 ? (
              <span className="text-muted-foreground">and {cites.length - 24} more</span>
            ) : null}
          </dd>
          <dt className="text-muted-foreground">Citation context</dt>
          <dd>
            <FilingCitationContext document={d.id} />
          </dd>
        </>
      ) : null}
    </dl>
  );
}

/**
 * Right-hand viewer for one filing, opened at a page. The PDF comes from /api/matter-pdf, which re-checks availability on
 * every request; the page number goes in the URL fragment so the browser's viewer opens there.
 */
export function DocumentPdfSheet({
  open,
  onClose,
}: {
  open: OpenDocument | null;
  onClose: () => void;
}) {
  // A page picked here belongs to the document it was picked in; another document opens at its own page.
  const [picked, setPicked] = useState<{ id: string; page: number } | null>(null);
  const [failed, setFailed] = useState(false);
  const doc = open?.doc ?? null;
  const current =
    (picked && doc && picked.id === doc.id ? picked.page : null) ?? open?.page ?? null;
  const setPage = (p: number) => doc && setPicked({ id: doc.id, page: p });
  const url = doc ? documentPdfUrl(doc, current) : null;
  const pages = open?.pages?.length ? open.pages : open?.page ? [open.page] : [];
  return (
    <Sheet
      open={!!doc}
      onOpenChange={(o) => {
        if (!o) {
          setPicked(null);
          setFailed(false);
          onClose();
        }
      }}
    >
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-3 overflow-y-auto p-4 sm:max-w-[min(58rem,94vw)]"
      >
        <SheetHeader className="space-y-1 pr-6 text-left">
          <SheetTitle className="font-display text-[15px] leading-snug">
            {doc ? documentTitle(doc) : "Filing"}
          </SheetTitle>
          <SheetDescription className="text-[12px]">
            {doc ? (
              <>
                {SOURCE_LABEL[doc.sourceSystem]} · {COLLECTION_LABEL[doc.collection]} ·{" "}
                {typeLabel(doc.docType)}
                {doc.docketNumber ? (
                  <>
                    {" "}
                    · <span className="whitespace-nowrap font-mono">{doc.docketNumber}</span>
                  </>
                ) : null}
                {doc.entryNumber !== null ? ` · entry ${doc.entryNumber}` : ""}
                {doc.pageCount ? ` · ${fmtCount(doc.pageCount)} pages` : ""} ·{" "}
                {formatBytes(doc.bytes)}
              </>
            ) : null}
          </SheetDescription>
        </SheetHeader>
        {doc && url ? (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <Button asChild size="sm" variant="outline" className="h-8">
                <a href={url} target="_blank" rel="noreferrer noopener">
                  <ExternalLink aria-hidden /> Open in a new tab
                </a>
              </Button>
              <Button asChild size="sm" variant="outline" className="h-8">
                <a href={`${documentPdfUrl(doc).replace(/#.*$/, "")}&download=1`}>
                  <Download aria-hidden /> Download
                </a>
              </Button>
              {doc.sourceUrl ? (
                <a
                  href={doc.sourceUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="inline-flex items-center gap-1 text-[12px] text-primary underline-offset-2 hover:underline"
                >
                  Published source <ExternalLink className="size-3" aria-hidden />
                </a>
              ) : null}
              <TextStatusTag status={doc.textStatus} />
            </div>
            {pages.length ? (
              <div
                className="flex flex-wrap items-center gap-1.5 text-[12px]"
                role="group"
                aria-label="Matching pages"
              >
                <span className="text-muted-foreground">Matching pages:</span>
                {pages.map((p) => (
                  <button
                    key={p}
                    type="button"
                    aria-pressed={current === p}
                    onClick={() => setPage(p)}
                    className={
                      current === p
                        ? "rounded border border-primary px-1.5 py-px font-medium text-primary"
                        : "rounded border border-border px-1.5 py-px hover:border-primary focus-visible:outline-2 focus-visible:outline-ring"
                    }
                  >
                    p. {p}
                  </button>
                ))}
              </div>
            ) : null}
            <iframe
              key={url}
              title={`PDF: ${documentTitle(doc)}${current ? `, page ${current}` : ""}`}
              src={url}
              className="min-h-[55vh] flex-1 rounded-md border border-border bg-muted"
              onError={() => setFailed(true)}
            />
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              {failed ? "The viewer could not display this file here. " : ""}
              If the page above is blank or does not jump to the page, use “Open in a new tab”. The
              file is streamed from the private archive after its availability is confirmed again;
              it is not a public link.
            </p>
            <Details doc={doc} />
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
