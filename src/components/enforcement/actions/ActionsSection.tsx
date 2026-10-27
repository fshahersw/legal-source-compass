import { BadgeDollarSign } from "lucide-react";
import { HubTrend, TrendGrid } from "@/components/trends/ProfileTrend";
import { cn } from "@/lib/utils";
import { ACTION_VIEWS, type ActionsView } from "./actionsView";
import { DojCoverageNote, DojReleases } from "./DojReleases";
import { DojHealthSection } from "./DojHealthSection";
import { FtcActions } from "./FtcActions";
import { OfficialSettlements } from "./OfficialSettlements";
import { SecActions } from "./SecActions";
import { FrbActions } from "../regulatory/FrbActions";

export function ActionsNav({
  view,
  onView,
}: {
  view: ActionsView | undefined;
  onView: (v: ActionsView | undefined) => void;
}) {
  const current = view ?? "agency";
  return (
    <nav aria-label="Enforcement sections" className="flex flex-wrap items-center gap-1">
      {ACTION_VIEWS.map(({ id, label, Icon }) => (
        <button
          key={id}
          type="button"
          aria-current={current === id ? "page" : undefined}
          onClick={() => onView(id === "agency" ? undefined : id)}
          className={cn(
            "flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs transition-colors focus-visible:outline-2 focus-visible:outline-ring",
            current === id
              ? "border-primary bg-primary/10 font-semibold text-foreground"
              : "border-border text-muted-foreground hover:bg-muted",
          )}
        >
          <Icon className="size-3.5" aria-hidden />
          {label}
        </button>
      ))}
      <span className="ml-auto hidden items-center gap-1 text-[11px] text-muted-foreground lg:flex">
        <BadgeDollarSign className="size-3.5" aria-hidden />
        Figures are as stated by the publisher, never summed across releases
      </span>
    </nav>
  );
}

/** The Analytics series that count each source's own published items, shown above its listing. */
const ACTION_TREND_BLOCKS: Partial<Record<ActionsView, readonly string[]>> = {
  doj: ["doj-press", "doj-divisions", "doj-amounts"],
  ftc: ["ftc-actions"],
  sec: ["sec-releases", "sec-amounts"],
};

export function ActionsPanel({ view }: { view: ActionsView }) {
  const trends = ACTION_TREND_BLOCKS[view] ?? [];
  return (
    <div className="min-w-0 space-y-3">
      {view === "doj" ? (
        <>
          <DojHealthSection />
          <DojCoverageNote />
        </>
      ) : null}
      {trends.length ? (
        <TrendGrid>
          {trends.map((id) => (
            <HubTrend key={id} id={id} />
          ))}
        </TrendGrid>
      ) : null}
      {view === "doj" ? (
        <DojReleases />
      ) : view === "ftc" ? (
        <FtcActions />
      ) : view === "sec" ? (
        <SecActions />
      ) : view === "frb" ? (
        <FrbActions />
      ) : (
        <OfficialSettlements />
      )}
    </div>
  );
}
