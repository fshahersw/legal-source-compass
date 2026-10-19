import { useState, type ReactNode, type CSSProperties } from "react";
import { useQuery } from "@tanstack/react-query";
import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { getRegulatoryRecord } from "@/lib/external/regulatory.functions";
import type { RegulatoryEvent, RegulatorySourceId } from "@/lib/regulatory/types";
import {
  actionClass,
  Empty,
  fieldClass,
  LoadError,
  Metadata,
  Pending,
  Qualifications,
  SourceLink,
} from "./RegulatoryPrimitives";
import { displayDate, EVENT_LABELS, valueText } from "./monitoringView";
import { selectEvidence } from "./evidenceSelection";

export function RegulatoryEvidenceDrawer({
  source,
  nativeId,
  eventId,
  onClose,
  review,
}: {
  source: RegulatorySourceId;
  nativeId: string;
  eventId?: string | undefined;
  onClose: () => void;
  review?: ((event: RegulatoryEvent) => ReactNode) | undefined;
}) {
  const [width, setWidth] = useState(48);
  const [chosenHash, setChosenHash] = useState<string | null>(null);
  const result = useQuery({
    queryKey: ["regulatory-record", source, nativeId],
    queryFn: () => getRegulatoryRecord({ data: { source, nativeId } }),
    staleTime: 30000,
  });
  const detail = result.data;
  const { hash, version, event, previous } = selectEvidence(detail, eventId, chosenHash);
  const record = version?.record;

  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/30" />
        <Dialog.Content
          style={{ "--drawer-width": `${width}rem` } as CSSProperties}
          className="fixed inset-y-0 right-0 z-50 flex w-full max-w-full flex-col border-l border-border bg-background outline-none sm:w-[var(--drawer-width)]"
        >
          <header className="flex items-start justify-between gap-3 border-b border-border bg-surface p-3">
            <div className="min-w-0">
              <Dialog.Title className="font-sans text-base font-semibold">
                Source evidence
              </Dialog.Title>
              <Dialog.Description className="mt-1 break-words text-xs text-muted-foreground">
                {detail?.source.label ?? source} · {nativeId}
              </Dialog.Description>
            </div>
            <Dialog.Close className={actionClass} aria-label="Close evidence">
              <X className="size-4" aria-hidden />
            </Dialog.Close>
          </header>
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-3 sm:p-4">
            <label className="hidden items-center gap-2 text-xs text-muted-foreground sm:flex">
              Drawer width
              <input
                type="range"
                min={28}
                max={64}
                value={width}
                onChange={(e) => setWidth(Number(e.target.value))}
                className="max-w-40 accent-primary"
              />
            </label>
            {result.isPending ? (
              <Pending />
            ) : result.isError ? (
              <LoadError retry={() => void result.refetch()} />
            ) : !detail ? (
              <Empty title="Record not available">
                No published record matches this source and native identifier.
              </Empty>
            ) : (
              <>
                <div>
                  <h2 className="font-sans text-lg font-semibold leading-6">
                    {record?.title ?? `Record ${nativeId}`}
                  </h2>
                  <div className="mt-2">
                    <SourceLink url={record?.source_url} />
                  </div>
                </div>
                <label className="block text-xs font-medium">
                  Retained version
                  <select
                    className={`${fieldClass} mt-1`}
                    value={hash ?? ""}
                    onChange={(e) => setChosenHash(e.target.value)}
                  >
                    <option value="" disabled>
                      Select a retained version
                    </option>
                    {detail.versions.map((item) => (
                      <option key={item.payloadSha256} value={item.payloadSha256}>
                        {item.firstObservedAt} · {item.payloadSha256.slice(0, 12)}
                        {item.payloadSha256 === detail.payloadSha256 ? " · latest" : ""}
                      </option>
                    ))}
                  </select>
                </label>
                {(detail.versionsCapped || detail.eventsCapped) && (
                  <p className="text-xs text-muted-foreground">
                    History is capped. A missing earlier version or event may exist outside this
                    response.
                  </p>
                )}
                {!record ? (
                  <p role="status" className="rounded-md border border-warning/40 p-3 text-sm">
                    The selected event’s pinned version is not available in this history response.
                    Choose an available version; the latest record has not been substituted for that
                    evidence.
                  </p>
                ) : (
                  <>
                    <section className="space-y-2">
                      <h3 className="font-sans text-sm font-semibold">Why this is here</h3>
                      <p className="text-sm leading-5">
                        {event?.reason ??
                          "This is a retained source version. An associated change event is not available in this response."}
                      </p>
                      {event && (
                        <p className="text-xs text-muted-foreground">
                          {EVENT_LABELS[event.eventType]} · detected {event.detectedAt} · rule{" "}
                          {event.ruleVersion}
                        </p>
                      )}
                    </section>
                    <section>
                      <h3 className="mb-2 font-sans text-sm font-semibold">
                        Exact retained excerpt
                      </h3>
                      {record.evidence_excerpt ? (
                        <blockquote className="max-h-80 overflow-y-auto whitespace-pre-wrap break-words border-l-2 border-primary/40 bg-surface p-3 text-sm leading-6">
                          {record.evidence_excerpt}
                        </blockquote>
                      ) : (
                        <p className="text-sm text-muted-foreground">
                          No excerpt recorded. Open the source document.
                        </p>
                      )}
                      <p className="mt-1 text-xs text-muted-foreground">
                        A source excerpt may be partial; it is not an independent finding or a
                        complete document.
                      </p>
                    </section>
                    <section>
                      <h3 className="mb-2 font-sans text-sm font-semibold">What changed</h3>
                      {event?.changedFields.length ? (
                        <div className="space-y-3">
                          {!previous && (
                            <p className="text-xs text-muted-foreground">
                              The previous pinned version is unavailable; before-values cannot be
                              reconstructed.
                            </p>
                          )}
                          {event.changedFields.map((key) => (
                            <div key={key} className="rounded-md border border-border">
                              <p className="border-b border-border px-3 py-2 text-xs font-semibold">
                                {key}
                              </p>
                              <div className="grid divide-y divide-border sm:grid-cols-2 sm:divide-x sm:divide-y-0">
                                <div className="min-w-0 p-3">
                                  <p className="mb-1 text-xs text-muted-foreground">Previous</p>
                                  <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words font-sans text-sm">
                                    {previous
                                      ? valueText(
                                          previous.record[key as keyof typeof previous.record],
                                        )
                                      : "Previous version unavailable"}
                                  </pre>
                                </div>
                                <div className="min-w-0 p-3">
                                  <p className="mb-1 text-xs text-muted-foreground">
                                    Selected version
                                  </p>
                                  <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words font-sans text-sm">
                                    {valueText(record[key as keyof typeof record])}
                                  </pre>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="text-sm text-muted-foreground">
                          No field comparison recorded for this version. An initial capture or
                          backfill does not establish a newly occurring incident.
                        </p>
                      )}
                    </section>
                    <section>
                      <h3 className="mb-2 font-sans text-sm font-semibold">
                        Dates and source identity
                      </h3>
                      <Metadata
                        rows={[
                          ["Publisher date", displayDate(record.published_on)],
                          ["Source updated", displayDate(record.source_updated_on)],
                          ["First observed", displayDate(version?.firstObservedAt)],
                          ["Last observed", displayDate(version?.lastObservedAt)],
                          ["Source status", record.status ?? "Not recorded"],
                          ["Document type", record.document_type],
                          ["Native ID", record.native_id],
                          [
                            "Identifiers",
                            record.identifiers.length
                              ? record.identifiers.join(" · ")
                              : "Not recorded",
                          ],
                        ]}
                      />
                    </section>
                    {record.entity_refs.length > 0 && (
                      <section>
                        <h3 className="mb-2 font-sans text-sm font-semibold">
                          Recorded entity references
                        </h3>
                        <ul className="space-y-2 text-sm">
                          {record.entity_refs.map((entity, i) => (
                            <li key={`${entity.namespace}:${entity.native_id}:${i}`}>
                              <p>{entity.label}</p>
                              <p className="break-all text-xs text-muted-foreground">
                                {entity.namespace} / {entity.native_id}
                              </p>
                            </li>
                          ))}
                        </ul>
                        <p className="mt-2 text-xs text-muted-foreground">
                          Source-native references are not inferred corporate relationships or
                          litigation membership.
                        </p>
                      </section>
                    )}
                    <section>
                      <h3 className="mb-2 font-sans text-sm font-semibold">
                        Uncertainties and next review
                      </h3>
                      <Qualifications
                        items={[
                          detail.qualification,
                          detail.source.qualification,
                          "Verify the exact product, facility and version scope, including corrections or contrary evidence. Recorded agency content does not establish causation, liability or a filing deadline.",
                        ]}
                      />
                    </section>
                    <details className="border-t border-border pt-3">
                      <summary className="cursor-pointer text-sm font-medium">
                        Capture provenance and retained fields
                      </summary>
                      <div className="mt-3">
                        <Metadata
                          rows={[
                            ["Payload SHA-256", version?.payloadSha256 ?? "Not recorded"],
                            ["Raw SHA-256", version?.rawSha256 ?? "Not recorded"],
                            [
                              "Capture source",
                              <SourceLink key="capture" url={version?.captureSourceUrl} />,
                            ],
                            ["Schema", version?.schemaVersion ?? "Not recorded"],
                          ]}
                        />
                      </div>
                      <pre className="mt-3 max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted/30 p-3 text-xs">
                        {valueText(record.fields)}
                      </pre>
                    </details>
                    {event && review ? (
                      <section className="border-t border-border pt-3">{review(event)}</section>
                    ) : null}
                  </>
                )}
              </>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
