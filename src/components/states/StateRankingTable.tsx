import { useState } from "react";
import { ArrowDown, ArrowUp } from "lucide-react";
import { StateMark } from "@/components/corpus/EntityArtwork";
import type { MetricDef, StateProfile } from "@/lib/external/stateMetrics.functions";
import { cn } from "@/lib/utils";
import { formatChange, formatValue, type RankedValue } from "./stateMetricsMath";

type SortKey = "rank" | "name" | "z" | "change5";

/** Sortable ranking of every jurisdiction for one metric-year; unreported states are listed last. */
export function StateRankingTable({
  def,
  year,
  ranked,
  states,
  selected,
  onSelect,
}: {
  def: MetricDef;
  year: number;
  ranked: RankedValue[];
  states: StateProfile[];
  selected: string | null;
  onSelect: (usps: string) => void;
}) {
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: "rank", desc: false });
  const missing = states.filter((s) => !ranked.some((r) => r.usps === s.usps));
  const rows = [...ranked].sort((a, b) => {
    const dir = sort.desc ? -1 : 1;
    if (sort.key === "name") return a.name.localeCompare(b.name) * dir;
    const av = a[sort.key],
      bv = b[sort.key];
    if (av == null && bv == null) return a.rank - b.rank;
    if (av == null) return 1;
    if (bv == null) return -1;
    return (av - bv) * dir || a.rank - b.rank;
  });
  const header = (key: SortKey, label: string, className = "") => (
    <th scope="col" className={cn("px-2 py-1.5 font-medium", className)}>
      <button
        type="button"
        onClick={() =>
          setSort((s) => ({
            key,
            desc: s.key === key ? !s.desc : key === "change5" || key === "z",
          }))
        }
        className="inline-flex items-center gap-0.5 hover:text-foreground"
        aria-label={`Sort by ${label}`}
      >
        {label}
        {sort.key === key ? (
          sort.desc ? (
            <ArrowDown className="size-3" aria-hidden />
          ) : (
            <ArrowUp className="size-3" aria-hidden />
          )
        ) : null}
      </button>
    </th>
  );
  const noteFor = (s: StateProfile) =>
    s.notes[def.key]?.[String(year)] ??
    s.notes[def.key.replace(/_rate$/, "_deaths")]?.[String(year)] ??
    null;
  const byUsps = new Map(states.map((s) => [s.usps, s]));
  return (
    <div className="max-h-[460px] overflow-auto">
      <table className="w-full table-fixed text-xs">
        <colgroup>
          <col className="w-8" />
          <col />
          <col className="w-[4.5rem]" />
          <col className="w-11" />
          <col className="w-16" />
        </colgroup>
        <thead className="sticky top-0 z-10 bg-surface text-left text-[11px] text-muted-foreground shadow-[0_1px_0_var(--border)]">
          <tr>
            {header("rank", "#")}
            {header("name", "State")}
            <th
              scope="col"
              className="truncate px-2 py-1.5 text-right font-medium"
              title={def.unit}
            >
              {def.unit}
            </th>
            {header("z", "z", "text-right")}
            {header("change5", "5-yr Δ", "text-right")}
          </tr>
        </thead>
        <tbody className="divide-y divide-border/60">
          {rows.map((r) => {
            const note = noteFor(byUsps.get(r.usps)!);
            return (
              <tr
                key={r.usps}
                onClick={() => onSelect(r.usps)}
                className={cn(
                  "cursor-pointer hover:bg-muted/50",
                  selected === r.usps && "bg-primary/10",
                )}
              >
                <td className="px-2 py-1 font-mono text-muted-foreground">{r.rank}</td>
                <td className="px-2 py-1">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onSelect(r.usps);
                    }}
                    aria-pressed={selected === r.usps}
                    className="flex min-w-0 max-w-full items-center gap-1.5 text-left font-medium hover:underline"
                  >
                    <StateMark state={r.usps} className="size-6 rounded-md p-0.5" />
                    <span className="truncate">{r.name}</span>
                    {r.outlier ? (
                      <span
                        className="shrink-0 rounded border border-warning/50 bg-warning/15 px-1 text-[10px] font-normal text-warning-foreground"
                        title={`z = ${r.z}: more than 2 standard deviations ${r.outlier === "high" ? "above" : "below"} the state mean`}
                      >
                        {r.outlier === "high" ? "High" : "Low"}
                      </span>
                    ) : null}
                  </button>
                </td>
                <td className="px-2 py-1 text-right font-mono">
                  {formatValue(r.value, def.format)}
                  {note ? (
                    <span className="ml-0.5 text-warning" title={note}>
                      *
                    </span>
                  ) : null}
                </td>
                <td className="px-2 py-1 text-right font-mono text-muted-foreground">
                  {r.z == null ? "—" : r.z.toFixed(2)}
                </td>
                <td className="px-2 py-1 text-right font-mono text-muted-foreground">
                  {r.change5 == null ? "—" : formatChange(r.change5)}
                </td>
              </tr>
            );
          })}
          {missing.map((s) => (
            <tr key={s.usps} className="text-muted-foreground">
              <td className="px-2 py-1">—</td>
              <td className="px-2 py-1">
                <span className="flex items-center gap-1.5">
                  <StateMark state={s.usps} className="size-6 rounded-md p-0.5" flag={false} />
                  {s.name}
                </span>
              </td>
              <td className="px-2 py-1 text-right" colSpan={3}>
                Not recorded
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
