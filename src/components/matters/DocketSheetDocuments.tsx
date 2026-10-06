import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";

import { RangePager } from "@/components/matters/common";
import { AVAILABILITY_LABELS } from "@/lib/matters/docketDocuments";
import { formatBytes } from "@/lib/matters/documents";
import { getMatterDocketDocuments } from "@/lib/matters/matters.functions";

/**
 * Docket-sheet documents of a matter listed by the entry number they carry. `all` lists every document of the matter's
 * cases (used when the matter has no registry entries); `unlisted` lists only the cases that have no registry entries,
 * whose documents cannot appear under an entry.
 */
export function DocketSheetOnly({
  mdl,
  scope = "all",
  title = "Docket-sheet documents",
  intro,
}: {
  mdl: string;
  scope?: "all" | "unlisted";
  title?: string;
  intro?: string;
}) {
  const fn = useServerFn(getMatterDocketDocuments);
  const [offset, setOffset] = useState(0);
  const q = useQuery({
    queryKey: ["matter-docket-documents", mdl, scope, offset],
    queryFn: () => fn({ data: { id: mdl, offset, scope } }),
    placeholderData: keepPreviousData,
    staleTime: 5 * 60_000,
  });
  const data = q.data;
  if (!data || !data.total) return null;
  return (
    <div className="mt-3 space-y-2">
      <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {title} · {data.total.toLocaleString()}
      </h3>
      <p className="text-[12px] text-muted-foreground">
        {intro ??
          "Documents of the cases tracked in DocketBird, as the provider's docket sheet shows them, by entry number."}{" "}
        Documents withheld under the sealed/restricted rule are counted and never listed.
      </p>
      <ul className="divide-y divide-border rounded-lg border border-border">
        {data.documents.map((d) => (
          <li
            key={d.nativeDocumentId}
            className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 p-2 text-[12px]"
          >
            <span className="w-14 font-mono">
              {d.entryNumber !== null ? `#${d.entryNumber}` : "—"}
            </span>
            <span className="font-mono text-muted-foreground">
              {d.dateFiled ?? "Date not recorded"}
            </span>
            <span className="min-w-0 flex-1 break-words">
              {d.description ??
                (d.descriptionWithheld ? "Description withheld" : "Description not recorded")}
            </span>
            <span className="text-muted-foreground">{AVAILABILITY_LABELS[d.availability]}</span>
            {d.bytes !== null ? (
              <span className="text-muted-foreground">{formatBytes(d.bytes)}</span>
            ) : null}
            {d.pdfUrl ? (
              <a
                href={d.pdfUrl}
                target="_blank"
                rel="noreferrer"
                className="text-primary underline-offset-2 hover:underline"
              >
                Open PDF
              </a>
            ) : null}
          </li>
        ))}
      </ul>
      <RangePager
        offset={data.offset}
        pageSize={data.pageSize}
        shown={data.documents.length}
        total={data.total}
        onOffset={setOffset}
      />
    </div>
  );
}
