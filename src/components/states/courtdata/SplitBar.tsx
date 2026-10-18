import { cn } from "@/lib/utils";

const TONES = ["bg-primary", "bg-primary/45", "bg-muted-foreground/35", "bg-warning/70"] as const;

/** One stacked bar for a split of a total; every segment is named and counted in the legend, so colour is never the only cue. */
export function SplitBar({
  title,
  segments,
}: {
  title: string;
  segments: readonly { label: string; value: number; sharePct: number }[];
}) {
  if (!segments.length) return null;
  const summary = segments
    .map((s) => `${s.label} ${s.value.toLocaleString("en-US")} (${s.sharePct.toFixed(1)}%)`)
    .join("; ");
  return (
    <div>
      <p className="text-[11px] font-medium">{title}</p>
      <div
        role="img"
        aria-label={`${title}: ${summary}`}
        className="mt-1 flex h-2 overflow-hidden rounded-full bg-muted"
      >
        {segments.map((s, i) => (
          <span
            key={s.label}
            className={cn("h-full", TONES[i % TONES.length])}
            style={{ width: `${s.sharePct}%` }}
          />
        ))}
      </div>
      <ul className="mt-1.5 flex flex-wrap gap-x-4 gap-y-0.5 text-[11px]">
        {segments.map((s, i) => (
          <li key={s.label} className="flex items-center gap-1.5">
            <span aria-hidden className={cn("size-2 rounded-sm", TONES[i % TONES.length])} />
            <span className="text-muted-foreground">{s.label}</span>
            <span className="font-mono font-medium tabular-nums">
              {s.value.toLocaleString("en-US")}
            </span>
            <span className="font-mono text-muted-foreground tabular-nums">
              {s.sharePct.toFixed(1)}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
