import { useRef, type KeyboardEvent } from "react";
import { Banknote, ClipboardCheck, Landmark, Layers, Scale, Table2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { BankruptcyTab } from "./BankruptcyTab";
import { DistrictsTab } from "./DistrictsTab";
import { MdlTab } from "./MdlTab";
import { MethodTab } from "./MethodTab";
import { NosTab } from "./NosTab";
import { SeriesExplorer } from "./SeriesExplorer";
import {
  CASELOAD_TABS,
  patchSearch,
  tabSearch,
  type CaseloadSearch,
  type CaseloadTab,
} from "./caseloadSearch";

const TABS: { id: CaseloadTab; label: string; Icon: typeof Landmark }[] = [
  { id: "districts", label: "Districts", Icon: Landmark },
  { id: "nos", label: "Nature of suit", Icon: Scale },
  { id: "mdl", label: "MDL association", Icon: Layers },
  { id: "tables", label: "Published tables", Icon: Table2 },
  { id: "bankruptcy", label: "Bankruptcy filings", Icon: Banknote },
  { id: "method", label: "Method and checks", Icon: ClipboardCheck },
];

export type CaseloadNavigate = (next: CaseloadSearch, opts?: { replace?: boolean }) => void;

export function CaseloadPage({
  search,
  onNavigate,
}: {
  search: CaseloadSearch;
  onNavigate: CaseloadNavigate;
}) {
  const tab = search.tab ?? "districts";
  const refs = useRef(new Map<CaseloadTab, HTMLButtonElement>());
  // Filters and sorting replace the history entry; opening a tab pushes one so Back returns to the previous tab.
  const onSearch = (patch: Partial<CaseloadSearch>) =>
    onNavigate(patchSearch(search, patch), { replace: true });
  const open = (id: CaseloadTab) => onNavigate(tabSearch(id), { replace: false });
  const onKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    const i = CASELOAD_TABS.indexOf(tab);
    const next =
      e.key === "ArrowRight"
        ? CASELOAD_TABS[(i + 1) % CASELOAD_TABS.length]
        : e.key === "ArrowLeft"
          ? CASELOAD_TABS[(i - 1 + CASELOAD_TABS.length) % CASELOAD_TABS.length]
          : e.key === "Home"
            ? CASELOAD_TABS[0]
            : e.key === "End"
              ? CASELOAD_TABS[CASELOAD_TABS.length - 1]
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
        aria-label="Caseload views"
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
            id={`caseload-tab-${id}`}
            aria-selected={tab === id}
            aria-controls={`caseload-panel-${id}`}
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
        id={`caseload-panel-${tab}`}
        aria-labelledby={`caseload-tab-${tab}`}
        className="min-w-0"
      >
        {tab === "districts" ? (
          <DistrictsTab search={search} onSearch={onSearch} />
        ) : tab === "nos" ? (
          <NosTab search={search} onSearch={onSearch} />
        ) : tab === "mdl" ? (
          <MdlTab search={search} onSearch={onSearch} />
        ) : tab === "tables" ? (
          <SeriesExplorer search={search} onSearch={onSearch} />
        ) : tab === "bankruptcy" ? (
          <BankruptcyTab search={search} onSearch={onSearch} />
        ) : (
          <MethodTab />
        )}
      </div>
    </div>
  );
}
