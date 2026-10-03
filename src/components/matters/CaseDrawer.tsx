import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Link } from "@tanstack/react-router";
import { Eye } from "lucide-react";
import { useState } from "react";

import { ExternalError } from "@/components/corpus/ExternalBadge";
import { Chip, Fact, HeldBadge, LinkOut, Loading, NotRecorded } from "@/components/matters/common";
import { PdfViewer } from "@/components/matters/PdfViewer";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  BASIS_NOTES,
  ROLE_LABELS,
  captionSourceLabel,
  evidenceKindLabel,
  routeLabel,
  type CaseRow,
  type RegistryLabels,
} from "@/lib/matters/cases";
import { formatBytes, sortDocuments, type MatterDocument } from "@/lib/matters/documents";
import { getMatterCaseDocuments, getMatterRegistryDocket } from "@/lib/matters/matters.functions";
import { formatUtc, type EvidenceItem } from "@/lib/matters/registry";

/** Documents a docket's drawer lists at first, and the most it lists when expanded (the Documents tab has the rest). */
const DRAWER_DOCS = 12;
const DRAWER_ALL_DOCS = 100;

/**
 * The verified PDFs filed under this docket's own provider case ids (the ids come from the registry row on the
 * server). Open items open in the same inline viewer as the Documents tab; held items are listed with no link.
 */
function CaseDocuments({ mdl, rowId }: { mdl: string; rowId: string }) {
  const fn = useServerFn(getMatterCaseDocuments);
  const q = useQuery({
    queryKey: ["matter-case-documents", mdl, rowId],
    queryFn: () => fn({ data: { id: mdl, rowId } }),
    staleTime: 5 * 60_000,
  });
  const [showAll, setShowAll] = useState(false);
  const [viewed, setViewed] = useState<MatterDocument | null>(null);
  const heading = (
    <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
      Documents filed on this docket
    </h3>
  );
  if (q.isLoading)
    return (
      <section aria-label="Documents">
        {heading}
        <Loading what="documents" />
      </section>
    );
  if (q.error)
    return (
      <section aria-label="Documents">
        {heading}
        <ExternalError error={q.error} />
      </section>
    );
  const data = q.data;
  if (!data) return null;
  if (!data.documents) {
    return (
      <section aria-label="Documents">
        {heading}
        <p className="text-[12px] text-muted-foreground">
          The registry records no provider case id that can be matched to the verified PDF archive
          for this docket, so no document is listed. This is a coverage gap, not evidence that none
          exist.
        </p>
      </section>
    );
  }
  const docs = data.documents;
  if (!docs.connected) {
    return (
      <section aria-label="Documents">
        {heading}
        <p className="text-[12px] text-muted-foreground">{docs.reason}</p>
      </section>
    );
  }
  const rows = sortDocuments(docs.rows, "entry-desc");
  const shown = rows.slice(0, showAll ? DRAWER_ALL_DOCS : DRAWER_DOCS);
  return (
    <section aria-label="Documents">
      {heading}
      <p className="mb-2 text-[12px] text-muted-foreground">
        <span className="font-medium text-foreground tabular-nums">
          {docs.summary.total.toLocaleString()}
        </span>{" "}
        {docs.summary.total === 1 ? "document" : "documents"} in the verified PDF archive under{" "}
        {data.ids.map((id, i) => (
          <span key={id}>
            {i ? ", " : ""}
            <span className="font-mono text-[11px]">{id}</span>
          </span>
        ))}
        {docs.summary.total ? (
          <>
            {" "}
            · {docs.summary.open.toLocaleString()} open · {docs.summary.held.toLocaleString()} held
          </>
        ) : null}
        .
      </p>
      {docs.truncated ? (
        // A partial read is not a list worth showing (it would be the first rows the archive returns, not the newest).
        <p className="text-[12px] text-muted-foreground">
          Too many to list here.{" "}
          <Link
            to="/matters/$id"
            params={{ id: mdl }}
            search={{ tab: "documents" }}
            className="text-primary underline-offset-2 hover:underline"
          >
            Open them in the Documents tab
          </Link>
          , where they can be searched and filtered.
        </p>
      ) : rows.length ? (
        <>
          <ul className="divide-y divide-border rounded-md border border-border text-[12px]">
            {shown.map((d) => (
              <li
                key={`${d.sourceSystem}:${d.nativeDocumentId}`}
                className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-2.5 py-1.5"
              >
                <span className="min-w-0">
                  <span className="font-medium">{d.label}</span>
                  <span className="ml-2 text-muted-foreground">
                    {d.sourceLabel}
                    {d.availability === "open" && d.bytes !== null
                      ? ` · ${formatBytes(d.bytes)}`
                      : ""}
                  </span>
                </span>
                {d.availability === "open" ? (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 px-2 text-[12px]"
                    onClick={() => setViewed(d)}
                  >
                    <Eye aria-hidden /> View
                  </Button>
                ) : (
                  <HeldBadge />
                )}
              </li>
            ))}
          </ul>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px]">
            {rows.length > DRAWER_DOCS ? (
              <button
                type="button"
                aria-expanded={showAll}
                className="text-primary underline-offset-2 hover:underline"
                onClick={() => setShowAll((v) => !v)}
              >
                {showAll
                  ? "Show fewer"
                  : `Show ${Math.min(rows.length, DRAWER_ALL_DOCS).toLocaleString()} documents`}
              </button>
            ) : null}
            {rows.length > shown.length ? (
              <span className="text-muted-foreground">
                {shown.length.toLocaleString()} of {rows.length.toLocaleString()} shown.
              </span>
            ) : null}
            {rows.length > DRAWER_DOCS ? (
              <Link
                to="/matters/$id"
                params={{ id: mdl }}
                search={{ tab: "documents" }}
                className="text-primary underline-offset-2 hover:underline"
              >
                All documents of the matter (Documents tab)
              </Link>
            ) : null}
          </div>
        </>
      ) : (
        <p className="text-[12px] text-muted-foreground">
          The verified PDF archive holds no document for these case ids yet.
        </p>
      )}
      <PdfViewer doc={viewed} onClose={() => setViewed(null)} />
    </section>
  );
}

