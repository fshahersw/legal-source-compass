/**
 * The interactive surface every SVG chart sits on: width measurement (charts render at their container's real width,
 * never scaled text), one keyboard stop with arrow-key navigation through the marks, a polite live region that reads
 * the focused mark, and the tooltip box. Hover and keyboard show the same details.
 */
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { cn } from "@/lib/utils";
import { chartTokens } from "./palette";

const useIsoLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

/** Width of an element, tracked with ResizeObserver. Null until measured (server render and first client paint). */
export function useMeasuredWidth<T extends HTMLElement>(): [
  (node: T | null) => void,
  number | null,
] {
  const [width, setWidth] = useState<number | null>(null);
  const observer = useRef<ResizeObserver | null>(null);
  const ref = useCallback((node: T | null) => {
    observer.current?.disconnect();
    observer.current = null;
    if (!node) return;
    const read = () => {
      const w = Math.floor(node.getBoundingClientRect().width);
      setWidth((prev) => (prev === w || w <= 0 ? prev : w));
    };
    read();
    if (typeof ResizeObserver !== "undefined") {
      observer.current = new ResizeObserver(read);
      observer.current.observe(node);
    }
  }, []);
  useEffect(() => () => observer.current?.disconnect(), []);
  return [ref, width];
}

/** Axis tick font size (px): muted 11 px ticks, so the data, not the scale, carries the weight. */
export const AXIS_FONT = 11;

/** Rough rendered width of a label (Public Sans averages about 0.56 em per character); default size: axis ticks. */
export function textWidth(text: string, fontSize = AXIS_FONT): number {
  return text.length * fontSize * 0.56;
}

export type TooltipRow = {
  key: string;
  label: string;
  value: string;
  /** Series colour for the line key; omitted for single-series charts. */
  color?: string | undefined;
  note?: string | undefined;
};

export type TooltipContent = {
  title: string;
  subtitle?: string | undefined;
  rows: TooltipRow[];
  footer?: string | undefined;
};

/**
 * The tooltip box every chart shares: an inverted ink panel (page ink as the fill, page background as the text, so it
 * reads as a layer above the plot in both themes), 7 px radius, a soft drop shadow. Muted text inside it uses the
 * background colour at reduced opacity.
 */
export const TOOLTIP_BOX =
  "pointer-events-none rounded-[7px] bg-foreground px-[9px] py-[7px] text-[11.5px] leading-4 text-background shadow-[0_6px_24px_rgba(0,0,0,0.2)]";
/** Secondary text inside the tooltip box. */
export const TOOLTIP_MUTED = "text-background/65";

/** The series key in a tooltip row: a 8 px square in the series colour. */
export function TooltipSwatch({ color }: { color: string }) {
  return (
    <span
      aria-hidden
      className="inline-block size-2 shrink-0 translate-y-[-0.5px] self-center rounded-[2px]"
      style={{ background: color }}
    />
  );
}

/** Tooltip box: title, then one row per series (key square, label, value at the right edge). */
export function ChartTooltip({
  content,
  x,
  y,
  containerWidth,
}: {
  content: TooltipContent;
  x: number;
  y: number;
  containerWidth: number;
}) {
  const boxWidth = 240;
  const left = x + 14 + boxWidth > containerWidth ? Math.max(4, x - 14 - boxWidth) : x + 14;
  return (
    <div
      aria-hidden
      data-chart-tooltip=""
      className={cn(TOOLTIP_BOX, "absolute z-20 w-max min-w-36 max-w-[240px]")}
      style={{ left, top: Math.max(0, y - 10) }}
    >
      <p className="font-semibold">{content.title}</p>
      {content.subtitle ? <p className={TOOLTIP_MUTED}>{content.subtitle}</p> : null}
      {content.rows.length ? (
        <ul className="mt-1 space-y-0.5">
          {content.rows.map((r) => (
            <li key={r.key} className="flex items-baseline gap-2">
              {r.color ? <TooltipSwatch color={r.color} /> : null}
              {r.label ? (
                <span className={cn("min-w-0 flex-1 truncate", TOOLTIP_MUTED)}>{r.label}</span>
              ) : (
                <span className="flex-1" />
              )}
              <span className="ml-auto shrink-0 font-semibold tabular-nums">{r.value}</span>
              {r.note ? <span className={cn("shrink-0", TOOLTIP_MUTED)}>{r.note}</span> : null}
            </li>
          ))}
        </ul>
      ) : null}
      {content.footer ? <p className={cn("mt-1", TOOLTIP_MUTED)}>{content.footer}</p> : null}
    </div>
  );
}

