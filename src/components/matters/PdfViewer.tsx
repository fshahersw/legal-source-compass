import { Download, ExternalLink } from "lucide-react";
import { useState } from "react";

import { HeldBadge } from "@/components/matters/common";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { formatBytes, matterPdfUrl, type MatterDocument } from "@/lib/matters/documents";

/**
 * Right-hand inline viewer for a verified PDF. The bytes come from /api/matter-pdf, which re-checks the registry on
 * every request; a held document has no URL here and is never requested.
 */
export function PdfViewer({ doc, onClose }: { doc: MatterDocument | null; onClose: () => void }) {
  const [failed, setFailed] = useState(false);
  const url = doc ? matterPdfUrl(doc) : null;
  const download = doc ? matterPdfUrl(doc, true) : null;
  return (
    <Sheet
      open={!!doc}
      onOpenChange={(open) => {
        if (!open) {
          setFailed(false);
          onClose();
        }
      }}
    >
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-3 p-4 sm:max-w-[min(58rem,94vw)]"
      >
        <SheetHeader className="space-y-1 pr-6 text-left">
          <SheetTitle className="font-display text-[15px] leading-snug">
            {doc?.label ?? "Document"}
          </SheetTitle>
          <SheetDescription className="text-[12px]">
            {doc ? (
              <>
                {doc.sourceLabel} ·{" "}
                <span className="font-mono">{doc.nativeCaseId ?? "case not recorded"}</span>
                {doc.availability === "open" ? <> · {formatBytes(doc.bytes)}</> : null}
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
              {download ? (
                <Button asChild size="sm" variant="outline" className="h-8">
                  <a href={download}>
                    <Download aria-hidden /> Download
                  </a>
                </Button>
              ) : null}
              {doc.sha256 ? (
                <span
                  className="font-mono text-[11px] text-muted-foreground"
                  title={`SHA-256 ${doc.sha256}`}
                >
                  SHA-256 {doc.sha256.slice(0, 12)}…
                </span>
              ) : null}
            </div>
            <iframe
              key={url}
              title={`PDF: ${doc.label}`}
              src={url}
              className="min-h-0 flex-1 rounded-md border border-border bg-muted"
              onError={() => setFailed(true)}
            />
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              {failed ? "The viewer could not display this file here. " : ""}
              If the page above is blank, use “Open in a new tab” or “Download”. The file is
              streamed from the private archive after the registry confirms it is open; it is not a
              public link.
            </p>
          </>
        ) : doc ? (
          <div className="rounded-md border border-border bg-muted/30 p-4 text-[13px]">
            <HeldBadge />{" "}
            <span className="ml-1">This document is held, so it cannot be opened.</span>
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
