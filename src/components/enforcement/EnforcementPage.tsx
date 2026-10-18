import { FileText, Landmark, ShieldAlert } from "lucide-react";
import { RulemakingActivity } from "@/components/rulemaking/RulemakingActivity";
import { cn } from "@/lib/utils";
import { CpscRecalls } from "./CpscRecalls";
import { EpaEnforcement } from "./EpaEnforcement";

export type EnforcementTab = "epa" | "rulemaking" | "cpsc";
export type EnforcementSearch = { tab?: EnforcementTab; state?: string };

const TABS: { id: EnforcementTab; label: string; Icon: typeof Landmark }[] = [
  { id: "epa", label: "EPA enforcement", Icon: Landmark },
  { id: "rulemaking", label: "Federal rulemaking", Icon: FileText },
  { id: "cpsc", label: "CPSC recalls", Icon: ShieldAlert },
];

/** URL search for /law/enforcement; anything unrecognised is dropped rather than guessed. */
export function normalizeEnforcementSearch(raw: Record<string, unknown>): EnforcementSearch {
  const out: EnforcementSearch = {};
  if (raw["tab"] === "rulemaking" || raw["tab"] === "cpsc") out.tab = raw["tab"];
  if (typeof raw["state"] === "string" && /^[A-Z]{2}$/.test(raw["state"])) out.state = raw["state"];
  return out;
}

export function EnforcementPage({
  search,
  onSearch,
}: {
  search: EnforcementSearch;
  onSearch: (next: EnforcementSearch) => void;
}) {
  const tab = search.tab ?? "epa";
  return (
    <div className="space-y-3">
      <div
        role="tablist"
        aria-label="Enforcement sources"
        className="flex flex-wrap gap-1 rounded-md border border-border bg-surface p-1"
      >
        {TABS.map(({ id, label, Icon }) => (
          <button
            key={id}
            type="button"
            role="tab"
            id={`enforcement-tab-${id}`}
            aria-selected={tab === id}
            aria-controls={`enforcement-panel-${id}`}
            onClick={() =>
              onSearch(id === "epa" ? (search.state ? { state: search.state } : {}) : { tab: id })
            }
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
        id={`enforcement-panel-${tab}`}
        aria-labelledby={`enforcement-tab-${tab}`}
        className="min-w-0"
      >
        {tab === "epa" ? (
          <EpaEnforcement
            state={search.state}
            onState={(state) => onSearch(state ? { state } : {})}
          />
        ) : tab === "rulemaking" ? (
          <RulemakingActivity />
        ) : (
          <CpscRecalls />
        )}
      </div>
    </div>
  );
}
