/** Small shared pieces of the law visualizations: the ordinal legend with its "not recorded" swatch, and notices. */
import { useId, type ReactNode } from "react";
import { Info } from "lucide-react";
import { cn } from "@/lib/utils";
import { RAMP, ZERO_FILL } from "./ramp";

/** A hatched swatch: the one mark for "not recorded" across every law visualization. */
export function HatchSwatch({ className }: { className?: string | undefined }) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, "");
  return (
    <svg width="14" height="10" aria-hidden className={cn("shrink-0 rounded-[2px]", className)}>
      <defs>
        <pattern
          id={id}
          width="4"
          height="4"
          patternUnits="userSpaceOnUse"
          patternTransform="rotate(45)"
        >
          <rect width="4" height="4" fill="var(--muted)" />
          <line x1="0" y1="0" x2="0" y2="4" stroke="var(--muted-foreground)" strokeOpacity={0.45} />
        </pattern>
      </defs>
      <rect width="14" height="10" fill={`url(#${id})`} stroke="var(--border)" />
    </svg>
  );
}

/**
 * Legend of ordinal classes: one swatch per class (light → dark), optional zero swatch, and the hatched "not recorded".
 * Labels wear text tokens; the swatch beside each carries the colour.
 */
export function RampLegend({
  title,
  labels,
  steps,
  zeroLabel,
  notRecordedLabel = "Not recorded",
  className,
}: {
  title: string;
  labels: readonly string[];
  /** Ramp step of each label (defaults to 0..n-1). */
  steps?: readonly number[] | undefined;
  zeroLabel?: string | undefined;
  notRecordedLabel?: string | null | undefined;
  className?: string | undefined;
}) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground",
        className,
      )}
    >
      <span className="font-medium text-foreground">{title}</span>
      <ul
        aria-label={title}
        className="m-0 flex list-none flex-wrap items-center gap-x-2.5 gap-y-1 p-0"
      >
        {zeroLabel ? (
          <li className="flex items-center gap-1">
            <span
              aria-hidden
              className="inline-block h-2.5 w-3.5 rounded-[2px] border border-border"
              style={{ background: ZERO_FILL }}
            />
            {zeroLabel}
          </li>
        ) : null}
        {labels.map((l, i) => (
          <li key={l} className="flex items-center gap-1">
            <span
              aria-hidden
              className="inline-block h-2.5 w-3.5 rounded-[2px]"
              style={{ background: RAMP[steps?.[i] ?? i] }}
            />
            {l}
          </li>
        ))}
        {notRecordedLabel ? (
          <li className="flex items-center gap-1">
            <HatchSwatch />
            {notRecordedLabel}
          </li>
        ) : null}
      </ul>
    </div>
  );
}

/** A quiet notice line (unavailable data, partial coverage). */
export function Notice({
  children,
  tone = "muted",
}: {
  children: ReactNode;
  tone?: "muted" | "warning";
}) {
  return (
    <p
      role="note"
      className={cn(
        "m-0 flex items-start gap-1.5 rounded-md border px-2.5 py-1.5 text-[11px] leading-4",
        tone === "warning"
          ? "border-warning/40 bg-warning/10 text-foreground"
          : "border-border bg-muted/40 text-muted-foreground",
      )}
    >
      <Info className="mt-px size-3 shrink-0" aria-hidden />
      <span>{children}</span>
    </p>
  );
}
