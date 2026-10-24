/**
 * A 100%-normalised stacked bar per subject (outcomes of a set of cases, MDLs or districts), with a legend grouped by
 * kind of outcome. Click a tag to highlight that outcome across every row (the other segments dim and the right
 * column shows that tag's share); click it again to clear. Shares are whole percentages that sum to 100; the count
 * and n are in the tooltip and each row's text label. Adapted from the owner-supplied verdict-stack reference to our
 * palette slots (a seventh tag and beyond is the neutral "Other": fold the tail first).
 */
import { useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { chartTokens } from "../palette";
import { useHoverTip } from "./parts";
import {
  sortByTag,
  tagPaints,
  verdictSegments,
  type VerdictGroup,
  type VerdictSubject,
} from "./verdict";

export type VerdictStackProps = {
  subjects: readonly VerdictSubject[];
  taxonomy: readonly VerdictGroup[];
  /** Order the rows by the share of one tag, largest first. */
  sortBy?: string | undefined;
  ariaLabel: string;
  /** Widest the subject-name column grows, in px (default 150). All rows share one grid, so every bar has the same length. */
  labelWidth?: number | undefined;
  className?: string | undefined;
};

export function VerdictStack({
  subjects,
  taxonomy,
  sortBy,
  ariaLabel,
  labelWidth = 150,
  className,
}: VerdictStackProps) {
  const [selected, setSelected] = useState<string | null>(null);
  const tags = useMemo(() => taxonomy.flatMap((g) => g.tags), [taxonomy]);
  const paints = useMemo(() => tagPaints(taxonomy), [taxonomy]);
  const rows = useMemo(
    () => (sortBy ? sortByTag(subjects, tags, sortBy) : [...subjects]),
    [subjects, tags, sortBy],
  );
  const tip = useHoverTip();
  if (!rows.length || !tags.length)
    return (
      <p className={cn("text-meta text-muted-foreground", className)} role="status">
        Not recorded: no outcomes to show.
      </p>
    );
  return (
    <div className={cn("min-w-0", className)} style={chartTokens}>
      <div ref={tip.ref} className="relative overflow-x-auto">
        <div
          className="grid gap-x-3 gap-y-2.5"
          role="group"
          aria-label={ariaLabel}
          style={{
            gridTemplateColumns: `fit-content(${labelWidth}px) minmax(96px,1fr) max-content`,
          }}
        >
          {rows.map((subject, si) => {
            const { segments, total, n } = verdictSegments(subject, tags);
            const sel = selected ? segments.find((s) => s.key === selected) : undefined;
            const text = `${subject.label}: ${segments
              .filter((s) => s.count > 0)
              .map((s) => `${s.label} ${s.count} (${s.rounded}%)`)
              .join(", ")}${total === 0 ? "no outcomes recorded" : ""}. n = ${n}.`;
            return (
              <div
                key={subject.id ?? `${subject.label}-${si}`}
                className="col-span-full grid grid-cols-subgrid items-center"
              >
                <p
                  className="m-0 truncate text-[13px] font-medium text-foreground"
                  title={subject.label}
                >
                  {subject.label}
                </p>
                <div
                  role="img"
                  aria-label={text}
                  className="flex h-6 gap-[2px] overflow-hidden rounded-[4px] bg-muted"
                >
                  {total === 0 ? (
                    <span className="flex-1 px-2 text-meta leading-6 text-muted-foreground">
                      Not recorded
                    </span>
                  ) : (
                    segments.map((seg) => {
                      if (seg.count <= 0) return null;
                      const paint = paints.get(seg.key)!;
                      const dim = selected !== null && selected !== seg.key;
                      return (
                        <div
                          key={seg.key}
                          className="flex h-full items-center justify-center overflow-hidden motion-safe:transition-opacity"
                          style={{
                            width: `${seg.percent}%`,
                            minWidth: 2,
                            background: paint.fill,
                            opacity: dim ? 0.18 : 1,
                          }}
                          {...tip.bind({
                            title: subject.label,
                            rows: [
                              {
                                key: seg.key,
                                label: seg.label,
                                value: `${seg.count.toLocaleString("en-US")} · ${seg.rounded}%`,
                                color: paint.fill,
                              },
                            ],
                            footer: `n = ${n.toLocaleString("en-US")}`,
                          })}
                        >
                          {seg.percent >= 9 ? (
                            <span
                              className="text-[11px] font-semibold tabular-nums"
                              style={{ color: paint.ink }}
                            >
                              {seg.rounded}%
                            </span>
                          ) : null}
                        </div>
                      );
                    })
                  )}
                </div>
                <p className="m-0 text-right text-meta tabular-nums text-muted-foreground">
                  {sel ? (
                    <span className="font-semibold text-foreground">{sel.rounded}%</span>
                  ) : total === 0 ? (
                    "—"
                  ) : (
                    `n=${n.toLocaleString("en-US")}`
                  )}
                </p>
              </div>
            );
          })}
        </div>
        {tip.node}
      </div>
      <div className="mt-4 space-y-1.5 border-t border-border/70 pt-3">
        {taxonomy.map((group) => (
          <div
            key={group.group}
            className="grid grid-cols-[88px_minmax(0,1fr)] items-baseline gap-3"
          >
            <p className="m-0 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
              {group.group}
            </p>
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              {group.tags.map((tag) => {
                const on = selected === tag.key;
                return (
                  <button
                    key={tag.key}
                    type="button"
                    aria-pressed={on}
                    onClick={() => setSelected(on ? null : tag.key)}
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded px-0.5 text-xs focus-visible:outline-2 focus-visible:outline-ring",
                      on
                        ? "font-semibold text-foreground underline underline-offset-2"
                        : "text-muted-foreground hover:text-foreground",
                      selected !== null && !on && "opacity-60",
                    )}
                  >
                    <span
                      aria-hidden
                      className="size-2.5 rounded-[2px]"
                      style={{ background: paints.get(tag.key)!.fill }}
                    />
                    {tag.label}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
        <p className="m-0 pt-1 text-meta text-muted-foreground">
          Click an outcome to highlight it in every row.
        </p>
      </div>
    </div>
  );
}
