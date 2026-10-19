import { Fragment, useMemo, useState } from "react";
import type { Test } from "@/lib/external/placeAnalysisParse";
import { cn } from "@/lib/utils";
import { METRIC_BY_KEY, pText, signed } from "./placeMetrics";

/** Short column labels for the demographic measures the builder tests (keys from build_state_analysis.DEMO). */
const DEMO_SHORT: Record<string, string> = {
  median_hh_income: "Income",
  per_capita_personal_income: "Pers. income",
  poverty_rate: "Poverty",
  pct_bachelors: "Bachelor's+",
  pct_uninsured: "Uninsured",
  unemployment_rate: "Jobless",
  median_age: "Median age",
  pct_65plus: "65+",
  pct_hispanic: "Hispanic",
  pct_black_nh: "Black",
  pct_white_nh: "White",
  pct_foreign_born: "Foreign",
  density: "Density",
  owner_occupied: "Owners",
};

function cellStyle(rho: number | null, holds: boolean) {
  if (rho == null) return {};
  const pct = Math.round(Math.min(1, Math.abs(rho)) * (holds ? 85 : 35));
  const color = rho >= 0 ? "var(--map-high)" : "var(--warning)";
  return { background: `color-mix(in srgb,${color} ${pct}%,var(--surface))` };
}

/**
 * Legal measures (rows) by demographic measures (columns): Spearman rho per cell, strong colour only where the
 * association holds after Benjamini-Hochberg adjustment; untested cells (fewer than 10 pairs) are blank.
 */
export function AssociationGrid({ tests, unit }: { tests: Test[]; unit: "counties" | "states" }) {
  const [focus, setFocus] = useState<Test | null>(null);
  const rows = useMemo(() => [...new Set(tests.map((t) => t.x))], [tests]);
  const cols = useMemo(() => [...new Set(tests.map((t) => t.y))], [tests]);
  const byKey = useMemo(() => new Map(tests.map((t) => [`${t.x}|${t.y}`, t])), [tests]);
  if (!tests.length)
    return <p className="px-3 py-4 text-xs text-muted-foreground">No associations were tested.</p>;
  return (
    <div className="space-y-2">
      <div className="overflow-x-auto">
        <div
          className="grid min-w-[44rem] gap-px text-[11px]"
          style={{
            gridTemplateColumns: `minmax(9rem,12rem) repeat(${cols.length}, minmax(2.6rem,1fr))`,
          }}
          role="table"
          aria-label={`Spearman associations across ${unit}`}
        >
          <div role="columnheader" />
          {cols.map((c) => (
            <div
              key={c}
              role="columnheader"
              className="truncate px-0.5 pb-1 text-center text-[10px] text-muted-foreground"
              title={METRIC_BY_KEY.get(c)?.label ?? c}
            >
              {DEMO_SHORT[c] ?? c}
            </div>
          ))}
          {rows.map((r) => (
            <Fragment key={r}>
              <div
                role="rowheader"
                className="truncate py-1 pr-2 text-[11px] font-medium"
                title={METRIC_BY_KEY.get(r)?.label ?? r}
              >
                {METRIC_BY_KEY.get(r)?.short ?? r}
              </div>
              {cols.map((c) => {
                const t = byKey.get(`${r}|${c}`);
                const tested = t && t.rho != null;
                return (
                  <button
                    key={c}
                    type="button"
                    role="cell"
                    onClick={() => t && setFocus(t)}
                    onFocus={() => t && setFocus(t)}
                    className={cn(
                      "h-7 rounded-sm border text-center font-mono text-[10px] tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      t?.holds
                        ? "border-foreground/50 font-semibold"
                        : "border-border/60 text-muted-foreground",
                    )}
                    style={cellStyle(t?.rho ?? null, !!t?.holds)}
                    aria-label={
                      tested
                        ? `${METRIC_BY_KEY.get(r)?.short ?? r} and ${METRIC_BY_KEY.get(c)?.short ?? c}: rho ${signed(t!.rho!)}${t!.holds ? ", holds" : ", does not hold"}`
                        : `${METRIC_BY_KEY.get(r)?.short ?? r} and ${METRIC_BY_KEY.get(c)?.short ?? c}: not tested`
                    }
                  >
                    {tested ? signed(t!.rho!).replace(/^([+−])0/, "$1") : "·"}
                  </button>
                );
              })}
            </Fragment>
          ))}
        </div>
      </div>
      <div
        className="min-h-9 rounded border border-border/70 bg-muted/30 px-2 py-1.5 text-[11.5px]"
        aria-live="polite"
      >
        {focus ? (
          focus.rho == null ? (
            <span className="text-muted-foreground">
              {METRIC_BY_KEY.get(focus.x)?.label} and {focus.label}: not tested (only {focus.n}{" "}
              {unit} with both values; 10 needed).
            </span>
          ) : (
            <span>
              <span className="font-medium">{METRIC_BY_KEY.get(focus.x)?.label}</span> and{" "}
              <span className="font-medium">{focus.label}</span>: rho {signed(focus.rho)} (
              {focus.strength ?? ""})
              {focus.ci ? `, 95% interval ${signed(focus.ci[0])} to ${signed(focus.ci[1])}` : ""},
              adjusted p {pText(focus.pBh)}, n {focus.n} {unit}.{" "}
              <span className={focus.holds ? "font-medium" : "text-muted-foreground"}>
                {focus.holds
                  ? "Holds after Benjamini-Hochberg adjustment."
                  : "Does not hold after adjustment."}
              </span>
            </span>
          )
        ) : (
          <span className="text-muted-foreground">
            Select a cell for its interval and adjusted p. Outlined cells hold (adjusted p &lt;
            0.05); blue cells rise together, amber cells move in opposite directions; dots were not
            tested (fewer than 10 {unit} with both values).
          </span>
        )}
      </div>
    </div>
  );
}

/** Associations that hold, strongest first, as sentences with their statistics. */
export function HoldingList({
  tests,
  unit,
  limit = 12,
}: {
  tests: Test[];
  unit: string;
  limit?: number;
}) {
  const held = tests
    .filter((t) => t.holds && t.rho != null)
    .sort((a, b) => Math.abs(b.rho!) - Math.abs(a.rho!));
  if (!held.length)
    return (
      <p className="m-0 text-xs text-muted-foreground">
        None of the associations tested holds after adjustment.
      </p>
    );
  return (
    <ul className="m-0 list-none space-y-1 p-0 text-[12px]">
      {held.slice(0, limit).map((t) => (
        <li key={`${t.x}|${t.y}`} className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
          <span>
            {METRIC_BY_KEY.get(t.x)?.short ?? t.x} and {METRIC_BY_KEY.get(t.y)?.short ?? t.label}:{" "}
            <span className="text-muted-foreground">
              {t.rho! > 0 ? "rise together" : "move in opposite directions"}
            </span>
          </span>
          <span className="text-right font-mono text-[11px] tabular-nums text-muted-foreground">
            {signed(t.rho!)} · adj. p {pText(t.pBh)} · n {t.n} {unit}
          </span>
        </li>
      ))}
      {held.length > limit ? (
        <li className="text-[11px] text-muted-foreground">
          and {held.length - limit} more in the grid
        </li>
      ) : null}
    </ul>
  );
}
