import { Link } from "@tanstack/react-router";

import { AppShell } from "@/components/atlas/AppShell";
import { CasesPanel } from "@/components/matters/CasesPanel";
import { DocketPanel } from "@/components/matters/DocketPanel";
import { DocumentsPanel } from "@/components/matters/DocumentsPanel";
import { DocumentsPanel as FilingsPanel } from "@/components/documents/DocumentsPanel";
import { EvidencePanel } from "@/components/matters/EvidencePanel";
import { MatterLifecyclePanel } from "@/components/litviz/MatterLifecyclePanel";
import { MatterHeader } from "@/components/matters/MatterHeader";
import { OverviewPanel } from "@/components/matters/OverviewPanel";
import { PartiesPanel } from "@/components/matters/PartiesPanel";
import type { ReactNode } from "react";
import {
  MATTER_TAB_LABELS,
  MATTER_VIEWS,
  matterViewOf,
  withEntry,
  withView,
  type MatterSearch,
  type MatterTab,
} from "@/lib/matters/search";
import type { MatterOverviewPayload } from "@/lib/matters/types";

/** One matter: header, then four views (overview and lifecycle; cases and parties; docket and documents; evidence). */
export function MatterPage({
  payload,
  search,
  onSearch,
}: {
  payload: MatterOverviewPayload;
  search: MatterSearch;
  onSearch: (next: (prev: MatterSearch) => MatterSearch) => void;
}) {
  const { overview: o } = payload;
  const tab: MatterTab = search.tab ?? "overview";
  const description = [
    o.masterDocket.number ? `Master docket ${o.masterDocket.number}` : null,
    o.court.shortName,
    payload.sw.shortName ? `Seeger Weiss tier ${payload.sw.tier}: ${payload.sw.shortName}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const view = matterViewOf(tab);
  const parts: Record<MatterTab, () => ReactNode> = {
    overview: () => <OverviewPanel payload={payload} />,
    lifecycle: () => <MatterLifecyclePanel mdl={o.mdl} />,
    cases: () => <CasesPanel payload={payload} />,
    parties: () => <PartiesPanel payload={payload} />,
    docket: () => <DocketPanel payload={payload} />,
    documents: () => (
      <>
        {/^[1-9][0-9]{0,5}$/.test(o.mdl) ? (
          <FilingsPanel type="mdl" id={o.mdl} className="mb-6" />
        ) : null}
        <DocumentsPanel
          payload={payload}
          entry={search.entry ?? null}
          onEntry={(n) => onSearch((prev) => withEntry(prev, n))}
          viewKey={search.view ?? null}
          onView={(key) => onSearch((prev) => withView(prev, key))}
        />
      </>
    ),
    evidence: () => <EvidencePanel payload={payload} />,
  };
  return (
    <AppShell
      breadcrumbs={[
        { label: "Home", to: "/" },
        { label: "Matters", to: "/matters" },
        ...(payload.sw.tier ? [{ label: "Seeger Weiss hub", to: "/matters/seeger-weiss" }] : []),
        { label: `MDL ${o.mdl}` },
      ]}
      title={o.title}
      {...(description ? { description } : {})}
    >
      <div className="space-y-4">
        <MatterHeader payload={payload} />
        {/* The border lives on the nav and the scroller is inside it: a negative-margin tab inside an overflow
            container would add a 1px vertical overflow and show a vertical scrollbar on Windows. */}
        <nav aria-label="Matter sections" className="border-b border-border">
          <div className="-mx-1 flex gap-1 overflow-x-auto overflow-y-hidden px-1">
            {MATTER_VIEWS.map((v) => {
              const on = v.id === view.id;
              const first = v.tabs[0];
              return (
                <Link
                  key={v.id}
                  to="/matters/$id"
                  params={{ id: o.mdl }}
                  // The active view keeps the current search; the others reset transient filters.
                  search={on ? true : first === "overview" ? {} : { tab: first }}
                  aria-current={on ? "page" : undefined}
                  className={`whitespace-nowrap border-b-2 px-3 py-2 text-[13px] font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring ${
                    on
                      ? "border-primary text-foreground"
                      : "border-transparent text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {v.label}
                </Link>
              );
            })}
          </div>
        </nav>
        <div role="region" aria-label={view.label} className="space-y-10">
          {[...view.tabs]
            .sort((x, y) => (x === tab ? -1 : y === tab ? 1 : 0))
            .map((t) => (
              <MatterPart
                key={t}
                title={view.tabs.length > 1 ? MATTER_TAB_LABELS[t] : null}
                id={`matter-${t}`}
              >
                {parts[t]()}
              </MatterPart>
            ))}
        </div>
      </div>
    </AppShell>
  );
}

/** One part of a view; a heading only when the view holds more than one part. */
function MatterPart({
  id,
  title,
  children,
}: {
  id: string;
  title: string | null;
  children: ReactNode;
}) {
  return (
    <section id={id} aria-label={title ?? undefined} className="min-w-0 scroll-mt-16 space-y-3">
      {title ? <h2 className="text-heading text-foreground">{title}</h2> : null}
      {children}
    </section>
  );
}
