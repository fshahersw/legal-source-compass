/**
 * A comparison matrix: rows grouped by theme with the group written vertically, one column per entity, one column
 * highlighted (the entity the page is about). The leading value of a row is bold on a plate when the row says what
 * leads (highest or lowest; the note reads "bold = highest"); hovering a cell dims the other rows and tints its column. A value not recorded is "—"
 * (read as "Not recorded"), never zero. Adapted from the owner-supplied bench-matrix reference to our tokens.
 */
import { useState } from "react";
import { cn } from "@/lib/utils";
import { chartTokens } from "../palette";
import { defaultBenchFormat, leaderIndices, type BenchColumn, type BenchGroup } from "./bench";

export type BenchMatrixProps = {
  columns: readonly BenchColumn[];
  groups: readonly BenchGroup[];
  /** Heading of the measure column (default "Measure"). */
  measureLabel?: string | undefined;
  ariaLabel: string;
  className?: string | undefined;
};

const HERO_TINT = "color-mix(in srgb, var(--chart-1) 9%, transparent)";
const HOVER_TINT = "color-mix(in srgb, var(--chart-ink) 6%, transparent)";

export function BenchMatrix({
  columns,
  groups,
  measureLabel = "Measure",
  ariaLabel,
  className,
}: BenchMatrixProps) {
  const [hover, setHover] = useState<{ row: string; col: number } | null>(null);
  const hasLead = groups.some((g) => g.rows.some((r) => (r.lead ?? "none") !== "none"));
  if (!columns.length || !groups.some((g) => g.rows.length))
    return (
      <p className={cn("text-meta text-muted-foreground", className)} role="status">
        Not recorded: nothing to compare.
      </p>
    );
  return (
    <div className={cn("min-w-0", className)} style={chartTokens}>
      <div className="overflow-x-auto rounded-lg border border-border">
        <table
          aria-label={ariaLabel}
          className="w-full border-collapse text-[14px]"
          onPointerLeave={() => setHover(null)}
        >
          <thead>
            <tr className="border-b border-border">
              <th
                colSpan={2}
                scope="col"
                className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground"
              >
                {measureLabel}
              </th>
              {columns.map((c, ci) => (
                <th
                  key={c.id}
                  scope="col"
                  className="px-3 py-2.5 text-center align-bottom"
                  style={{
                    background: c.hero ? HERO_TINT : hover?.col === ci ? HOVER_TINT : undefined,
                    boxShadow: c.hero ? "inset 0 2px 0 var(--chart-1)" : undefined,
                  }}
                >
                  <span
                    className={cn(
                      "block text-[13px] text-foreground",
                      c.hero ? "font-bold" : "font-semibold",
                    )}
                  >
                    {c.label}
                  </span>
                  {c.sub ? (
                    <span className="block text-[11px] font-normal text-muted-foreground">
                      {c.sub}
                    </span>
                  ) : null}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {groups.map((g, gi) =>
              g.rows.map((row, ri) => {
                const key = `${gi}-${ri}`;
                const lead = leaderIndices(row.values, row.lead ?? "none");
                const fmt = row.format ?? defaultBenchFormat;
                const dim = hover !== null && hover.row !== key;
                return (
                  <tr
                    key={key}
                    className={cn(
                      "border-border/70 motion-safe:transition-opacity",
                      ri === g.rows.length - 1 && gi < groups.length - 1
                        ? "border-b"
                        : "border-b border-b-border/40 last:border-b-0",
                      dim && "opacity-45",
                    )}
                  >
                    {ri === 0 ? (
                      <th
                        rowSpan={g.rows.length}
                        scope="rowgroup"
                        className="w-8 border-r border-border/60 px-1 py-2 text-center align-middle"
                      >
                        <span className="inline-block rotate-180 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground [writing-mode:vertical-rl]">
                          {g.label}
                        </span>
                      </th>
                    ) : null}
                    <th scope="row" className="px-3 py-2 text-left font-normal">
                      <span className="block text-[13.5px] font-semibold text-foreground">
                        {row.label}
                      </span>
                      {row.note || (row.lead && row.lead !== "none") ? (
                        <span className="block text-[11.5px] text-muted-foreground">
                          {[row.note, row.lead && row.lead !== "none" ? `bold = ${row.lead}` : null]
                            .filter(Boolean)
                            .join(" · ")}
                        </span>
                      ) : null}
                    </th>
                    {columns.map((c, ci) => {
                      const v = row.values[ci];
                      const recorded = typeof v === "number" && Number.isFinite(v);
                      const leads = lead.includes(ci);
                      return (
                        <td
                          key={c.id}
                          className="px-3 py-2 text-center tabular-nums"
                          style={{
                            background: c.hero
                              ? HERO_TINT
                              : hover?.col === ci
                                ? HOVER_TINT
                                : undefined,
                          }}
                          onPointerEnter={() => setHover({ row: key, col: ci })}
                        >
                          {recorded ? (
                            <span
                              className={cn(
                                "inline-block min-w-[3ch] rounded px-1.5 py-0.5",
                                leads ? "bg-muted font-bold text-foreground" : "text-foreground/90",
                              )}
                            >
                              {fmt(v)}
                            </span>
                          ) : (
                            <span className="text-muted-foreground">
                              <span aria-hidden>—</span>
                              <span className="sr-only">Not recorded</span>
                            </span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                );
              }),
            )}
          </tbody>
        </table>
      </div>
      <p className="m-0 pt-1.5 text-meta text-muted-foreground">
        {hasLead ? "Bold: the highest or lowest value, as each row says. " : ""}— Not recorded.
      </p>
    </div>
  );
}
