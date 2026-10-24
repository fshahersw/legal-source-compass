/**
 * Two values per row (for example cases filed and terminated per district) as a dumbbell: a dot for each value joined
 * by a connector, every row on one shared scale that starts at zero. The value text at the right gives both numbers
 * and the gap (in a container narrower than 520 px only the gap, when a gap label is set; both values stay in the
 * tooltip). A value not recorded is not drawn and reads "Not recorded"; the other dot still shows. Adapted from the
 * owner-supplied dumbbell-range reference to our tokens (the two values take palette slots 1 and 2).
 */
import { useMemo } from "react";
import { cn } from "@/lib/utils";
import { chartTokens } from "../palette";
import { NOT_RECORDED } from "../format";
import { SeriesLegend } from "../recharts/content";
import {
  dumbbellLayout,
  dumbbellScale,
  sortDumbbell,
  type DumbbellRow,
  type DumbbellSort,
} from "./dumbbell";
import { useHoverTip } from "./parts";

export type DumbbellRangeProps = {
  rows: readonly DumbbellRow[];
  /** Name of the first and second value ("Filed", "Terminated"). */
  aLabel: string;
  bLabel: string;
  /** Full value text ("1,204"). */
  format: (v: number) => string;
  /** Axis tick text (default: the full text). */
  tickFormat?: ((v: number) => string) | undefined;
  /** Name of the gap in the tooltip and value text ("Net change"); when set, `b − a` is written for each row. */
  gapLabel?: string | undefined;
  sort?: DumbbellSort | undefined;
  maxValue?: number | undefined;
  /** Widest the name column grows, in px (default 140); it shrinks to the longest name. */
  labelWidth?: number | undefined;
  ariaLabel: string;
  className?: string | undefined;
};

const ROW_H = 30;

