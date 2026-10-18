import { sparkGeometry, type SparkPoint } from "./sparkline";

/**
 * A table-row trend line drawn from a zero baseline. Solid where periods are complete, dashed into a partial period,
 * broken at gaps, with an optional vertical tick where the series stops being like-for-like (a design break).
 * The accessible name states the span and the last value, so the line is never the only carrier of the figure.
 */
export function Sparkline({
  points,
  label,
  width = 88,
  height = 22,
  breakBefore = null,
  className,
}: {
  points: readonly SparkPoint[];
  /** Accessible description, e.g. "Reports per year 2011 to 2026". */
  label: string;
  width?: number;
  height?: number;
  breakBefore?: number | null;
  className?: string;
}) {
  const g = sparkGeometry(points, width, height, { breakBefore });
  if (!g.solid.length && !g.dashed.length && !g.dots.length) {
    return (
      <span
        className="text-[11px] text-muted-foreground"
        aria-label={`${label}: no reliable points`}
      >
        —
      </span>
    );
  }
  return (
    <svg
      role="img"
      aria-label={label}
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={className}
    >
      {g.breakX != null ? (
        <line
          x1={g.breakX}
          x2={g.breakX}
          y1={1}
          y2={height - 1}
          className="stroke-warning"
          strokeWidth={1}
          strokeDasharray="2 2"
        />
      ) : null}
      {g.solid.map((d) => (
        <path
          key={d}
          d={d}
          fill="none"
          className="stroke-primary"
          strokeWidth={1.4}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      ))}
      {g.dashed.map((d) => (
        <path
          key={d}
          d={d}
          fill="none"
          className="stroke-primary"
          strokeWidth={1.4}
          strokeDasharray="2 2"
          strokeLinecap="round"
        />
      ))}
      {g.dots.map((p) => (
        <circle
          key={`${p.x}-${p.y}`}
          cx={p.x}
          cy={p.y}
          r={1.8}
          className={p.partial ? "fill-surface stroke-primary" : "fill-primary"}
          strokeWidth={p.partial ? 1.2 : 0}
        />
      ))}
    </svg>
  );
}