export type ChartCanvasProps = {
  /** Fixed width (tests, server-known layouts); measured from the container when omitted. */
  width?: number | undefined;
  height: number;
  /** Text alternative: what the chart shows. The data table carries every value. */
  ariaLabel: string;
  /** Number of marks reachable with the arrow keys (0 disables navigation). */
  count: number;
  active: number | null;
  onActive: (index: number | null) => void;
  /** Sentence read when a mark gets keyboard focus. */
  describe: (index: number) => string;
  /** Keys: ArrowLeft/Right by default; ArrowUp/Down for vertical lists. */
  orientation?: "horizontal" | "vertical";
  className?: string | undefined;
  /** Draws the marks for a width and returns the tooltip to show, if any. */
  children: (width: number) => { marks: ReactNode; tooltip: TipSpec | null };
};

export type TipSpec = { content: TooltipContent; x: number; y: number };

export function ChartCanvas({
  width: fixedWidth,
  height,
  ariaLabel,
  count,
  active,
  onActive,
  describe,
  orientation = "horizontal",
  className,
  children,
}: ChartCanvasProps) {
  const [ref, measured] = useMeasuredWidth<HTMLDivElement>();
  const width = fixedWidth ?? measured;
  const drawn = width ? children(width) : null;
  const liveId = useId();
  const [announce, setAnnounce] = useState("");
  const next = orientation === "horizontal" ? "ArrowRight" : "ArrowDown";
  const prev = orientation === "horizontal" ? "ArrowLeft" : "ArrowUp";
  useIsoLayoutEffect(() => {
    if (active === null) return;
    setAnnounce(describe(active));
  }, [active]);
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!count) return;
    let to: number | null = null;
    if (e.key === next) to = active === null ? 0 : Math.min(count - 1, active + 1);
    else if (e.key === prev) to = active === null ? count - 1 : Math.max(0, active - 1);
    else if (e.key === "Home") to = 0;
    else if (e.key === "End") to = count - 1;
    else if (e.key === "Escape") {
      onActive(null);
      return;
    } else return;
    e.preventDefault();
    onActive(to);
  };
  return (
    <div
      ref={ref}
      className={cn("relative w-full min-w-0", className)}
      style={{ ...chartTokens, height }}
    >
      <div
        role="group"
        aria-roledescription="chart"
        aria-label={`${ariaLabel}${count ? " Use the arrow keys to read each value." : ""}`}
        aria-describedby={liveId}
        tabIndex={count ? 0 : -1}
        onKeyDown={onKeyDown}
        onBlur={() => onActive(null)}
        className="h-full w-full rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
      >
        {width ? (
          <svg
            width={width}
            height={height}
            viewBox={`0 0 ${width} ${height}`}
            aria-hidden
            className="block overflow-visible font-sans motion-safe:animate-in motion-safe:fade-in motion-safe:duration-300"
          >
            {drawn?.marks}
          </svg>
        ) : null}
      </div>
      <p id={liveId} aria-live="polite" className="sr-only">
        {announce}
      </p>
      {drawn?.tooltip && width ? (
        <ChartTooltip
          content={drawn.tooltip.content}
          x={drawn.tooltip.x}
          y={drawn.tooltip.y}
          containerWidth={width}
        />
      ) : null}
    </div>
  );
}

/** Pointer position relative to the chart's SVG. */
export function localPoint(e: { clientX: number; clientY: number; currentTarget: Element }): {
  x: number;
  y: number;
} {
  const svg = (e.currentTarget as SVGElement).ownerSVGElement ?? e.currentTarget;
  const rect = svg.getBoundingClientRect();
  return { x: e.clientX - rect.left, y: e.clientY - rect.top };
}

export const axisText = {
  fontSize: AXIS_FONT,
  fill: "var(--chart-axis)",
} as const;