export function DumbbellRange({
  rows,
  aLabel,
  bLabel,
  format,
  tickFormat,
  gapLabel,
  sort = "given",
  maxValue,
  labelWidth = 140,
  ariaLabel,
  className,
}: DumbbellRangeProps) {
  const ordered = useMemo(() => sortDumbbell(rows, sort), [rows, sort]);
  const { max, ticks } = useMemo(() => dumbbellScale(rows, maxValue), [rows, maxValue]);
  const tip = useHoverTip();
  const tick = tickFormat ?? format;
  // One grid for every row (rows are subgrids), so the value column is as wide as the longest text and every row
  // shares the same track: the dots sit on one scale.
  const cols = `fit-content(${labelWidth}px) minmax(72px,1fr) max-content`;
  if (!ordered.length)
    return (
      <p className={cn("text-meta text-muted-foreground", className)} role="status">
        {NOT_RECORDED}: no rows to compare.
      </p>
    );
  const signed = (g: number) => (g > 0 ? `+${format(g)}` : g < 0 ? `−${format(-g)}` : format(0));
  return (
    <div className={cn("@container min-w-0", className)} style={chartTokens}>
      <SeriesLegend
        className="pb-2"
        mark="swatch"
        items={[
          { id: "a", label: aLabel, color: "var(--chart-1)" },
          { id: "b", label: bLabel, color: "var(--chart-2)" },
        ]}
      />
      <div ref={tip.ref} className="relative overflow-x-auto">
        <div
          role="group"
          aria-label={ariaLabel}
          className="grid gap-x-3"
          style={{ gridTemplateColumns: cols }}
        >
          {ordered.map((row) => {
            const L = dumbbellLayout(row, max);
            const text = `${row.label}: ${aLabel} ${row.a == null ? NOT_RECORDED : format(row.a)}, ${bLabel} ${row.b == null ? NOT_RECORDED : format(row.b)}${L.gap !== null && gapLabel ? `, ${gapLabel.toLowerCase()} ${signed(L.gap)}` : ""}.`;
            return (
              <div
                key={row.id}
                role="img"
                aria-label={text}
                className="col-span-full grid grid-cols-subgrid items-center border-b border-border/50 motion-safe:animate-in motion-safe:fade-in"
                style={{ height: ROW_H }}
                {...tip.bind({
                  title: row.label,
                  rows: [
                    {
                      key: "a",
                      label: aLabel,
                      value: row.a == null ? NOT_RECORDED : format(row.a),
                      color: "var(--chart-1)",
                    },
                    {
                      key: "b",
                      label: bLabel,
                      value: row.b == null ? NOT_RECORDED : format(row.b),
                      color: "var(--chart-2)",
                    },
                  ],
                  footer: L.gap !== null && gapLabel ? `${gapLabel} ${signed(L.gap)}` : row.note,
                })}
              >
                <p
                  className={cn(
                    "m-0 truncate text-[13px]",
                    row.highlight ? "font-semibold text-foreground" : "text-muted-foreground",
                  )}
                  title={row.label}
                >
                  {row.label}
                </p>
                <div className="relative h-full" aria-hidden>
                  {ticks.map((t) => (
                    <span
                      key={t}
                      className={cn(
                        "absolute inset-y-0 w-px",
                        t === 0 ? "bg-border-strong" : "bg-border/60",
                      )}
                      style={{ left: `${(t / max) * 100}%` }}
                    />
                  ))}
                  {L.connector ? (
                    <span
                      className="absolute top-1/2 h-[5px] -translate-y-1/2 rounded-full"
                      style={{
                        left: `${L.connector.left}%`,
                        width: `${L.connector.width}%`,
                        background: row.highlight
                          ? "color-mix(in srgb, var(--chart-ink) 55%, var(--chart-surface))"
                          : "color-mix(in srgb, var(--chart-ink) 22%, var(--chart-surface))",
                      }}
                    />
                  ) : null}
                  {L.a !== null ? (
                    <span
                      className="absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full"
                      style={{
                        left: `${L.a}%`,
                        background: "var(--chart-1)",
                        boxShadow: "0 0 0 2px var(--chart-surface)",
                      }}
                    />
                  ) : null}
                  {L.b !== null ? (
                    <span
                      className="absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full"
                      style={{
                        left: `${L.b}%`,
                        background: "var(--chart-2)",
                        boxShadow: "0 0 0 2px var(--chart-surface)",
                      }}
                    />
                  ) : null}
                </div>
                <p
                  className="m-0 text-right text-[13px] tabular-nums text-muted-foreground"
                  aria-hidden
                >
                  <span className={gapLabel ? "hidden @[520px]:inline" : undefined}>
                    {row.a == null ? NOT_RECORDED : format(row.a)}{" "}
                    <span className="text-border-strong">/</span>{" "}
                    <b className="font-semibold text-foreground">
                      {row.b == null ? NOT_RECORDED : format(row.b)}
                    </b>
                  </span>
                  {L.gap !== null && gapLabel ? (
                    <span className="text-meta @[520px]:ml-1.5">{signed(L.gap)}</span>
                  ) : null}
                </p>
              </div>
            );
          })}
          <div className="col-span-full grid grid-cols-subgrid items-start pt-1" aria-hidden>
            <span />
            <div className="relative h-4">
              {ticks.map((t) => (
                <span
                  key={t}
                  className="absolute -translate-x-1/2 text-[12px] tabular-nums text-muted-foreground"
                  style={{ left: `${(t / max) * 100}%`, ...(t === 0 ? { transform: "none" } : {}) }}
                >
                  {tick(t)}
                </span>
              ))}
            </div>
            <span />
          </div>
          {gapLabel ? (
            <p
              className="col-span-full m-0 pt-1 text-right text-meta text-muted-foreground"
              aria-hidden
            >
              Right: {gapLabel.charAt(0).toLowerCase() + gapLabel.slice(1)}
            </p>
          ) : null}
        </div>
        {tip.node}
      </div>
    </div>
  );
}
