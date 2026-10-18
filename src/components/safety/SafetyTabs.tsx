import type { ReactNode } from "react";
import { Activity, ShieldAlert, Stethoscope, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import type { SafetyView } from "./safetyView";

type TabDef = { id: SafetyView; label: string; short: string; Icon: LucideIcon };

const LANDING: TabDef[] = [
  { id: "overview", label: "Safety overview", short: "Overview", Icon: ShieldAlert },
  {
    id: "reports",
    label: "Consumer reports (SaferProducts.gov)",
    short: "Consumer reports",
    Icon: Activity,
  },
  { id: "neiss", label: "NEISS injury estimates", short: "NEISS estimates", Icon: Stethoscope },
];

const SIGNALS: TabDef[] = [
  { id: "overview", label: "Mass-tort signals", short: "Mass-tort", Icon: ShieldAlert },
  { id: "reports", label: "Consumer-report growth", short: "Consumer reports", Icon: Activity },
  { id: "neiss", label: "NEISS product signals", short: "NEISS", Icon: Stethoscope },
];

/** The panel a tab controls; carries the ids the tab strip points at. */
export function SafetyTabPanel({
  mode,
  active,
  className,
  children,
}: {
  mode: "landing" | "signals";
  active: SafetyView;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      role="tabpanel"
      id={`safety-${mode}-panel`}
      aria-labelledby={`safety-${mode}-tab-${active}`}
      className={cn("min-w-0", className)}
    >
      {children}
    </div>
  );
}

/**
 * Tab strip shared by /safety and /safety/signals. The tab is URL state (`?view=`) so back/forward and links work;
 * the caller owns navigation through `onSelect`.
 */
export function SafetyTabs({
  mode,
  active,
  onSelect,
}: {
  mode: "landing" | "signals";
  active: SafetyView;
  onSelect: (view: SafetyView) => void;
}) {
  const tabs = mode === "landing" ? LANDING : SIGNALS;
  return (
    <div
      role="tablist"
      aria-label={mode === "landing" ? "Product safety views" : "Product signal views"}
      className="flex flex-wrap gap-1 rounded-md border border-border bg-surface p-1"
    >
      {tabs.map(({ id, label, short, Icon }) => (
        <button
          key={id}
          type="button"
          role="tab"
          id={`safety-${mode}-tab-${id}`}
          aria-selected={active === id}
          aria-controls={`safety-${mode}-panel`}
          onClick={() => onSelect(id)}
          className={cn(
            "flex items-center gap-1.5 rounded px-3 py-1.5 text-xs transition-colors focus-visible:outline-2 focus-visible:outline-ring",
            active === id
              ? "bg-primary font-semibold text-primary-foreground"
              : "text-muted-foreground hover:bg-muted",
          )}
        >
          <Icon className="size-3.5" aria-hidden />
          <span className="hidden md:inline">{label}</span>
          <span className="md:hidden">{short}</span>
        </button>
      ))}
    </div>
  );
}
