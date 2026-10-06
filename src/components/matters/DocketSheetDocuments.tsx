import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";

import { ExternalError } from "@/components/corpus/ExternalBadge";
import { RangePager } from "@/components/matters/common";
import { AVAILABILITY_LABELS, type DocketDocument } from "@/lib/matters/docketDocuments";
import { formatBytes } from "@/lib/matters/documents";
import { getMatterDocketDocuments } from "@/lib/matters/matters.functions";

function recorded(value: string | null | undefined): string {
  return value && value.trim() ? value : "Not recorded";
}

/** One docket-sheet document: the published fields, with "Not recorded" wherever the row is blank. */
export function DocketDocumentFields({ d }: { d: DocketDocument }) {
  const status = d.availability === "other" ? "Not recorded" : AVAILABILITY_LABELS[d.availability];
  return (
    <dl className="grid min-w-0 flex-1 gap-x-4 gap-y-1 sm:grid-cols-2">
      <div className="min-w-0 sm:col-span-2">
        <dt className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          Entry
        </dt>
        <dd className="font-mono">
          {d.entryNumber !== null ? `#${d.entryNumber}` : "Not recorded"}
        </dd>
      </div>
      <div className="min-w-0">
        <dt className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          File name
        </dt>
        <dd className="break-all font-mono text-[11px]">{recorded(d.fileName)}</dd>
      </div>
      <div className="min-w-0">
        <dt className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          Date
        </dt>
        <dd className="font-mono">{recorded(d.dateFiled)}</dd>
      </div>
      <div className="min-w-0 sm:col-span-2">
        <dt className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          Description
        </dt>
        <dd className="break-words">{recorded(d.description)}</dd>
      </div>
      <div className="min-w-0">
        <dt className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          Status
        </dt>
        <dd>
          {status}
          {d.bytes !== null ? ` · ${formatBytes(d.bytes)}` : ""}
        </dd>
      </div>
      <div className="min-w-0">
        <dt className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          Label
        </dt>
        <dd>{recorded(d.label)}</dd>
      </div>
      <div className="min-w-0">
        <dt className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          Parties
        </dt>
        <dd title="Parties of the matter in the registry">{recorded(d.parties)}</dd>
      </div>
      <div className="min-w-0">
        <dt className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          PDF
        </dt>
        <dd>
          {d.pdfUrl ? (
            <a
              href={d.pdfUrl}
              target="_blank"
              rel="noreferrer"
              className="text-primary underline-offset-2 hover:underline"
            >
              Open PDF
            </a>
          ) : (
            "Not recorded"
          )}
        </dd>
      </div>
    </dl>
  );
}

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
  if (q.isLoading && !q.data)
    return (
      <p className="mt-3 text-[12px] text-muted-foreground">Loading docket-sheet documents…</p>
    );
  if (q.error) return <ExternalError error={q.error} />;
  const data = q.data;
  if (!data || (data.total === 0 && data.documents.length === 0)) return null;
  const countLabel = data.total == null ? "too large to count" : data.total.toLocaleString();
  return (
    <div className="mt-3 space-y-2">
      <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {title} · {countLabel}
      </h3>
      <p className="text-[12px] text-muted-foreground">
        {intro ??
          "Documents of the cases tracked in DocketBird, as the provider's docket sheet shows them, by entry number."}{" "}
        Sealed and restricted documents are not listed. A blank field is Not recorded.
      </p>
      <ul className="divide-y divide-border rounded-lg border border-border">
        {data.documents.map((d) => (
          <li key={d.nativeDocumentId} className="p-2 text-[12px]">
            <DocketDocumentFields d={d} />
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
