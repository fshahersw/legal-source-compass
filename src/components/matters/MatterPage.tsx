import { Link } from "@tanstack/react-router";

import { AppShell } from "@/components/atlas/AppShell";
import { CasesPanel } from "@/components/matters/CasesPanel";
import { DocketPanel } from "@/components/matters/DocketPanel";
import { DocumentsPanel } from "@/components/matters/DocumentsPanel";
import { EvidencePanel } from "@/components/matters/EvidencePanel";
import { MatterHeader } from "@/components/matters/MatterHeader";
import { OverviewPanel } from "@/components/matters/OverviewPanel";
import { PartiesPanel } from "@/components/matters/PartiesPanel";
import {
  MATTER_TABS,
  MATTER_TAB_LABELS,
  withEntry,
  withView,
  type MatterSearch,
  type MatterTab,
} from "@/lib/matters/search";
import type { MatterOverviewPayload } from "@/lib/matters/types";

/** One matter: header, then tabs for cases, docket, documents, parties and evidence. */
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
  return (
    <AppShell
      breadcrumbs={[
        { label: "Atlas", to: "/" },
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
            {MATTER_TABS.map((t) => (
              <Link
                key={t}
                to="/matters/$id"
                params={{ id: o.mdl }}
                // The active tab keeps the current search (so it is "exactly active"); the others reset transient filters.
                search={tab === t ? true : t === "overview" ? {} : { tab: t }}
                activeOptions={{ exact: true, includeSearch: true }}
                className={`whitespace-nowrap border-b-2 px-3 py-2 text-[13px] font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring ${
                  tab === t
                    ? "border-primary text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
              >
                {MATTER_TAB_LABELS[t]}
              </Link>
            ))}
          </div>
        </nav>
        <div role="region" aria-label={MATTER_TAB_LABELS[tab]}>
          {tab === "overview" ? <OverviewPanel payload={payload} /> : null}
          {tab === "cases" ? <CasesPanel payload={payload} /> : null}
          {tab === "docket" ? <DocketPanel payload={payload} /> : null}
          {tab === "documents" ? (
            <DocumentsPanel
              payload={payload}
              entry={search.entry ?? null}
              onEntry={(n) => onSearch((prev) => withEntry(prev, n))}
              viewKey={search.view ?? null}
              onView={(key) => onSearch((prev) => withView(prev, key))}
            />
          ) : null}
          {tab === "parties" ? <PartiesPanel payload={payload} /> : null}
          {tab === "evidence" ? <EvidencePanel payload={payload} /> : null}
        </div>
      </div>
    </AppShell>
  );
}