function EvidenceCard({
  item,
  labels,
}: {
  item: EvidenceItem;
  labels: RegistryLabels | undefined;
}) {
  const kindLabel = evidenceKindLabel(item.kind, labels);
  return (
    <li className="rounded-md border border-border bg-background p-3 text-[12px]">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{item.label ?? kindLabel}</span>
        {item.label && item.label !== kindLabel ? (
          <Chip title={BASIS_NOTES[item.kind]}>{kindLabel}</Chip>
        ) : null}
      </div>
      <dl className="mt-2 grid gap-x-4 gap-y-1.5 sm:grid-cols-2">
        <Fact label="Asserts role">{item.assertedRole?.replace(/_/g, " ")}</Fact>
        <Fact label="Asserts route">
          {item.assertedRoute && item.assertedRoute !== "unknown"
            ? routeLabel(item.assertedRoute)
            : null}
        </Fact>
        <Fact label="Source">
          {item.sourceUrl ? (
            item.linkable ? (
              <LinkOut href={item.sourceUrl} className="break-all">
                {item.sourceUrl.replace(/^https:\/\//, "")}
              </LinkOut>
            ) : (
              <span className="break-all font-mono text-[11px]" title="A data endpoint, not a page">
                {item.sourceUrl.replace(/^https:\/\//, "")}
              </span>
            )
          ) : null}
        </Fact>
        <Fact label="Where in the source">{item.locator}</Fact>
        <Fact label="Retrieved">{formatUtc(item.retrievedAt)}</Fact>
        <Fact label="Source as of">{item.asOf}</Fact>
        {item.sourceSha256 ? (
          <Fact label="Source SHA-256">
            <span className="break-all font-mono text-[11px]" title={item.sourceSha256}>
              {item.sourceSha256.slice(0, 16)}…
            </span>
          </Fact>
        ) : null}
        {item.quote ? <Fact label="Quoted text">“{item.quote}”</Fact> : null}
      </dl>
      {item.qualification ? (
        <details className="mt-2">
          <summary className="cursor-pointer text-muted-foreground">What this evidence is</summary>
          <p className="mt-1 leading-relaxed text-muted-foreground">{item.qualification}</p>
        </details>
      ) : null}
    </li>
  );
}

/** Right-hand drawer with the matter registry's evidence for one docket. */
export function CaseDrawer({
  mdl,
  row,
  labels,
  onClose,
}: {
  mdl: string;
  row: CaseRow | null;
  labels: RegistryLabels | undefined;
  onClose: () => void;
}) {
  const fn = useServerFn(getMatterRegistryDocket);
  const reg = row?.registry ?? null;
  const q = useQuery({
    queryKey: ["matter-registry-docket", mdl, reg?.rowId ?? null],
    enabled: !!reg,
    queryFn: () => fn({ data: { id: mdl, rowId: reg!.rowId } }),
    staleTime: 10 * 60_000,
  });
  const detail = q.data ?? null;
  return (
    <Sheet open={!!row} onOpenChange={(open) => (open ? undefined : onClose())}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-3 overflow-y-auto p-4 sm:max-w-[min(40rem,94vw)]"
      >
        <SheetHeader className="space-y-1 pr-6 text-left">
          <SheetTitle className="font-display text-[15px] leading-snug">
            {row?.docketNumber ?? "Docket"}
            {row?.courtId ? (
              <span className="ml-2 font-mono text-[12px]">{row.courtId}</span>
            ) : null}
          </SheetTitle>
          <SheetDescription className="text-[12px]">
            MDL {mdl} · {row ? (labels?.role?.[row.role] ?? ROLE_LABELS[row.role]) : ""}
          </SheetDescription>
        </SheetHeader>
        {row ? (
          <div className="space-y-4">
            {row.caption ? (
              <p className="text-[13px] font-medium leading-snug">
                {row.caption}
                {captionSourceLabel(row.registry?.captionSource) ? (
                  <span className="mt-0.5 block text-[11px] font-normal text-muted-foreground">
                    Caption as published · {captionSourceLabel(row.registry?.captionSource)}
                  </span>
                ) : null}
              </p>
            ) : (
              <p className="text-[12px] text-muted-foreground">
                {row.registry
                  ? "No caption published for this docket: no source prints one, or the printed one is withheld under the publication rule."
                  : "Caption withheld by the source."}
              </p>
            )}
            <dl className="grid gap-x-4 gap-y-2 sm:grid-cols-2">
              <Fact label="Court">
                {row.courtId ? (
                  <Link
                    to="/courts/$id"
                    params={{ id: row.courtId }}
                    className="text-primary underline-offset-2 hover:underline"
                  >
                    {row.courtId}
                  </Link>
                ) : null}
              </Fact>
              <Fact label="Filed">{row.dateFiled}</Fact>
              <Fact label="Terminated">{row.dateTerminated}</Fact>
              <Fact label="Route into the MDL">{row.route ? routeLabel(row.route) : null}</Fact>
              {reg ? (
                <>
                  <Fact label="Counted as an action">
                    {reg.countsAsAction === null
                      ? null
                      : reg.countsAsAction
                        ? "Yes — this row carries the count for its action"
                        : "No — not counted as an action on its own"}
                  </Fact>
                  <Fact label="Action id">
                    {reg.actionId ? (
                      <span className="font-mono text-[11px]">{reg.actionId}</span>
                    ) : null}
                  </Fact>
                  <Fact label="Registry docket key">
                    <span className="font-mono text-[11px]">{reg.docketKey}</span>
                  </Fact>
                  <Fact label="Evidence rows">{reg.evidenceCount?.toLocaleString()}</Fact>
                </>
              ) : null}
            </dl>

            {reg?.conflict || detail?.hasConflict ? (
              <p className="rounded-md border border-warning/50 bg-warning/10 px-3 py-2 text-[12px] text-warning-foreground">
                Different sources assert this docket for different MDLs. The registry records both
                and does not resolve the conflict.
              </p>
            ) : null}

            {reg?.links.length ? (
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-[12px]">
                {reg.links.map((l) => (
                  <LinkOut key={l.url} href={l.url}>
                    {l.label}
                  </LinkOut>
                ))}
              </div>
            ) : null}

            {reg ? <CaseDocuments mdl={mdl} rowId={reg.rowId} /> : null}

            {q.isLoading ? <Loading what="the evidence" /> : null}
            {q.error ? <ExternalError error={q.error} /> : null}
            {reg && !q.isLoading && !q.error && !detail ? (
              <p className="text-[12px] text-muted-foreground">
                The evidence for this docket could not be read. <NotRecorded />
              </p>
            ) : null}

            {detail ? (
              <>
                {detail.nativeCaseIds.length ? (
                  <section aria-label="Provider case ids">
                    <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                      Provider case ids
                    </h3>
                    <ul className="space-y-0.5 text-[12px]">
                      {detail.nativeCaseIds.map((n) => (
                        <li key={`${n.provider}:${n.id}`}>
                          <span className="text-muted-foreground">{n.provider}</span>{" "}
                          <span className="font-mono">{n.id}</span>
                          {n.basis ? (
                            <span className="ml-1 text-muted-foreground">
                              ({n.basis.replace(/_/g, " ")})
                            </span>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  </section>
                ) : null}

                {detail.linkedDockets.length ? (
                  <section aria-label="Linked dockets">
                    <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                      Same action, other docket
                    </h3>
                    <ul className="space-y-0.5 text-[12px]">
                      {detail.linkedDockets.map((d) => (
                        <li key={d.docketKey}>
                          <span className="font-mono">{d.docketKey}</span>{" "}
                          <span className="text-muted-foreground">
                            ({d.role.replace(/_/g, " ")})
                          </span>
                        </li>
                      ))}
                    </ul>
                  </section>
                ) : null}

                {detail.judges.length ? (
                  <section aria-label="Judges">
                    <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                      Judges on the docket (as recorded)
                    </h3>
                    <ul className="space-y-0.5 text-[12px]">
                      {detail.judges.map((j, i) => (
                        <li key={`${j.role}-${i}`}>
                          {j.sourceString ?? <NotRecorded />}{" "}
                          <span className="text-muted-foreground">
                            ({j.role.replace(/_/g, " ")}
                            {j.clPersonId ? `, CourtListener person ${j.clPersonId}` : ""})
                          </span>
                        </li>
                      ))}
                    </ul>
                  </section>
                ) : null}

                <section aria-label="Evidence">
                  <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Evidence ({detail.evidence.length.toLocaleString()})
                  </h3>
                  {detail.evidence.length ? (
                    <ul className="space-y-2">
                      {detail.evidence.map((e, i) => (
                        <EvidenceCard key={`${e.kind}-${i}`} item={e} labels={labels} />
                      ))}
                    </ul>
                  ) : (
                    <p className="text-[12px] text-muted-foreground">
                      No evidence rows are projected for this docket. <NotRecorded />
                    </p>
                  )}
                </section>

                {detail.held.length ? (
                  <p className="text-[12px] text-muted-foreground">
                    Held by the registry: {detail.held.join(", ")}.
                  </p>
                ) : null}
                {detail.qualification ? (
                  <p className="text-[11px] leading-relaxed text-muted-foreground">
                    {detail.qualification}
                    {detail.projectedAt ? ` Projected ${formatUtc(detail.projectedAt)}.` : ""}
                  </p>
                ) : null}
              </>
            ) : null}
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
