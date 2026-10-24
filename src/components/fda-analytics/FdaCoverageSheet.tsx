import type { FdaAnalyticsSnapshot } from "@/lib/fda-analytics/types";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { SourceLink } from "@/components/regulatory/RegulatoryPrimitives";
import { numberLabel } from "./chartView";
import { facetScopeLabel } from "./analyticsView";

export function FdaCoverageSheet({
  snapshot,
  selectedId,
  open,
  onOpenChange,
}: {
  snapshot: FdaAnalyticsSnapshot;
  selectedId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const datasets = selectedId
    ? snapshot.datasets.filter((dataset) => dataset.id === selectedId)
    : snapshot.datasets;
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto p-4 sm:max-w-xl">
        <SheetHeader className="pr-8 text-left">
          <SheetTitle>FDA source coverage</SheetTitle>
          <SheetDescription>
            Captured {snapshot.generatedAt}. Each chart retains its own reporting unit and date
            meaning.
          </SheetDescription>
        </SheetHeader>
        <div className="mt-4 space-y-4">
          {snapshot.qualifications.length > 0 && (
            <details className="rounded-md border border-border p-3">
              <summary className="cursor-pointer text-sm font-medium">
                Snapshot qualifications
              </summary>
              <ul className="mt-2 list-disc space-y-1 pl-4 text-xs leading-5">
                {snapshot.qualifications.map((text, i) => (
                  <li key={i}>{text}</li>
                ))}
              </ul>
            </details>
          )}
          {datasets.map((dataset) => (
            <section key={dataset.id} className="rounded-md border border-border p-3">
              <div className="flex items-start justify-between gap-3">
                <h3 className="text-label font-semibold text-foreground">{dataset.label}</h3>
                <span className="rounded border border-border px-1.5 text-xs capitalize">
                  {dataset.status}
                </span>
              </div>
              <dl className="mt-2 grid grid-cols-[7rem_minmax(0,1fr)] gap-x-2 gap-y-1 text-xs leading-5">
                <dt className="text-muted-foreground">Counted unit</dt>
                <dd>{dataset.countUnit}</dd>
                <dt className="text-muted-foreground">Source release</dt>
                <dd>{dataset.sourceUpdatedAt ?? "Not recorded"}</dd>
                <dt className="text-muted-foreground">Retrieved</dt>
                <dd className="break-words">{dataset.retrievedAt}</dd>
                <dt className="text-muted-foreground">Total scope</dt>
                <dd>
                  {numberLabel(dataset.total.value)} ·{" "}
                  {dataset.total.scope === "inventory" ? "inventory" : "all time"}
                </dd>
                {dataset.series && (
                  <>
                    <dt className="text-muted-foreground">Date field</dt>
                    <dd>
                      {dataset.series.dateMeaning} ({dataset.series.dateField})
                    </dd>
                    <dt className="text-muted-foreground">Series window</dt>
                    <dd>
                      {dataset.series.range.from} through {dataset.series.range.to}
                    </dd>
                    <dt className="text-muted-foreground">Series cutoff</dt>
                    <dd>{dataset.series.completeThrough ?? "Not established"}</dd>
                  </>
                )}
              </dl>
              {dataset.statusReason && (
                <p className="mt-2 text-xs leading-5 text-amber-800 dark:text-amber-300">
                  {dataset.statusReason}
                </p>
              )}
              <p className="mt-2 text-xs leading-5 text-muted-foreground">
                {dataset.qualification}
              </p>
              {dataset.series && (
                <p className="mt-2 text-xs leading-5 text-muted-foreground">
                  {dataset.series.qualification}
                </p>
              )}
              <div className="mt-2">
                <SourceLink url={dataset.documentationUrl}>FDA dataset documentation</SourceLink>
              </div>
              {dataset.facets.length > 0 && (
                <details className="mt-3">
                  <summary className="cursor-pointer text-xs font-medium">
                    Category scopes and denominators ({dataset.facets.length})
                  </summary>
                  <div className="mt-2 space-y-2">
                    {dataset.facets.map((facet) => (
                      <div key={facet.id} className="border-t border-border pt-2 text-xs leading-5">
                        <strong>{facet.label}</strong> · {facetScopeLabel(facet)}
                        <p>
                          Denominator: {numberLabel(facet.denominator)} {facet.denominatorLabel}.{" "}
                          {facet.multiValued
                            ? "Categories can overlap."
                            : "Single-valued categories."}{" "}
                          {facet.truncated || !facet.exhaustive
                            ? "Displayed categories are not exhaustive."
                            : "Complete category enumeration."}
                        </p>
                        <p className="text-muted-foreground">{facet.qualification}</p>
                      </div>
                    ))}
                  </div>
                </details>
              )}
              <details className="mt-3">
                <summary className="cursor-pointer text-xs font-medium">
                  Retained API response provenance
                </summary>
                <div className="mt-2 space-y-2">
                  {snapshot.receipts
                    .filter((receipt) =>
                      new Set([
                        ...dataset.total.receiptIds,
                        ...(dataset.series?.receiptIds ?? []),
                        ...dataset.facets.flatMap((facet) => facet.receiptIds),
                      ]).has(receipt.id),
                    )
                    .map((receipt) => (
                      <div key={receipt.id} className="border-t border-border pt-2 text-xs">
                        <SourceLink url={receipt.url}>Official API response</SourceLink>
                        <p className="mt-1">
                          Retrieved {receipt.retrievedAt} · {numberLabel(receipt.byteCount)} bytes
                        </p>
                        <p className="mt-1 break-all text-muted-foreground">
                          SHA-256 {receipt.sha256}
                        </p>
                      </div>
                    ))}
                </div>
              </details>
            </section>
          ))}
        </div>
      </SheetContent>
    </Sheet>
  );
}
