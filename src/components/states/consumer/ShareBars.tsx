import { FDA_COLORS } from "@/components/fda-analytics/chartView";
import { categoryBars } from "./consumerView";

/** Ranked shares as labelled bars; the longest bar is the largest share shown and no row is cut. */
export function ShareBars({
  items,
  color = FDA_COLORS[1],
  suffix = "%",
}: {
  items: readonly { rank?: number; label: string; sharePct: number }[];
  color?: string | undefined;
  suffix?: string;
}) {
  const bars = categoryBars(items);
  return (
    <ol className="space-y-1.5 @xl:max-w-xl">
      {bars.map((b) => (
        <li key={`${b.rank}-${b.label}`}>
          <div className="flex items-baseline justify-between gap-2 text-xs">
            <span className="min-w-0 break-words">
              <span className="mr-1 font-mono text-muted-foreground">{b.rank}.</span>
              {b.label}
            </span>
            <span className="shrink-0 font-mono">
              {b.sharePct}
              {suffix}
            </span>
          </div>
          <div className="mt-0.5 h-1.5 rounded-sm bg-muted" aria-hidden>
            <span
              className="block h-1.5 rounded-sm"
              style={{ width: `${b.width}%`, background: color }}
            />
          </div>
        </li>
      ))}
    </ol>
  );
}
