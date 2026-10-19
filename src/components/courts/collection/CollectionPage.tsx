import { useRef, type KeyboardEvent } from "react";
import { Database, FileText, Layers, Network, Scale, Unlink } from "lucide-react";
import { cn } from "@/lib/utils";
import { CitationsTab } from "./CitationsTab";
import { DisclosuresTab } from "./DisclosuresTab";
import { DocketsTab } from "./DocketsTab";
import { MostCitedTab } from "./MostCitedTab";
import { SchemaTab } from "./SchemaTab";
import { UnmatchedTab } from "./UnmatchedTab";
import {
  COLLECTION_TABS,
  patchSearch,
  tabOf,
  tabSearch,
  type CollectionSearch,
  type CollectionTab,
} from "./collectionSearch";

const TABS: { id: CollectionTab; label: string; Icon: typeof Layers }[] = [
  { id: "dockets", label: "Docket collection", Icon: Layers },
  { id: "citations", label: "Citations", Icon: Network },
  { id: "cited", label: "Most cited", Icon: Scale },
  { id: "unmatched", label: "Unresolved citations", Icon: Unlink },
  { id: "disclosures", label: "Disclosures", Icon: FileText },
  { id: "schema", label: "Data coverage", Icon: Database },
];

export type CollectionNavigate = (next: CollectionSearch, opts?: { replace?: boolean }) => void;

export function CollectionPage({
  search,
  onNavigate,
}: {
  search: CollectionSearch;
  onNavigate: CollectionNavigate;
}) {
  const tab = tabOf(search);
  const refs = useRef(new Map<CollectionTab, HTMLButtonElement>());
  // Filters and sorting replace the history entry; opening a tab pushes one so Back returns to the previous tab.
  // A debounced search commit can land after another control changed the address, so it merges into the latest one.
  const latest = useRef(search);
  latest.current = search;
  const onSearch = (patch: Partial<CollectionSearch>) =>
    onNavigate(patchSearch(latest.current, patch), { replace: true });
  const open = (id: CollectionTab) => onNavigate(tabSearch(id), { replace: false });
  const onKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    const i = COLLECTION_TABS.indexOf(tab);
    const next =
      e.key === "ArrowRight"
        ? COLLECTION_TABS[(i + 1) % COLLECTION_TABS.length]
        : e.key === "ArrowLeft"
          ? COLLECTION_TABS[(i - 1 + COLLECTION_TABS.length) % COLLECTION_TABS.length]
          : e.key === "Home"
            ? COLLECTION_TABS[0]
            : e.key === "End"
              ? COLLECTION_TABS[COLLECTION_TABS.length - 1]
              : undefined;
    if (!next) return;
    e.preventDefault();
    open(next);
    refs.current.get(next)?.focus();
  };
  return (
    <div className="space-y-3">
      <div
        role="tablist"
        aria-label="CourtListener collection views"
        className="flex flex-wrap gap-1 rounded-md border border-border bg-surface p-1"
      >
        {TABS.map(({ id, label, Icon }) => (
          <button
            key={id}
            ref={(el) => {
              if (el) refs.current.set(id, el);
            }}
            type="button"
            role="tab"
            id={`collection-tab-${id}`}
            aria-selected={tab === id}
            aria-controls={`collection-panel-${id}`}
            tabIndex={tab === id ? 0 : -1}
            onClick={() => open(id)}
            onKeyDown={onKey}
            className={cn(
              "flex items-center gap-1.5 rounded px-3 py-1.5 text-xs transition-colors focus-visible:outline-2 focus-visible:outline-ring",
              tab === id
                ? "bg-primary font-semibold text-primary-foreground"
                : "text-muted-foreground hover:bg-muted",
            )}
          >
            <Icon className="size-3.5" aria-hidden />
            {label}
          </button>
        ))}
      </div>
      <div
        role="tabpanel"
        id={`collection-panel-${tab}`}
        aria-labelledby={`collection-tab-${tab}`}
        className="min-w-0"
      >
        {tab === "dockets" ? (
          <DocketsTab search={search} onSearch={onSearch} />
        ) : tab === "citations" ? (
          <CitationsTab search={search} onSearch={onSearch} />
        ) : tab === "cited" ? (
          <MostCitedTab search={search} onSearch={onSearch} />
        ) : tab === "unmatched" ? (
          <UnmatchedTab search={search} onSearch={onSearch} />
        ) : tab === "disclosures" ? (
          <DisclosuresTab search={search} onSearch={onSearch} />
        ) : (
          <SchemaTab search={search} onSearch={onSearch} />
        )}
      </div>
    </div>
  );
}
