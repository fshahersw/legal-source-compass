import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { coverageShares, int, pct } from "./analysisFormat";

export type CoverageTone = "strong" | "partial" | "weak" | "none";
export type CoverageSegment = { key: string; label: string; value: number; tone: CoverageTone };

const TONE_BAR: Record<CoverageTone, string> = {
  strong: "bg-primary",
  partial: "bg-primary/45",
  weak: "bg-warning/70",
  none: "bg-muted-foreground/35",
};

/**
 * One stacked bar showing how a set splits by data coverage, with every segment named and counted in
 * a legend so colour is never the only cue. Used where a paragraph used to describe partial coverage.
 */
export function CoverageBar({
  title,
  total,
  segments,
  caption,
  className,
}: {
  title: string;
  /** The set size; the bar covers segments only, so segments summing below `total` are said so. */
  total: number;
  segments: readonly CoverageSegment[];
  caption?: ReactNode;
  className?: string;
}) {
  const shares = coverageShares(segments);
  if (!shares.length) return null;
  const covered = shares.reduce((a, s) => a + s.segment.value, 0);
  const summary = shares
    .map(({ segment, sharePct }) => `${segment.label} ${int(segment.value)} (${pct(sharePct, 0)})`)
    .join("; ");
  return (
    <section
      aria-label={title}
      className={cn("min-w-0 rounded-md border border-border bg-surface px-3 py-2", className)}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <h3 className="text-xs font-semibold">{title}</h3>
        <span className="text-[11px] text-muted-foreground">
          {int(covered)} of {int(total)} classified
        </span>
      </div>
      <div
        role="img"
        aria-label={`${title}: ${summary}`}
        className="mt-1.5 flex h-2 overflow-hidden rounded-full bg-muted"
      >
        {shares.map(({ segment, sharePct }) => (
          <span
            key={segment.key}
            className={cn("h-full", TONE_BAR[segment.tone])}
            style={{ width: `${sharePct}%` }}
          />
        ))}
      </div>
      <ul className="mt-1.5 flex flex-wrap gap-x-4 gap-y-0.5 text-[11px]">
        {shares.map(({ segment, sharePct }) => (
          <li key={segment.key} className="flex items-center gap-1.5">
            <span aria-hidden className={cn("size-2 rounded-sm", TONE_BAR[segment.tone])} />
            <span className="text-muted-foreground">{segment.label}</span>
            <span className="font-mono font-medium tabular-nums">{int(segment.value)}</span>
            <span className="font-mono text-muted-foreground tabular-nums">{pct(sharePct, 0)}</span>
          </li>
        ))}
      </ul>
      {caption ? (
        <p className="mt-1.5 text-[11px] leading-4 text-muted-foreground">{caption}</p>
      ) : null}
    </section>
  );
}
