import {
  BookOpen,
  ExternalLink,
  FileText,
  FolderSearch,
  Globe,
  HandHelping,
  Receipt,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { buildEntityView } from "@/lib/external/entityView";
import {
  courtResourceLabels,
  courtResources,
  type CourtResourceKind,
} from "@/lib/courts/resources";
import {
  loadCourtResourceSnapshot,
  mergeCourtResourceSnapshot,
} from "@/lib/courts/resourceSnapshot";

const icons = {
  rules: BookOpen,
  forms: FileText,
  filing: FolderSearch,
  fees: Receipt,
  help: HandHelping,
  website: Globe,
} satisfies Record<CourtResourceKind, typeof BookOpen>;
const order: CourtResourceKind[] = ["rules", "forms", "filing", "fees", "help", "website"];

export function CourtResources({
  raw,
  courtId,
  system,
}: {
  raw: Record<string, unknown>;
  courtId: string;
  system?: string | null;
}) {
  const snapshot = useQuery({
    queryKey: ["reviewed-court-resource-snapshot"],
    queryFn: ({ signal }) => loadCourtResourceSnapshot(signal),
    staleTime: 5 * 60_000,
    retry: 1,
  });
  const resources = mergeCourtResourceSnapshot(
    courtResources(buildEntityView(raw), system),
    snapshot.data?.status === "available" ? snapshot.data.snapshot : null,
    courtId,
    system,
  );
  return (
    <section
      aria-labelledby="court-resources-heading"
      className="mb-5 rounded-xl border border-border bg-surface p-4 shadow-card"
    >
      <h2 id="court-resources-heading" className="text-sm font-semibold">
        Court resources
      </h2>
      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
        Links recorded for this court. Open the source for its latest requirements and availability.
      </p>
      {resources.length ? (
        <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {order.map((kind) => {
            const links = resources.filter((resource) => resource.kind === kind);
            if (!links.length) return null;
            const Icon = icons[kind];
            return (
              <div key={kind} className="min-w-0">
                <h3 className="mb-2 flex items-center gap-2 text-xs font-semibold">
                  <Icon aria-hidden className="size-3.5 text-muted-foreground" />
                  {courtResourceLabels[kind]}
                </h3>
                <ul className="space-y-2">
                  {links.map((link) => (
                    <li key={link.url}>
                      <a
                        href={link.url}
                        target="_blank"
                        rel="noreferrer"
                        className="group flex min-w-0 items-start gap-2 rounded-lg border border-border bg-background px-3 py-2 text-xs hover:border-primary/40 hover:bg-muted/50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block break-words font-medium group-hover:underline">
                            {link.sourceLabel ?? link.label}
                          </span>
                          <span
                            className="mt-1 block truncate text-[10px] text-muted-foreground"
                            title={`${link.recordedIn} · ${link.host}`}
                          >
                            {link.host}
                          </span>
                        </span>
                        <ExternalLink
                          aria-hidden
                          className="mt-0.5 size-3 shrink-0 text-muted-foreground"
                        />
                      </a>
                      {link.provenance ? (
                        <details className="mt-1 px-1 text-[10px] leading-relaxed text-muted-foreground">
                          <summary className="cursor-pointer">
                            Source captured {link.provenance.capturedAt.slice(0, 10)}
                          </summary>
                          <p className="mt-1">
                            Link observed on{" "}
                            <a
                              href={link.provenance.sourcePage}
                              target="_blank"
                              rel="noreferrer"
                              className="underline"
                            >
                              the court’s source page
                            </a>
                            . The destination may have changed since this capture.
                          </p>
                          {link.sourceLabel && link.sourceLabel !== link.label ? (
                            <p className="mt-1">Earlier recorded label: {link.label}</p>
                          ) : null}
                        </details>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      ) : (
        <p className="mt-3 text-xs text-muted-foreground">
          Rules, forms, filing instructions and court service links are not recorded for this
          profile.
        </p>
      )}
      {snapshot.isPending ? (
        <p role="status" className="mt-3 text-xs text-muted-foreground">
          Loading reviewed court website links…
        </p>
      ) : snapshot.isError ? (
        <p role="status" className="mt-3 text-xs text-muted-foreground">
          Reviewed website links are temporarily unavailable.{" "}
          <button type="button" className="underline" onClick={() => void snapshot.refetch()}>
            Retry
          </button>
        </p>
      ) : null}
    </section>
  );
}
