/**
 * The radar score as stacked points per family (Reports, Severity, Regulator, Litigation): one bar per unit on a
 * shared absolute scale, so a longer bar is a higher score and each coloured part is the points that family added.
 * Totals are recomputed from the components (radarModel.reconcile); colours come from the chart palette slots.
 */
import { cn } from "@/lib/utils";
import { chartTokens, seriesOn, seriesVar } from "@/components/charts/palette";
import {
  FAMILIES,
  FAMILY_LABEL,
  reconcile,
  type RadarComponent,
  type RadarFamily,
} from "./radarModel";

type StackRow = {
  unit_id: string;
  label: string;
  components: readonly RadarComponent[];
  note?: string | undefined;
};

const slot = (f: RadarFamily) => FAMILIES.indexOf(f);

export function familyPoints(components: readonly RadarComponent[]): Record<RadarFamily, number> {
  const out = { A: 0, B: 0, C: 0, D: 0 } as Record<RadarFamily, number>;
  for (const c of components) out[c.family] += c.points;
  return out;
}

export function RadarScoreLegend({ className }: { className?: string | undefined }) {
  return (
    <ul
      className={cn("flex flex-wrap gap-x-4 gap-y-1 text-meta text-muted-foreground", className)}
      style={chartTokens}
    >
      {FAMILIES.map((f) => (
        <li key={f} className="inline-flex items-center gap-1.5">
          <span
            aria-hidden
            className="size-2.5 rounded-sm"
            style={{ background: seriesVar(slot(f)) }}
          />
          {FAMILY_LABEL[f]}
        </li>
      ))}
    </ul>
  );
}

export function RadarScoreStack({
  rows,
  onOpen,
  max,
  ariaLabel,
  labelWidth = 220,
  className,
}: {
  rows: readonly StackRow[];
  onOpen?: ((id: string) => void) | undefined;
  /** Points at the full bar width (default: the largest total shown, at least 6). */
  max?: number | undefined;
  ariaLabel: string;
  labelWidth?: number | undefined;
  className?: string | undefined;
}) {
  const totals = rows.map((r) => reconcile(r).points);
  const top = Math.max(max ?? 0, 6, ...totals);
  if (!rows.length)
    return (
      <p className="text-meta text-muted-foreground" role="status">
        Not recorded: no unit to show.
      </p>
    );
  return (
    <div className={cn("min-w-0", className)} style={chartTokens}>
      <ol
        aria-label={ariaLabel}
        className="grid gap-y-1.5"
        style={{ gridTemplateColumns: `fit-content(${labelWidth}px) minmax(96px,1fr) max-content` }}
      >
        {rows.map((r, i) => {
          const parts = familyPoints(r.components);
          const total = totals[i] ?? 0;
          const desc = `${r.label}: ${total} points (${
            FAMILIES.filter((f) => parts[f] > 0)
              .map((f) => `${FAMILY_LABEL[f]} ${parts[f]}`)
              .join(", ") || "no family scored"
          })`;
          const Label = onOpen ? "button" : "span";
          return (
            <li key={r.unit_id} className="col-span-full grid grid-cols-subgrid items-center">
              <span className="flex min-w-0 flex-col">
                <Label
                  {...(onOpen ? { type: "button" as const, onClick: () => onOpen(r.unit_id) } : {})}
                  className={cn(
                    "min-w-0 truncate text-left text-[13px] font-medium text-foreground",
                    onOpen &&
                      "rounded hover:underline focus-visible:outline-2 focus-visible:outline-ring",
                  )}
                  title={desc}
                  aria-label={onOpen ? `Open ${desc}${r.note ? ` (${r.note})` : ""}` : undefined}
                >
                  {r.label}
                </Label>
                {r.note ? (
                  <span className="truncate text-[11px] text-muted-foreground" title={r.note}>
                    {r.note}
                  </span>
                ) : null}
              </span>
              <div className="flex h-5 min-w-0 overflow-hidden rounded-sm bg-muted/60" aria-hidden>
                {FAMILIES.map((f) =>
                  parts[f] > 0 ? (
                    <span
                      key={f}
                      className="flex h-full items-center justify-center text-[10px] font-semibold tabular-nums"
                      style={{
                        width: `${(100 * parts[f]) / top}%`,
                        background: seriesVar(slot(f)),
                        color: seriesOn(slot(f)),
                      }}
                    >
                      {parts[f]}
                    </span>
                  ) : null,
                )}
              </div>
              <span className="text-meta tabular-nums text-muted-foreground">
                <span className="font-semibold text-foreground">{total}</span> pt
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
